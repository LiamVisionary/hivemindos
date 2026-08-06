---
title: "Prediction Markets"
---

# Prediction Markets

Open **Trade → Prediction** to research active Polymarket markets without connecting
a wallet or granting the app live-order authority.

## What the Prediction desk does

- Searches active events and normalizes them into events, markets, and tradable outcomes.
- Shows live public odds, 24-hour volume, liquidity, best bid/ask, and outcome price history.
- Uses the Polymarket CLOB token ID—not the condition ID—for price history and order books.
- Simulates buy or sell fills against the visible book with modeled slippage.
- Tests the current 5-minute and 15-minute BTC Up/Down markets for executable
  complement arbitrage, using paired books, equal shares, displayed depth, and
  both-leg taker fees.
- Keeps up to 100 paper fills in HivemindOS dashboard state, so the practice book survives reloads.
- Groups a public wallet's open positions and up to 500 recent public activity records into sample-level trader metrics.
- Turns a weather forecast, bucket, and uncertainty assumption into a modeled probability.

The trader lens describes only the public sample returned by Polymarket. It does not
identify the wallet owner, prove skill, or claim a complete performance history.

## BTC complement-arbitrage paper lab

Open **Trade → Prediction → Arbitrage**, enter a paper bankroll, and scan the live
books. The lab checks the claim that buying both outcomes below $1 locks a profit,
but it does not use the displayed outcome prices as executable prices.

For each current BTC market, HivemindOS:

1. fetches both outcome books together;
2. reads the actual asks and walks no more than 25% of displayed depth;
3. buys the same number of Up and Down shares;
4. applies the market's published fee curve to both taker legs; and
5. creates a paper fill only when the paired $1 payout remains larger than total
   modeled capital.

A displayed-price sum below $1 can still be rejected because displayed prices may be
midpoints or stale last trades. A raw executable gap can also disappear after fees.
Resting maker orders may avoid taker fees, but they are not a locked pair: one order
can fill without the other.

For a bounded command-line observation run:

```bash
node --import tsx scripts/polymarket-btc-complement-paper.mjs \
  --duration-seconds 60 \
  --sample-ms 1000 \
  --bankroll-usd 100
```

Use `--output <path>.jsonl` to preserve append-only observation and summary rows.
The scanner reads only public Gamma and CLOB data and has no wallet or order path.

## Broader arbitrage research matrix

The public strategy-matrix scanner tests more than the viral buy-both formula:

- binary complete-set buys and split-and-sell premiums;
- fixed, non-augmented negative-risk outcome baskets;
- negative-risk NO-to-other-YES conversion spreads;
- narrowly parsed deadline and price-threshold implications; and
- maker spread, rebate, and liquidity-reward candidates.

It labels results by what the evidence can support. A basket is “locked after
complete fills” only when every required leg fills at executable depth and the
minimum payout still exceeds fees. Negative-risk conversions remain
execution-risk because acquisition and liquidation are not one atomic order.
Logical relations require criteria review. Maker candidates are always
non-guaranteed because a public quote does not establish queue priority,
two-sided fills, adverse-selection cost, or a share of the reward pool.

```bash
node scripts/polymarket-arbitrage-research.mjs \
  --event-limit 50 \
  --duration-seconds 300 \
  --sample-ms 30000 \
  --bankroll-usd 100 \
  --output ~/.hivemindos/experiments/polymarket-arbitrage.jsonl
```

Fee-enabled markets fail closed when the live per-market fee schedule is absent.
This is safer than hard-coding category rates, which can change and may not match
the particular market.

The maker shadow goes one step beyond sorting displayed spreads. It assumes all
visible size at the selected price is ahead in queue and requires public trade
volume at or through the quote to clear that queue plus the full hypothetical
order:

```bash
node scripts/polymarket-maker-shadow.mjs \
  --duration-seconds 180 \
  --bankroll-usd 100 \
  --output ~/.hivemindos/experiments/polymarket-maker-shadow.jsonl
```

Its result is still only a conservative public-data proxy, not proof that a real
order would receive the same fill.

## Auditing the published proper-betting result

The separate proper-betting ledger audit reconciles the frozen public trade log
linked by arXiv:2607.06166 with Kalshi's archived market outcomes. It reports final
PnL, unresolved coverage, and how much performance depends on the largest markets:

```bash
node scripts/audit-prediction-proper-betting-ledger.mjs \
  --output ~/.hivemindos/experiments/proper-betting-audit.jsonl
```

That paper's Brier-derived forecasting strategy is directional and relies on a
forecaster maintaining an accuracy edge. A profitable historical deployment is
evidence worth prospectively paper-testing; it is not arbitrage or a promise of
future profit.

