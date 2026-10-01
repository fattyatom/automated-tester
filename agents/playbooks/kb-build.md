---
name: kb-build
description: Builds the product knowledge base (Obsidian vault) from scratch and hands it over to scheduled sync — bootstrap from local agents/docs, import the product catalog, shape and link the graph, verify with analyze and a first test run. Use when starting on a new product or when asked to "build the KB / knowledge base".
tools: [read, search, write, edit, shell, catalog]
---
# Build the knowledge base

Follow `docs/KNOWLEDGE_BASE.md`. "Delegate to agent X" means hand the stage to that agent if your
runtime supports delegation, otherwise follow `agents/X.md` yourself. Stop and ask the user at
each ⏸.

1. ⏸ **Scope.** Ask for: the catalog (Jira or Azure DevOps) and its scope (JQL / WIQL clause),
   the statuses that count as product behaviour, and the local paths that may be harvested.
   Confirm the catalog MCP server answers a search for one known item.
2. **Bootstrap + import.** Delegate to `kb-bootstrapper` (phases 1–5). It opens the bootstrap PR.
3. **Shape the graph.** On the same branch, delegate to `qa-cartographer` with the new vault
   (`QA_VAULT=<vault>`): hotspots, missing routes/auth/roles, unlinked notes. Promote facts the
   docs state into the vault notes with provenance (not the overlay — this is the KB being
   built); turn the rest into review-queue questions.
4. **Review.** Delegate to `kb-reviewer` on the bootstrap branch; resolve or queue its findings.
5. **Verify.** `QA_VAULT=<vault> npm run analyze` must show no unresolved links and every page
   with a route. If a `credentials.md` exists for a test environment, run `npm test` with
   `QA_VAULT=<vault>` and hand the result to `qa-triager`; spec gaps it finds go to the queue.
6. ⏸ **Hand over.** Ask a human to review and merge the PR (merge commit, not squash). After the
   merge, schedule `kb-sync` (see *Automation* in the spec) and `kb-reviewer` weekly.
