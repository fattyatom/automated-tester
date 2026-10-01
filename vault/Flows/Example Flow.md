---
type: flow
auth: required
tags: [critical-path]
---
# Example Flow

> Rename this note to your most important journey and replace the steps. Each step is its own
> page note with a `route:` (and `submit:` if it has a form). Order matters: the tool opens step
> N directly without doing steps 1..N-1 and expects to be stopped.

Governed by [[Authentication Rules]]. Starts from the [[Dashboard]].

## Flow

%%
1. [[Step One]] — e.g. choose a plan
2. [[Step Two]] — e.g. enter details
3. [[Step Three]] — e.g. review and confirm
4. [[Done]] — e.g. confirmation page
%%

## Acceptance Criteria

%%
Scenario: User completes the journey
  Given I am logged in as "standard"
  And I am on the "Step One" page
  When I fill in the form with valid data
  And I click "Continue"
  Then I should be on the "Step Two" page
%%
