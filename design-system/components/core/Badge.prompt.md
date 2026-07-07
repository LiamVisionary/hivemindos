**Badge** — a compact pill for a single human-readable status or label. Prefer plain words ("Running", "Needs funding", "Tailnet-only") over technical strings.

```jsx
<Badge variant="success">Healthy</Badge>
<Badge variant="warning">Needs funding</Badge>
<Badge variant="danger">Requires approval</Badge>
<Badge variant="honey">Queen</Badge>
<Badge variant="secondary">Tailnet-only</Badge>
```

Tones: `default` (honey), `success` (mint), `warning` (honey), `danger`, `honey`, `live` (mint), `secondary`, `outline`. Pass `mono` for the uppercase JetBrains-Mono status-chip treatment. Badges are pill-shaped. Use `success/warning/danger` for state; `honey` for privileged/orchestrator roles; `live` for working; `secondary/outline` for neutral metadata.
