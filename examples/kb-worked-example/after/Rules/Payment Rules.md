---
type: rule
source: [manual, SHOP-142]
source_updated: 2026-09-30T08:12:44Z
synced_at: 2026-10-01T02:00:05Z
keywords: [payment, idempotent, double charge, paypal, card]
---
# Payment Rules

- [[Payment]] is only reachable after [[Shipping]].
- [[Review Order]] is only reachable after [[Payment]].
- Placing an order must be idempotent — double clicks must not charge twice.
- Accepted payment methods: card and PayPal (SHOP-142). A PayPal payment is approved on PayPal
  before [[Review Order]]; the order is only placed when the customer clicks "Place order", and
  the idempotency rule above applies to both methods.
