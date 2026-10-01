---
type: page
route: /dashboard
auth: required
roles: ["[[Customer]]", "[[Admin]]"]
---
# Dashboard

Home for signed-in users. Links to the [[Checkout Flow]], [[Profile]] and [[Order History]].

## Acceptance Criteria

- Given I am logged in as "customer", when I visit the "Dashboard" page, then I should see "Welcome back, Casey Customer"
- The dashboard should feel fast
