**StatusDot** — a tiny signal dot for machine/agent state; `live` and `working` pulse to show activity. The clearest way to answer "what is happening?" at a glance.

```jsx
<StatusDot tone="working" label="Working" />
<StatusDot tone="healthy" label="Healthy" />
<StatusDot tone="scheduled" label="Scheduled · 02:00 UTC" />
<StatusDot tone="danger" label="Auth failed" />
```

Tones: `live`/`working` (teal, pulsing), `ready`, `healthy`, `scheduled` (honey), `warning`, `danger`, `offline`. Pass `pulse` to override the default animation.
