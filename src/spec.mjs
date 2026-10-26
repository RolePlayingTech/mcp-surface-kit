import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SPEC_DIR = '.mcp-surface';
export const SPEC_FILE = 'spec.json';
export const TIERS = ['read', 'draft', 'mutate', 'delete'];
export const PHASES = ['prepare', 'confirm'];
export const DELETE_GUARDS = ['local_draft_only'];
export const SCOPE_MODELS = ['cumulative', 'independent', 'hierarchy'];
export const ROOT_KEYS = [
  '$schema',
  'name',
  'purpose',
  'transport',
  'resourceUrl',
  'scopeModel',
  'scopes',
  'scopeHierarchy',
  'untrustedFields',
  'copySkillsTo',
  'tools',
  'skills',
];
export const TOOL_KEYS = [
  'name',
  'tier',
  'scope',
  'operationScopes',
  'phase',
  'pair',
  'guard',
  'description',
  'liveInOneCall',
  'annotations',
];
export const ANNOTATION_KEYS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];
export const SKILL_KEYS = ['name', 'description', 'uses'];
export const EXTENSION_KEY_RE = /^x-[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function isExtensionKey(key) {
  return EXTENSION_KEY_RE.test(String(key));
}

const KNOWN_KEY_SUGGESTIONS = {
  root: {
    product:
      'nested "product" object is not supported; place "name", "purpose", "scopes", "scopeModel", and "untrustedFields" at the root of spec.json',
    untrustedContent: 'did you mean "untrustedFields"?',
    untrusted: 'did you mean "untrustedFields"?',
    untrustedData: 'did you mean "untrustedFields"?',
    summary: 'did you mean "purpose"?',
    description: 'did you mean "purpose"?',
    version: 'root "version" is not supported; use "x-*" for custom metadata',
    specVersion: 'root "specVersion" is not supported; use "x-*" for custom metadata',
    copySkillTo: 'did you mean "copySkillsTo"?',
    skillsDir: 'did you mean "copySkillsTo"?',
    skillTargets: 'did you mean "copySkillsTo"?',
  },
  product: {
    name: 'use top-level "name"',
    summary: 'use top-level "purpose"',
    description: 'use top-level "purpose"',
    purpose: 'use top-level "purpose"',
    scopes: 'use top-level "scopes"',
    scopeModel: 'use top-level "scopeModel"',
    untrustedContent: 'use top-level "untrustedFields"',
    untrustedFields: 'use top-level "untrustedFields"',
    transport: 'use top-level "transport"',
    resourceUrl: 'use top-level "resourceUrl"',
  },
  tool: {
    annotation: 'did you mean "annotations"?',
    hints: 'did you mean "annotations"?',
    requiresIdempotencyKey:
      '"requiresIdempotencyKey" is not supported; set "annotations.idempotentHint": true and state idempotency requirements in "description"',
    idempotent:
      '"idempotent" is not supported on tool root; set "annotations.idempotentHint": true and state idempotency requirements in "description"',
    idempotencyKey:
      '"idempotencyKey" is not supported; set "annotations.idempotentHint": true and state idempotency requirements in "description"',
    scopes: 'did you mean "scope" or "operationScopes"?',
    requiredScope: 'did you mean "scope" or "operationScopes"?',
    operationScope: 'did you mean "operationScopes"?',
    partner: 'did you mean "pair"?',
    pairedWith: 'did you mean "pair"?',
    readOnlyHint: 'move "readOnlyHint" inside "annotations"',
    destructiveHint: 'move "destructiveHint" inside "annotations"',
    idempotentHint: 'move "idempotentHint" inside "annotations"',
    openWorldHint: 'move "openWorldHint" inside "annotations"',
  },
  annotations: {
    readOnly: 'did you mean "readOnlyHint"?',
    readonly: 'did you mean "readOnlyHint"?',
    destructive: 'did you mean "destructiveHint"?',
    idempotent: 'did you mean "idempotentHint"?',
    openWorld: 'did you mean "openWorldHint"?',
    openworld: 'did you mean "openWorldHint"?',
  },
  skill: {
    steps:
      '"steps" is not supported; generated SKILL.md workflow steps are derived from "uses" and each referenced tool\'s description',
    workflow:
      '"workflow" is not supported; generated SKILL.md workflow steps are derived from "uses" and each referenced tool\'s description',
    instructions:
      '"instructions" is not supported; generated SKILL.md workflow steps are derived from "uses" and each referenced tool\'s description',
    tools: 'did you mean "uses"?',
    toolNames: 'did you mean "uses"?',
    summary: 'did you mean "description"?',
    purpose: 'did you mean "description"?',
  },
};

function editDistance(a, b) {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const dp = Array.from({ length: s.length + 1 }, (_, i) => i);
  for (let j = 1; j <= t.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= s.length; i++) {
      const temp = dp[i];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[s.length];
}

function suggestForUnknownKey(key, allowedKeys, context) {
  const table = KNOWN_KEY_SUGGESTIONS[context] || {};
  if (Object.hasOwn(table, key)) {
    return table[key];
  }
  let bestKey = null;
  let bestDist = Infinity;
  for (const candidate of allowedKeys) {
    if (candidate === '$schema') continue;
    const dist = editDistance(key, candidate);
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = candidate;
    }
  }
  if (bestKey && bestDist <= 3) {
    return `did you mean "${bestKey}"?`;
  }
  return `allowed keys: ${allowedKeys.filter((k) => k !== '$schema').join(', ')}, or "x-*" extensions`;
}

export function specPath(dir) {
  return join(dir, SPEC_DIR, SPEC_FILE);
}

export function loadSpec(dir) {
  const raw = JSON.parse(readFileSync(specPath(dir), 'utf8').replace(/^\uFEFF/, ''));
  return normalizeSpec(raw);
}

export function normalizeSpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('spec must be a JSON object');
  }
  const invalidFields = [];
  for (const key of Object.keys(raw)) {
    if (!ROOT_KEYS.includes(key) && !isExtensionKey(key)) {
      const hint = suggestForUnknownKey(key, ROOT_KEYS, 'root');
      invalidFields.push(`unknown field "${key}" (${hint})`);
      if (key === 'product' && raw.product && typeof raw.product === 'object' && !Array.isArray(raw.product)) {
        for (const subKey of Object.keys(raw.product)) {
          if (!isExtensionKey(subKey)) {
            const subHint = suggestForUnknownKey(subKey, ROOT_KEYS, 'product');
            invalidFields.push(`unknown field "product.${subKey}" (${subHint})`);
          }
        }
      }
    }
  }

  if (raw.scopes !== undefined && !Array.isArray(raw.scopes)) {
    invalidFields.push('spec.scopes must be an array of scope strings');
  }
  if (
    raw.scopeHierarchy !== undefined &&
    (!raw.scopeHierarchy || typeof raw.scopeHierarchy !== 'object' || Array.isArray(raw.scopeHierarchy))
  ) {
    invalidFields.push('spec.scopeHierarchy must be a JSON object mapping parent scopes to implied scope arrays');
  }
  if (raw.untrustedFields !== undefined && !Array.isArray(raw.untrustedFields)) {
    invalidFields.push('spec.untrustedFields must be an array of field names');
  }
  if (raw.copySkillsTo !== undefined && !Array.isArray(raw.copySkillsTo)) {
    invalidFields.push('spec.copySkillsTo must be an array of relative directory paths');
  }
  if (raw.tools !== undefined && !Array.isArray(raw.tools)) {
    invalidFields.push('spec.tools must be an array of tool objects');
  }
  if (raw.skills !== undefined && !Array.isArray(raw.skills)) {
    invalidFields.push('spec.skills must be an array of skill objects');
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
    tools: Array.isArray(raw.tools) ? raw.tools.map((tool, index) => normalizeTool(tool, index)) : [],
    skills: Array.isArray(raw.skills) ? raw.skills.map((skill, index) => normalizeSkill(skill, index)) : [],
    invalidFields,
  };
}

