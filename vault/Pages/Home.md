---
type: page
route: /
auth: public
---
# Home

The public landing page. Links to [[Login]]. Part of [[Product Overview]].

## Acceptance Criteria

%%
Uncomment and edit once you know the page — text inside %% %% is ignored by Obsidian *and* by the tool.

Scenario: Visitor sees the value proposition
  Given I am not logged in
  When I navigate to the "Home" page
  Then I should see "Your headline here"
  And the page title should contain "Your brand"

Scenario: Visitor can get to sign in
  Given I am not logged in
  And I am on the "Home" page
  When I click "Sign in"
  Then I should be on the "Login" page
%%
