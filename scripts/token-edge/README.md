# Prospective on-chain token-edge research

This is a research-only, forward-observation harness for the Token Autopsy
predictor. It tests the on-chain information that the historical LunarCrush
replay could not reconstruct:

- real holder and unique-trader growth between snapshots;
- fresh-wallet and smart-trader netflow;
- buyer/seller dollar flow;
- top-holder concentration and whether it is increasing;
- selective profitable-wallet accumulation;
- unrealized-profit and still-holding supply overhang.

It does not trade, place orders, read wallets, mutate the Token Autopsy scorer,
or declare an edge from an open forecast.

## Frozen experiment

Each snapshot writes fifteen immutable v3 forecasts: five candidate models at
1h, 6h, and 24h. It also writes one forecast for each of seven registered
one-change challengers, v4 through v10, for twenty-two total forecast events.

1. `market-only-control` uses public DEX market/transaction data.
2. `smart-money-selection` is a frozen rise call available only when the ledger
   can prove a Nansen discovery row passed both the existing screener gates and
   a linked deepest-pool DEX confirmation.
3. `authentic-buyer-growth` adds holder growth, change in rolling unique-buyer
   activity, complete-window buy/sell volume, separately sampled top-buyer and
   top-seller flow, and current Fresh Wallet/Smart Trader net flow.
4. `supply-profit-overhang` adds concentration, accumulation, and PnL-overhang
   aggregates.
5. `combined-onchain` requires all three component arms.

The first v4 challenger is `smart-money-liquidity-cap`. It is evaluated only
inside verified Nansen 6h selections and only at the 1h horizon. It changes one
decision dimension from the v3 `smart-money-selection` parent: trade when the
current deepest-pool liquidity is at most $50,000, otherwise remain in paper
cash. The existing $10,000 market-eligibility floor remains unchanged. The rule
is explicitly post-hoc-derived from evidence through
`2026-08-03T00:04:55.356Z`; snapshots at or before that boundary fail closed and
cannot enter its scorecard. The linked Nansen discovery and DEX confirmation
must also both be strictly later than the boundary, preventing a pre-boundary
selection cohort from being relabelled as prospective merely by collecting its
snapshot later. The immutable challenger-registration event must also already
exist. Its `registeredAt` must be strictly earlier than the discovery,
confirmation, and snapshot timestamps; otherwise the v4 forecast fails closed.
Every eligible forecast stores the registration id and timestamp so this
pre-registration exclusion is independently auditable. The paired scorecard
also re-resolves that exact frozen registration from the ledger and rejects a
forecast whose stored id, timestamp, or forecast time does not match it; a
collection-time check alone cannot admit evidence. It then reconstructs the
referenced discovery, eligible-token row, linked eligible DEX confirmation,
snapshot, provider/timeframe, asset identity, and strict timestamp order from
the ledger. Missing or copied-only source lineage is counted and excluded from
paired PnL.

Every future v4 outcome is paired to the v3 parent forecast from the same
snapshot. Cash decisions score zero, while long decisions pay the same frozen
4% friction as the parent. The comparison uses independent equal-weight frames
and a 10,000-sample circular-block bootstrap over challenger-minus-parent
return. Even an absolutely profitable challenger cannot become audit-eligible
unless it also beats its parent on at least 252 future independent paired
frames, 30 tokens, a positive paired bootstrap lower bound, and every absolute
payoff gate. This shadow experiment cannot mutate v3 or authorize execution.

The v5 challenger is `smart-money-exact-mint-social-move-gate`. It preserves
the same v3 `smart-money-selection` direction call, Nansen 6h cohort, 1h
horizon, and cost policy. Its sole intervention is abstention unless LunarCrush
also reports a frozen attention breakout. Identity is never inferred from a
symbol or topic: the complete LunarCrush coin list must contain exactly one
Solana `blockchains[].address` equal to the candidate mint. Untracked or
multiply mapped contracts fail closed and do not enter the paired comparison.
Do not replace this with `/coins/<mint>/v1`: a live subscribed-tier probe
resolved both the exact NEEGY mint and its all-lowercase mutation to the same
coin id even though Solana addresses are case-sensitive. That endpoint can be
a discovery hint, but it cannot prove canonical Solana identity.
The collector retains only completed contiguous hourly rows and compares the
latest hour with the previous 24. The frozen move alert requires at least two
of interactions, active posts, and active contributors to clear their
registered abnormal-activity thresholds, plus either AltRank at most 100 or
Galaxy Score at least 70. Sentiment is recorded but is not used for direction.

Every ready v5 forecast links the signed `lunarcrush-social-snapshot` event,
its digest, rule version, exact coin id and contract, completed-hour boundary,
provider generation time, collection start, evidence-availability time, and
social features. Evidence must be available before the forecast, may lag the
decision by at most five minutes, and the decision timestamp must be no earlier
than both response availability and the provider generation timestamp. The
collector raises the future decision floor to the latest of those clocks; it
does not backdate a forecast when provider time rounds ahead of the local
response clock. DEX market evidence in new collections is stamped when its
response is locally available, and the later forecast decision cannot precede
that market timestamp. Evidence must contain only bars completed at the
collection cutoff. The paired scorer independently reconstructs that event
and rejects missing, ambiguous, pre-registration, mismatched-mint,
current-hour, post-forecast-available, stale-collection, or wrong-rule event.
Coverage is intentionally partial: a
LunarCrush topic response without a canonical contract match is unusable. This
tests the previously registered “large-move alert, then independent on-chain
direction” hypothesis; it does not reinterpret historically unsuccessful
social-only direction models as an edge.

The v6 challenger, `frozen-onchain-rank-v6-lunarcrush-next-day-move-gate`,
changes only the evaluation horizon of that cross-provider architecture. It
keeps exact-mint identity, the same completed-hour move alert, the same Nansen
6h direction parent, and the same cost/capacity policy, but pairs against the
parent's 24h forecast. This horizon transfer was frozen only after the first
availability-valid v5 batch resolved: NEEGY fell 9.961449% gross, so v5 paper
cash improved by 13.961449 percentage points over its parent long after 4%
friction. That is one paired frame, not an edge. V6 uses evidence boundary
`2026-08-03T05:01:06.416Z` and registration
`challenger_registration_c019c902241311db7bffc678`; forecasts, discovery,
confirmation, or social evidence at or before the boundary or registration
cannot count. The 24h transfer is motivated by the separately confirmed role
of LunarCrush as a next-day absolute-move alert, not by a claim that it predicts
direction.

The v7 challenger, `frozen-onchain-rank-v7-pair-age-window`, keeps the v3
`smart-money-selection` parent, verified Nansen 6h cohort, one-hour horizon,
and cost policy. Its sole intervention is to follow the parent long only when
the deepest DEX pair is at least 2 hours but under 24 hours old; every other
ready parent call remains in paper cash. The hypothesis is deliberately marked
post-hoc and winner-dominated. Through evidence boundary
`2026-08-03T05:30:12.742Z`, the 6h/age-window seed contained only three observed
forecasts and three tokens, all net winners after 4% friction, with mean
+59.815360% and one +145.818762% winner. A parallel 24h-selection observation
inside the same age window lost 7.144928% net. The equal-weight policy
counterfactual is far weaker than the three traded rows imply: across all 13
historical Nansen 6h frames it improved over the parent by only 1.816517 points;
it trailed by 0.159255 points on the first six frames and improved by 3.510035
points on the later seven, with only three traded frames in total. None of
those four inside-window observations
can enter v7: its registration, Nansen discovery, linked DEX confirmation, and
snapshot must all be strictly later than the boundary and registration. The
paired scorer recomputes pair age from the immutable snapshot and rejects
stored age, bounds, or cash/long decisions that do not match the frozen rule.
This is a prospective falsification test, not evidence that pair age predicts
profit.

The v8 challenger, `frozen-onchain-rank-v8-lunarcrush-social-discovery`, is the
first social-first treatment. It does not inherit a Nansen direction call. Its
parent is the same-snapshot 1h `market-only-control`, and its sole intervention
is a paper-long call for an exact Solana contract selected from a complete
LunarCrush coin-list response by the frozen
`lunarcrush-solana-social-discovery-v1` rule. The rule requires market cap from
$50,000 inclusive to $5 million exclusive, at least $20,000 24h volume, 500
interactions, 10 social posts, AltRank at most 200 with at least 1,000 ranks of
improvement, Galaxy Score at least 50 with at least 10 points of improvement,
and anti-chase bands of -10% inclusive to +10% exclusive over 1h and -20%
inclusive to +30% exclusive over 24h. At most six candidates are ordered by
AltRank, Galaxy improvement, and interactions before separate DEX confirmation.

The thresholds were frozen at evidence boundary `2026-08-03T06:37:48.300Z`
from one current cross-section of 5,463 LunarCrush rows, including 2,161 exact
Solana contracts and 74 candidates under a deliberately broader exploratory
screen. No future return was observed or used. Current candidates and every
pre-registration discovery are excluded; only later response-available
discoveries, linked DEX confirmations, forecasts, and one-hour resolutions can
count. The scorer rejects missing response availability, incomplete-universe,
wrong-rule, threshold-edited, provider-mismatched, or decision-edited lineage
and reconstructs the exact retained Lunar metrics. This is a prospective test
of social discovery, not a claim of predictive or profitable value.

After exact-mint histories, at most two spare requests collect aggregate creator
attention for the highest-ranked v8 topics that map to exactly one provider coin
row; ambiguous topics fail closed without a request. Any remaining budget
collects their completed hourly histories. Creator responses are reduced to breadth,
interaction concentration, median followers, and network counts. Raw creator
identities are not retained. The signed history follow-ups retain active posts,
active contributors, interactions, AltRank, Galaxy Score, sentiment, spam, and
social dominance. Both evidence types link to the exact discovery event and are
observational only: they cannot change v8 or enter its scorecard. A later
creator-quality challenger must register a new rule and use only later outcomes.

Every universe response after `2026-08-03T07:45:35.842Z` also retains a bounded
observation-only panel of at most 100 exact, uniquely mapped Solana contracts.
Its broader fixed rule keeps price and the same social/rank fields for later
hourly joins. Fifteen coarse screens were declared before the first panel:
AltRank improvement, Galaxy improvement, post breadth, interactions per post,
dual improvement, price-lagged improvement, high-breadth dual improvement,
active-contributor acceleration, and combined interaction/post/creator
breakout, distributed or concentrated creator attention, mid-tail creator
swarms, creator interaction depth, creator breadth acceleration, and declining
creator concentration. The scorecard equal-weights each hourly frame and
reports 4% and 12% cost proxies, but LunarCrush provider price is not executable
depth or a fill. These screens are a multiple-testing family for later
correction. The panel can generate a future-only hypothesis; it cannot enter
v8, promote itself, or support a profit claim.

Adjacent provider-price observations also fail closed when their retained
market-cap/price pairs imply more than a twofold change in token supply within
the 45-to-90-minute join window. This is a data-integrity guard, not a trading
screen. It removes a one-snapshot SAN price discontinuity that implied a
76.85x supply change and fabricated a +7,431% hourly return before immediately
reverting; rejected transitions are counted in the scorecard.

The v9 challenger, `frozen-onchain-rank-v9-hourly-turnover-gate`, keeps the
verified Nansen 6h `smart-money-selection` parent, entry, one-hour horizon, and
cost policy. Its only change is to follow the parent long when trailing DEX 1h
volume is at least 0.5 times the current deepest-pool liquidity; otherwise it
holds paper cash. The gate was selected post-hoc from 160 one-dimensional
variants on only 18 capacity-eligible forecasts, five independent frames, and
seven tokens through evidence boundary `2026-08-03T09:09:51.511Z`. Its seed
used seven trades across four frames and four tokens, with +1.182082% base-cost
frame mean but -1.964584% under the 12% stress cost. This multiple-tested,
stress-failing seed is not an edge. The registration, Nansen discovery, linked
DEX confirmation, snapshot, and outcome must all be strictly later than the
boundary and registration. The paired scorer independently recomputes hourly
volume divided by entry liquidity and rejects stored inputs, threshold, or
cash/long decisions that do not match the frozen rule. Registration
`challenger_registration_4f4e3b337a7c56d92a3e973b` was sealed at
`2026-08-03T09:19:33.669Z`; its real scorecard starts with zero prospective
matches. A subsequent leave-one-frame-out derivation audit did not change the
rule and averaged -1.887970% on held-out frames, with one positive holdout and
two no-trade holdouts. That further weakens the seed while preserving v9 as an
honest prospective falsification test. Under the later shared earliest-mint
frame correction, the same derivation gate falls to +0.871735% base-cost mean
and -2.061599% stress mean over five weighted trades; the registration metadata
continues to preserve the original seven-row derivation calculation.

The v10 challenger, `frozen-onchain-rank-v10-social-magnitude-direction`,
tests a narrower role for LunarCrush. It keeps the verified Nansen 6h parent as
the only direction source and follows that parent long only when a complete,
fresh LunarCrush coin-list response also selected the exact Solana mint under
the already frozen v8 discovery rule. An absent token in an otherwise complete
response is a ready paper-cash decision; missing, incomplete, stale, edited, or
pre-registration evidence fails closed. The one-hour Lunar response may be no
more than one hour old, and both provider lineages must be strictly later than
boundary `2026-08-03T09:47:45.300Z` and registration
`challenger_registration_3bf7b83028e6eb1976f8cbbf` at
`2026-08-03T09:51:45.694Z`.

This target architecture was frozen only after a post-hoc diagnostic on 49
prospective larger-cap frames found that clean-social and provider-social
selections moved about 0.08 percentage points more in absolute value than the
graph-only selections, with paired 10,000-resample intervals above zero. That
is a target switch from direction to magnitude, not profit proof. The
post-registration serial-dependence sensitivity also stayed above zero under a
seven-frame circular-block bootstrap: [+0.011187, +0.159242] percentage points
for clean social and [+0.003295, +0.160042] for provider social. These narrower
lower bounds are a robustness diagnostic only and do not alter the sealed
registration or make the treatment profitable.
The already-observed OnlyMarms path and all other pre-registration outcomes are
explicitly excluded. V10 starts from zero prospective matches and must pass the
same paired, absolute payoff, capacity, stress, independence, and concentration
gates as every other challenger.

The v14 challenger, `frozen-onchain-rank-v14-dex-positive-momentum-gate`,
tests a sign-only falling-knife filter on the verified Nansen 6h parent. It
changes one decision field: follow the parent one-hour rise call only when the
independently observed DEX one-hour price change is strictly above zero;
otherwise hold paper cash. Missing momentum blocks rather than guessing. Its
evidence boundary is `2026-08-03T13:18:00.000Z`, and registration
`challenger_registration_fe39a8a0d18c4de605f3b1f4` was sealed at
`13:20:47.032Z`. The rule was frozen after 24 of 34 unique missed-explosion
opportunities co-occurred with positive entry momentum, a separate one-frame
buy-pressure monitor avoided one large loss, and the excluded SHIPY V11 row
fell 36.149284% gross after entering at -5.9% hourly momentum. These are
post-hoc clues, not discrimination or profit evidence. The threshold was not
optimized beyond its sign, and every inspected or already-open forecast is
excluded. The paired scorer recomputes the exact market field and decision;
stored-input or decision tampering is rejected.

The v15 challenger,
`frozen-onchain-rank-v15-lunarcrush-creator-distribution-gate`, layers one
future-only creator-quality decision onto the unchanged v8 LunarCrush social
discovery. V8 already requires exact Solana contract identity, interactions,
social volume, improving AltRank and Galaxy Score, small-cap liquidity, and
anti-chase bounds. V15 follows that parent only when an aggregate-only creator
event from the same discovery reports at least 10 creators, top-creator
interaction share no greater than 50%, and creator-interaction HHI no greater
than 0.35; otherwise it holds paper cash. Missing or late creator evidence
blocks rather than being treated as concentration. No creator identities are
retained.

Boundary `2026-08-03T16:17:30.000Z` and registration
`challenger_registration_e969ca9b7e60cbdd07518eb6` at `16:24:03.369Z`
exclude the inspected FAUCI and MINI aggregates, FAUCI's open forecast and
path, every earlier discovery, and all later outcomes from those rows. The
three round distribution bounds were composed as one creator-structure
hypothesis without inspecting an associated outcome. Independent scoring
reconstructs the v8 parent, exact discovery, contract/topic join, creator
aggregate digest, availability window, privacy flags, thresholds, and paper
decision. V15 starts with zero eligible outcomes and cannot authorize trading.

The v16 challenger, `frozen-onchain-rank-v16-lunarcrush-age-unbounded`, tests
one coverage change to v8: it removes only the generic DEX market-control
blocker for pairs older than 30 days. The $10,000 liquidity floor, $1,000
one-hour volume floor, 15-minute minimum age, +25% one-hour and +150% 24-hour
anti-chase ceilings, exact Lunar contract/discovery lineage, and one-hour
prediction remain unchanged. Entry collection additionally requires the
token-pairs and token-batch DEX endpoints to agree within the frozen 1.10
price and 1.25 liquidity ratios and retains the lower quote. All other market
blockers still fail closed.

Boundary `2026-08-03T19:07:22.300Z` and registration
`challenger_registration_3a61ebd50d2678128244ef7e` at `19:11:28.924Z`
exclude MINI and ALTSZN, their `19:01` discovery/history, the inspected
old-pair confirmation, and every associated later outcome. ALTSZN had one
exact-mint Lunar large-move alert and enough DEX liquidity/volume but was
blocked solely by the 30-day ceiling; no outcome existed at freeze time.
That is coverage provenance, not payoff evidence. Only a later discovery,
age-aware confirmation, dual-endpoint entry, forecast, and exact live outcome
can enter v16. Its paired report deliberately scores only the incremental
population where v8 was blocked by exactly the removed age ceiling; ordinary
pairs where v8 and v16 make the same long decision are counted as unchanged
population and excluded from the causal comparison. For an incremental row,
the v8 baseline is paper cash and the v16 return uses the challenger's own
exact outcome. The scorer independently reconstructs the alternate
confirmation status, sole removed blocker, age, lower dual-endpoint entry,
and frozen decision. The challenger remains paper-only and cannot authorize
trading.

The v11 challenger, `frozen-onchain-rank-v11-dex-early-surface`, moves candidate
acquisition earlier than either social or smart-money ranking. It polls DEX
Screener's latest token profiles, community takeovers, ads, recent boosts, and
top boosts, resolves exact Solana mints to their deepest base-token pools, and
then requires a separate linked DEX confirmation. Its frozen
`dexscreener-early-surface-v1` rule accepts pairs aged 15 minutes through 72
hours, liquidity of at least $10,000, market cap from $50,000 through
$5,000,000, hourly volume of at least $1,000, one-hour price change from -20%
through +25%, and 24-hour price change from -50% through +150%. Eligible rows
are ranked by source breadth, boost amount, turnover, and pair age. Descriptions
and raw links are not retained; only bounded source types, recency, boost,
website/Twitter presence, and market aggregates enter the ledger.

