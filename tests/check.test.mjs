import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkSpec } from '../src/check.mjs';
import { explainData, formatExplain } from '../src/explain.mjs';
import { validateSkillName, validateToolName } from '../src/fs-safe.mjs';
import { loadSpec, normalizeSpec } from '../src/spec.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('example content-workspace spec passes with zero errors and zero warnings', () => {
  const spec = loadSpec(join(root, 'examples/content-workspace'));
  const result = checkSpec(spec);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0, result.warnings.join('; '));
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

test('MCP annotations follow conservative defaults: omitted idempotentHint is false and omitted destructiveHint is true', () => {
  const spec = normalizeSpec({
    name: 'defaults',
    purpose: 'demo',
    tools: [
      {
        name: 'create_draft',
        tier: 'draft',
        description: 'Creates a draft',
      },
    ],
    skills: [],
  });
  const tool = spec.tools[0];
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.annotations.destructiveHint, true);
  assert.equal(tool.annotations.idempotentHint, false);
  assert.equal(tool.annotations.openWorldHint, true);

  const result = checkSpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('destructiveHint=false')));
  assert.ok(result.errors.some((e) => e.includes('openWorldHint=false')));
  assert.ok(result.warnings.some((w) => w.includes('idempotentHint is not true')));
});

test('delete tier fails without an explicit safety model (pair or local_draft_only guard)', () => {
  const unguarded = normalizeSpec({
    name: 'bad-delete',
    purpose: 'demo',
    tools: [
      {
        name: 'delete_post',
        tier: 'delete',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        description: 'Deletes a post',
      },
    ],
    skills: [],
  });
  const res1 = checkSpec(unguarded);
  assert.equal(res1.ok, false);
  assert.ok(res1.errors.some((e) => e.includes('prepare/confirm pair or set guard="local_draft_only"')));

  const openWorldLocalGuard = normalizeSpec({
    name: 'bad-open-delete',
    purpose: 'demo',
    tools: [
      {
        name: 'delete_live_post',
        tier: 'delete',
        guard: 'local_draft_only',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'Deletes a live post',
      },
    ],
    skills: [],
  });
  const res2 = checkSpec(openWorldLocalGuard);
  assert.equal(res2.ok, false);
  assert.ok(res2.errors.some((e) => e.includes('openWorldHint=false')));

  const nonDestructiveDelete = normalizeSpec({
    name: 'bad-nondestructive-delete',
    purpose: 'demo',
    tools: [
      {
        name: 'delete_draft',
        tier: 'delete',
        guard: 'local_draft_only',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        description: 'Deletes a draft',
      },
    ],
    skills: [],
  });
  const res3 = checkSpec(nonDestructiveDelete);
  assert.equal(res3.ok, false);
  assert.ok(res3.errors.some((e) => e.includes('destructiveHint=true')));

  const pairedDelete = normalizeSpec({
    name: 'paired-delete',
    purpose: 'demo',
    scopes: ['read', 'publish'],
    tools: [
      {
        name: 'prepare_delete_channel',
        tier: 'delete',
        phase: 'prepare',
        pair: 'confirm_delete_channel',
        scope: 'publish',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'Prepare channel deletion',
      },
      {
        name: 'confirm_delete_channel',
        tier: 'delete',
        phase: 'confirm',
        pair: 'prepare_delete_channel',
        scope: 'publish',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'Confirm channel deletion',
      },
    ],
    skills: [
      {
        name: 'delete-channel',
        description: 'Delete a channel safely. Use when the owner asks to remove a channel.',
        uses: ['prepare_delete_channel', 'confirm_delete_channel'],
      },
    ],
  });
  const res4 = checkSpec(pairedDelete);
  assert.equal(res4.ok, true, res4.errors.join('; '));
});

