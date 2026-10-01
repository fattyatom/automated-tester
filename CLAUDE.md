# CLAUDE.md

@AGENTS.md

## Claude Code specifics
- The agents in `.claude/agents/` and the skills in `.claude/skills/` are generated from
  `agents/` by `npm run agents:sync` — edit the canonical files, never the generated ones.
- The `kb-*` agents need the product-catalog MCP server; configure it in `.mcp.json` (see
  docs/KNOWLEDGE_BASE.md → Catalog MCP).