V11 changes acquisition only versus the same-snapshot `market-only-control`
parent and makes a fixed paper-long one-hour call. Its boundary is
`2026-08-03T11:14:00.000Z`; registration
`challenger_registration_fbee8d260c76808e65c5a1a3` was sealed at
`11:15:04.922Z`. The 99-token, four-candidate discovery used to define the rule
is excluded, as are two rule-construction-blocked cohorts. Two ready forecasts
at `11:17:36.146Z` lacked the generic provider/discovery identity fields needed
for independent reconstruction and remain paired-lineage rejections. The first
paired-scorer-accepted untouched snapshot is Buddy at `11:25:40.921Z`;
forecast `forecast_41d1bbcb9e427213c083cec3` was sealed at `11:25:41.108Z`
and is due at `12:25:41.108Z`. A later untouched surface sealed 3place and
Buddy forecasts due at `12:33:22.694Z` and `12:33:22.722Z`. Paid boosts are
discovery metadata, not organic-social proof.
Absolute capacity payoff, same-snapshot paired delta, source-type breadth,
stress, and winner concentration all remain mandatory.

V12 and V13 transfer the exact same acquisition signal to 6-hour and 24-hour
outcomes without changing its source, rule, rank order, direction, or +6.4%
magnitude prediction. Their shared boundary is `2026-08-03T11:46:00.000Z`;
registrations `challenger_registration_2d014c4db32f1a4815fd57da` and
`challenger_registration_87028ca68f606c63fdc830db` were sealed at
`11:48:08.887Z`. Thirteen open V11 path events existed before the freeze but no
V11 outcome had matured, and every earlier event is excluded. The first clean
3place/Buddy V12 outcomes are due around `17:48:28Z`; V13 is due the next day
around `11:48:28Z`. Each arm is scored only against its same-snapshot,
same-horizon market-control parent and needs the full independent promotion
gate.

The first real post-registration collection exposed and preserved a blocked
forecast because the freshly appended complete discovery was not passed from
the collector to the challenger constructor in the same run. The collector now
passes complete, availability-valid discovery events alongside exact-token
social snapshots and may reuse them without another provider request while the
one-hour freshness rule holds. A same-entry-path regression covers both cases.
The first valid v10 forecast, `forecast_a082880f71b32b5028acea79`, was sealed at
`2026-08-03T10:05:09.603Z`: Nansen called OnlyMarms up, but the complete social
universe did not select its exact mint, so v10 chose paper cash. The exact live
one-hour outcome was +17.863532% gross and +13.863532% after the frozen 4%
flat cost, so this first valid row is evidence against v10's magnitude gate.
It is still one overlapping token/frame and cannot support threshold tuning.

The separate `nansen-selected-organic-activity-monitoring-v1` family tests the
course-derived distinction between real participation and raw volume. It keeps
the verified Nansen 6h smart-money parent as direction and observes five fixed
gates: sampled net buyer pressure; distributed sampled buyer/seller flow;
repeat-trader depth; low profit overhang; and a strict consensus that also
requires distributed supply, balanced sampled-holder accumulation, and broadly
positive selective-wallet netflow. It requires a `full` aggregate-only Nansen
profile, a prospectively linked execution policy, same-pair entry/exit depth,
and an exact live one-hour result. Raw wallet identities are never retained.

This family begins strictly after `2026-08-03T10:29:37.100Z`. Its derivation
debt is explicit: all nonempty screens lost after 4% and 12% costs on 14
one-hour and five six-hour independent frames. Next-day variants looked
positive across only two frames, but the later frame was a +68.435712% NEEGY
winner and the composite selected only that one token. Therefore no organic
screen is a challenger. Future monitoring must report absolute payoff, paired
delta versus the unchanged parent, AMM impact, stress, overlap, token breadth,
and winner concentration; it can only generate a later one-change hypothesis.
The boundary deliberately excludes the first selected full-profile OnlyMarms
disagreement at `10:28:55.760Z`. It later returned +5.820589% gross,
+1.080991% under the capacity model, and -6.919009% under 12% stress. The
smart-money direction was correct while every abstaining full-profile arm
missed the move, but the snapshot is 42.34 seconds before the boundary and
cannot validate the monitor designed after seeing it.

The first predeclared organic screen to survive a later bounded audit is now a
separate future-only child:

```sh
node scripts/token-edge/onchain-organic-activity-monitoring-scorecard.mjs \
  register-buyer-pressure --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-organic-activity-monitoring-scorecard.mjs \
  score-buyer-pressure --ledger /absolute/research/path/ledger.jsonl
```

Rule `nansen-selected-sampled-net-buyer-pressure-v1`, boundary
`2026-08-04T06:23:28.942Z`, and registration
`monitoring_policy_registration_15f1fe1b47b1ac148d0f1174` at
`06:29:02.065Z` keep the Nansen 6h Smart Money parent and change only the paper
decision: long when a complete `full` aggregate reports sampled top-buyer
dollars at least sampled top-seller dollars, otherwise cash. The inclusive
ratio-one threshold was declared in the earlier monitoring family before its
outcomes. A later audit found only two selected observations across two tokens
and two traded frames, `+7.127933%` base and `+3.127933%` stress frame payoff,
with one winner supplying every gain. Those rows and every forecast open at
registration are excluded; they motivate falsification, not an edge claim.
The child starts at zero and requires 252 later observations and frames, 30
traded tokens, 50 trades, 64 traded frames, positive absolute and paired block-
bootstrap lower bounds, positive stress payoff, profit factor at least 1.2,
drawdown at most 25%, and winner share at most 35%. Registration and scoring
make no provider call. Any future `full` Nansen collection still needs its own
explicit attempted-credit ceiling; this rule cannot spend, backfill, mutate,
promote, or trade.

The separate `nansen-selected-dex-buy-pressure-monitoring-v1` family keeps the
same Nansen 6h smart-money parent and asks one coarse entry-time question: were
hourly DEX buys at least hourly sells while the hourly price change was
positive? Its derivation used 21 exact live outcomes reduced to 13 independent
asset observations across five frames. The screen selected only three
observations in two traded frames and three tokens. It averaged +0.999067%
after the registered 4% capacity model and was positive in both chronological
halves, but averaged -0.334266% under 12% stress and one frame supplied
70.5446% of winning profit. This is therefore a monitoring hypothesis, not an
edge claim or challenger. Its clean boundary is `2026-08-03T10:45:30.000Z`;
all outcomes inspected to derive it are excluded.

A stricter predeclared screen also requires trailing hourly volume to be at
least half of entry liquidity. It selected only NEEGY and TRUCKER across two
traded frames, averaging +1.202057% under base capacity and +0.268724% under
stress, positive in both halves. However, it has only two tokens and 75.5187%
winner concentration. It remains in the same multiple-screen monitoring
family, cannot be promoted, and must earn independent future breadth.

Net-PnL promotion has a second, separately registered execution-capacity gate.
Its frozen paper policy assigns $100 to each token, keeps the 4% base friction
and 12% stress friction, and estimates entry and exit price impact with a
conservative symmetric-reserve constant-product pool. Each qualifying forecast
must be created strictly after the execution-policy registration and stores its
exact registration id, timestamp, and policy version. Its live resolution must
also preserve the entry and exit deepest-pool address, liquidity, and
point-in-time observation timestamp. Missing, mismatched, non-positive, or
post-hoc-added liquidity fails closed. Forecasts made before registration stay
valid for direction and the original flat-cost scorecard, but never qualify for
capacity-adjusted PnL. A registered challenger must also pass the same
reconstructed registration, source-evidence, provider-availability, and frozen
decision checks used by its paired scorer; a lineage-rejected challenger cannot
inflate capacity sample size, frame count, or token coverage even when its
shadow decision was cash. Historical OHLCV recovery lacks point-in-time exit
depth and therefore remains outcome evidence only. This added gate does not
alter a challenger rule or retroactively make an excluded cohort eligible.

The on-chain arms fail closed on their first snapshot because growth requires a
point-in-time prior observation. The `full` Nansen profile is also required for
the supply/PnL arm. It also retains aggregate-only sampled buyer/seller volume
concentration (top share and HHI) plus median/mean top-PnL trade count so later
frozen tests can distinguish broad paid activity from one-wallet noise and
one-off wins. These additive observations do not alter any current decision.
Nansen wallet addresses, entity names, and labels are never written: only
derived counts, ratios, sums, and medians enter the ledger.
Market-control input evidence also retains pair age in hours so a later frozen
test can separate new-pair and migrated-token regimes without retroactively
reconstructing age or changing the current 15-minute-to-30-day eligibility
window.

The v3 score-to-return mapping is deliberately frozen and simple. Its 1h, 6h,
and 24h magnitudes use separate fixed scales centered on the same rise threshold;
a predicted non-rise can no longer carry a positive return estimate. It is a
baseline to falsify, not a calibrated price target. Scorecards separate model
versions, so v1 and v2 observations remain immutable but cannot contaminate v3.
The selection arm uses a fixed 0.60 rise probability and 6.4%/12.8%/19.2%
return estimates at 1h/6h/24h. Those values are preregistered calibration
baselines, not tuned claims. Evolution remains blocked until one
model-version/arm/horizon has at least 252 matured forecasts, 252
non-overlapping signal frames, at least 30 tokens, 50 rise calls, and 64
independent traded frames. A payoff candidate must also have a positive
10,000-sample circular-block-bootstrap lower bound, profit factor of at least
1.2, drawdown no greater than 25%, no winning frame supplying more than 35% of
all gains, and positive average return under 12% round-trip stress.
Multiple tokens or repeated scans inside one horizon remain visible as raw
forecasts but cannot manufacture independent evidence. Within an independent
frame, only the earliest signal for each exact asset identity receives portfolio
or capacity weight; later overlapping scans remain diagnostic rows. Solana mint
case is preserved, while case-insensitive address families are normalized. The
flat-payoff, paired-challenger, registered-capacity, and sampled-exit scorecards
all use this same rule, so repeated scans cannot overweight one token or paper
capital. A passing provisional
payoff gate still requires the full HAC, BH-FDR, PBO, timing-placebo,
deflated-Sharpe, factor, regime, and degradation audit. It only permits an
isolated frozen audit; it never authorizes a live trade or automatic policy
mutation.

## Commands

Seal every source-registered shadow challenger into the append-only ledger
before collecting its first eligible selection. The command is idempotent; the
event id hashes the complete rule and paired-evaluation policy rather than the
wall-clock registration time.

```sh
node scripts/token-edge/onchain-forward-research.mjs register-challengers \
  --ledger /absolute/research/path/ledger.jsonl
```

Register the frozen execution-capacity policy before collecting any forecast
that may later support a realistic-net-PnL claim. This command is also
idempotent; changing notional, friction, impact model, or promotion thresholds
requires a new policy version and future cohort.

```sh
node scripts/token-edge/onchain-forward-research.mjs register-execution-policy \
  --ledger /absolute/research/path/ledger.jsonl
```

Create an immutable one-credit Nansen Smart Money discovery cohort first. The
harness post-filters out thin, old, already-exploded, negative-netflow, and
sell-dominant rows instead of weakening the later forecast gates:

```sh
hive-env-run -- node scripts/token-edge/onchain-forward-research.mjs discover \
  --chain solana \
  --timeframe 1h \
  --max-nansen-credits 1 \
  --ledger /absolute/research/path/ledger.jsonl
```

The screener timeframe is part of the recorded selection arm. The command
enforces the live cadence itself: 5m can run once per 15-minute UTC bucket,
10m/1h/6h once per clock hour, and 24h once per UTC day; a duplicate returns the
existing discovery id, zero actionable candidates, and spends zero credits.
Every nominal candidate must then pass a separate, durable DEX
confirmation because the provider's `price_change` field can disagree with the
deepest executable pool:

```sh
node scripts/token-edge/onchain-forward-research.mjs confirm \
  --chain solana \
  --tokens TOKEN_A,TOKEN_B \
  --source-event-id DISCOVERY_ID \
  --ledger /absolute/research/path/ledger.jsonl
```

Use an explicit token cohort so the selection source is known:

```sh
node scripts/token-edge/onchain-forward-research.mjs collect \
  --chain solana \
  --tokens TOKEN_A,TOKEN_B \
  --selection-confirmation-id CONFIRMATION_ID \
  --ledger /absolute/research/path/ledger.jsonl
```

Enable the exact-mint LunarCrush v5/v6 treatments only on the verified Nansen 6h
cohort. The Individual plan's ten-request ceiling is explicit: the collector
uses the complete paginated coin list for address proof, then spends only the
remaining requests first on requested exact-mint histories, then at most two
unique-topic creator aggregates, and finally on highest-ranked v8 candidate
histories. With the currently observed 5,463-coin universe that is six list
calls and at most four bounded evidence calls per run.
The same complete response creates one signed v8 social-discovery event without
another LunarCrush request. All baseline forecasts still record if LunarCrush
is unavailable, while v5-v8 fail closed and report the provider error.
If an independently scheduled Lunar response already recorded exact-mint
evidence for the requested token, a later collector may reuse it without a
provider call only when both response availability and provider generation
precede collection; the frozen v5/v6 five-minute freshness check still applies.

```sh
hive-env-run -- node scripts/token-edge/onchain-forward-research.mjs collect \
  --chain solana \
  --tokens TOKEN_A,TOKEN_B \
  --selection-confirmation-id CONFIRMATION_ID \
  --lunarcrush-profile exact-mint-hourly \
  --max-lunarcrush-requests 10 \
  --ledger /absolute/research/path/ledger.jsonl
```

Do not enable this profile independently on every discovery timeframe. The
registered v5/v6 cohort is 6h only, and repeating six-page universe reads on 5m,
10m, and 1h controls would waste the 2,000-request daily Individual allowance
without creating scoreable v5 evidence. For v8, confirm the candidates in the
signed `lunarcrush-coin-list` discovery event, then collect them with that
confirmation id and `--nansen-profile off`; the next Lunar universe response
must wait for the next scheduled source batch rather than being fetched again.

If the hourly Nansen 6h batch has no confirmed token and therefore makes no
exact-mint call, collect the independent v8 universe once for that UTC hour.
The command preflights the ledger and spends zero requests when the exact-mint
path already appended that hour's discovery:

```sh
hive-env-run -- node scripts/token-edge/onchain-lunarcrush-discovery.mjs \
  --max-lunarcrush-requests 10 \
  --ledger /absolute/research/path/ledger.jsonl
```

Poll the earlier DEX surfaces at most once per five-minute UTC bucket:

```sh
node scripts/token-edge/onchain-dex-early-surface-discovery.mjs \
  --ledger /absolute/research/path/ledger.jsonl
```

A repeat inside the bucket returns `skipped-existing-cadence` with zero
requests. Each discovery preserves every frozen-rule candidate, but its
`actionableCandidates` excludes an exact token while a V11 one-hour rise
forecast remains open or while an earlier discovery already retained the same
source signature: source types, source timestamp, boost amounts, and website/X
presence. Market-price changes alone do not create a new source signal. A
resolved token becomes actionable only after the source signature changes.
For a newly recorded discovery only, pass its actionable exact mints to
`confirm --source-event-id DISCOVERY_ID`, then collect the confirmed set with
`--selection-confirmation-id CONFIRMATION_ID --nansen-profile off
--lunarcrush-profile off`. Never reuse a pre-registration discovery for v11.

The DEX early-surface monitoring panel freezes eleven post-hoc screens without
changing V11: transaction buy pressure, entry momentum, their conjunction,
turnover, buy-pressure/turnover, pair age, boost backing, source breadth,
website/X presence, lower entry momentum, and an early-flow consensus. Register
the exact family once, then score it after later V11 outcomes mature:

```sh
node scripts/token-edge/onchain-dex-early-monitoring-scorecard.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-early-monitoring-scorecard.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Boundary `2026-08-03T12:15:00.000Z` and registration
`monitoring_policy_registration_900619f3f13c4d2be535a51f` exclude every V11
forecast and open path already inspected. Source forecasts must pass the
independent V11 registration/evidence/decision reconstruction, exact live
timing, return arithmetic, same-pair capacity evidence, and registered 4%/12%
cost policy. Each screen is paper cash when false and is reported against the
unchanged V11 paper-long parent with independent asset-frame weighting. It is a
multiple-testing hypothesis panel and cannot promote, mutate, or trade.

Because source-signature novelty intentionally yields few V11 forecasts, a
separate pulse monitor samples every currently eligible surface candidate once
per 15-minute UTC bucket. It changes neither V11 nor the frozen screens: the
parent paper-longs every sampled token, while each screen holds cash when false.

```sh
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs capture \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs resolve \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs mark \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Boundary `2026-08-03T12:30:00.000Z` and registration
`monitoring_policy_registration_d57ea842222d1ee55a1f8039` exclude every prior
discovery and observed V11 result. Capture accepts only the latest strictly
future DEX surface discovery and must occur within five minutes; a cadence
bucket can be sealed only once. Resolution uses the exact entry pair one hour
later, provider errors stay retryable, and observations more than five minutes
late fail closed. Repeated exact assets within an overlapping one-hour frame
receive no additional portfolio weight. This increases prospective sample
throughput; it does not turn correlated observations into independent evidence
or authorize promotion and trading.

Future pulse discoveries strictly after `2026-08-03T19:30:15.000Z` also require
the separately frozen entry-execution rule
`dex-pulse-entry-cross-endpoint-price-integrity-v1`, registered as
`monitoring_policy_registration_8c77e31ab742d3a784d96e0f` at
`19:34:45.358Z`. Capture fetches the exact pair from both DEX token-batch and
token-pairs endpoints at forecast creation, requires the existing 1.10 price
and 1.25 liquidity agreement bounds, and enters at the lower price and lower
liquidity. The discovery quote remains signal metadata, not an executable
entry. A missing or inconsistent quote appends no forecast for that token and
may be retried without sealing the other failed candidates; the scorer
independently reconstructs the entry registration, source-to-entry timing,
exact pair, both quotes, ratios, selected price/liquidity, and return. Earlier
immutable forecasts retain the prior discovery-entry contract and cannot be
relabelled.

The separately registered entry-pullback challenger tests whether the price
change from discovery to that fresh executable entry contains reversal timing
information:

```sh
node scripts/token-edge/onchain-dex-pulse-entry-pullback.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-entry-pullback.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-surface-pulse-entry-pullback-v1`, boundary
`2026-08-03T20:00:20.000Z`, and registration
`monitoring_policy_registration_f3b01d5fabc39df7d9bf4e6d` at
`20:07:59.197Z` exclude DORKL, its still-open outcome, the entire `20:00`
cohort, and every earlier forecast/path. The parent paper-longs every valid
fresh-entry pulse; the challenger holds paper cash unless the fresh entry is at
least 10% below the retained discovery quote. That round threshold is declared
after DORKL fell `28.890149%` from discovery to entry and then showed retained
`+31.720287%` and `+42.727998%` open-path marks. Those observations are
derivation-only, not payoff evidence. The scorer reconstructs exact discovery,
candidate, pair, source-to-entry timing, fresh cross-endpoint entry integrity,
capacity returns, independent frames, stress payoff, and paired bootstrap
gates. It never uses the discovery quote as a fill, infers a rebound, changes an
entry, auto-promotes, or trades.

