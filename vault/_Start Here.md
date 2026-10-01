---
type: guide
tags: [qa-guide]
---
# Start here

This vault is the **single source of truth the QA tool tests against**. It never reads the app's
code; it reads these notes, follows the `[[links]]` between them, and works out what to test.

## 1 — Connect it to your site (5 minutes)

1. Copy `sample.credentials.md` → `credentials.md` (same folder; git-ignored).
2. Fill in `baseURL`, the login page, test accounts, and where each persona should land.
3. From the repo root:
   ```bash
   npm run analyze   # now targets ./vault — check the "Target:" line
   npm test          # auth contract + crawl + guards against your site
   ```
4. Open `.qa/coverage.md`. Its **"Live routes missing from the vault"** section lists the pages the
   crawler found that nobody has documented yet — that's your to-do list for step 2.

## 2 — Grow the knowledge base

Create notes from the `Templates/` folder (enable *Settings → Core plugins → Templates* and set
the template folder to `Templates`). One note per thing:

| Note type | Template | What the tool does with it |
|---|---|---|
| Page (has a URL) | `Templates/Page` | auth/role guards, field validation, acceptance tests |
| Flow (ordered pages) | `Templates/Flow` | route skipping, reload/back/double-submit, session loss |
| Rule (business rule) | `Templates/Rule` | context for agents; link it from the pages it governs |
| Role | `Templates/Role` | role-restricted pages are probed with every other persona |

Start with the pages in [[Product Overview]], then the money/critical flows.

**Links are the point.** Link a page to the flow it belongs to, the roles that use it and the
rules that govern it. Auth and roles are *inherited through links* (a page inside a login-only
flow is treated as login-only), and the most-linked notes are tested first.

## 3 — Write acceptance criteria the tool can run

```gherkin
Scenario: Short behaviour name
  Given I am logged in as "standard"
  And I am on the "Dashboard" page
  When I click "New project"
  Then I should see "Project created"
```

Reference pages by **note title**, UI elements by their **visible label**. Prose criteria are fine
too — they're listed in coverage.md and the `qa-ac-normalizer` agent turns them into steps.
Run `npm run qa -- steps` for every supported phrasing. Full format:
`docs/VAULT_CONVENTIONS.md` in the repo.

## 4 — Keep it in sync with Jira / Azure DevOps

Notes built from the product catalog carry `source:`, `source_updated:`, `synced_at:` and
`keywords:` in their frontmatter. The `kb-sync` agent applies catalog changes since the watermark
in `_sync/state.md` as a pull request; anything it can't decide goes to `_sync/Review Queue.md`.
See `docs/KNOWLEDGE_BASE.md` in the repo.

## Map

- [[Product Overview]]
- Pages: [[Home]], [[Login]], [[Dashboard]]
- Flows: [[Example Flow]]
- Roles: [[Standard User]], [[Admin]]
- Rules: [[Authentication Rules]]
