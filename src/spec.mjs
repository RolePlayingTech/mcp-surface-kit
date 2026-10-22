import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SPEC_DIR = '.mcp-surface';
export const SPEC_FILE = 'spec.json';
export const TIERS = ['read', 'draft', 'mutate', 'delete'];
export const PHASES = ['prepare', 'confirm'];
export const DELETE_GUARDS = ['local_draft_only'];
export const SCOPE_MODELS = ['cumulative', 'independent', 'hierarchy'];
export const ANNOTATION_KEYS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];

export function specPath(dir) {
  return join(dir, SPEC_DIR, SPEC_FILE);
}

export function loadSpec(dir) {
  const raw = JSON.parse(readFileSync(specPath(dir), 'utf8'));
  return normalizeSpec(raw);
}

export function normalizeSpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('spec must be a JSON object');
  }
  const scopeHierarchy = {};
  if (raw.scopeHierarchy && typeof raw.scopeHierarchy === 'object' && !Array.isArray(raw.scopeHierarchy)) {
    for (const [key, implied] of Object.entries(raw.scopeHierarchy)) {
      scopeHierarchy[String(key).trim()] = Array.isArray(implied)
        ? implied.map((item) => String(item).trim()).filter(Boolean)
        : [];
    }
  }
  return {
    name: String(raw.name || '').trim(),
    purpose: String(raw.purpose || '').trim(),
    transport: String(raw.transport || 'streamable-http').trim(),
    resourceUrl: String(raw.resourceUrl || '').trim(),
    scopeModel: String(raw.scopeModel || 'cumulative').trim(),
    scopes: Array.isArray(raw.scopes) ? raw.scopes.map((s) => String(s).trim()) : [],
    scopeHierarchy,
    untrustedFields: Array.isArray(raw.untrustedFields) ? raw.untrustedFields.map((f) => String(f).trim()).filter(Boolean) : [],
    copySkillsTo: Array.isArray(raw.copySkillsTo) ? raw.copySkillsTo.map((d) => String(d).trim()) : [],
    tools: Array.isArray(raw.tools) ? raw.tools.map(normalizeTool) : [],
    skills: Array.isArray(raw.skills) ? raw.skills.map(normalizeSkill) : [],
  };
}

/**
 * Normalizes a tool entry.
 *
 * Official MCP ToolAnnotations specification defaults:
 * - readOnlyHint: false (when omitted, a tool is NOT assumed read-only)
 * - destructiveHint: true when readOnlyHint is false, false when readOnlyHint is true
 * - idempotentHint: false (when omitted, a tool is NEVER assumed idempotent)
 * - openWorldHint: true when readOnlyHint is false, false when readOnlyHint is true
 */
function normalizeTool(tool) {
  const rawAnnotations =
    tool?.annotations && typeof tool.annotations === 'object' && !Array.isArray(tool.annotations)
      ? tool.annotations
      : {};
  const invalidAnnotations = [];
  if (tool?.annotations !== undefined && (!tool.annotations || typeof tool.annotations !== 'object' || Array.isArray(tool.annotations))) {
    invalidAnnotations.push('annotations must be a JSON object');
  } else {
    for (const [key, value] of Object.entries(rawAnnotations)) {
      if (!ANNOTATION_KEYS.includes(key)) {
        invalidAnnotations.push(`unknown annotation "${key}"`);
      } else if (typeof value !== 'boolean') {
        invalidAnnotations.push(`annotation "${key}" must be a boolean`);
      }
    }
  }

  const declaredAnnotations = {
    readOnlyHint: typeof rawAnnotations.readOnlyHint === 'boolean' ? rawAnnotations.readOnlyHint : undefined,
    destructiveHint: typeof rawAnnotations.destructiveHint === 'boolean' ? rawAnnotations.destructiveHint : undefined,
    idempotentHint: typeof rawAnnotations.idempotentHint === 'boolean' ? rawAnnotations.idempotentHint : undefined,
    openWorldHint: typeof rawAnnotations.openWorldHint === 'boolean' ? rawAnnotations.openWorldHint : undefined,
  };

  const readOnlyHint = declaredAnnotations.readOnlyHint ?? false;
  const destructiveHint = declaredAnnotations.destructiveHint ?? !readOnlyHint;
  const idempotentHint = declaredAnnotations.idempotentHint ?? false;
  const openWorldHint = declaredAnnotations.openWorldHint ?? !readOnlyHint;

  const operationScopes = {};
  const invalidOperationScopes = [];
  if (tool?.operationScopes !== undefined) {
    if (!tool.operationScopes || typeof tool.operationScopes !== 'object' || Array.isArray(tool.operationScopes)) {
      invalidOperationScopes.push('operationScopes must be a JSON object mapping operation names to scopes');
    } else {
      for (const [op, scopeVal] of Object.entries(tool.operationScopes)) {
        const opName = String(op).trim();
        const scName = typeof scopeVal === 'string' ? scopeVal.trim() : '';
        if (!opName || !scName) {
          invalidOperationScopes.push(`operationScopes entry "${op}" must map a non-empty operation name to a scope string`);
        } else {
          operationScopes[opName] = scName;
        }
      }
    }
  }

  return {
    name: String(tool?.name || '').trim(),
    tier: String(tool?.tier || '').trim(),
    scope: String(tool?.scope || '').trim(),
    operationScopes,
    phase: String(tool?.phase || '').trim(),
    pair: String(tool?.pair || '').trim(),
    guard: String(tool?.guard || '').trim(),
    description: String(tool?.description || '').trim(),
    liveInOneCall: Boolean(tool?.liveInOneCall),
    annotations: {
      readOnlyHint,
      destructiveHint,
      idempotentHint,
      openWorldHint,
    },
    declaredAnnotations,
    invalidAnnotations,
    invalidOperationScopes,
  };
}

function normalizeSkill(skill) {
  return {
    name: String(skill?.name || '').trim(),
    description: String(skill?.description || '').replace(/\r\n?/g, '\n').trim(),
    uses: Array.isArray(skill?.uses) ? skill.uses.map((u) => String(u).trim()) : [],
  };
}
