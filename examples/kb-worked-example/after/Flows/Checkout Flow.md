---
type: flow
auth: required
tags: [revenue, critical-path]
---
# Checkout Flow

The money path. Must be completed in order — later steps depend on data from earlier ones
(see [[Payment Rules]]).

## Flow

1. [[Shipping]] — where to send it
2. [[Payment]] — card details
3. [[Review Order]] — confirm and place the order
4. [[Order Confirmation]] — receipt

## Acceptance Criteria

```gherkin
@smoke
Scenario: Customer completes checkout
  Given I am logged in as "customer"
  And I am on the "Shipping" page
  When I fill "Full name" with "Casey Customer"
  And I fill "Address" with "1 Test Street"
  And I fill "Postcode" with "2000"
  And I select "Australia" from "Country"
  And I click "Continue to payment"
  Then I should be on the "Payment" page
  When I fill "Card number" with "4242424242424242"
  And I fill "Expiry" with "12/30"
  And I fill "CVC" with "123"
  And I click "Continue to review"
  Then I should be on the "Review Order" page
  When I click "Place order"
  Then I should be on the "Order Confirmation" page
  And I should see "is confirmed"
```

## Sync conflicts

> [!conflict] RQ-1 · SHOP-142 (comment, 2026-09-29) vs `auth: required` (manual)
> **Existing:** the whole Checkout Flow requires login (`auth: required`).
> **SHOP-142 comment:** "guests should be able to pay with PayPal without logging in".
> Not applied: a comment is not an accepted criterion, and it relaxes an auth rule. Tracked as
> RQ-1 in `_sync/Review Queue.md`.
