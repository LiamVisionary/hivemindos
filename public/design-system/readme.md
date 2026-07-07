# HivemindOS Design System

**HivemindOS** is a local-first control room for agent fleets running across your private machines. It presents complex agent systems — wallets, runtimes, memory layers, machine networks — as a calm, obvious "digital hive": private, coordinated, efficient, modular, and alive. The guiding rule is **simple first, depth on demand**.

This design system captures the product's visual foundations, reusable UI primitives, and a click-through recreation of the control-room dashboard, so designers and agents can produce well-branded HivemindOS interfaces and assets.

## Sources

Built by reading the HivemindOS product codebase and docs (attached read-only):

- **Codebase:** `hivemind-os/` — a Next.js 16 / React 19 + Tauri desktop app. Key reads: `src/app/globals.css` (token source of truth), `src/components/ui/*` (Button, Badge, Card, Checkbox…), `src/components/fleet-hive/*` (the Fleet Hive view + honeycomb tokens), `docs/for-users/product/design-philosophy.md` and `ui-rules.md` (the design brief).
- **GitHub:** https://github.com/LiamVisionary/hivemindos — explore this repo to build richer HivemindOS designs than this system alone captures.
- **Uploaded:** `uploads/app-icon-1024.png` — the app mark (armored bee over blue/gold hexes).

The reader is assumed **not** to have access to these; they are recorded for provenance.

## Brand at a glance

> **Private Swarm Command.** Beauty comes from clarity, coordination, trust, and function.

A beehive metaphor rendered with restraint: dark graphite surfaces, a subtle honeycomb hex texture, warm amber ("honey") highlights used sparingly, and a teal "live/working" signal. The armored-bee mark is the **brand/app icon** — but the product UI itself uses *subtle* hive structure and **avoids** bee mascots, honey-drip visuals, and yellow/black hazard clichés inside the interface.

---

## Content fundamentals

**Voice:** direct, calm, human. Written for a capable but non-technical operator who should never need to understand runtime internals to act safely.

- **Plain language in primary UI.** Say "Set up wallet", "Needs funding", "3 days left", "Requires approval", "Collector offline", "Agent is idle". Avoid primary-UI copy like "Configure x402 CAIP-2 network selector" or "Survival ledger effective balance derivation" — technical language is fine only in advanced views, logs, tooltips, and docs, and should be paired with a plain-English meaning.
- **Person:** addresses the operator as an implied "you"; agents are named third parties ("Planner created the task", "Coder made changes", "Reviewer flagged risks"). **Coordination always keeps attribution** — never "the swarm completed this."
- **Casing:** Sentence case for copy and buttons. ALL-CAPS only for tiny mono eyebrows/labels (with wide letter-spacing). Machine ids and commands stay lowercase mono (`atlas.tail-fern.ts.net`, `hive-env-add GOOGLE_API_KEY`).
- **Emoji:** not used in the interface. Status is carried by dots, badges, and color — not emoji.
- **Empty states teach briefly:** not "No agents found." but "No agent nodes found yet. Install the read-only collector on another Tailscale-connected machine to detect agents inside your private network."
- **Trust is spoken aloud:** "Tailnet-only", "Read-only collector", "No public port", "Stored locally", "Requires approval".
- **Every screen answers three questions:** what is happening, what needs attention, what is the next safe action.

---

## Visual foundations

- **Palette.** Warm-neutral graphite base (`--background #0c0d11`, solid panels `#14161c`, warm off-white hairlines). **Honey/amber is the primary action + brand accent** (`--honey`/`--accent #e7b45c`), used with intent; **mint-teal is reserved strictly for the "live/working" signal** (`--live #6fcdba`). Warm grays carry text (`--fg #f3f0e9` → `--fg-4 #545049`). Status: healthy = mint, attention = honey, risk = warm rose `#e58e85`. A full **warm-paper light theme** (`data-theme="hive-light"`) swaps graphite for cream, honey for ochre, and mint for muted olive.

  > **Note (updated):** this reflects the refined "hive" language now shipping across the Fleet Hive, Wallets, Trade, and Brain views — warm-neutral surfaces, honey-primary pill buttons, mono status pills. It supersedes the earlier cool-teal/`#090b10` shell palette.
