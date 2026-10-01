# agents/ — canonical, tool-neutral agent definitions

Every agent and playbook in this repo is defined **once**, here, in plain markdown. Runtime-specific
files are generated from these by `npm run agents:sync` and checked by `npm run agents:check`
(also covered by `npm run test:unit`). Never edit a generated file; it says so in its first line.

| Canonical | Claude Code | GitHub Copilot | opencode |
|---|---|---|---|
| `agents/<name>.md` | `.claude/agents/<name>.md` | `.github/agents/<name>.agent.md` | `.opencode/agents/<name>.md` (`mode: subagent`) |
| `agents/playbooks/<name>.md` | `.claude/skills/<name>/SKILL.md` | `.github/prompts/<name>.prompt.md` | `.opencode/commands/<name>.md` |

Repo-wide rules for every runtime live in [`AGENTS.md`](../AGENTS.md) (read natively by Copilot and
opencode; `CLAUDE.md` imports it).

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

| Capability | Meaning | Claude Code | Copilot | opencode permission |
|---|---|---|---|---|
| `read` | read files | Read | read | (always) |
| `search` | find files / grep text | Glob, Grep | search | (always) |
| `write` | create files | Write | edit | `edit: allow` |
| `edit` | modify files | Edit | edit | `edit: allow` |
| `shell` | run commands (`npm run …`, `git …`) | Bash | execute | `bash: allow` |
| `web` | fetch URLs / search the web | WebFetch, WebSearch | web | `webfetch: allow` |
| `catalog` | the product-catalog MCP server (Jira / Azure DevOps) | *all tools* | *all tools* | *(MCP tools allowed)* |

An agent that needs `catalog` gets **no** tool allow-list in the Claude and Copilot adapters,
because the MCP server's name is chosen by whoever configures it; both runtimes then give the agent
every tool, including MCP ones. Configure the server per runtime: `.mcp.json` (Claude Code),
`opencode.json` → `mcp` (opencode), the repository's Copilot MCP settings (Copilot coding agent) or
`.vscode/mcp.json` (VS Code). See [docs/KNOWLEDGE_BASE.md](../docs/KNOWLEDGE_BASE.md#catalog-mcp).

## Writing style for canonical text

- Say "delegate to the `x` agent" for hand-offs, and add "or follow `agents/x.md` yourself" when a
  runtime may not support delegation. Don't use one runtime's vocabulary (no "subagent", no tool
  names such as Bash or Grep); `test:unit` rejects them.
- Refer to commands (`npm run qa -- …`, `git …`), not to how a runtime runs them.
- Keep each agent focused on one job, with inputs and outputs a caller can check.
