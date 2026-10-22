import { normalizeRelPath, validateCopyTarget, validateSkillName, validateToolName } from './fs-safe.mjs';
import { DELETE_GUARDS, PHASES, SCOPE_MODELS, TIERS } from './spec.mjs';

const USE_WHEN = /use when|używaj, gdy|używać, gdy/i;
const MULTI_AGENT_SKILL_DIRS = new Set(['.agents/skills', '.claude/skills', '.cursor/skills']);

function hasHierarchyCycle(hierarchy) {
  const visiting = new Set();
  const visited = new Set();
  function dfs(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of hierarchy[node] || []) {
      if (dfs(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  for (const key of Object.keys(hierarchy)) {
    if (dfs(key)) return true;
  }
  return false;
}

export function checkSpec(spec) {
  const errors = [];
  const warnings = [];
  if (!spec.name) errors.push('spec.name is required.');
  if (!spec.purpose) errors.push('spec.purpose is required (one sentence).');
  if (!spec.tools.length) errors.push('spec.tools must list at least one tool.');

  if (!SCOPE_MODELS.includes(spec.scopeModel)) {
    errors.push(`spec.scopeModel must be one of ${SCOPE_MODELS.join(', ')}`);
  }

  const seenScopes = new Set();
  for (const scope of spec.scopes) {
    if (!scope) {
      errors.push('spec.scopes cannot contain empty strings');
      continue;
    }
    if (seenScopes.has(scope)) {
      errors.push(`duplicate scope in spec.scopes: ${scope}`);
    }
    seenScopes.add(scope);
  }

  if (spec.scopeHierarchy && Object.keys(spec.scopeHierarchy).length > 0) {
    for (const [parent, implied] of Object.entries(spec.scopeHierarchy)) {
      if (!seenScopes.has(parent)) {
        errors.push(`spec.scopeHierarchy key "${parent}" is not in spec.scopes`);
      }
      for (const child of implied) {
        if (!seenScopes.has(child)) {
          errors.push(`spec.scopeHierarchy["${parent}"] references unknown scope "${child}"`);
        }
        if (child === parent) {
          errors.push(`spec.scopeHierarchy["${parent}"] cannot reference itself`);
        }
      }
    }
    if (hasHierarchyCycle(spec.scopeHierarchy)) {
      errors.push('spec.scopeHierarchy contains a cycle');
    }
  }

  const seenCopyTargets = new Set();
  const overlappingAgentDirs = [];
  for (const dest of spec.copySkillsTo) {
    const targetErr = validateCopyTarget(dest);
    if (targetErr) {
      errors.push(targetErr);
      continue;
    }
    const normalized = normalizeRelPath(dest);
    if (seenCopyTargets.has(normalized)) {
      errors.push(`duplicate copySkillsTo target: ${normalized}`);
    }
    seenCopyTargets.add(normalized);
    if (MULTI_AGENT_SKILL_DIRS.has(normalized)) {
      overlappingAgentDirs.push(normalized);
    }
  }
  if (overlappingAgentDirs.length > 1) {
    warnings.push(
      `copySkillsTo lists multiple shared agent skill directories (${overlappingAgentDirs.join(', ')}); hosts like Cursor read both .agents/skills and .claude/skills and will list each skill twice`
    );
  }

  const byName = new Map();
  for (const tool of spec.tools) {
    const nameErr = validateToolName(tool.name);
    if (nameErr) {
      errors.push(nameErr);
      if (!tool.name) continue;
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
    for (const msg of tool.invalidAnnotations || []) {
      errors.push(`${tool.name}: ${msg}`);
    }
    for (const msg of tool.invalidOperationScopes || []) {
      errors.push(`${tool.name}: ${msg}`);
    }

    const declared = tool.declaredAnnotations || {};

    if (tool.tier === 'read') {
      if (declared.readOnlyHint !== true || !tool.annotations.readOnlyHint) {
        errors.push(`${tool.name}: read tools must set annotations.readOnlyHint=true`);
      }
      if (declared.destructiveHint === true) {
        errors.push(`${tool.name}: read tools cannot set annotations.destructiveHint=true`);
      }
      if (declared.openWorldHint === undefined) {
        warnings.push(
          `${tool.name}: read tool omits annotations.openWorldHint (MCP defaults it to true); set openWorldHint=false for closed-world tenant reads or openWorldHint=true for external/web reads`
        );
      }
      if (tool.phase || tool.pair) {
        errors.push(`${tool.name}: read tools cannot set phase or pair`);
      }
      if (tool.guard) {
        errors.push(`${tool.name}: read tools cannot set guard`);
      }
    } else if (TIERS.includes(tool.tier)) {
      if (tool.annotations.readOnlyHint) {
        errors.push(`${tool.name}: non-read tools cannot set readOnlyHint=true`);
      }
    }

    if (tool.tier === 'draft') {
      if (declared.destructiveHint !== false) {
        errors.push(
          `${tool.name}: draft tools must explicitly set annotations.destructiveHint=false (MCP defaults omitted destructiveHint to true)`
        );
      }
      if (declared.openWorldHint !== false) {
        errors.push(
          `${tool.name}: draft tools must explicitly set annotations.openWorldHint=false (external/open-world writes belong in mutate)`
        );
      }
      if (tool.phase || tool.pair) {
        errors.push(`${tool.name}: draft tools cannot set phase or pair`);
      }
      if (tool.guard) {
        errors.push(`${tool.name}: draft tools cannot set guard`);
      }
      if (declared.idempotentHint !== true) {
        warnings.push(
          `${tool.name}: annotations.idempotentHint is not true; draft tools should be idempotent so retries do not duplicate drafts`
        );
      }
    }

    if (tool.tier === 'mutate') {
      if (tool.guard) {
        errors.push(`${tool.name}: mutate tools must use a prepare/confirm pair rather than guard`);
      }
      if (!PHASES.includes(tool.phase)) {
        errors.push(`${tool.name}: mutate tools need phase prepare|confirm`);
      }
      if (!tool.pair) {
        errors.push(`${tool.name}: mutate tools need pair`);
      } else if (tool.pair === tool.name) {
        errors.push(`${tool.name}: cannot pair a tool with itself`);
      }
      if (declared.destructiveHint === false) {
        errors.push(
          `${tool.name}: mutate tools cannot set annotations.destructiveHint=false (use tier="draft" for additive non-destructive writes)`
        );
      } else if (declared.destructiveHint === undefined) {
        warnings.push(`${tool.name}: mutate tools should explicitly set annotations.destructiveHint=true`);
      }
      if (declared.idempotentHint !== true) {
        warnings.push(`${tool.name}: annotations.idempotentHint is not true; prepare/confirm calls should be idempotent on retry`);
      }
    }

    if (tool.tier === 'delete') {
      if (declared.destructiveHint !== true) {
        errors.push(`${tool.name}: delete tools must explicitly set annotations.destructiveHint=true`);
      }
      const isPaired = Boolean(tool.phase || tool.pair);
      if (isPaired) {
        if (tool.guard) {
          errors.push(`${tool.name}: paired delete tools cannot also set guard`);
        }
        if (!PHASES.includes(tool.phase)) {
          errors.push(`${tool.name}: paired delete tools need phase prepare|confirm`);
        }
        if (!tool.pair) {
          errors.push(`${tool.name}: paired delete tools need pair`);
        } else if (tool.pair === tool.name) {
          errors.push(`${tool.name}: cannot pair a tool with itself`);
        }
      } else {
        if (!DELETE_GUARDS.includes(tool.guard)) {
          errors.push(
            `${tool.name}: delete tools must either form a prepare/confirm pair or set guard="local_draft_only" with annotations.openWorldHint=false`
          );
        }
        if (declared.openWorldHint !== false) {
          errors.push(
            `${tool.name}: delete tools without a prepare/confirm pair must explicitly set annotations.openWorldHint=false`
          );
        }
      }
      if (declared.idempotentHint !== true) {
        warnings.push(`${tool.name}: annotations.idempotentHint is not true; delete tools should be idempotent on retry`);
      }
    }

    if (spec.scopes.length > 0) {
      const opEntries = Object.entries(tool.operationScopes || {});
      if (!tool.scope && opEntries.length === 0) {
        errors.push(`${tool.name}: scope (or operationScopes) is required when spec.scopes is declared`);
      }
      if (tool.scope && !seenScopes.has(tool.scope)) {
        errors.push(`${tool.name}: scope ${tool.scope} is not in spec.scopes`);
      }
      for (const [op, opScope] of opEntries) {
        if (!seenScopes.has(opScope)) {
          errors.push(`${tool.name}: operationScopes.${op} scope ${opScope} is not in spec.scopes`);
        }
      }

      if (spec.scopeModel === 'cumulative' && spec.scopes.length >= 2) {
        const baseScope = spec.scopes[0];
        if (tool.tier === 'read' && tool.scope && tool.scope !== baseScope) {
          warnings.push(`${tool.name}: read tool requires scope "${tool.scope}" above baseline read scope "${baseScope}"`);
        }
        if (tool.tier !== 'read' && TIERS.includes(tool.tier)) {
          const allToolScopes = [tool.scope, ...opEntries.map(([, s]) => s)].filter(Boolean);
          if (allToolScopes.includes(baseScope)) {
            errors.push(`${tool.name}: ${tool.tier} tools cannot use baseline read-only scope "${baseScope}"`);
          }
        }
        if (tool.scope && opEntries.length > 0 && seenScopes.has(tool.scope)) {
          const validOpScopes = opEntries.map(([, s]) => s).filter((s) => seenScopes.has(s));
          if (validOpScopes.length > 0) {
            const minIdx = Math.min(...validOpScopes.map((s) => spec.scopes.indexOf(s)));
            const expectedMinScope = spec.scopes[minIdx];
            if (tool.scope !== expectedMinScope) {
              errors.push(
                `${tool.name}: scope "${tool.scope}" must match the minimum scope in operationScopes ("${expectedMinScope}")`
              );
            }
          }
        }
      }

      const publishScope = spec.scopes.find((s) => /(?:^|:)publish$/i.test(s));
      if (
        publishScope &&
        (tool.tier === 'mutate' || tool.tier === 'delete') &&
        /\bpublish(?:_now|ing)?\b/i.test(tool.description)
      ) {
        const coveredScopes = new Set([tool.scope, ...opEntries.map(([, s]) => s)].filter(Boolean));
        if (!coveredScopes.has(publishScope)) {
          errors.push(
            `${tool.name}: description includes publish actions, which require "${publishScope}"; set scope="${publishScope}" or declare operationScopes mapping publish operations to "${publishScope}"`
          );
        }
      }
    }
  }

  for (const tool of spec.tools) {
    if (!['mutate', 'delete'].includes(tool.tier) || !tool.pair || tool.pair === tool.name) continue;
    const partner = byName.get(tool.pair);
    if (!partner) {
      errors.push(`${tool.name}: pair ${tool.pair} does not exist`);
      continue;
    }
    if (partner.tier !== tool.tier) {
      errors.push(`${tool.name}: pair ${tool.pair} is not a ${tool.tier} tool`);
    }
    if (partner.pair !== tool.name) {
      errors.push(`${tool.name}: pair ${tool.pair} does not point back`);
    }
    if (tool.phase && partner.phase && tool.phase === partner.phase) {
      errors.push(`${tool.name} and ${tool.pair} cannot share phase ${tool.phase}`);
    }
    if (tool.phase === 'prepare' && partner.phase === 'confirm' && partner.pair === tool.name) {
      const toolOps = JSON.stringify(Object.entries(tool.operationScopes || {}).sort());
      const partnerOps = JSON.stringify(Object.entries(partner.operationScopes || {}).sort());
      if (tool.scope !== partner.scope || toolOps !== partnerOps) {
        errors.push(`${tool.name} and ${partner.name} must declare matching scope and operationScopes`);
      }
    }
  }

  const covered = new Set();
  const seenSkills = new Set();
  for (const skill of spec.skills) {
    const skillNameErr = validateSkillName(skill.name);
    if (skillNameErr) {
      errors.push(skillNameErr);
    } else if (seenSkills.has(skill.name)) {
      errors.push(`duplicate skill name: ${skill.name}`);
    }
    if (skill.name) seenSkills.add(skill.name);

    const label = skill.name || 'skill';
    if (!skill.description) {
      errors.push(`${label}: description is required`);
    } else {
      if (!USE_WHEN.test(skill.description)) {
        errors.push(`${label}: description must say when to use it ("Use when …")`);
      }
      if (skill.description.length > 1024) {
        errors.push(`${label}: description longer than 1024 characters`);
      }
      if (/[<>]/.test(skill.description)) {
        errors.push(`${label}: description cannot contain XML/HTML angle brackets (< or >)`);
      }
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(skill.description)) {
        errors.push(`${label}: description cannot contain control characters`);
      }
    }

    if (!skill.uses.length) {
      errors.push(`${label}: uses must list at least one tool`);
    }

    const usedInSkill = new Map();
    skill.uses.forEach((name, idx) => {
      if (!byName.has(name)) {
        errors.push(`${label}: uses unknown tool ${name}`);
      } else if (usedInSkill.has(name)) {
        errors.push(`${label}: duplicate tool ${name} in uses`);
      } else {
        usedInSkill.set(name, idx);
        covered.add(name);
      }
    });

    for (const [name, idx] of usedInSkill.entries()) {
      const tool = byName.get(name);
      if (!tool || !['mutate', 'delete'].includes(tool.tier) || !tool.pair) continue;
      if (tool.phase === 'confirm') {
        const prepIdx = usedInSkill.get(tool.pair);
        if (prepIdx === undefined) {
          errors.push(`${label}: uses confirm tool ${tool.name} without its prepare partner ${tool.pair}`);
        } else if (prepIdx > idx) {
          errors.push(`${label}: uses confirm tool ${tool.name} before its prepare partner ${tool.pair}`);
        }
      } else if (tool.phase === 'prepare' && !usedInSkill.has(tool.pair)) {
        warnings.push(`${label}: uses prepare tool ${tool.name} without its confirm partner ${tool.pair}`);
      }
    }
  }

  for (const tool of spec.tools) {
    const isGated = tool.tier === 'mutate' || (tool.tier === 'delete' && Boolean(tool.pair));
    if (isGated && !covered.has(tool.name)) {
      warnings.push(`${tool.name}: gated tool is not referenced by any skill`);
    }
  }

  const unused = spec.tools.filter((tool) => {
    const isGated = tool.tier === 'mutate' || (tool.tier === 'delete' && Boolean(tool.pair));
    return !isGated && !covered.has(tool.name);
  });
  for (const tool of unused) {
    warnings.push(`${tool.name}: no skill lists this tool in uses`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