## Prospective proper-betting paper replication

The prospective CLI freezes evidence in this order: preregistration, market/book
snapshot, reviewed forecast, later fill snapshot, and settlement. It refuses to
backdate a forecast, overwrite an artifact, fill inside the five-minute execution
lag, trade inside three hours of resolution, or treat a midpoint as an ask.

```bash
EXPERIMENT_DIR=~/.hivemindos/experiments/proper-betting

node scripts/prediction-proper-betting-paper.mjs init \
  --experiment-dir "$EXPERIMENT_DIR" \
  --paper-capital-usd 500

# Review the generated selection template, save it as reviewed-markets.json,
# and set criteriaReviewed=true only after reading each resolution rule.
node scripts/prediction-proper-betting-paper.mjs snapshot \
  --experiment-dir "$EXPERIMENT_DIR" \
  --markets "$EXPERIMENT_DIR/reviewed-markets.json"

# Complete the generated forecast template with cited probabilities and an
# evidence timestamp, then wait at least five minutes.
node scripts/prediction-proper-betting-paper.mjs paper \
  --experiment-dir "$EXPERIMENT_DIR" \
  --snapshot "$EXPERIMENT_DIR/snapshots/<cohort-id>.json" \
  --forecasts "$EXPERIMENT_DIR/forecasts/<cohort-id>.reviewed.json"

# Re-run this against every cohort root. It reads public resolution state and
# appends outcomes, complete settlements, and a closed-only aggregate scorecard.
node scripts/prediction-proper-betting-monitor.mjs \
  --experiment-dir "$EXPERIMENT_DIR" \
  --include-experiment-dir ~/.hivemindos/experiments/<older-cohort-root>
```

Paper capital is configurable only at preregistration. Raising it does not relax
the 2% edge, liquidity, fee, depth, event, category, or resolution-window gates;
it gives otherwise eligible signals enough simulated capital to clear venue
minimum-size constraints.

The treatment allocates its fixed paper risk budget in proportion to the binary
Brier-score gradient `2 × |forecast − market midpoint|`, with market, event,
category, and displayed-depth caps. It buys only when the selected outcome's
forecast probability exceeds the later executable ask plus the live taker fee
and a fixed 2% margin. A capital-matched equal-notional arm and cash are retained
as controls.

The preregistration requires at least 252 settled markets and four non-overlapping
forward cohorts before profitability can even be evaluated. HAC inference, a
10,000-sample bootstrap, false-discovery control, 2,000 placebos, PBO, deflated
Sharpe, and regime/concentration checks still fail closed. Open paper positions,
restricted public venue data, or one profitable cohort do not meet that gate.
The monitor therefore reports open positions separately and calculates win rate
from closed positions only. It also groups repeated positions by unique market
and correlated event, and reports treatment/control return, Brier improvement,
drawdown, and event-level PnL concentration. Those descriptive statistics can
show whether results are moving in the right direction; none is labeled a
persistent edge before every preregistered validation gate passes.

## Continuous Up/Down paper evolution

The Up/Down loop prospectively tests path-dependent entries on the current BTC,
ETH, SOL, and XRP 5-minute and 15-minute markets. It is separate from the
instantaneous complement-arbitrage scanner: an arm may buy the cheaper outcome,
later complete the opposite leg only when displayed asks plus live taker fees
remain below the frozen pair cap, and otherwise hold the virtual position to
public resolution. A resolution-lag idea exists only as one frozen challenger;
it is not assumed to work.

Run one public-data step or inspect the current materialized status:

```bash
node --import tsx scripts/polymarket-updown-paper-loop.mjs step
node --import tsx scripts/polymarket-updown-paper-loop.mjs status
```

The default experiment directory is
`~/.hivemindos/experiments/polymarket-updown-self-evolving-paper/`. Each step
creates a new immutable JSON run containing its prior-run ID, public-data errors,
full observed ask snapshots, paper fills, per-arm settlements, evolution decision,
failed gates, and reflection. The
mutable `state.json` and `STATUS.md` are rebuildable views; completed generations
are preserved separately. A cross-process lock prevents overlapping scheduler
wakes, and an abandoned lock is archived before recovery. Each public Gamma or
CLOB request has a 15-second deadline; a timeout is recorded as missing evidence
and can never become a paper fill.

Every generation gives cash, the frozen champion, and four single-parameter
challengers the same $500 virtual starting balance and the same future market
observations. A challenger cannot replace the champion before 64 settled markets,
a fresh 32-market review batch, a 24-hour cooldown, positive net PnL, a positive
paired-bootstrap lower bound, at least 20 traded markets, and a 15% drawdown cap.
Rejected variants stay in the generation evidence instead of being erased.

