# mcp-surface-kit

Record, explain, check and generate workflow skills for an **MCP tool surface**: which tools exist, which tier they sit in (`read` / `draft` / `mutate` / `delete`), which `prepare → confirm` pairs or deletion guards they use, which skills teach them, and which scopes each operation requires.

Companion to [MUMRO Academy Lesson 14](https://academy.mumro.io/lessons/mcp-tools-skills-and-product-surfaces/). It does not scan your server source and does not invent a product. You write `.mcp-surface/spec.json`. The kit reviews the contract you claim to offer and generates managed `SKILL.md` files from that spec.

Requires Node.js 20+. Zero runtime dependencies.

## Why

A clickable UI and an agent-operable product should share one workspace. The failure modes are predictable:

- a chatbot that cannot see live state (the agent pastes)
- a single `publish_now` or unguarded `delete` tool (the agent mutates live state in one step)
- a pile of verbs with no skill (every agent invents a different loop)
- a skill that restates JSON Schema the tool already has, or drifts out of sync with the tool list

This kit makes the declared contract checkable:

- **No one-call live mutations**: `liveInOneCall` is rejected; `mutate` tools must form reciprocal `prepare` ↔ `confirm` pairs.
- **Explicit delete safety**: `delete` tools must set `destructiveHint: true` and either form a `prepare → confirm` pair or declare `guard: "local_draft_only"` with `openWorldHint: false`.
- **Official MCP annotation defaults vs. kit policy**:
  - **MCP protocol defaults** (2026-07-28): when omitted, `readOnlyHint` defaults to `false`, `destructiveHint` defaults to `true`, `idempotentHint` defaults to `false`, and `openWorldHint` defaults to `true` (even on `read` tools, such as web search).
  - **Kit policy**: `read` tools must set `readOnlyHint: true` and receive a warning if `openWorldHint` is left implicit; `draft` tools must explicitly set `destructiveHint: false` and `openWorldHint: false`; un-paired `delete` tools must set `guard: "local_draft_only"` and `openWorldHint: false`.
- **MCP tool names vs. Agent Skills names**:
  - **Tool names** follow the MCP 2026-07-28 specification: 1–128 characters using ASCII letters, digits, underscores, hyphens, and dots (`[A-Za-z0-9_.-]`, e.g. `admin.tools.list` or `get_workspace_context`).
  - **Skill names** follow the Agent Skills specification: 1–64 characters using lowercase ASCII letters, digits, and single hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`).
- **Scope hierarchy and per-operation permissions**: supports `scopeModel` (`cumulative` | `independent` | `hierarchy`), prevents non-read tools from using the baseline read-only scope, and validates multi-action tools via `operationScopes` (for example when one `prepare`/`confirm` pair handles both `schedule_draft` and `publish_now`).
- **Safe, conflict-aware `SKILL.md` generation**: validates skill names (`a-z0-9-`, max 64 chars) and descriptions (max 1024 chars, YAML-safe escaping and round-trip frontmatter parsing), rejects path traversal and symlinks, tracks generator ownership via embedded SHA-256 markers (`create` / `update` / `unchanged` / `conflict`), and refuses to overwrite hand-written or hand-edited skills without `--force`.

It does **not** prove that your server implementation enforces the spec at runtime. Static JSON validation reviews the contract you declare; server integration tests verify actual authentication, tenant isolation, scope checks, payload fingerprints and confirmation expiry.

## Commands

```bash
npx github:RolePlayingTech/mcp-surface-kit explain [dir] [--strict] [--json]
npx github:RolePlayingTech/mcp-surface-kit check [dir] [--strict] [--json]
npx github:RolePlayingTech/mcp-surface-kit build [dir] --dry-run [--json]
npx github:RolePlayingTech/mcp-surface-kit build [dir] [--force] [--json]
```

From this repository:

```bash
npm test
npm run explain
npm run check
npm run build:dry-run
```

`examples/content-workspace` is a MUMRO-shaped publishing workspace with a compact tool list covering all four tiers (`read`, `draft`, `delete` with `local_draft_only`, and `mutate` with `prepare → confirm` + `operationScopes`) — enough to practise, not a clone of any production gateway.

## Spec shape

See `examples/content-workspace/.mcp-surface/spec.json`.

Required fields:

- `name`, `purpose`
- `tools[]` with `name` (`1–128` chars, `[A-Za-z0-9_.-]`), `tier` (`read` | `draft` | `mutate` | `delete`), `description`, `annotations`
  - `read` tools require `annotations.readOnlyHint: true` (and should explicitly declare `openWorldHint: false` for closed-world tenant reads or `openWorldHint: true` for external/web reads)
  - `draft` tools require `annotations.destructiveHint: false` and `annotations.openWorldHint: false`
  - `mutate` tools require `phase` (`prepare` | `confirm`) and reciprocal `pair`
  - `delete` tools require `annotations.destructiveHint: true` plus either a `prepare` / `confirm` pair or `guard: "local_draft_only"` with `annotations.openWorldHint: false`
- `skills[]` with `name` (`^[a-z0-9]+(-[a-z0-9]+)*$`), `description` (must include `"Use when …"` / `"Używaj, gdy …"`), and `uses` (ordered tool names; any `confirm` tool must be preceded by its `prepare` partner)

Optional fields:

- `scopeModel` (`cumulative` | `independent` | `hierarchy`, default `cumulative`), `scopes` (ordered list), `scopeHierarchy`
- per-tool `scope` and `operationScopes` (for example `{ "schedule_draft": "schedule", "cancel": "schedule", "publish_now": "publish" }`)
- `untrustedFields` (returned workspace fields the generated skill marks as untrusted data)
- `copySkillsTo` (for example `[".claude/skills"]`; avoid listing both `.agents/skills` and `.claude/skills` when using hosts like Cursor that read both directories)
- `resourceUrl`, `transport`

## File ownership & `--dry-run`

`mcp-surface build` always writes canonical skills to `.mcp-surface/skills/<name>/SKILL.md` and optionally mirrors them to `copySkillsTo`. Each generated file includes a `<!-- mcp-surface-kit:managed sha256=... -->` marker:

- **`create`**: file does not exist yet
- **`update`**: file was generated by `mcp-surface-kit`, has not been hand-edited, and the spec changed
- **`unchanged`**: file already matches the spec (idempotent re-run)
- **`conflict`**: file was created by hand or modified after generation — `build` refuses to overwrite it unless `--force` is passed

`mcp-surface build --dry-run` prints the status (`create` / `update` / `unchanged` / `conflict`) and unified diffs without touching the filesystem.

## What this is not

- Not an MCP server, SDK or runtime inspector
- Not a replacement for server integration tests
- Not a replacement for [agent-harness-kit](https://github.com/RolePlayingTech/agent-harness-kit) (that kit designs the coding agent’s working environment; this kit designs the product surface the agent calls)
- Not a measurement of quality or token savings

## License

MIT. Built for [MUMRO Academy](https://academy.mumro.io) by [RolePlayingTech](https://roleplayingtech.com).
