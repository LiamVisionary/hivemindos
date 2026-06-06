<div align="center">
  <img width="220" height="220" alt="HivemindOS" src="public/hivemindos-logo.png" />

  <p>
    <a href="https://github.com/LiamVisionary/hivemindos/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/LiamVisionary/hivemindos?style=for-the-badge&amp;logo=github&amp;label=stars&amp;color=0b8bdc&amp;labelColor=555555" /></a>
    <a href="https://github.com/LiamVisionary/hivemindos/network/members"><img alt="GitHub forks" src="https://img.shields.io/github/forks/LiamVisionary/hivemindos?style=for-the-badge&amp;logo=github&amp;label=forks&amp;color=0b8bdc&amp;labelColor=555555" /></a>
    <a href="https://bankr.bot/launches/0xa382c83e2a3b79368f372c2eb9b6925ffaf45ba3"><img alt="Launch on Bankr" src="https://img.shields.io/badge/Launch%20on-Bankr-ff6a2a?style=for-the-badge&amp;labelColor=1f2137" /></a>
  </p>
  <p><b>HIVE Token:</b> 0xa382c83e2a3b79368f372c2eb9b6925ffaf45b</p>
</div>

> **A virtual private network for your agents.**
>
> HivemindOS lets agents collaborate across all of your machines through one private control room. Connect agents over trusted machine links, give them a shared Obsidian brain, move env and handoff files with Hivemind Sync, assign work, monitor progress, and manage the whole fleet from one simple dashboard.
>
> It supports modern agent runtimes like Hermes, OpenClaw, and Aeon, includes full MiroShark simulation integration, and can provision agent wallets on Base and Solana so agents can hold funds, pay for tools, and operate with their own controlled budgets.

Clone it, run one setup command, and get a local-first dashboard for the agents already living on your laptop, desktop, VPS, or spare machines. No public ports required.

![HivemindOS cyber-bee agent network hero](public/readme/hivemindos-hero.png)

## Screenshots

| Fleet | Work Automations |
|---|---|
| ![Fleet dashboard showing the live agent constellation and machine roster](public/readme/screenshots/fleet-dashboard.png) | ![Work automations scheduler showing the next 24 hours and task detail panel](public/readme/screenshots/work-automations.png) |

| Brain Graph | Simulation |
|---|---|
| ![Shared brain graph showing Obsidian notes and access history](public/readme/screenshots/brain-graph.png) | ![MiroShark simulation view showing an X thread simulation draft](public/readme/screenshots/work-simulation.png) |

## What It Does

- **See every agent from one dashboard** across this machine and trusted Tailscale-connected machines.
- **Cross-machine agent discovery and connection via Tailscale VPN** so agents can collaborate without public exposure.
- **Share one Obsidian brain** for memory, handoffs, skills, work boards, and shared context.
- **Open native Obsidian memory views** with seeded Bases and Canvas files over Agent Memory, projects, secure references, and recall topology.
- **Move shared env between agent machines** with Hivemind Sync helpers, without copying secrets by hand.
- **Send handoff files to a machine, runtime, or agent** with `hive-transfer` envelopes in the shared vault.
- **Assign work to agents** through a shared Kanban board with retries, stale-work recovery, and human handoff.
- **Attach signed code provenance** with GitLawb Code Proof for project-linked work.
- **Create and import schedules** so supported runtimes can keep working in the background.
- **Run MiroShark simulations** from the same control room.
- **Give agents controlled Base and Solana wallets** so they can pay for approved tools, APIs, transactions, and actions.
- **Earn Honey from regular agent usage** and convert it into HIVE, the HivemindOS token, to help fund agent compute.

## Quick Start

By default, setup uses **Hivemind Link**: an app-managed Tailscale node that uses your own Tailscale account without requiring the system Tailscale VPN client.

