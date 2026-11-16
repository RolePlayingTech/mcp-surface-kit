import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkSpec } from '../src/check.mjs';
import { explainData, formatExplain } from '../src/explain.mjs';
import { validateSkillName, validateToolName } from '../src/fs-safe.mjs';
import { loadSpec, normalizeSpec } from '../src/spec.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('example content-workspace spec passes with zero errors and zero warnings and separates publishing from draft deletion (#16)', () => {
  const spec = loadSpec(join(root, 'examples/content-workspace'));
  const result = checkSpec(spec);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0, result.warnings.join('; '));

  assert.deepEqual(
    spec.skills.map((s) => s.name),
    ['publish-content', 'delete-draft']
  );
  const publishSkill = spec.skills.find((s) => s.name === 'publish-content');
  assert.ok(publishSkill);
  assert.equal(publishSkill.uses.includes('delete_publication_draft'), false);
  assert.deepEqual(publishSkill.uses, [
    'get_workspace_context',
    'get_content_strategy',
    'preview_schedule',
    'create_publication_draft',
    'prepare_publication_action',
    'confirm_publication_action',
  ]);

  const deleteSkill = spec.skills.find((s) => s.name === 'delete-draft');
  assert.ok(deleteSkill);
  assert.deepEqual(deleteSkill.uses, ['get_workspace_context', 'delete_publication_draft']);
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


test('rejects unknown and misspelled fields at root, product, tools, annotations, and skills while allowing x-* extensions (#10)', () => {
  const withUnsupportedFields = normalizeSpec({
    version: 1,
    name: 'field-notes',
    purpose: 'Release notes service',
    untrustedContent: ['caption'],
    copySkillTo: ['.claude/skills'],
    product: {
      untrustedContent: ['note_markdown'],
    },
    tools: [
      {
        name: 'list_notes',
        tier: 'read',
        description: 'List notes',
        annotation: { readOnlyHint: true, openWorldHint: false },
      },
      {
        name: 'create_note_draft',
        tier: 'draft',
        requiresIdempotencyKey: true,
        description: 'Save draft',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
          readOnly: false,
        },
      },
    ],
    skills: [
      {
        name: 'publish-notes',
        description: 'Draft notes. Use when writing release notes.',
        uses: ['list_notes', 'create_note_draft'],
        steps: ['Call list_notes first', 'Call create_note_draft second'],
      },
    ],
  });

  const res = checkSpec(withUnsupportedFields);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('unknown field "version"')));
  assert.ok(res.errors.some((e) => e.includes('unknown field "untrustedContent"') && e.includes('untrustedFields')));
  assert.ok(res.errors.some((e) => e.includes('unknown field "copySkillTo"') && e.includes('copySkillsTo')));
  assert.ok(res.errors.some((e) => e.includes('unknown field "product"')));
  assert.ok(res.errors.some((e) => e.includes('unknown field "product.untrustedContent"') && e.includes('untrustedFields')));
  assert.ok(res.errors.some((e) => e.includes('list_notes: unknown field "tools[0].annotation"') && e.includes('annotations')));
  assert.ok(
    res.errors.some(
      (e) =>
        e.includes('create_note_draft: unknown field "tools[1].requiresIdempotencyKey"') &&
        e.includes('annotations.idempotentHint')
    )
  );
  assert.ok(
    res.errors.some(
      (e) => e.includes('create_note_draft: unknown annotation "tools[1].annotations.readOnly"') && e.includes('readOnlyHint')
    )
  );
  assert.ok(
    res.errors.some((e) => e.includes('publish-notes: unknown field "skills[0].steps"') && e.includes('derived from "uses"'))
  );

  // Namespaced x-* extensions and $schema remain valid
  const withExtensions = normalizeSpec({
    $schema: 'https://example.com/mcp-surface.schema.json',
    'x-version': 1,
    name: 'ext-ok',
    purpose: 'Extension test',
    tools: [
      {
        name: 'get_context',
        tier: 'read',
        description: 'Read context',
        'x-rate-limit': '60/min',
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          'x-audit-level': 'low',
        },
      },
    ],
    skills: [
      {
        name: 'read-context',
        description: 'Read context. Use when grounding a session.',
        uses: ['get_context'],
        'x-owner': 'platform',
      },
    ],
  });
  const extRes = checkSpec(withExtensions);
  assert.equal(extRes.ok, true, extRes.errors.join('; '));
  assert.equal(extRes.warnings.length, 0, extRes.warnings.join('; '));
});

