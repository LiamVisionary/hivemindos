**Tooltip** — a small hover/focus popover. Use it to attach a plain-English meaning to a technical label, icon button, or metric — never to hide something the user needs to act on.

```jsx
<Tooltip content="Where this agent receives and spends funds." side="top">
  <span style={{ borderBottom: "1px dotted var(--fg-4)" }}>Base wallet</span>
</Tooltip>

<Tooltip content="Read-only collector · no public port" side="right">
  <Button variant="ghost" size="icon">i</Button>
</Tooltip>
```

Sides: `top` (default), `bottom`, `left`, `right`. ~120ms delay, fades + zooms in.
