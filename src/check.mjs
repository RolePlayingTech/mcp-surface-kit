import { PHASES, TIERS } from './spec.mjs';

const USE_WHEN = /use when|używaj, gdy|używać, gdy/i;

export function checkSpec(spec) {
  const errors = [];
  const warnings = [];
  if (!spec.name) errors.push('spec.name is required.');
  if (!spec.purpose) errors.push('spec.purpose is required (one sentence).');
  if (!spec.tools.length) errors.push('spec.tools must list at least one tool.');

  const byName = new Map();
  for (const tool of spec.tools) {
    if (!tool.name) {
      errors.push('every tool needs a name');
      continue;
    }
    if (byName.has(tool.name)) errors.push(`duplicate tool name: ${tool.name}`);
    byName.set(tool.name, tool);
    if (!TIERS.includes(tool.tier)) {
      errors.push(`${tool.name}: tier must be one of ${TIERS.join(', ')}`);
    }
    if (!tool.description) errors.push(`${tool.name}: description is required`);
    if (tool.liveInOneCall) {
      errors.push(`${tool.name}: liveInOneCall is not allowed; split preview and commit`);
    }
    if (tool.tier === 'read' && !tool.annotations.readOnlyHint) {
      errors.push(`${tool.name}: read tools must set annotations.readOnlyHint=true`);
    }
    if (tool.tier !== 'read' && tool.annotations.readOnlyHint) {
      errors.push(`${tool.name}: non-read tools cannot set readOnlyHint=true`);
    }
    if (tool.tier === 'mutate') {
      if (!PHASES.includes(tool.phase)) {
        errors.push(`${tool.name}: mutate tools need phase prepare|confirm`);
      }
      if (!tool.pair) errors.push(`${tool.name}: mutate tools need pair`);
    }
    if (spec.scopes.length && tool.scope && !spec.scopes.includes(tool.scope)) {
      errors.push(`${tool.name}: scope ${tool.scope} is not in spec.scopes`);
    }
  }

  for (const tool of spec.tools) {
    if (tool.tier !== 'mutate' || !tool.pair) continue;
    const partner = byName.get(tool.pair);
    if (!partner) {
      errors.push(`${tool.name}: pair ${tool.pair} does not exist`);
      continue;
    }
    if (partner.tier !== 'mutate') {
      errors.push(`${tool.name}: pair ${tool.pair} is not a mutate tool`);
    }
    if (partner.pair !== tool.name) {
      errors.push(`${tool.name}: pair ${tool.pair} does not point back`);
    }
    if (tool.phase === partner.phase) {
      errors.push(`${tool.name} and ${tool.pair} cannot share phase ${tool.phase}`);
    }
  }

  const covered = new Set();
  for (const skill of spec.skills) {
    if (!skill.name) errors.push('every skill needs a name');
    if (!skill.description) errors.push(`${skill.name || 'skill'}: description is required`);
    else if (!USE_WHEN.test(skill.description)) {
      errors.push(`${skill.name}: description must say when to use it ("Use when …")`);
    }
    if (skill.name.length > 64) errors.push(`${skill.name}: name longer than 64 characters`);
    if (skill.description.length > 1024) errors.push(`${skill.name}: description longer than 1024 characters`);
    for (const name of skill.uses) {
      if (!byName.has(name)) errors.push(`${skill.name}: uses unknown tool ${name}`);
      covered.add(name);
    }
  }

  for (const tool of spec.tools) {
    if (tool.tier === 'mutate' && !covered.has(tool.name)) {
      warnings.push(`${tool.name}: gated tool is not referenced by any skill`);
    }
  }

  const unused = spec.tools.filter((tool) => tool.tier !== 'mutate' && !covered.has(tool.name));
  for (const tool of unused) {
    warnings.push(`${tool.name}: no skill lists this tool in uses`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
