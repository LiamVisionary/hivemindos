# Prediction edge research — developer protocol

This offline research harness compares a fixed family of forecasts against the market. It cannot submit orders, use credentials, collect new markets, or promote a strategy. Historical development results cannot establish an edge.

The family contains the frozen market, the original evidence forecast, mixtures with 25% and 50% weight on the evidence forecast, and a 25% mixture with additional probability-sensitivity abstention. The last candidate retains the same mean probabilities for scoring but rejects fills that do not retain a 2% net edge across the reviewed sensitivity envelope. The envelope is a scenario assumption, **not a calibrated confidence interval**. All original fee, liquidity, minimum-size, depth, capital, event, category and resolution-window limits continue to apply.

## Development audit

```sh
node scripts/prediction-edge-research.mjs audit \
  --experiment-dir <existing-v2-root> --output-dir <separate-research-root>
```

The command reconstructs settled observations from original forecasts, fills and public outcomes, then freezes a proposal before evaluating the declared family. It writes append-only JSON and a Markdown report. The existing V2 root is read-only. Every existing cohort, including open cohorts, is excluded from future confirmation.

Reported historical **retained-fill PnL** is a diagnostic that removes original fills using recorded average costs. Historical runs before execution receipts were introduced lack full lagged books, so this cannot establish strategy profit, new fills, position resizing or execution at each price level. No missing books are reconstructed from later data.

The independent Python audit recomputes Brier and log loss, holds market probabilities fixed in its residual placebo, resamples complete event and cohort clusters, adjusts for the declared candidate family, and removes each event in turn. Small-cluster intervals and exchangeable-residual assumptions limit inference. It always labels development evidence as ineligible for promotion.

V2's original validator retains its original gates. Additional gates reconcile proper scores, check exact method/market identity coverage, require positive log-loss improvement, and reject a forecaster that adds no information to market odds. The old whole-probability placebo could pass a market-copy forecast because shifting it destroyed the market's information; the added residual test corrects this failure without deleting the original gate or changing historical artifacts.

## Human approval and forward research

Approval is separate from a request to improve the research system. The operator must explicitly approve the exact canonical proposal digest and the `future-paper-shadow-only` scope. The approval file contains:

```json
{
  "type": "prediction-edge-research-approval",
  "proposalId": "<exact proposal id>",
  "proposalDigest": "<complete canonical SHA-256 digest printed by audit>",
  "approved": true,
  "approvedAt": "<actual UTC approval timestamp>",
  "approver": "<human approver>",
  "scope": "future-paper-shadow-only"
}
```

Do not create this artifact without that explicit approval. It is an attestation, not a cryptographic identity signature. Neither CLI has an approval-writing command. A changed proposal, source policy or hashed implementation requires a new review and digest-matched approval.

Use only a canonical snapshot created after approval. Never retrofit a cohort with a missed artifact, existing forecast/run, expired deadline or overlap with development markets/events. Prepare the ordinary V2 forecast from its template and research every market using public sources accessed between snapshot and forecast creation. Supply all eight model/runtime/prompt/instruction/skill/config/calibration/reviewer digests.

The additional evidence file is `{ "markets": [...] }`, with one entry per frozen market:

```json
{
  "marketId": "<market id>",
  "resolutionRule": "<exact substantive resolution rule>",
  "criteriaDigest": "<digest of description, resolutionDate and resolutionSource>",
  "numericalReasoning": "<base rate or quantitative model, its inputs, assumptions and numerical adjustment>",
  "counterevidence": "<credible reasons the forecast could be wrong>",
  "lowerYesProbability": 0.2,
  "upperYesProbability": 0.4,
  "sources": [
    {
      "url": "https://example.org/public-record",
      "accessedAt": "<actual access timestamp>",
      "receiptPath": "<local public source receipt, relative to evidence file>",
      "sha256": "<SHA-256 of receipt file bytes>",
      "primary": true,
      "independenceGroup": "<publisher or underlying source group>"
    }
  ]
}
```

Each entry needs at least two attested independent source groups, including primary evidence. Every source must appear in the reviewed forecast with the same access timestamp. Source independence and truth remain reviewer attestations; byte hashes only prove receipt consistency. The probability envelope must contain the raw evidence forecast. The harness transforms its endpoints using each candidate's mixture and adds a minimum two-percentage-point sensitivity margin for the cautious candidate.

