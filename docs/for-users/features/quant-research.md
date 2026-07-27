---
title: "Quant Research Swarm"
---

# Quant Research Swarm

HivemindOS can run a family of market hypotheses through a research-only swarm and preserve the evidence needed to reject weak results.

The workflow separates creative work from numerical authority. Research and code agents propose hypotheses and typed signals. A Rust engine owns lagged, cost-aware simulation. A separately implemented Python validator owns statistical inference, regime analysis, and factor decomposition. A strategy is promoted in the report only when every required gate passes.

## What You Provide

- A reviewed, point-in-time dataset with source and as-of provenance
- An explicit statement of survivorship-bias controls and price adjustments
- One or more falsifiable hypotheses with economic rationales
- Typed signal settings, including an execution lag of at least one bar
- Commission, slippage, and borrow assumptions
- Aligned market returns plus canonical market, size, value, profitability, investment, momentum, and low-volatility factor series for independent audits

HivemindOS currently accepts one symbol per engine request so time ordering stays explicit. A research family can contain several strategies for the same history. Broader portfolios should be assembled from separately verified point-in-time series rather than flattened into an ambiguous return stream.

## What Gets Tested

Every orchestrated run applies hard floors for observation count, Newey-West significance, circular block bootstrap confidence, false-discovery control, purged out-of-sample degradation, probability of backtest overfit, shifted-signal placebos, deflated Sharpe, factor-residual alpha, a Gaussian hidden-Markov audit over market returns and trailing volatility, and reconciliation with the Rust result.

Missing candidate-family, factor, regime, signal, or provenance coverage fails closed. Callers can make thresholds stricter but cannot lower the built-in floors through a run request.

## Evidence And Lineage

Each run writes a local manifest and report plus separate candidate, backtest, and validation artifacts. Dataset, strategy, backtest, and validation hashes make it possible to tell whether a later result came from the same inputs. Run IDs are append-only, and failed runs retain a queryable manifest and rejection reason instead of disappearing or overwriting earlier evidence.

Passing the gates does not establish future profitability. It means only that the candidate survived this specific research protocol and is eligible for human review.

## Run Or Schedule It

Inspect the installed policy:

```bash
hive-quant-research policy
```

Run a reviewed request file:

```bash
hive-quant-research run --request <request.json>
```

For repeated work, set `HIVEMINDOS_QUANT_RESEARCH_REQUEST` to the reviewed request path, attach the `hive-quant-research` skill in Scheduler, choose the cadence, and approve its local process/filesystem action. Scheduled runs remain local and research-only.

## Safety Boundary

This capability has no order, broker, wallet, or money-movement path. It cannot enable live execution. Any future paper-trading or live-trading system must be separate, explicitly approved, and governed by its own risk controls.
