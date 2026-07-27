# Codebase handoff — production `.tsx` components

Production-faithful React components that mirror the HivemindOS app's own `src/components/ui` API — **real `.tsx` with Tailwind classes, `class-variance-authority` variants, Radix primitives, and `lucide-react` icons**. Drop these into the app (or any Next.js 16 / React 19 + Tailwind v4 project) and they compile as-is.

> This is the **production track**. The rest of the design system (`components/`, `guidelines/`, `ui_kits/`) uses framework-agnostic plain-React + CSS-variable recreations so they render as standalone HTML for design tooling. These files are the copy-paste-into-the-codebase versions. They live under `templates/` only so the design-system compiler doesn't try to bundle them (it can't resolve npm imports) — they are **not** a starting-point template.

## What's here

- `ui/button.tsx` — `Button` + `buttonVariants` (default/secondary/outline/ghost/danger/link; xs/sm/default/lg/icon; `asChild`, `isLoading`). Verbatim-compatible with the app's `button.tsx`, retuned to the honey-pill language.
- `ui/badge.tsx` — `Badge` + `badgeVariants` (default/secondary/success/warning/danger/honey/live/outline; `mono` for the uppercase status-chip style).
- `ui/card.tsx` — `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`.
- `ui/checkbox.tsx` — `Checkbox` (Radix).
- `ui/tooltip.tsx` — `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` (Radix).
- `ui/segmented.tsx` — `Segmented` pill view/mode switch (subtle/solid).
- `ui/status-dot.tsx` — `StatusDot` (pulsing signal).
- `ui/spinner.tsx` — `Spinner` (lucide `LoaderCircle`).
- `ui/skeleton.tsx` — `Skeleton` shimmer.
- `ui/progress-bar.tsx` — `ProgressBar` (determinate / indeterminate / thin meter).
- `ui/hex-cell.tsx` — `HexCell` honeycomb tile.
- `lib/cn.ts` — the `cn()` class-merge helper (matches the app's `@/lib/utils`).

## Dependencies

```
react react-dom
class-variance-authority
clsx tailwind-merge
lucide-react
@radix-ui/react-checkbox @radix-ui/react-tooltip @radix-ui/react-slot
radix-ui        # button.tsx uses the umbrella `Slot` re-export, matching the app
tailwindcss     # v4
```

Imports use the `@/lib/utils` path alias for `cn` (same as the app). If your alias differs, change the import in each file, or point them at `../lib/cn`.

## Tokens & keyframes

These components read the design system's CSS custom properties (`--honey`, `--live`, `--panel`, `--line-2`, …) and the Tailwind theme utilities (`bg-primary`, `text-primary-foreground`, `border-border`, `ring-ring`). In the app those come from `globals.css`'s `@theme inline` block — this design system ships the same values in `styles.css` / `tokens/`.

A few components use keyframes that aren't in Tailwind by default — add these once to your global CSS (each file also notes its own in a trailing comment):

```css
@keyframes hive-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 50%, transparent); }
  50%      { box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 0%, transparent); }
}
@keyframes hive-shimmer { 100% { transform: translateX(100%); } }
@keyframes hive-progress { 0% { left: -40%; } 100% { left: 100%; } }
@keyframes hive-breathe { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
```

## Parity note

The API matches the app; the values match the refined hive language (honey primary, mint live signal, pill buttons/badges, solid warm panels). Where the shipped `src/components/ui` differs (it predates this palette pass), treat these as the updated reference — but always defer to the live app source if it has moved on again.
