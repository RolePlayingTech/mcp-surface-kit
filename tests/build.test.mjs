import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyBuild, parseSkillFrontmatter, planBuild, renderSkill } from '../src/build.mjs';
import { loadSpec, normalizeSpec } from '../src/spec.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('build writes SKILL.md with frontmatter, responsibility boundary, expiry and stop rule', () => {
  const spec = loadSpec(join(root, 'examples/content-workspace'));
  const dir = mkdtempSync(join(tmpdir(), 'mcp-surface-'));
  const files = applyBuild(planBuild(spec, dir));
  const skill = files.find((file) => file.path.endsWith(join('publish-content', 'SKILL.md')));
  assert.ok(skill);
  const body = readFileSync(skill.path, 'utf8');
  assert.match(body, /^---\nname: publish-content\n/);
  assert.match(body, /Use when/);
  assert.match(body, /prepare_publication_action/);
  assert.match(body, /STOP unless confirmation_mode=approved_strategy/);
  assert.match(body, /expired or the payload changed/);
  assert.match(body, /Responsibility boundary/);
  assert.match(body, /untrusted data/);

  const parsed = parseSkillFrontmatter(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.name, 'publish-content');
});

test('YAML frontmatter safely escapes colons, quotes, hashes and multiline descriptions', () => {
  const specialSpec = normalizeSpec({
    name: 'yaml-test',
    purpose: 'test',
    tools: [
      {
        name: 'get_context',
        tier: 'read',
        annotations: { readOnlyHint: true },
        description: 'Read context',
      },
    ],
    skills: [
      {
        name: 'colon-skill',
        description: 'Step 1: inspect context #fast "quoted" [array]. Use when: user asks for a check.',
        uses: ['get_context'],
      },
      {
        name: 'multiline-skill',
        description: 'First line with: colon.\nSecond line with Use when the user asks.\nThird line.',
        uses: ['get_context'],
      },
    ],
  });

  for (const skill of specialSpec.skills) {
    const rendered = renderSkill(specialSpec, skill);
    const parsed = parseSkillFrontmatter(rendered);
    assert.equal(parsed.ok, true, parsed.error);
    assert.equal(parsed.data.name, skill.name);
    assert.equal(parsed.data.description, skill.description);
  }
});

test('rejects path traversal in skill.name and copySkillsTo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-surface-traversal-'));

  const badSkillSpec = normalizeSpec({
    name: 'traversal',
    purpose: 'test',
    tools: [{ name: 'get_context', tier: 'read', annotations: { readOnlyHint: true }, description: 'ctx' }],
    skills: [{ name: '../../escape', description: 'Bad. Use when testing.', uses: ['get_context'] }],
  });
  assert.throws(() => planBuild(badSkillSpec, dir), /skill name/);

  const badCopySpec = normalizeSpec({
    name: 'traversal-copy',
    purpose: 'test',
    copySkillsTo: ['../outside'],
    tools: [{ name: 'get_context', tier: 'read', annotations: { readOnlyHint: true }, description: 'ctx' }],
    skills: [{ name: 'safe-skill', description: 'Safe. Use when testing.', uses: ['get_context'] }],
  });
  assert.throws(() => planBuild(badCopySpec, dir), /copySkillsTo target "\.\.\/outside" is unsafe/);

  const gitCopySpec = normalizeSpec({
    name: 'git-copy',
    purpose: 'test',
    copySkillsTo: ['.git/hooks'],
    tools: [{ name: 'get_context', tier: 'read', annotations: { readOnlyHint: true }, description: 'ctx' }],
    skills: [{ name: 'safe-skill', description: 'Safe. Use when testing.', uses: ['get_context'] }],
  });
  assert.throws(() => planBuild(gitCopySpec, dir), /reserved directory "\.git"/);
});

test('rejects symlinked target directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-surface-symlink-'));
  const outside = mkdtempSync(join(tmpdir(), 'mcp-surface-outside-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });

  let symlinkCreated = false;
  try {
    symlinkSync(outside, join(dir, '.claude', 'skills'), 'junction');
    symlinkCreated = true;
  } catch {
    symlinkCreated = false;
  }

  if (symlinkCreated) {
    const spec = loadSpec(join(root, 'examples/content-workspace'));
    assert.throws(() => planBuild(spec, dir), /symbolic link or junction/);
  }
});

