---
type: meta
# Knowledge-base sync state — committed with the notes it describes, so reverting a sync PR also
# rewinds the watermark. Written by the kb-bootstrapper / kb-sync agents; see docs/KNOWLEDGE_BASE.md.
# The QA tool ignores the whole _sync/ folder. No credentials here: the catalog MCP server
# authenticates with its own env vars / secret store.

catalog: jira                 # jira | ado
# Which catalog items describe this product (JQL for Jira, a WIQL WHERE clause for Azure DevOps).
scope: project = SHOP AND issuetype in (Epic, Story, Bug)
# Only items in these statuses become product facts; others are picked up when their status changes.
statuses: [Done, Ready for QA]
# Greatest `updated` timestamp (UTC) among items applied by the last merged sync. Empty = never synced.
watermark:
# Re-read this many minutes before the watermark (clock skew, JQL minute precision); already-applied items are skipped.
overlap_minutes: 10
# Catalog ids never to apply again (e.g. after reverting one item's commit). Remove an id to let it sync again.
exclude: []
last_run:
last_branch:
---
# Sync state

Read by `kb-sync` at the start of every run and advanced in its last commit. To re-sync
everything since a date, lower `watermark` in a PR of its own.
