**HexCell** — the brand's core spatial motif: a pointy-top honeycomb hexagon tile. Every agent, machine, and the Queen orchestrator lives in one. Holds a bee portrait, runtime icon, or glyph.

```jsx
<HexCell tone="honey" pulse size={110}>
  <img src="assets/bees/queen-bee.png" alt="Queen" style={{width:'100%'}} />
</HexCell>
<HexCell tone="live" pulse><img src="assets/bees/worker-bee-code.png" alt="" /></HexCell>
<HexCell tone="danger"><img src="assets/bees/worker-bee-ops.png" alt="" /></HexCell>
```

Tones: `honey` (Queen/privileged), `live` (working, use `pulse`), `neutral`, `danger`. Lifts on hover automatically. Keep the hive geometry subtle — this is structure, not a mascot.