/**
 * Normalizes a tool entry.
 *
 * Official MCP ToolAnnotations specification defaults (2026-07-28):
 * - readOnlyHint: false (when omitted, a tool is NOT assumed read-only)
 * - destructiveHint: true (when omitted, defaults to true in the MCP schema; meaningful when readOnlyHint is false)
 * - idempotentHint: false (when omitted, a tool is NEVER assumed idempotent)
 * - openWorldHint: true (when omitted, defaults to true regardless of readOnlyHint, e.g. read-only web search)
 */
function normalizeTool(tool, index = 0) {
  const invalidFields = [];
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
    invalidFields.push(`tools[${index}] must be a JSON object`);
  } else {
    for (const key of Object.keys(tool)) {
      if (!TOOL_KEYS.includes(key) && !isExtensionKey(key)) {
        const hint = suggestForUnknownKey(key, TOOL_KEYS, 'tool');
        invalidFields.push(`unknown field "tools[${index}].${key}" (${hint})`);
      }
    }
  }

  const rawAnnotations =
    tool?.annotations && typeof tool.annotations === 'object' && !Array.isArray(tool.annotations)
      ? tool.annotations
      : {};
  const invalidAnnotations = [];
  if (tool?.annotations !== undefined && (!tool.annotations || typeof tool.annotations !== 'object' || Array.isArray(tool.annotations))) {
    invalidAnnotations.push('annotations must be a JSON object');
  } else {
    for (const [key, value] of Object.entries(rawAnnotations)) {
      if (isExtensionKey(key)) continue;
      if (!ANNOTATION_KEYS.includes(key)) {
        const hint = suggestForUnknownKey(key, ANNOTATION_KEYS, 'annotations');
        invalidAnnotations.push(`unknown annotation "tools[${index}].annotations.${key}" (${hint})`);
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
  const destructiveHint = declaredAnnotations.destructiveHint ?? true;
  const idempotentHint = declaredAnnotations.idempotentHint ?? false;
  const openWorldHint = declaredAnnotations.openWorldHint ?? true;

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
    invalidFields,
    invalidAnnotations,
    invalidOperationScopes,
  };
}

function normalizeSkill(skill, index = 0) {
  const invalidFields = [];
  if (!skill || typeof skill !== 'object' || Array.isArray(skill)) {
    invalidFields.push(`skills[${index}] must be a JSON object`);
  } else {
    for (const key of Object.keys(skill)) {
      if (!SKILL_KEYS.includes(key) && !isExtensionKey(key)) {
        const hint = suggestForUnknownKey(key, SKILL_KEYS, 'skill');
        invalidFields.push(`unknown field "skills[${index}].${key}" (${hint})`);
      }
    }
    if (skill.uses !== undefined && !Array.isArray(skill.uses)) {
      invalidFields.push(`skills[${index}].uses must be an array of tool names`);
    }
  }
  return {
    name: String(skill?.name || '').trim(),
    description: String(skill?.description || '').replace(/\r\n?/g, '\n').trim(),
    uses: Array.isArray(skill?.uses) ? skill.uses.map((u) => String(u).trim()) : [],
    invalidFields,
  };
}
