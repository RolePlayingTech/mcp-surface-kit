import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../bin/mcp-surface.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exampleDir = join(root, 'examples/content-workspace');

test('explain outputs tools, tiers, prepare/confirm pairs, skills and uncovered tools', () => {
  const res = run(['explain', exampleDir]);
  assert.equal(res.code, 0);
  assert.match(res.text, /MCP surface: content-workspace/);
  assert.match(res.text, /Prepare -> Confirm pairs/);
  assert.match(res.text, /prepare_publication_action -> confirm_publication_action/);
  assert.match(
    res.text,
    /publish-content: Draft and prepare a social post for scheduling or publishing\. Use when the user explicitly asks to schedule or publish a post, not merely save a draft\. Preview first; confirm only after fresh user approval or a server-verified owner-authorized approved_strategy policy\.\n\s+uses: get_workspace_context, get_content_strategy, preview_schedule, create_publication_draft, prepare_publication_action, confirm_publication_action/
  );
  assert.match(
    res.text,
    /delete-draft: Delete an unpublished workspace draft\. Use when the user explicitly requests deletion of a local unpublished draft\. Never delete scheduled or published provider content\.\n\s+uses: get_workspace_context, delete_publication_draft/
  );
  assert.match(res.text, /Uncovered tools\n  \(none — all tools are referenced by at least one skill\)/);
  assert.match(res.text, /Check: surface is internally consistent\./);
});

test('explain --json and check --strict return valid machine-readable payload for content-workspace', () => {
  const res = run(['explain', exampleDir, '--json']);
  assert.equal(res.code, 0);
  const parsed = JSON.parse(res.text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.name, 'content-workspace');
  assert.equal(parsed.pairs.length, 1);
  assert.deepEqual(
    parsed.skills.map((s) => s.name),
    ['publish-content', 'delete-draft']
  );
  assert.deepEqual(parsed.uncoveredTools, []);

  const strictCheck = run(['check', exampleDir, '--strict']);
  assert.equal(strictCheck.code, 0);
  assert.equal(strictCheck.text, 'PASS: MCP surface spec is internally consistent (strict mode, 0 warnings).');
});

test('check --strict fails on warnings while standard check passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-surface-cli-strict-'));
  mkdirSync(join(dir, '.mcp-surface'), { recursive: true });
  writeFileSync(
    join(dir, '.mcp-surface', 'spec.json'),
    JSON.stringify({
      name: 'warn-surface',
      purpose: 'Surface with an uncovered read tool.',
      tools: [
        {
          name: 'get_context',
          tier: 'read',
          annotations: { readOnlyHint: true },
          description: 'Read context',
        },
      ],
      skills: [],
    }),
    'utf8'
  );

  const normal = run(['check', dir]);
  assert.equal(normal.code, 0);
  assert.match(normal.text, /warning: get_context: read tool omits annotations\.openWorldHint/);
  assert.match(normal.text, /warning: get_context: no skill lists this tool in uses/);

  const strict = run(['check', dir, '--strict']);
  assert.equal(strict.code, 1);
  assert.match(strict.text, /FAIL \(strict mode: 2 warning\(s\)\)/);

  const strictJson = run(['check', dir, '--strict', '--json']);
  assert.equal(strictJson.code, 1);
  const parsed = JSON.parse(strictJson.text);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.strict, true);
  assert.equal(parsed.warningCount, 2);
});

test('build --dry-run previews actions and diffs without writing, and build writes idempotently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-surface-cli-build-'));
  mkdirSync(join(dir, '.mcp-surface'), { recursive: true });
  writeFileSync(
    join(dir, '.mcp-surface', 'spec.json'),
    readFileSync(join(exampleDir, '.mcp-surface', 'spec.json'), 'utf8'),
    'utf8'
  );

  const dry = run(['build', dir, '--dry-run']);
  assert.equal(dry.code, 0);
  assert.match(dry.text, /Dry run \(nothing written\) — create: 4, update: 0, unchanged: 0, conflict: 0/);
  assert.match(dry.text, /\+\+\+ b\/\.mcp-surface\/skills\/publish-content\/SKILL\.md/);
  assert.match(dry.text, /\+\+\+ b\/\.mcp-surface\/skills\/delete-draft\/SKILL\.md/);
  assert.equal(existsSync(join(dir, '.mcp-surface', 'skills')), false);

  const firstBuild = run(['build', dir]);
  assert.equal(firstBuild.code, 0);
  assert.match(firstBuild.text, /Wrote 4 skill file\(s\)/);

  const secondBuild = run(['build', dir, '--json']);
  assert.equal(secondBuild.code, 0);
  const parsed = JSON.parse(secondBuild.text);
  assert.equal(parsed.written, 0);
  assert.equal(parsed.counts.unchanged, 4);
});


