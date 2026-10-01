---
type: page
route: /admin
auth: required
roles: ["[[Admin]]"]
---
# Admin Panel

Operational stats. Only the [[Admin]] role may access it.

## Acceptance Criteria

Scenario: Admin sees the panel
  Given I am logged in as "admin"
  When I visit the "Admin Panel" page
  Then I should see "active sessions"
