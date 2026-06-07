---
title: Token And Cost Savings
description: How HivemindOS reduces agent token use, repeated work, and paid-model spend.
---

# Token And Cost Savings

HivemindOS saves tokens by making agents search, narrow, reuse, and remember before they generate.

The product is not just a dashboard that spends tokens more visibly. It gives agents cheaper local context paths, reusable skills, bounded discovery, and project-specific memory so they do not keep rediscovering the same facts or rebuilding from a blank page.

## Live Benchmark Chat

**Prompt**

```text
dude i want you to run the full actual benchmarks, i need real numbers not estimates.
```

**Chat**

> **User:** Can we benchmark token savings with a set of without-Hive optimizations and with-Hive optimizations?
>
> **Assistant:** Yes. I added two benchmark modes:
>
> - `pnpm benchmark:context-savings` for deterministic local context estimates.
> - `pnpm benchmark:e2e-token-savings` for real provider calls with returned usage counters.
>
> **User:** Are these actual real E2E run benchmark results?
>
> **Assistant:** The first benchmark was only a deterministic estimate. I then ran the full live benchmark through OpenRouter's OpenAI-compatible chat completions using `openai/gpt-4.1-mini`. It made six real provider calls: baseline and Hive-optimized prompts for three scenarios.
>
> | Scenario | Baseline prompt | Hive prompt | Prompt saved | Total saved | Truncated |
> | --- | ---: | ---: | ---: | ---: | --- |
> | `brain-recall` | 43,676 | 286 | 43,390, 99.3% | 43,426, 99.2% | baseline yes |
> | `software-build` | 42,156 | 4,875 | 37,281, 88.4% | 37,275, 88.3% | baseline yes |
> | `workflow-reuse` | 27,042 | 3,370 | 23,672, 87.5% | 23,673, 87.3% | no |
>
> Total provider-reported usage: baseline prompt tokens `112,874`, Hive prompt tokens `8,531`, prompt tokens saved `104,343` (`92.4%`), and total tokens saved `104,374` (`92.3%`).
>
> The result artifact was written to `.outputs/benchmarks/e2e-token-savings-2026-06-07T13-54-02-022Z.json`. It stores usage counters, durations, response IDs, context hashes, and truncation flags, but not prompt bodies or secrets.

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

`hive-assimilate` replaces the older GitHub-only assimilator.

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
- required credential keys by name only
- side-effect gates
- missing pieces

This avoids a common expensive pattern: the agent repeatedly searches tools, docs, runtime skills, and app surfaces because it never formed a compact capability map.

## Fusion Skills

Hive Fusion saves tokens when a workflow will repeat.

`hive-skill-fusion` turns a useful procedure into a shared `SKILL.md`. Future agents load that concise skill instead of reconstructing the whole process from chat history.

`hive-workflow-fusion` plans or runs multi-step work with known components, dry-run evidence, and approval gates. It prevents costly wandering through tools when the task is really an orchestration problem.

`hive-aeon-fusion` is for recurring background duty. If a workflow belongs in an AEON run loop, the expensive planning happens once and future runs reuse the saved shape.

## Runtime And Provider Controls

HivemindOS also lowers spend by separating agent runtimes from model providers.

That means one runtime profile can route to the right provider without recreating a new runtime for every backend. Local OpenAI-compatible servers, Bankr LLM, UsePod, OpenRouter, and runtime-native providers can be represented as providers, not duplicated as whole agent shells.

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
