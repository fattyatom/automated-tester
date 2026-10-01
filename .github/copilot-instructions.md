# Copilot instructions

The repository's agent instructions live in [`AGENTS.md`](../AGENTS.md) at the root — follow it.
In short:

- Run `npm run typecheck` and `npm run test:unit` before committing.
- Never edit `examples/vault` to make a test pass, never touch `credentials.md`, and don't fix the
  demo app's intentional `BUG:`s.
- Custom agents in `.github/agents/` and prompt files in `.github/prompts/` are generated from
  `agents/` by `npm run agents:sync`; edit the canonical files instead.
- Building or syncing the knowledge base from Jira / Azure DevOps: `docs/KNOWLEDGE_BASE.md`.
