---
type: credentials
# Demo credentials for the bundled ShopLite app. Committed on purpose (public demo values) —
# a real vault's credentials.md is git-ignored; see vault/sample.credentials.md.
baseURL: http://localhost:4321
landing: /
login:
  route: /login
  usernameField: Email
  passwordField: Password
  submit: Sign in
  failureMessage: Invalid email or password
  protectedRoutes: [/dashboard, /profile]
logout:
  route: /logout
  landsOn: /login
personas:
  customer:
    username: ${QA_CUSTOMER_USER:-user@example.com}
    password: ${QA_CUSTOMER_PASS:-Passw0rd!}
    roles: [customer]
    landsOn: /dashboard
    welcomeText: Welcome back
  admin:
    username: ${QA_ADMIN_USER:-admin@example.com}
    password: ${QA_ADMIN_PASS:-Admin123!}
    roles: [admin]
    landsOn: /dashboard
---
# Credentials

How to get into [[ShopLite]]: sign in on [[Login]], land on the [[Dashboard]].
Personas: [[Customer]], [[Admin]]. Session behaviour: [[Session Rules]].