1. Freeze all five methods **before** running the original V2 cohort:

   ```sh
   node scripts/prediction-edge-shadow.mjs freeze \
     --experiment-dir <v2-root> --output-dir <shadow-root> \
     --proposal <proposal.json> --approval <approval.json> \
     --cohort <id> --ai-forecasts <reviewed-original.json> --evidence <evidence.json>
   ```

2. Wait until the printed earliest fill time, at least five minutes after shadow creation, while still before the original deadline. Run the existing V2 controller with the **original** reviewed forecast. It now saves the full public fill frame under `execution-receipts/`, along with original method-run digests. No second market collector is needed.

3. Replay the shared frame:

   ```sh
   node scripts/prediction-edge-shadow.mjs simulate \
     --experiment-dir <v2-root> --output-dir <shadow-root> \
     --proposal <proposal.json> --approval <approval.json> \
     --frozen <shadow-root/frozen/cohort.json> --receipt <canonical-execution-receipt.json>
   ```

4. After the existing collector records outcomes, run `score` with the same four root/proposal/approval arguments. Scoring replays the immutable inputs and reconciles fills before reporting actual paper PnL, ROI, wins and drawdown. Every forecast is scored, including no-position markets; open outcomes are excluded.

The forward scorecard is descriptive and cannot grant promotion. At least 252 new settled markets, the original independent validation suite, family correction, positive forecast and economic results, and positive results without the best event remain required. Missing full-gate coverage is an explicit readiness gap. No scheduled worker is changed by these commands.

## Checking a claimed Up/Down strategy

`scripts/polymarket-strategy-audit.mjs` tests the strategies people post about short crypto Up/Down markets against public data. It reads only public Gamma and Data API endpoints and has no wallet, signing or order path.

```sh
node scripts/polymarket-strategy-audit.mjs trader --wallet <0x...> --days 7 --output <file.jsonl>
node scripts/polymarket-strategy-audit.mjs tape --asset btc --interval 5 --hours 72 --cache <dir> --output <file.json>
```

`trader` rebuilds every market a wallet traded in the window from its fills, splits, merges and the market's settlement. It reports gross and net PnL, the taker fees from each market's live fee curve, how much of the volume was maker versus taker, the pair cost VWAP(Up) + VWAP(Down) on markets where both sides were bought, how much of the profit those pairs explain versus the unmatched residual, loser shares sold before settlement, and the record of buys at 95¢ or more. Compare its totals with the account's published PnL for the same window before relying on it; a mismatch means missing rows.

`tape` replays three strategies on each market's full public taker tape, holding to settlement:

- **Maker pair**: resting bids on both sides from the open. A bid fills only when a print trades through it (a taker sell below it, or a taker buy of the other side above one minus it). Prints exactly at the bid fill a configurable share of the time, because queue position is unknown.
- **Late taker**: buy the leader on the first taker buy at or above a threshold in the final seconds, paying the print, a spread allowance and the taker fee.
- **Late maker**: a resting bid on the side leading shortly before the close.

The tape cannot see the order book, so it does not model latency, cancels or queue position, and maker rebates are shown only as an upper bound. A strategy that loses under these rules is not rescued by them; one that wins still needs a forward paper run.

## Live book recording and the forward test

The short crypto Up/Down markets settle on Chainlink's 60-second average before the close against its 60-second average before the open, not on the instantaneous close against the open. `scripts/polymarket-book-recorder.mjs` records the order books, the Chainlink feed and an exchange feed; `scripts/polymarket-book-replay.mjs` replays a recording with a fair value on that rule, a freshness guard for books that stop updating, and taker and queue-aware maker strategies at several latencies. `scripts/polymarket-kalshi-15m-scan.mjs` compares the matching Kalshi 15-minute market.

`scripts/polymarket-updown-forward.mjs freeze` registers a forward test once (strategies, pass criteria, fingerprints of the decision code); `score` replays recorded days and refuses to score if that code changed. `scripts/install-polymarket-updown-forward.sh` runs recording, scanning and daily scoring under launchd; `uninstall` stops them and keeps the data. A strategy is promoted to a live trial only if it trades at least 300 markets and is positive after fees, significant (t >= 2), positive on both Up and Down, on both 5m and 15m, and without its best market. Paper results never include our own order latency or fill rate; only a real order measures those.

## The London forward test

