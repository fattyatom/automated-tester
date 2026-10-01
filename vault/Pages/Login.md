---
type: auth
auth: public
# route: comes from credentials.md (login.route) — set it here only to override.
---
# Login

Where [[Standard User]] and [[Admin]] sign in. Success leads to the [[Dashboard]].
Login behaviour (redirects, wrong password, logout) is generated from `credentials.md` — see
[[Authentication Rules]] for the rules behind it.

## Fields

%%
Uncomment and match the labels on your login form. With rules, the tool will try empty,
malformed and injection values against them (as a user, then with browser validation removed).

| Field    | Type     | Required | Rules       |
|----------|----------|----------|-------------|
| Email    | email    | yes      | valid email |
| Password | password | yes      |             |
%%

## Acceptance Criteria

- Locked out after too many failed attempts (how many? what message?) — ask the PO
