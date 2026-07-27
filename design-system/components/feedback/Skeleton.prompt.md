**Skeleton** — a shimmer placeholder shown on first load and view switches. Compose several to mirror the real layout so the page doesn't jump when data arrives.

```jsx
// A loading agent row
<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
  <Skeleton w={28} h={28} r={9} />
  <div style={{ flex: 1 }}>
    <Skeleton w="55%" h={11} />
    <Skeleton w="35%" h={9} style={{ marginTop: 5 }} />
  </div>
  <Skeleton w={70} h={12} />
</div>
```

Sizes are explicit (`w`, `h`, `r`) so skeletons match the elements they stand in for. Shimmer respects `prefers-reduced-motion`.