The v2 challenger keeps that pullback parent fixed and adds only a positive
source five-minute momentum sign:

```sh
node scripts/token-edge/onchain-dex-pulse-entry-pullback.mjs \
  register-positive-momentum --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-entry-pullback.mjs \
  score-positive-momentum --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-surface-pulse-pullback-positive-momentum-v2`, boundary
`2026-08-03T21:15:23.000Z`, and registration
`monitoring_policy_registration_0e44c7a1844d4ad6abde0b02` at
`21:19:01.288Z` exclude DORKL, DOGE, and every inspected outcome. The clue was
directional, not fitted: both repriced at least 10% below discovery, but DORKL
had a positive source five-minute change before its rise and DOGE had a
negative one before its loss. All future valid pullbacks stay in the parent;
the challenger paper-longs only those whose immutable source
`priceChangeM5Pct` is greater than zero. Review retains the same breadth,
stress, paired-bootstrap, profit-factor, drawdown, and concentration gates.
The live score starts with zero candidates and cannot backfill either clue,
promote, mutate a forecast, or trade.

The `mark` command retains at most one exact-entry-pair observation per open
pulse forecast in each five-minute UTC bucket. It exists only to support a
later separately registered exit-policy audit; marks cannot resolve forecasts,
backfill an unseen crossing, or authorize an exit.

From `2026-08-03T18:30:35.578Z`, pulse marks and exact outcomes also require
the exact pair's DEX Screener token-batch and token-pairs responses to agree
within a 1.10 price ratio and 1.25 liquidity ratio. A missing or inconsistent
side fails closed and remains retryable; a legal observation conservatively
uses the lower price and lower liquidity. New events retain both aggregate
quotes and their ratios under `dex-pulse-cross-endpoint-price-integrity-v1` so
the scorer can reconstruct the check. This prevents an inconsistent cached
endpoint response from appearing as a fill, but it still does not prove an
on-chain transaction was executable.

The primary forecast `mark-open` and exact live resolver use the parallel
`token-edge-dex-execution-cross-endpoint-v1` contract from
`2026-08-03T18:41:08.629Z`. They compare the deepest token-pairs quote with
the same exact pair in the token-batch response under the same 1.10 price and
1.25 liquidity limits, retain both sides, and use the lower price/liquidity.
Disagreement records no path or exact outcome and remains retryable inside the
existing bucket or five-minute due window. Exit-policy scoring independently
reconstructs this evidence for all later path and resolution rows.

The future-only five-minute flow panel captures faster DEX fields inside every
later pulse forecast and scores them without changing the all-long parent:

```sh
node scripts/token-edge/onchain-dex-pulse-fast-flow-monitoring.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-fast-flow-monitoring.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Boundary `2026-08-03T14:40:15.000Z` and registration
`monitoring_policy_registration_2a64deba139db9cc865f741a` exclude EVILSHIB's
already inspected five-minute collapse. The five frozen screens test five-
minute buy pressure, positive price momentum, volume/liquidity turnover of at
least an unoptimized 5%, their consensus, and buy-pressure acceleration versus
the trailing hour. Retained buy/sell counts and volume must exactly reconstruct
the stored ratios. Missing data fails closed. The first legal live cohort is
BULLEN and CHUBBYDOG at `14:46:29.216Z`; both pass buy pressure, neither passes
the turnover screen, only CHUBBYDOG passes positive five-minute momentum and
the acceleration screen, and no outcome has matured. This is an uncorrected
multiple-testing monitor and cannot mutate, promote, or trade.

DEX Screener represents a five-minute interval with positive buys and zero
sells using a null ratio. A separate future-only representation test compares
the frozen finite-ratio buy-pressure decision with the equivalent count-domain
decision `buys > 0 && buys >= sells`, which admits zero-sell intervals while
keeping zero/zero cash:

```sh
node scripts/token-edge/onchain-dex-pulse-count-buy-dominance.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-count-buy-dominance.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Boundary `2026-08-03T17:16:30.000Z` and registration
`monitoring_policy_registration_a1a34c25c883b4c385dc759e` at
`17:22:26.395Z` exclude every inspected pulse row,
including CHUBBYDOG's `10` buys, zero sells, null ratio, and later +4.949127%
gross result. That clue is also an overlapping same-asset observation and did
not change the old independent score. Both stored null semantics and finite
ratios must reconstruct exactly from nonnegative integer counts; zero/zero is
never interpreted as demand. Review requires 252 independent frames, 30
traded tokens, 64 traded frames, 50 independently weighted zero-sell additions,
positive base and 12% stress returns, a positive paired bootstrap lower bound,
and the common profit-factor, drawdown, and concentration gates. This monitor
cannot mutate, promote, or trade.

The first five independent count-policy frames now contain eight selected
observations. After the exact `23:30:31.230Z` outcome, the count policy is
`+0.843428%` after base costs with profit factor `2.178888`, but it remains
`-2.863239%` under the frozen 12% stress cost and its largest winning frame
contributes `0.473132` of gains. It therefore remains collecting and cannot be
promoted.

A separate one-change challenger adds only the already-retained positive
five-minute price-change sign to that count-domain parent:

```sh
node scripts/token-edge/onchain-dex-pulse-count-buy-dominance.mjs \
  register-positive-momentum --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-count-buy-dominance.mjs \
  score-positive-momentum --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-surface-pulse-count-buy-positive-momentum-v2`, boundary
`2026-08-03T23:31:00.000Z`, and registration
`monitoring_policy_registration_a9b13915486cd6f9485e6340` at
`23:33:53.345Z` exclude the favorable LetsPlay outcome, every inspected count
row, all current paths, and every earlier or currently open forecast. The
parent remains `buys > 0 && buys >= sells`; the challenger adds only immutable
source `priceChangeM5Pct > 0`. Missing momentum is challenger cash. Review
still requires positive base and stress returns, a positive paired-bootstrap
lower bound, 252 independent frames, 30 traded tokens, 64 traded frames, 50
positive-momentum observations, and the common profit-factor, drawdown, and
concentration gates. It cannot backfill, retune, mutate, promote, or trade.

The first legal v2 frame matured exactly at `2026-08-04T00:37:03.515Z` with
no misses. AURACAT returned `+0.810373%` gross and held paper cash; FROGE
returned `+37.296417%` gross and passed both the count parent and positive-
momentum child. Equal-frame capacity weighting reports `+15.665406%` after
base costs and `+11.665406%` under stress for both arms. The paired v2 delta is
therefore exactly zero: positive momentum did not discriminate beyond count
buy dominance. One traded frame, one traded token, and concentration `1` are
far below the review gates, so this is profitable first-frame evidence only,
not a demonstrated edge.

After the same first independent frame later expanded through the exact
`01:06:29.751Z` outcomes, v2 avoided WIGLET's `-34.215474%` gross collapse but
also held cash through helia's `+56.193548%` reversal. The count parent is now
`-2.036793%` base and `-6.036793%` stress, while v2 is `+7.832703%` and
`+5.832703%`; its paired improvement is `+9.869497` points. This is useful
discrimination inside one frame, but still only one selected token and one
independent frame with concentration `1`, not an edge.

A third future-only child adds one flow-quality requirement to that frozen
count-plus-positive-momentum parent:

```sh
node scripts/token-edge/onchain-dex-pulse-count-buy-dominance.mjs \
  register-flow-quality --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-count-buy-dominance.mjs \
  score-flow-quality --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-surface-pulse-count-buy-positive-momentum-minimum-turnover-v3`,
boundary `2026-08-04T00:19:43.000Z`, and registration
`monitoring_policy_registration_c410c88d7bf44e0cc46b3123` at
`00:21:28.652Z` exclude the inspected FROGE/LetsPlay frame, every open path,
and every forecast open at registration. The derivation frame showed FROGE at
`+36.400986%` gross with `0.028544` five-minute turnover while LetsPlay lost
`48.096988%` with only `0.001193` turnover, despite both satisfying count buy
dominance and positive five-minute momentum. That contrast is post-hoc seed
provenance only. The challenger adds the round requirement
`fiveMinuteTurnover >= 0.01`; its parent decision and every other field remain
unchanged. Turnover integrity is reconstructed from immutable five-minute
volume and the liquidity retained on the forecast's exact linked discovery,
not from later fresh-entry liquidity. Review requires 252 independent frames,
30 traded tokens, 64 traded frames, 50 flow-quality observations, positive
base/stress and paired-bootstrap payoff, and the same profit-factor, drawdown,
and concentration gates. It starts with zero legal outcomes and cannot
backfill, retune, mutate, promote, or trade.

A parallel future-only child tests whether momentum must agree across both the
five-minute and one-hour source windows:

```sh
node scripts/token-edge/onchain-dex-pulse-count-buy-dominance.mjs \
  register-dual-momentum --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-count-buy-dominance.mjs \
  score-dual-momentum --ledger /absolute/research/path/ledger.jsonl
```

Rule
`dex-surface-pulse-count-buy-positive-five-minute-and-hourly-momentum-v4`,
boundary `2026-08-04T00:48:30.000Z`, and registration
`monitoring_policy_registration_e59a97f89e55f5d24d2b4585` at
`00:50:42.025Z` exclude all 50 weighted observations in the 10-frame audit,
the 24-hour retrospective that prompted the cross-window check, every inspected
path, and every forecast open at registration. The frozen v2 parent remains
count buy dominance plus `priceChangeM5Pct > 0`; v4 adds only finite source
`priceChangeH1Pct > 0`. The derivation averaged `+2.515744%` base and
`+0.382411%` stress with profit factor `3.376`, versus `+2.244271%` and
`-0.975729%` for the parent, but traded only seven frames/tokens, lost in the
first chronological half, and had winning-frame concentration `0.4981`. It is
therefore a sparse, multiple-tested hypothesis only. The real scorecard starts
at zero legal forecasts/outcomes and requires the common 252-frame, 30-token,
64-traded-frame, 50-signal, paired-bootstrap, stress, profit-factor, drawdown,
and concentration gates. Missing hourly momentum is paper cash; it cannot
backfill, retune, mutate, promote, or trade.

A separate broad-population challenger tests a pullback state that the positive-
momentum children intentionally exclude:

```sh
node scripts/token-edge/onchain-dex-pulse-cross-window-reversal.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-cross-window-reversal.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-surface-pulse-negative-five-minute-positive-hourly-reversal-v1`,
boundary `2026-08-04T01:09:31.000Z`, and registration
`monitoring_policy_registration_863b8e3539ac8cd3c0d312c3` at
`01:23:02.879Z` exclude helia, WIGLET, every other audited outcome/path, and
every forecast open at registration. The unchanged parent follows every valid
pulse observation; the challenger changes only the source momentum sign state
to `priceChangeM5Pct < 0 && priceChangeH1Pct > 0`. A bounded derivation audit
selected seven observations across five traded frames and six tokens and
averaged `+1.281251%` base, `+0.234584%` stress, and profit factor `5.6624`,
but one winner supplied `0.7749` of gains and the first chronological half was
negative. Magnitude and transaction-count variants were inspected but were not
adopted. The real scorecard starts with zero legal forecasts/outcomes and needs
252 independent frames, 30 traded tokens, 64 traded frames, 50 reversal
observations, positive base/stress and paired-bootstrap payoff, and the common
profit-factor, drawdown, and concentration gates. Missing source momentum is
paper cash; the challenger cannot backfill, retune, mutate, promote, or trade.

The future-only buy-pressure take-profit challenger changes one dimension of
that frozen panel: tokens passing its existing five-minute buy-pressure screen
paper-exit at the first retained complete-path point at or above +10% instead
of always holding to the exact one-hour result. Failed entry screens remain
paper cash.

```sh
node scripts/token-edge/onchain-dex-pulse-fast-flow-take-profit.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-fast-flow-take-profit.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Boundary `2026-08-03T16:34:00.000Z` and registration
`monitoring_policy_registration_534a3efe4650beba2c04de3f` exclude every pulse
forecast, mark, and outcome inspected while forming the combination. Only pulse
forecasts created strictly after registration can count. Each scoreable path
needs at least six exact-pair marks and no entry-to-mark, mark-to-mark, or
mark-to-due gap over ten minutes. A crossing is recognized only at its retained
response point, with same-point liquidity and the registered $100 notional plus
4% base and 12% stress cost models; it is never backfilled. The apparent source
payoff came from one independent post-hoc frame and was negative under stress,
so the challenger starts with zero eligible forecasts and cannot promote,
mutate, or trade.

Cadence v2 leaves that frozen treatment intact but evaluates internal coverage
using the immutable five-minute `bucketStartedAt` values, while retaining
observed-time checks from forecast creation to the first mark and from the last
mark to the exact due time:

```sh
node scripts/token-edge/onchain-dex-pulse-fast-flow-take-profit.mjs \
  register-cadence-tolerant --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-fast-flow-take-profit.mjs \
  score-cadence-tolerant --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-pulse-five-minute-buy-pressure-take-profit-cadence-v2`, boundary
`2026-08-03T20:45:40.000Z`, and registration
`monitoring_policy_registration_14df938b7e98232f6c6e0ae8` exclude DORKL and
all evidence inspected after its `+98.537623%` exact fresh-entry outcome. The
change addresses a retained ten-minute bucket interval whose HTTP observations
were 600.176 seconds apart. It does not loosen price integrity, infer an unseen
crossing, or change entry, exit, cost, weighting, breadth, or promotion gates.

The same existing +10% observed exit is also transferred to the separately
frozen negative-five-minute/positive-one-hour reversal entry:

```sh
node scripts/token-edge/onchain-dex-pulse-fast-flow-take-profit.mjs \
  register-cross-window-reversal --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-fast-flow-take-profit.mjs \
  score-cross-window-reversal --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-pulse-cross-window-reversal-take-profit-v1`, boundary
`2026-08-04T04:34:23.000Z`, and registration
`monitoring_policy_registration_744fb356a25e65348e854269` at
`04:37:45.033Z` permanently exclude FROGE and its inspected open path. FROGE
entered the already-frozen reversal state, reached `+17.616241%` at one
retained mark, and had fallen back to `+3.40537%` at the next mark; its exact
outcome was still unknown when the transfer was sealed. Future scoreable rows
must be created strictly after registration, retain the reversal signs, and
meet the unchanged complete-path, exact-pair, capacity, cost, frame, breadth,
bootstrap, drawdown, profit-factor, and concentration gates. The score starts
empty and cannot promote, mutate, or trade. A valid pulse whose immutable
five-minute or one-hour momentum is missing remains explicit challenger cash
and counts in the paired population; it is not dropped from sample size.

The LunarCrush pulse panel adds exact-contract hourly social dynamics before a
later pulse forecast. It is separately registered and sampled at most once per
clock hour so the complete-universe request does not repeat every 15 minutes:

```sh
node scripts/token-edge/onchain-dex-pulse-lunar-monitoring.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
hive-env-run -- node scripts/token-edge/onchain-dex-pulse-lunar-monitoring.mjs enrich \
  --max-lunarcrush-requests 10 \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs capture \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-lunar-monitoring.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Boundary `2026-08-03T12:40:00.000Z` and registration
`monitoring_policy_registration_18e56f76a4b18a971f03feb5` exclude the first
open pulse frame and all earlier social evidence. Enrichment must follow a new
DEX discovery by no more than five minutes, and every exact-mint event must be
available before the pulse forecast by no more than ten minutes. Ready social
summaries are independently recomputed from retained completed hourly rows.
The fixed screen family covers exact-mint tracking, LunarCrush's move alert,
interaction/post/contributor acceleration, AltRank plus Galaxy quality, and a
DEX-flow/social consensus. Untracked contracts remain explicit blocked
coverage—not fabricated negative social signals. This multiple-testing panel
cannot change V11, promote itself, or trade.

The future-only LunarCrush creator pulse panel reuses the same hourly request
budget but routes spare creator calls to the exact DEX pulse mints rather than
the broad social-discovery list. Register it separately before a later hourly
enrichment, then inspect its scorecard after exact one-hour outcomes mature:

```sh
node scripts/token-edge/onchain-dex-pulse-lunar-monitoring.mjs register-creator \
  --ledger /absolute/research/path/ledger.jsonl
hive-env-run -- node scripts/token-edge/onchain-dex-pulse-lunar-monitoring.mjs enrich \
  --max-lunarcrush-requests 10 \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs capture \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-lunar-monitoring.mjs score-creator \
  --ledger /absolute/research/path/ledger.jsonl
```

Boundary `2026-08-03T14:24:00.000Z` and registration
`monitoring_policy_registration_dab2303bfc339421608c6cee` exclude the already
observed EVILSHIB, BABYCATE, BULLVI, 3place, Buddy, SHIPY, and TIT outcomes and
all previously collected creator data. Six frozen screens compare exact creator
coverage, distributed versus concentrated attention, mid-tail creator swarms,
interactions per creator, and distributed-creator/social-acceleration consensus.
Only exact-contract, unique-topic, aggregate-only evidence available before the
forecast is accepted. Aggregate digests, identity links, timestamps, and raw-
identity deletion flags are reconstructed; missing creator coverage fails
closed. The screens are an uncorrected hypothesis family until multiple
independent future frames mature. They cannot mutate forecasts, promote, or
trade.

The first exact future creator-panel hit is now isolated as a separate
replication challenger without changing its already frozen thresholds:

```sh
node scripts/token-edge/onchain-dex-pulse-lunar-creator-acceleration.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-lunar-creator-acceleration.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-surface-pulse-lunar-creator-acceleration-v1`, boundary
`2026-08-03T20:24:45.300Z`, and registration
`monitoring_policy_registration_0a263197ad20a7854668d074` at
`20:27:19.001Z` exclude 3place, its +20.569174% exact one-hour result, all
earlier creator/social evidence, and every earlier forecast and path. The rule
copies the predeclared `distributed-creator-social-acceleration-consensus`
screen exactly: an exact ready creator aggregate with at least 10 creators and
500 interactions, top-creator interaction share at most 35%, creator HHI at
most 0.20, plus at least one independently validated social-acceleration
signal. No threshold was fitted to the 3place result.

Every later valid pulse remains in the parent opportunity set. The challenger
holds paper cash when exact creator/social evidence is missing, blocked,
forged, late, or does not pass the unchanged screen. Promotion still requires
252 observations and independent frames, 30 traded tokens, 64 traded frames,
50 qualifying observations, positive base and 12% stress capacity returns, a
positive paired-bootstrap lower bound, profit factor at least 1.2, drawdown at
most 25%, and largest-winner share at most 35%. One derivation winner with
100% concentration is only sufficient to justify replication, never an edge
claim, forecast mutation, or trade.

