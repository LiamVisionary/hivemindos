---
title: Token And Cost Savings
description: How HivemindOS reduces agent token use, repeated work, and paid-model spend.
---

# Token And Cost Savings

HivemindOS saves tokens by making agents search, narrow, reuse, and remember before they generate.

The product is not just a dashboard that spends tokens more visibly. It gives agents cheaper local context paths, reusable skills, bounded discovery, and project-specific memory so they do not keep rediscovering the same facts or rebuilding from a blank page.

For recall accuracy, latency, scale, full-vault search, contradiction control, and pattern-mining results alongside these token measurements, see [Shared Brain Memory Benchmarks](shared-brain-benchmarks.html).

## Live Benchmark Chat

**Prompt Under Test**

```text
Explain how HivemindOS shared brain memory works and which command a raw agent should use before relying on prior context.
```

The harness sent that task twice to OpenRouter's OpenAI-compatible chat completions using `openai/gpt-4.1-mini`: once with a broad baseline context pack and once with a targeted Hive context pack.

**Baseline Chat**

> **User:** Explain how HivemindOS shared brain memory works and which command a raw agent should use before relying on prior context.
>
> **Assistant:**
>
> ```json
> {"answer":"HivemindOS shared brain memory uses a local Obsidian markdown vault to store durable typed memories with provenance, indexed for fast local recall, and raw agents should use the `hive-brain answer \"<query>\"` CLI command before relying on prior context, which tries the local API first and falls back to vault/index search.","actions":["Use `hive-brain answer \"<query>\"` CLI command for recall"],"confidence":1}
> ```
>
> Usage: `43,655` prompt tokens, `99` completion tokens, `43,754` total tokens. Context: broad docs/source pack, `14` files, truncated to `180,000` sent characters.

**Hive Chat**

> **User:** Explain how HivemindOS shared brain memory works and which command a raw agent should use before relying on prior context.
>
> **Assistant:**
>
> ```json
> {"answer":"HivemindOS shared brain memory allows agents to recall context from a tiered memory system, starting with typed Agent Memory and then full-vault augmentation; raw agents should use the command `hive-brain answer \"<query>\"` before relying on prior context.","actions":["Use `hive-brain answer \"<query>\"` command"],"confidence":0.9}
> ```
>
> Usage: `286` prompt tokens, `84` completion tokens, `370` total tokens. Context: targeted Hive recall pack, `3` snippets, `2` sections, not truncated.

**Result**

| Run | Prompt tokens | Completion tokens | Total tokens |
| --- | ---: | ---: | ---: |
| Baseline | 43,655 | 99 | 43,754 |
| Hive | 286 | 84 | 370 |
| Saved | 43,369, 99.3% | 15, 15.2% | 43,384, 99.2% |

This is provider-reported usage from a live run on June 7, 2026. The full `pnpm benchmark:e2e-token-savings` command writes redacted artifacts with usage counters, durations, response IDs, context hashes, and truncation flags, but not prompt bodies or secrets.

## Complex Chatbot Build Benchmark

**Prompt Under Test**

```text
Build a HivemindOS dashboard chatbot feature that lets a user ask project questions, recalls shared brain memory, selects an agent/runtime, streams responses with tool/status events, and includes a minimal API route plus React UI wiring. Return the implementation plan, key files, tests, and safety gates.
```

The harness sent that task twice to OpenRouter's OpenAI-compatible chat completions using `openai/gpt-4.1-mini`: once with a broad current-project sweep and once with a targeted Hive assimilation/capability context pack.

**Baseline Chat**

> **User:** Build a HivemindOS dashboard chatbot feature that lets a user ask project questions, recalls shared brain memory, selects an agent/runtime, streams responses with tool/status events, and includes a minimal API route plus React UI wiring. Return the implementation plan, key files, tests, and safety gates.
>
> **Assistant:**
>
> ```json
> {"answer":"Implement a new dashboard chatbot feature with these steps: 1) Create a React UI component for the chatbot input and streaming response display, integrating with existing dashboard state and runtime selection hooks. 2) Add a minimal Next.js API route under `/api/chat/dashboard` that accepts user queries, recalls shared brain memory via existing brain services API, selects the appropriate agent/runtime from the runtime adapter registry, and streams responses with tool and status events. 3) Use existing shared brain recall APIs to fetch relevant context before querying the runtime. 4) Stream runtime chat responses and emit tool/status events to the frontend for real-time UI updates. 5) Wire the React UI to the API route with streaming fetch and event handling. 6) Add focused unit and integration tests for the API route, React component, and streaming logic. 7) Enforce safety gates by sanitizing inputs, redacting secrets in outputs, and respecting user privacy and project rules. Key files include `src/app/api/chat/dashboard/route.ts` for the API, `src/features/dashboard/views/ChatbotPanel.tsx` for the UI, and hooks under `src/features/dashboard/hooks/use-chatbot-controller.tsx`. Tests can run via `pnpm test:e2e:dashboard-smoke` and `pnpm test:dashboard-nav`. Safety gates follow AGENTS.md rules: no secrets logged, input validation, and side-effect confirmation for tool calls.","files":["src/app/api/chat/dashboard/route.ts","src/features/dashboard/views/ChatbotPanel.tsx","src/features/dashboard/hooks/use-chatbot-controller.tsx"],"tests":["pnpm test:e2e:dashboard-smoke","pnpm test:dashboard-nav"],"safety":["sanitize user input","redact secrets in responses","confirm side effects before tool calls","adhere to AGENTS.md privacy and code style rules"],"confidence":0.9}
> ```
>
> Usage: `42,185` prompt tokens, `386` completion tokens, `42,571` total tokens. Context: broad current-project sweep, `306` files, truncated to `180,000` sent characters.

**Hive Chat**

> **User:** Build a HivemindOS dashboard chatbot feature that lets a user ask project questions, recalls shared brain memory, selects an agent/runtime, streams responses with tool/status events, and includes a minimal API route plus React UI wiring. Return the implementation plan, key files, tests, and safety gates.
>
> **Assistant:**
>
> ```json
> {"answer":"1. Use hive-capability-search to identify existing chatbot, streaming, shared brain, runtime selection, and agent routing capabilities. 2. Search shared brain and context index for dashboard chat, task retrieval, runtime adapter, and streaming event components. 3. Reuse existing concrete files, API routes, schemas, and UI components from the current project. 4. Implement a minimal API route to accept user questions, recall shared brain memory via context index, select an agent/runtime, and stream responses with tool/status events. 5. Wire a React UI component in the dashboard to send queries, display streaming chatbot responses, and show tool/status events. 6. Add tests for API route, streaming response handling, shared brain recall, runtime selection, and React UI interaction. 7. Include safety gates to validate user input, sanitize streaming events, and restrict agent/runtime selection to authorized options.","files":["src/pages/api/chatbot.ts","src/components/DashboardChatbot.tsx","src/lib/services/chat/task-retrieval-context.ts","src/lib/agents/runtimeSelector.ts","src/lib/hooks/useStreamingChat.ts","tests/api/chatbot.test.ts","tests/components/DashboardChatbot.test.ts"],"tests":["npm run test -- tests/api/chatbot.test.ts","npm run test -- tests/components/DashboardChatbot.test.ts"],"safety":["validate and sanitize user input in API route","restrict runtime/agent selection to authorized list","sanitize and limit streaming events to prevent injection","rate limit API usage to prevent abuse"],"confidence":0.9}
> ```
>
> Usage: `4,989` prompt tokens, `318` completion tokens, `5,307` total tokens. Context: targeted Hive assimilation/capability pack, `3` files, `3` snippets, `2` sections, not truncated.

**Result**

| Run | Prompt tokens | Completion tokens | Total tokens |
| --- | ---: | ---: | ---: |
| Baseline | 42,185 | 386 | 42,571 |
| Hive | 4,989 | 318 | 5,307 |
| Saved | 37,196, 88.2% | 68, 17.6% | 37,264, 87.5% |

This is provider-reported usage from a live `pnpm benchmark:e2e-token-savings -- --scenario chatbot-build` run on June 8, 2026. The artifact was written to `.outputs/benchmarks/e2e-token-savings-2026-06-08T06-46-24-934Z.json` with response content included for this docs transcript. The prompt is intentionally more like a real app-building request: the broad baseline loaded a large project sweep, while Hive used focused assimilation, capability, and context-index evidence.

## Savings Model

| Layer | How it saves tokens and cost |
| --- | --- |
| Shared Brain Memory | Retrieves relevant typed memories or vault notes instead of pasting a whole vault, long chat history, or repeated instructions into every prompt. |
| `hive-brain answer` and `hive-brain recall` | Give raw/non-managed agents a local-first search path that tries the app API first and falls back to local vault/index search. |
| Context index | Lets agents discover skills, API routes, tool surfaces, docs, apps, and workspace context as targeted hits instead of loading broad file trees. |
| `karpathy-guidelines` | Pushes agents toward surgical, verifiable, simple changes, reducing overbuilt code and expensive correction loops. |
| `hive-assimilate` | Forces pre-build reuse from pinned sources, shared brain, user projects, private indexes, and public GitHub before custom implementation. |
| `hive-capability-search` | Produces a bounded capability map so agents choose the right tool, app, skill, or runtime without repeated broad discovery. |
| `hive-skill-fusion` | Turns repeated workflows into durable shared skills so future agents can load a concise recipe instead of re-deriving the process. |
| `hive-workflow-fusion` | Composes one-off or reusable workflows from available parts, with dry-run evidence and side-effect gates before expensive execution. |
| `hive-aeon-fusion` | Moves recurring work into AEON-ready duties when useful, so background runs reuse a known workflow instead of rebuilding context each time. |
| Runtime usage analytics | Reads real runtime token counters where available, making spend visible by model, runtime, session, and source. |
| Provider routing | Keeps model providers separate from runtimes so cheap/local/default providers can be selected without duplicating runtime setup. |

## Shared Brain Search

The canonical "hive search" commands are:

```bash
hive-brain answer "query"
hive-brain recall "query" --scope full-vault --limit 8
```

`hive-brain answer` is best when the agent needs a concise grounded answer. `hive-brain recall` is best when it needs a ranked hit list with paths.

The default recall strategy is tiered:

1. Check typed Agent Memory first.
2. Return that distilled memory layer when the hit is strong.
3. Fall back to targeted full-vault retrieval only when distilled memory is not enough.

That is cheaper than stuffing the prompt with broad vault context, old chat transcripts, or guessed project history. It also helps raw CLI agents use the same shared memory without being routed through the dashboard.

## Karpathy Guidelines

`karpathy-guidelines` saves tokens by reducing self-inflicted complexity.

It nudges agents to:

- read the relevant code first
- make small changes
- avoid speculative abstractions
- define concrete verification
- stop when the task is actually solved

That matters because many agent token spikes are not from the first implementation. They come from patching avoidable bugs, explaining accidental refactors, and untangling code the user did not ask for.

## Hive Assimilate

`hive-assimilate` is the pre-build reuse workflow for HivemindOS software work.

Before software creation, it searches:

1. user-pinned repos, paths, PRs, notes, or skills
2. the shared brain
3. the current workspace
4. bounded user project roots
5. local/private assimilation indexes
6. public GitHub candidates

The saving is direct: agents reuse concrete files, tests, configs, schemas, assets, and project knowledge instead of generating everything from scratch. It also logs what was searched and rejected, so the next agent does not pay to rediscover the same dead ends.

## Capability Search

`hive-capability-search` answers: "What can this hive currently do for this task?"

It bounds retrieval and returns:

- selected components per intent
- alternatives
- available agents/apps/tools
- delivery channels such as slash commands, API routes, MCP tools, CLIs, or dashboard surfaces
- required credential keys by name only
- side-effect gates
- missing pieces

This avoids a common expensive pattern: the agent repeatedly searches tools, docs, runtime skills, and app surfaces because it never formed a compact capability map.

For example, a request like "build this with parallel agents" can map to the dashboard `/swarm-goal` delivery channel. Capability search should surface the command, its Queen Bee `/api/queen-bee` backend, the side effect that it creates a Work Board task, and the fact that autonomous pickup can start act-mode work.

## Fusion Skills

Hive Fusion saves tokens when a workflow will repeat.

`hive-skill-fusion` turns a useful procedure into a shared `SKILL.md`. Future agents load that concise skill instead of reconstructing the whole process from chat history.

`hive-workflow-fusion` plans or runs multi-step work with known components, dry-run evidence, and approval gates. It prevents costly wandering through tools when the task is really an orchestration problem.

`hive-aeon-fusion` is for recurring background duty. If a workflow belongs in an AEON run loop, the expensive planning happens once and future runs reuse the saved shape.

## Runtime And Provider Controls

HivemindOS also lowers spend by separating agent runtimes from model providers.

That means one runtime profile can route to the right provider without recreating a new runtime for every backend. Local OpenAI-compatible servers, Bankr LLM, UsePod, HivemindOS Models, OpenRouter, and runtime-native providers can be represented as providers, not duplicated as whole agent shells.

The dashboard also reads real token usage where runtimes expose it. That supports:

- per-session visibility
- runtime/source breakdowns
- model-level estimated cost
- Honey reward accounting from actual usage, not text-length guesses

## Benchmarking The Difference

HivemindOS has two benchmark modes:

| Command | What it measures |
| --- | --- |
| `pnpm benchmark:context-savings` | Deterministic local estimate of broad context packs versus targeted Hive context packs. No provider call. |
| `pnpm benchmark:e2e-token-savings` | Real OpenAI-compatible chat completion calls that record provider-reported `prompt_tokens`, `completion_tokens`, and `total_tokens`. |

### Real E2E Provider Run

Use the live benchmark when you need real provider usage numbers instead of estimates:

```bash
./scripts/hive-env-run -- pnpm benchmark:e2e-token-savings
```

The command requires a configured provider credential in the shared hive env or current environment. It supports `--provider openai`, `--provider openrouter`, and `--provider usepod`. It sends each benchmark prompt to the selected provider, records the usage counters returned by the API, and writes a redacted artifact under `.outputs/benchmarks/`.

Useful options:

```bash
./scripts/hive-env-run -- pnpm benchmark:e2e-token-savings -- --model gpt-4o-mini
./scripts/hive-env-run -- pnpm benchmark:e2e-token-savings -- --provider openrouter --model openai/gpt-4.1-mini
./scripts/hive-env-run -- pnpm benchmark:e2e-token-savings -- --scenario brain-recall
./scripts/hive-env-run -- pnpm benchmark:e2e-token-savings -- --repeats 3
```

The artifact intentionally stores context hashes, file counts, sent character counts, truncation flags, durations, response IDs, and token usage. It does not store API keys or full prompt bodies. If a broad baseline context pack exceeds the live benchmark cap, the run marks `context.truncated: true` so the numbers are not confused with an uncapped prompt.

### Deterministic Context Budget

HivemindOS includes a deterministic context-token benchmark:

```bash
pnpm benchmark:context-savings
```

The old `pnpm benchmark:token-savings` command remains as a compatibility alias, but the primary name is now `benchmark:context-savings` because this is not a live E2E provider-billing benchmark.

The benchmark compares representative tasks in two modes:

- **Without Hive optimizations:** broad context loading, such as reading large docs/source areas before acting.
- **With Hive optimizations:** targeted `hive-brain` recall, capability-search evidence, selected skill instructions, and assimilation source paths.

It estimates prompt/context tokens with a deterministic local heuristic:

```text
max(characters / 4, lexical tokens)
```

That means the output is not a provider invoice, is not a real end-to-end agent-run benchmark, and does not prove final answer quality. It measures the context budget HivemindOS avoids before the model call. Use `--input-price-per-million` with a current provider input-token price when you want normalized dollar estimates:

```bash
node scripts/benchmark-context-savings.mjs --input-price-per-million 2.50
node scripts/benchmark-context-savings.mjs --json
```

Example local run on this repo:

| Scenario | Baseline | Hive | Saved |
| --- | ---: | ---: | ---: |
| `brain-recall` | 48,182 | 172 | 99.6% |
| `software-build` | 855,226 | 5,335 | 99.4% |
| `workflow-reuse` | 27,112 | 3,909 | 85.6% |

The useful number is not the exact percentage. It is the repeatable delta between "load broadly and hope" and "retrieve the smallest useful evidence pack."

## Practical Rule

For expensive tasks, the intended order is:

1. Recall with `hive-brain`.
2. Map capabilities with `hive-capability-search`.
3. Reuse source with `hive-assimilate`.
4. Follow `karpathy-guidelines` while editing.
5. Turn repeated work into a skill or workflow with Hive Fusion.
6. Check runtime usage afterward.

That order is the cost-control loop: retrieve less, choose better, reuse more, edit smaller, and remember the result.
