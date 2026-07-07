**Checkbox** — a square toggle for opt-in choices (e.g. "opted into shared vault"). Teal fill when checked. Controlled or uncontrolled.

```jsx
<Checkbox defaultChecked label="Opt in to shared brain" />
<Checkbox checked={on} onCheckedChange={setOn} label="Require approval for spends" />
```
