# HivemindOS Dashboard — UI kit

An interactive, cosmetic recreation of the HivemindOS local-first control room. Composes the design system's component primitives (`window.HivemindOSDesignSystem_65eabf`).

## Screens

- **Fleet** (`FleetScreen.jsx`) — the default view. A Queen orchestrator banner, then machines as honeycomb cards (machines first, agents second), each agent a `HexCell` petal with a status badge and its current task. Click any agent's **Chat** to jump to the chat screen.
- **Chat** (`ChatScreen.jsx`) — a recent-chats rail + agent thread + composer. Demonstrates **coordination with attribution** (Planner / Coder / Reviewer blocks). Type and send to see a canned agent reply.
- **Wallets** (`WalletsScreen.jsx`) — the calm "can agents spend safely?" surface: a summary strip + per-agent wallet cards, with money-moving actions kept separate from read-only status.
- **Swarm / Brain / Security** — teaching empty states (per the design brief's empty-state rules).

## Structure

- `index.html` — shell styles (honeycomb backdrop, nav rail, screen layouts) + script loading. Tagged as a `@dsCard` (group "HivemindOS App") and a `@startingPoint`.
- `shell.jsx` — `NavRail`, `TopBar`, `HealthChip`; exports to `window`.
- `app.jsx` — `DashboardApp`: view switching + light/dark theme toggle.

Load order matters: React → Babel → `_ds_bundle.js` → `shell.jsx` → screen files → `app.jsx`.

This is a recreation for design reference, not production code — interactions are faked and data is mock (drawn from `src/components/fleet/fleet-data.ts`).