test('idempotent rebuilds, automatic managed updates, and conflict protection for hand-written or hand-edited skills', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-surface-lifecycle-'));
  const baseRaw = {
    name: 'lifecycle',
    purpose: 'test lifecycle',
    copySkillsTo: ['.claude/skills'],
    tools: [
      {
        name: 'get_context',
        tier: 'read',
        annotations: { readOnlyHint: true },
        description: 'Original description.',
      },
    ],
    skills: [
      {
        name: 'my-skill',
        description: 'Run workflow. Use when testing lifecycle.',
        uses: ['get_context'],
      },
    ],
  };

  // 1. Initial build creates 2 files
  const spec1 = normalizeSpec(baseRaw);
  const plan1 = planBuild(spec1, dir);
  assert.equal(plan1.counts.create, 2);
  applyBuild(plan1);

  // 2. Second build with identical spec is unchanged
  const plan2 = planBuild(spec1, dir);
  assert.equal(plan2.counts.unchanged, 2);
  assert.equal(plan2.counts.create, 0);
  assert.equal(plan2.counts.update, 0);

  // 3. Updating the spec updates unedited managed files cleanly
  const updatedRaw = structuredClone(baseRaw);
  updatedRaw.tools[0].description = 'Updated tool description.';
  const spec2 = normalizeSpec(updatedRaw);
  const plan3 = planBuild(spec2, dir);
  assert.equal(plan3.counts.update, 2);
  assert.ok(plan3[0].diff.includes('+1. `get_context` (`read`, scope: undeclared) — Updated tool description.'));
  applyBuild(plan3);

  // 4. Hand-editing a managed file causes a conflict and blocks build without --force
  const claudeSkillPath = join(dir, '.claude', 'skills', 'my-skill', 'SKILL.md');
  writeFileSync(claudeSkillPath, readFileSync(claudeSkillPath, 'utf8') + '\n## Custom hand note\n', 'utf8');
  const plan4 = planBuild(spec1, dir);
  assert.equal(plan4.counts.conflict, 1);
  assert.throws(() => applyBuild(plan4), /Refusing to overwrite conflicting skill file/);
  assert.match(readFileSync(claudeSkillPath, 'utf8'), /Custom hand note/);

  // 5. Passing force: true resolves the conflict
  const planForce = planBuild(spec1, dir, { force: true });
  assert.equal(planForce.counts.conflict, 0);
  assert.equal(planForce.counts.update, 2);
  applyBuild(planForce, { force: true });
  assert.doesNotMatch(readFileSync(claudeSkillPath, 'utf8'), /Custom hand note/);

  // 6. Pre-existing unmanaged file is also protected as a conflict
  const dirUnmanaged = mkdtempSync(join(tmpdir(), 'mcp-surface-unmanaged-'));
  const manualPath = join(dirUnmanaged, '.claude', 'skills', 'my-skill', 'SKILL.md');
  mkdirSync(dirname(manualPath), { recursive: true });
  writeFileSync(manualPath, '---\nname: my-skill\ndescription: Hand written. Use when manual.\n---\n# Manual\n', 'utf8');

  const planUnmanaged = planBuild(spec1, dirUnmanaged);
  assert.equal(planUnmanaged.counts.conflict, 1);
  assert.throws(() => applyBuild(planUnmanaged), /not generated by mcp-surface-kit/);
  assert.match(readFileSync(manualPath, 'utf8'), /# Manual/);
});

test('dryRun does not create directories or files on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-surface-dry-'));
  const spec = loadSpec(join(root, 'examples/content-workspace'));
  const planned = planBuild(spec, dir);
  applyBuild(planned, { dryRun: true });
  assert.equal(existsSync(join(dir, '.mcp-surface')), false);
  assert.equal(existsSync(join(dir, '.claude')), false);
});

test('transactional rollback restores prior state when a write fails mid-build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-surface-tx-'));
  const spec = loadSpec(join(root, 'examples/content-workspace'));
  const planned = planBuild(spec, dir);
  assert.equal(planned.length, 2);

  let writeCalls = 0;
  const faultyIo = {
    ...fs,
    writeFileSync(target, data, options) {
      writeCalls++;
      if (writeCalls === 2) {
        throw new Error('Simulated disk full on second skill write');
      }
      return fs.writeFileSync(target, data, options);
    },
  };

  assert.throws(() => applyBuild(planned, { io: faultyIo }), /prior file state restored/);
  assert.equal(existsSync(planned[0].path), false, 'first created file must be rolled back');
  assert.equal(existsSync(planned[1].path), false, 'second file must not exist');
});