test('detects self-pairing, non-reciprocal pairs, same-phase pairs and duplicate names', () => {
  const selfPaired = normalizeSpec({
    name: 'self-pair',
    purpose: 'demo',
    tools: [
      {
        name: 'prepare_action',
        tier: 'mutate',
        phase: 'prepare',
        pair: 'prepare_action',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'Stages action',
      },
    ],
    skills: [],
  });
  const res1 = checkSpec(selfPaired);
  assert.equal(res1.ok, false);
  assert.ok(res1.errors.some((e) => e.includes('cannot pair a tool with itself')));

  const brokenPairsAndDupes = normalizeSpec({
    name: 'broken',
    purpose: 'demo',
    tools: [
      {
        name: 'prep_a',
        tier: 'mutate',
        phase: 'prepare',
        pair: 'prep_b',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'A',
      },
      {
        name: 'prep_b',
        tier: 'mutate',
        phase: 'prepare',
        pair: 'prep_a',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'B',
      },
      {
        name: 'prep_b',
        tier: 'read',
        annotations: { readOnlyHint: true },
        description: 'Duplicate tool',
      },
    ],
    skills: [
      { name: 'same-skill', description: 'First. Use when testing.', uses: ['prep_a'] },
      { name: 'same-skill', description: 'Second. Use when testing.', uses: ['prep_a'] },
    ],
  });
  const res2 = checkSpec(brokenPairsAndDupes);
  assert.equal(res2.ok, false);
  assert.ok(res2.errors.some((e) => e.includes('duplicate tool name: prep_b')));
  assert.ok(res2.errors.some((e) => e.includes('duplicate skill name: same-skill')));
});

test('validates scope hierarchy, multi-operation publish scopes, and non-read tools using read scope', () => {
  const badScopes = normalizeSpec({
    name: 'bad-scopes',
    purpose: 'demo',
    scopes: ['read', 'drafts', 'schedule', 'publish'],
    tools: [
      {
        name: 'create_draft',
        tier: 'draft',
        scope: 'read',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        description: 'Creates draft with read scope',
      },
      {
        name: 'prepare_publication_action',
        tier: 'mutate',
        phase: 'prepare',
        pair: 'confirm_publication_action',
        scope: 'schedule',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'Prepare schedule or publish_now action',
      },
      {
        name: 'confirm_publication_action',
        tier: 'mutate',
        phase: 'confirm',
        pair: 'prepare_publication_action',
        scope: 'publish',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'Confirm schedule or publish_now action',
      },
    ],
    skills: [],
  });
  const res = checkSpec(badScopes);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('cannot use baseline read-only scope "read"')));
  assert.ok(res.errors.some((e) => e.includes('description includes publish actions, which require "publish"')));
  assert.ok(res.errors.some((e) => e.includes('must declare matching scope and operationScopes')));
});

test('validates skill uses order: confirm cannot appear without or before prepare', () => {
  const reversed = normalizeSpec({
    name: 'reversed',
    purpose: 'demo',
    tools: [
      {
        name: 'prepare_item',
        tier: 'mutate',
        phase: 'prepare',
        pair: 'confirm_item',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'Prepare item',
      },
      {
        name: 'confirm_item',
        tier: 'mutate',
        phase: 'confirm',
        pair: 'prepare_item',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'Confirm item',
      },
    ],
    skills: [
      {
        name: 'bad-order',
        description: 'Do item. Use when user asks.',
        uses: ['confirm_item', 'prepare_item'],
      },
      {
        name: 'missing-prepare',
        description: 'Do item. Use when user asks.',
        uses: ['confirm_item'],
      },
    ],
  });
  const res = checkSpec(reversed);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('before its prepare partner')));
  assert.ok(res.errors.some((e) => e.includes('without its prepare partner')));
});

test('warns when copySkillsTo lists both .agents/skills and .claude/skills', () => {
  const spec = normalizeSpec({
    name: 'overlap',
    purpose: 'demo',
    copySkillsTo: ['.agents/skills', '.claude/skills'],
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
        name: 'read-context',
        description: 'Read context. Use when grounding.',
        uses: ['get_context'],
      },
    ],
  });
  const res = checkSpec(spec);
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => w.includes('multiple shared agent skill directories')));
});

