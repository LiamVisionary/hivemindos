---
title: Shared Brain Memory Benchmarks
description: Measured recall quality, latency, scale, full-vault search, contradiction control, pattern mining, and token reduction in HivemindOS.
---

# Shared Brain Memory Benchmarks

HivemindOS is built to remember the useful parts of work without turning every run receipt, old decision, or vault note into prompt baggage. These benchmarks measure whether that design produces relevant recall, fast local retrieval, cleaner current truth, and smaller model context.

<section class="atlasHero">
  <strong>Benchmark snapshot: July 10, 2026</strong>
  <p>A 1,000-query live memory matrix reached 90% Top-1 and 98% Top-3 recall. Across the full LoCoMo and LongMemEval retrieval suites, HivemindOS placed the annotated evidence session in the Top-50 for 2,032 of 2,036 eligible questions (99.80%). Full GPT-5.4 Mini answer-and-judge runs scored 76.62% on LoCoMo, 53.40% on LongMemEval, 41.12% on BEAM 1M, and 37.04% on BEAM 10M at Top-50.</p>
</section>

## Results At A Glance

| What was measured | Result | Evidence class |
| --- | ---: | --- |
| Live-memory recall | **90% Top-1, 98% Top-3, 0.94 MRR** | 1,000 read-only queries over an evolving real vault corpus |
| Exact current-memory recall | **100% Top-1** | 206 exact automatic/current queries inside the 1,000-query matrix |
| Temporal recall | **96% Top-1, 100% Top-3** | Current, historical, and as-of evolution-chain queries |
| Unsupported-question abstention | **10/10** | Unrelated compound questions returned no memory context |
| Operational-receipt isolation | **40/40** | Receipts stayed hidden by default and remained explicitly retrievable |
| Authenticated local API | **6.75ms p50, 12.12ms p95, 125.97 requests/s** | 400 sequential measured requests after warmup; 8/8 behavior checks passed |
| Indexed typed memory at 1,500 records | **27.16ms p50, 33.63ms p95** | 200-query synthetic scale corpus; Top-1/Top-3/MRR 1.00/1.00/1.00 |
| Live full-vault direct search | **15.39× median speedup** | 745.04ms old path versus 48.42ms indexed; same Top-1 in 8/8 cases |
| Live provider token reduction | **87.5%–99.2% fewer total tokens** | Two OpenRouter runs using provider-reported usage |
| Pattern-mining proposal quality | **1.00 precision, 1.00 recall** | 47-event labeled adversarial fixture; automatic promotion remains disabled |
| Current-truth health after migration | **0 canonical conflicts, 0 duplicate-pressure groups** | Live report-only health over 101 active canonical heads |
| LoCoMo annotated-evidence recall | **99.93% Top-50, 93.95% Top-10** | Full 1,540-question public suite; 1,536 questions include evidence-session labels |
| LongMemEval annotated-evidence recall | **99.4% Top-50, 97.6% Top-10** | All 500 public questions |
| BEAM 1M / 10M retrieval coverage | **900/900 non-empty recalls** | Full 700-question 1M and 200-question 10M suites; coverage is not answer correctness |
| LoCoMo / LongMemEval answer score | **76.62% / 53.40%** | Full GPT-5.4 Mini OAuth answer-and-judge runs at Top-50 |
| BEAM 1M / 10M rubric score | **41.12% / 37.04%** | Full GPT-5.4 Mini OAuth runs; 44.29% / 43.00% pass rate at the 0.5 threshold |

Top-1 means the expected memory ranked first. Top-3 means it appeared in the first three results. Mean reciprocal rank, or MRR, rewards putting the correct memory as high as possible.

## Public Long-Conversation Suites

HivemindOS also runs the public LoCoMo, LongMemEval, and BEAM suites through the product's conversation archive, full-vault index, and final recall ranking. These are complete Top-50 retrieval runs, not hand-selected pilots.

| Public suite | Full questions | Retrieval-quality result | Local p50 / p95 |
| --- | ---: | --- | ---: |
| LoCoMo | 1,540 | **99.93% Top-50 evidence-session recall**; 93.95% Top-10 | 6.4ms / 14.72ms |
| LongMemEval | 500 | **99.4% Top-50 evidence-session recall**; 97.6% Top-10 | 101.8ms / 285.76ms |
| BEAM 1M | 700 | **700/700 returned context**; 10 median hits | 121.9ms / 583.2ms |
| BEAM 10M | 200 | **200/200 returned context**; 50 median hits | 1,053.5ms / 3,829.7ms |

Evidence-session recall asks whether the annotated source conversation appeared among the retrieved memories. It is a retrieval metric, not final-answer accuracy. BEAM does not publish equivalent evidence-session labels in this adapter, so its table rows report non-empty retrieval coverage and hit count without implying that every result is relevant.