The subscribed LunarCrush API can also return a current aggregate topic keyed
directly by a Solana mint even when that mint is absent from `coins/list`. The
future-only exact-contract topic panel collects that point before pulse capture:

```sh
node scripts/token-edge/onchain-dex-pulse-lunar-topic-monitoring.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
hive-env-run -- node scripts/token-edge/onchain-dex-pulse-lunar-topic-monitoring.mjs enrich \
  --max-lunarcrush-requests 10 \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs capture \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-lunar-topic-monitoring.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-surface-pulse-lunar-exact-contract-topic-panel-v1`, boundary
`2026-08-03T21:06:30.000Z`, and registration
`monitoring_policy_registration_841a9d24b72b1ba63cf3f870` exclude DORKL and
its `+98.537623%` outcome. A ready point requires the response topic to match
the mint case-insensitively, the title to preserve the exact case-sensitive
mint, and nonnegative interaction, contributor, and post aggregates. A provider
echo with null metrics is blocked. Only aggregate counts, per-post/per-creator
depth, type totals, timing, and digests are retained; posts and creator
identities are discarded. The six round screens test coverage, 10 contributors,
10 posts, 500 interactions, 100 interactions per post, and their consensus.
Missing or invalid evidence is challenger cash while every future pulse stays
in the parent. Individual-tier topic history and exact-term post search return
HTTP 402, so this panel uses immutable live points and never fabricates history.

The separately frozen topic-growth panel reconstructs the missing history from
two later immutable exact-contract points instead of purchasing or inventing a
provider time series:

```sh
node scripts/token-edge/onchain-dex-pulse-lunar-topic-growth.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-lunar-topic-growth.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-surface-pulse-lunar-exact-contract-topic-growth-panel-v1`, boundary
`2026-08-03T21:30:35.000Z`, and registration
`monitoring_policy_registration_c4789024d1f543af29514ffe` at
`21:37:19.338Z` exclude the first topic cohort, all inspected interim paths,
and every earlier topic point. Each point must be exact, ready, independently
linked to its discovery, and collected after registration; the current point
must be available before the forecast and the prior point must be from a
different discovery 10 to 30 minutes earlier. Five separate
screens test strictly increasing interactions, contributors, posts,
contributor-plus-post breadth, and all three together. Missing or non-growing
comparisons are paper cash while the all-pulse parent remains unchanged. The
first post-registration baseline retained exact LetsPlay aggregates at
`21:37:32.972Z`; AURACAT again failed exact-mint identity closed. No outcome or
scoreable growth comparison exists yet. A second immutable LetsPlay point at
`21:48` was unchanged, so it will not pass any strict-growth screen when its
forecast matures. This multiple-testing panel cannot backfill, retune,
auto-promote, mutate, or trade.

The Individual tier also exposes exact-mint creator and post rows even when a
token is missing from the coin universe. A separate future-only structure panel
reduces both routes to anonymous aggregates before pulse capture:

```sh
node scripts/token-edge/onchain-dex-pulse-lunar-topic-structure.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
hive-env-run -- node scripts/token-edge/onchain-dex-pulse-lunar-topic-structure.mjs enrich \
  --max-lunarcrush-requests 10 \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs capture \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-lunar-topic-structure.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-surface-pulse-lunar-exact-contract-topic-structure-panel-v1`, boundary
`2026-08-03T21:51:30.000Z`, and registration
`monitoring_policy_registration_35cdfff8d55f08335b641862` at
`21:55:34.952Z` exclude the endpoint-audit token, every inspected path, and all
earlier forecasts. Exact post-config mint identity plus creator/post interaction
agreement within 5% binds the otherwise identity-free creator response. The
five declared screens test coverage, the earlier frozen 10-creator/500-
interaction/35%-top-share/0.20-HHI swarm, the same round dispersion contract
for posts, their breadth consensus, and a provider-positive sentiment consensus.
Names, IDs, post text, links, images, and avatars are discarded immediately;
only counts, concentration, sentiment aggregates, timing, and digests reach the
ledger. Each token consumes two LunarCrush calls, so a 10-call run covers at
most five candidates and missing candidates remain challenger cash. No exact-
structure forecast or outcome exists yet, and the panel cannot backfill,
auto-promote, mutate, or trade.

The first structure cohort proved that creator and post interaction totals can
differ materially despite exact post identity, so the strict 5% agreement rule
is preserved as a failed-coverage experiment. A separate one-call post-swarm
panel removes that ambiguous creator-total join while retaining active-creator
breadth from the post rows themselves:

```sh
node scripts/token-edge/onchain-dex-pulse-lunar-topic-structure.mjs register-posts \
  --ledger /absolute/research/path/ledger.jsonl
hive-env-run -- node scripts/token-edge/onchain-dex-pulse-lunar-topic-structure.mjs enrich-posts \
  --max-lunarcrush-requests 10 \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs capture \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-lunar-topic-structure.mjs score-posts \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-surface-pulse-lunar-exact-contract-posts-panel-v1`, boundary
`2026-08-03T22:02:20.000Z`, and registration
`monitoring_policy_registration_387758ac37c35f736ab0bf87` at
`22:06:28.776Z` exclude the mismatch audit, the first structure cohort, every
inspected path, and all earlier forecasts. Its six separate screens test exact
coverage, 10 posts, 10 active post creators, 500 post interactions, unchanged
35%-top-share/0.20-HHI dispersion, and provider-positive sentiment consensus.
Exact post-config mint identity, pre-forecast availability, aggregate digests,
and no-identity privacy flags are mandatory. One call covers one token; missing
or invalid evidence is challenger cash while every later pulse remains in the
parent. It cannot repair v1, backfill, retune, auto-promote, mutate, or trade.

The first post-only cohort falsified static swarm strength on one independent
frame. AURACAT returned `-10%`, LetsPlay `+3.041825%`, DOGE `-38.104913%`, and
ARMARA `0%` gross. The distributed 10-post/10-creator/500-interaction screen
selected the first three and returned `-15.438632%` after base costs and
`-21.438632%` under the stress model. This is only one frame, but it is direct
negative evidence: high exact-post volume and breadth alone did not predict a
profitable next hour.

The post-swarm aggregates cannot tell whether many bullish posts contain new,
token-specific information or repeat the same coordinated promotion. A
separate future-only semantic panel sends a bounded, transient exact-contract
post corpus to Gemini before pulse capture:

```sh
node scripts/token-edge/onchain-dex-pulse-lunar-post-semantics.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
hive-env-run -- node scripts/token-edge/onchain-dex-pulse-lunar-post-semantics.mjs enrich \
  --max-requests 10 \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs capture \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-lunar-post-semantics.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-surface-pulse-lunar-gemini-post-semantics-panel-v1`, boundary
`2026-08-03T22:40:01.000Z`, and registration
`monitoring_policy_registration_2dc569a8dc6bf8b790595d57` at
`22:45:58.962Z` exclude the model/provider audit and every earlier forecast.
Gemini `gemini-3.6-flash` receives at most 50 post types, titles, and
descriptions, without tools, web search, creator identity, follower status,
price, outcome, or outside context. Only exact-post aggregates,
corpus/model/prompt digests, and eight corpus-level metrics reach the ledger;
raw text, identities, IDs, model responses, and keys are discarded. The five
separate midpoint screens test semantic coverage; low promotion plus low hype;
substantive plus novel evidence; coherent, substantive, novel evidence; and an
organic bullish specific narrative. A failed provider or model request is
immutable paper cash and is never retried into a sealed forecast. The first
four live forecasts matured exactly at `23:47:24.935Z` with no misses:
AURACAT returned `+9.360936%`, LetsPlay `-55.22759%`, FROGE `+23.148148%`,
and ARMARA `+5.571919%` gross. The full parent lost `-9.783989%` after base
costs and `-17.783989%` under stress. Semantic coverage selected AURACAT,
LetsPlay, and ARMARA and was worse at `-14.112565%` base. The low-promotion and
low-hype screen selected only ARMARA and returned `+0.011884%` base after
equal-frame cash weighting, but `-1.988116%` under stress. No
substantive/novel screen traded. One frame and one selected token cannot
establish an edge; the low-promotion veto remains a prospective replication
hypothesis. This panel cannot combine screens post hoc, backfill, retune,
auto-promote, mutate, or trade.

Repeated identical-corpus classifications are reported separately as an
inference-stability diagnostic. Metric ranges and screen-membership flips do
not count as independent market observations and cannot change an earlier
forecast. The first two repeated corpus digests showed model variation but no
flip in any frozen midpoint screen.

After two later exact-post collections succeeded while Gemini returned HTTP
429, cache policy `lunarcrush-gemini-exact-corpus-cache-v1` applies only to
collections strictly after `2026-08-03T23:49:15.000Z`. It may bypass a Gemini
call only when an earlier direct-Gemini event predates the new collection and
matches the exact corpus, model, model version, prompt version, prompt digest,
semantic metrics, and metrics digest. The new event retains the fresh exact-
post aggregate and points to that immutable source event; the scorer
reconstructs the entire lineage. Cached copies are excluded from the model-
variation audit and cannot count as independent market evidence. Missing,
forged, chained-cache, late, or privacy-unsafe sources fail closed. Forecasts
already sealed with HTTP 429 remain cash and cannot be repaired.

The exact post reducer also supports a separate future-only growth panel that
does not use Gemini's classifications:

```sh
node scripts/token-edge/onchain-dex-pulse-lunar-post-growth.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-lunar-post-growth.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-surface-pulse-lunar-exact-contract-post-growth-panel-v1`, boundary
`2026-08-03T22:56:15.000Z`, and registration
`monitoring_policy_registration_74c3c8d2e9382e0769955acf` at
`23:00:08.182Z` exclude the provider/model audit, repeated identical corpora,
every earlier forecast, and every inspected path. A comparison needs two
privacy-safe exact-post points collected after registration from different
discoveries 10-30 minutes apart. The current point must be linked and
available before its forecast. Five strict sign-only screens test increasing
post interactions, increasing anonymous active creators, increasing returned
post count, decreasing top-share plus HHI, and interaction/creator/post growth
consensus. Missing comparisons are paper cash while every later pulse remains
in the parent. The first four open forecasts establish current points only;
no growth comparison or outcome exists yet. This panel cannot backfill,
combine screens post hoc, retune, auto-promote, mutate, or trade.

Exact post rows also expose creation timestamps, allowing a separate
future-only recency panel to distinguish fresh attention from old posts that
still carry high 24-hour interaction totals:

```sh
node scripts/token-edge/onchain-dex-pulse-lunar-post-growth.mjs register-recency \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-lunar-post-growth.mjs score-recency \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `dex-surface-pulse-lunar-exact-contract-post-recency-panel-v1`, boundary
`2026-08-03T23:03:37.000Z`, and registration
`monitoring_policy_registration_d65b2e7023c20c8a1c928172` at
`23:06:44.646Z` exclude the endpoint audit, every current point, all earlier
forecasts, and all inspected paths. Post ages are reduced relative to
collection time before append; raw timestamps and post/creator fields are not
retained. The six separate round screens test full timestamp coverage, any
post in the prior hour, at least one quarter of posts in the prior hour, at
least half within six hours, median age within six hours, and six-hour
freshness combined with the already frozen distributed post-swarm contract.
Missing, partial, future-dated, late, mismatched, or tampered evidence is paper
cash while every future pulse remains in the parent. The live scorecard begins
with zero forecasts or outcomes. This panel cannot backfill, combine screens
post hoc, retune, auto-promote, mutate, or trade.

The separate GoPlus pulse panel tests whether point-in-time mint safety and
holder-distribution coverage remove catastrophic downside from later DEX pulse
cohorts. Register it once, enrich every new discovery before pulse capture, and
score it only after exact one-hour outcomes mature:

```sh
node scripts/token-edge/onchain-dex-pulse-goplus-monitoring.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-goplus-monitoring.mjs enrich \
  --max-goplus-requests 10 \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs capture \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-goplus-monitoring.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Boundary `2026-08-03T13:40:00.000Z` and registration
`monitoring_policy_registration_0be24e6992a16fd81e4e4020` exclude BULLVI and
every path inspected before the rule was sealed. Its six fixed screens cover
exact-mint provider coverage, reported holder distribution, absence of
objective hard risks, absence of authority cautions, an unoptimized 20% top-
holder cap, and their strict consensus. Missing coverage or holder evidence
fails the relevant screen closed. The clue is explicitly post-hoc: BULLVI was
the only token in its inspected five-token pulse cohort without GoPlus holder
data while its pool collapsed, but the provider reported no hard or authority
risk. That observation cannot enter the scorecard or validate the hypothesis.
Only aggregate flags and the largest reported holder share are retained; raw
holders and creator identities are not. This panel can hold paper cash but
cannot mutate a forecast, auto-promote, trade, or backfill security evidence.

The future-only RugCheck pulse panel tests a complementary aggregate contract,
creator-history, insider-network, and exact-pair liquidity-lock view without
retaining any wallet, holder, creator, or insider identities:

```sh
node scripts/token-edge/onchain-dex-pulse-rugcheck-monitoring.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-rugcheck-monitoring.mjs enrich \
  --max-rugcheck-requests 10 \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs capture \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-rugcheck-monitoring.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Boundary `2026-08-03T14:51:30.000Z` and registration
`monitoring_policy_registration_eb770c3e3a2c74dd8cf9b88f` exclude EVILSHIB,
the open BULLEN/CHUBBYDOG paths, the resolved v14 cohort, and every report
inspected before the rule was sealed. Six frozen screens cover exact coverage,
zero danger risks, normalized score at most 20, zero detected graph insiders,
at least 90% same-pair LP lock, and their strict consensus. Evidence must be
collected within five minutes of a strictly later discovery and be available
before forecast creation. The public response is reduced before append to
counts, scores, risk names, and same-pair lock aggregates; raw identities are
discarded. The first five-token live cohort is due at `16:00:44.614Z` and must
mature before any payoff claim. This panel is paper-only and cannot mutate,
promote, or trade.

The future-only RugCheck market-structure panel tests provider fields that the
first RugCheck contract intentionally discarded: holder concentration after
excluding provider-labelled known accounts, reported market and venue breadth,
revoked token controls, metadata mutability, and Pump.fun AMM presence. Raw
holder, owner, creator, and known-account identities are reduced in memory and
never appended:

```sh
node scripts/token-edge/onchain-dex-pulse-rugcheck-market-structure.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-rugcheck-market-structure.mjs enrich \
  --max-rugcheck-requests 10 \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-monitoring.mjs capture \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-rugcheck-market-structure.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Boundary `2026-08-03T19:48:15.000Z` and registration
`monitoring_policy_registration_e0373e0f57a41a76a2adb848` at
`19:55:23.461Z` exclude DORKL, DOGE, AURACAT, LetsPlay, ARMARA, every inspected
provider report, and all earlier paths. The six screens separately test a 30%
known-account-adjusted top-20 cap, at least two reported markets, at least two
reported market types, revoked mint and freeze authorities, immutable metadata,
and Pump.fun AMM presence. This is an explicitly multiple-testing diagnostic
panel, not one combined fitted challenger. Evidence must be exact-contract,
collected within five minutes of a strictly future discovery, digest-valid, and
available before a fresh pulse entry. The first three strictly future
aggregates were recorded without provider failures from discovery
`discovery_59de8bf5a49167fbc0232fa1`; their outcomes do not exist yet. The panel
can hold paper cash but cannot mutate, promote, backfill, or trade.

The course-derived holder-growth monitor reuses those exact-mint aggregate
snapshots but changes only one predictive dimension: whether total holders are
strictly increasing across the latest two valid observations.

```sh
node scripts/token-edge/onchain-dex-pulse-rugcheck-holder-growth.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-dex-pulse-rugcheck-holder-growth.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Boundary `2026-08-03T16:45:00.000Z` and registration
`monitoring_policy_registration_8dfdb3836af37bcdbf8f0e49` at
`16:48:39.742Z` exclude the inspected BULLEN and CHUBBYDOG holder series and
every earlier evidence/outcome. Both comparison snapshots must be aggregate-
only, exact-contract, independently digest-valid, and collected after this
registration, 10 to 30 minutes apart; missing, flat, declining, stale, or
forged counts produce paper cash. No holder-growth magnitude, price, age,
creator, insider, or risk-score threshold is added. The first five future pulse
forecasts are open, but only one post-registration snapshot exists for each, so
the score starts with zero eligible comparisons. It remains paper-only and
cannot mutate, promote, or trade.

Inspect the broad monitoring panel without mutating it:

```sh
node scripts/token-edge/onchain-lunarcrush-monitoring-scorecard.mjs \
  --ledger /absolute/research/path/ledger.jsonl
```

Inspect the future-only selected organic-activity monitoring family without
changing a forecast:

```sh
node scripts/token-edge/onchain-organic-activity-monitoring-scorecard.mjs \
  --ledger /absolute/research/path/ledger.jsonl
```

The monitor starts at zero outcomes because its boundary follows the derivation
and the first selected full profile. Missing metrics, pre-boundary snapshots,
wrong providers/timeframes, open or recovered outcomes, live marks more than
five minutes late, overlapping same-token signals, or invalid execution-policy
links cannot enter its scorecard.

Inspect the future-only DEX buy-pressure confirmation without changing a
forecast:

```sh
node scripts/token-edge/onchain-dex-buy-pressure-monitoring-scorecard.mjs \
  --ledger /absolute/research/path/ledger.jsonl
```

This monitor also begins with zero outcomes. Missing entry-time transaction or
price fields fail closed, and exact live timing, verified Nansen selection,
registered execution evidence, same-pair liquidity, independent asset frames,
base/stress costs, and winner concentration remain mandatory. The stricter
screen also fails closed when hourly volume or entry liquidity is absent.

Without `--selection-confirmation-id`, the selection arm fails closed. The
linked confirmation must itself reference a recorded discovery event and the
same token must be eligible in both events.

Label an independently chosen unscreened control explicitly rather than leaving
its provenance unattributed:

```sh
node scripts/token-edge/onchain-forward-research.mjs collect \
  --chain solana \
  --tokens CONTROL_TOKEN \
  --selection-control-timeframe 1h \
  --cohort hourly-unscreened-market-control \
  --ledger /absolute/research/path/ledger.jsonl
```

The Nansen selection arm still fails closed for this cohort, while the market
arm's outcome is sliced under `unscreened-market-control/1h` for a clean A/B.

Resolve forecasts during their named observation windows:

```sh
node scripts/token-edge/onchain-forward-research.mjs resolve \
  --ledger /absolute/research/path/ledger.jsonl
