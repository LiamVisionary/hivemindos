# Hivemind Sync Handoff Transfers

Hivemind Sync handoff transfers let one machine, runtime, or agent leave files for another agent without broadcasting the work item to every process watching the shared vault.

Use this for artifacts that should move through the shared Obsidian brain: screenshots, generated media, reports, source bundles, QA captures, and handoff attachments. Do not use it for secrets. Transfer manifests and payloads live in the synced vault and may be replicated to every paired vault device at rest.

## What This Solves

The shared vault is intentionally visible to trusted HivemindOS machines. That makes it good for shared context, but a raw `attachments/` drop folder gets ambiguous fast:

- every agent has to inspect the same files
- there is no machine/runtime/agent routing
- receivers cannot tell whether they already collected a file
- senders cannot attach integrity metadata or a note consistently

`hive-transfer` fixes that by creating a small Hivemind Sync envelope with explicit routing metadata, payload checksums, and receiver acknowledgements.

## Storage Layout

Handoff transfers live under the configured vault path, defaulting to:

```text
~/Documents/Obsidian/hivemindos-vault/.hivemindos-transfers/
```

Each transfer is one directory:

```text
.hivemindos-transfers/<transfer-id>/
  manifest.json
  payload/<files>
  acks/<machineId>--<runtime>--<agentId>.json
```

The `manifest.json` uses schema `hivemind.transfer.v1` and records:

- `id`: generated `hive-transfer-...` id
- `status`: currently `pending`
- `createdAt`: ISO timestamp
- `note`: optional sender context
- `from`: optional sender machine/runtime/agent identity
- `to`: target machine/runtime/agent identity
- `payloads`: copied files with media type, size, SHA-256, and relative vault path

Example manifest shape:

```json
{
  "id": "hive-transfer-2026-05-26T17-00-00-000Z-a1b2c3d4e5f6",
  "schema": "hivemind.transfer.v1",
  "status": "pending",
  "createdAt": "2026-05-26T17:00:00.000Z",
  "note": "source screenshot for preview QA",
  "from": {
    "machineId": "hivemind-machine-sender",
    "host": "ubuntu-8gb-hel1-2",
    "runtime": "hermes",
    "agentId": "qa-agent"
  },
  "to": {
    "machineId": "hivemind-machine-receiver",
    "host": "Liams-MacBook-Pro.local",
    "runtime": "hermes",
    "agentId": "renderer"
  },
  "payloads": [
    {
      "name": "screenshot.png",
      "mediaType": "image/png",
      "bytes": 123456,
      "sha256": "...",
      "path": ".hivemindos-transfers/<transfer-id>/payload/screenshot.png"
    }
  ]
}
```

## Targeting Rules

A receiver only sees a pending transfer when its inbox query matches the manifest `to` fields.

- `to.machineId` targets a durable HivemindOS machine id.
- `to.host` can target a hostname when a machine id is not available.
- `to.runtime` optionally narrows visibility to a runtime such as `hermes`, `openclaw`, or `aeon`.
- `to.agentId` optionally narrows visibility to one agent inside that runtime.

Important behavior:

- Wrong machine: hidden.
- Wrong explicit runtime: hidden.
- Wrong explicit agent: hidden.
- Runtime-level inbox: if a receiver polls with `--runtime hermes` and no `--agent`, it can see transfers for that runtime on that machine, including agent-specific transfers, so a runtime supervisor can route internally.
- Agent-level inbox: if a receiver polls with both `--runtime` and `--agent`, it sees runtime-wide transfers plus transfers for that exact agent.

Prefer `machineId` for durable targeting because hostnames can collide or change. Use `host` only when bootstrapping before the receiver has advertised a stable machine id.

## CLI Usage

Setup installs `hive-transfer` next to the shared env helpers in `~/.local/bin`.

### Send files

```bash
hive-transfer send \
  --toMachine hivemind-machine-receiver \
  --toRuntime hermes \
  --toAgent renderer \
  --fromMachine hivemind-machine-sender \
  --fromRuntime hermes \
  --fromAgent qa-agent \
  --note "source screenshot for preview QA" \
  ./screenshot.png ./report.md
```

You can target by host instead of machine id:

```bash
hive-transfer send \
  --toHost Liams-MacBook-Pro.local \
  --toRuntime hermes \
  --toAgent renderer \
  ./artifact.zip
```

Use `--syncPath` to override the vault path for tests or non-default vaults:

```bash
hive-transfer send --syncPath /path/to/vault --toMachine hivemind-machine-receiver ./file.png
```

### Check the inbox

```bash
hive-transfer inbox \
  --machine hivemind-machine-receiver \
  --runtime hermes \
  --agent renderer
```

The command returns JSON with matching transfers and absolute payload paths after Syncthing or the selected vault sync provider has replicated the files locally.

Runtime supervisor example:

```bash
hive-transfer inbox \
  --machine hivemind-machine-receiver \
  --runtime hermes
```

Include already acknowledged transfers for debugging:

```bash
hive-transfer inbox --machine hivemind-machine-receiver --runtime hermes --agent renderer --all
```

### Acknowledge collection

After the receiver has read or copied the payload, it should acknowledge the transfer:

```bash
hive-transfer ack hive-transfer-2026-05-26T17-00-00-000Z-a1b2c3d4e5f6 \
  --machine hivemind-machine-receiver \
  --runtime hermes \
  --agent renderer
```

Acknowledgement writes an `acks/*.json` file in the transfer directory. Future inbox checks for the same receiver hide that transfer unless `--all` is used.

## Collector HTTP API

The telemetry collector exposes the same semantics when it advertises this health capability:

```json
{
  "capabilities": {
    "fileTransfers": true
  }
}
```

### List inbox

```http
GET /transfers?machineId=hivemind-machine-receiver&runtime=hermes&agentId=renderer
```

Supported query parameters:

- `machineId`
- `host`
- `runtime`
- `agentId`
- `all=true` to include already acknowledged transfers

### Create transfer

```http
POST /transfers
Content-Type: application/json

{
  "files": ["/absolute/path/to/screenshot.png"],
  "note": "source screenshot for preview QA",
  "from": {
    "machineId": "hivemind-machine-sender",
    "runtime": "hermes",
    "agentId": "qa-agent"
  },
  "to": {
    "machineId": "hivemind-machine-receiver",
    "runtime": "hermes",
    "agentId": "renderer"
  }
}
```

### Acknowledge transfer

```http
POST /transfers/ack
Content-Type: application/json

{
  "id": "hive-transfer-2026-05-26T17-00-00-000Z-a1b2c3d4e5f6",
  "machineId": "hivemind-machine-receiver",
  "runtime": "hermes",
  "agentId": "renderer"
}
```

Keep collectors private to Tailscale or Hivemind Link. Do not expose these endpoints on the public internet.

## How Receivers Know A File Is Waiting

Receiving agents use polling, not push notifications:

1. The sender creates a transfer envelope in the shared vault, either via CLI or `POST /transfers`.
2. Syncthing or the selected vault sync owner replicates the directory to the receiver's local vault.
3. The receiving runtime or dashboard periodically calls `hive-transfer inbox` or `GET /transfers` with its own machine/runtime/agent identity.
4. Matching transfers appear in the inbox response with local payload paths.
5. After processing, the receiver calls `hive-transfer ack` or `POST /transfers/ack`.

This model keeps delivery local and robust. If the receiver is offline, the transfer waits in the vault until sync and polling resume.

## Verification Checklist

When changing this feature or diagnosing a delivery issue, verify all of the following before declaring success:

1. `npm run test:hive-transfer` passes.
2. `node --check scripts/hive-transfer.mjs` passes.
3. `node --check scripts/agent-telemetry-collector.mjs` passes if collector code changed.
4. Collector `/health` reports `capabilities.fileTransfers: true` on machines expected to serve HTTP inboxes.
5. A wrong-machine, wrong-runtime, or wrong-agent inbox returns zero transfers.
6. The intended receiver's inbox returns the transfer.
7. The receiver can read the payload file from its local vault path.
8. The receiver can acknowledge the transfer and the normal inbox hides it afterward.
9. For cross-machine claims, verify the transfer directory exists on the receiving machine, not just on the sender.

## Troubleshooting

### The receiver sees no transfer

- Confirm the sender and receiver use the same vault path or paired vault folder.
- Confirm Syncthing or the external sync provider replicated `.hivemindos-transfers/<id>/` to the receiver.
- Check the manifest `to` fields against the receiver's actual `machineId`, `host`, `runtime`, and `agentId`.
- Prefer `machineId`. If only `host` is set, make sure the hostname exactly matches what the receiver reports.
- Confirm the collector on that machine advertises `fileTransfers` before relying on HTTP polling.

### Sync looks connected but files do not move

Syncthing can show a peer as connected while the folder state is `notSharing`. That means the peer is reachable but has not accepted/configured that folder for the other device. Add the missing device to the `hivemindos-vault` folder on the peer, restart or rescan Syncthing, then test with a small note and a real transfer.

### The wrong agent can see a transfer

Check whether it is polling at runtime-supervisor scope. A runtime-level inbox intentionally sees transfers for that runtime so it can route internally. To restrict visibility to one worker, include `to.agentId` in the manifest and have worker agents poll with `--agent <agent-id>`.

### Payload integrity is uncertain

Use the payload `sha256` and `bytes` fields from the manifest to verify the local file after replication. A receiver should not acknowledge until it has confirmed the local payload is present and usable.

## Safety Boundaries

- Do not send API keys, passwords, private keys, wallet seeds, or other secrets through `hive-transfer`.
- Do not write secrets into transfer notes or filenames.
- Use `hive-env-add`, `hive-env-remove`, `hive-env-delete`, `hive-env-check`, and `hive-env-run` for shared environment variables.
- Treat the transfer directory as vault data: any trusted device paired to the vault sync may receive the bytes at rest.
