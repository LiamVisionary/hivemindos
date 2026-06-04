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

## Why It Exists

The whole brain has two different kinds of memory:

- The Obsidian vault stores durable knowledge, work state, skills, and service notes.
- Shared env stores secrets and runtime credentials.

That split matters. The vault is meant to be read by agents. Secrets are not.

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

Advanced targeting uses:

```text
HIVE_ENV_TAILNET_TARGETS
HIVE_ENV_TAILNET_USER
HIVE_ENV_TAILNET_SYNC
```

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
