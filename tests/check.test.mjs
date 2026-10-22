import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSpec } from '../src/check.mjs';
import { loadSpec, normalizeSpec } from '../src/spec.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('example content-workspace spec passes', () => {
  const spec = loadSpec(join(root, 'examples/content-workspace'));
  const result = checkSpec(spec);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.errors.length, 0);
});

test('a one-call publish tool fails check', () => {
  const spec = normalizeSpec({
    name: 'bad',
    purpose: 'demo',
    tools: [
      {
        name: 'publish_post',
        tier: 'mutate',
        liveInOneCall: true,
        description: 'Publishes immediately',
      },
    ],
    skills: [],
  });
  const result = checkSpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('liveInOneCall')));
  assert.ok(result.errors.some((e) => e.includes('phase')));
});

test('skill must name existing tools and say when to use it', () => {
  const spec = normalizeSpec({
    name: 'bad',
    purpose: 'demo',
    tools: [
      {
        name: 'get_workspace_context',
        tier: 'read',
        annotations: { readOnlyHint: true },
        description: 'context',
      },
    ],
    skills: [{ name: 'campaign', description: 'Does campaign things', uses: ['nope'] }],
  });
  const result = checkSpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Use when')));
  assert.ok(result.errors.some((e) => e.includes('unknown tool')));
});
