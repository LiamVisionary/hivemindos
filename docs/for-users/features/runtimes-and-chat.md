---
title: "Agents, Runtimes, And Chat"
---

# Agents, Runtimes, And Chat

Agents are local profiles with enough context to do real work.

An agent points at a runtime, model settings, env, vault context, optional collector metadata, wallet settings, and phone-call context. Chat is the bridge into those runtimes. It keeps the machine, runtime, agent, directory, and session context attached instead of treating every message like a blank prompt.

## Runtime Model

Known runtimes are defined in `src/lib/types/agent-runtime.ts`:

| Runtime           | Kind        | Main capabilities                                                                                                                        |
| ----------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| OpenClaw          | Gateway     | status, chat, model selection                                                                                                            |
| Hermes            | Interactive | status, chat, runs, memory, sessions, background tasks, X search, video generation, Codex runtime, Kanban decomposition, model selection, deterministic data query, artifact authoring |
| Codex             | Interactive | status, authentication readiness, managed background tasks, run logs, model selection, completion evaluation                            |
| Claude Code       | Interactive | status, authentication readiness, managed background tasks, run logs, model selection, completion evaluation                            |
| Aeon              | Background  | status, skills, schedules, runs, outputs, memory, background tasks, notifications, optional Zero Human Company execution                 |
| Evo               | Background  | status, runs (experiment tree), background tasks, dashboard URL discovery                                                                 |
| HivemindOS | Interactive | status, chat, model selection                                                                                                            |

## AEON And Zero Human Companies

AEON remains an optional runtime. Choosing it for one Zero Human Company links that company to one saved AEON workspace and skill; it does not make AEON the authority for unrelated agents, companies, schedules, models, or app settings.

The default company engine is still a HivemindOS crew. In AEON mode, a native crew is optional, Company Runs records the accepted handoff, and AEON owns the detailed run state and outputs. See [Using AEON With Zero Human Companies](../runtimes/aeon/zero-human-companies.html).

## How Runtime Settings Work

- Runtime adapters live in `src/lib/services/runtime-adapters`.
- The adapter registry is `src/lib/services/runtime-adapters/registry.ts`.
- Agent settings use `/api/runtimes/[runtime]/integrations` for capability and model-selection data.
- Runtime availability is read through `/api/runtimes/availability`.
- Remote runtime agent creation is proxied through `/api/agents/runtime` when the collector supports it.

## Managed Codex And Claude Code Tasks

Codex and Claude Code can run managed background tasks from HivemindOS. The task keeps its working directory, selected model, process status, logs, and completion evaluation in one run record.

Runtime status distinguishes a CLI that is installed and authenticated from one that is merely installed. A logged-out Claude Code install is not presented as ready. Codex can use the selected profile model instead of relying on a stale CLI default.

Only managed tasks receive this run evaluation. Starting `codex` or `claude` independently in a terminal stays outside the HivemindOS run path. If that work needs to count toward routing, a company, or a loop contract, return the result and evidence through the Work Board.

See [Agent Evaluations](agent-evaluations.html) for the shared completion rules.

Managed assistant messages also include thumbs-up and thumbs-down controls. Ratings stay attached to the exact saved response and feed its chat evaluation without becoming autonomous worker-routing evidence.

## How Chat Works

- The primary send path is `/api/chat/agent-runtime`.
- Session reads use `/api/chat/agent-session`.
- Runtime stream events are normalized by `src/lib/services/runtime-stream-events.ts`.
- The collector bridges Hermes and other local runtime sessions when a remote machine owns the agent.
- Chat history and thread preferences use the shared dashboard state, so they survive restarts consistently in the desktop app and browser. Folder creation is supported by `/api/chat/folders`.
- Chat folder creation and linked directory context use the same machine-aware directory helper as Kanban and Scheduler: native local folder picker in Tauri, Hivemind Link/collector directory browsing for remote machines, and API fallback in the browser.
- New app, site, dashboard, game, and clone requests can use the built-in App workspace. Chat creates the durable project before implementation, keeps its identity on the conversation, and makes Preview start and open that exact project on the selected machine. Simple HTML/CSS/JavaScript requests use a dependency-free static runtime; framework requests use the reviewed Next.js runtime.
- Capability-search preflight can record redacted Context X-Ray manifests for a runtime session. The Memory workbench uses those manifests to show which skills, tools, API routes, connected apps, runtimes, docs, or workspace files were visible to the agent.
- Runtime-specific powers such as deterministic connector queries and artifact authoring are declared in the runtime capability matrix. Hermes is the first runtime enabled for these PromptQL-style work-product flows; other runtimes opt in through the same matrix instead of separate branches.
- Explicit Teach Hive phrasing in chat creates a Brain Review proposal, not an immediate memory write. The normal Brain Review approval/apply path still decides what becomes durable Shared Brain Memory.

