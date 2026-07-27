---
title: "Fleet Machine Permissions"
---

# Fleet Machine Permissions

HivemindOS can use a spare or borrowed computer as a collector node without running another dashboard there. The main hub can decide what agents on that machine may use, pause Queen Bee routing when the computer is busy, and keep policy changes under one master hub.

## Add A Collector-Only Machine

Run setup from the HivemindOS checkout on the additional machine.

macOS or Linux:

```bash
./setup.sh --collector-only
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1 -CollectorOnly
```

Collector-only setup automatically enables Hivemind Link on macOS, Linux, and Windows unless an operator explicitly chooses system Tailscale or local-only mode. Windows installs Go through `winget` when it is needed to build the Link sidecar; macOS and Linux use their supported package manager.

On the first connection, setup prints a Tailscale authorization URL. Open it on the main HivemindOS hub, or on any device signed into the same Tailscale account as the main hub, and approve the collector. Then return to Fleet Hive on the main hub. The collector appears automatically after Link connects; no Tailnet IP, port forwarding, Funnel, or manually pasted telemetry URL is required.

Collector-only mode is sticky. Normal updates keep the machine as a collector node and do not start a source dashboard. Use `--full` on macOS/Linux or `-Full` on Windows only when you intentionally want to convert that computer into a full hub.

After the machine joins the same Hivemind Link or Tailnet, it appears in Fleet as a Collector Node. Select it and open **Settings**.

## Permissions

Each collector has separate `Allow`, `Ask`, and `Deny` choices for:

- Shared Brain
- Shared env
- Chat history
- Apps and services on other machines
- Messaging channels
- HiveDrop and fleet file transfers

`Allow` makes the capability available to agent work on that collector. `Deny` tells the runtime not to use it. `Ask` treats the capability as denied until a human grants it.

Shared env defaults to `Allow`, so agents can use configured credentials without interrupting ordinary work for permission. The other machine capabilities default to `Ask`. An operator can still change Shared env to `Ask` or `Deny` for a borrowed or restricted machine; HivemindOS then stops before launching a runtime that requested a shared credential and reports the machine-policy decision instead of claiming that the credential is missing.

When an agent reaches an `Ask` capability, its Work Board card moves to **Needs You** with three choices:

- **Allow 15 min** grants temporary access and then expires automatically.
- **Always allow** changes that capability to `Allow` on the collector.
- **Deny** changes it to `Deny`.

The decision can use the same hub and messaging-channel notification path as other Needs You work. HivemindOS applies the decision on the collector before resuming the same agent. If the collector rejects the change or cannot be reached, the task stays parked.

## Master Hub Authority

The first hub that claims a machine in the **Authority** tab becomes its master policy hub. The collector, rather than the browser, records this authority and rejects policy changes from other hubs. Other hubs can still inspect the settings but see them as read-only.

Releasing authority is a separate confirmed action. Existing access and performance settings remain, but another hub can then claim the collector.

## Performance Routing

The **Performance** tab controls whether Queen Bee may delegate new work to the machine.

- **Ignore this machine** is a manual kill switch for new delegation.
- **Automatic usage limits** pause routing when live CPU, RAM, or storage use rises above the selected percentage.
- When usage falls back inside every limit, the machine becomes eligible again on a fresh Fleet discovery.

These controls affect new Queen Bee routing. They do not terminate an agent or game that is already running.

## Security Boundary On A Borrowed Computer

Machine permissions are agent-governance controls for work launched through the HivemindOS collector. The collector strips denied shared-env values from spawned agents, restricts Shared Brain roots, prevents denied chat-session resume, and supplies the remaining capability rules to the runtime. They are not an operating-system sandbox against a malicious local administrator, arbitrary software already running on the computer, or an agent that escapes its runtime contract.

For a borrowed computer, use a separate operating-system account for the collector, give that account access only to intended project folders, and avoid syncing secrets or personal files that the machine should never possess. Keep the computer behind Hivemind Link or Tailscale rather than exposing its collector port publicly.
