# API And Storage Reference

This reference documents the main local API surfaces, collector endpoints, persistent files, and verification commands.

## Dashboard API Route Groups

All routes below are served by the Next.js app under `src/app/api`.

| Route group | Purpose |
|---|---|
| `/api/agents/*` | Agent status checks, runtime agent creation/deletion, folder browsing |
| `/api/app/version` | App version and checkout metadata |
| `/api/brain/gbrain/*` | GBrain status, install, connect, import, embed, dream, and query |
| `/api/brain/synto/*` | Syntho status, install, connect, init, run, maintain, compare, eval, doctor, pack export, and query |
| `/api/brain/trading-brain/*` | Trading brain status and install |
| `/api/chat/*` | Agent chat, runtime chat stream, session reads, chat folder persistence |
| `/api/control-room/status` | Control-room path and setup status checks |
| `/api/env` | Shared and runtime-specific env listing/import/update through hive-env helpers |
| `/api/fleet/*` | Fleet discovery, snapshots, updates, app/service discovery, app icons, machine init, and Hetzner setup helpers |
| `/api/honey-ledger` | Honey ledger reads, local observation submission, exchange actions |
| `/api/integrations/github/oauth/*` | GitHub OAuth fallback that saves `GH_GLOBAL` for AEON |
| `/api/integrations/nango/*` | Nango configuration, health, connections, and setup |
| `/api/kanban` | Board CRUD, task lifecycle, comments, claims, runs, and events |
| `/api/kanban/deliverable` | Open/reveal completed task deliverables |
| `/api/machines/directories` | Machine-aware directory discovery |
| `/api/maintenance` | Maintenance report and repair actions |
| `/api/memory-telemetry` | Dashboard/process memory telemetry |
| `/api/miroshark/*` | MiroShark companion status, install/start, swarm, run, and analysis flows |
| `/api/note-intake` | Import note-derived tasks into Kanban |
| `/api/obsidian/*` | Vault status, note open/access, graph, sync, skills, wallets, aliases, recent directories |
| OpenClaw runtime support | OpenClaw is exposed through the generic runtime/chat facade rather than standalone product routes |
| `/api/orchestrator/*` | Orchestrator route/event surfaces |
| `/api/phone` | Phone gateway config/status, scheduled ring prompts, ring-agent actions, and dashboard-agent-call starts |
| `/api/runtime-files` | Safe runtime/app file roots, listing, read, and write |
| `/api/runtime-usage` | Runtime usage analytics for supported runtimes |
| `/api/runtimes/*` | Generic runtime adapter facade for status, integrations, skills, schedules, runs, outputs, env sync, sessions |
| `/api/scheduler/*` | Shared schedule import/update, runtime schedule actions, skill actions, folder browsing |
| `/api/syncthing/*` | Syncthing status and HivemindOS vault pairing |
| `/api/tailscale/devices` | Tailscale and Hivemind Link device discovery |
| `/api/telemetry/events` | Local telemetry event recording and query |
| `/api/usepod/*` | UsePod registration and readiness/model/balance checks |
| `/api/wallet/*` | Wallet creation, balance, send, MoneyClaw, backup, and x402 actions |
| `/api/work-history` | Dynamic work history and changelog summaries |
| `/api/workspace/git-status` | Workspace git status for task safety checks |

## Fleet App And API Service Discovery

`/api/fleet/apps` turns collector app reports and known service probes into the My Apps launcher. It merges local and remote collector data, distinguishes interactive apps from API services, and keeps known API services usable even when a generic root page would otherwise look non-interactive.

Important behavior:

- Collector app reports are normalized into app cards with stable machine labels, icon URLs, open URLs, health URLs, and local/remote markers.
- App icons can be proxied through `/api/fleet/app-icon` so browser security does not block collector-hosted assets.
- API services expose `apiBaseUrl`, `healthUrl`, `serviceKind`, `interactive: false`, and optional route catalogs.
- Route catalogs prefer OpenAPI/Swagger documents discovered at common endpoints such as `/openapi.json`, `/api/openapi.yaml`, and `/swagger.json`.
- If no OpenAPI document is found, Hivemind-owned service signatures can provide a fallback catalog. MiroShark currently has a Hivemind catalog covering templates, simulation lifecycle, run data, graph, observability, and config endpoints.
- My Apps renders grouped route cards with method badges, copy actions, and open buttons only for safe GET routes without path parameters.

Main files:

- `src/app/api/fleet/apps/route.ts`
- `src/app/api/fleet/app-icon/route.ts`
- `src/features/dashboard/views/MyAppsPanel.tsx`

## Generic Runtime Facade

Dynamic runtime routes call `src/lib/services/runtime-adapters/registry.ts`:

| Route | Adapter method |
|---|---|
| `/api/runtimes/[runtime]/status` | `getStatus` |
| `/api/runtimes/[runtime]/skills` | `listSkills` |
| `/api/runtimes/[runtime]/skills` with action payloads | `syncSkills` where supported |
| `/api/runtimes/[runtime]/schedules` | `listSchedules` |
| `/api/scheduler/runtime-action` | `runScheduleAction` through the scheduler facade |
| `/api/runtimes/[runtime]/runs` | `listRuns` |
| `/api/runtimes/[runtime]/outputs` | `listOutputs` |
| `/api/runtimes/[runtime]/integrations` | `getRuntimeIntegrationStatus` |
| `/api/runtimes/[runtime]/analytics` | runtime analytics where supported |
| `/api/runtimes/[runtime]/memory` | runtime memory context where supported |

Known runtime ids are `openclaw`, `hermes`, `aeon`, and `openai-compatible`.

## Native Desktop Command Surface

Tauri desktop builds use native commands for host-local operations and keep API fallbacks for browser and remote-machine use.

| Command | Frontend helper | Purpose |
|---|---|---|
| `desktop_status` | `getNativeAppVersion` | Read build commit, branch, dirty flag, runtime phase, native host, and native server port |
| `list_local_directories` | `listNativeLocalDirectories` | Browse This Mac directories without a collector round-trip |
| `create_local_folder` | `createNativeLocalFolder` | Create a local folder after validating the parent and cleaning the label |
| `display_local_path` | `displayNativeLocalPath` | Normalize expanded local paths for display |

Native helpers are used by AEON workspace linking, chat folder creation, scheduler folder browsing, and machine-aware directory selection when the target is local. Remote collectors still go through `/api/machines/directories` or collector `/directories`.

## Collector Endpoints

The local collector lives at `scripts/agent-telemetry-collector.mjs`. It is installed on agent machines by `scripts/install-telemetry-collector.sh`.

Common endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Host, version, env sync status, and capability advertisement |
| `POST /snapshot` | Local machine, process, runtime, task, and alert snapshot |
| `POST /update` | Start a HivemindOS update command on that machine |
| `GET /env` | Export known env metadata for a scope/runtime |
| `POST /env` | Import env values through hive-env helpers |
| `GET /agents` | List local runtime agents |
| `POST /agents` | Create a runtime agent when supported |
| `DELETE /agents` | Delete a runtime agent when supported |
| `GET /directories` | Browse directories for machine-targeted workflows |
| `GET /apps` | Report local apps/services for My Apps |
| `GET /app-proxy/<port>/*` | Proxy a local app or API service through the collector |
| `GET /skills` | List installed skills from known runtime providers |
| `GET /skills/auto-sync` | Read skill auto-sync configuration/status |
| `POST /skills/auto-sync` | Configure skill auto-sync |
| `POST /integrations/nango/setup` | Set up Nango host on the collector machine |
| `POST /e2e/env-sync` | Real-fleet env sync test hook |
| `POST /e2e/skills` | Real-fleet skill sync test hook |
| `POST /e2e/file-share` | Real-fleet encrypted file share test hook |

The collector also exposes runtime session, chat, schedule, run, output, env-sync, Syncthing, and OpenClaw/Hermes/Aeon helper endpoints used by the dashboard and runtime adapter layer. Treat every collector endpoint as private Tailnet or Link-only infrastructure.

## Persistent Storage

### Browser Storage

The dashboard uses browser `localStorage` for UI-side preferences and cache:

- Agent profile configuration.
- Shared vault UI configuration.
- Recent task, schedule, wallet, chat, folder, and discovered-machine state.
- Theme and Honey opt-in flags.

This state helps the dashboard start quickly, but durable shared collaboration should use the vault or runtime-backed services.

### HivemindOS Home

Default location:

```text
~/.hivemindos
```

Important files and folders:

| Path | Purpose |
|---|---|
| `~/.hivemindos/install-id` | Workspace id used by Honey and compute flows |
| `~/.hivemindos/.env` | Canonical shared env store managed by `hive-env-add` |
| `~/.hivemindos/collector.env` | Persisted collector/Link runtime settings such as selected port |
| `~/.hivemindos/kanban` | Local Kanban fallback when the Obsidian vault is unavailable |
| `~/.hivemindos/runtime-agents.json` | Local runtime agent registry used by the collector |
| `~/.hivemindos/runtime-runs` | Runtime run cache/output metadata |
| `~/.hivemindos/skill-auto-sync.json` | Skill auto-sync provider configuration |
| `~/.hivemindos/telemetry/memory-samples.jsonl` | Memory telemetry samples used to detect growth trends |
| `~/.hivemindos/wallet-vault` | Local encrypted wallet secret store |
| `~/.hivemindos/e2e-file-share` | Temporary real-fleet encrypted file-share test artifacts |