test('read tool with omitted openWorldHint normalizes to true per MCP defaults and emits a warning (#7)', () => {
  const implicitOpenWorld = normalizeSpec({
    name: 'demo',
    purpose: 'demo',
    tools: [
      {
        name: 'search_web',
        tier: 'read',
        description: 'Search public pages',
        annotations: { readOnlyHint: true },
      },
    ],
    skills: [
      {
        name: 'web-search',
        description: 'Search the web. Use when looking up public pages.',
        uses: ['search_web'],
      },
    ],
  });
  assert.equal(implicitOpenWorld.tools[0].annotations.readOnlyHint, true);
  assert.equal(implicitOpenWorld.tools[0].annotations.destructiveHint, true);
  assert.equal(implicitOpenWorld.tools[0].annotations.idempotentHint, false);
  assert.equal(implicitOpenWorld.tools[0].annotations.openWorldHint, true);
  assert.equal(implicitOpenWorld.tools[0].declaredAnnotations.openWorldHint, undefined);

  const checkImplicit = checkSpec(implicitOpenWorld);
  assert.equal(checkImplicit.ok, true);
  assert.ok(checkImplicit.warnings.some((w) => w.includes('search_web: read tool omits annotations.openWorldHint')));

  const explained = explainData(implicitOpenWorld, checkImplicit);
  assert.equal(explained.tools[0].annotations.openWorldHint, true);
  assert.equal(explained.tools[0].declaredAnnotations.openWorldHint, undefined);
  assert.match(formatExplain(implicitOpenWorld, checkImplicit), /search_web: read tool omits annotations\.openWorldHint/);

  const explicitClosedWorld = normalizeSpec({
    name: 'demo-closed',
    purpose: 'demo',
    tools: [
      {
        name: 'get_workspace_context',
        tier: 'read',
        description: 'Read tenant workspace context',
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
    ],
    skills: [
      {
        name: 'read-workspace',
        description: 'Read workspace context. Use when grounding a session.',
        uses: ['get_workspace_context'],
      },
    ],
  });
  assert.equal(explicitClosedWorld.tools[0].annotations.openWorldHint, false);
  assert.equal(explicitClosedWorld.tools[0].declaredAnnotations.openWorldHint, false);
  const checkClosed = checkSpec(explicitClosedWorld);
  assert.equal(checkClosed.ok, true);
  assert.equal(checkClosed.warnings.length, 0, checkClosed.warnings.join('; '));
});

test('accepts valid MCP 2026-07-28 tool names (dots and up to 128 chars) while keeping skill names strict (#8)', () => {
  assert.equal(validateToolName('admin.tools.list'), null);
  assert.equal(validateToolName('DATA_EXPORT_v2'), null);
  assert.equal(validateToolName('a'.repeat(65)), null);
  assert.equal(validateToolName('a'.repeat(128)), null);

  assert.match(validateToolName('a'.repeat(129)), /longer than 128 characters/);
  assert.match(validateToolName('admin tools'), /ASCII letters, digits, underscores, hyphens or dots/);
  assert.match(validateToolName('admin/tools'), /ASCII letters, digits, underscores, hyphens or dots/);
  assert.match(validateToolName('admin@tools'), /ASCII letters, digits, underscores, hyphens or dots/);

  // Skill names remain strictly Agent Skills compliant (1-64 chars, lowercase a-z0-9-)
  assert.match(validateSkillName('admin.tools.list'), /lowercase ASCII letters, digits and single hyphens/);
  assert.match(validateSkillName('a'.repeat(65)), /longer than 64 characters/);

  const spec = normalizeSpec({
    name: 'mcp-names',
    purpose: 'demo',
    tools: [
      {
        name: 'admin.tools.list',
        tier: 'read',
        description: 'List admin tools',
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
    ],
    skills: [
      {
        name: 'admin-list',
        description: 'List admin tools. Use when inspecting admin surface.',
        uses: ['admin.tools.list'],
      },
    ],
  });
  const res = checkSpec(spec);
  assert.equal(res.ok, true, res.errors.join('; '));
  assert.equal(res.warnings.length, 0, res.warnings.join('; '));
});
