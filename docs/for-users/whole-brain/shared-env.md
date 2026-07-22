---
title: Whole Brain Shared Env
description: How HivemindOS stores and syncs shared agent environment variables.
---

# Shared Env

Shared env is where secrets go when agents need them.

Not in the vault. Not in random project `.env` files. Not copied into every runtime by hand until nobody knows which key is real anymore.

The canonical file is:

```text
~/.hivemindos/.env
```

Agents, scripts, and app services should load from that file at runtime when they need shared credentials.

Agent runtimes have Shared env permission by default. Fleet operators can restrict an individual machine to `Ask` or `Deny`; when restricted, HivemindOS leaves the stored values untouched and stops before starting a runtime that requested them.

## Why It Exists

The whole brain has two different kinds of memory:

- The Obsidian vault stores durable knowledge, work state, skills, and service notes.
- Shared env stores secrets and runtime credentials.

That split matters. The vault is meant to be read by agents. Secrets are not.

## Precedence: Project First, Hive Env Fallback

The shared file is a *default*, not an override. When something inside a project needs a variable, it reads the project's own value first — the project's `.env`/`.env.local`, its config, or an explicit shell export — and falls back to `~/.hivemindos/.env` only for keys the project does not set itself.

That gives you easy per-project overrides: set a key inside the project to override the shared value for that project alone, and leave it unset to inherit the fleet-wide default. Nothing shared changes.

`hive-env-run -- <command>` already follows this order — it loads `~/.hivemindos/.env` as a base, then overlays the current process environment, so anything the project or shell already set wins on top. HivemindOS-managed agents get the same rule in their instructions.

## The Helpers

Setup installs these helpers into `~/.local/bin`:

```bash
hive-env-add
hive-env-remove
hive-env-delete
hive-env-check
hive-env-run
```

Use them like this:

```bash
hive-env-add OPENAI_API_KEY
hive-env-add ANTHROPIC_API_KEY=...
hive-env-remove OPENAI_API_KEY
hive-env-delete ANTHROPIC_API_KEY
hive-env-add --import-env
hive-env-check OPENAI_API_KEY
hive-env-run -- pnpm dev
```

`hive-env-add KEY` prompts for the value without putting it in shell history. `hive-env-add KEY=value` is useful when the value is already coming from a safe command or paste flow.

`hive-env-remove KEY` removes a key from the same store and syncs that removal through the same machinery. `hive-env-delete KEY` is the same command under the other obvious verb.

`hive-env-check KEY` tells you whether a key exists without printing the value.

`hive-env-run -- command` runs a command with the shared env loaded into the child process.

## Runtime Compatibility

Some runtimes still need their own native env files. That is a compatibility layer, not the source of truth.

Use explicit runtime writes when needed:

```bash
hive-env-add --runtime hermes ANTHROPIC_API_KEY
hive-env-add --runtime aeon OPENAI_API_KEY
hive-env-add --runtime openclaw TAVILY_API_KEY
hive-env-remove --runtime aeon OPENAI_API_KEY
```

The default should still be the shared file at `~/.hivemindos/.env`.

## Sync To Machines

When Hivemind Sync is enabled, HivemindOS can push shared env keys and removals to trusted peer machines.

```bash
hive-env-add --reconcile
hive-env-add --pull-from USER@HOST
```

Pushes use ready collector `/env` endpoints on trusted machine links. Pulls from a peer still use Tailscale SSH because the remote machine has to export its local shared env set.

Secret values should not appear in command arguments, logs, shared notes, or chat transcripts.

### Retry Queue

Push replication is no longer fire-and-forget. When a peer cannot take an update — its collector is down, unreachable, or the push fails — the key name, scope, runtime, and per-machine delivery receipts (never values) are queued in:

```text
~/.hivemindos/env-sync-pending.json
```

Every later sync-enabled `hive-env-add` run drains the queue automatically, and the telemetry collector retries it on a timer. Queued removals propagate too. Entries clear once every enumerated ready peer has acknowledged, and expire after 14 days. Manual drain:

```bash
hive-env-add --retry-pending
```

### Periodic Pull-Reconcile

Each machine's telemetry collector also runs `hive-env-add --sync-maintenance` every 10 minutes (configurable with `AGENT_TELEMETRY_ENV_SYNC_INTERVAL_MS`, disable with `AGENT_TELEMETRY_ENV_SYNC_DISABLED=1`). That retries the queue, then pulls shared keys from every ready peer collector and merges them newest-wins using the per-key `updatedAt` metadata stored next to each env file. A machine that was offline when a key was added converges on its own. Keys removed locally keep a meta timestamp tombstone, so peers holding older copies cannot resurrect them. Manual runs:

```bash
hive-env-add --pull-reconcile --dry-run   # report what would be merged
hive-env-add --pull-reconcile             # merge newer/missing peer keys
curl -X POST http://127.0.0.1:8787/env/sync-maintenance   # collector-driven run now
```

Maintenance status (last run, last summary, errors) is reported in the collector `/health` payload under `envSync.maintenance`. Reconcile assumes tailnet machines keep reasonable NTP clock sync.

Advanced targeting uses:

```text
HIVE_ENV_TAILNET_TARGETS
HIVE_ENV_TAILNET_USER
HIVE_ENV_TAILNET_SYNC
HIVE_ENV_COLLECTOR_PORTS
```

Peers are auto-discovered from `tailscale status` and probed for a ready collector; machines that appear under two tailnet nodes (system tailscaled plus embedded link node) are deduplicated by machine id. Prefer auto-discovery: pinning `HIVE_ENV_TAILNET_TARGETS` to raw IPs silently blackholes pushes when a node's address changes. When `HIVE_ENV_COLLECTOR_PORTS` is set explicitly it is authoritative — default ports are not appended.

## AEON GitHub Secrets

Managed private AEON repos can receive changed shared env values as GitHub Actions secrets.

HivemindOS tracks sync state with fingerprints, not secret values:

```text
~/.hivemindos/aeon-env-sync-repos.json
~/.hivemindos/aeon-env-sync-state.json
```

Public AEON repos are skipped. If a managed repo becomes public, HivemindOS removes the secrets it managed.

## Encrypted Backup

If GPG is configured, `hive-env-add` can refresh an encrypted backup:

```text
Operations/Secure/hive.env.gpg
```

That file can live in the vault because it is encrypted. Plaintext env files cannot.

Backup settings use:

```text
HIVE_ENV_BACKUP_DIR
HIVE_ENV_GPG_RECIPIENT
HIVE_ENV_PUBLIC_KEY
```

## Hard Rules

- Do not put plaintext secrets in Obsidian notes.
- Do not print secret values during checks.
- Do not copy shared env values into project files just because it is convenient.
- Prefer `hive-env-check KEY` when you only need to prove a key exists.
- Prefer `hive-env-remove KEY` when a shared key should stop being available.
- Prefer `hive-env-run -- command` when a tool needs the shared env for one run.
- If a project needs shared credentials, load `~/.hivemindos/.env` at runtime instead of persisting secrets into the repo.
- Resolve project-first: use the project's own env value when it is set, and fall back to `~/.hivemindos/.env` only for keys the project does not define.

## Main Code Paths

- `scripts/hive-env-add`
- `scripts/hive-env-remove`
- `scripts/hive-env-delete`
- `scripts/hive-env-check`
- `scripts/hive-env-run`
- `src/app/api/env/route.ts`
- `scripts/agent-telemetry-collector.mjs`
- `src/features/dashboard/views/UtilityPanels.tsx`
- `src/lib/services/runtime-integrations.ts`
- `src/lib/services/runtime-adapters/aeon.ts`
