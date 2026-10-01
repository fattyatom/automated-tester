# Vault conventions

The tool reads a normal Obsidian vault. Nothing is mandatory, and it degrades gracefully: the more
of these facts a note has, the more it can test. Anything missing appears in `.qa/coverage.md`.

## How a note is classified

| `type:` (frontmatter) | Or inferred when… | Used for |
|---|---|---|
| `page` | the note has `route:` | auth/role guards, field validation, discovery diff |
| `flow` | a `## Flow` / `## Journey` / `## Steps` section lists `[[links]]` | route skipping, state handling |
| `auth` | — | marks the login page (`requires: [[Login]]` then means "auth required") |
| `role` | — | `role: admin` sets the role name used by `roles:` |
| `rule`, `product`, anything else | — | context for agents; shows up in the graph |

Notes are matched by **file name** (like Obsidian), title (`# H1` or `title:`), or `aliases:`.

## Frontmatter keys

```yaml
---
type: page
route: /checkout/payment       # params allowed: /orders/:id or /orders/{id}
auth: required                 # required | public  (omit → inherited through the graph)
roles: ["[[Admin]]"]           # links to role notes or plain names
requires: "[[Login]]"          # a link to the auth note also means auth required
parent: "[[Checkout Flow]]"    # inherit auth/roles from another note (also `part-of`)
submit: Continue to review     # accessible name of the form's submit button
success: Profile saved         # text shown on success when the URL doesn't change
flow: ["[[Shipping]]", "[[Payment]]"]   # alternative to a ## Flow section
fields:                        # alternative to a ## Fields table
  - { name: Email, type: email, required: true, example: a@b.co }
---
```

### How auth and roles are inferred (graph lookup)

1. Explicit `auth:` / `#public` / `#auth-required` tag / `requires: [[<auth note>]]` on the note.
2. Otherwise inherited from any **flow** that includes the page, or a `parent:` / `part-of:` note.
3. Otherwise "assumed public" — listed in coverage.md so somebody confirms it.

Roles inherit the same way. `npm run qa -- feature "<note>"` shows the result and the reason.

## Acceptance criteria

Any section whose heading contains *Acceptance*, *Criteria*, *Scenarios*, *ACs*, *Behaviour* or
*Requirements*. Supported forms, mixed freely:

````markdown
## Acceptance Criteria

```gherkin
@smoke
Scenario: Customer signs in
  Given I am on the "Login" page
  When I fill "Email" with "user@example.com"
  And I click "Sign in"
  Then I should be redirected to the "Dashboard" page
```

Scenario Outline: Postcode validation
  Given I am logged in as "customer"
  And I am on the "Shipping" page
  When I fill "Postcode" with "<code>"
  And I click "Continue to payment"
  Then I should see an error "Postcode must be 4 digits"
  Examples:
    | code  |
    | 123   |
    | 12345 |

- Given I am logged in, when I visit the "Dashboard" page, then I should see "Welcome back"
- The dashboard should feel fast          ← not executable → reported for the ac-normalizer agent
````

Reference pages by **note title** (`"Dashboard"`) rather than by URL, so routes live in one place.
`npm run qa -- steps` lists all supported phrasings.

## Fields

A `## Fields` (or *Inputs* / *Form* / *Validation*) section containing a table:

| Field | Type | Required | Rules | Example |
|---|---|---|---|---|
| Display name | text | yes | max 30 characters | Casey |
| Phone | tel | no | 8-15 digits | 0412345678 |
| Postcode | text | yes | exactly 4 digits | 2000 |
| Expiry | text | yes | pattern `^(0[1-9]\|1[0-2])/\d{2}$` | 12/30 |
| Country | select | yes | options: Australia, New Zealand | Australia |
| Quantity | number | yes | 1-10 | 2 |

- **Field** must match the label (or placeholder / `name`) the UI shows.
- **Rules** understands: `required`, `optional`, `max N`, `min N`, `N-M chars|digits`,
  `exactly N digits`, `at most / at least N`, `email`, `pattern \`regex\``, `options: a, b`.
  Escape `|` inside a regex as `\|` (standard Obsidian table escaping).
- **Example** is the valid value used to fill every *other* field when one field is being
  attacked, and to walk flows. Without it the tool generates a plausible value.

## Flows

```markdown
## Flow
1. [[Shipping]]
2. [[Payment]]
3. [[Review Order]]
4. [[Order Confirmation]]
```

Order matters: step N must not be reachable before steps 1..N-1. Every step needs a `route:`
(and a `submit:` if it has a form) for route skipping and state handling to run.
