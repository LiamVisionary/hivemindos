# Trade Journal

The position record — separate from the Call Tracker (the research record). A call becomes a journal entry only when it has a trade setup; `skip` is a valid outcome for research with no actionable position. Discipline: thesis first, confirmation trigger second, stop always, no averaging down. Managed per the `research-call-tracker` skill.

Status values: `Watching` (thesis built, entry not triggered) · `Open` (live, must have a stop) · `Closed`

## Positions

| Opened | Asset | Thesis | Confirmation trigger | Size | Entry | Stop | Target(s) | Status | Closed | Outcome | Post-mortem (one line) |
|---|---|---|---|---|---|---|---|---|---|---|---|

## Rules

- No position moves to `Open` without a live stop recorded in its row.
- Post-mortem is mandatory at close, one sentence: what the thesis got right, what it missed, and whether the exit was disciplined or emotional.
- Execution/paper-fill mechanics live in the user's configured trading rails; this journal is the decision record, not the fill record.
