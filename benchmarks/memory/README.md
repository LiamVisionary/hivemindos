# Standard memory benchmarks (development only)

This harness runs LoCoMo, LongMemEval, and BEAM against HivemindOS without adding a benchmark route, UI, dataset, model client, or dependency to the production application. Datasets, temporary vaults, checkpoints, virtual environments, and result JSON stay under the gitignored `.outputs/benchmarks/standard-memory/` directory.

## What it measures

The retrieval adapter exercises the shipped memory path:

1. archive raw benchmark dialogue with `syncConversationNoteForSession`;
2. build the normal full-vault index with `rebuildFullVaultSearchIndex`;
3. retrieve with `recallAgentMemory` in `full-vault` scope;
4. answer and judge with the pinned prompts from `mem0ai/memory-benchmarks`.

HivemindOS recall currently exposes at most 50 results. The harness therefore reports Top-50, not a synthetic Top-200 result. Compare it only with reference results at the same cutoff.

## Pinned sources

- Evaluation backbone: `mem0ai/memory-benchmarks@4b61c5d31b9c668a12b4f5e78064248a02c82d2b`
- LoCoMo dataset: `snap-research/locomo@3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376`
- LongMemEval dataset: `xiaowu0162/LongMemEval@9e0b455f4ef0e2ab8f2e582289761153549043fc`
- BEAM dataset/schema: `mohammadtavakoli78/BEAM@3e12035532eb85768f1a7cd779832b650c4b2ef9`

The evaluator verifies the SHA-256 of each imported upstream prompt module before making a model call.

## One-minute iteration panel

`micro-v1` is a fixed 36-question development panel: 10 LoCoMo questions, one question from each of LongMemEval's six task types, and one question from each of BEAM's ten task types at both 1M and 10M. It runs all four answer-and-judge suites concurrently and keeps the GPT-5.4 Mini/ChatGPT OAuth configuration separate from Mem0's published GPT-5 reference.

Start the loopback OAuth proxy in one terminal, then run the panel from another:

```bash
hive-env-run -- pnpm benchmark:standard-memory:oauth-proxy

pnpm benchmark:standard-memory:micro -- \
  --run \
  --project-name <unique-run-name> \
  --workers-per-suite 4
```

Validate or inspect the exact command plan without a model call:

```bash
pnpm benchmark:standard-memory:micro -- --validate
pnpm benchmark:standard-memory:micro -- --plan --project-name <unique-run-name>
```

The selected question ids are immutable within `micro-v1`. They were calibrated from the completed HivemindOS GPT-5.4 Mini and Mem0 GPT-5 outcomes so each small-suite baseline stays close to its corresponding full aggregate while covering every benchmark task family. This makes the panel useful for rapid relative iteration, but not a blind holdout and not a publication replacement. Never swap a difficult id for an easier one after seeing a candidate result; create a new version and confirm promoted changes on a larger held-out or full run.

## Run

Clone the evaluation backbone into a disposable development directory and check out the pinned commit. Download each official dataset into `.outputs/benchmarks/standard-memory/datasets/`; do not commit it.

Retrieval example:

```bash
pnpm benchmark:standard-memory:retrieve -- \
  --benchmark locomo \
  --dataset .outputs/benchmarks/standard-memory/datasets/locomo10.json \
  --project-name full-top50 \
  --top-k 50
```

Evaluation example:

```bash
hive-env-run -- python3 scripts/benchmark-standard-memory-evaluate.py \
  --benchmark locomo \
  --predictions-dir .outputs/benchmarks/standard-memory/locomo/predicted_full-top50 \
  --harness-root <path-to-memory-benchmarks> \
  --answerer-model gpt-4o \
  --judge-model gpt-4o \
  --cutoffs 50
```

To use the connected ChatGPT/Codex subscription instead of a metered API key, start the loopback-only development proxy in a separate terminal:

```bash
hive-env-run -- pnpm benchmark:standard-memory:oauth-proxy
```

Then point the evaluator at it without bearer authentication:

```bash
python3 scripts/benchmark-standard-memory-evaluate.py \
  --benchmark locomo \
  --predictions-dir .outputs/benchmarks/standard-memory/locomo/predicted-full-oauth-top50 \
  --harness-root <path-to-memory-benchmarks> \
  --answerer-model gpt-5.4-mini \
  --judge-model gpt-5.4-mini \
  --base-url http://127.0.0.1:8765/v1/chat/completions \
  --auth-mode none \
  --provider-label chatgpt-oauth \
  --cutoffs 50
```

The proxy binds only to `127.0.0.1`, requires an existing HivemindOS ChatGPT OAuth connection, and never falls back to `OPENAI_API_KEY`. OAuth avoids API-key billing, but full benchmark runs still consume the ChatGPT plan's Codex/agentic usage or credits. `gpt-5.4-mini` is the lower-cost default for this high-volume development run. It is not the exact `gpt-5` model used by the pinned upstream reference table, so label that model difference and do not present the scores as a controlled head-to-head comparison. ChatGPT OAuth does not return API token-usage counters through this adapter, so those fields remain unavailable rather than estimated.

The command is resumable: each completed question is written atomically before the next one. Use a new project name when changing retrieval code, prompts, cutoffs, datasets, or models. Never merge results from unlike configurations without labeling every endpoint and model.

Summarize a run without making model calls:

```bash
pnpm benchmark:standard-memory:summarize -- \
  --benchmark longmemeval \
  --predictions-dir .outputs/benchmarks/standard-memory/longmemeval/predicted_full-top50
```

The summary marks answer/judge scores as `complete`, `partial`, or `not-run`. LoCoMo and LongMemEval also report whether the annotated evidence session appeared at Top-1, Top-3, Top-10, Top-20, and Top-50.

## BEAM parquet extraction

BEAM 1M and 10M are distributed as parquet. Install `pyarrow==19.0.1` into a disposable virtual environment under `.outputs/`, then extract one conversation per JSON file so a 10M split never has to occupy the Node heap all at once:

```bash
.outputs/benchmarks/standard-memory/.venv/bin/python \
  scripts/benchmark-standard-memory-extract-beam.py \
  --parquet .outputs/benchmarks/standard-memory/datasets/beam-1m.parquet \
  --output-dir .outputs/benchmarks/standard-memory/datasets/beam-1m
```

Run each extracted row with its filename number as `--conversation-offset`. BEAM scores use rubric-nugget compliance. Event-ordering Kendall tau-b is deliberately marked as skipped until the adapter implements and verifies that secondary metric.

## Publication rules

- Publish full-dataset scores separately from pilots or partial checkpoints.
- Name sample count, Top-K cutoff, answerer, judge, prompt commit/hash, endpoint provider, token accounting, and latency boundary.
- Keep retrieval latency separate from model answer/judge latency.
- Do not present results from mixed endpoints as a single-endpoint run.
- Do not compare HivemindOS Top-50 against a competitor's Top-200 without displaying both cutoffs.
