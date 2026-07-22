# HivemindOS Roadmap

HivemindOS is a local-first control room for private agent fleets. It connects agents across trusted machines, gives them shared memory and work queues, and keeps secrets, dashboards, and collectors inside the user's private network by default.

## Current Surface

- Machine-first Fleet dashboard for local and Tailscale-connected agent nodes.
- Setup flow for local dashboard dependencies, collectors, Syncthing, shared skills, and optional Tailscale-based multi-machine support.
- Lightweight collector install paths for macOS LaunchAgent and Linux systemd user services.
- Collector health, version, runtime, schedule, chat, session, Syncthing, and snapshot endpoints.
- Hermes, OpenClaw, Aeon, and MiroShark runtime surfaces through neutral dashboard adapters.
- Aeon support for `aeon.yml` schedules, GitHub Actions runs, outputs, local skills, shared Brain skill sync, env-secret sync, and optional A2A skill discovery.
- Shared Obsidian Brain defaults under `hivemindos-vault`, including shared skills, notifications, Brain graph, MiroShark archives, and Work board storage.
- GitLawb Code Proof default for lightweight CLI/DID readiness, project registry links, Work proof badges, Fleet Code Node status, and lazy local node setup.
- Built-in Syncthing-over-Tailscale brain sync, with Tailscale SSH and rsync kept as advanced repair paths.
- `hive-env-add` for local app/runtime env writes, selected runtime compatibility writes, encrypted note backups, and trusted Tailnet peer sync.
- Work board with vault-backed Kanban state, Queen/worker routing, task edit/delete, same-agent interrupt steering, mobile move controls, stale session recovery, tool-output stall detection, markdown rendering, event history, and regression coverage.
- Scheduler studio for reusable prompt/step runs, runtime schedule import/actions, skill/path attachments, and runtime-neutral schedule metadata.
- Alerts inbox for agent notifications, auth failures, task decisions, and markdown-rendered alert bodies.
- Durable redacted incident capture with Fleet Watchdog escalation, an optional pinned loopback OpenSRE root-cause provider, and approval-gated follow-up actions.
- Chat bridge for supported runtimes, including collector-backed Hermes chat and persisted remote session polling.
- Agent security proxy and OpenClaw security proxy for local prompt guardrails and secret redaction.
- Controlled agent wallet surfaces for local wallets, x402 mock paid endpoints, and spend logging.
- Public GitHub identity: `LiamVisionary/hivemindos`.

## Next

- Polish first-run onboarding around HivemindOS naming, repo rename redirects, default vault migration, Tailscale status, missing Node.js/pnpm, and collector reachability.
- Add an operator health cockpit backed by `/api/system/health`, then expand it with bounded provider, model-server, collector, Syncthing, shared-brain, wallet, and runtime probes.
- Add a first-run smoke checklist that verifies dashboard auth, collector readiness, shared vault/indexes, shared env presence, one runtime chat, one Work Board task, and one handoff path.
- Add a self-host troubleshooting cookbook for Link, collectors, Syncthing, Obsidian vault indexes, runtime bridges, local model servers, shared env sync, and common port/auth failures.
- Add Fleet-powered model-fit recommendations that map each machine's CPU/GPU/RAM/runtime facts to local model, hosted provider, UsePod, Bankr LLM, or OpenRouter routing suggestions.
- Add blind model compare for Hive Fusion and adaptive routing so operators can compare answers without model labels, reveal identities after voting, and feed results into reliability stats.
- Add workspace/profile isolation for operators who need separate agent fleets, vault targets, provider defaults, wallet policies, allowed tools, and runtime session stores for different projects or clients.
- Expand the native first-run path into a guided setup and repair wizard that classifies fresh, update, replace, remote, and existing-install states before running actions.
- Make the native first-run wizard show Code Proof as an explicit recommended setup row before the terminal command opens.
- Add a clear migration panel for users moving from older local storage keys, old vault folder names, and previous collector service names.
- Make collector auto-update safer and more visible, including dry-run diff summaries, rollback notes, and post-update health checks.
- Add collector authentication on top of Tailnet reachability.
- Add configurable redaction rules for task titles, recent messages, hostnames, vault paths, and local paths.
- Tighten remote mutation/update endpoints with explicit capability checks and operator confirmation copy.
- Expand GitLawb project linking into verified commit/ref proof ingestion once upstream node capabilities and local repo flows are stable.
- Expand integration tests for the renamed `hivemindos` storage namespace and old-key migration.
- Add CI for typecheck, focused lint, Kanban workflow tests, dashboard nav tests, build, and secret scanning.

