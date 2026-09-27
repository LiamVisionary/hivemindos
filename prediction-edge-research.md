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

## Verification and recovery

Run `node scripts/test-prediction-edge-research.mjs`, `node scripts/test-prediction-proper-learning-v2.mjs` and `node scripts/test-prediction-proper-betting-paper.mjs`. The edge suite is also registered in the fast test gate. Fixtures exercise the complete forward freeze/replay/score path, fee and depth sensitivity, approval/deadline boundaries, open-outcome exclusion and the market-copy placebo failure.

To stop shadow research, stop invoking its commands. Keep all artifacts, including failed candidates. V1 and V2 forecasting policies remain unchanged, and no shadow result changes the active champion. Instrumentation receipts are additive; no historical input or result needs deletion or rewriting.

Research foundations: [Gneiting and Raftery, proper scoring rules](https://sites.stat.washington.edu/people/raftery/Research/PDF/Gneiting2007jasa.pdf); [Bailey and López de Prado, selection bias and backtest overfitting](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf).