The combined annotated-evidence check contains 2,036 eligible LoCoMo and LongMemEval questions. HivemindOS retrieved the labeled source session for 1,931 questions at Top-10 (94.84%) and 2,032 at Top-50 (99.80%).

### Judge-Scored Answers

The answer phase used `gpt-5.4-mini` for both the answering model and judge through ChatGPT OAuth, with the same Top-50 recalled context produced by HivemindOS. Every question in all four suites completed.

| Public suite | Questions | Answer-quality result | Pass rate | Answer p50 | Judge p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| LoCoMo | 1,540 | **76.62%** binary judge score | 76.62% | 3.45s | 2.02s |
| LongMemEval | 500 | **53.40%** binary judge score | 53.40% | 3.93s | 3.03s |
| BEAM 1M | 700 | **41.12%** average rubric score | 44.29% | 4.78s | 7.10s |
| BEAM 10M | 200 | **37.04%** average rubric score | 43.00% | 6.63s | 4.64s |

LoCoMo and LongMemEval use binary judge outcomes, so score and pass rate match. BEAM averages compliance across each question's rubric nuggets; its pass rate counts questions scoring at least 0.5. The adapter reports BEAM rubric compliance but does not yet publish the separate event-ordering Kendall tau-b metric.

The category results show where the current system is strongest and where it still needs work:

| Suite | Strongest measured categories | Lowest measured categories |
| --- | --- | --- |
| LoCoMo | Temporal 82.55%; single-hop 76.10%; multi-hop 75.18% | Open-domain 65.62% |
| LongMemEval | Knowledge update 74.36%; single-session user 72.86%; preference 66.67% | Multi-session 31.58% |
| BEAM 1M | Abstention 62.14%; preference following 60.00%; information extraction 52.85% | Temporal reasoning 22.98%; knowledge update 25.71%; summarization 27.82% |
| BEAM 10M | Information extraction 62.50%; preference following 58.75%; contradiction resolution 45.62% | Temporal reasoning 11.25%; abstention 20.00%; multi-session reasoning 22.00% |

These model-judge results are a reproducible HivemindOS snapshot, not a direct competitor comparison. Scores produced with a different answering model, judge, prompt revision, or retrieval cutoff—including GPT-5/Top-200 configurations—are not apples-to-apples. ChatGPT OAuth did not expose token-usage counters, so the benchmark publishes latency and completion counts but does not estimate tokens or model cost.

The long-conversation run also validated the cache optimization that made BEAM 10M fit within the normal Node heap. Re-running 2,440 LoCoMo, BEAM 1M, and BEAM 10M questions preserved the same ranked context after excluding regenerated file timestamps, while median retrieval improved:

| Suite | Before | Current | p50 speedup |
| --- | ---: | ---: | ---: |
| LoCoMo | 18.4ms | 6.4ms | **2.88×** |
| BEAM 1M | 250.5ms | 121.9ms | **2.06×** |
| BEAM 10M | 2,564.5ms | 1,053.5ms | **2.43×** |

The public machine-readable result, including the full category breakdown and run metadata, is [available as JSON](../../assets/benchmarks/standard-memory-2026-07-10.json).

