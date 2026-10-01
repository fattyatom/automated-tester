# Building and syncing the knowledge base

The QA tool tests what the Obsidian vault says (README.md, [VAULT_CONVENTIONS.md](VAULT_CONVENTIONS.md)).
This guide covers how that vault gets written and kept true: built **from scratch** out of the
knowledge already lying around (local agent prompts, READMEs, old notes) and the **product
catalog** (Jira or Azure DevOps), then kept **in sync** with the catalog by timestamp, with every
change reviewed, attributable and revertable in git.

- [Roles of the pieces](#roles-of-the-pieces)
- [Catalog MCP](#catalog-mcp)
- [Phases: building from scratch](#phases-building-from-scratch)
- [Note mapping](#note-mapping)
- [Provenance](#provenance)
- [Keywords](#keywords)
- [Sync state and watermark](#sync-state-and-watermark)
- [Sync algorithm](#sync-algorithm)
- [Conflicts](#conflicts) and the [review queue](#review-queue)
- [Git workflow](#git-workflow): commits, PRs, [rollback](#rollback), [audit](#audit)
- [Security](#security)
- [Automation](#automation)
- [Worked example: "Allow PayPal at payment"](#worked-example)
- [Open questions](#open-questions)

## Roles of the pieces

| Piece | Job |
|---|---|
| Product catalog (Jira / ADO) | The system of record for *intended* behaviour: epics, stories, acceptance criteria, comments. Read only. |
| Vault (`vault/` or `QA_VAULT`) | The **curated, current** description of the product that tests are generated from. One note per page / flow / rule / role, not one per ticket. |
| `kb-bootstrapper` agent | Builds the first vault: harvests local sources, imports the catalog, reconciles. |
| `kb-sync` agent | Applies catalog changes since the last sync, via keyword impact analysis, as a PR. |
| `kb-reviewer` agent | Audits: conflicts, notes behind the catalog, deleted sources, orphans. Proposes; doesn't decide. |
| `npm run qa -- find / stale / context / graph` | The lookups the agents use for impact analysis and freshness. |
| git + PRs | Review, audit trail and rollback for every change to the vault. |

**What "update the relevant skill" means here.** When a story lands, the agent updates the
*knowledge* that story changes: the vault note(s) for that area (the Payment page's fields and
ACs, the Payment Rules note, a role's permissions). Those notes are the product "skills" the QA
agents and generated tests draw on. If an agent definition in `agents/` itself spells out product
knowledge (a route, persona or rule written into its prompt), `kb-sync` updates that too and runs
`npm run agents:sync`. Agents should normally *look up* product facts through `npm run qa --
context` rather than embed them, so this second case should stay rare.

The agents are tool-neutral (see [agents/README.md](../agents/README.md)): the same definitions
run in Claude Code and opencode, and any other agent runtime (e.g. GitHub Copilot) can use
`agents/<name>.md` directly.

## Catalog MCP

The KB agents talk to the catalog through an MCP server. Any server will do as long as it covers
these capabilities; tool names differ per server, so the agents ask for the capability and use
whatever the configured server calls it.

| Capability | Used for | Jira | Azure DevOps |
|---|---|---|---|
| **Search by query** | bootstrap import, scoped sync | JQL: `project = SHOP AND issuetype in (Epic, Story)` (`/rest/api/3/search/jql`) | WIQL: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'Shop' AND [System.WorkItemType] IN ('Epic','Feature','User Story')` (`_apis/wit/wiql`) |
| **List changed since** | every sync | JQL `… AND updated >= "2026/09/30 08:02" ORDER BY updated ASC` | WIQL `… AND [System.ChangedDate] >= '2026-09-30T08:02:00Z' ORDER BY [System.ChangedDate]` with `timePrecision=true` |
| **Keyword search** | reconcile local facts, find related items | JQL `text ~ "paypal"` | WIQL `[System.Title] CONTAINS WORDS 'paypal'` (or the search API) |
| **Get item** | full record for impact analysis | issue: `summary`, `description`, `status`, `issuetype`, `parent`, `labels`, `components`, `updated` | work item: `System.Title`, `System.Description`, `System.State`, `System.WorkItemType`, `System.Tags`, `System.AreaPath`, `System.ChangedDate` |
| **Acceptance criteria** | ACs → Gherkin | no standard field: a custom field or an "Acceptance criteria" section of the description (record which in `state.md`) | `Microsoft.VSTS.Common.AcceptanceCriteria` |
| **Links / hierarchy** | epic → flow, related rules | `parent`, `issuelinks` | `relations` (`System.LinkTypes.Hierarchy-Reverse`, `Related`) |
| **Comments** | clarifications, decisions | `/issue/{key}/comment` | `/workItems/{id}/comments` |
| **History** *(optional)* | which fields changed; audit at a past time | `expand=changelog` | `/workItems/{id}/updates` |

Gotchas:
- **JQL dates have minute precision and use the searching user's time zone.** Convert the UTC
  watermark to that zone, and rely on the overlap window plus the already-applied check
  (below), never on exact `>`.
- **WIQL ignores time of day unless `timePrecision=true`.** Without it, a `ChangedDate` filter is
  day-granular; that is still correct (just more re-reading) thanks to the already-applied check.
- **Deleted items don't show up as "changed".** `kb-reviewer` finds them by fetching every
  `source:` id it sees (404 / moved / closed as duplicate).

Configure the server once per runtime, with credentials from the environment, never from the repo:

| Runtime | Where |
|---|---|
| Claude Code | `.mcp.json` (project) or `claude mcp add` |
| opencode | `opencode.json` → `mcp.catalog` (a disabled placeholder is committed; set `CATALOG_MCP_URL` / `CATALOG_MCP_TOKEN` and `enabled: true` locally) |
| Others (e.g. GitHub Copilot) | the tool's own MCP settings (VS Code: `.vscode/mcp.json`) |

Options include the Atlassian Remote MCP server for Jira and Microsoft's Azure DevOps MCP server.

## Phases: building from scratch

The `kb-build` playbook (`agents/playbooks/kb-build.md`; `/kb-build` in Claude Code and opencode) runs these in order on one `kb/bootstrap-*` branch.

**0 — Scope (human).** Pick the catalog and the scope query, the statuses that count as product
behaviour (e.g. *Done*, *Ready for QA*; not *Backlog*), and the local paths that may be read.

**1 — Bootstrap from local sources (`kb-bootstrapper`, phases 1–2).** People and agents already
know things: `AGENTS.md`/`CLAUDE.md`/Copilot instructions in sibling repos, other agents' prompt
files, READMEs, `docs/`, earlier Obsidian notes, `.feature` files. The agent inventories the
approved paths into `vault/_sync/local-sources.md` (path, kind, last modified, verdict), then
harvests **product facts only** into notes with `source: ["local:<path>"]`. Coding conventions
and build instructions are not product knowledge and are skipped. One commit per source file.

**2 — Catalog import (`kb-bootstrapper`, phase 3).** Epics first, then their features and
stories, mapped per [Note mapping](#note-mapping). Before creating any note the agent runs
`npm run qa -- find <terms> --vault <vault>` and extends the note that already owns the concept.
One commit per epic.

**3 — Reconcile (`kb-bootstrapper`, phase 4).** Same fact in both: keep it, cite both sources.
Disagreement: the catalog statement wins *provisionally*, the local one is quoted in a conflict
callout, and a review-queue entry is created. Local-only facts stay, listed in the PR as
"unconfirmed by the catalog".

**4 — Shape the graph (`qa-cartographer` on the new vault).** Links are what make auth, roles and
risk inference work: every page linked from its flow, its role(s) and its rules; flows linked
from their epic hub; hub notes linked from a product overview. Fill machine facts the docs state
(`route`, `auth`, `roles`, `submit`, field tables). Questions go to the review queue.

**5 — Verify.**
```bash
QA_VAULT=vault npm run analyze             # no unresolved links; every page has a route
npm run qa -- stale --vault vault           # every note has provenance
npm run qa -- graph "Checkout Flow" -d 2 --vault vault
QA_VAULT=vault npm test                     # first run against a test environment (needs credentials.md)
```
`.qa/coverage.md` is the checklist: knowledge gaps, non-executable criteria (→
`qa-ac-normalizer`), unmatched steps (→ `qa-step-author`), live routes missing from the vault (→
new notes). `qa-triager` sorts the first run's failures into product bugs and **spec gaps** — spec
gaps go to the review queue, they are KB bugs.

**6 — Hand over.** A human reviews and merges the bootstrap PR (merge commit). The watermark it
sets is where scheduled `kb-sync` runs start.

## Note mapping

The vault describes the **product as it is**, not the backlog. Tickets come and go; notes are
organised around what users see and do, and each note cites the tickets it was built from.

| Catalog | Vault | How |
|---|---|---|
| Epic | `type: flow` note (a user journey), or a hub note for an area | Epic summary → title/aliases; child features become `## Flow` steps or links |
| Feature | `type: page` note(s), or a section of the flow | Route, roles, fields from its stories |
| Story | **Changes to existing page/flow notes**: ACs, field rows, frontmatter, links | Never a note per story. Scenarios are tagged `@SHOP-142` |
| Acceptance criterion | Gherkin under `## Acceptance Criteria` | Given/When/Then in the step library's phrasing; prose kept as-is for `qa-ac-normalizer` |
| Business rule / NFR | `type: rule` note | One rule per bullet, stated so a tester could prove it wrong; linked from the pages it governs |
| Permission / persona | `type: role` note + `roles:` on pages | Role name matches `credentials.md` persona roles |
| Glossary / domain term | `aliases:` and `keywords:` on the owning note | So lookups and links find it |
| Bug | Usually nothing; a rule or AC if it clarifies intended behaviour | Cite it in `source:` when it does |
| Test account, URL, secret | **Never** in a note | `credentials.md` (git-ignored) only |

## Provenance

Every note written or changed by a KB agent carries:

```yaml
---
type: page
route: /checkout/payment
source: [SHOP-31, SHOP-142]            # catalog ids, "local:<path>" for harvested files, "manual" for hand-written facts
source_updated: 2026-09-30T08:12:44Z   # newest `updated` among the sources, as of the last sync (UTC, ISO 8601)
synced_at: 2026-10-01T02:00:05Z        # when an agent last wrote this note (UTC)
keywords: [payment, card, paypal, payment method, checkout]
---
```

| Key | Rule |
|---|---|
| `source` | One or many. Append, never replace — a note's facts come from several stories over time. A string or a list. |
| `source_updated` | Max of the sources' `updated`. A note is **behind** when any source's current `updated` is newer (checked by `kb-reviewer`). |
| `synced_at` | Bumped whenever an agent changes the note. `npm run qa -- stale` reports notes by age. |
| `keywords` | Lower-case lookup terms, see below. |

The QA tool ignores these keys for testing (they only appear in `npm run qa -- feature` and
`.qa/model.json`). Per-scenario traceability is the `@<ID>` tag on the scenario; per-change
traceability is the commit trailers (below).

## Keywords

Impact analysis is a lookup problem: given a story, which notes own the things it talks about?
`npm run qa -- find <term...>` ranks notes by:

| Match | Weight |
|---|---|
| exact title / file name | 100 |
| catalog id in `source:` | 90 |
| exact `keywords:` entry | 80 |
| exact alias | 70 |
| tag | 60 |
| title/alias contains the term | 40 |
| keyword contains the term (or vice versa) | 30 |
| each mention in the body (max 4) | 5 |

So `keywords` should hold the terms a story would use for this note that the title doesn't:
**UI labels** (field and button text), **domain nouns** (payment method, refund), **synonyms**
(card / credit card), **routes' words**, **role names**, and the epic's name. Don't add generic
words (page, user, click) or terms owned by another note — a keyword says "this note owns that
concept". Put true synonyms of the title in `aliases:` instead, so `[[links]]` resolve too.

Extracting terms from a story: the summary's nouns, every quoted UI string in the ACs, labels /
components (Jira) or tags / area path (ADO), the parent epic's summary, and linked items' summaries.

## Sync state and watermark

**Location: `vault/_sync/state.md`** (committed; the loader ignores `_sync/`).

```yaml
catalog: jira                # jira | ado
scope: project = SHOP AND issuetype in (Epic, Story, Bug)
statuses: [Done, Ready for QA]
watermark: 2026-09-30T08:12:44Z   # max `updated` among items applied by the last merged sync
overlap_minutes: 10
exclude: []                   # ids never to apply again (see Rollback)
last_run: 2026-10-01T02:00:05Z
last_branch: kb/sync-20261001T0200Z
```

Why here and not `.qa/sync-state.json`:
- **Atomic with the notes.** The watermark moves in the same PR as the notes it describes, so
  reverting a sync PR also rewinds the watermark and the next run re-reads those items. A
  separate state store could say "done" for changes that were reverted.
- **It travels with the vault.** Vaults often live in their own repo (or are opened directly in
  Obsidian); `.qa/` is git-ignored scratch space for this tool and would lose the state.
- **Reviewable.** It's a small markdown note humans can read in Obsidian and change in a PR
  (e.g. lower the watermark to replay a period).

The watermark is the **greatest `updated` actually processed**, never the wall clock: items
updated while a sync is running, or with skewed clocks, are picked up next time.

## Sync algorithm

```text
kb-sync(ids?):
  git switch main && git pull --ff-only
  git switch -c kb/sync-<UTC yyyyMMddTHHmmZ>
  S ← read vault/_sync/state.md

  items ← ids ? catalog.get(ids)
                : catalog.changedSince(S.scope, S.watermark − S.overlap_minutes)   # ascending `updated`
  for item in items:
    if item.id ∈ S.exclude or item.status ∉ S.statuses:            skip
    if lastAppliedUpdated(item.id) ≥ item.updated:                  skip   # git trailers are the ledger
    full    ← catalog.get(item.id) + comments + parent + links
    terms   ← keywords(full)          # UI strings, domain nouns, labels/tags, epic, roles, routes
    hits    ← qa find terms --vault V                   # ranked candidates
    hood    ← ∪ qa graph/context <hit> -d 1..2           # flows/rules/roles that inherit changes
    changes ← []
    for note in hits ∪ hood:
      delta ← what full says about note's knowledge (ACs, fields, rules, route, auth, roles, flow)
      if delta = ∅:                                   continue              # passing mention
      if contradicts(delta, note) and not supersedes(full, note.source):
        flagConflict(note, delta, full) ; queue(conflict)                   # never overwrite
      else:
        apply(note, delta) ; tag scenarios @item.id
        note.source ∪= {item.id} ; note.source_updated = max(…, item.updated)
        note.synced_at = now ; note.keywords ∪= new terms
      changes += note
    if changes = ∅ and story describes behaviour:
      create note from template (+ provenance), link from epic hub ; queue(gap)
    redact secrets ; npm run analyze (QA_VAULT=V) must pass
    git commit "kb(sync): <id> <what changed>" with trailers Source-Id / Source-Updated / Synced-At / Kb-Agent
    maxUpdated = max(maxUpdated, item.updated)

  if no commits: report "no changes since <S.watermark>" ; delete branch ; stop
  S.watermark = maxUpdated ; S.last_run = now ; S.last_branch = branch
  git commit "kb(sync): advance watermark to <maxUpdated>"
  git push -u origin <branch> ; open PR ; hand conflicts to kb-reviewer

lastAppliedUpdated(id) = max over
  git log origin/main --grep "^Source-Id: <id>$" --format="%(trailers:key=Source-Updated,valueonly)"
```

`supersedes` means the story explicitly changes that behaviour: it links the earlier item
("replaces", "changes"), or its ACs restate the same field/rule with a new value in an accepted
status. A newer story in the same area that simply says something different is **not** enough.

## Conflicts

A conflict is a story statement that contradicts a fact in the vault whose source is something
else (another catalog item, a `local:` file, `manual`), without explicitly superseding it. Also
always a conflict, whatever the wording: anything that **relaxes security** (removes `auth`,
widens `roles`, drops validation) and anything that comes only from a **comment** rather than an
accepted criterion.

The agent never overwrites. It leaves the existing fact, and records:

```markdown
## Sync conflicts

> [!conflict] RQ-7 · SHOP-160 vs SHOP-31
> **Existing (SHOP-31):** Postcode is exactly 4 digits.
> **SHOP-160:** Postcode accepts 4–6 characters (international addresses).
> Not applied: SHOP-160 doesn't reference SHOP-31. Tracked as RQ-7 in `_sync/Review Queue.md`.
```

`## Sync conflicts` is not an acceptance-criteria heading, so nothing in it runs. `npm run qa --
stale` flags notes with open `[!conflict]` callouts. Resolution is a normal PR: a human edits the
fact (or the PO fixes the catalog and the next sync applies it), removes the callout and marks
the queue entry `resolved by <commit>`.

### Review queue

`vault/_sync/Review Queue.md` is the to-do list for humans: conflicts, gaps (new areas the sync
couldn't attach to anything known), stale notes, gone sources, redactions. One table row per
finding with id `RQ-<n>`, date, kind, notes, catalog items, finding, proposed action, status.
Rows are never deleted, only resolved — the queue doubles as a decision log.

## Git workflow

Wherever the vault lives (this repo or a dedicated vault repo), the rules are the same.

**Branches and PRs.** One branch and one PR per sync run: `kb/sync-<UTC>`; `kb/bootstrap-<UTC>`
for the first build; `kb/revert-<…>` for rollbacks. Agents never push to `main`, never
force-push, never rebase a branch someone else may have checked out, and never merge their own PR.
Protect `main`: required review, CODEOWNERS for `vault/**` (the PO / QA lead), no force-push.
**Merge with a merge commit, not squash**, so each catalog item stays a separately revertable
commit. (Per-story PRs are fine for low volume; the commit rules are the same.)

**Commits.** One per catalog item, with conventional subjects and trailers:

```text
kb(sync): SHOP-142 add PayPal to Payment fields and ACs

Payment: Payment method field (Card, PayPal), PayPal scenario.
Review Order: shows "Paid with PayPal". Payment Rules: accepted methods.
Checkout Flow: conflict RQ-1 (guest PayPal checkout) not applied.

Source-Id: SHOP-142
Source-Updated: 2026-09-30T08:12:44Z
Synced-At: 2026-10-01T02:00:05Z
Kb-Agent: kb-sync
```

| Type | Use |
|---|---|
| `kb(bootstrap):` | harvest of a local source, import of an epic, initial watermark |
| `kb(sync):` | applying a catalog item; advancing the watermark |
| `kb(gap):` | a new note for an area nothing in the vault knew about |
| `kb(conflict):` | an item that only produced conflicts |
| `kb(review):` | review-queue updates by `kb-reviewer` |
| `kb(revert):` | rollbacks (git's own `Revert "…"` subject is fine too) |

Trailers are machine-readable: one `Source-Id:` per item (several for a bootstrap epic commit).

**The PR body** lists per item: notes changed, scenarios added (with `@ID` tags), conflicts and
gaps raised (RQ ids), redactions made, and the coverage delta from `.qa/coverage.md`.

### Rollback

| Situation | Do |
|---|---|
| A whole sync was wrong | `git switch -c kb/revert-<branch> main && git revert -m 1 <merge sha>` → PR. The watermark is rewound with it; fix the cause (scope, statuses, agent) before the next run, or it re-applies the same items. |
| One item was wrong | `git revert <item commit sha>` on a `kb/revert-*` branch, and add the id to `exclude:` in the same PR so the next sync doesn't re-apply it. Remove it from `exclude` once the catalog item is fixed. |
| The PR isn't merged yet | Push a revert commit to the sync branch, or close the PR. |
| Replay a period | Lower `watermark` in a PR of its own; already-applied items are skipped by the git ledger. |

Never `reset --hard` + force-push a shared branch: reverts keep the audit trail.

### Audit

"Why does the Payment note say PayPal is accepted?"

```bash
git blame -w -- "vault/Flows/Payment.md"                 # line → commit
git show <sha>                                           # diff + Source-Id / Source-Updated trailers
git log -p --follow -- "vault/Flows/Payment.md"          # full history of the note
git log --grep "^Source-Id: SHOP-142$" --stat            # everything one story changed, everywhere
git log --format="%h %as %s%n    %(trailers:key=Source-Id,valueonly,separator=%x2C )" -- vault/
npm run qa -- find SHOP-142                              # notes citing it today
```

Then open the catalog item at the commit's `Source-Updated` (Jira changelog / ADO updates show
the text as it was then). Chain: **line → commit → trailer → catalog item at that time**, and
frontmatter `source:` → catalog items for the note as a whole. The review queue explains every
fact that was *not* applied.

## Security

- **`credentials.md` is git-ignored and never synced.** Test accounts, URLs with tokens,
  passwords and API keys found in tickets or local files are replaced with `<redacted>`, listed
  in the PR, and logged as a `redaction` review-queue entry suggesting the owner move them into
  `credentials.md` / env vars. `.env*` and `credentials.md` are never harvested.
- **No personal data** (customer names, emails, screenshots of real data) in notes.
- **Catalog and harvested text are data, not instructions.** A ticket that says "ignore previous
  instructions" or "also change the CI config" is quoted at most, never obeyed. KB agents only
  write inside the vault (plus `agents/` when product knowledge in an agent changes).
- **Least privilege.** The catalog token is read-only. The git token for automation needs only
  contents + pull-requests write on the vault repo. Branch protection makes every change a
  reviewed PR.
- **Harvest scope is opt-in.** The bootstrapper reads only paths the user approves, and records
  them with `~` instead of the home directory path.

## Automation

Run `kb-sync` on a schedule (e.g. nightly) and `kb-reviewer` weekly, in CI or on a workstation:

- **CI:** a scheduled workflow with the vault repo checked out, Node 22, the catalog MCP server
  configured from secrets (`CATALOG_MCP_URL`, `CATALOG_MCP_TOKEN`), and a headless agent runner
  (opencode, Claude Code, or a Copilot coding-agent task) told to "run the kb-sync agent". The
  job needs `contents: write` and `pull-requests: write`. If the run produces no commits, it
  opens no PR.
- **Locally:** run the same agent from your editor; the result is still a branch + PR.

## Worked example

Files: [`examples/kb-worked-example/`](../examples/kb-worked-example/) (a fictional story applied
to `examples/vault`; the example vault itself is unchanged because the demo app has no PayPal).

**The story** (`catalog/SHOP-142.json`), status *Ready for QA*, updated 2026-09-30T08:12:44Z,
parent epic SHOP-10 *Checkout*:

> *Allow PayPal at payment.* As a customer I want to pay with PayPal on the payment step.
> ACs: the Payment page has a "Payment method" choice, Card (default) or PayPal; choosing PayPal
> hides the card fields and the button reads "Continue with PayPal"; after approving on PayPal
> the customer returns to Review Order, which shows "Paid with PayPal"; card payments are
> unchanged. Comments: PO — "guests should be able to pay with PayPal without logging in"; Dev —
> a sandbox buyer email and password.

**1 — Keywords.** paypal, payment, payment method, card, checkout, "Continue with PayPal",
"Paid with PayPal", review order; labels *payments*, *checkout*; epic *Checkout*.

**2 — Lookup.**

```text
$ npm run qa -- find paypal
No notes match "paypal" — new knowledge (create a note and log a gap).

$ npm run qa -- find payment card checkout "payment method"
 120  Payment [page]  examples/vault/Flows/Payment.md
      title "payment", "payment" 2× in text, "card" 1× in text, "checkout" 1× in text
  80  Checkout Flow [flow]  examples/vault/Flows/Checkout Flow.md
      "payment" 4× in text, "card" 2× in text, name contains "checkout", "checkout" 2× in text
  55  Payment Rules [rule]  examples/vault/Rules/Payment Rules.md
      name contains "payment", "payment" 3× in text
  20  Review Order [page]  examples/vault/Flows/Review Order.md
      "payment" 2× in text, "card" 1× in text, "checkout" 1× in text
  10  ShopLite [product]  examples/vault/ShopLite.md
      "payment" 1× in text, "checkout" 1× in text

$ npm run qa -- graph Payment -d 1
Payment [page] /checkout/payment 🔒
  Checkout Flow [flow] 🔒 → links here
  Payment Rules [rule] → links here
  Shipping [page] /checkout/shipping 🔒 ← linked from here
  Review Order [page] /checkout/review 🔒 → links here
```

"paypal" is new, but the concept it belongs to (payment method) is owned by **Payment**, so this
is an update to known notes, not a gap.

**3 — Decide per note.**

| Note | Impact | Action |
|---|---|---|
| Payment | New field, new behaviour | Add `Payment method` row (`options: Card, PayPal`, example `Card` so existing flows still walk), describe PayPal, add `@SHOP-142` scenario, provenance + keywords |
| Review Order | Displays payment method | "masked card, or 'Paid with PayPal'", provenance |
| Payment Rules | New accepted method; idempotency applies to both | Add rule bullet, provenance |
| Checkout Flow | PO comment asks for guest PayPal checkout, flow is `auth: required` | **Conflict** — comment-only *and* relaxes auth. Callout + RQ-1; fact unchanged |
| ShopLite | Passing mention | none |
| — | Dev comment has a password | **Redacted**, RQ-2 suggests a `credentials.md` persona |

**4 — Result** (`after/`): e.g. `Payment.md` now starts

```yaml
---
type: page
route: /checkout/payment
submit: Continue to review
source: [manual, SHOP-142]
source_updated: 2026-09-30T08:12:44Z
synced_at: 2026-10-01T02:00:05Z
keywords: [payment, payment method, card, card number, cvc, expiry, paypal, checkout]
---
```

and gains a field row and a scenario:

```gherkin
@SHOP-142
Scenario: Customer pays with PayPal
  Given I am logged in as "customer"
  And I am on the "Payment" page
  When I select "PayPal" from "Payment method"
  And I click "Continue with PayPal"
  Then I should be on the "Review Order" page
  And I should see "Paid with PayPal"
```

`manual` marks the facts that were in the vault before any sync. After the sync:

```text
$ npm run qa -- find SHOP-142 --vault examples/kb-worked-example/after
  95  Payment [page]        source SHOP-142 …  · source: manual, SHOP-142
  95  Payment Rules [rule]  source SHOP-142 …  · source: manual, SHOP-142
  90  Review Order [page]   source SHOP-142    · source: manual, SHOP-142
  10  Checkout Flow [flow]  "shop-142" 2× in text        ← mentioned only in the conflict callout

$ npm run qa -- stale --vault examples/kb-worked-example/after
- Checkout Flow (…) — never synced; no-provenance, never-synced, conflict
```

**5 — Commits on `kb/sync-20261001T0200Z`:**

```text
kb(sync): SHOP-142 add PayPal to Payment fields and ACs     (Payment, Review Order, Payment Rules,
                                                              Checkout Flow callout, Review Queue RQ-1/2)
kb(sync): advance watermark to 2026-09-30T08:12:44Z          (_sync/state.md)
```

**6 — PR** `kb(sync): 1 catalog item through 2026-09-30T08:12:44Z`:

> **SHOP-142 Allow PayPal at payment** — Payment (+field *Payment method*, +scenario
> `@SHOP-142`), Review Order (payment method display), Payment Rules (+accepted methods).
> **Conflict RQ-1:** guest PayPal checkout requested in a PO comment; Checkout Flow stays
> `auth: required` until a story with ACs exists. **Redaction RQ-2:** sandbox password in a
> comment not copied. **Coverage:** +1 scenario, +1 field case set (Payment method), 0 new gaps.

Once merged, the next `npm test` generates the PayPal scenario and field-validation cases for
*Payment method*; `qa-triager` will cite SHOP-142 for any failure in them.

## Open questions

- **Watermark location** — `vault/_sync/state.md` (chosen, see above). If several vaults share
  one catalog project, each keeps its own state; a shared store would need locking.
- **Catalog auth in CI** — a read-only service account token in CI secrets is simplest; OAuth-only
  servers (e.g. the Atlassian remote MCP server) need a token broker or a self-hosted server
  with an API token. Decide per organisation.
- **Which statuses are "product behaviour"** — syncing *Ready for QA* gives tests earlier, but
  means the vault can describe unreleased behaviour; tag such scenarios by release if that
  matters.
- **Per-run vs per-story PRs** — per-run is the default (fewer PRs, per-story commits); high-risk
  areas may want per-story PRs with different reviewers.
- **Jira AC field** — there is no standard field; record the custom field id or the description
  heading convention in `state.md` once known.
