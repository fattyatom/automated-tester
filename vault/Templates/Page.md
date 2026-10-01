---
type: page
route: /path/here
auth: required
roles: []
submit: 
success: 
source: []          # catalog ids (SHOP-142) or local:<path>; kb agents fill these in
source_updated: 
synced_at: 
keywords: []
---
# {{title}}

What this page is for, in one or two sentences. Who uses it: [[Standard User]].
Part of: [[Product Overview]]. Rules: [[ ]].

## Fields

| Field | Type | Required | Rules | Example |
|-------|------|----------|-------|---------|
|       | text | yes      | max 50 |        |

## Acceptance Criteria

Scenario: 
  Given I am logged in as "standard"
  And I am on the "{{title}}" page
  When 
  Then 