Methodology is pinned to [`mem0ai/memory-benchmarks`](https://github.com/mem0ai/memory-benchmarks), [`snap-research/locomo`](https://github.com/snap-research/locomo), [`xiaowu0162/LongMemEval`](https://github.com/xiaowu0162/LongMemEval), and [`mohammadtavakoli78/BEAM`](https://github.com/mohammadtavakoli78/BEAM). HivemindOS currently exposes at most 50 recalled memories, so this page does not compare its Top-50 results against another system's Top-200 score.

## Recall Quality Across Messy Questions

The live matrix did not only search exact titles. It generated sparse questions, added conversational noise, introduced typos, expressed natural intent, and applied type, project, and tag filters.

| Query form | Top-1 | Top-3 | Cases |
| --- | ---: | ---: | ---: |
| Exact title, automatic time mode | 100% | 100% | 103 |
| Exact title, current mode | 100% | 100% | 103 |
| Sparse title terms | 83% | 99% | 103 |
| Noisy natural question | 86% | 99% | 103 |
| Typo query | 81% | 91% | 103 |
| Natural memory-type intent | 83% | 99% | 103 |
| Type-filtered | 94% | 99% | 103 |
| Project-filtered | 93% | 99% | 103 |
| Tag-filtered | 92% | 98% | 102 |

Across the generated retrieval portion, the aggregate was 90% Top-1, 98% Top-3, and 0.94 MRR. The main measured weakness is typo handling: it remains strong enough for 91% Top-3, but its 81% Top-1 result leaves clear room for improvement.

The same run added three behavior groups outside those generated variants:

- Unsupported compound questions abstained in 10/10 cases instead of injecting weakly related memory.
- Operational routing passed 40/40 checks: legacy receipts stayed out of normal durable recall and remained available when explicitly requested.
- Current, historical, and as-of chain queries reached 96% Top-1 and 100% Top-3.

The 1,000 calls completed at 86.38 sequential queries per second. Generated retrieval latency measured 12.27ms p50 and 16.28ms p95 during this run.

## Real API Performance

The API benchmark goes through the authenticated dashboard HTTP route instead of calling the scorer directly. Its isolated temporary vault covers entity recall, aliases, current canonical heads, historical memory, retrieval-usage signals, explicit operational lookup, default operational isolation, and unsupported-query abstention.

Across 50 measured repetitions of eight cases—400 requests total after two warmup passes—the route achieved:

| API metric | Result |
| --- | ---: |
| Behavior checks | 8/8 |
| Ranked Top-1 checks | 6/6 |
| Median latency | 6.75ms |
| p95 latency | 12.12ms |
| Sequential throughput | 125.97 requests/s |

This is a same-machine product-path benchmark, not a hosted-service latency promise. Hardware, vault shape, filesystem load, sync activity, and development versus production builds can change absolute timing.

## Typed Memory At Scale

The reproducible scale benchmark creates isolated indexes at 100, 500, and 1,500 memories. Each size receives 200 exact, natural, sparse, and noisy queries with local embeddings disabled, so the result measures the local lexical and typed-memory path.

| Memories | Top-1 / Top-3 / MRR | p50 | p95 | Sequential queries/s | First cold recall |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1.00 / 1.00 / 1.00 | 1.86ms | 2.76ms | 506.98 | 25.02ms |
| 500 | 1.00 / 1.00 / 1.00 | 9.08ms | 10.91ms | 108.07 | 30.63ms |
| 1,500 | 1.00 / 1.00 / 1.00 | 27.16ms | 33.63ms | 35.52 | 78.71ms |

The synthetic corpus is intentionally controlled. Its perfect relevance shows that growing the index did not displace uniquely identifiable memories; it does not replace the noisier live-corpus benchmark above.

## Searching The Whole Vault

Typed Agent Memory is the fast path for durable facts, preferences, instructions, decisions, and learnings. When that distilled layer is not enough, HivemindOS can search normal vault markdown through a generated lexical index and load only the ranked source notes.

The live eight-case benchmark covered project decisions, operations policy, control-plane documentation, shared skills, brain-service notes, secure references, imported sources, and intake notes.

| Full-vault path | Top-1 / Top-3 / MRR | Median latency |
| --- | ---: | ---: |
| Previous file-search path | 1.00 / 1.00 / 1.00 | 745.04ms |
| Direct lexical index | 1.00 / 1.00 / 1.00 | 48.42ms |
| Final tiered runtime | 1.00 / 1.00 / 1.00 | 300.33ms |

The direct indexed stage was 15.39× faster without changing the expected first result in any case. The final runtime is deliberately heavier because it performs the product's routing, candidate loading, and final ranking rather than returning raw index rows.

A separate large reference-vault test indexed 25,995 eligible notes from a 28,549-file vault in about 9.2 seconds and produced a 70.6 MB local JSONL index. In that five-query snapshot, median direct search improved from 2,285ms to 118ms, or 19.4×, with identical Top-1 results.

## Less Prompt Baggage

Memory only saves money when agents retrieve focused context instead of repeatedly loading broad files and histories. The live token benchmark sent the same task to the same model with a broad baseline context pack and a targeted Hive context pack.

| Live provider scenario | Baseline total tokens | Hive total tokens | Total reduction |
| --- | ---: | ---: | ---: |
| Focused shared-brain recall | 43,754 | 370 | **99.2%** |
| Complex dashboard chatbot build | 42,571 | 5,307 | **87.5%** |

These are provider-reported usage counters from live OpenRouter calls using `openai/gpt-4.1-mini`. The broad baseline was intentionally truncated at 180,000 sent characters in both scenarios; the targeted Hive packs were not truncated. These tests measure context and token use, not a provider invoice or a statistically powered final-answer-quality comparison. The complete prompts, outputs, and methodology are documented in [Token And Cost Savings](token-and-cost-savings.html).

The current deterministic local context-budget benchmark adds four scenarios—brain recall, software build, chatbot build, and workflow reuse. It estimated 2,906,702 baseline context tokens versus 22,764 targeted Hive context tokens, a 99.2% reduction. That is a reproducible text-budget estimate, not provider billing.

## Cleaner Current Truth

Two architecture changes address different sources of memory pollution:

1. Routine receipts, retries, and completions go to a bounded operational journal rather than durable Agent Memory.
2. Durable records use canonical memory keys, while reviewed evolution preserves previous versions as history under one current head.

The live migration corpus made the effect measurable:

| Health signal | Before separation and reviewed cleanup | Current |
| --- | ---: | ---: |
| Near-duplicate groups | 5 | 0 |
| Largest duplicate cluster | 44 receipts | 0 |
| Canonical conflict groups | 3 | 0 |
| Active records affected by canonical conflicts | 9 | 0 |

The current report-only health snapshot contains 101 active canonical heads and 21 superseded historical records. Forty-seven legacy operational records remain preserved for explicit access, but they no longer enter default durable recall. This before/after result combines architectural separation with reviewed consolidation; it should not be presented as an automatic cleanup percentage for every vault.

## Pattern Mining, With A Gate

Pattern mining is useful only if repeated noise does not become permanent advice. The labeled 47-event fixture includes three positives—a recurring provider failure, a reusable content workflow, and a stable weekly routine—plus adversarial negatives such as retries of one task, test/E2E activity, insufficient support, unknown outcomes, and unrelated one-offs.

The miner returned exactly the three labeled proposals:

| Pattern metric | Result | Enablement gate |
| --- | ---: | ---: |
| Precision | 1.00 | 0.90 |
| Recall | 1.00 | 0.80 |

This passes the fixture gate, but it is not production precision. Pattern mining remains a dry run by default, and explicit enqueueing creates review proposals rather than memories, skills, or scheduled jobs. Broad autonomous promotion stays disabled until real reviewed events provide enough evidence.

## Marketing-Safe Claims

These statements match the measured evidence:

> In a 1,000-query live memory benchmark, HivemindOS ranked the expected memory first 90% of the time and in the top three 98% of the time. Exact current-title recall was 100%.

> The indexed local memory path stayed under 30ms median at 1,500 synthetic memories while preserving perfect Top-1 across 200 exact, natural, sparse, and noisy queries.

> Targeted Hive context reduced provider-reported total tokens by 87.5% on a complex build task and 99.2% on a focused memory-recall task.

> In an eight-case live full-vault benchmark, the direct lexical index was 15.39× faster than the previous search path with the same expected first result in every case.

> Operational receipts stayed out of default durable recall in 40/40 checks, while reviewed migration moved canonical conflicts and duplicate pressure to zero in the measured live corpus.

> Across 2,036 annotated LoCoMo and LongMemEval questions, HivemindOS retrieved the labeled evidence session in the Top-50 99.80% of the time and in the Top-10 94.84% of the time.

> Full local retrieval completed without an empty result for all 900 BEAM 1M and 10M questions; median retrieval was 121.9ms at 1M and 1.05s at 10M.

> With GPT-5.4 Mini answering and judging the complete Top-50 runs through ChatGPT OAuth, HivemindOS scored 76.62% on LoCoMo and 53.40% on LongMemEval.

> On the complete BEAM runs, HivemindOS averaged 41.12% rubric compliance at 1M context and 37.04% at 10M context, with 44.29% and 43.00% of questions meeting the 0.5 pass threshold.

Do not turn these results into an unmeasured competitor comparison, a hosted latency SLA, a universal token-savings guarantee, or a claim that pattern proposals are production-perfect. The benchmarks deliberately publish their corpus, route, sample size, and limitations so the claims can stay useful as the product evolves.

## Reproduce The Benchmarks

The local and fixture benchmarks do not require a paid model:

```bash
pnpm benchmark:agent-memory-live-recall -- --vault <vault> --calls 1000
pnpm benchmark:agent-memory-scale -- --calls 200
pnpm benchmark:agent-memory-upgrade -- --base-url <dashboard-url> --iterations 50 --warmup 2
pnpm benchmark:shared-brain-search -- --vault <vault> --limit 8
pnpm benchmark:agent-memory-pattern-mining
pnpm benchmark:context-savings
```

The authenticated API benchmark expects a running HivemindOS dashboard. The full-vault and live-memory benchmarks are read only. The scale, API behavior, and pattern benchmarks use isolated synthetic fixtures.

The standard public suites use the development-only harness documented under `benchmarks/memory/`. Datasets, temporary vaults, model clients, OAuth bridges, checkpoints, and raw outputs remain outside the production application and are not shipped to users.

The live token benchmark calls the selected provider and may incur provider charges:

```bash
./scripts/hive-env-run -- pnpm benchmark:e2e-token-savings -- --scenario brain-recall
./scripts/hive-env-run -- pnpm benchmark:e2e-token-savings -- --scenario chatbot-build
```

For the underlying memory architecture, see [Brain, Vault, And Skills](brain-vault-and-skills.html) and [Brain Services](../whole-brain/brain-services.html).
