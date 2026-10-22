import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyBuild, planBuild } from '../src/build.mjs';
import { loadSpec } from '../src/spec.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('build writes SKILL.md with frontmatter and stop rule', () => {
  const spec = loadSpec(join(root, 'examples/content-workspace'));
  const dir = mkdtempSync(join(tmpdir(), 'mcp-surface-'));
  const files = applyBuild(planBuild(spec, dir));
  const skill = files.find((file) => file.path.endsWith(`${join('publish-content', 'SKILL.md')}`));
  assert.ok(skill);
  const body = readFileSync(skill.path, 'utf8');
  assert.match(body, /^---\nname: publish-content\n/);
  assert.match(body, /Use when/);
  assert.match(body, /prepare_publication_action/);
  assert.match(body, /STOP unless confirmation_mode=approved_strategy/);
  assert.match(body, /untrusted data/);
});