### Automatic Thread Titles

Open the thread-title settings from the Chat sidebar to keep first-message previews or choose Local or Cloud captioning.

- A title is requested as soon as the first substantive user message is sent. It runs alongside the assistant request rather than waiting for the reply.
- Generic openers such as “hello” or “can you help?” wait for the next substantive user turn.
- Local captioning offers a lightweight Qwen3.5 0.8B model and a larger 4B option through the same in-app LM Studio install, download, load, and test flow used by other local models.
- Cloud captioning scans callable models from configured runtimes and providers. The searchable picker puts the best lightweight title models first, then shows the rest, with separate OAuth and API badges when both routes exist.
- Only the first and latest substantive user turns are used, capped at 600 characters each. System prompts, tool output, attachments, and process events are excluded. Cloud-bound text passes through secret redaction before it leaves the machine.
- A generated title is stored once and is not silently replaced by later messages.

### Chat Swarm Commands

Dashboard chat owns HivemindOS swarm commands before the message reaches the selected runtime:

- `/swarm [number] <task>` selects a team of configured chat-capable agents from the current Fleet roster, skips agents with known setup issues, matches the task against existing bee worker classes, asks each selected agent for a role-specific pass, and returns one combined swarm packet in the active chat. Omit the number for automatic sizing, or lead with a number such as `/swarm 2 verify this patch` to cap the pass count.
- `/swarm-goal <build request>` rewrites a loose build request into a fuller build prompt, appends explicit instructions for the coordinator to create a goal and spawn parallel agents with dedicated `/goal` scopes, then submits the expanded request to Queen Bee through `/api/queen-bee`. This creates a Work Board task and can trigger autonomous pickup when a matching chat-capable worker is available.
- `/swarm-sim <scenario>` sends the scenario to the MiroShark swarm route and returns the queued simulation status so the run can be followed from chat or the Swarm view.

The composer swarm button prepares `/swarm ` in the input. It does not run anything until the user sends the message. The command path records the user command, shows a pending assistant reply, and replaces it with either the swarm packet, the Queen Bee submission receipt, the queued MiroShark run, or an actionable setup/error message.

Test the command path with `node scripts/e2e-dashboard-swarm-command.mjs` for deterministic browser regression coverage, or `node scripts/e2e-dashboard-swarm-command.mjs --real` to discover real local Fleet agents and run the actual `/api/chat/agent-runtime` path without interception. Add `--require-completion` when the test should fail unless at least one real runtime returns assistant text.

### Collector And Link URLs

Hermes agents discovered through Fleet usually store a collector URL in `agent.telemetryUrl`. In system Tailnet mode, that may be a direct remote collector such as `http://100.x.y.z:8787`. In Hivemind Link mode, remote agents use the local Link sidecar proxy:

```text
http://127.0.0.1:8788/peer/100.x.y.z%3A8787
```

That URL is still remote. Preserve the `/peer/...` prefix and port `8788` when sending chat, reading sessions, browsing files, or checking capabilities. Only plain local collector URLs such as `http://127.0.0.1:8787` should be normalized to the active local collector port from `~/.hivemindos/collector.env`.

If a remote Hermes agent fails immediately with "does not have the Hermes chat bridge" or a fast `404`, check whether a Link `/peer/...` URL was accidentally rewritten to the collector port. The healthy path keeps `/peer/...` on `127.0.0.1:8788` and appends collector endpoints under that prefix.

## Adaptive Agents (OpenRouter Free-Model Routing)

An adaptive agent is a Hermes agent whose model is `adaptive` with provider `openrouter` and an optional `adaptiveOpenRouter.fallbackModel` (paid, tried last). Instead of pinning one model, each message routes across OpenRouter's free-model inventory and learns from the results.

How a message picks its model:

