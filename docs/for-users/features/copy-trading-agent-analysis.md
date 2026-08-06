---
title: "Agent-Analyzed Copy Trading"
---

# Agent-Analyzed Copy Trading

Agent-analyzed copy trading lets you compare an ordinary copy-trader with an isolated, research-assisted twin. The original configuration keeps its settings and positions. The twin watches the same wallet, uses the same sizing and safety limits, and records its own cash, positions, decisions, and results.

## What happens after a copied buy

The twin still mirrors the buy first, just as the original does. As soon as the token is known, it begins preparing current market, liquidity, contract or mint security, and prior target-wallet performance evidence while the fill completes.

Immediately after the fill, a fast safety gate checks objective evidence. A confirmed honeypot, inability to sell, non-transferable token, malicious creator, extreme sell tax, or critically thin liquidity can close the twin's position without waiting for a model. Upgrade, freeze, mint, metadata, holder-concentration, new-pool, and other caution signals are not treated as proof on their own.

All other trades go to GPT-5.6 Sol as the expert adjudicator. Sol receives the prepared evidence packet, current market data, prior target-wallet outcomes, and the fast-gate findings, then uses web search for current exploits, scam reports, project information, material news, and credible warnings.

The result is one of three decisions:

- **Keep** leaves the position open.
- **Close** exits only the twin's copied position when the empirically calibrated confidence meets that trade's threshold.
- **Uncertain** leaves the position open because the evidence was not strong enough.

Sol's stated confidence is calibrated only against completed earlier evaluation batches for the same twin. The current 50-trade batch cannot teach or grade itself. Wallet statistics, prior review examples, and retrospective lessons are filtered at the same batch boundary. With little history or missing security evidence, the close threshold becomes more conservative. If the model, network, or research step fails, the position stays open and the failure is recorded. An analysis failure never triggers a sale.

Model research is serialized outside the signal-detection loop. A slow or timed-out review therefore does not delay the twin's next wallet poll. Cooldowns use the target chain's block or slot ordering rather than local wall time, so model latency cannot by itself make the original and twin choose different copied signals.

## Reading the comparison

Each twin still shows the original return, agent-analyzed return, and current difference in percentage points from the moment the pair started. That live snapshot is useful, but it is not evidence that the policy should be promoted.

The card separately shows:

- **Learning evidence** progress toward 200 matured trade outcomes.
- The held-out **95% edge** interval when enough data exists.
- The held-out **absolute 95% return** interval and profit factor, so losing less than a losing original is not called success.
- Agent-analyzed and original maximum drawdown.
- Modeled execution costs, reviewed/kept/closed counts, and analysis failures.
- **Outcome retrospectives** that state what happened, which evidence tags were present, and what a later batch may test.

Open **Show data** to read the latest calibrated confidence, raw model confidence, close threshold, decision path, review summary, and source links.

Start in dry-run. A live twin performs a second real buy before analysis and may perform a real closing sale afterward, so it uses additional wallet funds, gas, and model/web-search usage. Creating a twin from a live source leaves the twin stopped until you explicitly start it.

## How EVO uses the results

Every reviewed fill records both paths at fixed 5-minute, 30-minute, 4-hour, and 24-hour horizons: what the original hold would have returned and what the evolved decision returned. It also records the target wallet's eventual sell as a variable target-exit horizon. Both paths include modeled network, venue, slippage, and liquidity-impact costs. Each paper buy retains its exact acquired amount. If a review closes an accumulated position, every still-open lot is closed at the same actual receipt price, while the review retains the whole-position proceeds, cost basis, execution cost, and profit or loss. If the daemon is unavailable long enough to miss a fixed horizon's bounded observation window, that horizon is marked missed instead of substituting a later price.

At 24 hours and at the target exit, the system writes a deterministic retrospective with the hold return, evolved return, paired edge, outcome classification, evidence tags, and a bounded lesson. Notes are local operational research state. Only aggregate lessons from earlier frozen batches enter later prompts; a note never edits the current policy or model weights by itself.

The policy is frozen under an explicit version and evaluated in chronological 50-trade batches. Calibration for a batch can use only matured earlier batches. EVO does not mark a policy eligible until it has all of the following:

- At least 200 cost-aware outcomes matured through 24 hours.
- A complete unseen 50-trade validation batch.
- A paired bootstrap whose 95% lower confidence bound is above zero.
- An absolute-return bootstrap whose 95% lower confidence bound is above zero.
- A held-out profit factor of at least 1.2.
- Maximum drawdown no worse than the original path.
- Agent-analyzed maximum drawdown no greater than 25%.
- No more than 5% failed-open Sol reviews in the held-out batch.

Failing a gate means **not eligible yet**; it never rewrites the original configuration. Passing all gates means **eligible for paper promotion**, not automatically promoted and never automatically live. Any later real-money use requires a separate explicit user decision and a new safety review.

EVO can improve the analyst prompt, evidence policy, calibration, and close policy in later experiments, while the source copy-trader, wallet signing rail, trade caps, and dry-run/live setting remain protected boundaries. This is walk-forward, evaluation-driven adaptation—not model-weight retraining and not a guarantee of profits. The continuous daemon can keep collecting paper evidence, but market regimes can change and no finite test proves future consistent profitability.

## Requirements and privacy

The analyst prefers an existing ChatGPT OAuth connection and falls back to `OPENAI_API_KEY` from the shared HivemindOS environment when API-key mode is selected. OAuth tokens and API keys stay in runtime credential storage and are never written into a copy-trading configuration or review. OpenAI's [GPT-5.6 Sol model](https://developers.openai.com/api/docs/models/gpt-5.6-sol) supports Responses API web search and structured outputs.

Token security reads use public GoPlus endpoints and fail open when evidence is unavailable; unavailable data alone never forces a sale. Web pages are treated as untrusted evidence. Their instructions are ignored, and only bounded review summaries, public source links, compact evidence flags, and evaluation outcomes are retained in copy-trading state.
