---
type: meta
---
# Review queue

| ID | Date | Kind | Notes | Catalog items | Finding | Proposed action | Status |
|---|---|---|---|---|---|---|---|
| RQ-1 | 2026-10-01 | conflict | [[Checkout Flow]] | SHOP-142 | A PO comment asks for guest PayPal checkout; the flow is `auth: required` (manual). Relaxes an auth rule. | Ask the PO to raise a story with ACs for guest checkout, or confirm login stays required. | open |
| RQ-2 | 2026-10-01 | redaction | — | SHOP-142 | A comment contained a PayPal sandbox password; not copied. | Move the sandbox buyer into `credentials.md` (git-ignored) as a persona if tests need it. | open |
