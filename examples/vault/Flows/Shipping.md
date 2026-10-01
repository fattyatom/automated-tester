---
type: page
route: /checkout/shipping
submit: Continue to payment
---
# Shipping

Step 1 of the [[Checkout Flow]].

## Fields

| Field     | Type   | Required | Rules                          | Example        |
|-----------|--------|----------|--------------------------------|----------------|
| Full name | text   | yes      | max 60                         | Casey Customer |
| Address   | text   | yes      |                                | 1 Test Street  |
| Postcode  | text   | yes      | exactly 4 digits               | 2000           |
| Country   | select | yes      | options: Australia, New Zealand | Australia      |
