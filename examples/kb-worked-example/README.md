# Worked example: syncing "Allow PayPal at payment" (SHOP-142)

A fictional catalog story applied to the ShopLite example vault by the `kb-sync` agent, as
walked through in [docs/KNOWLEDGE_BASE.md → Worked example](../../docs/KNOWLEDGE_BASE.md#worked-example).

- `catalog/SHOP-142.json` — the story as the catalog MCP server returns it.
- `after/` — only the notes the sync changed, as they look after the sync PR. Layer it over
  `examples/vault` to get the post-sync vault:

  ```bash
  npm run qa -- find paypal                                     # before: nothing → new knowledge
  npm run qa -- find payment card checkout                      # before: impact candidates
  npm run qa -- find SHOP-142 --vault examples/kb-worked-example/after   # after: notes citing the story
  npm run qa -- stale --vault examples/kb-worked-example/after           # after: the open conflict
  ```

`examples/vault` itself is unchanged: the demo app does not implement PayPal, and the example
vault must keep describing the demo app. `tests/unit/provenance.spec.ts` loads both folders to
check the example stays consistent with the parser.
