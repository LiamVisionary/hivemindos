---
title: "Penny-stock Standing-limit Paper Lab"
---

# Penny-stock Standing-limit Paper Lab

The penny-stock paper lab studies the “close near $0.10, leave a buy limit near $0.07” method without contacting a broker. It ranks ten research candidates, pauses for a documented zero-to-three-name decision, and subjects one possible policy change to pessimistic execution and overfitting tests.

It is a research tool, not an investment recommender. It cannot place or cancel an order, connect live trading, mutate a brokerage account, use a wallet, or move money.

## Research and select

Create a unique research run:

```bash
node scripts/penny-stock-paper-lab.mjs research
```

The report documents each candidate separately:

- market cap and 90-session consolidated volume
- volatility, maximum drawdown, and return
- standing-limit touch and later bounce counts
- lower confidence bounds for both probabilities
- conservative expected value after spread, partial-fill, adverse-selection, and cost penalties
- recent SIP bid/ask spread and displayed-size evidence
- SEC filing flags for offerings, convertibles, warrants, going-concern language, listing compliance, losses, share growth, and estimated cash runway; filing phrases are classified as confirmed, planned, conditional, boilerplate, or unclear before they affect eligibility
- reverse splits and other corporate actions
- explicit hard-veto reasons and a separate unresolved-risk quarantine

The lab preserves dated universe snapshots. These snapshots gradually reduce survivorship bias and let later outcome reviews retain prior candidates, including names that disappear from the current screen. Coverage begins with the first recorded snapshot; it does not reconstruct a complete historical delisting database.

Document a balanced paper basket:

```bash
node scripts/penny-stock-paper-lab.mjs review \
  --run-id <run-id> \
  --symbols AAA,BBB,CCC \
  --reviewed-by "<reviewer>" \
  --rationale "<evidence-based rationale>"
```

The selection may contain one, two, or three names. Use `--symbols cash` to retain all cash, or `--symbols auto` to apply the deterministic conservative-EV, veto, unresolved-risk, and sector-balancing reasoner. A hard-vetoed, unresolved-risk, or non-positive conservative-EV candidate cannot be selected. Contractual boilerplate is preserved as evidence but no longer becomes a reverse-split veto by keyword alone.

## Three research cadences

The lab separates evidence collection from policy evolution:

1. During regular U.S. market hours, an hourly monitor refreshes bounded SIP quote spread and displayed-size evidence for the latest completed top ten. It also checks SEC filing metadata and corporate actions. A new filing or action triggers a full issuer-risk refresh for that symbol.
2. After the market closes, one unique dated research, review, outcome-maturation, and evolution run may evaluate the new universe snapshot.
3. Once a week, an accumulated-cohort audit summarizes completed runs, distinct universe snapshots, intraday coverage, gate pass rates, cost stress, and matured 1/5/10/20-session outcomes.

The preferred after-close entry point is atomic and idempotent:

```bash
node scripts/penny-stock-paper-lab.mjs after-close
```

It performs research, reads same-session monitor artifacts as supporting evidence, records the bounded zero-to-three reasoner review, matures outcomes, and runs evolution. If the canonical universe and ranked-candidate data are unchanged, it reports a skip before creating another research lineage. Read-only market-data calls receive three bounded attempts; a final failure remains explicit.

Run the evidence monitor:

```bash
node scripts/penny-stock-paper-lab.mjs monitor
```

If the SIP quote endpoint, SEC markers, and corporate actions are unchanged, the monitor reports a skip instead of writing a duplicate artifact. Intraday artifacts are append-only and set `policyMutationAllowed` to `false`.

Run the weekly audit:

```bash
node scripts/penny-stock-paper-lab.mjs weekly-audit
```

The weekly audit also sets `policyMutationAllowed` to `false`. Its PnL fields summarize overlapping research evaluations and must not be added together or interpreted as portfolio earnings.

## Pessimistic paper execution

When aligned SIP quotes are available, the simulator requires the ask to reach a buy limit and the bid to reach a sell threshold. It caps fills at 10% of conservative displayed size and records partial fills. Queue priority is explicitly marked unknown rather than estimated as observed fact. When quote history is unavailable for an older cohort, it falls back to a deliberately pessimistic daily-bar model.

