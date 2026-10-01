# CLAUDE.md

Playwright-native QA tool driven by an Obsidian vault. Read README.md for the overview and
docs/VAULT_CONVENTIONS.md for the note format.

## Commands
- `npm run analyze` — rebuild `.qa/` (model, plan, coverage) from the vault
- `npm run qa -- <feature|graph|context|path|mermaid|steps> ...` — graph lookups
- `npm run typecheck` · `npm run test:unit` — fast checks; run both before committing
- `npm test` — everything against the demo app (or `QA_BASE_URL`)

## Rules
- Specs are data-driven from the plan; add new charters as planner items + a spec file in
  `tests/exploratory/`, not hard-coded tests per page.
- Findings go through `qa.add()` (QaSession). Don't `expect()` in exploratory specs for product
  behaviour — a finding carries severity and traceability; an assertion does not.
- Locators: role/label/placeholder via `src/explore/interact.ts` helpers.
- Never edit `examples/vault` to make a test pass; vault facts come from the product. Agents write
  to `.qa/overlay/`.
- The demo app's bugs are intentional (marked `BUG:`); don't fix them.
- `credentials.md` holds real secrets: never print, quote, commit or copy it. Read vault context
  through `npm run qa -- context` (it masks secrets). Only `examples/vault/credentials.md`
  (public demo values) is committed; change the template in `vault/sample.credentials.md`.
