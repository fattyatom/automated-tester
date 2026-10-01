# automated-tester

A Playwright-native QA tool that tests a website **the way an SDET who's read all the docs would**:
it reads your product knowledge from an **Obsidian vault**, builds a knowledge graph, works out
what needs testing, then runs:

- **Acceptance tests** — Given/When/Then criteria from the notes, executed through a natural-language step library.
- **Exploratory charters**, generated from the graph:
  - **Route skipping**: deep-link to step N of a flow without completing steps 1..N-1.
  - **Auth and role guards**: protected pages anonymously; role-restricted pages as the wrong persona.
  - **Param tampering**: `/orders/:id` with `abc`, `-1`, `../../etc/passwd`, `%00`…
  - **Field validation**: boundaries, negatives and security payloads per documented rule, first as
    a user, then **with client-side validation stripped** to prove the server enforces it.
  - **State handling**: reload every step, an impatient double-click, back + resubmit, session loss mid-flow.
  - **Discovery crawl** per persona: broken links, unlabeled inputs, live routes missing from the docs.
- **Oracles on every page**: 5xx responses, uncaught JS errors, console errors, stack traces or DB
  errors in the page, and XSS payloads that actually execute.

There's no code spelunking and no trawling through Jira or ADO: the vault is the source of truth, and gaps in
it are reported as findings in their own right.

```
 Obsidian vault ──► parse (frontmatter, [[links]], #tags, sections)
                      │
                      ▼
                knowledge graph ──► product model ──► test plan ──► Playwright projects
                (resolve, BFS,     (pages, flows,     (AC tests,      acceptance / exploratory
                 paths, hotspots)   fields, auth &     charters)            │
                      │             roles inherited                        ▼
                      │             through links)                  oracles + findings
                      ▼                                                    │
            coverage.md (gaps)   ◄──── discovery crawl (docs vs reality) ◄─┘
                      │                                                    ▼
          Claude Code subagents ──► .qa/overlay (facts, ACs)      qa-report/ findings.md,
          (cartographer, normalizer,  merged over the vault        traceability.md, html,
           step-author, explorer, triager)                        bug drafts (triager)
```

## Quick start

```bash
npm install
npx playwright install chromium        # skip if browsers are already provisioned
npm run analyze                        # vault → .qa/model.json, plan.json, coverage.md
npm test                               # unit + acceptance + exploratory against the bundled demo app
npm run report                         # HTML report
```

With no `QA_BASE_URL`, the suite starts **ShopLite** (`examples/demo-app`), a small shop with
planted bugs, and tests it against `examples/vault`. A run currently reports:

| Severity | Finding | Charter |
|---|---|---|
| critical | Stored XSS in profile Bio | field validation + XSS oracle |
| high | Review step reachable without shipping/payment | route skipping |
| high | Customer can open the Admin Panel | role guards |
| high | Server accepts 31-char display name when `maxlength` is bypassed | field validation (server mode) |
| high | 500 + stack trace on `/orders/abc` | param tampering + content oracle |
| medium | Double-click "Place order" submits twice | state handling |
| medium | Back + resubmit creates a second order | state handling |
| medium | Dashboard links to a 404 (`/help`) | discovery crawl |
| low | Promo code input has no label | discovery crawl |

All acceptance criteria pass, and one scenario is reported `fixme` because it uses a step the
library doesn't know yet.

## Testing your own site

`vault/` is a starter Obsidian vault for your product. Open it in Obsidian and begin with `_Start Here`.

```bash
cp vault/sample.credentials.md vault/credentials.md   # git-ignored, like .env
# edit: baseURL, landing page, login page, test accounts, where each persona lands
npm run analyze      # "Target:" line confirms it now points at your site
npm test
```

`credentials.md` works like `.env`:

| File | In git? | Purpose |
|---|---|---|
| `vault/sample.credentials.md` | ✅ committed | Documented template. The tool ignores it. |
| `vault/credentials.md` | 🚫 git-ignored | Your real values, kept on your machine and in your local Obsidian vault. |

- Values can reference env vars, `${QA_ADMIN_PASS}` or `${VAR:-default}`, so CI can inject secrets.
- Passwords are masked in everything agents read (`npm run qa -- context`).
- The file also says what *should* happen: where an anonymous visitor lands, which pages bounce to
  login, where each persona lands, the wrong-password message, and where logout leads. Those
  become `@auth` acceptance tests automatically, so a brand-new vault already tests the login contract.
- After the first run, `.qa/coverage.md` → **"Live routes missing from the vault"** lists the
  pages the crawler found that you haven't documented yet. That's your to-do list for growing the vault.

Which vault is tested: `QA_VAULT` if set, else `./vault` once it has a `credentials.md`, else the
bundled demo. `QA_BASE_URL` overrides the target URL for a single run. Edit `qa.config.ts` for a
custom `login()` (SSO/MFA), project steps, and `explore.failOn`, the severity at which findings
fail a test. See [docs/VAULT_CONVENTIONS.md](docs/VAULT_CONVENTIONS.md) for the note format. None
of it is mandatory: the tool degrades gracefully and lists what's missing in `.qa/coverage.md`.

> Use test accounts on a non-production environment. The exploratory charters submit forms,
> double-click buttons and tamper with URLs.

## Graph lookup CLI

```bash
npm run qa -- feature "Review Order"      # what was inferred (route, auth + why, roles, fields, ACs)
npm run qa -- graph "Checkout Flow" -d 2  # neighbourhood
npm run qa -- context "Payment" -d 1      # note + linked notes as one context pack (for agents)
npm run qa -- path "Admin Panel" "Payment Rules"
npm run qa -- mermaid "Checkout Flow"     # diagram
npm run qa -- steps                       # supported AC phrasing
```

## Subagents (Claude Code)

The agents live in `.claude/agents/`, and the whole loop is the `qa-pipeline` skill.

| Agent | Job |
|---|---|
| `qa-cartographer` | Walks the graph and writes a risk-ranked `.qa/test-strategy.md`: gaps, manual charters, PO questions. Adds missing machine facts to the overlay. |
| `qa-ac-normalizer` | Turns prose ACs into executable Gherkin in the overlay, using the step library's phrasing. |
| `qa-step-author` | Implements missing step definitions in `qa.config.ts`. |
| `qa-explorer` | Hands-on exploratory sessions with Playwright scripts: multi-tab, slow network, locale, stale IDs… |
| `qa-triager` | Classifies failures (bug, spec gap, test issue, environment), reproduces them, and drafts Jira/ADO-ready bug reports. |

Agents never edit the team's vault. They write to `.qa/overlay/`, which merges over the vault by
note name and is meant for review before promoting.

## Outputs

- `qa-report/findings.md` / `.json`: unique findings by severity, each traced to its vault note
- `qa-report/traceability.md`: vault note → charter → test → result
- `qa-report/html`: the Playwright report, with traces for failures and evidence screenshots for findings
- Optional: `report.writeToVault` writes a `QA Run <date>.md` note with `[[links]]` back into the
  vault, so results appear in the graph

## Layout

```
src/knowledge/  vault parser, graph, product model
src/planner/    test plan + coverage/gap report
src/ac/         step library
src/explore/    QaSession (oracles, findings), interaction helpers, flow walker
src/report/     findings/traceability reporter
tests/          acceptance.spec.ts, exploratory/*.spec.ts, unit/
vault/          starter vault for YOUR product (sample.credentials.md, templates, guide)
examples/       demo app + example vault
```
