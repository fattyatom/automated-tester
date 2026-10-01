---
type: page
route: /checkout/payment
submit: Continue to review
---
# Payment

Step 2 of the [[Checkout Flow]]. Rules in [[Payment Rules]].
Cannot be opened before [[Shipping]] is complete.

## Fields

| Field       | Type | Required | Rules                          | Example          |
|-------------|------|----------|--------------------------------|------------------|
| Card number | text | yes      | exactly 16 digits              | 4242424242424242 |
| Expiry      | text | yes      | pattern `^(0[1-9]\|1[0-2])/\d{2}$` | 12/30 |
| CVC         | text | yes      | exactly 3 digits               | 123              |
