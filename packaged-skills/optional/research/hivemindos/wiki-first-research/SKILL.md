---
name: wiki-first-research
description: Scaffold and run a research project (token, equity, macro, sector, or general) with the wiki-first discipline - raw sources in, synthesized wiki, cross-family kill-my-thesis gate, versioned never-overwritten drafts, and a research/ vs process/ split. Use for "research X", "start a research project", "write a research note/thesis on X", "deep dive on X", or any session meant to end in a published research artifact with a conviction tier.
---

# Wiki-First Research

The rule that carries the whole workflow: **build the wiki before writing a single word of the note.** The wiki is not a draft — it is the structured knowledge dump (data organized, sources cited, angles mapped, kill conditions named) that the draft is written *from*. A good wiki makes a 2-hour draft; a bad one makes a 6-hour draft with data holes and a NEEDS WORK verdict.

## Project scaffold

Create under the folder the user designates (default `~/Documents/Research/<slug>` if they name none — raw data blobs do not belong in the shared brain vault):

```bash
mkdir -p <project>/{research/{raw,wiki,outputs},process/raw}
```

- `<project>/CLAUDE.md` (or `AGENTS.md` for non-Claude runtimes) — resumability doc: status table (data collection / wiki / kill-my-thesis / draft / published), decisions made, angles, kill conditions, next step. Update it at session start and session close; it is what makes the project resumable without re-briefing.
- `research/raw/` — every source that informs the wiki lands here first (tool outputs, extracts, transcripts, sentiment pulls). No drafting from memory or from un-exported browser context.
- `research/wiki/` — the working synthesis for THIS project (durable knowledge goes to the shared brain at close; see below).
- `research/outputs/` — versioned drafts.
- `process/` — the meta layer: `research-process.md` (which tools fired, in what order, what the verdicts were) plus screenshots/artifacts in `process/raw/`. Kept separate because the workflow documentation is itself a publishable artifact; mixed into research/ it becomes invisible.

## The protocol (no-skip order)

1. **Recall before researching.** `hive-brain answer "<topic>"` and a compiled-wiki search — prior coverage, open positions, and lessons on the topic may already exist in the shared brain; starting from zero is the failure this skill exists to prevent.
2. **Collect data into `research/raw/`.** Use the discovered data tools for the asset class (market data, on-chain intelligence, filings, sentiment via the configured search capability). Sentiment queries should be specific: name the catalyst and the suspected risk, not just the ticker.
3. **Build the wiki** in `research/wiki/<slug>-fundamentals-v1.md`: thesis (2–3 sentences), metrics table with sources and as-of date, fundamentals, catalyst analysis, sentiment section, **kill conditions (specific and measurable)**, prior coverage.
4. **Gate it:** run the `kill-my-thesis` skill on the wiki (install it alongside this skill). NEEDS WORK → fix the named sections in a NEW wiki version (`-v2`), rerun until PUBLISHABLE. The v1 → verdict → v2 chain stays on disk; that is what makes the adversarial step auditable.
5. **Draft** in `research/outputs/`: `v1` structure and data, `v2` voice pass (apply the user's writing-style skill if one is installed), further versions as needed. **Never overwrite a version.** The `-final` suffix is reserved for the exact version that shipped.
6. **Publish and log:** the note ships with exactly one conviction tier (High / Medium / Speculative) and its kill conditions named. Log the call per the `research-call-tracker` skill at publish time — no row, not published.
7. **Close the session — this is where compounding lives:**
   - Distill durable findings into the shared brain: `hive-brain remember` for typed facts/lessons/decisions, and the compiled brain wiki (per the `hive-brain-compiled-wiki` skill) for entity/topic knowledge future sessions should query. The shared brain **is** the cross-session wiki — do not build a parallel private index.
   - Update the project resumability doc and `process/research-process.md`.

## Data hierarchy when sources conflict

On-chain/primary data → fundamentals (revenue, TVL, users, filings) → market data → sentiment. Sentiment is signal, never evidence: if the crowd says one thing and primary data says another, primary data wins and the crowd take moves to the bear case.

## Boundaries

- The gate (step 4) and the log (step 6) are fail-closed; skipping either on a shipping note is a blocker to surface, not an optimization.
- Project folders hold working material; durable knowledge goes to the shared brain at close. Never store secrets or private network addresses in either.