## Runtime Depth

- Hermes: richer activity extraction from sqlite sessions, logs, cron, Telegram/Discord/Slack adapters, and task-bus files.
- Hermes: make long-running remote task streams more resilient with resumable transcript polling and clearer auth recovery.
- OpenClaw: improve live gateway status, active session discovery, skill status, channel health, and recent message history.
- Aeon: deepen GitHub Actions run controls, workflow diagnostics, schedule editing, and local/A2A fallback behavior.
- MiroShark: turn saved simulation runs into reusable rehearsal templates and compare runs over time.
- Add per-agent searchable history across chat, Work board tasks, scheduler runs, alerts, and collector snapshots.
- Build a cross-machine activity timeline that can answer "what did this agent do today?"

## Native Mobile App

- Build a HivemindOS native mobile app for iOS and Android as a companion control room for on-the-go fleet triage.
- Support secure pairing with a local or Tailnet HivemindOS hub, with explicit device trust, revocation, and offline-safe status displays.
- Bring Work board review, agent chat, alerts, Fleet health, and scheduler approvals into mobile-first surfaces instead of only adapting the desktop dashboard.
- Add push notifications for agent calls, blocked tasks, auth failures, update readiness, and urgent Fleet health changes.
- Keep mobile data minimization strict: no secrets by default, scoped vault/task sync, redacted previews, and clear operator controls for what leaves each machine.
- Reuse native deep links and phone gateway pairing where possible so the existing call gateway and future HivemindOS mobile app share one trusted pairing model.

## Shared Brain

- Make the HivemindOS Brain folder structure explicit: memory, skills, work, alerts, archives, project context, and operator preferences.
- Add vault-safe write APIs with explicit allowlists, append-only defaults, and dry-run previews.
- Add agent handoff notes that link tasks, source messages, outputs, decisions, and follow-up owners.
- Add Brain graph filters for project, agent, runtime, skill, notification, and task edges.
- Add conflict handling for Syncthing-backed Brain edits and explain conflict copies in the UI.
- Make shared skill import/sync status visible per target runtime and per managed skill.

## Fleet And Security

- Keep Tailscale as the default encrypted transport for multi-machine fleet operations.
- Add Tailnet ACL examples for control-room devices, agent nodes, and read-only observers.
- Add optional machine tags such as `tag:hivemindos-control-room` and `tag:hivemindos-agent-node`.
- Support collector discovery by Tailscale device list, MagicDNS names, manually pinned nodes, and signed collector metadata.
- Add signed collector identity so the dashboard can distinguish trusted agent nodes from unknown machines.
- Keep GitLawb node hosting local/Tailnet-only by default; document and gate any public federation, staking, IPFS, Arweave, or public registration flows behind explicit opt-in.
- Add per-agent secret scopes, revocation notes, and rotation reminders.
- Support age/SOPS-style encrypted files for users who want a file-backed secret registry.

## Productization

- Streamline setup into a single public installer command with a readable audit trail.
- Package signed releases for macOS and Linux.
- Add documentation for safe public deployment boundaries and why collectors should stay private by default.
- Add one-click VPS setup with explicit dry-run, review, dependency pinning, backup notes, and port maps.
- Generate operator runbooks for collector repair, Brain sync repair, env rotation, and runtime auth recovery.
- Keep the app usable as a single-machine local dashboard even when Tailscale, Syncthing, or remote runtimes are absent.

## Open Questions

- Should the default local dot-directory stay permanently as `~/.hivemindos`, or should setup migrate old data into it automatically and archive old folders?
- Should HivemindOS remain purely local-first, or offer an optional hosted rendezvous layer for teams that do not use Tailscale?
- Which runtime should own high-level swarm planning by default: Queen Bee profiles in HivemindOS, OpenClaw, Aeon schedules, or an external orchestrator?
- How much autonomous remote repair should collectors be allowed to perform without an explicit human confirmation step?