Both paths include:

- entry and exit costs
- adverse-selection penalties
- daily-volume participation limits
- stop-first handling when a daily bar crosses both exits
- gap penalties and no execution on zero-volume sessions
- maximum concurrent positions
- daily-loss and portfolio-drawdown kill switches
- separate 1x, 2x, and 3x cost-stress results

Displayed size and modeled limit touches still do not prove that a real order would fill. Queue priority, hidden liquidity, manipulation, news halts, and broker-specific handling remain unknown.

## Walk-forward evolution

Run one generation:

```bash
node scripts/penny-stock-paper-lab.mjs evolve --run-id <run-id>
```

Each generation changes exactly one strategy dimension. The lab selects it only on a training segment, purges the open-order/holding overlap at the boundary, and freezes it across four non-overlapping forward cohorts. Lower- and higher-volatility cohorts are reported separately.

A generation advances only if every gate passes, including:

- enough fills and positive PnL
- superiority to cash, the active policy, a simple fixed rule, and seeded random variants
- wins in most forward cohorts
- positive paired-bootstrap lower bound
- no worse maximum drawdown
- positive results in both volatility regimes
- deflated Sharpe, probability-of-backtest-overfitting, shifted-signal placebo, and false-discovery-rate thresholds
- a stable parameter neighborhood
- positive PnL under 3x costs
- genuinely new as-of evidence

The run records the observed failure, causal hypothesis, one proposed change, pre-test prediction, falsification criteria, result, and retain/reject decision. Failed generations remain append-only. The lab refuses to mine the same unchanged as-of snapshot again.

Hourly evidence collection never calls this evolution path. More intraday observations can improve later execution and issuer-risk evidence, but they cannot create extra same-day policy generations.

## Outcome learning

Each later run revisits earlier candidates after 1, 5, 10, and 20 trading sessions. It preserves the source screen price, the actual reference close, each later date and close, close return, maximum favorable excursion, and maximum adverse excursion for both selected and unselected candidates.

The decision audit then replays the actual standing-limit method over each matured path with the pessimistic daily-bar execution model. This distinction matters: a rejected stock can rise sharply without ever touching the standing limit, so the price increase is not an executable missed trade. Each review is labeled supported, challenged, mixed, or inconclusive:

- a selected filled method outcome supports or challenges the selection according to its cost-aware counterfactual return
- a rejected non-vetoed candidate that would have produced a positive filled method outcome becomes a possible false negative
- a profitable outcome behind a hard issuer veto is mixed evidence, not automatic proof that the veto was wrong
- an unfilled standing limit remains non-actionable even when the later close is higher

Material movers trigger a bounded catalyst review for new SEC filing markers and corporate actions. The audit also records volume shocks and large overnight gaps. These are catalyst hypotheses based on confirmed event timing or market patterns; the lab never converts temporal overlap into a causal claim. A material move with no defensible evidence is explicitly marked unexplained.

Selector learning now targets the 20-session standing-limit counterfactual return rather than a buy-at-close return. Selector weights remain frozen until at least 100 twenty-session outcomes exist, at least 95% of source candidates have usable outcome histories, and at least 95% of candidates old enough to mature have complete 20-session labels. A proposed one-step weight update must improve both its training sample and a frozen 25-observation holdout. Sparse, selectively missing, mixed, or hindsight-only evidence leaves the selector unchanged.

Every new research artifact prospectively registers 10%, 20%, and 30% entry-distance variants. Later 20-session reviews score every registered distance with the same pessimistic fill model and 1x/2x/3x costs, including no-fills as zero-return orders. A Beta prior prevents a tiny fill sample from appearing certain. The last 25 observations remain a frozen holdout once 100 panels mature. This panel can nominate one distance for the existing full forward, regime, benchmark, bootstrap, DSR, PBO, placebo, FDR, neighborhood, drawdown, and cost gate stack; it cannot mutate policy directly and never backfills old runs as if the variants had been registered prospectively.

Weekly audits report label completeness and prospective entry-distance fill/return evidence alongside decision challenges and material movers, without mutating policy.

Even a fully passing paper generation only changes a local research policy. Simulated PnL is not evidence of future earnings.
