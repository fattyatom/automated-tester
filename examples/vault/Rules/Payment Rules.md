---
type: rule
---
# Payment Rules

- [[Payment]] is only reachable after [[Shipping]].
- [[Review Order]] is only reachable after [[Payment]].
- Placing an order must be idempotent — double clicks must not charge twice.
