**Segmented** — a pill segmented control for switching between a small set of views or modes (the hive/graph/map/list switcher, wallet view toggles, buy/sell). Controlled or uncontrolled.

```jsx
// View switch — subtle Hivemind accent tint on the active segment
<Segmented options={["Hive", "Graph", "Map", "List"]} defaultValue="Hive" />

// Binary toggle — solid fill, per-option tone
<Segmented
  variant="solid"
  options={[{ value: "buy", label: "Buy" }, { value: "sell", label: "Sell", tone: "sell" }]}
  value={side}
  onChange={setSide}
/>
```

Use `subtle` (default) for navigation between views; `solid` for a committing binary choice. Keep it to 2–4 short options.
