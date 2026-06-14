---
title: "Hivemind Sync And Tailscale Architecture"
---

# Hivemind Sync And Tailscale Architecture

HivemindOS treats the shared brain as a normal local markdown folder.

Obsidian is the editor. It is not the transport layer. The app reads and writes files in the configured vault path, while one selected sync owner decides how those files move between machines.

The user-facing name for that cross-machine movement layer is Hivemind Sync.

## Shared Brain Storage

The default vault path is:

```text
~/Documents/Obsidian/hivemindos-vault
```

The app can also use `NEXT_PUBLIC_OBSIDIAN_VAULT_PATH`, or auto-detect common
Obsidian locations. The shared brain contains agent inboxes, handoffs, Kanban
state, notifications, scheduled-run files, reusable skills, and shared context.

When the vault is unavailable, some features fall back to local app storage. For example, Kanban falls back to:

```text
~/.hivemindos/kanban
```

That fallback keeps the dashboard usable, but it is not the shared brain. Other machines and agents only see the same state after the vault path is reachable and the chosen sync owner is moving files.

## Hivemind Sync Owner Modes

The Brain view has a `Sync owner` setting. Pick one owner for realtime sync. Do not let two sync systems actively manage the same vault.

### External Provider

Use this when Obsidian Sync, iCloud Drive, Dropbox, Git, external Syncthing, or another folder sync tool already owns the vault.

In this mode HivemindOS:

- reads and writes the local vault folder
- does not auto-pair Syncthing
- leaves realtime replication to the external provider
- still allows manual rsync repair if the user explicitly runs it

This is the safest mode for users who already pay for Obsidian Sync or keep the vault in another synced folder.

### HivemindOS Syncthing

Use this when HivemindOS should provide Hivemind Sync folder movement for the shared brain. The app pairs local and remote Syncthing instances through the collector API.

The pairing flow is:

1. The dashboard discovers Tailscale peers.
2. Each peer with a ready collector reports Syncthing capability and a default
   sync path.
3. The dashboard calls `/api/syncthing/pair`.
4. That route asks the local and remote collectors for Syncthing device IDs.
5. Both collectors configure the `hivemindos-vault` folder and add each other as
   peers.
6. Syncthing performs ongoing file replication over the private Tailnet path.

Auto-pairing only runs when the shared brain is enabled, `Sync owner` is
`HivemindOS Syncthing`, `syncthingAutoPairEnabled` is true, the vault path is
set, and a discovered remote collector reports `capabilities.syncthing`.

### Manual Repair Only

Use this when realtime sync is off or handled elsewhere, but the user still wants a one-shot repair path between trusted machines.

The `Dry run` and `Sync now` buttons call `/api/obsidian/sync`, which uses
`rsync -e "tailscale ssh"` to push, pull, or bidirectionally reconcile the vault.
This path needs Tailscale SSH to work from the machine running the dashboard to
the target machine.

## Conflict Behavior

The conflict model depends on the transport.

Syncthing conflicts are owned by Syncthing. They appear as Syncthing conflict
files in the vault and in the Syncthing UI. HivemindOS does not rename or merge
those conflict files itself.

Manual rsync repair conflicts are owned by HivemindOS. For bidirectional repair,
the app compares local, remote, and last-known hashes. If both sides changed the
same file since the last successful repair state, the remote copy is preserved as
a file named like:

```text
note.conflict-host-2026-05-23T00-32-00-000Z.md
```

After a successful non-dry-run repair, HivemindOS stores the new hash baseline
under:

```text
~/.hivemindos/vault-sync/
```

Do not run Obsidian Sync and HivemindOS Syncthing as two independent realtime owners for the same vault. It may work for a while, then it gets confusing. Each provider has its own conflict format, timing, and retry behavior.

## How Tailscale Fits

Tailscale gives HivemindOS a private machine network. The app uses it for several separate jobs:

- Fleet discovery
- Collector access
- Hivemind Link app-managed collector access
- Syncthing peer addressing
- Hivemind Sync env pull and SSH fallback
- Tailscale SSH vault repair
- Tailscale SSH fleet update fallback

These features share the same Tailnet, but they are not the same protocol.

## Hivemind Link

Hivemind Link is the default app-managed path for users who want Fleet and remote chat without installing the system Tailscale VPN client. The `hivemind-linkd` sidecar uses Tailscale's embedded `tsnet` library to join the user's own Tailscale account as a HivemindOS app node.

In Link mode:

- the collector listens on `127.0.0.1`
- `hivemind-linkd` listens on the Tailnet and reverse-proxies to the local
  collector