- **Type.** **Space Grotesk** (600/700) for display, headings, brand, and tab labels. **Geist** (400–800) for body/UI. **JetBrains Mono** (400–700) for eyebrows, metrics, machine ids, commands. Headlines are tight (line-height ~0.98, tracking 0); mono eyebrows are uppercase with ~1.4px tracking. Loaded from Google Fonts.
- **Backgrounds.** A signature **tessellating honeycomb hex texture** (~9% teal opacity) sits behind everything, over two soft radial glows (teal upper-left, amber upper-right) and a graphite diagonal gradient. No photography; structure over decoration.
- **Cards ("cells").** Solid warm panels (`--panel #14161c`) with a thin warm hairline (`--line-2`), a soft lifted drop shadow (`0 18px 50px -28px rgba(0,0,0,0.7)` + faint inset highlight) and larger rounded corners (`14px`, up to `20px` on order tickets). One card = one main job; compact by default, deep when inspected — never nested into mini-dashboards. Wallets/Trade favor an **editorial layout**: hierarchy from type + spacing and inline stat rows, not nested boxes, with one accent per surface.
- **Buttons & badges are pills.** Buttons use a fully rounded pill shape at medium weight (never bold); the `default` is a honey fill with dark text, ghost/outline are transparent with a warm hairline that brightens on hover. Badges are pills too — soft tinted fill + color-matched border, with an optional mono-uppercase status treatment.
- **The hex cell.** Machines, agents, and the Queen are pointy-top honeycomb hexagons. They **rest**, then **lift** on hover (`translateY(-6px) scale(1.05)`, drop shadow) with a smooth `cubic-bezier(0.22,0.61,0.18,1)` tween; selected cells rest slightly enlarged.
- **Motion.** Calm and meaningful — motion communicates state, not decoration. Live/working dots **pulse** (2.4s ease-in-out ring). Views fade/translate up on enter. Standard easing `cubic-bezier(0.2,0.9,0.2,1)`, ~120–140ms for interactions. Respects `prefers-reduced-motion`.
- **Hover / press.** Hover: subtle brightness lift (~1.06) or a soft secondary tint; hex cells lift off the comb. Press: `scale(0.99)`. Focus: 3px teal ring (`--button-ring`).
- **Borders & shadows.** Thin warm hairlines everywhere (`--line`/`--line-2`/`--line-3`); honey-tinted borders + soft glow for privileged/attention cards; mint-tinted borders for live/working. Soft lifted shadows on floating panels; overlays use `blur(18px)` glass. Focus rings are honey (`2px` outline, `2px` offset, or a `3px` honey-soft ring on fields).
- **Radii.** `9px` fields/small controls, `14px` cards (default), `20px` large panels/order tickets, pill for buttons + badges + chips.

See the **Design System** tab for live specimen cards (Colors, Type, Spacing, Brand).

---

## Iconography

- **Primary icon set: Lucide** (`lucide-react` in the codebase) — thin **1.7px stroke**, round caps and joins, 24×24 line icons drawn in `currentColor`. Navigation glyphs (kanban, chat, wallet, swarm, brain, security) follow this style. When recreating UI, use Lucide (CDN or inline paths at 1.7px stroke) rather than hand-drawn SVG.
- **Bee role portraits (PNG).** Painted armored-bee avatars distinguish agent roles: **Queen** (crowned, the orchestrator) plus workers — Coder, Research, Planner, QA, Ops, Security, Writer, General. Copied into `assets/bees/`. Use inside a `HexCell`.
- **Runtime/product marks (SVG + PNG).** Hermes, OpenAI, OpenClaw, OpenRouter, Bankr, Hyperliquid, Aeon — in `assets/runtimes/`.
- **Brand glyphs (PNG).** Honey-hive icon, honey pot, bee-hives mark — in `assets/brand/`.
- **Emoji:** not used as UI iconography. Unicode is not used as icons. Status is dots + color, not symbols.

---

## Components

Reusable primitives, mirroring the product's `src/components/ui` inventory plus one brand primitive. Mount via `window.HivemindOSDesignSystem_65eabf`.

