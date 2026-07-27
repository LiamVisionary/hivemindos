**HexCell** — the brand's core spatial motif: a pointy-top honeycomb hexagon tile. Every agent, machine, and the Queen orchestrator lives in one. Dense maps use flat glyphs and horizontal names; identity surfaces may hold a bee portrait or runtime mark.

```jsx
<HexCell tone="honey" pulse size={110}>
  <img src="assets/bees/queen-bee.png" alt="Queen" style={{width:'100%'}} />
</HexCell>
<HexCell tone="neutral"><Code2 aria-hidden /></HexCell>
<HexCell tone="danger"><Wrench aria-hidden /></HexCell>
```

Tones: `honey` (Queen/privileged), `live` (working, use `pulse`), `neutral`, `danger`. Lifts on hover automatically. Keep the hive geometry subtle — this is structure, not a mascot.
