---
type: auth
route: /login
auth: public
submit: Sign in
tags: [auth]
---
# Login

Entry point for all [[Customer]] and [[Admin]] users. On success the user goes to the [[Dashboard]].
Session lifetime is described in [[Session Rules]].

## Fields

| Field    | Type     | Required | Rules            | Example          |
|----------|----------|----------|------------------|------------------|
| Email    | email    | yes      | valid email      | user@example.com |
| Password | password | yes      |                  | Passw0rd!        |

## Acceptance Criteria

```gherkin
Scenario: Customer signs in successfully
  Given I am on the "Login" page
  When I fill "Email" with "user@example.com"
  And I fill "Password" with "Passw0rd!"
  And I click "Sign in"
  Then I should be redirected to the "Dashboard" page
  And I should see "Welcome back"

Scenario: Wrong password is rejected
  Given I am on the "Login" page
  When I fill "Email" with "user@example.com"
  And I fill "Password" with "nope"
  And I click "Sign in"
  Then I should see an error "Invalid email or password"
  And I should remain on the "Login" page
```

- Login should be rate-limited after 5 failed attempts
