# Agent Client Protocol Integration

HivemindOS is an ACP v1 client for local background-agent sessions. The bundled HivemindOS task engine uses newline-delimited JSON over local standard input/output by default. This follows the stable protocol and transport described by the [Agent Client Protocol documentation](https://agentclientprotocol.com/get-started/introduction).

## Supported Boundary

- Stable ACP v1 only. The client rejects a negotiated protocol version it does not support.
- Local stdio transport only. Remote machines continue through Hivemind Link and the authenticated collector boundary; draft remote ACP transports are not used.
- New sessions, resume, load fallback, streamed session updates, prompt completion, and cancellation.
- Plans, message and thought chunks, tool-call lifecycle, mode changes, session information, command discovery, configuration changes, usage, and compaction updates are accepted. Customer run logs retain only useful progress and result text.
- Permission requests, workspace-confined text-file access, and governed terminal create/output/wait/kill/release requests.

The reusable client is under `src/lib/services/agent-client-protocol`. Runtime adapters opt in through their private task configuration; the bundled task adapter is the first enabled runtime.

## Task Lifecycle

1. Resolve and verify the requested working directory.
2. Spawn the local agent with separate protocol output and diagnostic error streams.
3. Negotiate ACP v1 and advertise only the client capabilities allowed for the task.
4. Create a new agent session, or resume/load the recorded session when a prior run is continued.
5. Apply the selected model through the session's standard `model` configuration option when the agent exposes one. This prevents a reused agent daemon from silently retaining another task's model.
6. Persist the agent-owned session identifier with the private run record.
7. Stream useful progress into the existing run log and evaluate the completed output through the existing completion gate. An exit-zero or `end_turn` response with no usable result is a failure, not a completed task.
8. Send `session/cancel` when the task is stopped, then terminate an unresponsive child after a bounded grace period. A user cancellation wins over a racing agent end-turn.

If negotiation fails before a session starts, HivemindOS automatically invokes the established CLI task command. It never replays a prompt through the fallback after an ACP session has started, because that could duplicate edits or other side effects.

## Safety And Permissions

- Canonical real paths confine file reads, writes, and terminal working directories to the requested workspace roots. Traversal and symlink escapes are rejected.
- Plan and restricted tasks cannot write files or create terminals.
- Standard background tasks may make ordinary edits and run allowlisted executables. Unusual commands remain blocked. Autonomous profiles may use their explicitly assigned bypass authority, subject to the same executable-token and private-session policy boundaries.
- Permission responses prefer one-time decisions. The client never silently upgrades a request to an always-allow grant.
- Terminal commands are spawned directly without a shell. Output is bounded, retains valid UTF-8, and truncates from the beginning as required by ACP.
- Agent diagnostics stay on the private server log. The task receipt and customer run log do not expose executable paths, protocol messages, credentials, or stored session identifiers.

## Recovery And Operator Controls

Set `HIVEMINDOS_AGENT_CLIENT_PROTOCOL=off` before the dashboard starts to keep bundled tasks on the compatibility runner. A single task action may also pass `compatibilityMode: true`. Neither control changes stored workspaces or session history.

Use the focused contract with `pnpm test:agent-client-protocol`. It runs a real stdio exchange against a hermetic agent fixture and covers capability negotiation, update mapping, permissions, file confinement, symlink rejection, terminal lifecycle, cancellation, persistence, and resume. `pnpm test:jcode-runtime-integration` separately proves that an older engine which cannot negotiate ACP recovers through the established command.

Run `pnpm test:e2e:agent-client-protocol` when the bundled sidecar is staged. It negotiates with that exact executable, creates and closes an isolated temporary session, and deliberately sends no model prompt.

Run `pnpm test:e2e:agent-client-protocol:app` for authenticated acceptance through an already-running local app. It covers a new session, same-session resume, cancellation, compatibility mode, persisted logs, private metadata, workspace binding, and public receipt redaction; it removes its exact run records, logs, and temporary workspace afterward. This test sends live model requests and may consume the configured account allowance or credits. Use `HIVEMINDOS_ACP_E2E_URL` for a non-default app port and `HIVEMINDOS_ACP_E2E_MODEL` for an explicit model. `HIVEMINDOS_ACP_E2E_SCENARIO=cancellation-only` and `compatibility-only` isolate those terminal behaviors when model variability would otherwise block a later stage.