The loop does not call a result “consistent paper profit” until the current frozen
champion has at least 252 settled markets and 64 trades, four full forward batches,
three profitable batches in a row, positive net and bootstrap-lower-bound PnL,
positive results in at least two assets and both intervals, no more than 10%
drawdown, limited win concentration, reliable public reads, and positive PnL after
three-times fee stress plus one cent per share of extra friction. When every other
gate passes, the loop first stops opening positions and settles its remaining paper
inventory; only an empty book can receive the final pass. It preserves the evidence
and does not turn on live trading or prove
that real queue position, latency, slippage, eligibility, or future markets will
produce the same result.

## Prospective self-learning Up/Down paper v2

The original continuous loop remains an immutable historical experiment. The v2
loop starts a separate ledger and may use v1 only to generate hypotheses; v1
outcomes are explicitly excluded from every v2 score, promotion, retirement, and
profit gate.

```bash
node --import tsx scripts/polymarket-updown-paper-v2.mjs step
node --import tsx scripts/polymarket-updown-paper-v2.mjs status
```

V2 begins with an immediate-pair champion. It opens a paper position only when
both displayed asks, both taker fees, displayed depth, venue minimum size, and
paper bankroll pass in the same observation. The two legs are committed together;
insufficient depth on either side produces no fill. This prevents the
unpaired-directional exposure that dominated the historical v1 loss while still
retaining cash and four equal-bankroll, one-change controls.

Each generation is registered before its first eligible observation. Structured
attribution reports PnL and uncertainty by asset, interval, paired versus unpaired
execution, entry-price bucket, and entry-time bucket. Those rows are labeled as
descriptive associations rather than causal findings. A daily review needs a
fresh non-overlapping cohort, and promotion additionally requires positive net and
three-times-cost-stressed PnL, a positive paired-bootstrap lower bound,
Benjamini-Hochberg false-discovery control, drawdown, breadth, and concentration
gates. If no challenger passes but the evidence supports a different bounded
family, v2 closes the old cohort and registers new one-change hypotheses for later
markets instead of rescoring history.

Negative evidence is terminal rather than silently accumulating forever. V2 stops
new entries after a statistically negative confidence interval, a 25% drawdown or
paper loss-budget breach, or a sufficiently large futile candidate family. It
continues public settlement reads until existing paper positions are empty, then
records `retired-negative-evidence`.

Material promotion, candidate-refresh, and retirement lessons become pending
Shared Brain review proposals. They are never auto-approved or auto-applied. Only
an explicitly applied v2 memory may supply an allowlisted, range-checked change to
a later generation; it cannot mutate the active policy or rewrite a completed run.
Routine fills, errors, and settlements stay in the local experiment ledger rather
than flooding durable memory.

V2 uses the same public-read-only boundary as v1. It cannot connect a wallet,
create or submit an order, use a credential, or enable live trading. Paper results
do not establish live profitability.

## Live-order boundary

The native Prediction desk is intentionally read-only plus paper execution. It does
not hold a Polymarket private key, create an API credential, sign a CLOB order, or
submit one.

If you choose **Prediction order** in the Crypto capability rail, HivemindOS uses the
existing governed prepare → confirm → execute flow. The connected provider and venue
still enforce eligibility. A user in a close-only region cannot use HivemindOS to
open a new Polymarket position.

## HivemindOS Mini

Two free hosted Mini surfaces use the same public-data boundary:

- **Prediction Lab** searches markets and builds saveable market or trader briefs.
- **Weather Markets** models a forecast bucket and saves the scenario.

Outputs save to Cloud Superbrain first. If the desktop bridge is connected, the same
artifact can also sync into desktop HivemindOS; a desktop sync failure never blocks
the Cloud Superbrain save.

## Open-source provenance

The implementation adapts only commercially permissive donors:

- PMXT unified event/market/outcome schema — MIT.
- collectmarkets2 activity pagination, deduplication, and market grouping — MIT.
- prediction-market-analysis calibration metrics — MIT.
- hermes_weatherbot weather-bucket probability math — MIT.

AGPL and unlicensed candidates from the source audit were not incorporated. One
MIT-licensed MCP candidate was also rejected because its repository contained unsafe
install/uninstall patterns; a permissive license is not a security review.

## Data limitations

Public upstream data can be delayed, sparse, or incomplete. Closed-market searches
may appear in upstream search results, while the native desk filters to active
markets. A market's resolution rules and official source remain authoritative.

This is research software, not financial, legal, or meteorological advice.