test('validates transport, resourceUrl, operationScopes key syntax, and scopeHierarchy consistency (#13)', () => {
  const invalidTransportAndUrl = normalizeSpec({
    name: 'bad-transport',
    purpose: 'Invalid transport and malformed URL.',
    transport: 'websocket',
    resourceUrl: 'not-a-url',
    scopeModel: 'hierarchy',
    scopes: ['read', 'write'],
    scopeHierarchy: {},
    tools: [
      {
        name: 'prepare_op',
        tier: 'mutate',
        phase: 'prepare',
        pair: 'confirm_op',
        scope: 'write',
        operationScopes: { 'bad key!': 'write' },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'Prepare op',
      },
      {
        name: 'confirm_op',
        tier: 'mutate',
        phase: 'confirm',
        pair: 'prepare_op',
        scope: 'write',
        operationScopes: { 'bad key!': 'write' },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        description: 'Confirm op',
      },
    ],
    skills: [
      {
        name: 'run-op',
        description: 'Run op. Use when requested.',
        uses: ['prepare_op', 'confirm_op'],
      },
    ],
  });
  const res1 = checkSpec(invalidTransportAndUrl);
  assert.equal(res1.ok, false);
  assert.ok(res1.errors.some((e) => e.includes('spec.transport must be one of streamable-http, stdio, sse')));
  assert.ok(res1.errors.some((e) => e.includes('spec.resourceUrl "not-a-url" is not a valid URL')));
  assert.ok(res1.errors.some((e) => e.includes('spec.scopeModel is "hierarchy" but spec.scopeHierarchy is empty')));
  assert.ok(res1.errors.some((e) => e.includes('operationScopes key "bad key!" must match')));

  const cumulativeWithHierarchy = normalizeSpec({
    name: 'mismatch-hierarchy',
    purpose: 'Cumulative model with hierarchy map.',
    transport: 'sse',
    resourceUrl: 'http://mcp.example.com/mcp',
    scopeModel: 'cumulative',
    scopes: ['read', 'write'],
    scopeHierarchy: { write: ['read'] },
    tools: [
      {
        name: 'get_state',
        tier: 'read',
        scope: 'read',
        annotations: { readOnlyHint: true, openWorldHint: false },
        description: 'Read state',
      },
    ],
    skills: [
      {
        name: 'read-state',
        description: 'Read state. Use when inspecting.',
        uses: ['get_state'],
      },
    ],
  });
  const res2 = checkSpec(cumulativeWithHierarchy);
  assert.equal(res2.ok, false);
  assert.ok(res2.errors.some((e) => e.includes('spec.scopeHierarchy is only valid when spec.scopeModel is "hierarchy"')));
  assert.ok(res2.warnings.some((w) => w.includes('spec.transport "sse" is deprecated')));
  assert.ok(res2.warnings.some((w) => w.includes('plaintext http:// on non-loopback host')));

  // Loopback http:// for local dev does not warn, whereas stdio + resourceUrl warns
  const loopbackHttp = normalizeSpec({
    name: 'local-dev',
    purpose: 'Local loopback MCP.',
    transport: 'streamable-http',
    resourceUrl: 'http://127.0.0.1:8902/mcp',
    tools: [
      {
        name: 'get_state',
        tier: 'read',
        annotations: { readOnlyHint: true, openWorldHint: false },
        description: 'Read state',
      },
    ],
    skills: [
      {
        name: 'read-state',
        description: 'Read state. Use when inspecting.',
        uses: ['get_state'],
      },
    ],
  });
  const res3 = checkSpec(loopbackHttp);
  assert.equal(res3.ok, true, res3.errors.join('; '));
  assert.equal(res3.warnings.length, 0, res3.warnings.join('; '));

  const stdioWithUrl = normalizeSpec({
    ...loopbackHttp,
    transport: 'stdio',
    resourceUrl: 'https://mcp.example.com/mcp',
  });
  const res4 = checkSpec(stdioWithUrl);
  assert.equal(res4.ok, true);
  assert.ok(res4.warnings.some((w) => w.includes('spec.resourceUrl is set while spec.transport is "stdio"')));
});

test('rejects wrong JSON value types on scopes, untrustedFields, tool.scope, liveInOneCall, and skills.uses (#15)', () => {
  const spec = normalizeSpec({
    name: 'bad-types',
    purpose: 'Demonstrate rejection of non-string scope declarations.',
    scopeModel: 'cumulative',
    scopes: ['read', 123],
    untrustedFields: [false],
    copySkillsTo: [42],
    tools: [
      {
        name: 'get_state',
        tier: 'read',
        scope: 'read',
        liveInOneCall: 'false',
        description: 'Read workspace state.',
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      {
        name: 'create_draft',
        tier: 'draft',
        scope: 123,
        description: 'Save a draft only.',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ],
    skills: [
      {
        name: 'create-draft',
        description: 'Read state and save a draft. Use when the user requests a draft.',
        uses: ['get_state', 'create_draft', 999],
      },
    ],
  });

  const res = checkSpec(spec);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('spec.scopes[1] must be a string (got number)')));
  assert.ok(res.errors.some((e) => e.includes('spec.untrustedFields[0] must be a string (got boolean)')));
  assert.ok(res.errors.some((e) => e.includes('spec.copySkillsTo[0] must be a string (got number)')));
  assert.ok(res.errors.some((e) => e.includes('get_state: tools[0].liveInOneCall must be a boolean (got string)')));
  assert.ok(res.errors.some((e) => e.includes('create_draft: tools[1].scope must be a string (got number)')));
  assert.ok(res.errors.some((e) => e.includes('create-draft: skills[0].uses[2] must be a string (got number)')));
});
