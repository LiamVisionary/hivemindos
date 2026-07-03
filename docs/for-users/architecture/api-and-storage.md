---
title: "API And Storage Reference"
---

# API And Storage Reference

This is the practical map for APIs and storage.

Use it when you need to know which route owns a workflow, where state lands on disk, and which checks prove the system is still wired correctly.

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
| `/api/crypto/*` | Unified crypto rail readiness, clear-signing reviews, local agent identity records, and offline crypto risk checks |
| `/api/env` | Shared and runtime-specific env listing/import/update through hive-env helpers |
| `/api/fleet/*` | Fleet discovery, snapshots, updates, app/service discovery, app icons, machine init, and Hetzner setup helpers |
| `/api/gitlawb/*` | GitLawb Code Proof CLI, DID, node health, and lazy setup status |
| `/api/honey-ledger` | Honey ledger reads, local observation submission, exchange actions |
| `/api/integrations/github/oauth/*` | GitHub OAuth fallback that saves `GH_GLOBAL` for AEON |
| `/api/integrations/connections` | App connections: live provider status, token save, disconnect |
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
| `/api/projects/*` | Hivemind project registry and GitLawb repo linking |
| `/api/runtime-files` | Safe runtime/app file roots, listing, read, and write |
| `/api/runtime-usage` | Runtime usage analytics for supported runtimes |
| `/api/runtimes/*` | Generic runtime adapter facade for status, integrations, skills, schedules, runs, outputs, env sync, sessions |
| `/api/scheduler/*` | Shared schedule import/update, runtime schedule actions, skill actions, folder browsing |
| `/api/syncthing/*` | Syncthing status and HivemindOS vault pairing |
| `/api/tailscale/devices` | Tailscale and Hivemind Link device discovery |
| `/api/telemetry/events` | Local telemetry event recording and query |
| `/api/usepod/*` | UsePod registration and readiness/model/balance checks |
| `/api/wallet/*` | Wallet creation, balance, send, export, MoneyClaw, backup, and x402 actions |
| `/api/work-history` | Dynamic work history and changelog summaries |
| `/api/workspace/git-status` | Workspace git status for task safety checks |

## Crypto Capability Router

`/api/crypto/capabilities` is the dashboard control-plane route for agent money-rail selection. It supports:

- `status`: read readiness and missing setup by provider.
- `select`: choose a rail for an intent without side effects.
- `prepare`: return a provider endpoint, request draft, clear-signing review, and crosschain plan when relevant for the existing spend-gated execution route.

The router covers Bankr, x402, Veil Cash, MoneyClaw, and UsePod. It reports credential readiness by key name/status only and does not return raw env values or wallet secrets. It does not execute spending directly; sends, trades, crosschain intents, paid API calls, private transfers, card payments, and LLM credit funding still execute through the existing provider route or skill after the relevant spend gate or confirmation.

Related crypto routes:

| Route | Purpose |
|---|---|
| `/api/crypto/capabilities` | Readiness, provider selection, and prepared action drafts |
| `/api/crypto/clear-signing` | Normalize a crypto action draft into a clear-signing review with risks, side effects, confirmation text, and fingerprint |
| `/api/crypto/agent-identity` | Local agent identity/listing records with wallet, ENS/ERC-8004 metadata, endpoints, capabilities, proofs, and status |
| `/api/crypto/risk-monitor` | Offline risk scoring over wallet policy, identity, env-key presence, endpoints, repo controls, DNS controls, and multisig posture |

`scripts/hivemind-mcp` exposes the same control-plane routes to external agents through `crypto_capabilities`, `select_crypto_rail`, `prepare_crypto_action`, `review_crypto_action`, `agent_crypto_identity`, and `crypto_risk_monitor`. Those MCP tools require a running authenticated HivemindOS dashboard API. They can be used outside dashboard chat, but they are not an offline wallet daemon.

## Fleet App And API Service Discovery

`/api/fleet/apps` turns collector app reports and service probes into the My Apps launcher. It merges local and remote collector data, separates browser apps from API services, and keeps known API services usable even when their root page is not interactive.

Important behavior:

