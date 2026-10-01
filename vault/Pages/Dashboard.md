---
type: page
route: /dashboard
auth: required
roles: ["[[Standard User]]", "[[Admin]]"]
---
# Dashboard

First page after [[Login]] for a [[Standard User]]. Entry point to the [[Example Flow]].

> Edit `route:` above to match your site. Describe what's on the page and link out to every page
> it leads to — the crawler compares those links with what it finds live.

## Acceptance Criteria

%%
Scenario: Signed-in user sees their dashboard
  Given I am logged in as "standard"
  When I navigate to the "Dashboard" page
  Then I should see "Welcome"
%%