```

The provider response time is never backdated. A live result at any named
horizon observed more than five minutes after `dueAt` remains diagnostic
evidence but is excluded from exact-horizon flat-payoff promotion, paired
challenger, capacity, and sampled exit-policy gates. The five-minute heartbeat
keeps future live lag bounded in normal operation; Nansen and LunarCrush cadence
preflights remain unchanged.

After resolving anything already due, capture one prospective DEX mark for each
still-open one-hour rise-signal snapshot in the current five-minute UTC bucket:

```sh
node scripts/token-edge/onchain-forward-research.mjs mark-open \
  --horizon 1h \
  --max-tokens 20 \
  --ledger /absolute/research/path/ledger.jsonl
```

Each `forecast-path-observation` retains the exact point-in-time price, deepest
pool, liquidity, linked forecast ids, entry-relative gross return, and bucket.
A snapshot/bucket is deduplicated separately per horizon, so a one-hour mark
cannot suppress a six-hour mark for the same signal. A repeated command for the
same horizon in the same bucket spends zero requests. These marks do not
resolve a forecast, mutate a decision, or prove that a take-profit filled
between marks. A later exit-policy challenger may use only marks observed after
its own evidence boundary and must model costs, AMM impact, missed intervals,
and ambiguous crossings pessimistically.

The first exit-policy challenger is separately frozen and post-hoc. It keeps
the Nansen 6h smart-money selection and entry unchanged, then exits at the
first retained live point mark at or above +10% gross or falls back to the
fixed one-hour live outcome. Register it idempotently before future forecasts,
then inspect it without changing any forecast or path event:

```sh
node scripts/token-edge/onchain-exit-policy-scorecard.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-exit-policy-scorecard.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Its boundary is `2026-08-03T08:33:54.104Z`. The derivation inspected 40 exit
variants on only 16 resolved path-covered forecasts and three independent
frames, so no derivation row can count. The scorecard requires strictly later
source forecasts, exact retained response times, same-pair entry/exit evidence,
independently reconstructed Nansen-discovery-to-DEX lineage and price returns,
live one-hour fallbacks, exact execution-policy linkage, $100 constant-product
capacity, 4%/12% costs, compounded-equity drawdown, and the same breadth,
bootstrap, profit-factor, and concentration discipline. Invalid path marks are
reported and ignored. It never assumes that an unseen intrabar threshold filled.

The second exit-policy experiment addresses the asymmetric-payoff case without
changing selection or entry. `token-edge-tail-preserving-stop-v1` uses the
first retained same-pair mark at or below -10% gross, otherwise the exact
one-hour live outcome, and has no take-profit cap:

```sh
node scripts/token-edge/onchain-exit-policy-scorecard.mjs register-tail-stop \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-exit-policy-scorecard.mjs score-tail-stop \
  --ledger /absolute/research/path/ledger.jsonl
```

Its boundary is `2026-08-03T11:34:00.000Z`; registration
`exit_policy_registration_0afedd4b93ed34fb67b363bf` was sealed at
`11:38:24.911Z`. At a 20% win rate, a -10% gross stop with 4% friction creates
roughly -14% net losers, so four losses require one +56% net / +60% gross
winner just to break even before AMM impact. That fixed arithmetic explains why
the policy preserves the right tail; it is not profit evidence. Scoreable rows
need at least six retained path marks and no entry-to-mark, mark-to-mark, or
mark-to-due gap over ten minutes. The first live score is deliberately empty:
all earlier forecasts and outcomes are excluded.

The same uncapped -10% stop now has a separately frozen 24-hour horizon
transfer for the Nansen 6h Smart Money source:

```sh
node scripts/token-edge/onchain-exit-policy-scorecard.mjs register-24h-tail-stop \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-forward-research.mjs mark-open \
  --horizon 24h \
  --max-tokens 20 \
  --model-version frozen-onchain-rank-v3 \
  --candidate-id smart-money-selection \
  --selection-provider nansen-token-screener \
  --selection-timeframe 6h \
  --created-after 2026-08-04T04:22:00.621Z \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-exit-policy-scorecard.mjs score-24h-tail-stop \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `token-edge-smart-money-24h-tail-preserving-stop-v1`, boundary
`2026-08-04T04:19:49.000Z`, and registration
`exit_policy_registration_b4c63f75a68971acfb958d3f` at
`04:22:00.621Z` exclude the attractive but only two-frame 24-hour seed and all
path marks inspected while defining the transfer. Only later forecasts count.
The economic stop, five-minute marks, ten-minute maximum path gap, full-path
requirement, same Nansen 6h source, $100 capacity model, 4%/12% friction, and
uncapped winner remain unchanged; only the fixed outcome horizon changes. The
filtered path command prevents older or unrelated open forecasts from consuming
the prospective policy's observation budget. This starts at zero observations
and tests survival of the right tail; it is not evidence of a profitable edge.

The third exit-policy experiment transfers that unchanged uncapped stop to the
future V11 DEX early-surface source. It changes only the source forecast; the
entry, one-hour horizon, -10% point-mark stop, path-completeness contract,
capacity model, costs, and uncapped upside remain identical:

```sh
node scripts/token-edge/onchain-exit-policy-scorecard.mjs register-dex-tail-stop \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-exit-policy-scorecard.mjs score-dex-tail-stop \
  --ledger /absolute/research/path/ledger.jsonl
```

Its boundary is `2026-08-03T12:06:00.000Z`; registration
`exit_policy_registration_0f03f80fa08b4ed208bdb855` was sealed at
`12:11:12.234Z`. Open V11 path marks existed before the transfer, but no V11
outcome had matured and no exit threshold was selected from those marks. Every
earlier V11 forecast, path, and later outcome is excluded. Source lineage is
reconstructed with the V11 challenger scorer before an outcome can enter the
exit scorecard. The initial live score is therefore correctly empty.

The fourth exit-policy experiment transfers the unchanged +10% retained-mark
take-profit rule to strictly future V11 DEX early-surface forecasts:

```sh
node scripts/token-edge/onchain-exit-policy-scorecard.mjs register-dex-take-profit \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-exit-policy-scorecard.mjs score-dex-take-profit \
  --ledger /absolute/research/path/ledger.jsonl
```

It changes only the source forecast. Threshold, exact one-hour fallback,
same-pair point-mark execution, $100 capacity model, 4%/12% costs, independent
frames, and promotion gates are inherited unchanged from
`token-edge-take-profit-v1`. Boundary `2026-08-03T17:49:11.112Z` and
registration `exit_policy_registration_e8feb7234d665ffdc92e5505` at
`17:53:45.331Z` exclude all sixteen inspected V11 outcomes and four paths that had crossed +10%, including
BABYCATE's +35.868695% observed peak before its exact -4.243395% one-hour
result. Those reversals justify the experiment but cannot validate it. Missing
crossings are never backfilled; only forecasts created after the separately
sealed registration can enter the scorecard. The verified 10,103-event live
ledger starts with zero eligible observations, `collecting`, and
`provisionalGate: false`.

A stricter future-only execution-integrity variant requires the +10% mark to
persist across two consecutive retained observations 4 to 10 minutes apart:

```sh
node scripts/token-edge/onchain-exit-policy-scorecard.mjs register-dex-confirmed-take-profit \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-exit-policy-scorecard.mjs score-dex-confirmed-take-profit \
  --ledger /absolute/research/path/ledger.jsonl
```

`token-edge-dex-confirmed-take-profit-v2` fills at the second observed quote,
not the first mark or an inferred crossing. A qualifying mark followed by a
sub-threshold mark resets confirmation. Boundary
`2026-08-03T18:25:27.400Z` excludes the BABYCATE same-pair quote that briefly
printed about +1,450% and reverted to roughly -33% at the next five-minute
mark, along with every forecast and path available when that anomaly was
inspected. This changes execution confirmation only; selection, +10%
threshold, exact one-hour fallback, capacity, costs, and review gates remain
unchanged. It is paper-only and does not prove that either retained quote was
fillable on-chain.

The fifth exit-policy experiment keeps the Nansen 6-hour smart-money entry
and inherits the already frozen +10% retained-mark trigger, but trims only half
instead of closing the entire paper position. The untrimmed half remains open
to the exact one-hour outcome so a rare explosive winner is not capped:

```sh
node scripts/token-edge/onchain-exit-policy-scorecard.mjs register-partial-trim \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-exit-policy-scorecard.mjs score-partial-trim \
  --ledger /absolute/research/path/ledger.jsonl
```

Its evidence boundary is `2026-08-03T13:08:00.000Z`; registration
`exit_policy_registration_915c764c3aa8336126cdacfb` was sealed at
`13:12:12.609Z`. The rule was frozen only after the all-at-+10% policy showed a
positive but statistically inconclusive base-cost delta and a negative
12%-cost result. Every inspected source forecast is excluded. A trigger scores
the two halves separately with the full conservative $100 AMM-impact estimate
on each tranche before 50/50 weighting. This deliberately understates
capacity, does not infer intrabar fills, and starts with zero future outcomes.

The sixth exit-policy experiment combines the separately frozen tail stop and
half-trim actions into one asymmetric bracket for strictly later Nansen 6-hour
smart-money entries:

```sh
node scripts/token-edge/onchain-exit-policy-scorecard.mjs register-asymmetric-bracket \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-exit-policy-scorecard.mjs score-asymmetric-bracket \
  --ledger /absolute/research/path/ledger.jsonl
```

At the first retained point at or outside [-10%, +10%], a lower crossing exits
the entire paper position; an upper crossing exits half and holds the remainder
uncapped to the exact one-hour result. The first observed boundary hit is final.
Boundary `2026-08-03T14:36:15.000Z` and registration
`exit_policy_registration_0ddbefd519d3bb9c34d7fc8e` exclude all Kimchi, 旺旺,
PIBBLE, and TIT paths inspected while the rule was composed. A scoreable row
requires six same-pair marks with no gap over ten minutes. Audit readiness also
requires at least 50 independently weighted full stops and 50 half trims in
addition to the common capacity, cost, frame, token, bootstrap, profit-factor,
drawdown, and winner-concentration gates. This is a post-hoc combination that
starts with zero outcomes; it cannot change an entry forecast or trade.

The seventh exit experiment tests whether the size of the first observed +10%
crossing separates a shallow reversal from an explosive continuation:

```sh
node scripts/token-edge/onchain-exit-policy-scorecard.mjs register-overshoot-preserve \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-exit-policy-scorecard.mjs score-overshoot-preserve \
  --ledger /absolute/research/path/ledger.jsonl
```

At the first complete-path mark at or above +10%, a return below +20% exits the
full paper position; a first observed +20% or stronger overshoot commits the
full position to the exact one-hour outcome even after a later reversal. The
round +20% bypass is deliberately post-hoc: it was frozen only after PIBBLE
first crossed at +10.483657% and finished +2.830189% gross while TIT first
crossed at +26.146789% and finished +82.568807%. Boundary
`2026-08-03T15:05:30.000Z` and registration
`exit_policy_registration_607b1c590fcc4997a2b93d8e` exclude that entire frame.
Six exact-pair marks with no gap over ten minutes are required, as are at least
50 shallow exits and 50 preserved overshoots before audit readiness. It starts
at zero outcomes and cannot authorize a live exit or trade.

After resolving or recovering outcomes, append deterministic evidence-linked
retrospectives. The command is idempotent: it writes one review for each new
closed forecast and at most one evolution review for a new outcome set.

```sh
node scripts/token-edge/onchain-forward-research.mjs retrospect \
  --ledger /absolute/research/path/ledger.jsonl
```

Retrospectives classify caught and missed explosions, profitable and
cost-eroded rises, missed net upside, false positives, correct rejections, and
magnitude under/overestimates at the original 1h, 6h, and 24h decision
horizons. Feature/cause tags are descriptive co-occurrences, never causal
proof. Each evolution review records four one-change proposal families and an
`evidenceBoundary`; only later outcomes can evaluate those proposals.
The summary reports raw model-review rows separately from unique opportunities,
where an opportunity is the same chain, case-sensitive Solana mint, prediction
time, and horizon. Opportunity-level co-occurrence tags count a tag at most once
per such opportunity, so duplicated candidate or selection-timeframe forecasts
cannot inflate an evolution hypothesis.

### Future-only GeckoTerminal trending source cohort

The DEX surface sampler can repeat a narrow set of boosted/profiled tokens. A
separate shadow cohort tests whether GeckoTerminal's Solana one-hour trending
rank expands coverage early enough to improve exact one-hour payoff while
keeping the existing tradability and anti-chase screens unchanged:

```sh
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs capture \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs resolve \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs score \
  --ledger /absolute/research/path/ledger.jsonl

# Register the one-change five-minute-rank diagnostic.
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs register-fast \
  --ledger /absolute/research/path/ledger.jsonl

# Register the exact-pool/native-quote treatment and its clean scoring boundary.
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs register-fast-native \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs register-fast-native-score \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs register-liquidity-collapse-score \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs register-price-agnostic-collapse-score \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs register-fast-native-path \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs register-fast-native-rugcheck-holder \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs capture-fast-native-rugcheck-holder \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs mark-fast-native \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs score-fast-native \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-trending-monitoring.mjs score-fast-native-rugcheck-holder \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-trending-pools-shadow-v1` is future-only after
`2026-08-04T02:28:10.000Z`. It samples page one at the same 15-minute cadence,
keeps at most eight provider-ranked base tokens, and applies the same 15-minute
to 72-hour pair-age, $10,000 liquidity, $50,000-$5,000,000 market-cap, $1,000
hourly-volume, -20% to +25% hourly-change, and -50% to +150% daily-change
screens as the DEX surface parent. Entry and exit use the exact pool through
the existing DEX dual-endpoint lower-price/lower-liquidity integrity contract.
One open forecast per token and independent one-hour asset frames prevent a
repeated trending name from multiplying paper exposure. Every inspected
pre-registration row is excluded. Missing, late, mismatched, or tampered data
fails closed; an empty cohort is cash-only coverage evidence, never proof of an
edge.

The five-minute rank diagnostic, rule
`geckoterminal-solana-five-minute-trending-pools-shadow-v2`, changes only the
provider rank window. Its first eligible young pool exposed a point-in-time
indexing gap: DEX Screener's token-batch response omitted the exact pool while
its direct-pair response and GeckoTerminal's exact-pool response agreed. Rule
`geckoterminal-solana-five-minute-trending-native-quote-shadow-v3` therefore
changes only the entry/exit quote consensus to GeckoTerminal exact-pool plus
DEX Screener direct exact-pair, retaining the lower agreeing price and
liquidity. The inspected NVDA token and its immediate diagnostic forecast are
permanently excluded by a separately registered scoring rule. Only forecasts
created strictly after that scoring registration can enter
`score-fast-native`; repeated rows, expired windows, missing exact pools, or
cross-provider disagreement remain cash. The diagnostic V2 capture is not a
continuing payoff cohort.

All three continuing GeckoTerminal cohorts also share the future-only scoring
rule `geckoterminal-liquidity-collapse-outcome-accounting-v1`, registered at
`2026-08-04T03:59:45.199Z`. A forecast must be created strictly after that
registration to count. At the exact exit window, if both exact-pair execution
providers independently report no more than the frozen $100 paper notional in
liquidity, the monitor records a -100% gross, base-capacity, and stress-capacity
outcome. Positive mutually consistent prices, both nonnegative provider
liquidities, and the immutable provider-integrity record are still required.
This prevents a drained pool from disappearing into a missing-data bucket; it
does not change selection, repair an earlier forecast, or authorize a trade.

Accounting rule `geckoterminal-zero-liquidity-price-agnostic-accounting-v2`,
boundary `2026-08-04T09:42:30.000Z`, and registration
`monitoring_policy_registration_95fb5033f7f44b083231229d` at
`09:45:34.081Z` correct one remaining survivorship path for strictly later
forecasts. TOMOTHY had effectively zero exact-pair liquidity at both providers,
but their unusable stale prices differed by more than 3x, so v1 correctly left
it unscored under its frozen price-ratio contract. TOMOTHY and every prior
forecast remain excluded. For forecasts created after v2 registration, two
independent exact matching-pair liquidity values at or below $100 establish an
unexecutable total loss before the price-ratio check. Both positive provider
prices and their diagnostic ratio are retained, but the ratio cannot rescue a
position that neither provider says can exit. One-provider, wrong-pair,
missing, negative-liquidity, or otherwise malformed evidence still fails
closed. This changes outcome accounting only, never entry selection or trading
authority.

Path rule `geckoterminal-five-minute-native-quote-path-observation-v1` is an
observation-only extension sealed at registration
`monitoring_policy_registration_41b59d5d550979692987cdcc` on
`2026-08-04T05:33:31.421Z`. It can mark only V3 forecasts created strictly
after that registration, once per five-minute UTC bucket, using the same exact
GeckoTerminal-pool plus DEX Screener direct-pair quote integrity as entry and
exit. It never backfills a missed bucket, changes selection, defines an exit,
or treats an intrahour high as a fill. The earlier FROGE observation and all
open forecasts at registration are excluded; any exit challenger designed from
these paths needs its own later frozen boundary.

Holder-concentration rule
`geckoterminal-five-minute-native-quote-rugcheck-holder-concentration-v1`
is separately frozen after boundary `2026-08-04T05:57:30.000Z` and registration
`monitoring_policy_registration_c51ed4bd620da3cd9407996b` at
`06:02:01.796Z`. It preserves V3 selection, screens, exact quote, horizon,
capacity, and costs, and changes only the paper decision: long when a complete
pre-entry RugCheck aggregate reports no more than 30% unknown top-20 ownership
after known-account adjustment, otherwise cash. The 30% threshold was already
declared in the earlier DEX pulse RugCheck panel. Post-outcome reports for the
clean NVDA collapse (`80.877471%`) and Doom winner (`16.96053%`) motivated the
transfer but are permanently excluded and are not point-in-time evidence.
Future capture fetches aggregate-only evidence before the execution quote and
forecast timestamp; raw holder identities are never stored. Missing, late,
mismatched, unavailable, or tampered evidence is immutable child cash. The
child requires its own 252 observations/frames, 30 traded tokens, 64 traded
frames, 50 trades, positive base/stress and paired bootstrap bounds, and the
existing profit-factor, drawdown, and concentration limits.

### Future-only new-pool activation cohort

Trending feeds can still detect a pool only after market activity has already
accelerated. A separate newborn-pool watcher records a small, provider-ordered
page-one sample within five minutes of pool creation, waits until the existing
15-minute minimum pair age, and then applies the unchanged liquidity,
market-cap, hourly-volume, price-change, execution-integrity, capacity, and cost
contracts:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs register \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs resolve \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs activate \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs watch \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs score \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-fifteen-minute-activation-shadow-v1`
is future-only after `2026-08-04T03:27:20.000Z`. Each pool must have been
created strictly after registration, appear in a legal five-minute birth
observation, and receive one immutable activation decision 15 to 25 minutes
after creation. The activation uses GeckoTerminal's exact multi-pool response;
an eligible entry additionally requires the same exact pool from DEX
Screener's direct-pair endpoint, agreeing within the existing 1.10 price and
1.25 liquidity ratios. Blocked and candidate-specific provider-missing
activations are paper cash; an unavailable exact pool returned inside an
otherwise successful provider batch, or a token/pair/creation-time identity
mismatch, is sealed immediately as a missed cash activation and cannot be
retried into a later forecast. A provider-wide batch failure that returns no
pool rows, such as HTTP 429, writes no activation decision and remains
retryable inside the candidate's original activation window; an expired window
still seals as missed cash;
only the first pool per base token is watched and only one forecast per token
may remain open. Untrusted provider symbols are stripped of control and
bidirectional-format characters for display safety. A page-one birth sample is
not a complete Solana launch universe, and no empty or profitable-looking tiny
cohort is an edge. New-pool outcomes use the same registered liquidity-collapse
accounting described above, so a future pool drained below the paper notional on
both exact providers is a total loss rather than unscoreable missing data.

