---
name: research-call-tracker
description: Log, update, and close published research calls and positions in shared-brain ledgers (Operations/Research/Call Tracker.md and Trade Journal.md), and compute the measured win rate. Use whenever a research note, market call, thesis, or trade idea is published or shipped; when a position opens, closes, or hits a stop/kill condition; or when asked "what's our win rate", "log this call", "update the tracker", or "close the position".
---

# Research Call Tracker

Outcome accountability for research. A researcher who publishes calls without tracking them has no feedback loop between thesis quality and results — win rate becomes remembered instead of measured. This skill maintains two ledgers in the shared brain vault:

- `Operations/Research/Call Tracker.md` — the research record: one row per published call.
- `Operations/Research/Trade Journal.md` — the position record: one row per actual position, with entry discipline.

If either ledger does not exist yet, seed it from the matching file in this skill's `templates/` folder (copy verbatim, then set the `Last updated` date). Never invent a different table shape — future sessions and stats depend on the columns staying stable.

## The publish-time rule (fail-closed)

A research call is not "published" until its Call Tracker row exists. Log the row **at publish time**, never retroactively — the entire value of the ledger is that conviction tier, entry zone, stop, and kill conditions were committed before the outcome was known. If a note ships through you and has no row, that is a blocker to surface, not a detail to skip.

## Logging a new call

Append a row with: date (absolute, YYYY-MM-DD), asset, venue published to, conviction tier (`High` / `Medium` / `Speculative` — exactly one, always), entry zone, stop, target(s), status `Watching` or `Open`, thesis in one line, the sharpest kill condition, and a link to the adversarial verdict file (from the `kill-my-thesis` skill, if installed) or the note itself.

Journal entry: only if there is a real trade setup (entry + confirmation trigger + stop). Otherwise the call is research-only; `skip` is a valid outcome.

## Updating and closing

- `Watching → Open` when the confirmation trigger fires; the journal row must carry a live stop before it reads `Open`.
- Close with `Closed (Win)` / `Closed (Loss)` / `Closed (BE)` plus outcome % in the tracker, and a one-sentence post-mortem in the journal: what the thesis got right, what it missed, disciplined or emotional exit.
- A kill condition firing is a close signal, not a debate prompt. Surface it to the user the day it fires.

## Stats

Recompute the tracker's Stats block whenever any call closes: total, closed count by outcome, win rate (wins ÷ closed, BE excluded from both sides), average return on closed. Only Closed rows count — open positions are hope, not results. Update the `Last updated` date.

## Boundaries

- This is the decision record. Fill mechanics, paper trading, and live execution stay in the wallet/trading rails the user has configured.
- Never edit or delete historical rows to improve the record; corrections get a note in the row, not a rewrite.
- Ledger rows may name prices and levels but never keys, balances, or private network addresses.
