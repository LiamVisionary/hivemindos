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

## Memory Integrity And Recovery

`hive-brain health --json` reports the current typed-memory generation, retained and invalid generation counts, replay coverage, the active retention/checkpoint policy, the transaction-journal size, embedding coverage, and embedding identity mismatches. `hive-brain generations` lists each retained generation and its verification/checkpoint state, plus the earliest generation from which replay is complete.

Normal reads verify manifest and artifact checksums. If the current artifact is corrupt, recall uses its verified parent; if multiple recent generations are damaged, it scans backward for the newest remaining verified snapshot. If the current pointer itself is damaged, readers also scan for the newest verified generation. A newer legacy JSONL mirror from an older client remains readable and is folded into a fresh generation on rebuild.

Physical history is bounded without changing the authoritative Markdown notes. Typed Agent Memory keeps at most 256 generated snapshots with a checkpoint every 32; full-vault search keeps at most 32 with a checkpoint every 4. Between checkpoints, artifacts use verified content-addressed deltas when smaller and gzip or full storage otherwise. Pruning commits only at a verified checkpoint and records its replay boundary in the index kind's `coverage.json`. Because pruning intentionally removes older generated snapshots, use the coverage fields instead of assuming replay reaches the first-ever write. An invalid receipt—or a missing receipt when retained manifests prove an earlier parent was removed—is reported explicitly and pauses further pruning until the last valid synced or backed-up copy is restored, so the service does not overwrite an unknown replay boundary.

Memory source changes are journaled before promotion. A crash after source promotion does not require hand-editing generated indexes: the next memory writer completes recoverable staged files and rebuilds typed/entity generations from Markdown. An unrecoverable missing staged file is marked aborted and the generated pointer does not advance.

Brain capsule verification is separate from vault health. Opening a capsule validates content addresses, payload/provenance checksums, embedded search rows, manifest counts, and expiry. Encrypted envelopes also validate bounded KDF/cipher parameters, authenticated metadata, and the AES-GCM tag. Plaintext checksums detect corruption but do not authenticate the sender because an editor can recompute them; use encryption when tamper detection or a trustworthy expiry matters. Capsule imports remain proposals until Brain Review approval and apply.

## Compiled Knowledge Health

Compiled Knowledge has its own graph-aware health scan through:

```text
/api/brain/knowledge
```

Use `action: "scan-health"` to find broken wikilinks, orphan entity/concept pages, duplicate slugs, and missing backlinks inside `Synthesis/Compiled Knowledge/<domain>/wiki/`. Use `action: "fix-health"` only for safe deterministic fixes, such as a suggested broken-link retarget or a missing backlink. Review-only issues stay visible until a human or agent explicitly dismisses them with `action: "dismiss-health"`.

Dismissals live in the compiled wiki domain at:

```text
Synthesis/Compiled Knowledge/<domain>/wiki/.health-dismissed.jsonl
```

This keeps maintenance decisions with the compiled wiki so they can sync with the same vault owner.

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