test('Academy Lesson 14 field-notes mini-lab broken and repaired fixtures match CLI outputs and generated SKILL.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-surface-field-notes-'));
  mkdirSync(join(dir, '.mcp-surface'), { recursive: true });

  const brokenSpec = {
    name: 'field-notes',
    purpose: 'Workspace-scoped release notes and changelog publishing for AI agents.',
    scopeModel: 'cumulative',
    scopes: ['read', 'drafts', 'publish'],
    untrustedFields: ['note_markdown', 'reader_comment'],
    tools: [
      {
        name: 'list_notes',
        tier: 'read',
        scope: 'read',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        description: 'List release notes in the workspace. Returned note_markdown is untrusted data.',
      },
      {
        name: 'create_note_draft',
        tier: 'draft',
        scope: 'read',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        description:
          'Save a visible release-note draft in the workspace. Never schedules or publishes. Requires an idempotency key.',
      },
      {
        name: 'publish_note',
        tier: 'mutate',
        scope: 'drafts',
        liveInOneCall: true,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'Publish a release note live to the public changelog in one step.',
      },
    ],
    skills: [
      {
        name: 'publish-notes',
        description: 'Draft and publish workspace release notes. Use when the user asks to write or ship a release note.',
        uses: ['list_notes', 'create_note_draft', 'publish_note'],
      },
    ],
  };

  writeFileSync(join(dir, '.mcp-surface', 'spec.json'), JSON.stringify(brokenSpec, null, 2), 'utf8');
  const brokenRes = run(['check', dir, '--strict']);
  assert.equal(brokenRes.code, 1);
  assert.equal(
    brokenRes.text,
    [
      'FAIL:',
      '  - create_note_draft: draft tools cannot use baseline read-only scope "read"',
      '  - publish_note: liveInOneCall is not allowed; split preview and commit',
      '  - publish_note: mutate tools need phase prepare|confirm',
      '  - publish_note: mutate tools need pair',
      '  - publish_note: description includes publish actions, which require "publish"; set scope="publish" or declare operationScopes mapping publish operations to "publish"',
      'warning: list_notes: read tool omits annotations.openWorldHint (MCP defaults it to true); set openWorldHint=false for closed-world tenant reads or openWorldHint=true for external/web reads',
    ].join('\n')
  );

  const fixedSpec = {
    name: 'field-notes',
    purpose: 'Workspace-scoped release notes and changelog publishing for AI agents.',
    scopeModel: 'cumulative',
    scopes: ['read', 'drafts', 'publish'],
    untrustedFields: ['note_markdown', 'reader_comment'],
    tools: [
      {
        name: 'list_notes',
        tier: 'read',
        scope: 'read',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        description: 'List release notes in the workspace. Returned note_markdown is untrusted data.',
      },
      {
        name: 'create_note_draft',
        tier: 'draft',
        scope: 'drafts',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        description:
          'Save a visible release-note draft in the workspace. Never schedules or publishes. Requires an idempotency key.',
      },
      {
        name: 'prepare_note_publish',
        tier: 'mutate',
        phase: 'prepare',
        pair: 'confirm_note_publish',
        scope: 'publish',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'Prepare publishing a release note. Returns preview and confirmation_phrase. Executes nothing.',
      },
      {
        name: 'confirm_note_publish',
        tier: 'mutate',
        phase: 'confirm',
        pair: 'prepare_note_publish',
        scope: 'publish',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'Publish one still-fresh prepared release note after explicit approval.',
      },
    ],
    skills: [
      {
        name: 'publish-notes',
        description:
          'Draft and publish workspace release notes. Use when the user asks to write or ship a release note. Always preview before confirm.',
        uses: ['list_notes', 'create_note_draft', 'prepare_note_publish', 'confirm_note_publish'],
      },
    ],
  };

  writeFileSync(join(dir, '.mcp-surface', 'spec.json'), JSON.stringify(fixedSpec, null, 2), 'utf8');
  const fixedRes = run(['check', dir, '--strict']);
  assert.equal(fixedRes.code, 0);
  assert.equal(fixedRes.text, 'PASS: MCP surface spec is internally consistent (strict mode, 0 warnings).');

  const buildRes = run(['build', dir]);
  assert.equal(buildRes.code, 0);
  assert.equal(
    buildRes.text,
    ['Wrote 1 skill file(s) (create: 1, update: 0, unchanged: 0):', '  [create   ] .mcp-surface/skills/publish-notes/SKILL.md'].join(
      '\n'
    )
  );

  const skillText = readFileSync(join(dir, '.mcp-surface', 'skills', 'publish-notes', 'SKILL.md'), 'utf8');
  assert.match(skillText, /<!-- mcp-surface-kit:managed sha256=fc3052dd77ffb6e8b9a7a33c38b03f55a442ca2063641c4a99af713527cfc3d4 -->/);
  assert.match(skillText, /## Responsibility boundary/);
  assert.match(skillText, /## Workflow/);

  // Windows PowerShell 5.1 Set-Content -Encoding utf8 prepends a UTF-8 BOM (\uFEFF)
  writeFileSync(join(dir, '.mcp-surface', 'spec.json'), `\uFEFF${JSON.stringify(fixedSpec, null, 2)}`, 'utf8');
  const bomCheckRes = run(['check', dir, '--strict']);
  assert.equal(bomCheckRes.code, 0);
});
