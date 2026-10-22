export function formatExplain(spec, check) {
  const lines = [
    `MCP surface: ${spec.name}`,
    spec.purpose,
    spec.resourceUrl ? `Resource: ${spec.resourceUrl} (${spec.transport})` : `Transport: ${spec.transport}`,
    spec.scopes.length ? `Scopes (cumulative): ${spec.scopes.join(' ⊂ ')}` : 'Scopes: (none declared)',
    spec.untrustedFields.length
      ? `Untrusted fields: ${spec.untrustedFields.join(', ')}`
      : 'Untrusted fields: (none declared — add captions/comments/html)',
    '',
    'Tool                          Tier      Phase    Pair                           Scope',
    '----------------------------  --------  -------  -----------------------------  --------',
  ];
  for (const tool of spec.tools) {
    lines.push(
      [
        tool.name.padEnd(28),
        tool.tier.padEnd(8),
        (tool.phase || '—').padEnd(7),
        (tool.pair || '—').padEnd(29),
        tool.scope || '—',
      ].join('  ')
    );
  }
  lines.push('', 'Skills');
  for (const skill of spec.skills) {
    lines.push(`  ${skill.name}: ${skill.description}`);
    lines.push(`    uses: ${skill.uses.join(', ') || '(none)'}`);
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
