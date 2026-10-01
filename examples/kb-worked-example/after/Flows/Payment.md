---
type: page
route: /checkout/payment
submit: Continue to review
source: [manual, SHOP-142]
source_updated: 2026-09-30T08:12:44Z
synced_at: 2026-10-01T02:00:05Z
keywords: [payment, payment method, card, card number, cvc, expiry, paypal, checkout]
---
# Payment

Step 2 of the [[Checkout Flow]]. Rules in [[Payment Rules]].
Cannot be opened before [[Shipping]] is complete.

The customer pays by card (default) or with PayPal. Choosing PayPal hides the card fields and the
button reads "Continue with PayPal"; after approving on PayPal the customer returns to
[[Review Order]].

## Fields

| Field          | Type   | Required | Rules                                               | Example          |
|----------------|--------|----------|-----------------------------------------------------|------------------|
| Payment method | select | yes      | options: Card, PayPal                               | Card             |
| Card number    | text   | yes      | exactly 16 digits; only shown when method is Card   | 4242424242424242 |
| Expiry         | text   | yes      | pattern `^(0[1-9]\|1[0-2])/\d{2}$`                  | 12/30            |
| CVC            | text   | yes      | exactly 3 digits                                    | 123              |

## Acceptance Criteria

```gherkin
@SHOP-142
Scenario: Customer pays with PayPal
  Given I am logged in as "customer"
  And I am on the "Payment" page
  When I select "PayPal" from "Payment method"
  And I click "Continue with PayPal"
  Then I should be on the "Review Order" page
  And I should see "Paid with PayPal"
```
