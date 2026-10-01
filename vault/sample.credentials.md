---
type: credentials
# ─────────────────────────────────────────────────────────────────────────────────────────────
#  TEMPLATE — committed to git. Do NOT put real secrets here.
#  1. Copy this file to `credentials.md` in the same folder (that file is git-ignored).
#  2. Fill in your site's values. Anything can reference env vars: ${VAR} or ${VAR:-default}
#     — handy for CI, or to keep passwords out of the vault entirely.
#  The QA tool reads ONLY credentials.md; this sample is ignored by the test run.
# ─────────────────────────────────────────────────────────────────────────────────────────────

# Where the site lives (QA_BASE_URL overrides this for one-off runs).
baseURL: https://staging.example.com

# Expected landing page for an anonymous visitor who opens baseURL.
# "/" for a public homepage; "/login" if the whole site is behind a login.
landing: /

login:
  # Expected login page — where protected pages should redirect anonymous visitors.
  route: /login
  # Visible label (or placeholder / name attribute) of the login inputs and button.
  usernameField: Email
  passwordField: Password
  submit: Sign in
  # Exact text shown for a wrong password (leave empty if you don't know yet).
  failureMessage: Invalid email or password
  # Pages that must bounce anonymous visitors to the login page.
  protectedRoutes:
    - /dashboard
    - /account

logout:
  # Either a route that logs out, or the visible text of the logout button/link.
  route: /logout
  # button: Sign out
  # Where the user should end up after logging out.
  landsOn: /login

personas:
  # One entry per kind of user. Names are referenced in ACs: Given I am logged in as "standard".
  standard:
    username: ${QA_STANDARD_USER:-qa.standard@example.com}
    password: ${QA_STANDARD_PASS}
    roles: [standard]
    # Expected page right after login, and text that proves it worked.
    landsOn: /dashboard
    welcomeText: Welcome
  admin:
    username: ${QA_ADMIN_USER:-qa.admin@example.com}
    password: ${QA_ADMIN_PASS}
    roles: [admin]
    landsOn: /admin
---
# Credentials

How the QA tool gets into the product. Expected behaviour derived from the fields above runs as
acceptance tests automatically (tagged `@auth`):

- An anonymous visitor opening the site lands on `landing`.
- Every `protectedRoutes` entry redirects an anonymous visitor to the [[Login]] page.
- Each persona logs in and lands on its `landsOn` page (and sees `welcomeText`).
- A wrong password keeps the user on [[Login]] and shows `failureMessage`.
- Logging out lands on `logout.landsOn`, and protected pages are closed again.

Personas map to [[Standard User]] and [[Admin]]. Session rules: [[Authentication Rules]].

## Notes for whoever fills this in

- Use **dedicated test accounts** on a **non-production** environment — exploratory charters
  submit forms, double-click buttons and tamper with URLs.
- MFA / SSO? Set `login` here anyway (for routes), and add a custom `login()` in `qa.config.ts`.
- Anything you write in this note's body is visible to agents (passwords in frontmatter are
  masked automatically); keep secrets in the frontmatter or in env vars.