- For local-only use, you can skip Tailscale completely.
- For app-managed Fleet/chat access, run normal setup. Hivemind Link keeps the collector bound to localhost and exposes it only through the embedded Link sidecar.
- For full Tailnet extras such as Tailscale SSH pulls, rsync repair, and HivemindOS-managed Syncthing peer addressing, run `./setup.sh --system-tailscale`, then install/sign in to system Tailscale.
- On macOS, the App Store/sandboxed GUI build can join your Tailnet, but it cannot host the Tailscale SSH server. That is fine for VPN, collector env pushes, and Syncthing, but `hive-env-add --pull-from` and rsync repair from that Mac need a Tailscale SSH-capable host. Tailscale documents the macOS build differences here: [Three ways to run Tailscale on macOS](https://tailscale.com/docs/concepts/macos-variants).
- To make a macOS machine host Tailscale SSH, install the open-source `tailscale` + `tailscaled` CLI/daemon build from the [Tailscaled on macOS guide](https://github.com/tailscale/tailscale/wiki/Tailscaled-on-macOS), or use Homebrew:

```bash
brew install --formula tailscale
sudo brew services start tailscale
sudo tailscale up
sudo tailscale set --ssh
```

If setup detects the sandboxed macOS GUI build while running interactively, it can offer to run the Homebrew formula flow for you.

- On Linux machines that should host Tailscale SSH:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale set --ssh
```

Then run HivemindOS setup:

```bash
git clone https://github.com/LiamVisionary/hivemindos.git
cd hivemindos
./setup.sh
```

On native Windows PowerShell, run:

```powershell
git clone https://github.com/LiamVisionary/hivemindos.git
cd hivemindos
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

Then open the dashboard printed by setup, usually:

```txt
http://localhost:5020
```

The dashboard is protected by a local device unlock token because its API can read env values, manage runtime config, and perform wallet actions. Setup stores the token in `.env.local` as `HIVEMINDOS_DASHBOARD_DEVICE_TOKEN`, offers to copy it to your clipboard, and prints the recovery commands:

```bash
pnpm dashboard-auth copy-token
pnpm dashboard-auth reset-token
pnpm dashboard-auth rotate-secret
```

Use `copy-token` when you need to paste the token into the unlock screen again. Use `reset-token` if the token is lost, then restart the dashboard so it reloads `.env.local`. Use `rotate-secret` when you also want to invalidate existing browser sessions after restart.

Setup checks Node.js and pnpm/Corepack, installs dependencies, installs the hive env helpers, installs the lightweight machine monitor where supported, prepares GitLawb Code Proof where available, starts the dashboard when possible, and can open the dashboard for you. Production dashboard builds are skipped by default; use `./setup.sh --build` when you explicitly want one. On macOS/Linux use `setup.sh`; on native Windows use `setup.ps1`.

GitLawb setup is proof-ready by default, not full node hosting by default. On macOS/Linux, interactive setup offers to install `gl`, `git-remote-gitlawb`, and the `gitlawb-node` binary, then offers to create a local DID without registering with a public node. HivemindOS does not start a GitLawb node, install Docker/Postgres, expose repo hosting, or enable federation/IPFS/Arweave/staking during first setup. Full local node setup stays lazy and is surfaced from Integrations or project linking when a project needs local GitLawb repo hosting.

To remove HivemindOS later, run the matching uninstaller. It asks one prompt at a time before removing services, generated files, GitLawb Code Proof cache/managed binaries, hive env helpers, shared-skill agent hints, or optional apps such as Tailscale, Syncthing, pnpm, GnuPG, and Obsidian:

```bash
./uninstall.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

## The First 10 Minutes

1. Run `./setup.sh`.
2. Open the dashboard.
3. Check **Fleet** for local and Tailscale-connected machines.
4. Open **Work** to create a task and assign it to your agents.
5. Open **Brain** to connect the shared Obsidian workspace.
6. Open **Scheduler** to import or create background jobs.
7. Add shared env vars when your agents need keys:

```bash
hive-env-add OPENAI_API_KEY
hive-env-add ANTHROPIC_API_KEY=...
hive-env-remove OLD_API_KEY
```

## Honey, HIVE, And Compute

HivemindOS includes an opt-in rewards loop for normal agent usage:

1. The dashboard watches supported local runtimes while Honey rewards are enabled.
2. When a runtime reports real token usage, HivemindOS submits only the token delta to the official Honey ledger.
3. The ledger credits Honey to your workspace.
4. Available Honey can be exchanged for HIVE.
5. HIVE can be used to fund Bankr LLM credits for future agent compute.

Honey is the in-app reward meter. HIVE is the Bankr-launched token behind the reward economy. The official ledger is the source of truth, so editing the frontend display does not mint spendable HIVE. Rewards are capped by the official HIVE reward pool, which is funded from 5% of creator fees, and observed runtime usage is deduped and capped server-side.

Privacy stays local-first. Honey rewards are disabled by default; you enable them from the Wallets view. When enabled, HivemindOS sends usage metadata such as workspace id, agent id, token count, model label, timestamp, source, and event id. Prompts, responses, files, wallet keys, and machine details are not sent to the Honey ledger.

Hermes CLI sessions are credited from Hermes' own persisted token counters when the dashboard is running. OpenClaw exposes token usage through its `/usage`, `/status`, CLI, and transcript usage surfaces; HivemindOS only credits OpenClaw once it can read real usage fields, not from text-length guesses. If you fork the reward backend to run your own ledger, that fork is no longer the official HIVE-compatible Honey ledger.

For spoof-proof Honey, use reward compute mode. Keep using Hermes, OpenClaw, or another OpenAI-compatible client directly, but set its provider endpoint to the HivemindOS reward gateway:

```txt
OPENAI_BASE_URL=https://hivemindos-compute-gateway.hivemindos.workers.dev/v1
OPENAI_API_KEY=hive-v1.<workspace-id>.<bankr-llm-key>
```

Your workspace id is stored at `~/.hivemindos/install-id` after setup. The gateway forwards the request through Bankr, reads the provider-returned token usage, signs the Honey receipt server-side, and credits official Honey without requiring the dashboard chat surface.

### Local OpenAI-Compatible Runtimes

HivemindOS can register a generic `openai-compatible` agent runtime for local model servers that expose OpenAI-style endpoints. LM Studio works with the default base URL:

```txt
LOCAL_OPENAI_BASE_URL=http://127.0.0.1:1234
LOCAL_OPENAI_API_KEY=
LOCAL_OPENAI_MODEL=<loaded-model-id>
```

The adapter calls `POST /v1/chat/completions` for chat and `GET /v1/models` for model discovery. Point the same runtime at Ollama, vLLM, llama.cpp server, LocalAI, or another compatible service by changing the base URL and model.

## Features

| Feature | What it does |
|---|---|
| **Fleet dashboard** | Tracks machines, agents, runtimes, health, tasks, logs, and capabilities in one place |
| **Tailscale agent network** | Connects agents across your machines through your private Tailscale VPN |
| **Machine monitor** | Lightweight local service that reports agent status and runtime health to the dashboard |
| **Runtime adapters** | Supports Hermes, OpenClaw, Aeon, MiroShark, and generic machine-backed agents through a neutral adapter layer |
| **Local model runtimes** | Adds a generic OpenAI-compatible adapter for LM Studio, Ollama, vLLM, llama.cpp server, LocalAI, and similar `/v1/chat/completions` services |
| **Shared Obsidian brain** | Stores memory, handoffs, shared context, Kanban state, and reusable skills in a local markdown vault |
| **Obsidian-native brain views** | Seeds `.base` and `.canvas` files plus shared skills for Obsidian Markdown, Bases, Canvas, and clean web markdown extraction |
| **Hivemind Sync** | Moves shared brain files, shared env, and handoff transfers between trusted machines |
| **Handoff transfers** | Routes artifacts through `.hivemindos-transfers/` to a specific machine, runtime, or agent with payload hashes and acknowledgements |
| **Work board** | Gives agents a shared Kanban queue for tasks, delegation, retries, stale work, and human handoff |
| **GitLawb Code Proof** | Links projects and tasks to signed GitLawb provenance while keeping local node hosting optional |
| **Scheduler studio** | Creates, imports, pauses, resumes, and runs background schedules where runtimes support them |
| **Agent chat bridge** | Sends chat to supported runtimes through a local safety and redaction proxy |
| **MiroShark integration** | Runs and tracks MiroShark simulations from the HivemindOS dashboard |
| **Agent wallets** | Provisions controlled Base and Solana wallets for agents that need budgets or payment rails |
| **Honey rewards and HIVE compute** | Lets opt-in users earn Honey from measured agent token usage, exchange it for HIVE, and fund Bankr LLM compute with HIVE-backed credits |
| **Alerts** | Surfaces auth failures, stuck work, runtime issues, and handoff problems in one inbox |
| **Skill shelf** | Shares skills across Codex, Claude, Hermes, Gemini, OpenClaw, and Aeon |
| **Local-first storage** | Keeps runtime profiles, vault paths, and local URLs on your machine |

## Runtime Support

| Runtime | Current support |
|---|---|
| **Hermes** | Local HTTP/runtime adapter, session visibility from `~/.hermes`, chat bridge, tasks, logs, and process snapshots |
| **OpenClaw** | Gateway adapter with WebSocket chat and model selection through the generic runtime bridge |
| **Aeon** | Background-runtime adapter for `aeon.yml`, GitHub Actions-backed skills, run history, outputs, memory, and optional A2A skill calls |
| **MiroShark** | Companion integration for simulation workflows and dashboard visibility |
| **Generic machines** | Read-only machine snapshots through the local monitor |

No single runtime is required. HivemindOS works with one local agent, a mixed fleet, or future adapters.

## How Sharing Works

![HivemindOS sharing model with a central shared brain, Tailscale VPN, Syncthing, and Tailscale SSH](public/readme/hivemind-sharing-model.png)

HivemindOS uses Tailscale in a few specific ways:

- **Agent connection:** the dashboard finds and connects to agent machines through your Tailscale VPN.
- **Hivemind Link:** optional app-managed Link nodes use Tailscale's embedded `tsnet` library to expose only the local HivemindOS collector over your own Tailscale account, without requiring the system Tailscale VPN client.
- **Hivemind Sync env:** `hive-env-add` and `hive-env-remove` send env changes to trusted ready peers through collector `/env` endpoints. `--pull-from` still uses Tailscale SSH because it asks a peer to export its local env set.
- **Hivemind Sync brain:** the shared Obsidian vault is a local folder. In Brain, choose whether an external provider such as Obsidian Sync, iCloud Drive, Dropbox, Git, or another folder sync tool owns realtime sync, or let HivemindOS pair Syncthing over Tailscale.
- **Hivemind Sync handoffs:** `hive-transfer` writes routed file envelopes into `.hivemindos-transfers/` inside the vault. Syncthing or the selected vault sync owner moves those files to the receiver.
- **Vault repair:** rsync over Tailscale SSH is available as an advanced fallback for one-shot push, pull, or bidirectional repair jobs. rsync repair conflicts are written as explicit `.conflict-host-timestamp` copies; Syncthing conflicts are handled by Syncthing in the vault and Syncthing UI.

Plaintext secrets do not belong in the shared vault. If GPG is configured, `hive-env-add` can refresh an encrypted `hive.env.gpg` backup in your chosen notes folder.

## Shared Env

For the focused docs page, see [Shared Env](docs/whole-brain/shared-env.md).

Setup installs `hive-env-add`, `hive-env-remove`, `hive-env-delete`, `hive-env-check`, and `hive-env-run` into `~/.local/bin`. GnuPG is optional; when it is installed and a recipient or public key is configured, `hive-env-add` refreshes the encrypted `hive.env.gpg` backup in the shared notes folder.

```bash
hive-env-add KEY=value
hive-env-add KEY
hive-env-remove KEY
hive-env-delete KEY
hive-env-add --import-env
hive-env-add --reconcile
hive-env-add --pull-from root@ubuntu.tailnet.ts.net
hive-env-check KEY
hive-env-run -- command arg...
```

By default `hive-env-add` updates the canonical shared hive env at `~/.hivemindos/.env`. `hive-env-remove KEY` removes a key from that same store and syncs the removal through the same path. `hive-env-delete KEY` is an alias for people who reach for delete first. Apps, scripts, and agents should consume that shared env at runtime instead of copying secrets into project `.env` files or runtime-specific secret stores. Use `hive-env-check KEY` to verify presence without printing values, and use `hive-env-run -- <command>` to execute any command with the shared env loaded into the child process.

Runtime-specific compatibility writes remain explicit for legacy/runtime-native stores:

```bash
hive-env-add --runtime hermes ANTHROPIC_API_KEY
hive-env-add --runtime aeon OPENAI_API_KEY
hive-env-add --runtime openclaw TAVILY_API_KEY
```

When Hivemind Sync is enabled, HivemindOS updates trusted peer machines that report they are ready for env sync. Setup offers to pull missing keys from an existing ready peer and push this machine's keys to peers. `--reconcile` does the same push later through collector `/env` endpoints, which is useful after adding a new device. `--pull-from USER@HOST` imports missing keys from a trusted peer over Tailscale SSH and preserves local conflicts by default; use `--conflict remote-wins` or `--conflict fail` when you need a stricter merge. Advanced users can set `HIVE_ENV_TAILNET_TARGETS` to choose exact target machines.

## Shared Obsidian Brain

The Brain workspace can hold:

- agent inboxes
- shared context
- handoff notes
- AI ready note templates and vault writing conventions
- Hivemind Sync handoff transfer envelopes in `.hivemindos-transfers/`
- typed shared memories under `Memory/Distillations/Agent Memory/`
- a private local memory index under `Operations/Brain Services/Agent Memory Index.jsonl`
- optional hash-only GitLawb memory receipts under `Operations/Brain Services/Agent Memory Proofs.jsonl`
- Kanban board state
- reusable skills
- runtime instructions

Shared Brain Memory gives agents a local-first remember/recall/answer layer through `/api/brain/memory` and the installed `hive-brain` CLI. Raw or non-managed agents can run `hive-brain answer "<query>"`; the CLI discovers the running local API when available and falls back to local vault/index search when it is not. Setup also installs `hive-brain-hook` and registers it as a Claude Code `UserPromptSubmit` hook, so raw Claude prompts can receive relevant shared-brain context even when they are not routed through the HivemindOS app. Default recall is tiered: it checks typed Agent Memory first, returns that distilled layer when the hit is strong, and otherwise augments with relevant markdown from the full shared vault. `--scope agent-memory` narrows recall to the typed/proven memory write layer, while `--scope full-vault` forces broad vault recall, including `Operations/Secure` reference/status notes for credential names and set/missing status without storing plaintext secret values. In live local typed-memory benchmarks, indexed recall measured p50/p95 of `2.69ms/3.15ms` at 100 memories, `4.37ms/5.26ms` at 500 memories, and `19.20ms/31.33ms` at 1500 memories with synthetic Top-1/Top-3/MRR relevance of `1.0`. On Liam's current 4,848-note vault, full-vault answer recall over 2,685 eligible markdown notes measured about `2.35s` cold and roughly `0.20s-0.35s` warm through the local API. That gives HivemindOS agents rich, provenance-aware memory and broad private vault context at a fraction of the latency and privacy cost of network-bound memory stacks.

HivemindOS can auto-detect common local Obsidian vault locations, validate an explicit vault path, and fall back to local Kanban storage at `~/.hivemindos/kanban` if the vault is unavailable.

Setup also seeds the first brain foundation: an AI ready vault contract under `Operations/`, reusable note templates under `Templates/HivemindOS/`, optional Obsidian CLI and plugin-pack status notes under `Operations/Brain Services/`, encrypted backup references under `Operations/Secure/`, runtime mirrors under `Operations/Runtime Mirrors/`, vault cleanup manifests under `Operations/Vault Migrations/`, and disabled workflow schedules for morning context, meetings, research ingestion, weekly review, vault health checks, decision review, project updates, argument building, book notes, feedback capture, and durable knowledge distillation.

For multi-machine sharing, Hivemind Sync can pair Syncthing over Tailscale so trusted machines each keep a local copy of the same vault. No Obsidian Sync subscription is required. If you already use Obsidian Sync, iCloud Drive, Dropbox, Git, or another provider, select that external sync owner in Brain so HivemindOS does not auto-pair Syncthing on top of it. When setup finds another Syncthing-capable collector and the Brain setting allows HivemindOS Syncthing, it can pair the shared vault and write/read a small test note to verify that sync is actually flowing.

For the full brain model, see [Whole Brain](docs/whole-brain/index.md). For the sync and networking model, see [Hivemind Sync](docs/features/hivemind-sync.md) and [Syncing And Tailscale Architecture](docs/syncing-and-tailscale.md). For artifact handoffs, see [Hivemind Sync Handoff Transfers](docs/targeted-file-transfers.md).

## Multi-Machine Setup

On each additional machine that runs agents:

```bash
git clone https://github.com/LiamVisionary/hivemindos.git
cd hivemindos
./scripts/install-telemetry-collector.sh
```

The script installs the lightweight machine monitor and starts the services needed for dashboard discovery, Hivemind Sync env readiness, and optional Syncthing brain sync.

For app-managed Link mode instead of a system Tailscale install, use either normal setup or the collector-only command:

```bash
HIVE_LINK_ENABLED=true ./scripts/install-telemetry-collector.sh
```

The first run builds `bin/hivemind-linkd`, starts a localhost-only collector, and prints a Tailscale sign-in URL when the embedded app node needs authorization. Remote HivemindOS traffic then travels over Tailscale's encrypted device links, while the collector itself stays on `127.0.0.1`.

In Link mode, remote collectors are reached through the local sidecar URL shape
`http://127.0.0.1:8788/peer/<tailnet-host%3A8787>/...`. Keep that `/peer/...`
URL on port `8788`; only plain local collector URLs should use the active
collector port from `~/.hivemindos/collector.env`.

Use `./setup.sh --system-tailscale` only when you want the older full Tailnet setup surface: macOS firewall allow-listing, Tailscale SSH, rsync repair, and Hivemind Sync Syncthing pairing.

## Private By Default

- The machine monitor is read-only by default.
- The dashboard API requires a signed local session or device token before non-public routes can read secrets, mutate config, or touch wallet actions.
- Remote machines should stay private to Tailscale or Hivemind Link.
- In Hivemind Link mode, the collector binds to localhost and the `hivemind-linkd` sidecar is the only Tailnet-facing entry point.
- Chat requests pass through a local agent security proxy before reaching runtimes.
- Common secret formats are redacted before runtime output renders.
- Local skill actions use allowlisted folders and argument validation where the dashboard exposes direct skill execution.
- Agent profiles and local runtime URLs are not synced by the app.
- Broad API keys should not be placed into shared folders.

More detail: [docs/tailscale-fleet-telemetry.md](docs/tailscale-fleet-telemetry.md)

## Advanced Setup

```bash
./setup.sh --help
./setup.sh --non-interactive
./setup.sh --import-skills
./setup.sh --import-skills codex,hermes,aeon
./setup.sh --share-skills codex,openclaw
./setup.sh --no-shared-skills
./setup.sh --skip-deps
./setup.sh --build
./setup.sh --skip-collector
./setup.sh --skip-dashboard
./setup.sh --force
```

Automation can skip prompts with `CI=true`, `HIVE_SETUP_INTERACTIVE=false`, or explicit env choices:

```bash
HIVE_SHARED_SKILLS=true HIVE_SHARED_SKILL_IMPORTS=all HIVE_SHARED_SKILL_TARGETS=all ./setup.sh
HIVE_SHARED_SKILLS=false ./setup.sh
HIVE_GITLAWB_SETUP=true HIVE_GITLAWB_IDENTITY=true ./setup.sh
```

More detail: [docs/integrations/gitlawb.md](docs/integrations/gitlawb.md)

## Development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build
pnpm start
```

The dashboard runs on port `5020` by default.

Before committing any feature or user-visible fix, add an entry to `CHANGELOG.md` with the timestamp, commit status, verification, and intended commit-message summary. See `AGENTS.md` for the project rule.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## Provenance

HivemindOS packages agent-control patterns, runtime adapter code, HivemindOS workflow templates, MiroShark companion integration, and local-first fleet telemetry into a standalone open-source dashboard. The AI SDK route and chat UI patterns were adapted from public Next.js agent examples. Some workflow templates were inspired by `shannhk/hermes-agent-control-room`.
