---
name: hive-remote-capability-use
description: Use a remote HivemindOS capability selected by hive-capability-search: refresh fleet/app discovery, resolve collector/app-proxy URLs, call remote endpoints safely, transfer local inputs privately, verify artifacts, and return receipts. Use when a task should run through a connected app, remote collector, Hivemind Link endpoint, remote local service, or fleet machine capability.
---

# Hive Remote Capability Use

Use this skill after `hive-capability-search` selects a capability that lives on another HivemindOS machine, connected app, remote collector, Hivemind Link app proxy, or fleet-owned local service.

This skill answers: "How do I execute the selected remote capability without guessing stale Tailnet URLs or exposing private files?"

## Inputs

Carry forward the relevant `hive-capability-search` result:

- The selected app, service, machine, route, model, provider, or agent capability.
- Any catalog fields such as app id, app name, machine id, machine display name, `apiBaseUrl`, `healthUrl`, `collectorUrl`, `routes`, `usageNotes`, preferred model, and required credential key names.
- Whether the task needs local files, media references, credentials, payment, publishing, message delivery, or other side effects.

If the capability map is missing the machine/app identity or side-effect gates, run one fresh bounded discovery pass before execution.

## Fresh Discovery First

Never hard-code private IPs, raw Tailnet URLs, transient collector ports, or old app-proxy URLs from a previous session. Remote service ports move.

Prefer HivemindOS discovery surfaces in this order:

1. The running dashboard API when available:
   - `GET <dashboard_origin>/api/fleet/discover?includeSnapshots=0&fresh=1`
   - `GET <dashboard_origin>/api/fleet/apps?refresh=1&fast=0`
2. The local collector and Hivemind Link surfaces exposed by the runtime or environment.
3. The app catalog entry returned by `hive-capability-search`, but only after a health check confirms it is still fresh.

Use the returned `apiBaseUrl`, `healthUrl`, or `collectorUrl` exactly as advertised. For remote apps, prefer the Hivemind Link app-proxy URL over direct remote loopback or raw Tailnet host:port access.

## Remote App Call Pattern

For a discovered remote app:

1. Call the app health endpoint.
2. Call the app capability, model, provider, or schema endpoint if one exists.
3. Build the smallest valid request for the task.
4. Send the request through `apiBaseUrl`.
5. Check HTTP status, content type, response body, and any provider-specific receipt.
6. Save generated artifacts to a local requested path or `/private/tmp`.
7. Verify artifacts before claiming success.

For media work, verification should include a relevant probe such as `ffprobe`, dimensions/duration checks, frame extraction, OCR/ASR, image nonblank checks, or a small playback/thumbnail review.

## Sensitive Local Inputs

Do not expose private local files by starting a temporary public HTTP server or binding a file server to `0.0.0.0`.

For files the remote machine must read, use one of the private HivemindOS transfer paths:

- `hive-transfer` or the local collector `/transfers` API for file handoff.
- `/api/handoff` or `/handoff-task` when a task should travel with the files.
- A shared-vault transfer payload when the machines sync the same HivemindOS vault.

Target the specific remote `machineId`, runtime, or agent when possible. Then poll the remote collector or handoff receipt until it reports the remote-local payload path. Use that remote-local path in the app request instead of a public URL.

Treat biometric voice clips, face references, private videos, documents, and screenshots as sensitive user data. Transfer them only when the user provided them for the requested purpose and the selected remote machine is trusted. Never transfer secrets unless the user explicitly asks and the destination is designed for secret handling.

## Credentials And Side Effects

Check credential presence by key name only, using approved env/status surfaces. Do not read, print, persist, or forward secret values unless the selected app route is explicitly the credential owner and the call is required.

Before external side effects, require the gate named by the selected capability:

- Publish, send, post, email, upload, deploy, pay, trade, train, or mutate external state.
- Spend credits or provider quota when the user did not already approve the exact operation.
- Expose local services publicly.

No approval is needed for read-only discovery, local artifact generation, private transfer to the user's own trusted machine for the current task, or status polling.

## Failure Recovery

If a direct URL is refused, times out, or returns a stale service, refresh fleet/app discovery before retrying.

If an app returns a schema error, ask its capability/schema endpoint and adapt the payload instead of guessing.

If a media provider silently falls back to the wrong voice, identity, model, or source image, stop and fix the reference/profile. Do not substitute a different voice or character without telling the user.

If an upload endpoint rejects multipart or data URLs for private files, use a private HivemindOS transfer and pass the resulting remote-local path when the app supports filesystem references.

## Reporting

Report:

- The logical app and machine used.
- The artifact paths, request ids, transfer ids, or provider receipts that prove completion.
- Any verification performed.
- Any remaining risk or blocked step.

Do not include raw Tailnet IPs, secret values, or private credential material in the final answer or durable memory.