- **Button** — primary action control. Pill-shaped, medium weight. Variants: default (honey), secondary, outline, ghost, danger, link; sizes xs–lg + icon; `isLoading`.
- **Badge** — human-readable status/label pill. Tones: default (honey), success (mint), warning, danger, honey, live (mint), secondary, outline; optional `mono` uppercase treatment.
- **StatusDot** — pulsing signal dot for machine/agent state (live, working, healthy, scheduled, warning, danger, offline).
- **Card** (+ `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`) — the honeycomb "cell" panel.
- **Checkbox** — square opt-in toggle with honey fill.
- **Segmented** — pill segmented control for view/mode switching (hive/graph/map/list, buy/sell); `subtle` or `solid`.
- **CopyableCodeLine** — mono command/id line with copy button (advanced surface only).
- **HexCell** — the signature honeycomb hexagon tile for agents, machines, and the Queen.

_Feedback:_
- **Tooltip** — hover/focus popover; pair a plain-English meaning with a technical label.
- **Spinner** — spinning ring for pending/loading states (same glyph as Button `isLoading`).
- **Skeleton** — shimmer placeholder for first-load and view switches; compose to mirror the real layout.
- **ProgressBar** — loading bars + metric meters: determinate, indeterminate, or a thin 3px meter (CPU/RAM/survival).

**Intentional additions** (no 1:1 source component, but distilled from the codebase):
- **HexCell** — extracted from the `fleet-hive` `HiveStage`/`primitives`, which build hex cells procedurally; packaged here as a reusable primitive because the honeycomb tile is the brand's core spatial motif.
- **StatusDot** — the `.fr-dot` pattern from `fleet-hive.css`, promoted to a component since status signalling is used across every surface.

---

## UI kits

- **`ui_kits/dashboard/`** — an interactive recreation of the HivemindOS control room. Three screens wired through a hover-expanding left nav rail: **Fleet** (Queen banner + machine/agent honeycomb cards), **Chat** (agent thread with multi-agent attribution), **Wallets** (calm "can agents spend?" surface). Includes light/dark toggle and teaching empty states for Swarm / Brain / Security. Composes the component primitives above.

## Two tracks: design vs. production

This system ships components in **two forms**:

1. **Design track** (`components/`, `guidelines/`, `ui_kits/`) — framework-agnostic plain-React + CSS custom properties, no build step, rendered as standalone HTML. This is what the Design System tab and any HTML mock use.
2. **Production track** (`templates/codebase-handoff/`) — the same components as real **`.tsx` with Tailwind + `class-variance-authority` + Radix + `lucide-react`**, matching the app's `src/components/ui` API, copy-paste-able into the Next.js codebase. See `templates/codebase-handoff/README.md`. (They live under `templates/` only so the compiler doesn't try to bundle their npm imports.)

Both read the same tokens, so a Tailwind `bg-primary` and a `var(--button-primary)` resolve to the same honey.

---

## Index / manifest

- `styles.css` — global entry point (import this one file). `@import`s only.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `effects.css`, `fonts.css`.
- `components/core/` — Button, Badge, StatusDot, Card, Checkbox, Segmented, CopyableCodeLine (+ `.d.ts`, `.prompt.md`, `core.card.html`).
- `components/feedback/` — Tooltip, Spinner, Skeleton, ProgressBar (+ `feedback.card.html`).
- `components/brand/` — HexCell (+ `hexcell.card.html`).
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand).
- `ui_kits/dashboard/` — the control-room recreation (`index.html` + screen `.jsx`).
- `assets/` — `logo/`, `bees/`, `brand/`, `runtimes/`.
- `SKILL.md` — Agent-Skills-compatible entry point.

## Caveats & substitutions

- **Fonts** are loaded from Google Fonts (Space Grotesk, Geist, JetBrains Mono) — the same source the app uses — so no local font files are shipped. If you have licensed local copies, drop them in and add `@font-face` rules.
- The system captures **one product** (the desktop/web control-room dashboard). The codebase contains many deeper surfaces (Swarm, Brain services, Trading, GitLawb, Phone, Scheduler) that are represented here only as nav + teaching empty states.
