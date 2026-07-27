# Application Source Rules

These rules apply under `src/` in addition to the repository root instructions. Read a deeper `AGENTS.md` when present.

## Structure And Types

- Prefer small domain-focused modules, short functions, explicit exports, guard clauses, and isolated I/O. Avoid `any`; narrow `unknown` at external boundaries.
- Check the established capability/default/feature matrix before branching by runtime, provider, agent kind, machine, payment rail, or integration. Extend a typed matrix when behavior will recur.
- Keep code DRY and single-purpose. Do not add speculative helpers, compatibility shims, fallback branches, or abstractions outside the requested contract.
- Code files must stay under 1,500 lines. Extract from oversized legacy files instead of adding more. Run `node scripts/check-file-sizes.mjs` before pushing.

## Canonical Surfaces

- API responses use `okJson`, `errorJson`, or `upstreamErrorJson` from `src/lib/utils/api-response.ts`.
- Tauri/browser dual calls use `nativeOrFetch` from `src/lib/native/bridge.ts`.
- Durable UI state uses `/api/dashboard/state`, the dashboard-state services, or `useRememberedDashboardValue`; browser storage is only for disposable per-tab state.
- Environment access uses the helpers in `src/lib/config/env.ts`; credentials stay in the shared hive env and never enter client bundles.
- Dashboard navigation derives from `DASHBOARD_ROUTE_CATALOG_BY_ID`. Fleet visibility and OS predicates derive from `src/features/fleet/fleet-identity.ts`.
- Crypto and payment behavior derives from `CRYPTO_PROVIDER_MATRIX` and `AGENT_PAYMENT_PROVIDER_FEATURES`.
- Runtime detection must be portable across platforms and sparse GUI-like `PATH` values. Never depend on a developer home path or one runtime's private venv layout.

## Commercial Trust

- Treat the downloadable client, browser UI, local API, local env, local vault, feature flags, and local storage as hostile for official commercial authority.
- Official price, entitlement, quota, credit, fee, recipient, payout, managed provider access, and revenue decisions belong in HivemindOS-controlled infrastructure or verifiable settlement systems. Local surfaces may display or cache decisions but cannot grant official value.
- Official hosted-service source belongs in the private sibling `../hivemind-cloud-services`, not this public repo's `workers/` tree. Build client and hosted sides in the same task when a feature spans both; keep contracts compatible and verify both.
- Before answering or changing pricing, free quota or free allowance, membership-tier discount, provider or infrastructure cost, cost floor, margin, reserves, allocations, or hosted availability, query the live commercial catalog named in the root instructions.
- Whenever commercial value changes, update the owning service payload and catalog adapter/contracts in the same change, then verify the focused and aggregate deployed catalog. Missing accounting components must remain explicit; do not infer them or silently substitute zero.
- HIVE buyback percentages are configured only in `../hivemind-cloud-services/workers/paid-agent-gateway/src/commercial-service-policy.ts`. Never add a service-local `*_BUYBACK_ALLOCATION_BPS` knob, fallback, or duplicate percentage constant.
- Self-hosted/BYOK flows must remain useful and explicitly separate from official managed flows. Never ship official secrets, signing keys, treasury keys, private wallets, or authoritative policy.
- Add trust-boundary tests that prove client-supplied recipients, prices, credits, entitlements, tenant IDs, and quotas cannot grant official value.

## UI Contract

- Read `DESIGN.md` and reuse design-system controls. Interactive control labels must use font weight `400–600`, normally `500`; reserve `700+` for display headings and large metrics. UI changes must pass `guard:ui-typography`.
- Do not silently truncate user-facing text. Use wrapping or an explicit expand/collapse affordance.
- Primary configuration uses discovered choices, pickers, toggles, or browse flows. Put genuinely arbitrary input in a labeled Advanced area.
- Every pending state must animate. Prefer content-shaped skeletons, then a loading bar, then an inline spinner. Never show a static `Loading…` label.
- Directory selection uses `chooseDirectoryForMachine` or `loadMachineDirectories` with a complete machine target. Preserve local-versus-remote collector identity and use unique picker values.

## Performance And Persistence

- Read `PERFORMANCE_GOTCHAS.md` before diagnosing mysterious desktop or dev lag. Read `OPTIMIZATIONS.md` before changing performance-sensitive paths.
- Record material cache, polling, timeout, debounce, lazy-load, expensive-work deferral, or prompt-size changes in `OPTIMIZATIONS.md` with evidence and tradeoffs.
- Store compact operational state in the app first; promote only durable reviewed knowledge to Shared Brain Memory. Do not send high-volume telemetry into the shared brain.
