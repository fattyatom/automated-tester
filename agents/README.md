# agents/ — canonical, tool-neutral agent definitions

Every agent and playbook in this repo is defined **once**, here, in plain markdown. Runtime-specific
files are generated from these; never edit a generated file (it says so in its first line).

| Canonical | Claude Code | opencode |
|---|---|---|
| `agents/<name>.md` | `.claude/agents/<name>.md` | `.opencode/agents/<name>.md` (`mode: subagent`) |
| `agents/playbooks/<name>.md` | `.claude/skills/<name>/SKILL.md` | `.opencode/commands/<name>.md` |

Repo-wide rules for every runtime live in [`AGENTS.md`](../AGENTS.md) (read natively by opencode and
GitHub Copilot; `CLAUDE.md` imports it). Runtimes without an adapter, such as Copilot, use the
canonical files directly: point them at `agents/<name>.md`.

## Keeping the variants in sync

| Mechanism | What it does |
|---|---|
| `npm run agents:sync` | Regenerates every adapter from `agents/`, and deletes generated files whose canonical source is gone. Hand-written files in the same folders are left alone. |
| pre-commit hook (`.githooks/pre-commit`) | When a commit touches `agents/`, `src/agents/` or a generated folder, runs `agents:sync -- --stage`, so the regenerated files go into the same commit. `npm install` installs it (`prepare` sets `core.hooksPath`); run `git config core.hooksPath .githooks` if you skipped install. |
| `npm run agents:check` | Fails if any adapter is missing, hand-edited or orphaned. |
| `npm run test:unit` | Runs the same check, so the suite catches drift from commits that bypassed the hook (`--no-verify`). |

## Format

```markdown
---
name: kb-sync                 # must equal the file name
description: One paragraph: what it does and when to use it (runtimes use this to pick the agent).
inputs:                        # documentation only — what the caller should hand over
  - catalog item ids, or nothing (= everything changed since the watermark)
outputs:
  - a branch + PR with one commit per catalog item
tools: [read, search, write, edit, shell, catalog]
---
Plain instructions. No runtime-specific tool names or concepts.
```

`tools` uses generic capabilities, mapped per runtime:

| Capability | Meaning | Claude Code | opencode permission |
|---|---|---|---|
| `read` | read files | Read | (always) |
| `search` | find files / grep text | Glob, Grep | (always) |
| `write` | create files | Write | `edit: allow` |
| `edit` | modify files | Edit | `edit: allow` |
| `shell` | run commands (`npm run …`, `git …`) | Bash | `bash: allow` |
| `web` | fetch URLs / search the web | WebFetch, WebSearch | `webfetch: allow` |
| `catalog` | the product-catalog MCP server (Jira / Azure DevOps) | *all tools* | *(MCP tools allowed)* |

An agent that needs `catalog` gets **no** tool allow-list in the Claude adapter, because the MCP
server's name is chosen by whoever configures it; Claude Code then gives the agent every tool,
including MCP ones. Configure the server per runtime: `.mcp.json` (Claude Code), `opencode.json` →
`mcp` (opencode), or your editor's MCP settings for other runtimes. See [docs/KNOWLEDGE_BASE.md](../docs/KNOWLEDGE_BASE.md#catalog-mcp).

## Writing style for canonical text

- Say "delegate to the `x` agent" for hand-offs, and add "or follow `agents/x.md` yourself" when a
  runtime may not support delegation. Don't use one runtime's vocabulary (no "subagent", no tool
  names such as Bash or Grep); `test:unit` rejects them.
- Refer to commands (`npm run qa -- …`, `git …`), not to how a runtime runs them.
- Keep each agent focused on one job, with inputs and outputs a caller can check.
