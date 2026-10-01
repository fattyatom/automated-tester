---
type: page
route: /profile
auth: required
submit: Save profile
success: Profile saved
---
# Profile

Where a [[Customer]] edits their public details. The display name appears in the [[Dashboard]] greeting.

## Fields

| Field        | Type     | Required | Rules                   | Example     |
|--------------|----------|----------|-------------------------|-------------|
| Display name | text     | yes      | max 30 characters       | Casey       |
| Phone        | tel      | no       | 8-15 digits             | 0412345678  |
| Bio          | textarea | no       | max 200 characters      | Hello there |

## Acceptance Criteria

Scenario: Customer updates display name
  Given I am logged in as "customer"
  And I am on the "Profile" page
  When I fill "Display name" with "Casey QA"
  And I click "Save profile"
  Then I should see "Profile saved"
  And the "Display name" field should contain "Casey QA"

Scenario: Display name is required
  Given I am logged in as "customer"
  And I am on the "Profile" page
  When I clear the "Display name" field
  And I submit the profile form without JavaScript validation
  Then I should see an error "Display name is required"
