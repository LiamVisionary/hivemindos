---
name: kill-my-thesis
description: Cross-family adversarial gate for research theses and investment writeups. Run after a thesis/wiki is synthesized and BEFORE anything drafted from it ships. Routes the thesis to a non-Anthropic model (Grok/Gemini) for hostile review and returns a fail-closed PUBLISHABLE / NEEDS WORK / DO NOT PUBLISH verdict. Use for "kill my thesis", "stress-test this thesis", "adversarial check", "red-team this writeup", or before publishing any research note, market call, or conviction-tiered claim.
---

# Kill My Thesis

Adversarial review of a thesis by a model from a **different family** than the one that wrote it. If the same model family both synthesizes a thesis and reviews it, the review inherits the same training data, alignment process, and priors — a model reviewing itself with a different temperature. When the synthesis layer is Claude, the reviewer must not be Claude; the bundled script enforces this and refuses any Anthropic-family model id.

## When it runs

- After a research wiki/thesis is synthesized, before the first draft is written from it.
- Again after every wiki revision, until the verdict is PUBLISHABLE.
- Before any research note, market call, or conviction-tiered claim ships to an outward channel.

This gate is **fail-closed**: no reachable reviewer, no parseable verdict, or a non-PUBLISHABLE verdict all block shipping. An error is a block, not a pass.

## Invocation

The script ships with this skill at `scripts/kill_my_thesis.mjs` (installed under the shared brain at `Skills/kill-my-thesis/scripts/`). Node 18+ required.

```bash
hive-env-run -- node "<shared-brain>/Skills/kill-my-thesis/scripts/kill_my_thesis.mjs" \
  path/to/thesis.md \
  [--out path/to/verdict.md] \
  [--topic "extra reviewer context, e.g. 'sell-the-news risk, comparable precedent X'"] \
  [--model <non-anthropic-model-id>]
```

- Keys load from the shared hive env via `hive-env-run` (`OPENROUTER_API_KEY` preferred; `GEMINI_API_KEY`/`GOOGLE_API_KEY` as Google-direct fallback). Never paste key values. If neither key is set, the gate reports the missing key names and blocks — it does not pass silently.
- Default reviewer chain: Grok 4.3 via OpenRouter → Gemini 2.5 Pro via OpenRouter → Gemini 2.5 Flash via OpenRouter → Gemini 2.5 Pro via Google direct. Model ids drift; when the primary 404s the chain falls through and the provider's deprecation error names the replacement — update the list in `scripts/kill_my_thesis.mjs` when that happens.
- `--topic` sharpens the review the way a specific search string sharpens a search; use it to name the risk you already suspect.

## Exit codes and verdicts

| Exit | Verdict | Action |
|---|---|---|
| 0 | PUBLISHABLE | Proceed to draft/ship. |
| 2 | NEEDS WORK | Fix the named section(s) in the thesis, save as a new version (never overwrite), rerun. |
| 3 | DO NOT PUBLISH | Structural flaw. Escalate to the user; decide salvage vs. abandon. |
| 1 | none (fail-closed) | No reviewer reachable or no parseable verdict. Do NOT ship; report the blocker. |

## Report format (the delivery proof)

The verdict file is the receipt. It carries frontmatter (`verdict`, `reviewer_model`, `reviewer_provider`, `thesis_file`, `reviewed`) plus five sections: **Key Line Audit** (weakest claim + what confirms/invalidates it — read this first, it is the actionable output), **Unstated Assumptions**, **Structural Bear Case**, **Kill Conditions** (exactly 3, measurable), **Verdict**. Never report a verdict without this file existing on disk.

## Rules

- Never overwrite the reviewed thesis when fixing it — write a new version (`-v2`, `-v3`) so v1 → verdict → v2 stays auditable.
- Never route the review to a Claude/Anthropic model, even if asked casually; explain the independence requirement instead.
- Kill conditions from a PUBLISHABLE report belong in the published note and in the `research-call-tracker` ledger row (install that skill for the accountability side).
- Cost is roughly $0.50–$2 per run through OpenRouter. Fine per note; don't loop it in unattended automation without a cap.