The newborn source also has a one-change market-cap-floor challenger:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-market-cap-floor-removed --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-market-cap-floor-removed --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-market-cap-floor-removed-v2`, boundary
`2026-08-04T05:02:00.000Z`, and registration
`monitoring_policy_registration_fb4424e81cd43d746b496200` at
`05:04:25.203Z` exclude 194 inspected activations and WALDO. WALDO was the only
inspection row that passed every other screen while remaining below the
parent's inherited $50,000 market-cap floor; its later diagnostic quote was
essentially flat and lacked complete dual-provider liquidity, so it is not
profit or executable evidence. The challenger removes only the lower cap
bound and still requires a positive market cap no greater than $5 million,
$10,000 liquidity, $1,000 hourly volume, the original age and anti-chase
bands, exact-pool/direct-pair agreement, $100 capacity, 4%/12% costs, drain-as-
total-loss accounting, independent frames, and all promotion gates. Parent-
eligible pools stay in the parent; the child can only admit a pool blocked on
that one dimension. It starts empty and cannot backfill, mutate, promote, or
trade.

The earlier-source timing transfer evaluates the same tradability screens on
the first retained newborn quote instead of waiting until minute fifteen:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-entry --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs watch \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  capture-birth-entry --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-birth-entry --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-five-minute-birth-entry-shadow-v3`,
boundary `2026-08-04T08:26:55.000Z`, and registration
`monitoring_policy_registration_be54ef3992208c0a133a856a` at
`08:30:43.253Z` exclude every previously observed pool and outcome. The source
quote must be available while the pool is zero to five minutes old and still
pass the inherited $10,000 liquidity, $50,000-$5,000,000 market-cap, $1,000
partial-hour volume, and -20%/+25% hourly plus -50%/+150% daily anti-chase
bands. Entry still requires the exact pool from DEX Screener's direct-pair
endpoint to agree with GeckoTerminal, and the lower price/liquidity is retained.
One open token across birth and activation cohorts prevents a second minute-15
paper position. The first future page-one sample contained no eligible birth
quote, so the score starts empty. This tests whether earlier observation fixes
coverage latency; it does not weaken execution, costs, exact one-hour outcome,
drain-as-total-loss, independence, breadth, or promotion gates.

The birth-entry cohort also has a disjoint one-screen low-cap child:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-market-cap-floor-removed \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-birth-market-cap-floor-removed \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-birth-market-cap-floor-removed-v4` is
future-only after `2026-08-04T08:37:10.000Z`. Before any birth-entry outcome
was known, two strictly future page-one samples were inspected for coverage.
DREAM alone passed every inherited birth-entry screen except the $50,000
minimum market-cap floor; DREAM, both samples, and every earlier quote are
excluded. The child removes only that floor and requires a positive cap below
$50,000. It preserves the five-minute source window, $5 million ceiling,
liquidity, partial-hour volume, anti-chase, exact-pair consensus, one-open-token,
$100 capacity, 4%/12% costs, exact one-hour outcome, drain-as-total-loss,
independent-frame, breadth, bootstrap, profit-factor, drawdown, and
concentration contracts. Parent-eligible and multiply blocked newborns cannot
enter the child, and the scorer fails closed on altered source quotes or rule
lineage.

KIO `Bt4faxPNLM1J8AWr736ddymEVYJsuLSFeec77MFU8Ha5` was sealed paper-long at
`2026-08-04T14:21:37.440Z` and resolved on time at `15:21:39.080Z` to an exact
two-provider `+914.026440%` gross return with `$95,316.56` selected exit
liquidity. Shiro then resolved `-92.922424%`, and Doom resolved as an exact
`-100%` liquidity collapse. After these ten resolved observations, v4 is
`+32.191147%` base and `+29.160389%` under stress across four independent
frames. It remains unproven: the 95% bootstrap interval is
`[-69.239354%, +160.965089%]`, profit factor is `1.929851`, maximum drawdown is
`99.705289%`, KIO supplies `85.1686%` of winning-frame profit, only ten of 252
observations and four of 252 frames are present, and
`provisionalGate` remains false.

A separate decision-time pair-age sibling tests whether waiting for a second
minute filters the most fragile newborns without adding any provider call:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-pair-age --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-birth-pair-age --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-birth-minimum-two-minute-age-v8`, boundary
`2026-08-04T13:47:05.000Z`, and registration
`monitoring_policy_registration_15587a4d6ea920147b995da2` at
`2026-08-04T13:52:52.740Z` began with zero eligible forecasts and change only
the v4 parent long/cash decision. The first strictly future parent, KIO
`Bt4faxPNLM1J8AWr736ddymEVYJsuLSFeec77MFU8Ha5`, was sealed at
`2026-08-04T14:21:37.440Z`; its immutable one-minute pair age makes v8 paper
cash while the unchanged parent is paper-long. KIO then resolved exactly
`+914.026440%`, so v8 correctly records a missed explosion and a `0%` cash
return rather than claiming the parent win. The second future parent, Shiro
`84MbokjpF4T9NhyKmpTbpKjedwuKtYHRP8MNRvb5pump`, also entered at age one and
therefore makes v8 cash; its first executable path was `-13.565334%` and its
exact outcome was `-92.922424%`. V8 therefore avoided Shiro's loss but also
missed KIO's much larger gain. Doom also entered at age one, so v8 held cash
before its exact `-100%` liquidity collapse. Its three cash observations return
`0%` with no traded frame. A
future parent remains paper-long when its immutable decision-time
`pairAgeMinutes` is at least two; a younger otherwise eligible parent is paper
cash. The round threshold is a natural one-minute confirmation step, not a
fine-tuned fractional cutoff. In derivation, it selected TikTok and MarsCoin
in one traded frame and would have produced +13.211999% base and +11.878666%
stress across three cash-inclusive frames, but the entire gain was concentrated
in TikTok. All nine inspected parent forecasts—including WIZARD with a missed
label and the distinct unresolved WEN—are excluded. The child freezes its age
and decision inside the parent forecast, fails closed on any mismatch, pairs
the unchanged exact outcome against the parent, includes paper cash in frame
returns, and preserves $100 capacity, 4%/12% costs, breadth, bootstrap,
profit-factor, drawdown, concentration, research-only, and zero-trade gates.
The derivation is sufficient to run a future test, not evidence of an edge.

A second independent sibling tests a round five-minute turnover ceiling:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-turnover --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-birth-turnover --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-birth-five-minute-turnover-cap-v9`, boundary
`2026-08-04T14:02:40.000Z`, and registration
`monitoring_policy_registration_51f08b1a5da86299796d9a98` at
`2026-08-04T14:07:19.596Z` began with zero eligible forecasts and change only
the v4 long/cash decision. The first strictly future parent is the same open
KIO forecast; its immutable `0.840667` five-minute turnover makes v9 paper
cash while the parent is paper-long. The second future parent Shiro has
immutable `0.182011` turnover, so v9 also
holds it in paper cash. KIO later resolved exactly `+914.026440%`, so v9's
first cash-inclusive observation is `0%` and misses the parent explosion.
Shiro later resolved `-92.922424%`, which v9 avoided in cash. Doom's immutable
`0.420429` turnover also held cash before its exact `-100%` collapse. Like v8,
v9 now has three cash observations returning `0%` with no traded frame; it
avoided two losses but also missed the much larger KIO gain.
A future parent is paper-long when immutable decision-time five-minute volume
divided by liquidity is at most `0.10`, otherwise paper cash. The cap ranked second in a declared
diagnostic of 17 natural one-field cuts: four selected resolved tokens across
three traded frames would have scored +11.496874% base and +8.669265% stress,
paired +44.444444 points, with two wins and one collapse. That breadth is
better than v8 derivation but remains multiple-tested and materially dependent
on TikTok. All nine inspected parent forecasts are excluded. The sibling does
not stack with v8, adds no request, freezes turnover and its decision inside
each future parent forecast, fails closed on tampering, includes cash in paired
frames, and preserves every source, outcome, capacity, cost, breadth,
bootstrap, risk, research-only, and zero-trade gate.

A third independent sibling preserves decision-time social-presence metadata
without selecting a trading filter:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-social-presence --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-birth-social-presence --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-birth-social-presence-panel-v10` is
future-only after `2026-08-04T14:10:05.000Z`; registration
`monitoring_policy_registration_19edbd9bccd7c34d3ebb50b4` was frozen at
`2026-08-04T14:17:08.356Z` with zero eligible historical or current forecasts.
The first future KIO forecast retained a complete privacy-safe absence panel:
no provider `info`, website, or recognized social channel was present. It then
resolved exactly `+914.026440%`, proving that recognized social presence was
not necessary for this explosion without proving that absence predicts one.
Shiro became the second future panel with one website but no recognized social
channel and resolved `-92.922424%`. Doom retained no website or recognized
social channel and resolved as a `-100%` liquidity collapse. Absence therefore
contains both the largest win and a total loss, while a website was not
sufficient in this tiny sample; these observations do not select a social
rule. LunarCrush's paid exact-topic
responses did not preserve canonical newborn Solana contract identity with
valid social aggregates, so they cannot support this decision-time join.
DexScreener's official token-pairs schema documents optional `info.websites`
and `info.socials` fields on the exact-contract response already required for
entry consensus. The panel reduces that existing response to bounded website
and social counts plus booleans for Twitter, Telegram, Discord, YouTube,
TikTok, Instagram, and Reddit. It never retains a URL, handle, post, account,
or creator identity and adds no request.

No historical exact-pair metadata was retained, so all nine inspected low-cap
parent forecasts are excluded and no backfill is permitted. Future aggregates
are frozen inside the parent forecast with a digest and exact registration
lineage. The descriptive scorer validates the parent and exact outcome, reports
only predeclared presence/absence slices, rejects altered aggregates, grants no
decision or promotion authority, and always keeps `provisionalGate: false`.
Any social-presence filter would require a separate one-field, one-threshold,
strictly future registration after enough observations exist.

The low-cap newborn cohort also has a pre-entry creator-balance challenger:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-creator-balance \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-birth-creator-balance \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-birth-creator-balance-v5`, boundary
`2026-08-04T09:54:30.000Z`, and registration
`monitoring_policy_registration_26170856b835b14f662ea469` at
`10:07:05.107Z` permanently exclude TikTok, MarsCoin, WIZARD, their reports,
paths, outcomes, and every earlier discovery. The child keeps the v4 entry and
exact one-hour outcome unchanged. Before each otherwise eligible v4 forecast,
it reduces one exact-mint RugCheck report to aggregate creator-balance
percentage and holder count; raw holder, owner, creator, and insider identities
are never retained. Complete evidence with reported creator balance at or below
the frozen round 10% ceiling is paper-long; missing, late, mismatched,
incomplete, or higher-balance evidence is paper cash. The ceiling is an
explicitly posthoc three-token hypothesis, not an edge result. Scoring requires
strictly future source/evidence/forecast timing, exact identity and digest
lineage, matched parent outcomes, cash-inclusive independent frames, $100 AMM
capacity, 4%/12% costs, circular-block bootstrap bounds, paired improvement,
and the full breadth, profit-factor, drawdown, and winner-concentration gates.
It cannot retry evidence into a sealed forecast, backfill, retune, promote,
mutate, or trade.

A separate sibling tests reported LP-provider presence without combining it
with creator balance:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-lp-provider \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-birth-lp-provider \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-birth-lp-provider-presence-v6`, boundary
`2026-08-04T10:41:40.000Z`, and registration
`monitoring_policy_registration_2856dc5c0fa9c44608bb28d1` at
`10:57:50.634Z` change only the v4 paper long/cash decision. The child
paper-longs when a complete pre-entry exact-mint RugCheck report contains an
integer `totalLPProviders` of at least one; zero, unavailable, invalid, late,
or mismatched evidence is paper cash. One provider request can be reduced into
separate creator-balance and LP-provider aggregates when both frozen siblings
are active, but their decisions and scorecards remain independent. The rule
was derived after mutable post-outcome reports perfectly separated TikTok from
four collapsed tokens, so TikTok, MarsCoin, WIZARD, PEPHEAD, Hthcity, all five
reports, paths, and outcomes are explicitly excluded. That five-token pattern
is overfit provenance, not evidence. The score includes cash in paired hourly
frames and retains exact outcomes, $100 capacity, 4%/12% costs, bootstrap,
breadth, profit-factor, drawdown, concentration, research-only, and zero-trade
gates.

After KIO's `+914.026440%`, Shiro's `-92.922424%`, and Doom's exact `-100%`
liquidity collapse, v6 remains the strongest current entry separator at
`+116.996368%` base and `+114.329702%` stress over six resolved observations
and two independent frames. It took KIO, held Shiro in cash, but also took Doom
because Doom reported one LP provider. This is concentration, not repeatability:
KIO supplies all winning-frame profit, only two frames exist, the current
bootstrap is degenerate rather than informative, maximum drawdown is
`25.974357%`, and every breadth and promotion gate remains false. LP-provider
presence may help, but Doom proves it is not sufficient protection.

The same pre-entry request can now preserve a broader observation-only safety
panel without changing either sibling decision:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-rugcheck-panel \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-birth-rugcheck-panel \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-birth-rugcheck-panel-v7`, boundary
`2026-08-04T11:44:00.000Z`, and registration
`monitoring_policy_registration_ef7941a650903b7c1832e2d6` at
`2026-08-04T11:49:32.658Z` retain only immutable decision-time aggregates:
normalized risk score, rugged flag, danger/warning counts and danger names,
insider counts, holder count, creator-balance percentage, exact-pair locked-LP
percentage/value, and provider detection time. No wallet, holder, or creator
identity is retained. The panel is observation-only: it cannot alter an entry,
exit, forecast, outcome, score, promotion, or trade. It applies only when both
the discovery and pool creation are strictly later than registration and
shares the existing exact-mint request, so activating it adds no provider call
for otherwise eligible low-cap newborns. TikTok, MarsCoin, WIZARD, PEPHEAD,
Hthcity, WEN, their mutable reports, and all earlier evidence are explicitly
excluded and cannot be backfilled. Future resolved observations can support a
one-change challenger only after an aggregate field shows an out-of-sample
association; this panel itself is not an edge claim. Its descriptive scorecard
joins only validated decision-time snapshots to exact resolved parent rows and
reports overall outcomes plus fixed coarse slices for risk score, rugged flag,
danger/warning counts, insider aggregates, holder count, creator balance,
locked-LP percentage/value, report age, and each observed danger name. The
scorecard has no decision or promotion authority and always keeps
`provisionalGate: false`; a usable association must become one separately
registered field/threshold on strictly later forecasts. The live panel now has
five exact outcomes across two frames. KIO's risk score 52, one unlocked-LP
danger, and `+914.026440%` outcome sit in the 51-70 slice; Shiro's score 1,
zero-danger, fully locked panel resolved `-92.922424%` in the 0-20 slice. The
51-70 slice has four observations, two wins, and two collapses after Doom's
score-64/four-danger panel resolved exactly `-100%`. Fixed danger-count slices
are sharper in this tiny sample: zero danger contains Shiro's loss, one to two
dangers contains three observations with two wins and one collapse, and three
or more contains Doom's collapse. Those are descriptive post-selection clues,
not a validated threshold.

One later sibling freezes exactly the panel's predeclared one-to-two danger
bucket as a strictly future long/cash test:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-danger-count --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-birth-danger-count --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-birth-danger-count-one-to-two-v12`, boundary
`2026-08-04T16:20:00.000Z`, and registration
`monitoring_policy_registration_c5c96eb7d959eff8f7c350f2` at
`2026-08-04T16:25:13.590Z` began with zero eligible forecasts. It changes only
the v4 paper long/cash decision: a complete pre-entry immutable RugCheck panel
with integer `dangerRiskCount` from one through two is paper-long; zero, three
or more, or unavailable evidence is paper cash. It reuses the already budgeted
RugCheck snapshot and adds no provider request. Every one of the 11 tokens with
a retained panel snapshot available during derivation—including KIO, Shiro,
and Doom—is explicitly excluded, so none can validate v12. The apparent seed
is only five exact outcomes in two frames, selected after inspection, dominated
by KIO, and still contains a collapse. In fact, all three selected rows had
exactly one danger; removing KIO leaves Halving's `-100%` collapse and
VIRALCOIN's `+29.582158%`, averaging `-35.208921%` gross and `-38.961535%`
after base execution costs. That leave-one-winner-out failure materially lowers
the prior and rules out any current RugCheck edge claim. The scorer validates evidence digest,
token/pair/pool/discovery timing, frozen decision fields, exact parent outcome,
cash inclusion, capacity, costs, independence, bootstrap, breadth, drawdown,
concentration, and zero-trade gates. Its verified 15,790-event starting score
is empty with `provisionalGate: false`; this is a falsification test, not a
profit claim.

