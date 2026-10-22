function formatToolScope(tool) {
  const ops = Object.entries(tool.operationScopes || {}).sort(([a], [b]) => a.localeCompare(b));
  if (!ops.length) return tool.scope || '—';
  const opStr = ops.map(([op, sc]) => `${op}:${sc}`).join(', ');
  return tool.scope ? `${tool.scope} (${opStr})` : opStr;
}

export function explainData(spec, check) {
  const coveredSet = new Set();
  for (const skill of spec.skills) {
    for (const toolName of skill.uses) coveredSet.add(toolName);
  }
  const byName = new Map(spec.tools.map((t) => [t.name, t]));
  const pairs = [];
  const seenPairs = new Set();
  for (const tool of spec.tools) {
    if (!['mutate', 'delete'].includes(tool.tier) || !tool.pair) continue;
    const partner = byName.get(tool.pair);
    if (tool.phase === 'prepare' && partner && partner.phase === 'confirm' && partner.pair === tool.name) {
      const key = `${tool.name}->${partner.name}`;
      if (!seenPairs.has(key)) {
        seenPairs.add(key);
        pairs.push({
          tier: tool.tier,
          prepare: tool.name,
          confirm: partner.name,
          scope: tool.scope || null,
          operationScopes: tool.operationScopes || {},
        });
      }
    }
  }
  const uncoveredTools = spec.tools.filter((t) => !coveredSet.has(t.name)).map((t) => t.name);
  return {
    ok: check.ok,
    name: spec.name,
    purpose: spec.purpose,
    transport: spec.transport,
    resourceUrl: spec.resourceUrl || null,
    scopeModel: spec.scopeModel,
    scopes: spec.scopes,
    untrustedFields: spec.untrustedFields,
    tools: spec.tools.map((t) => ({
      name: t.name,
      tier: t.tier,
      phase: t.phase || null,
      pair: t.pair || null,
      guard: t.guard || null,
      scope: t.scope || null,
      operationScopes: t.operationScopes || {},
      annotations: t.annotations,
      declaredAnnotations: t.declaredAnnotations,
      coveredBySkills: spec.skills.filter((s) => s.uses.includes(t.name)).map((s) => s.name),
    })),
    pairs,
    skills: spec.skills.map((s) => ({
      name: s.name,
      description: s.description,
      uses: s.uses,
    })),
    uncoveredTools,
    errors: check.errors,
    warnings: check.warnings,
  };
}

export function formatExplain(spec, check) {
  const data = explainData(spec, check);
  const scopeJoiner = spec.scopeModel === 'cumulative' ? ' ⊂ ' : ', ';
  const lines = [
    `MCP surface: ${spec.name}`,
    spec.purpose,
    spec.resourceUrl ? `Resource: ${spec.resourceUrl} (${spec.transport})` : `Transport: ${spec.transport}`,
    spec.scopes.length ? `Scopes (${spec.scopeModel}): ${spec.scopes.join(scopeJoiner)}` : 'Scopes: (none declared)',
    spec.untrustedFields.length
      ? `Untrusted fields: ${spec.untrustedFields.join(', ')}`
      : 'Untrusted fields: (none declared — add captions/comments/html)',
    '',
    'Tool                          Tier      Phase/Guard       Pair                           Scope',
    '----------------------------  --------  ----------------  -----------------------------  --------------------------',
  ];
  for (const tool of spec.tools) {
    const phaseOrGuard = tool.phase || tool.guard || '—';
    lines.push(
      [
        tool.name.padEnd(28),
        tool.tier.padEnd(8),
        phaseOrGuard.padEnd(16),
        (tool.pair || '—').padEnd(29),
        formatToolScope(tool),
      ].join('  ')
    );
  }

  lines.push('', 'Prepare -> Confirm pairs');
  if (data.pairs.length) {
    for (const pair of data.pairs) {
      const ops = Object.entries(pair.operationScopes).sort(([a], [b]) => a.localeCompare(b));
      const scopeDesc = ops.length
        ? `${pair.scope || 'per-op'} (${ops.map(([op, sc]) => `${op}:${sc}`).join(', ')})`
        : pair.scope || '—';
      lines.push(`  ${pair.prepare} -> ${pair.confirm} [${pair.tier}, scope: ${scopeDesc}]`);
    }
  } else {
    lines.push('  (none)');
  }

  lines.push('', 'Skills');
  if (spec.skills.length) {
    for (const skill of spec.skills) {
      lines.push(`  ${skill.name}: ${skill.description}`);
      lines.push(`    uses: ${skill.uses.join(', ') || '(none)'}`);
    }
  } else {
    lines.push('  (none declared)');
  }

  lines.push('', 'Uncovered tools');
  if (data.uncoveredTools.length) {
    lines.push(`  ${data.uncoveredTools.join(', ')}`);
  } else {
    lines.push('  (none — all tools are referenced by at least one skill)');
  }

  if (check.errors.length) {
    lines.push('', 'Errors');
    for (const error of check.errors) lines.push(`  - ${error}`);
  }
  if (check.warnings.length) {
    lines.push('', 'Warnings');
    for (const warning of check.warnings) lines.push(`  - ${warning}`);
  }
  if (!check.errors.length && !check.warnings.length) {
    lines.push('', 'Check: surface is internally consistent.');
  }
  return lines.join('\n');
}
