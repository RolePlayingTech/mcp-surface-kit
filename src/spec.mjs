import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SPEC_DIR = '.mcp-surface';
export const SPEC_FILE = 'spec.json';
export const TIERS = ['read', 'draft', 'mutate', 'delete'];
export const PHASES = ['prepare', 'confirm'];
export const DELETE_GUARDS = ['local_draft_only'];
export const SCOPE_MODELS = ['cumulative', 'independent', 'hierarchy'];
export const TRANSPORTS = ['streamable-http', 'stdio', 'sse'];
export const OPERATION_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
export const ROOT_KEYS = [
  '$schema',
  'name',
  'purpose',
  'transport',
  'resourceUrl',
  'scopeModel',
  'delegatedApprovalMode',
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
  'delegatedApprovalMode',
  'liveInOneCall',
  'annotations',
];
export const ANNOTATION_KEYS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];
export const SKILL_KEYS = ['name', 'description', 'uses'];
export const EXTENSION_KEY_RE = /^x-[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function isExtensionKey(key) {
  return EXTENSION_KEY_RE.test(String(key));
}

function typeLabel(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
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

function normalizeStringField(obj, key, pathLabel, invalidFields, defaultValue = '') {
  const value = obj?.[key];
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string') {
    invalidFields.push(`${pathLabel} must be a string (got ${typeLabel(value)})`);
    return defaultValue;
  }
  return value.trim();
}

function normalizeStringArray(arr, pathLabel, invalidFields, { dropEmpty = false } = {}) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (typeof item !== 'string') {
      invalidFields.push(`${pathLabel}[${i}] must be a string (got ${typeLabel(item)})`);
      continue;
    }
    const trimmed = item.trim();
    if (dropEmpty && !trimmed) continue;
    out.push(trimmed);
  }
  return out;
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

  if (raw.$schema !== undefined && typeof raw.$schema !== 'string') {
    invalidFields.push(`spec.$schema must be a string (got ${typeLabel(raw.$schema)})`);
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
      const trimmedKey = key.trim();
      if (!trimmedKey) {
        invalidFields.push('spec.scopeHierarchy keys must be non-empty scope strings');
        continue;
      }
      if (!Array.isArray(implied)) {
        invalidFields.push(`spec.scopeHierarchy["${key}"] must be an array of scope strings (got ${typeLabel(implied)})`);
        scopeHierarchy[trimmedKey] = [];
        continue;
      }
      scopeHierarchy[trimmedKey] = normalizeStringArray(
        implied,
        `spec.scopeHierarchy["${key}"]`,
        invalidFields,
        { dropEmpty: true }
      );
    }
  }

  const name = normalizeStringField(raw, 'name', 'spec.name', invalidFields, '');
  const purpose = normalizeStringField(raw, 'purpose', 'spec.purpose', invalidFields, '');
  const transport =
    raw.transport === undefined
      ? 'streamable-http'
      : normalizeStringField(raw, 'transport', 'spec.transport', invalidFields, '');
  const resourceUrl = normalizeStringField(raw, 'resourceUrl', 'spec.resourceUrl', invalidFields, '');
  const scopeModel =
    raw.scopeModel === undefined
      ? 'cumulative'
      : normalizeStringField(raw, 'scopeModel', 'spec.scopeModel', invalidFields, '');
  const delegatedApprovalMode = normalizeStringField(
    raw,
    'delegatedApprovalMode',
    'spec.delegatedApprovalMode',
    invalidFields,
    ''
  );
  if (delegatedApprovalMode && !OPERATION_NAME_RE.test(delegatedApprovalMode)) {
    invalidFields.push(
      `spec.delegatedApprovalMode "${delegatedApprovalMode}" must match ^[A-Za-z0-9_.-]{1,64}$`
    );
  }

  return {
    name,
    purpose,
    transport,
    resourceUrl,
    scopeModel,
    delegatedApprovalMode,
    scopes: normalizeStringArray(raw.scopes, 'spec.scopes', invalidFields),
    scopeHierarchy,
    untrustedFields: normalizeStringArray(raw.untrustedFields, 'spec.untrustedFields', invalidFields, {
      dropEmpty: true,
    }),
    copySkillsTo: normalizeStringArray(raw.copySkillsTo, 'spec.copySkillsTo', invalidFields),
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

  const name = normalizeStringField(tool, 'name', `tools[${index}].name`, invalidFields, '');
  const tier = normalizeStringField(tool, 'tier', `tools[${index}].tier`, invalidFields, '');
  const scope = normalizeStringField(tool, 'scope', `tools[${index}].scope`, invalidFields, '');
  const phase = normalizeStringField(tool, 'phase', `tools[${index}].phase`, invalidFields, '');
  const pair = normalizeStringField(tool, 'pair', `tools[${index}].pair`, invalidFields, '');
  const guard = normalizeStringField(tool, 'guard', `tools[${index}].guard`, invalidFields, '');
  const description = normalizeStringField(tool, 'description', `tools[${index}].description`, invalidFields, '');
  const delegatedApprovalMode = normalizeStringField(
    tool,
    'delegatedApprovalMode',
    `tools[${index}].delegatedApprovalMode`,
    invalidFields,
    ''
  );
  if (delegatedApprovalMode && !OPERATION_NAME_RE.test(delegatedApprovalMode)) {
    invalidFields.push(
      `tools[${index}].delegatedApprovalMode "${delegatedApprovalMode}" must match ^[A-Za-z0-9_.-]{1,64}$`
    );
  }

  let liveInOneCall = false;
  if (tool?.liveInOneCall !== undefined) {
    if (typeof tool.liveInOneCall !== 'boolean') {
      invalidFields.push(`tools[${index}].liveInOneCall must be a boolean (got ${typeLabel(tool.liveInOneCall)})`);
    } else {
      liveInOneCall = tool.liveInOneCall;
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
        const opName = op.trim();
        if (!opName || opName !== op || !OPERATION_NAME_RE.test(opName)) {
          invalidOperationScopes.push(
            `operationScopes key "${op}" must match ^[A-Za-z0-9_.-]{1,64}$`
          );
          continue;
        }
        if (typeof scopeVal !== 'string') {
          invalidOperationScopes.push(
            `operationScopes.${opName} must be a scope string (got ${typeLabel(scopeVal)})`
          );
          continue;
        }
        const scName = scopeVal.trim();
        if (!scName) {
          invalidOperationScopes.push(`operationScopes.${opName} must map to a non-empty scope string`);
        } else {
          operationScopes[opName] = scName;
        }
      }
    }
  }

  return {
    name,
    tier,
    scope,
    operationScopes,
    phase,
    pair,
    guard,
    description,
    delegatedApprovalMode,
    liveInOneCall,
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
  const name = normalizeStringField(skill, 'name', `skills[${index}].name`, invalidFields, '');
  const rawDesc = normalizeStringField(skill, 'description', `skills[${index}].description`, invalidFields, '');
  return {
    name,
    description: rawDesc.replace(/\r\n?/g, '\n').trim(),
    uses: normalizeStringArray(skill?.uses, `skills[${index}].uses`, invalidFields),
    invalidFields,
  };
}