The next sibling measures executable route quality without yet selecting a
trading rule:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-jupiter-roundtrip \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-birth-jupiter-roundtrip \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-birth-jupiter-roundtrip-panel-v13`, boundary
`2026-08-04T16:45:45.000Z`, and registration
`monitoring_policy_registration_72366128e4069b77992df1ef` at
`2026-08-04T16:57:52.243Z` preserve a decision-time public Jupiter quote panel
for at most two otherwise executable low-cap newborn parents per capture. It
quotes exactly `$100` USDC into the exact Solana mint and immediately quotes
the returned token amount back into USDC with exact-in mode, 100-basis-point
slippage tolerance, and restricted intermediate tokens. The immutable aggregate
retains only route coverage, quoted atomic amounts, round-trip return, price
impact, provider USD values, and hop counts. It retains no raw route and cannot
change an entry, exit, forecast, outcome, score, promotion, mutation, or trade.
At most four public Jupiter requests are added when two otherwise eligible
candidates pass the unchanged GeckoTerminal/direct-pair consensus.

The panel fails closed unless the pool and discovery are strictly later than
registration, the exact token/pair/pool/discovery lineage and aggregate digest
validate, and response availability precedes the forecast within the existing
five-minute capture window. It reports predeclared status, round-trip-return,
price-impact, and hop-count slices against exact one-hour outcomes with
`decisionAuthority: false`, `promotionAuthority: false`, and
`provisionalGate: false`. All 12 low-cap parent tokens available during design
are excluded. Read-only mutable post-outcome probes were useful only for
feasibility: one Halving probe had no buy route; VIRALCOIN, KIO, and Doom had
roughly total `$100` round-trip loss; Shiro lost about 12.13%. A later Halving
probe became routable, confirming that these mutable post-outcome checks cannot
be treated as frozen evidence. Those quotes were collected after their outcomes
and can never enter v13 or receive profit credit. The verified 15,792-event starting score has zero parents,
candidates, outcomes, frames, or authority. A later entry filter requires one
separately frozen field and threshold on only future v13 outcomes.

The executable-provider replacement is a separate paper cohort rather than a
retroactive v13 filter:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-jupiter-executable \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  resolve-birth-jupiter-executable \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-birth-jupiter-executable \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-birth-jupiter-executable-paper-v14`,
boundary `2026-08-04T17:10:00.000Z`, and registration
`monitoring_policy_registration_9ff097d8b72d73a53ef9a4f8` at
`2026-08-04T17:31:27.747Z` change one provider dimension from the
low-cap v4 source: entry and exit PnL use exact-in public Jupiter quotes instead
of requiring GeckoTerminal/DexScreener price consensus. At most two strictly
future low-cap candidates per birth capture quote exactly `$100` USDC into the
exact mint and immediately quote that returned amount back into USDC. Both
routes must quote for a paper-long decision. A definitive missing buy or sell
route is paper cash; a provider error is retained as unavailable and receives
no zero-return or profit credit. The already budgeted v13 panel reuses any v14
quote for the same token, so two overlapping candidates still require at most
four Jupiter requests rather than eight.

Each paper-long preserves the exact atomic token amount from the decision-time
buy quote. At exactly one hour, the resolver quotes that amount back to USDC.
A valid quote supplies the gross `$100` return, and a definitive no-exit-route
response scores `-100%`; provider failure retries only inside the existing
five-minute outcome window, while expiry is immutable missed evidence with no
PnL label. The quote already reflects route fees and price impact, but the
scorecard still deducts conservative 4% base and 12% stress haircuts. Paper
cash remains in the independent portfolio frames at zero. Provider-unavailable
and missed rows receive no PnL credit, and at least 95% resolved-decision
coverage is required before review.

Every decision and resolution validates the frozen registration, exact
discovery/token/pair/pool clocks, low-cap source screen, canonical quote digest,
atomic amount, decision, exact outcome lag, cost arithmetic, and no-raw-route
boundary. Promotion stays false until at least 252 matured observations and
252 independent frames cover 30 tokens, 50 paper longs, and 64 traded frames,
with a positive 10,000-sample bootstrap lower bound, positive stressed return,
profit factor at least 1.2, drawdown at most 25%, and largest-winner share at
most 35%. Clearing those event-level floors sets only
`statisticalCandidateGate`; it cannot promote v14. A separately reviewed
independent quant validation must still pass Newey-West significance,
Benjamini-Hochberg family control, purged out-of-sample degradation, CSCV
overfit probability, 2,000 shifted-signal placebos, deflated Sharpe,
factor-residual alpha, multi-regime breadth/concentration, and mean-return
reconciliation. Until then `independentQuantValidationStatus` is `not-run`,
`promotionAuthority` is false, and `provisionalGate` is false. PF and all 12
v13 derivation tokens are permanently excluded. PF's
unscored `-3.842463%` immediate diagnostic showed only that Jupiter coverage can
differ from Gecko/Dex consensus; it is not outcome or profit evidence. No v14
result authorizes a wallet, order, or live trade.

The verified 15,894-event registration score has zero v14 decisions, outcomes,
frames, or return estimates and `provisionalGate: false`. Every discovery and
pool already visible before registration is excluded by the strict clock
checks, including the 97 activation rows processed at `17:27:37.819Z`. The
first strictly future watch at `17:36:31.085Z` sealed 20 returned rows and 19
watchable newborns, but none met the low-cap birth source; capture spent zero
requests and created zero v14 decisions. The verified ledger therefore moves
to 15,895 events while v14 remains an empty collecting cohort.

The next source-screen hypothesis is isolated as an incremental cohort rather
than rewriting v4 or v14:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-upper-momentum \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-birth-upper-momentum \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-birth-upper-momentum-incremental-v15`,
boundary `2026-08-04T17:54:30.000Z`, changes only the inherited hourly upper
anti-chase ceiling. It admits newborns that pass every low-cap v4 screen except
that decision-time hourly price change is above 25% through 100%; v4 continues
to own the unchanged `-20%` through `+25%` baseline. The cohorts do not overlap,
so v15 cannot replace or duplicate a v4 entry. It reuses the same exact
GeckoTerminal/direct-pair consensus, `$100` capacity model, 4%/12% cost
haircuts, immutable one-hour resolution, independent frames, and frozen sample,
bootstrap, breadth, profit-factor, drawdown, and concentration floors. At least
95% of matured forecasts must have an integrity-valid exact resolution; missed
or rejected resolutions lower coverage and cannot disappear from the promotion
denominator.

This is a weak exploratory lead, not an edge. Before the boundary, 93
prospectively sealed discoveries contained 1,754 birth candidates and 668
observed birth-to-15-minute returns. Fourteen candidates in the selected
incremental band produced 11 `+25%` and five `+100%` gross 15-minute moves, but
only seven hourly frames. Their cost-adjusted frame bootstrap interval was
`[-66.906133%, +175.974818%]`, maximum drawdown was 100%, and one winner supplied
90.853% of positive PnL. The explored family contained seven screen variants;
all events at or before the boundary are derivation-only and permanently
excluded. Only strictly later exact one-hour outcomes can score v15.

Even if the standard event floors later clear, they set only
`statisticalCandidateGate`. Independent Newey-West, Benjamini-Hochberg,
purged-OOS, CSCV, placebo, deflated-Sharpe, factor, regime, and reconciliation
validation remains mandatory. Until it is separately reviewed as passed,
`independentQuantValidationStatus` is `not-run`, `promotionAuthority` and
`provisionalGate` are false, and v15 has no live-trading authority.

Registration `monitoring_policy_registration_c4170f931e2fef9f8851c6cd` was
frozen at `2026-08-04T17:59:50.158Z` on the verified 15,916-event ledger with
zero v15 forecasts or outcomes. The first strictly future watch at
`18:01:36.005Z` sealed 19 watchable newborns but no v15 incremental candidate.
It did seal one non-overlapping v3 TNOS forecast and one v14 Jupiter-executable
Scamnald paper-long. Scamnald's immediate Jupiter round trip was `-6.715839%`;
Gecko/Dex price disagreement correctly prevented it from becoming a consensus
forecast. TNOS's exact one-hour observation was legally recorded 298.693
seconds after its `19:01:37.212Z` due time and rose `+25.324991%` gross. That is
one real prospective win, but the standard v3 score remains decisively losing:
six eligible resolved forecasts across four independent frames average
`-69.751716%` after base capacity/cost accounting and `-71.751716%` under
stress. Its bootstrap interval is `[-100%, -9.255147%]`, profit factor is
`0.069977`, drawdown is 100%, and one frame supplies all positive PnL.
Scamnald's Jupiter exit quote arrived 49 milliseconds after the frozen exact
window and was immutably recorded missed with no return label or repair. V14
therefore has one matured decision, zero eligible outcomes, 0% resolved
coverage, and every gate false. V15 remains empty.

The next low-cap source-screen hypothesis is a separately frozen child of v4:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-low-momentum \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  score-birth-low-momentum \
  --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-birth-low-momentum-filter-v16`, boundary
`2026-08-04T19:08:30.000Z`, and registration
`monitoring_policy_registration_8b02e0797b6e73c3afe8cd49` at
`2026-08-04T19:16:46.152Z` change only one decision-time field for otherwise
eligible low-cap v4 parents: five-minute price change at or below `+5%` remains
paper long, while higher momentum is paper cash. Registration began on the
verified 15,987-event ledger with zero future parents, candidates, outcomes, or
frames and every gate false. The rule adds no request and keeps
the source quote, exact one-hour outcome, `$100` capacity model, 4%/12% costs,
independent frames, sample and breadth floors, bootstrap, profit factor,
drawdown, concentration, 95% resolved-forecast coverage, and independent quant
validation contracts unchanged.

V16 is a deliberately weak future falsification test, not a discovered edge.
Across 18 eligible birth-to-15-minute derivation rows in six frames, a declared
65-variant family found no candidate that passed minimum breadth, positive
stress and leave-one-token-out return, drawdown at most 25%, and winner share at
most 35%. The best mean-return slice was the `m5 <= +5%` rule: seven rows across
only four frames averaged `+102.350506%` base and `+95.349019%` stress, but had
72.10452% drawdown and 69.8428% winner concentration. All 18 inspected token
addresses, every ledger event through event 15,986, and every event at or before
the boundary are permanently derivation-only. They cannot validate v16 even if
their later outcomes look favorable.

The cash-inclusive scorecard counts every captured matured decision in the
resolution-coverage denominator; missed and rejected outcomes cannot disappear.
Even if all event-level floors later clear, the result can set only
`statisticalCandidateGate`. Independent Newey-West, Benjamini-Hochberg,
purged-OOS, CSCV, placebo, deflated-Sharpe, factor, regime, and reconciliation
validation must still pass separately. `promotionAuthority` and
`provisionalGate` are always false here, and no result authorizes a wallet,
order, or live trade.

The full watched cohort now has a separate strictly future delayed-label panel:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-delayed-shadow.mjs \
  register --evidence-boundary <ISO timestamp> \
  --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-delayed-shadow.mjs \
  score --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-full-cohort-delayed-shadow-v1` changes
measurement coverage only. For every watched pool from a discovery strictly
after registration, it records immutable exact-pair labels at one hour and 24
hours after the source discovery. Each horizon resolves at most one discovery
cohort per run through one GeckoTerminal multi-pool request, seals missing,
late, or identity-mismatched candidates as missed, and never retries after the
ten-minute observation window. The event preserves the birth-quote digest,
exact mint/pair/pool lineage, delayed quote, gross return, availability lag,
and research-only authority fields. The descriptive score applies the existing
`$100` constant-product capacity model and 4%/12% cost haircuts, but the panel
creates no forecast, long/cash decision, confidence claim, promotion candidate,
wallet action, or live-trading authority.

Registration `monitoring_policy_registration_61c47fbad84988fa8cdabe6a`
was frozen at `2026-08-04T20:12:28.842Z`, strictly after evidence boundary
`2026-08-04T20:02:38.660Z`, as event 16,030. It started with zero candidate,
observed, or missed delayed outcomes at both horizons. Every earlier discovery,
including ASTEROID's already-visible `+1301.439333%` birth-to-activation move,
is derivation-only and cannot validate the panel. A preregistered 13-variant
source-floor audit over 717 earlier birth/activation pairs found no robust
lower-liquidity or lower-volume edge; the unchanged `$10,000`/`$1,000` floors
had only seven traded frames, a negative bootstrap lower bound, 46.6314% winner
concentration, and negative worst leave-one-token-out stress. The delayed panel
therefore expands labels rather than weakening the failed execution screens.
The first legally future discovery,
`geckoterminal_new_pool_discovery_22b82f892e001009496a7882` at
`20:16:35.040Z`, sealed 18 pools and opened 18 one-hour plus 18 24-hour labels.
No label has matured yet. The same capture independently created one v14
Jupiter paper-long for PangJim, due at `21:16:36.859Z`, whose immediate exact
round trip was `-5.471089%`; that separate paper decision does not change the
observation-only delayed panel.

The future discovery stream also has a paired one-hour direction-and-magnitude
forecast panel:

```sh
hive-env-run -- node scripts/token-edge/onchain-geckoterminal-new-pool-forecast-ab.mjs \
  register --evidence-boundary <ISO timestamp> \
  --ledger /absolute/research/path/ledger.jsonl
hive-env-run -- node scripts/token-edge/onchain-geckoterminal-new-pool-forecast-ab.mjs \
  score --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-gemini-lunar-ab-forecast-v1` selects at
most two tokens from each strictly future discovery by a deterministic hash.
Gemini receives an anonymous immutable birth-market feature object and returns
schema-constrained one-hour rise direction, probability, signed return, and
confidence. The market-only control explicitly excludes social data, token
graph data, symbol, contract, token identity, outside knowledge, and web
search. Its paired treatment receives the identical market object plus only
exact-contract LunarCrush interactions, post count, creator count, AltRank, and
Galaxy Score. Symbol or ticker fallback is forbidden. Raw model responses are
not retained, invalid JSON is not repaired, and a sealed discovery is never
retried into a different forecast.

A ready prediction becomes paper-long only when it predicts a rise with at
least 0.60 probability and at least +12% return; otherwise it is paper cash.
Missing exact-contract treatment evidence is recorded as unavailable, remains
cash in the paper-PnL frame, and reduces explicit forecast-availability
coverage instead of disappearing. Accuracy and magnitude metrics include only
valid predictions, while outcome coverage and paper PnL retain blocked rows.
The score also reports paired direction, Brier, magnitude, and capacity-aware
return deltas under `$100` notional and 4%/12% costs. Minimum sample, coverage,
breadth, bootstrap, profit-factor, drawdown, and concentration gates cannot
authorize promotion or trading.

Registration `monitoring_policy_registration_8f6d920004122b03aa70de9d`
was sealed at `2026-08-04T20:40:48.871Z`, strictly after evidence boundary
`2026-08-04T20:26:41.270Z`. The first legal discovery sampled two tokens. Both
market-only forecasts predicted decline and stayed in cash. LunarCrush's
top-1,000 request returned no exact-contract match and both exact-contract
topic responses failed identity/aggregate validation, so both treatment
forecasts were immutably unavailable. That first cohort therefore measures
zero social coverage; it does not establish whether social data helps. Its
one-hour labels are due at `2026-08-04T21:41:22.882Z`.

A separately registered conditional challenger tests whether exact-contract
posts can rescue the topic endpoint's availability failures:

```sh
hive-env-run -- node scripts/token-edge/onchain-geckoterminal-new-pool-forecast-posts-rescue.mjs \
  register --evidence-boundary <ISO timestamp> \
  --ledger /absolute/research/path/ledger.jsonl
hive-env-run -- node scripts/token-edge/onchain-geckoterminal-new-pool-forecast-posts-rescue.mjs \
  score --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-solana-new-pool-gemini-lunar-posts-rescue-v2` is eligible
only when a strictly later v1 treatment is immutably blocked by
`exact-contract-lunar-social-evidence-unavailable`. It reuses that parent's
deterministic token set, already-sealed market-only control, anonymous market
features, one-hour clock, prediction schema, long threshold, capacity, and
costs. The sole intervention is replacing the unavailable topic aggregate with
an exact-contract `/posts/v1` aggregate. It requests at most two post corpora
and two treatment forecasts per discovery. Response config id and topic must
both preserve the exact case-sensitive contract. Raw posts, text, creator
identities, creator ids, and raw model responses are discarded.

Every topic-blocked parent remains in the conditional denominator. A failed or
invalid post response is unavailable paper cash; it cannot disappear from PnL,
inflate accuracy, or be retried into a later decision. Ready post aggregates
provide only interactions, post and creator counts, per-post/per-creator
ratios, and any already-captured exact-contract AltRank/Galaxy values. Symbol
fallback, graph data, outside knowledge, web search, repair, and backfill remain
forbidden. The score compares valid post forecasts with their exact market
controls and separately reports rescue availability, direction, Brier,
magnitude, and capacity-aware return deltas. It cannot promote or trade.

Registration `monitoring_policy_registration_83e4567ad784c6a84be5456d`
was frozen at `2026-08-04T21:05:25.293Z`, strictly after evidence boundary
`2026-08-04T21:05:10.000Z`. It starts at zero eligible parents. The historical
ledger showed 47 of 56 exact-contract post snapshots ready versus 35 of 70
topic snapshots, but those are availability observations only. The first v1
cohort and every earlier outcome are permanently excluded from v2.

Run the recurring GeckoTerminal research cadence through the guarded entry
point rather than replaying its constituent commands:

```sh
hive-env-run -- node scripts/token-edge/onchain-geckoterminal-heartbeat.mjs \
  --ledger /absolute/research/path/ledger.jsonl
```

The runner derives the active UTC minute-modulo-five phase inside the Node
process. Phases 0 through 3 wait only until seconds 05, 20, 35, and 50 of that
same absolute minute; phase 4 is immediate and provider-free after exact
resolvers. After exact outcomes, phase 0 resolves one due 24-hour delayed cohort
before provider-free birth-path and score work; phase 1 watches, seals the
paired forecast panel, and runs the remaining captures;
phase 2 activates; phase 3 resolves one due one-hour delayed cohort before
standard-mid and score work; and phase 4 scores. The four provider-capable
lower phases are separated by at least 75 scheduled seconds across the cycle.
A wait or dispatch that lands in another minute or at second 55 or later exits
without running stale work. The guard compares the exact scheduled UTC minute
as well as the modulo, so even a five-minute suspension cannot make an old
phase look current. An exact outcome with ten seconds or less before its window
closes is the sole stale-phase exception: only that due resolver runs, while
every path, watch, capture, activation, delayed shadow, and score remains
suppressed.

Every legal phase checks immutable generic and Jupiter exact outcomes first.
When a due window has ten seconds or less remaining, only due resolvers run;
Jupiter wins an exact deadline tie because its quote response previously missed
by 49 milliseconds. If an exact resolver records an outcome or spends a
provider request outside that emergency, every lower-priority path, watch,
capture, activation, delayed shadow, and score action is skipped. Otherwise the
frozen phase mapping is preserved, and score phases summarize every active
source, social/risk/provider panel, v15/v16 challenger, delayed-label panel, and
bracket without changing evidence.

This guard was added after an external wait released the minute-3 phase at
`19:33:50Z` but command dispatch did not begin until `19:34:02Z`. That stale run
made zero provider requests and appended no evidence, but it proved a narrated
time check was not atomic. The guarded runner has no trading, promotion,
mutation, repair, backfill, deployment, commit, or push authority.

Newborn birth forecasts also retain forward-only executable path points:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  register-birth-path --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-activation.mjs \
  mark-birth-path --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-new-pool-birth-five-minute-path-observation-v1` is
observation-only after `2026-08-04T09:06:30.000Z`. Each five-minute UTC bucket
may store at most one exact GeckoTerminal/direct-pair consensus point per open
v3 or v4 birth forecast, including verified dual-provider liquidity collapse.
An atomic bucket lock prevents overlapping monitor wakes from issuing duplicate
provider requests or IDs. Missing points remain missing. An already-open
forecast may receive points strictly after path registration only as a
diagnostic seed; it is permanently ineligible for any exit policy derived from
those points. The path never changes an entry, exact one-hour outcome, cost,
capacity, decision, score, promotion status, or trading authority.

