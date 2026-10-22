# mcp-surface-kit

Record, explain and check an **MCP tool surface**: which tools exist, which tier they sit in (read / draft / mutate / delete), which prepare/confirm pairs they form, which skills teach them, and which OAuth scopes they need.

Companion to [MUMRO Academy Lesson 14](https://academy.mumro.io/lessons/mcp-tools-skills-and-product-surfaces/). It does not scan your server source and does not invent a product. You write `.mcp-surface/spec.json`. The kit reviews the contract you claim to offer.

Requires Node.js 20+. No runtime dependencies.

## Why

A clickable UI and an agent-operable product should share one workspace. The failure modes are predictable:

- a chatbot that cannot see live state (the agent pastes)
- a single `publish_now` tool (the agent publishes by mistake)
- a pile of verbs with no skill (every agent invents a different loop)
- a skill that restates JSON Schema the tool already has

This kit makes the intended contract checkable: **no live-in-one-call tools, every mutation has a pair, skills only name tools that exist, descriptions say when to load.**

It does **not** prove that your implementation matches the spec. That is what server tests are for.

## Commands

```bash
npx github:RolePlayingTech/mcp-surface-kit explain [dir]
npx github:RolePlayingTech/mcp-surface-kit check [dir]
npx github:RolePlayingTech/mcp-surface-kit build [dir] --dry-run
npx github:RolePlayingTech/mcp-surface-kit build [dir]
```

From this repository:

```bash
npm test
node bin/mcp-surface.mjs explain examples/content-workspace
node bin/mcp-surface.mjs check examples/content-workspace
node bin/mcp-surface.mjs build examples/content-workspace --dry-run
```

`examples/content-workspace` is a MUMRO-shaped publishing workspace with a short tool list — enough to practise, not a clone of any production gateway.

## Spec shape

See `examples/content-workspace/.mcp-surface/spec.json`. Required fields:

- `name`, `purpose`
- `tools[]` with `name`, `tier`, `description`; mutate tools also need `phase` (`prepare` | `confirm`) and `pair`
- `skills[]` with `name`, `description` (must contain “Use when …”), `uses` (tool names)

Optional: `scopes` (cumulative list), `untrustedFields`, `copySkillsTo` (e.g. `.agents/skills`, `.claude/skills`), `resourceUrl`, `transport`, per-tool `annotations` and `scope`.

`check` fails if:

- a read tool is missing `readOnlyHint: true`
- a mutate tool has no partner, or the partner does not point back
- `liveInOneCall` is true
- a skill `uses` a tool that does not exist, or its description does not say when to use it

Gated tools that no skill mentions are warnings, not failures.

## What this is not

- Not an MCP server, SDK or inspector
- Not a replacement for [agent-harness-kit](https://github.com/RolePlayingTech/agent-harness-kit) (that kit designs the coding agent’s working environment; this kit designs the product surface the agent calls)
- Not a measurement of quality or token savings

## License

MIT. Built for [MUMRO Academy](https://academy.mumro.io) by [RolePlayingTech](https://roleplayingtech.com).
