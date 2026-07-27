**Card** — the base "cell". Every machine, agent, wallet, task, or setup prompt is a card with one identity, one primary status, one main job, one safe action. Compact by default, deep when inspected. Don't nest cards into miniature dashboards.

```jsx
<Card>
  <CardHeader>
    <CardTitle>atlas</CardTitle>
    <CardDescription>macOS 15.3 · M3 Max · Studio, Brooklyn</CardDescription>
  </CardHeader>
  <CardContent>3 agents · 2 working</CardContent>
  <CardFooter><Button size="sm">Open details</Button></CardFooter>
</Card>
```

Sub-parts: `CardHeader`, `CardTitle` (Space Grotesk), `CardDescription` (muted), `CardContent`, `CardFooter`.