### Obsidian Vault

Default path:

```text
~/Documents/Obsidian/hivemindos-vault
```

Default folders and files are configured in `DEFAULT_SHARED_VAULT` in `src/lib/types/agent-runtime.ts`.

| Vault area | Purpose |
|---|---|
| `Intake` | Agent/user inbox and note task import source |
| `Shared Context.md` | Shared instruction/context note |
| `Operations/Work Board` | Kanban board state |
| `Operations/Agent Notifications` | Notification records and settings |
| `Operations/Automations` | Scheduled schedules and run records |
| `Operations/Brain Services` | GBrain/Syntho/trading-brain service notes |
| `Synthesis` | Reviewed synthesis layer and optional Syntho vault |
| `Skills/README.md` | Shared skill index |
| `Skills/<slug>/SKILL.md` | Shared skill definitions |

### Runtime Homes

| Runtime | Common local path | Notes |
|---|---|---|
| Hermes | `~/.hermes` | Sessions, state DB, logs, profiles, local API/CLI bridge |
| OpenClaw | `~/.openclaw` | Gateway config, token, model references, and local runtime state |
| Aeon | `~/.aeon` or `AEON_LOCAL_PATH` | Background runtime, skills, run history, outputs |
| Local OpenAI | configured base URL | LM Studio, Ollama, vLLM, llama.cpp server, LocalAI, or compatible service |

## Cloudflare Workers

### Honey Ledger

Location: `workers/honey-ledger`

Routes:

| Route | Purpose |
|---|---|
| `GET /health` | Worker health |
| `GET /ledger` | Ledger balance/summary |
| `POST /receipts` | Signed usage receipt ingestion |
| `POST /observations` | Lower-trust local usage observations |
| `POST /exchange` | Honey to HIVE exchange |
| `POST /return-to-honey` | Move legacy ledger-only HIVE back to Honey |
| `POST /claim-bankr-hive` | Official Honey claim that sends HIVE from the worker-held Bankr treasury, then spends Honey after a tx hash |
| `POST /pool-events` | Admin reward-pool funding events |

### Compute Gateway

Location: `workers/compute-gateway`

Routes:

| Route | Purpose |
|---|---|
| `GET /health` | Worker health |
| `POST /chat` | Compatibility chat endpoint |
| `POST /v1/chat/completions` | OpenAI-compatible chat completion proxy |
| `GET /v1/models` | Model list |

## Environment Variables

Common local variables:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_OBSIDIAN_VAULT_PATH` | Shared vault path |
| `NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER` | Kanban folder inside the vault |
| `AGENT_TELEMETRY_PORT` | Collector port |
| `AGENT_TELEMETRY_HOST` | Collector bind host |
| `HIVE_LINK_ENABLED` | Enable Hivemind Link setup path |
| `HIVE_LINK_CONTROL_URL` | Local Link control API URL |
| `HERMES_HOME` | Hermes home override |
| `OPENCLAW_HOME` | OpenClaw home override |
| `AEON_HOME` / `AEON_LOCAL_PATH` | Aeon home/repo override |
| `LOCAL_OPENAI_BASE_URL` | OpenAI-compatible local server |
| `LOCAL_OPENAI_API_KEY` | Optional local server API key |
| `LOCAL_OPENAI_MODEL` | Preferred local model |
| `MIROSHARK_HOME` | Local MiroShark checkout |
| `MIROSHARK_BASE_URL` | MiroShark backend API URL |
| `HONEY_LEDGER_REMOTE_URL` | Official or forked Honey ledger worker |
| `HONEY_LEDGER_ISSUER_ID` | Honey ledger issuer id |
| `HONEY_LEDGER_SIGNING_SECRET` | Trusted receipt signing secret |

Do not commit private values, Tailnet IPs, wallet keys, or local vault contents.

## Verification Commands

General project checks:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Fast syntax checks for scripts:

```bash
node --check scripts/agent-telemetry-collector.mjs
bash -n setup.sh uninstall.sh scripts/install-telemetry-collector.sh scripts/update-hivemindos.sh
```

Focused test scripts:

```bash
pnpm test:kanban
pnpm test:dashboard-nav
pnpm test:fleet-local
pnpm test:gbrain-foundation
pnpm test:aeon-brain
pnpm test:honey-economics
node scripts/check-file-sizes.mjs
```

Real fleet tests:

```bash
pnpm test:e2e:real-fleet
pnpm test:e2e:agents
pnpm test:e2e:env
pnpm test:e2e:skills
pnpm test:e2e:file-share
pnpm test:e2e:kanban
pnpm test:e2e:dashboard-smoke
```

When testing locally, avoid taking over port `5020` unless explicitly directed. Use `5021` or higher for temporary servers.
