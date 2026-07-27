**Spinner** — the loading-state glyph: a ring with a spinning honey arc. Same indicator the Button shows when `isLoading`. Use for pending actions and inline "working" states.

```jsx
<Spinner />
<Spinner tone="live" label="Verifying collector…" />
<Button isLoading>Sending</Button>
```

Tones: `honey` (default), `live`, `current` (inherits text color).
