# Packaged Agents

This folder is the product-facing catalog of HivemindOS **agent subclasses** (worker classes). It is the agent analogue of [`packaged-skills/`](../packaged-skills/README.md): a single source of truth for the built-in agent classes plus a store of optional, installable specialist agents.

An agent subclass is **runtime-agnostic**. Each one is an `AGENT.md` file describing a soul (identity/voice/boundaries), a task profile, a quality bar, and preferred skills. HivemindOS injects that profile into whichever runtime the agent runs on (Claude Code, Codex, Gemini, Hermes, OpenClaw, Aeon, …) through the per-runtime prompt delivery matrix in `src/lib/services/chat/hivemind-system-prompt.ts`. Nothing here is tied to a single agent vendor.

```text
packaged-agents/
  auto-install/
    <class-id>/
      AGENT.md
  optional/
    <category>/
      <source>/
        <slug>/
          AGENT.md
          .hivemind-agent-source.json
```

## Auto-Install

`auto-install/` holds the **built-in** agent classes that ship with HivemindOS (`general`, `planner`, `code`, `vision`, `writer`, `research`, `artist`, `ops`, `qa`, `security`, plus the `queen` soul). These are the source of truth for `src/lib/config/bee-worker-presets.ts` / `bee-worker-souls.json`: edit the `AGENT.md` here, then regenerate.

Keep this set small and foundational. Every HivemindOS install gets these classes.

## Optional

`optional/` is a store/catalog of installable specialist agents (the "browse agents" surface in the Agent Settings modal). They must **not** be auto-loaded into any agent's context. When a user installs one, the app copies the package into the user's custom worker classes (`CustomWorkerClassProfile`) so it appears in the selectable agent list — the same shape a hand-authored custom class uses.

Optional agents may be flat (`optional/<slug>/`) or grouped by catalog category (`optional/<category>/<source>/<slug>/`). A grouped directory can expose a whole-directory pack, installing every agent in one pass from local files (no upstream installer commands run).

## The `AGENT.md` format

Frontmatter carries the structured profile; the body carries the prose. String scalars are JSON-quoted so values containing `:` and `;` round-trip exactly.

```markdown
---
id: code
tier: built-in
label: "Engineer"
summary: "Programming, debugging, tests, APIs, automation, and repo work."
modelHint: "Use a strong coding model for multi-file changes or architecture work."
skillSlugs: ["karpathy-guidelines","test-driven-development","browser"]
---

## Soul

You are {{agentName}}, the engineer bee for HivemindOS.
...

## Task Profile

Engineer bee: implement code changes, debug failures, ...

## Quality Bar

Done means the change builds, relevant tests/type/lint checks pass, ...
```

- `id` — the worker-class id (built-in) or a custom slug (optional).
- `tier` — `built-in` or `optional`.
- `{{agentName}}` in the Soul section is replaced with the agent's name at render time.
- Optional agents also carry `.hivemind-agent-source.json` provenance (source repo, license, commit) like packaged skills.

## Tooling

`scripts/packaged-agents.mjs` keeps the folder and the compiled presets in sync:

- `node scripts/packaged-agents.mjs export` — write `auto-install/<id>/AGENT.md` from the current built-in presets/souls (bootstrap / refresh).
- `node scripts/packaged-agents.mjs verify` — round-trip the `auto-install/` `AGENT.md` files back into presets/souls and assert they match the compiled source exactly (fidelity gate; fails on drift).
- `node scripts/packaged-agents.mjs --list` — list discovered agent packages.

`scripts/import-packaged-agents.mjs` vendors external agent collections into `optional/<source>/<slug>/AGENT.md`, normalizing each to the runtime-neutral format (keeping only name/description/system-prompt) and pinning a `sha256` per agent in `agents-lock.json`:

- `node scripts/import-packaged-agents.mjs --list` — show configured sources.
- `node scripts/import-packaged-agents.mjs wshobson` — import a source (`--dry-run` to preview).
- `node scripts/import-packaged-agents.mjs --verify` — re-hash vendored agents against the lock.

Current optional catalog: `wshobson/` — 192 specialist agents from `wshobson/agents` (MIT) across ~78 domains, browsable and installable from Agent Settings → Browse. Installing one adds it as a selectable custom worker class on the current agent.

Any packaged-agent addition, removal, rename, or source change must update this README and the GitHub Pages docs under `docs/packaged-skills/` alongside it.