- Collector app reports are normalized into app cards with stable machine labels, icon URLs, open URLs, health URLs, and local/remote markers.
- App icons can be proxied through `/api/fleet/app-icon` so browser security does not block collector-hosted assets.
- API services expose `apiBaseUrl`, `healthUrl`, `serviceKind`, `interactive: false`, and optional route catalogs.
- Route catalogs prefer OpenAPI/Swagger documents discovered at common endpoints such as `/openapi.json`, `/api/openapi.yaml`, and `/swagger.json`.
- If no OpenAPI document is found, Hivemind-owned service signatures can provide a fallback catalog. MiroShark currently has a Hivemind catalog for templates, simulation lifecycle, run data, graph, observability, and config endpoints.
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

Known runtime ids are `openclaw`, `hermes`, `aeon`, and `hivemind-os`.

## GitLawb Code Proof

GitLawb routes are advisory. Missing GitLawb should return safe status payloads, not break setup or the Work board.

| Route | Purpose |
|---|---|
| `GET /api/gitlawb/status` | Detect CLI/helper binaries, local DID, node health, repo/peer counts, and MCP availability |
| `POST /api/gitlawb/setup-cli` | Install or repair lightweight GitLawb CLI binaries where supported |
| `POST /api/gitlawb/identity` | Create or refresh a local DID without public node registration |
| `POST /api/gitlawb/node/setup` | Return lazy local-node readiness/guidance |
| `GET /api/projects` | Read shared-vault or local-fallback project registry |
| `POST /api/projects` | Create or update a Hivemind project |
| `POST /api/projects/link-gitlawb` | Link project metadata to a GitLawb repo and degrade gracefully when a node is unavailable |

Default node probes use `http://127.0.0.1:7545`. Full node hosting is not part of default setup. It only makes sense after the user opts into local repo hosting, and it normally means a Docker/Postgres-backed GitLawb node.

## Native Desktop Command Surface

Tauri desktop builds use native commands for local machine operations. Browser users and remote machines keep using API fallbacks.

| Command | Frontend helper | Purpose |
|---|---|---|
| `desktop_status` | `getNativeAppVersion` | Read build commit, branch, dirty flag, runtime phase, native host, and native server port |
| `list_local_directories` | `listNativeLocalDirectories` | Browse This Mac directories without a collector round-trip |
| `create_local_folder` | `createNativeLocalFolder` | Create a local folder after validating the parent and cleaning the label |
| `display_local_path` | `displayNativeLocalPath` | Normalize expanded local paths for display |

Native helpers are used by AEON workspace linking, chat folder creation, scheduler folder browsing, and machine-aware directory selection when the target is local. Remote collectors still go through `/api/machines/directories` or collector `/directories`.

## Collector Endpoints

The local collector lives at `scripts/agent-telemetry-collector.mjs`. Agent machines install it through `scripts/install-telemetry-collector.sh`.

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
| `POST /e2e/env-sync` | Real-fleet env sync test hook |
| `POST /e2e/skills` | Real-fleet skill sync test hook |
| `POST /e2e/file-share` | Real-fleet encrypted file share test hook |

The collector also exposes runtime session, chat, schedule, run, output, env sync, Syncthing, and OpenClaw/Hermes/Aeon helper endpoints used by the dashboard and runtime adapter layer. Treat every collector endpoint as private Tailnet or Link-only infrastructure.

## Persistent Storage

### Dashboard State

The dashboard uses the authenticated `/api/dashboard/state` route for UI preferences and cache. The route persists to `~/.hivemindos/dashboard-state.json`, so packaged Tauri and ordinary browser sessions hydrate from the same local server source:

- Agent profile configuration.
- Shared vault UI configuration.
- Recent task, schedule, wallet, chat, folder, and discovered-machine state.
- Theme and Honey opt-in flags.

This avoids origin-scoped browser storage drift. Durable shared collaboration should use the vault or runtime-backed services.

### HivemindOS Home

Default location:

```text
~/.hivemindos
```

Important files and folders:

| Path | Purpose |
|---|---|
| `~/.hivemindos/install-id` | Workspace id used by Honey and compute flows |
| `~/.hivemindos/.env` | Canonical shared env store managed by Hivemind Sync helpers: `hive-env-add`, `hive-env-remove`, and `hive-env-delete` |
| `~/.hivemindos/collector.env` | Persisted collector/Link runtime settings such as selected port |
| `~/.hivemindos/gitlawb/status.json` | Short-lived GitLawb status cache with no private keys |
| `~/.hivemindos/gitlawb/installed-by-hivemindos.json` | Marker for GitLawb CLI binaries installed by HivemindOS setup |
| `~/.hivemindos/projects.json` | Local fallback Hivemind project registry |
| `~/.hivemindos/kanban` | Local Kanban fallback when the Obsidian vault is unavailable |
| `~/.hivemindos/runtime-agents.json` | Local runtime agent registry used by the collector |
| `~/.hivemindos/runtime-runs` | Runtime run cache/output metadata |
| `~/.hivemindos/skill-auto-sync.json` | Skill auto-sync provider configuration |
| `~/.hivemindos/telemetry/memory-samples.jsonl` | Memory telemetry samples used to detect growth trends |
| `~/.hivemindos/agent-identities.json` | Local crypto agent identity/listing registry for ENS/ERC-8004-style metadata |
| `~/.hivemindos/wallet-vault.json` | Local encrypted wallet secret store for user and agent wallets |
| `~/.hivemindos/wallet-vault.key` | Local wallet-vault key material when `HIVEMINDOS_WALLET_VAULT_KEY` is not configured |
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
| `Operations/Code Projects/projects.json` | Hivemind project registry and optional GitLawb repo links |
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

## Hosted Services

### Honey Ledger

Source boundary: official hosted-service source is maintained outside the public
MIT-licensed app repo. The public app talks to the configured ledger endpoint.

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

Pool math: Bankr Doppler swap fee `1.2%` * creator share `57%` * Honey allocation `5%` = `0.0342%` of trading volume value.

### Compute Gateway

Source boundary: official hosted-service source is maintained outside the public
MIT-licensed app repo. The public app talks to the configured compute endpoint.

Routes:

| Route | Purpose |
|---|---|
| `GET /health` | Worker health |
| `POST /chat` | Compatibility chat endpoint |
| `POST /v1/chat/completions` | OpenAI-compatible chat completion proxy |
| `GET /v1/models` | Model list |

### Paid Agent Gateway

Source boundary: official hosted-service source is maintained outside the public
MIT-licensed app repo. The public app talks to the configured paid-agent endpoint.

Routes:

| Route | Purpose |
|---|---|
| `GET /health` | Worker health and configured paid-agent readiness |
| `GET /api/paid-agents/<slug>/chat/completions` | Non-secret x402 paid-agent metadata |
| `POST /api/paid-agents/<slug>/chat/completions` | x402-protected OpenAI-compatible chat completion proxy |

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
| `NEXT_PUBLIC_GITLAWB_PROOF_READY` | Enables Code Proof-ready dashboard posture |
| `NEXT_PUBLIC_GITLAWB_NODE_URL` | Default local GitLawb node URL, normally `http://127.0.0.1:7545` |
| `GITLAWB_NODE_URL` / `GITLAWB_NODE` | Server-side GitLawb node URL override |
| `GITLAWB_INSTALL_DIR` | Optional install directory for GitLawb static CLI binaries |
| `HONEY_LEDGER_REMOTE_URL` | Official or forked Honey ledger worker |
| `HONEY_LEDGER_ISSUER_ID` | Honey ledger issuer id |
| `HONEY_LEDGER_SIGNING_SECRET` | Trusted receipt signing secret |
| `HONEY_BILLING_SIGNING_SECRET` | Trusted managed HONEY credit/debit signing secret |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Operator-side Stripe Checkout and webhook keys for managed HONEY funding |
| `MANAGED_HONEY_CREDITS_PER_USD` | Display conversion for spend-only managed HONEY credits |
| `MANAGED_AGENT_MARKUP_BPS` | Managed-agent retail markup over server-side provider cost |

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
