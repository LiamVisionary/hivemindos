# MiroShark And Runtime Gateways

MiroShark is the rehearsal room.

It is optional, but useful when a swarm plan needs simulation before real execution. HivemindOS also keeps a small runtime gateway layer for runtimes such as OpenClaw when they are used as agents in Fleet and Chat.

## MiroShark

How it works:

- Companion client: `src/lib/services/miroshark/companion-client.ts`.
- Dashboard routes: `/api/miroshark/status`, `/api/miroshark/manage`, `/api/miroshark/swarm`, `/api/miroshark/runs`, `/api/miroshark/analysis`.
- Swarm transformations live in `src/features/swarm`.

What MiroShark support can do:

- Detect, install, start, and open MiroShark.
- List templates and run metadata.
- Start scenario simulations.
- Fetch run status, summaries, reports, transcripts, exports, telemetry, market events, observability events, LLM calls, and intelligence where the companion exposes them.
- Send simulation output back into agent or Kanban workflows.
- Load archived runs from the shared vault.
- Ask scenario-helper agents for template suggestions or scenario rewrites.
- Analyze runs with a selected dashboard agent/runtime model.
- Publish supported runs through the MiroShark experiment surface.

## Swarm Theater

The Swarm view is the dashboard's MiroShark workbench. It combines:

- Template selection and template field validation.
- Draft scenario, round count, and platform controls for Twitter/X, Reddit, Parallel, and Polymarket-style surfaces.
- Live run loading states with progress labels and archive fallback.
- Run timeline, observability, market, profile, action, and integration items transformed by `src/features/swarm/swarm-transformers.ts`.
- Output panels for X threads, Reddit, Polymarket, research, ops, and integration views.
- Analysis-agent selection backed by dashboard runtime/model selections.

The view is intentionally Hivemind-owned. MiroShark remains an optional companion service. HivemindOS owns the Fleet badge matching, route catalog fallback, archive routing, and shared-vault artifact handoff.

## API Service Catalog

When MiroShark is discovered as a hivenet API service, `/api/fleet/apps` can attach a route catalog even if the service root is not interactive. The catalog prefers OpenAPI when available and otherwise falls back to the Hivemind-owned MiroShark signature. My Apps then shows grouped endpoints for templates, lifecycle, run data, graph, observability, and config.

See also: [MiroShark Companion Integration](../integrations/miroshark/companion.md).

## Runtime Gateway Support

How it works:

- Gateway client: `src/lib/services/openclaw/gateway-client.ts`.
- Gateway health/token helper: `src/lib/services/openclaw/gateway-health.ts`.
- The OpenClaw runtime adapter participates in the generic runtime adapter registry.
- Chat is routed through the generic agent runtime path when an OpenClaw runtime profile is selected.

What runtime gateway support can do:

- Runtime profile detection.
- Runtime model selection from local config.
- WebSocket chat bridge through the HivemindOS runtime chat surface.
- Basic gateway token lookup for local runtime calls.

## Main Code Paths

- `src/lib/services/miroshark/**`
- `src/app/api/miroshark/**`
- `src/features/swarm/**`
- `src/components/swarm/**`
- `src/lib/services/openclaw/**`
- `src/lib/services/runtime-adapters/openclaw.ts`