The low-cap newborn entry has a separately frozen exit-only challenger:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  register --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  score --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-new-pool-birth-plus-ten-take-profit-v1`, boundary
`2026-08-04T09:27:00.000Z`, and registration
`exit_policy_registration_78d0ef8b52cb0680c5051a54` at
`09:31:40.421Z` exclude TikTok, Google, MarsCoin, every path inspected while
transferring the rule, and every forecast created at or before registration.
It preserves the v4 entry and exits fully at the first retained executable path
point at or above +10% gross; otherwise it uses the exact one-hour outcome.
The threshold is copied unchanged from an earlier sealed DEX-pulse exit policy.
It requires complete five-minute coverage with no gap over ten minutes, except
that a verified terminal dual-provider liquidity collapse completes the path
and remains a -100% result unless a valid earlier retained crossing exists.
The scorer retains $100 AMM capacity, 4%/12% costs, independent hourly frames,
paired bootstrap evidence, breadth, profit-factor, drawdown, and winner-
concentration gates. It cannot infer an unseen crossing, backfill, retune,
promote, mutate, or trade.

The exit policy also has a future-only causal path-validation sibling:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  register-prefix --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  score-prefix --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-new-pool-birth-plus-ten-prefix-complete-v2`, boundary
`2026-08-04T11:06:20.000Z`, and registration
`exit_policy_registration_7c3f5bf9f5547b26020c7c0a` at
`11:09:25.050Z` preserve the v4 entry, +10% full-exit threshold,
exact path quotes, costs, capacity, and every promotion gate. It changes only
the path interval that must be complete: when an executable +10% point exists,
cadence must be complete from entry through that retained exit, while later
path gaps after the hypothetical position is closed are irrelevant. A token
that never reaches the exit still requires the unchanged complete path through
its exact one-hour outcome, and a terminal drain before an exit remains -100%.
Hthcity exposed the issue after retaining +59% and +67% quotes before collapse;
Hthcity, PEPHEAD, TikTok, Google, MarsCoin, WIZARD, every inspected path, and
every forecast at or before registration are excluded. This correction is an
unproven future-only exit hypothesis, not a reconstructed win.

A later sibling adds the separately frozen -10% tail stop to bound the loss
side while preserving the causal full +10% exit:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  register-bracket --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  score-bracket --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-new-pool-birth-plus-ten-minus-ten-bracket-v3`, boundary
`2026-08-04T11:26:35.000Z`, and registration
`exit_policy_registration_90ce97c4c9efc07f8a0e813b` at
`11:29:43.369Z` change only the lower exit boundary. The policy exits the
entire paper position at the first retained executable point at or outside
`[-10%, +10%]`; the first hit is final, and a token with no hit uses its exact
one-hour outcome. The +10% behavior, causal prefix coverage, exact-provider
integrity, capacity, costs, and every breadth/promotion gate remain unchanged.
The -10% threshold is copied unchanged from the separately frozen
`token-edge-tail-preserving-stop-v1` policy. PEPHEAD, Hthcity, WEN, all earlier
newborns, paths, and outcomes are excluded. Their apparent counterfactual
benefit is derivation provenance only and cannot validate this sibling.

The first two strictly future resolved observations are Halving and VIRALCOIN.
Both reached a retained +10% boundary: after capacity and 4% costs their exits
return +12.182259% and +6.031966%, averaging +9.107113%; at the 12% stress
cost they return +4.182259% and -1.968034%, averaging +1.107113%. Halving's
exact hour was a -100% collapse and VIRALCOIN's was +29.582158% gross, so the
paired frame improves by 48.068648 points. This is positive prospective
evidence, not a promotable result: it is two tokens in one frame with no stop
examples, no bootstrap interval, and every breadth gate still materially
short.

A future-only reaction-latency sibling merges the already budgeted one-minute
path with the five-minute path before applying the unchanged bracket:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  register-fast-bracket --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  score-fast-bracket --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-low-cap-new-pool-birth-mixed-path-plus-ten-minus-ten-bracket-v5`
is future-only after `2026-08-04T14:45:30.000Z`; registration
`exit_policy_registration_c4ec0aba877e272374ef7623` was frozen at
`2026-08-04T14:50:39.316Z` with zero eligible history. Shiro's first executable
one-minute point was `-13.565334%`, then its first five-minute point was already
`-91.194274%`. KIO had already reached an executable `+286.430334%` five-minute
take-profit. These paths show why reaction latency could matter, but KIO,
Shiro, every earlier low-cap parent/path/failure/outcome, and all currently open
forecasts are excluded. The sibling adds no request and changes only which
independently valid preregistered path can supply the chronological first hit.
Entry, +10%/-10% thresholds, full exit, causal prefix coverage, exact-provider
integrity, liquidity-collapse accounting, $100 capacity, 4%/12% costs,
independent frames, breadth, bootstrap, profit factor, drawdown, concentration,
paper-only status, and zero-trade gates remain unchanged.

Doom `GPX9zjhWhssoGFNpcqvvydgizHqBHFUoGge4yEreC7A4` is the first untouched
post-registration v5 parent. It was sealed at `15:11:23.758Z`, but the frozen
two-slot one-minute observer was still occupied by KIO and Shiro. Doom's first
five-minute point at `15:15:06.324Z` was a verified `-100%` liquidity collapse;
its first one-minute-rule point at `15:22:40.123Z` was also a collapse. The
missing early cadence is preserved and cannot be backfilled. Doom resolved on
time at `16:11:25.105Z`, only `1.347` seconds after its exact due time, as an
exact `-100%` liquidity collapse. The frozen v5 scorer still grants no exit
credit: its merged path contains two terminal collapse events and is rejected
as `nonterminal-liquidity-collapse`. Rewriting either immutable event after the
outcome would be leakage. V6 excludes Doom and therefore also receives no
profit or loss credit from it.

A later future-only execution-availability sibling can treat a validated
nonexecutable provider disagreement as cadence presence without treating it as
a quote:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  register-attempt-covered-bracket --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  score-attempt-covered-bracket --ledger /absolute/research/path/ledger.jsonl
```

Rule
`geckoterminal-low-cap-new-pool-birth-attempt-covered-plus-ten-minus-ten-bracket-v6`
has boundary `2026-08-04T15:46:30.000Z` and registration
`exit_policy_registration_7b3cd2808e548d7e2dd0c4a5` at
`15:50:31.343Z`. It changes one dimension from mixed-fast v5: a tamper-validated
scheduled v11 price/liquidity disagreement can prove that the monitor attempted
execution for causal prefix cadence. It never supplies a price, return,
threshold hit, fill, or fixed-horizon mark. Consensus diagnostics are ignored
for coverage because their separately validated executable path is authoritative;
the first later executable exact-provider quote remains the only possible exit.
Holds still require the unchanged executable full-hour path.

KIO motivated the test because its early scheduled attempts disagreed before a
later executable `+286.430334%` point, but KIO, Shiro, Doom, every forecast
available at registration, and all earlier attempts, paths, failures, and
outcomes are excluded. The live 15,718-event score began with zero candidates,
observations, exits, or frames and `provisionalGate: false`. The focused future
lifecycle proves v5 rejects a 19-minute executable path-start gap, v6 accepts
three valid disagreement attempts only as cadence and exits at a later real
`+20%` quote, and tampering with the middle diagnostic reopens the gap and
rejects the observation. This is an execution rule under test, not KIO profit
credit or trading authority.

The unchanged bracket is also transferred prospectively to the standard-cap
newborn v3 entry as a separate source-cohort test:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  register-standard-bracket --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  score-standard-bracket --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-standard-cap-new-pool-birth-plus-ten-minus-ten-bracket-v4`,
boundary `2026-08-04T11:52:36.000Z`, and registration
`exit_policy_registration_a37bbe67eda00eff6b815064` at
`2026-08-04T11:56:26.900Z` change only the source cohort from the low-cap v4
newborn entry to the standard-cap v3 newborn entry. The frozen +10%
take-profit, -10% stop, first retained boundary, causal prefix completeness,
exact-provider path integrity, terminal-drain loss, exact one-hour fallback,
$100 capacity, 4%/12% costs, independent frames, bootstrap, breadth,
profit-factor, drawdown, concentration, and zero-trade gates are copied
unchanged. Standard-cap TikTok retained +12.305954%, +15.876535%, and
+19.903253% path marks before verified dual-provider collapse; Google also
collapsed. Those forecasts, every path and outcome, and all standard newborns
available at registration are excluded derivation evidence, not wins. The
transfer begins at zero future observations and cannot reconstruct either
counterfactual.

To determine whether the five-minute stop overshoot is avoidable, a separate
observation-only collector records exact low-cap newborn quotes once per UTC
minute for at most two open forecasts:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-fast-path.mjs \
  register --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-fast-path.mjs \
  mark --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-low-cap-newborn-one-minute-path-observation-v1`, boundary
`2026-08-04T11:31:30.000Z`, and registration
`monitoring_policy_registration_175308dfb4ce3aa0f06666e4` at
`11:35:39.785Z` preserve the v4 entry and use the same exact
GeckoTerminal/direct-pair quote and dual-provider collapse rules. It only
changes observation cadence from five minutes to one minute, orders open
forecasts by creation time/id, and caps each minute at two forecasts. PEPHEAD,
Hthcity, WEN, and all inspected paths are excluded. The events are not fills,
cannot enter the bracket, and cannot change forecasts, exits, outcomes, scores,
or trading authority until a later separately frozen rule is justified.

The same already budgeted one-minute request can also preserve a future-only
provider-disagreement panel:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-fast-path.mjs \
  register-disagreement --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-fast-path.mjs \
  score-disagreement --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-low-cap-newborn-cross-provider-disagreement-panel-v11` is
future-only after `2026-08-04T14:28:20.000Z`; registration
`monitoring_policy_registration_8c86a3e5ad3a65f4f682d913` was frozen at
`2026-08-04T14:36:57.342Z` with zero eligible history. KIO's first three scheduled path
attempts failed exact-provider price consensus before a later executable
`+286.430334%` mark. That sequence suggested that rapid provider divergence
could be informative, but KIO, every earlier low-cap parent, every prior path,
and every prior failure are excluded derivation evidence. The panel adds no
request: for later forecasts it reduces the GeckoTerminal exact-pool and
DexScreener exact-pair responses already used by the one-minute marker to
numeric price/liquidity values and ratios, with fixed consensus,
price-disagreement, liquidity-disagreement, and coarse price-ratio slices.
Shiro became the first future v11 parent. Its first diagnostic was consensus at
price ratio `1.016859` and liquidity ratio `1.016666`, paired with a separate
executable `-13.565334%` path mark; its exact outcome was `-92.922424%`.
V11's first scored consensus observation is therefore `-97.079391%` after base
capacity/cost accounting and `-100%` under stress. One observation cannot
support a disagreement direction or threshold.
It does not turn a disagreement into an executable quote, infer a price, select
a threshold or direction, alter an exit, or grant decision, promotion,
mutation, or trading authority. A tradable rule requires a separately frozen
one-field future intervention after enough exact outcomes exist.

The standard-cap source has a separate provider-budget-neutral mid-bucket
observer:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-fast-path.mjs \
  register-standard-mid --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-fast-path.mjs \
  mark-standard-mid --ledger /absolute/research/path/ledger.jsonl
```

Rule `geckoterminal-standard-cap-newborn-mid-bucket-path-observation-v2`,
boundary `2026-08-04T12:50:10.000Z`, and registration
`monitoring_policy_registration_dc9483715a18073b1ca66713` at
`12:53:33.758Z` add one exact quote during UTC minute three of each five-minute
block for at most two future standard-cap v3 forecasts. This replaces the
low-cap fast group at that phase rather than adding provider calls, creating
effective two-to-three-minute standard path spacing when combined with the
existing five-minute marker. WFI first appeared at `-49.446089%`, while BAKI
and TikTok reached +10% before later collapse; WFI, BAKI, TikTok, Google, every
inspected path/outcome, and all forecasts available at registration are
excluded. The rule retains exact cross-provider integrity, deterministic
selection, terminal-collapse suppression, atomic per-rule buckets, privacy,
and missing-point semantics. Its observations are not fills and cannot change
the standard bracket, score, threshold, promotion, or trading authority. The
first live phase correctly spent zero requests because no future standard
forecast existed yet.

The mid-bucket evidence can affect exits only through a separately frozen,
strictly future challenger:

```sh
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  register-standard-mid-bracket --ledger /absolute/research/path/ledger.jsonl
node scripts/token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs \
  score-standard-mid-bracket --ledger /absolute/research/path/ledger.jsonl
```

Rule
`geckoterminal-standard-cap-new-pool-birth-mixed-path-plus-ten-minus-ten-bracket-v5`
has boundary `2026-08-04T13:28:05.000Z` and registration
`exit_policy_registration_b76bb32e44cfaed05bd63649` at
`2026-08-04T13:33:33.483Z`; it begins with zero eligible forecasts and changes
only path reaction latency. The scorer merges valid five-minute standard path events with valid preregistered
minute-three standard events, orders them by observation time, and applies the
unchanged first-hit +10%/-10% full exit. It independently validates each event
against its own frozen registration, exact GeckoTerminal/direct-pair quote,
liquidity, timing, source forecast, pool, token, and return. Entry screens,
thresholds, causal-prefix requirements, exact one-hour fallback, terminal
drains, $100 capacity, 4%/12% costs, breadth, bootstrap, profit-factor,
drawdown, concentration, research-only status, and zero-trade gates remain
unchanged. Google, TikTok, BAKI, WFI, Koo, all their paths/outcomes, and every
standard forecast available before the new registration are derivation-only
and excluded; no earlier mid point can become a reconstructed fill.

APED `BgHmzNQVjtAr5RRxyj5HnXXwqBSqH8vjsK27cozdd2ry` is the first untouched
future parent for this mixed-path rule. Its standard-cap entry was sealed at
`2026-08-04T15:06:23.282Z` with `$20,880.58` selected executable liquidity,
`$314,516.913` market cap, `0.276879435` five-minute turnover, and an exact
one-hour outcome due at `16:06:23.282Z`. The first scheduled minute-three quote
at `15:08:50.660Z` was executable at `+10.507767%` with `$22,928.16`
liquidity, so the already frozen mixed rule has a prospective take-profit hit.
Repeated exact-provider retries could not obtain a positive exact one-hour
quote. At `16:11:25.105Z`, after the frozen five-minute resolution window,
APED was immutably recorded as `exact-one-hour-window-expired` with no gross
return or label. The earlier +10% path hit remains valid observational evidence
but cannot validate either standard bracket without a paired exact parent
outcome. Both scorecards therefore receive zero completed-observation or profit
credit; the miss is preserved rather than retrospectively substituted.

If the monitor wakes after an observation window has already expired, keep the
original missed resolution and recover only the outcome from Nansen's exact
historical 1-minute candle:

```sh
hive-env-run -- node scripts/token-edge/onchain-forward-research.mjs recover \
  --timeframe 1m \
  --max-nansen-credits 2 \
  --ledger /absolute/research/path/ledger.jsonl
```

Recovery appends a separate `resolution-recovery` event with the missed event,
provider, exact candle interval, historical close time, and later recovery time.
Scorecards count live and recovered observations separately and accept at most
one closed outcome per forecast. Historical candles are outcome measurement
only; they never enter a forecast, repair missing point-in-time signals, or
qualify for the execution-capacity scorecard.
The recovery order is frozen: prefer the exact due-minute Nansen candle; if that
feed has a gap, query the snapshot's recorded deepest pool with
`include_empty_intervals=true`; if the pool also lacks coverage, an explicit
Nansen `--timeframe 5m` pass may use the first containing candle's close only
when that close remains inside the original forecast tolerance. Each source and
timeframe stays visible in the appended event. The pool fallback is separately
request-budgeted:

```sh
node scripts/token-edge/onchain-forward-research.mjs recover-pool \
  --max-gecko-requests 5 \
  --ledger /absolute/research/path/ledger.jsonl
```

Inspect integrity and the closed-only scorecard:

```sh
node scripts/token-edge/onchain-forward-research.mjs inspect \
  --ledger /absolute/research/path/ledger.jsonl
```

Nansen is off by default. It requires both an explicit profile and a hard
attempted-credit ceiling:

```sh
hive-env-run -- node scripts/token-edge/onchain-forward-research.mjs collect \
  --chain solana \
  --tokens TOKEN_A \
  --nansen-profile full \
  --max-nansen-credits 14 \
  --ledger /absolute/research/path/ledger.jsonl
```

`core` costs at most nine endpoint credits per token. `full` costs at most
fourteen and includes the five-credit PnL leaderboard. Holders and PnL are five
credits each under the current provider schedule. Buyer and seller leaderboards
are separate one-credit calls, preventing a BUY-ranked sample from masquerading
as a representative seller sample. Holder `total_inflow` and `total_outflow`
values are stored as token amounts; only fields explicitly denominated in USD
enter USD aggregates. Failed calls still count against the harness's
attempted-credit ceiling. Provider billing remains authoritative.

The default ledger path is
`$XDG_STATE_HOME/research/token-edge/onchain-forward-ledger.jsonl`, falling back
to `~/.hivemindos/research/token-edge/onchain-forward-ledger.jsonl`. Set
`HIVEMINDOS_TOKEN_EDGE_LEDGER` to override it.

## Interpretation

The ledger reports:

- directional accuracy for all ready forecasts;
- raw matured forecasts separately from non-overlapping signal frames;
- live point-in-time outcomes separately from historical OHLCV recoveries;
- provider and discovery-timeframe scorecard slices for selection A/B tests;
- precision and gross/net return when the model predicts a rise;
- return after a frozen 4% round-trip friction assumption;
- separately registered $100 paper-notional return after constant-product entry
  and exit impact, at 4% base friction and 12% stress friction;
- capacity-eligible live outcomes, pre-policy/malformed exclusions, historical
  recovery exclusions, and cumulative fixed-notional paper PnL;
- 25%, 50%, and 100% explosion hit rates in the raw resolution events;
- magnitude mean absolute error and Brier score;
- Wilson 95% lower confidence bound for directional accuracy.
- independent equal-weight traded-frame return, bootstrap interval, profit
  factor, drawdown, largest-winner concentration, and 3x-cost stress;
- immutable retrospective error classes plus proposal-only evolution reviews.
- future-only paired challenger-versus-parent returns, bootstrap deltas, outcome
  reconciliation, and evidence shortfalls.

Direction accuracy and payoff are deliberately separate. A low win-rate arm
can be economically interesting only if the independent-frame payoff gates
pass without reliance on one outsized winner. Conversely, a high accuracy arm
that loses after costs is not an edge.

DEX Screener observations use the deepest base-token pool. A future Solana
largest-account fallback must remain labelled as raw token-account
concentration: liquidity-pool vaults can appear among the largest SPL token
accounts, so that value is not interchangeable with classified holder
concentration.