Polymarket's order books are served from London. A paired replay of the same markets recorded in London and
in Tokyo showed London seeing the book far sooner, but gaining nothing measurable, because the model's
trigger was Binance, which is hosted in Tokyo and reaches London late. The second forward test records from
a trade-edge node in London (see `docs/trade-edge.md`). It was meant to drive the model from a European
exchange feed, but measured from London, Binance still tracks Chainlink best: the European feeds arrive
sooner but trade far less often, and on their own they are worse than waiting for Chainlink. So the test
isolates London execution with Binance as the signal, and reports Coinbase and Kraken beside it.

- The node runs two workloads: `polymarket-book-recorder` (books, Chainlink, Binance) and
  `exchange-price-feeds` (`scripts/exchange-price-feeds-recorder.mjs`: Kraken, Coinbase and Bitstamp trades
  and top-of-book changes). The frozen v1 recorder is not changed.
- `scripts/polymarket-book-replay-feeds.mjs` merges the two by receive time and runs the replay's strategies
  once per feed, the fair value carried onto Chainlink by that feed. A taker decides on an event and fills
  only from the London book as recorded at decision + latency; latencies are 10 and 50 ms.
- It also measures how well each feed nowcasts Chainlink: the feed's latest price times the Chainlink/feed
  ratio, against Chainlink's price for the moment it was observed, with the last Chainlink price received as
  the baseline. The feed with the smallest error before the freeze drives the test.
- `polymarket-updown-forward.mjs freeze --profile london --feed <feed> --root <new root>` registers it: the
  primaries are the open-lag and close-call takers at 50 ms driven by that feed, the same strategies driven
  by each `--compare` feed are registered comparisons (reported, never promoted), and the pass criteria are
  v1's. The fingerprints cover both
  recorders, the feed parsers, the lead measurement, the replay and its reader.
- `scripts/install-polymarket-updown-forward.sh london` adds a daily job: pull from the node, score,
  prune node files older than three days, then `polymarket-updown-forward-london-finish.mjs`. That adds the
  node's running cost to the report, sends the operator a short summary on Telegram (markets so far, each
  primary's PnL, t and failing checks, cost), and once every primary has traded the registered number of
  markets deletes the node (`trade-edge down`, which pulls first), checks its resource group is gone and
  says so in the report and the summary. A failed delete is recorded as a failure, reported, and retried
  the next day; a failed pull or score sends a notice instead of a summary.

### Realistic-fill audit

Live orders are not an option from either place the test runs, so `scripts/polymarket-fill-realism.mjs`
re-judges the registered fills as a secondary audit; the registered verdict never uses it. It replays the same
post-freeze recordings, runs the primaries and comparisons exactly as registered, and for every taker fill:

- subtracts competitors' trades that hit the same ask after the decision, up to landing plus the London
  book's lag behind the matching engine (20 ms), without counting a trade twice when its book update had
  already arrived before the decision;
- removes what our own earlier takes consumed from a level until that level refills (the registered replay
  never consumes the book);
- calls a fill confirmed only when the trade tape shows someone buying at or below our price between the
  decision and two seconds after landing.

Each take is reported as confirmed, adjusted or refused, with naive, adjusted and confirmed-only PnL, the fill
rate, the refused share and the average price difference. One maker is also run seeing only trades: its
queue advances on prints at its price, never on a shrinking level. The daily job adds the result to the
report and as one labelled line in the operator's summary. It never fills more than the registered strategy
did at a level, so it cannot rescue a losing result.

## Verification and recovery

Run `node scripts/test-prediction-edge-research.mjs`, `node scripts/test-polymarket-strategy-audit.mjs`, `node scripts/test-polymarket-london-forward.mjs`, `node scripts/test-polymarket-fill-realism.mjs`, `node scripts/test-prediction-proper-learning-v2.mjs` and `node scripts/test-prediction-proper-betting-paper.mjs`. The edge suite is also registered in the fast test gate. Fixtures exercise the complete forward freeze/replay/score path, fee and depth sensitivity, approval/deadline boundaries, open-outcome exclusion and the market-copy placebo failure.

To stop shadow research, stop invoking its commands. Keep all artifacts, including failed candidates. V1 and V2 forecasting policies remain unchanged, and no shadow result changes the active champion. Instrumentation receipts are additive; no historical input or result needs deletion or rewriting.

Research foundations: [Gneiting and Raftery, proper scoring rules](https://sites.stat.washington.edu/people/raftery/Research/PDF/Gneiting2007jasa.pdf); [Bailey and López de Prado, selection bias and backtest overfitting](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf).
