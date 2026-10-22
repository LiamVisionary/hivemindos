# Memory Benchmarks

> https://hivemindos.app/superagent-api/docs/benchmarks · Markdown version: https://hivemindos.app/superagent-api/docs/benchmarks.md

# Memory benchmarks

<p class="lede">What SuperAgent API memory is measured to do, on public benchmarks, with every answer published.</p>

Two surfaces share one memory design: **hosted memory** (the Cloud Superbrain behind this API's `memory.*` operations) and the **Hive Superbrain** that runs on your own computer (`hive-brain answer`). They recall the same way; the hosted Memory Answer works within one 24,000-character budget, while the computer version can hand over up to 60,000. Each result below says which one it measures.

These are measured snapshots, not an availability or latency promise.

## Hosted memory (this API)

| Measure | Result |
| --- | ---: |
| Search: the chats that hold the answer are in `memory.recall`'s top 5 (recall@5), LongMemEval_S, `rerank: true` | **97.68%** (hit@5 99.4%) |
| The same without `rerank: true` (meaning search on) | **93.71%** |
| Evidence reaches the reading model, LongMemEval_S, `memory.answer` with meaning search and Turbo | **96.17%** |
| Evidence reaches the reading model, LongMemEval_S (each answer among ~50 past chats) | **90.6%** |
| Evidence reaches the reading model, LongMemEval Oracle (only the chats that hold the answer) | **98.5%** |
| Answers correct, 150 LongMemEval_S questions | **81.9%** |

Search (measured 2026-09-28): all 500 questions through the real memory routes with the production embedding model, scored with sibyl.ist's open LongMemEval_S metric code; before these changes recall@5 was 90.69% and the Turbo answer's evidence 91.91%. [Method and per-type results](https://hivemindos.app/docs/for-users/features/shared-brain-benchmarks.html#hosted-memory-search-accuracy). Earlier evidence rows: all 500 questions (470 answerable), `memory.answer` in keyword order, no model calls. Answers: the shipped reader, graded by LongMemEval's own judge prompts with `gpt-4o-mini`, measured on 2026-09-23 and not yet re-run on the current evidence layout.

### Choosing a reader

In a second run, other models read the same 150 questions with the same evidence; the default reader scored 80.7% in that run. Share answered correctly, and the reader's median time (the model's own time, not the whole request):

| Reader | Correct | Median time |
|---|---:|---:|
| `@cf/deepseek-ai/deepseek-v4-flash-0731` | 82.1% | 4.0 s |
| `@cf/qwen/qwen3-30b-a3b-fp8` (default) | 80.7% | 4.0 s |
| `@cf/zai-org/glm-4.7-flash` | 80.3% | 18.7 s |
| `@cf/google/gemma-4-26b-a4b-it` | 78.7% | 23.0 s |
| `@cf/openai/gpt-oss-120b`, low effort | 78.0% | 2.2 s |
| `@cf/openai/gpt-oss-20b`, low effort | 69.3% | 1.3 s |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 68.7% | 2.0 s |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 54.0% | 1.6 s |

DeepSeek V4 Flash and GLM 4.7 Flash returned no answer for 5 and 3 questions; their shares count the questions they answered (119 of 145 and 118 of 147), and over all 150 they are 79.3% and 78.7%. Scores within a few points of each other are within this sample's noise. To pick a reader, see [Choose who reads the answer](memory.html#choose-who-reads-the-answer).

### Behavior and latency

The August 27, 2026 authenticated API benchmark used three fresh isolated hosted accounts. Every account passed all eight lexical behavior cases, all six semantic Top-1 cases, and all three grounded-answer cases, including aliases, current and historical evolution, usage ranking, operational isolation, paraphrases, and unsupported-question abstention. The equivalent local typed-memory cases also passed in every fresh run.

Hosted recall is slower than the local vault path. Measured on September 30, 2026 as server time (`Server-Timing`), on a brain of 20 short memories: keyword search (`memory.search`) takes about 24 ms; semantic recall (`memory.recall`) 333 ms median (416 ms p90), most of it the meaning index (about 200 ms) and embedding the question (about 90 ms); a Memory Answer with the default reader 665 ms median, of which the answer model is about 360 ms. `rerank: true` adds about 1 s. Answers that read long conversation histories take longer, almost all of it the answering model. Network time comes on top: from the Philippines, a semantic recall took about 480 ms end to end. The local lexical/API behavior trials had a median p50 of 7.85 milliseconds.

The August 27 trials above were timed before the second read (`rerank: true` and Turbo) and the current recall, so their times no longer describe the service; they are kept with the quality results on the [benchmarks page](https://hivemindos.app/docs/for-users/features/shared-brain-benchmarks.html#hosted-superagent-api-memory).

These results support quality parity on the published cases, not universal parity with every private vault.

## Hive Superbrain (same design, on your computer)

Claude Opus 4.6 reads what memory returns; LongMemEval's official judge prompts with `gpt-4o-2024-08-06` grade every answer.

| Benchmark | Hive Superbrain | Compared with |
| --- | ---: | --- |
| LongMemEval Oracle, 470 questions | **96.6%** | Sibyl-Memory's published Opus 4.6 answers, graded the same way: 95.3% (p = 0.33) |
| LongMemEval_S, 470 questions | **94.3%** | Sibyl-Memory's published architecture, run with its public runner: 92.1% (p = 0.16), reading about a ninth of the tokens |
| LoCoMo, 500 questions | **94.4%** | A pre-registered held-out test: none of the memory design was tuned on LoCoMo |

HivemindOS scored higher than Sibyl-Memory on both comparisons; neither difference is established beyond chance.

## Receipts

Every context memory returned, every answer and every verdict is published in [hivemindos-memory-benchmarks](https://github.com/LiamVisionary/hivemindos-memory-benchmarks), with scripts that recompute each number from the files. The full method, corpus sizes, repetition counts, and limitations, including what was tried and did not help, are on the [benchmarks page](https://hivemindos.app/docs/for-users/features/shared-brain-benchmarks.html). How to call hosted memory is in [Memory](memory.html).
