---
title: Whole Brain Sync And Health
description: Hivemind Sync, vault doctor, cleanup, secure backups, and migration manifests.
---

# Sync And Health

The vault is local markdown. Hivemind Sync is transport plus routing.

That distinction matters. The vault is the brain. Hivemind Sync decides how trusted machines move shared brain files, handoff transfers, and shared env.

For the feature-level version, see [Hivemind Sync](../features/hivemind-sync.html).

## Sync Ownership

Exactly one sync owner should own realtime shared-brain replication:

| Owner | Use when |
| --- | --- |
| External provider | Obsidian Sync, iCloud Drive, Dropbox, Git, or user-managed Syncthing already owns the vault. |
| HivemindOS Syncthing | Trusted machines should pair over Tailscale or Link and each keep a local vault copy. |
| Manual repair | One-shot rsync repair over Tailscale SSH is needed. |

Do not stack multiple realtime sync systems on the same vault unless the user explicitly designed that setup.

When HivemindOS owns Syncthing, Fleet health checks run collector-side self-heal automatically before showing a warning. The repair starts Syncthing when possible, resumes paused vault folders and devices, restores the vault folder's paired-device membership, recreates `.stfolder`, rescans the folder, and returns before/after sync health for the dashboard. Fleet only surfaces a sync warning when automatic repair fails and manual attention may be needed.

## Handoff Transfers

Handoff files and artifacts live under:

```text
.hivemindos-transfers/
```

This is the vault-backed handoff folder used by `hive-transfer`. Agents and humans should usually call `hive-handoff`, `/api/handoff`, `/handoff-task`, or `hivemind-mcp` first so HivemindOS can fuzzy-match the target machine and select the best receiving agent. Each transfer has a manifest, payload files, targeting metadata, hashes, and acknowledgement files.

The folder is safe to sync as vault data. It is not safe for secrets.

## Vault Doctor

The doctor audits the shared vault:

```bash
pnpm vault:doctor
```

It is read only by default. With `--fix`, it moves content into canonical homes or archives stale material:

```bash
pnpm vault:doctor -- --fix
```

The doctor checks:

- duplicate active shared skills by `SKILL.md` hash
- sync conflict and backup artifacts
- retired root folders/files
- active `hive-e2e-*` shared skills
- hidden AEON profile stubs
- hidden AEON runtime mirror placement
- legacy `Notes/` content
- legacy root `Scheduled/` state

## Migration Manifests

Fixes write JSONL manifests under:

```text
Operations/Vault Migrations/<timestamp>-vault-doctor/manifest.jsonl
```

These manifests are the audit trail. Do not delete them casually.

## Secure Backups

Encrypted backup artifacts and public-key reference notes live under:

```text
Operations/Secure
```

This path replaces the retired `Notes/Secure` default.

Store encrypted files, public keys, and reference metadata there. Do not store plaintext secrets in the vault.

Shared env has its own page because it is brain-adjacent but not vault content: [Shared Env](shared-env.html).
