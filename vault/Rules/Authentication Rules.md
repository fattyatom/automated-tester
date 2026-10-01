---
type: rule
---
# Authentication Rules

Applies to [[Login]], the [[Dashboard]] and everything behind them.

- Anonymous visitors to protected pages are sent to [[Login]] (list them in `credentials.md`).
- After logout, protected pages are closed again.
- If the session expires mid-[[Example Flow]], the user is sent to [[Login]] and nothing is saved.
- Session lifetime: _unknown — ask the PO_