- `src/lib/services/chat/adaptive-openrouter-models.ts` filters OpenRouter's inventory to free models matching the request (modalities, use-case keywords, endpoint health), with the inventory cached at `~/.hivemindos/openrouter-models-cache.json`.
- `src/lib/services/chat/adaptive-model-reliability.ts` then reorders candidates by observed reliability from `~/.hivemindos/openrouter-model-reliability.json`: the most recent model that completed a quality-passing request leads (routing sticks to a known-good model), untried models keep their ranking order, quality-demoted models drop behind untried ones, and models inside a failure cooldown move to the back instead of being dropped.
- The Hermes path tries up to 5 free candidates plus the paid fallback. Failures classify from the error text and HTTP status: capacity (429/rate limit/quota/overloaded) cools the model for 5 minutes doubling per consecutive hit (capped at 6 hours), unsupported models cool for 24 hours, other transport failures for 15 minutes. One success fully resets a model.

Long-running tasks:

- The 45-second attempt timer only covers time to the first stream byte. Once the stream is flowing, silence means the Hermes CLI is still working, and the idle window is 15 minutes (the collector's CLI chat cap is 20 minutes).
- The route emits a bare SSE comment every 25 seconds so the browser's stall timer survives silent tool work.
- When an attempt fails after the Hermes CLI session was created, the next candidate resumes that same session (`--resume`) instead of restarting the task from scratch.

Quality gates ("completed but useless" still demotes):

- Every completed response is graded by `assessAdaptiveResponseQuality`: dead-end refusals with no pivot into an alternative, the prompt echoed back unrequested, and repetition loops fail the gate; everything with substance passes.
- A failed gate records a `low-quality` outcome and a `Hermes Adaptive quality flag` session event. The response still reaches the user — grading only changes future routing.
- One bad answer is forgiven; the second consecutive one benches the model for 10 minutes, doubling per repeat. Models under a 50% pass ratio across 3+ graded responses rank below models never tried. A single clean success redeems the model.

The Adaptive provider (`provider: adaptive`, which routes across OpenRouter plus any Models.dev OpenAI-compatible provider with a configured key) shares the same reliability machinery:

- Candidates from every provider are reordered by observed reliability before keyword scores break ties: cooling models sink, quality-demoted models rank below never-tried ones, and the most recent quality-passing winner leads — across providers.
- Store keys for non-OpenRouter providers are namespaced as `provider::model-id` so a model id shared across providers cannot collide; OpenRouter entries keep the original bare-id format, so existing stores and fleet gossip stay compatible.
- The direct-API attempt loop records the same outcome taxonomy (capacity, unsupported, failure) per attempt, and the completed response passes through the same quality gate before a success is recorded.
- When the plan selects the Hermes runtime, the run reuses the full adaptive-OpenRouter loop — per-message failover, session resume on retry, keepalives, and quality gates — instead of pinning the single selected model.

Fleet-wide sharing:

- The fleet shares one OpenRouter API key, so a rate limit observed on one machine applies everywhere. Collectors gossip the reliability store over the tailnet every 10 minutes (`startReliabilitySync` in `scripts/agent-telemetry-collector.mjs`), merging newest-wins per model id from each peer's `GET /reliability/openrouter`. `POST /reliability/sync` triggers a pass manually.
- Peers are discovered from `tailscale status --json`, probed with a 4-second timeout, and deduplicated by `machineId` so each machine's two tailnet nodes count once. Payloads carry model ids and counters only — no secrets, and no tailnet IPs are persisted.
- Tune or disable with `AGENT_TELEMETRY_RELIABILITY_SYNC_INTERVAL_MS` (`0` disables). The app re-reads the store file on a 5-second TTL, so gossiped records apply without a restart.

## Hive Fusion (Compound Model)

Hive Fusion is a native compound model: instead of asking one model, a prompt is fanned out to a **panel** of configured models in parallel, a **judge** model extracts the structure of their answers, and a **synthesizer** writes the final answer grounded in that analysis. It is HivemindOS's own implementation of the panel → judge → synthesize pattern, provider-agnostic over the gateways you already have configured.

Selecting it: the model picker exposes a `Hive Fusion` provider whose model, `hive-fusion-native`, runs the local panel across your configured providers. OpenRouter's *hosted* compound model is a plain OpenRouter slug, so it is offered separately as `openrouter/fusion` under the **OpenRouter** provider tile — a `MODEL_PROVIDER_GATEWAYS` entry keyed off `OPENROUTER_API_KEY` in the shared hive env, so it appears on every runtime (its model dropdown also offers Adaptive free-routing). It is served by the normal OpenRouter path — no Fusion orchestration runs locally for it. (Programmatically, `agent.fusion.mode: "openrouter"` also routes the native `hive-fusion` provider to the hosted model with optional custom-panel `plugins`.)

Any agent on any runtime can select `Hive Fusion`; the chat send path is unchanged (it still POSTs to `/api/chat/agent-runtime`). The route detects `provider: "hive-fusion"` and delegates to the Fusion orchestrator before the single-model preflight (`isFusionProfile` / `streamFusionResponse` in `src/lib/services/fusion/route-stream.ts`); selecting it never writes a Hermes/OpenClaw gateway model.

How a native run works (`src/lib/services/fusion/orchestrator.ts`):

1. **Resolve the panel** (`catalog.ts`). The default panel mirrors the budget-panel idea: when `OPENROUTER_API_KEY` is set, it fills with diverse budget models from OpenRouter's live free inventory (reusing the Adaptive resolver, falling back to a static list if the inventory is unreachable), then tops up from any other configured provider. Providers are resolved from the shared hive env (`OPENROUTER_API_KEY`, `VENICE_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `BANKR_LLM_KEY`, or a local OpenAI-compatible base URL). With only one provider configured it degrades to a low-diversity single-member panel (the judge + synthesizer still add structure) and surfaces a note rather than failing.
2. **Fan out** to every panel member in parallel via OpenAI-compatible `/chat/completions` (`client.ts`). A member that fails or times out is dropped; the run continues as long as at least one succeeds.
3. **Judge** (only when ≥2 members succeed): a judge model returns JSON capturing consensus, contradictions, partial coverage, unique insights, blind spots, and a recommended focus (`prompts.ts`). Malformed judge output falls back gracefully and never aborts the run.
4. **Synthesize**: a synthesizer model streams the final answer grounded in the analysis and the panel's source answers. If synthesis itself fails, Fusion returns the strongest panel answer rather than erroring.

Blind compare: the Fusion service layer can now prepare anonymized answer slots
through `/api/fusion/blind-compare`. The route hides model labels until the
operator records a slot choice, then reveals the slot-to-model map so votes can
feed future reliability and routing work without biasing the initial judgement.
Fusion's judge and synthesizer prompts also wrap panel/source answers as
untrusted source data before using them for analysis.

Customising the panel: set `agent.fusion` (`FusionAgentConfig`) to override `participants`, `judge`, `synthesizer` (each a `{ provider, model }` from the Fusion catalog), `maxParticipants` (default 3), or `mode` (`"native"` | `"openrouter"`) — mirroring OpenRouter's custom-panel option.

Streaming: the synthesizer answer streams as the assistant message, while each panel member and the judge surface as tool/reasoning process events (the panel plan and judge analysis appear as reasoning chips). The orchestrator is dependency-injectable and covered by `scripts/test-fusion.mjs` (`pnpm test:fusion`).

## Hive Compute (Marketplace GPU Inference)

Hive Compute supplies GPU-first routes inside the **HivemindOS** model provider's
unified **All models** catalog. Auto, Fast, and Deep appear before the other
OpenRouter-backed HivemindOS models with **SALE** badges, try eligible
marketplace workers first, and fall back to the matching hosted model tier when
marketplace capacity is unavailable.

The dashboard also has a **Hive Compute** setup view for operators who want to
earn on spare GPU capacity. It installs a small worker module under
`~/.hivemindos/modules/hive-compute-worker`; the worker connects to a compatible
gateway, advertises Ollama or LM Studio/OpenAI-compatible model routes, accepts
assigned jobs, streams tokens, and reports completion. Official matching,
payout, receipt, quota, and fraud-control authority still belongs in hosted
HivemindOS infrastructure or a self-hosted operator's own gateway, not in the
downloadable app.

For private marketplace jobs, Hive Compute supports encrypted prompt delivery
to verified workers and opt-in output E2E encryption for clients that can
decrypt response envelopes locally. Hardware-only routing is stricter than dev
verified-only routing: it must be backed by gateway-verified hardware
attestation and fails closed when only local test evidence is available.

## What Agents And Chat Can Do

- Runtime/provider/model selection where supported.
- Adaptive OpenRouter free-model routing with learned reliability, capacity failover, and quality grading.
- HivemindOS Models GPU-first routing through Hive Compute, with hosted
  OpenRouter fallback when marketplace capacity is unavailable.
- Streaming runtime responses where available.
- `/swarm [number]` role-specific parallel passes across the best-suited configured chat-capable agents.
- `/swarm-goal <build request>` prompt expansion plus Queen Bee Work Board delegation for parallel build tasks.
- Session resume and session search.
- Attachments and linked directories for task context.
- Send-to-Kanban from chat messages.
- Agent prompts for clarification, approval, secrets, or sudo-style decisions.
- Agent role, worker class, preferred skills, and per-agent env values.
- Dashboard agent calls that start through `/api/phone` using the gateway's in-app voice path instead of ringing the phone.
- Scheduled/ring-agent calls that can ring the paired mobile device when explicitly triggered.
- AEON call briefings with repository, branch, workspace, Strategy/Soul, memory, the v0.1 skill catalog, chains/reactive work, and recent MiroShark deliverable context.

Chat document attachments use the bundled native reader rather than requiring a separate Python converter. See [Local Document Reader](local-document-reader.html) for all 16 supported extensions, local-versus-cloud privacy behavior, extraction limits, and format-specific caveats.

For the full product split between free BYOK calls and paid Cloud/LiveKit rooms, see [Calling](calling.html).

## Phone And Voice Bridge

Phone support is split between a settings surface and action routes:

- `src/features/dashboard/views/PhonePanel.tsx` manages saved prompts, scheduled call rows, device status, and ring actions.
- `src/features/dashboard/views/chat/AgentCallsSettingsPanel.tsx` exposes pairing and test-call controls in agent settings.
- `/api/phone` reads gateway voice config/device status, starts `ring-agent` calls, starts `dashboard-agent-call` calls, rings stored prompts, and checks mobile push readiness.
- `src/lib/services/phone/call-gateway.ts` builds private call briefings, including AEON-specific identity and recent artifact context.

## Queen Bee Voice Chat

The desktop app ships a hands-free voice channel into the Queen Bee control plane:

- The HivemindOS menu bar (tray) icon menu leads with `Voice Chat with Queen Bee`; the app menu also exposes `Navigation > Voice Chat with Queen Bee` (`Cmd+Shift+V`). Both emit `hivemindos:queen-bee-voice` to the dashboard webview.
- While active, the dashboard shows an Apple Intelligence-style animated glow around the window perimeter (`src/features/queen-voice/QueenVoiceGlow.tsx`, ported from `jacobamobin/AppleIntelligenceGlowEffect`) plus live on-screen transcription of both the user's utterances and Queen Bee's replies.
- Each utterance is detected with an energy-based VAD, recorded, and sent to `/api/queen-bee/voice`, which transcribes it with the shared Whisper STT helpers (`src/lib/services/phone/transcription.ts`), submits the transcript to the Queen Bee control plane, and returns the spoken-ready receipt summary.
- Replies are voiced through OpenAI TTS when an OpenAI voice key is configured in the shared env, with on-device speech synthesis as the fallback.

## Main Code Paths

- `src/lib/types/agent-runtime.ts`
- `src/lib/services/runtime-adapters/**`
- `src/lib/services/chat/adaptive-openrouter-models.ts`
- `src/lib/services/chat/adaptive-model-reliability.ts`
- `src/lib/services/fusion/**` (Hive Fusion compound model: catalog, client, prompts, orchestrator, route-stream)
- `src/lib/services/runtime-integrations.ts`
- `src/lib/services/phone/call-gateway.ts`
- `src/lib/native/filesystem.ts`
- `src/app/api/runtimes/**`
- `src/app/api/chat/**`
- `src/app/api/phone/route.ts`
- `src/features/dashboard/hooks/dashboard-swarm-command.ts`
- `src/features/dashboard/hooks/use-agent-controller.tsx`
- `src/features/dashboard/hooks/use-status-chat-input-controller.tsx`
- `src/features/dashboard/hooks/use-chat-tree-controller.tsx`
- `src/features/dashboard/views/PhonePanel.tsx`
