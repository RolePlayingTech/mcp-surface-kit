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
  assert.match(res.text, /Uncovered tools/);
  assert.match(res.text, /Check: surface is internally consistent\./);
});

test('explain --json returns stable machine-readable payload', () => {
  const res = run(['explain', exampleDir, '--json']);
  assert.equal(res.code, 0);
  const parsed = JSON.parse(res.text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.name, 'content-workspace');
  assert.equal(parsed.pairs.length, 1);
  assert.deepEqual(parsed.uncoveredTools, []);
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
  assert.match(dry.text, /Dry run \(nothing written\) — create: 2, update: 0, unchanged: 0, conflict: 0/);
  assert.match(dry.text, /\+\+\+ b\/\.mcp-surface\/skills\/publish-content\/SKILL\.md/);
  assert.equal(existsSync(join(dir, '.mcp-surface', 'skills')), false);

  const firstBuild = run(['build', dir]);
  assert.equal(firstBuild.code, 0);
  assert.match(firstBuild.text, /Wrote 2 skill file\(s\)/);

  const secondBuild = run(['build', dir, '--json']);
  assert.equal(secondBuild.code, 0);
  const parsed = JSON.parse(secondBuild.text);
  assert.equal(parsed.written, 0);
  assert.equal(parsed.counts.unchanged, 2);
});
