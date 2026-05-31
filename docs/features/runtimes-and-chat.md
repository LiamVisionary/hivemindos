# Agents, Runtimes, And Chat

Agents are local profiles that point at a runtime, gateway URL, token, model/provider settings, shared vault settings, optional collector metadata, wallet settings, and phone-call context. Chat bridges the dashboard to supported runtimes while preserving machine, runtime, agent, directory, and session context.

## Runtime Model

Known runtimes are defined in `src/lib/types/agent-runtime.ts`:

| Runtime | Kind | Main capabilities |
|---|---|---|
| OpenClaw | Gateway | status, chat, model selection |
| Hermes | Interactive | status, chat, runs, memory, sessions, background tasks, X search, video generation, Codex runtime, Kanban decomposition, model selection |
| Aeon | Background | status, skills, schedules, runs, outputs, memory, background tasks, notifications |
| OpenAI-compatible | Interactive | status, chat, model selection |

## How Runtime Settings Work

- Runtime adapters live in `src/lib/services/runtime-adapters`.
- The adapter registry is `src/lib/services/runtime-adapters/registry.ts`.
- Agent settings use `/api/runtimes/[runtime]/integrations` for capability and model-selection data.
- Runtime availability is read through `/api/runtimes/availability`.
- Remote runtime agent creation is proxied through `/api/agents/runtime` when the collector supports it.

## How Chat Works

- The primary send path is `/api/chat/agent-runtime`.
- Session reads use `/api/chat/agent-session`.
- Runtime stream events are normalized by `src/lib/services/runtime-stream-events.ts`.
- The collector bridges Hermes and other local runtime sessions when a remote machine owns the agent.
- Chat history and folders are cached in browser storage and supported by `/api/chat/folders`.
- Chat folder creation and linked directory context use the same machine-aware directory helper as Kanban and Scheduler: native local folder picker in Tauri, Hivemind Link/collector directory browsing for remote machines, and API fallback in the browser.

### Collector And Link URLs

Hermes agents discovered through Fleet usually store a collector URL in
`agent.telemetryUrl`. In system Tailnet mode that may be a direct remote
collector such as `http://100.x.y.z:8787`. In Hivemind Link mode, remote agents
use the local Link sidecar proxy:

```text
http://127.0.0.1:8788/peer/100.x.y.z%3A8787
```

That URL is still remote. Preserve the `/peer/...` prefix and port `8788` when
sending chat, reading sessions, browsing files, or checking capabilities. Only
plain local collector URLs such as `http://127.0.0.1:8787` should be
canonicalized to the active local collector port from
`~/.hivemindos/collector.env`.

If a remote Hermes agent fails immediately with "does not have the Hermes chat
bridge" or a fast `404`, check whether a Link `/peer/...` URL was accidentally
rewritten to the collector port. The healthy path keeps `/peer/...` on
`127.0.0.1:8788` and appends collector endpoints under that prefix.

## Capabilities

- Runtime/provider/model selection where supported.
- Streaming runtime responses where available.
- Session resume and session search.
- Attachments and linked directories for task context.
- Send-to-Kanban from chat messages.
- Agent prompts for clarification, approval, secrets, or sudo-style decisions.
- Agent role, worker class, preferred skills, and per-agent env values.
- Dashboard agent calls that start through `/api/phone` using the gateway's in-app voice path instead of ringing the phone.
- Scheduled/ring-agent calls that can ring the paired mobile device when explicitly triggered.
- AEON call briefings with repository, branch, workspace, A2A, memory, skills, and recent MiroShark deliverable context.

## Phone And Voice Bridge

Phone support is split between a settings surface and action routes:

- `src/features/dashboard/views/PhonePanel.tsx` manages saved prompts, scheduled call rows, device status, and ring actions.
- `src/features/dashboard/views/chat/AgentCallsSettingsPanel.tsx` exposes pairing and test-call controls in agent settings.
- `/api/phone` reads gateway voice config/device status, starts `ring-agent` calls, starts `dashboard-agent-call` calls, rings stored prompts, and checks mobile push readiness.
- `src/lib/services/phone/call-gateway.ts` builds private call briefings, including AEON-specific identity and recent artifact context.

## Main Code Paths

- `src/lib/types/agent-runtime.ts`
- `src/lib/services/runtime-adapters/**`
- `src/lib/services/runtime-integrations.ts`
- `src/lib/services/phone/call-gateway.ts`
- `src/lib/native/filesystem.ts`
- `src/app/api/runtimes/**`
- `src/app/api/chat/**`
- `src/app/api/phone/route.ts`
- `src/features/dashboard/hooks/use-agent-controller.tsx`
- `src/features/dashboard/hooks/use-status-chat-input-controller.tsx`
- `src/features/dashboard/hooks/use-chat-tree-controller.tsx`
- `src/features/dashboard/views/PhonePanel.tsx`
