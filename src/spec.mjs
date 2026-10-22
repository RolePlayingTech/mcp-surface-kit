import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SPEC_DIR = '.mcp-surface';
export const SPEC_FILE = 'spec.json';
export const TIERS = ['read', 'draft', 'mutate', 'delete'];
export const PHASES = ['prepare', 'confirm'];

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
  return {
    name: String(raw.name || '').trim(),
    purpose: String(raw.purpose || '').trim(),
    transport: String(raw.transport || 'streamable-http').trim(),
    resourceUrl: String(raw.resourceUrl || '').trim(),
    scopes: Array.isArray(raw.scopes) ? raw.scopes.map(String) : [],
    untrustedFields: Array.isArray(raw.untrustedFields) ? raw.untrustedFields.map(String) : [],
    copySkillsTo: Array.isArray(raw.copySkillsTo) ? raw.copySkillsTo.map(String) : [],
    tools: Array.isArray(raw.tools) ? raw.tools.map(normalizeTool) : [],
    skills: Array.isArray(raw.skills) ? raw.skills.map(normalizeSkill) : [],
  };
}

function normalizeTool(tool) {
  const annotations = tool?.annotations && typeof tool.annotations === 'object' ? tool.annotations : {};
  return {
    name: String(tool?.name || '').trim(),
    tier: String(tool?.tier || '').trim(),
    scope: String(tool?.scope || '').trim(),
    phase: String(tool?.phase || '').trim(),
    pair: String(tool?.pair || '').trim(),
    description: String(tool?.description || '').trim(),
    liveInOneCall: Boolean(tool?.liveInOneCall),
    annotations: {
      readOnlyHint: Boolean(annotations.readOnlyHint),
      destructiveHint: Boolean(annotations.destructiveHint),
      idempotentHint: annotations.idempotentHint !== false,
      openWorldHint: Boolean(annotations.openWorldHint),
    },
  };
}

function normalizeSkill(skill) {
  return {
    name: String(skill?.name || '').trim(),
    description: String(skill?.description || '').trim(),
    uses: Array.isArray(skill?.uses) ? skill.uses.map(String) : [],
  };
}
