#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyBuild, planBuild } from '../src/build.mjs';
import { checkSpec } from '../src/check.mjs';
import { formatExplain } from '../src/explain.mjs';
import { loadSpec, specPath } from '../src/spec.mjs';

const COMMANDS = ['explain', 'check', 'build', 'help'];

function help() {
  return `mcp-surface-kit: record, explain and check an MCP tool surface.

Usage: mcp-surface <command> [dir]

Commands:
  explain   Print tiers, prepare/confirm pairs, skill coverage and gaps.
  check     Exit 1 if the spec is internally inconsistent.
  build     Write SKILL.md files from spec.skills (--dry-run prints paths).
  help      Show this help.

Typical flow:
  mcp-surface explain examples/content-workspace
  mcp-surface check examples/content-workspace
  mcp-surface build examples/content-workspace --dry-run
  mcp-surface build examples/content-workspace
`;
}

function parse(argv) {
  const flags = { dryRun: false, json: false };
  const positionals = [];
  for (const arg of argv) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '-h' || arg === '--help') positionals.unshift('help');
    else if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}`);
    else positionals.push(arg);
  }
  return { command: positionals[0] || 'help', dir: resolve(positionals[1] || '.'), flags };
}

function run(argv = process.argv.slice(2)) {
  const { command, dir, flags } = parse(argv);
  if (!COMMANDS.includes(command)) {
    throw new Error(`Unknown command ${command}. Try mcp-surface help.`);
  }
  if (command === 'help') return { code: 0, text: help() };

  const path = specPath(dir);
  if (!existsSync(path)) {
    throw new Error(`No ${path}. Write .mcp-surface/spec.json first.`);
  }
  const spec = loadSpec(dir);
  const check = checkSpec(spec);

  if (command === 'explain') {
    return { code: check.ok ? 0 : 1, text: formatExplain(spec, check), check, spec };
  }
  if (command === 'check') {
    const lines = [];
    if (check.ok) lines.push('PASS: MCP surface spec is internally consistent.');
    else {
      lines.push('FAIL:');
      for (const error of check.errors) lines.push(`  - ${error}`);
    }
    for (const warning of check.warnings) lines.push(`warning: ${warning}`);
    return { code: check.ok ? 0 : 1, text: lines.join('\n'), check, spec };
  }
  if (!check.ok) {
    return {
      code: 1,
      text: `Refusing to build; fix check first:\n${check.errors.map((e) => `  - ${e}`).join('\n')}`,
      check,
      spec,
    };
  }
  const files = applyBuild(planBuild(spec, dir), { dryRun: flags.dryRun });
  const lines = [
    flags.dryRun ? 'Dry run (nothing written):' : `Wrote ${files.length} skill file(s):`,
    ...files.map((file) => `  ${file.path}`),
  ];
  return { code: 0, text: lines.join('\n'), check, spec, files };
}

try {
  const result = run();
  if (result.text) console.log(result.text);
  process.exitCode = result.code;
} catch (error) {
  console.error(String(error.message || error));
  process.exitCode = 1;
}

export { run };
