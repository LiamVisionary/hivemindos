**ProgressBar** — loading bars and metric meters. Three modes: **determinate** (a known percentage), **indeterminate** (sweeps for unknown-duration work), and a **thin meter** (`thickness={3}`) for CPU/RAM/disk/survival readouts.

```jsx
// Determinate loading / setup progress
<ProgressBar value={62} label="Syncing vault" />

// Unknown-duration work
<ProgressBar indeterminate tone="live" />

// Thin capacity meter (the fleet fr-meter)
<ProgressBar value={71} thickness={3} tone="honey" />
<ProgressBar value={92} thickness={3} tone="danger" />
```

Tones: `honey` (default), `live`, `danger`, `neutral`. Use `danger` when a meter is near its limit.
