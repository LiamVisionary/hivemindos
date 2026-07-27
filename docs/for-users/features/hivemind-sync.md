---
title: Hivemind Sync
description: How HivemindOS moves brain files, shared env, and handoff transfers between machines.
---

# Hivemind Sync

Hivemind Sync is the name for the cross-machine movement layer.

It is not one protocol. It is the app-level route that keeps trusted machines working from the same brain, the same shared env, and the same handoff folder without pretending those are all the same kind of data.

## What It Moves

Hivemind Sync covers three surfaces:

- Shared brain files in the Obsidian vault.
- Shared env keys in `~/.hivemindos/.env`.
- Handoff file transfers in `.hivemindos-transfers/`.

The shared brain and handoff transfers are vault data. They move when Syncthing or the selected vault sync owner moves the local vault folder.

Shared env is not vault data. It moves through the HivemindOS collector env endpoint when trusted peers are reachable. Pulls and some repair/fallback flows can still use Tailscale SSH.

## Shared Brain

The brain is a normal local markdown vault:

```text
~/Documents/Obsidian/hivemindos-vault
```

Hivemind Sync does not replace Obsidian Sync, iCloud Drive, Dropbox, Git, or another folder sync tool. The Brain settings pick one owner for realtime vault replication:

- external provider
- HivemindOS-managed Syncthing
- manual repair only

When HivemindOS manages it, the app pairs Syncthing through trusted collectors and lets Syncthing do the continuous file replication. Fleet sync health checks automatically use the same collector bridge to self-heal common Syncthing drift before showing a warning: restart an unreachable local API when possible, resume paused vault folders or devices, restore the shared vault folder membership, recreate the `.stfolder` sentinel, rescan the vault, and report before/after health. The Fleet roster only asks for attention when automatic repair fails.

## Shared Env

Shared env lives outside the vault:

```text
~/.hivemindos/.env
```

Use the helper commands:

```bash
hive-env-add OPENAI_API_KEY
hive-env-remove OPENAI_API_KEY
hive-env-check OPENAI_API_KEY
hive-env-add --reconcile
```

`--reconcile` pushes the current shared env set to ready peers through collector `/env` endpoints. Those collector endpoints should only be reachable on trusted private machine links.

`--pull-from USER@HOST` still uses Tailscale SSH because it asks the remote machine to export its local shared env set and merge missing keys back onto this machine.

## Handoff Transfers

Handoff transfers are for files and artifacts that need to move from one machine, runtime, or agent to another.

They live in the vault folder:

```text
.hivemindos-transfers/
```

Each transfer is an envelope with a manifest, payload files, targeting metadata, hashes, and acknowledgement files. The receiver sees the transfer after the selected vault sync owner has replicated the folder locally.

Agents should usually use the friendly planner command:

```bash
hive-handoff send --to ubuntu ./artifact.png
hive-handoff send --to ubuntu --task "review this artifact" ./artifact.png
hive-handoff task --to ubuntu "summarize the local project state"
```

It fuzzy-matches connected Fleet machines, selects the best target agent for task handoffs, then uses `hive-transfer` underneath.

Low-level transfer commands remain available:

```bash
hive-transfer send --toMachine MACHINE_ID ./artifact.png
hive-transfer inbox --machine MACHINE_ID
hive-transfer ack hive-transfer-...
```

Do not use handoff transfers for secrets. Use shared env helpers for keys.

## Transport Map

| Surface | Hivemind Sync route |
| --- | --- |
| Shared brain | Selected vault sync owner. Built-in path is Syncthing through trusted collectors. |
| Handoff transfers | `.hivemindos-transfers/` inside the synced vault. |
| Shared env push/remove | Collector `/env` endpoint on ready peers. |
| Shared env pull | Tailscale SSH export from a trusted peer. |
| Vault repair | Syncthing self-heal through trusted collectors; manual rsync over Tailscale SSH remains the fallback for non-Syncthing owners. |

The common rule is simple: keep the collector private, keep the vault sync owner singular, and keep plaintext secrets out of the vault.
