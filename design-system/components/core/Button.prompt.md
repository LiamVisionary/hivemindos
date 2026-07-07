**Button** — the primary action control. Honey (amber) `default` for the one main action per surface; `secondary`/`outline`/`ghost` for supporting actions; `danger` for destructive/money-moving actions (keep separated from read-only status).

```jsx
<Button variant="default" size="default">Set up wallet</Button>
<Button variant="outline" size="sm">Details</Button>
<Button variant="ghost" size="icon" aria-label="More">⋯</Button>
<Button variant="danger">Remove agent</Button>
```

Variants: `default` (honey primary, dark text), `secondary`, `outline`, `ghost`, `danger`, `link`. Sizes: `xs`, `sm`, `default`, `lg`, `icon`. All buttons are pill-shaped and medium weight (never bold). Pass `isLoading` for a spinner. One loud action per card — everything else is quieter.