- the dashboard reads `http://127.0.0.1:8788/status` when the system
  `tailscale` CLI is unavailable
- dashboard requests to remote collectors are sent to the local sidecar first,
  then the sidecar dials the peer through its embedded Tailscale netstack
- prompts, responses, model listings, and collector calls still travel over
  Tailscale's WireGuard-encrypted device links

Hivemind Link intentionally exposes only HivemindOS app traffic. It does not replace system Tailscale for Tailscale SSH, rsync repair, or Syncthing peer addresses. Run `./setup.sh --system-tailscale` when those full Tailnet extras are needed.

## Fleet Discovery

The dashboard calls `tailscale status --json` on the local machine. It uses the
peer list to build candidate collector URLs:

```text
http://100.x.y.z:8787
```

The collector should stay private to the Tailnet. HivemindOS does not need Tailscale Funnel for normal operation.

When Hivemind Link is enabled and the system `tailscale` CLI is absent, the
dashboard asks the local Link sidecar for the same peer status shape and uses
local URLs like `http://127.0.0.1:8788/peer/100.x.y.z%3A8787/...`. The sidecar
then dials the remote collector through `tsnet`, so the operating system does
not need a Tailnet route.

Do not treat those `/peer/...` URLs as local collector URLs. In Link mode, the local collector itself may run on another localhost port, recorded in `~/.hivemindos/collector.env`, but `/peer/...` must stay on the Link sidecar at `127.0.0.1:8788`. If it is rewritten to the collector port, remote machine chat fails fast with a misleading "does not have the Hermes chat bridge" or `404`, even when the remote collector is healthy.

## Collector Access

Each agent machine can run:

```bash
AGENT_TELEMETRY_PORT=8787 node scripts/agent-telemetry-collector.mjs
```

The collector exposes local status and controlled helper endpoints over the Tailnet. Important endpoints include:

- `/health`
- `/agents`
- `/snapshot`
- `/syncthing/status`
- `/syncthing/configure`
- `/syncthing/test-note`

The dashboard uses these endpoints for read-only fleet status, runtime
capability detection, Syncthing pairing, and setup-time sync verification.

## Syncthing Over Tailscale

Syncthing still does the actual file replication. Tailscale supplies a private network route and stable peer addresses. When HivemindOS configures Syncthing, it can give each side a peer address such as:

```text
tcp://100.x.y.z:22000
```

Syncthing can also fall back to `dynamic` discovery if available. The important point is that HivemindOS does not implement a realtime file sync engine. It coordinates Syncthing setup and lets Syncthing own the continuous replication loop.

## Hivemind Sync Handoff Transfers

For agent-to-agent files, images, reports, and generated artifacts, use the
vault-backed `hive-transfer` helper. It creates explicit Hivemind Sync envelopes under
`.hivemindos-transfers/<transfer-id>/` with machine/runtime/agent targeting,
payload hashes, and receiver acknowledgement files.

The receiver discovers waiting files by polling its collector inbox or running
`hive-transfer inbox` with its own identity. The full operator guide, CLI
reference, HTTP API examples, and troubleshooting checklist are in [Targeted Hive
File Transfers](../targeted-file-transfers.md).

## Tailscale SSH

Some operations need command execution on a trusted peer. Those use Tailscale SSH
instead of raw public SSH:

- `hive-env-add --pull-from` can pull env keys from a trusted peer.
- `/api/obsidian/sync` runs rsync repair.
- Fleet update fallback can run update commands on a remote checkout.
- Remote directory browsing can fall back to shell listing when a collector is
  stale or missing a directory endpoint.

On macOS, the App Store or sandboxed GUI build can join the Tailnet and support
VPN traffic for collectors and Syncthing, but it cannot host the Tailscale SSH
server. Machines that need to receive Tailscale SSH commands should use a
Tailscale build with the `tailscaled` daemon, such as the Homebrew/open-source
macOS daemon or the normal Linux service.

## Local-Only Mode

Tailscale is optional. Without Tailscale, HivemindOS can still run as a local
dashboard and use a local vault folder. Cross-machine discovery, collector
access, HivemindOS-managed Syncthing pairing, Hivemind Sync env movement, and rsync repair
are disabled until the machine joins a Tailnet and the relevant services are
running.

## Safety Boundaries

Secrets do not belong in the shared vault. Hivemind Sync env movement uses hive env helpers and ready collectors for pushes. Peer pulls and some repair paths can use Tailscale SSH.

The collector should be reachable only on trusted private networks. Keep it on
Tailscale, bind it to the expected port, and use Tailnet ACLs when a deployment
needs stricter separation between dashboard machines and agent machines.
