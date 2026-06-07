---
name: hive-assimilate
description: Mandatory pre-build Hive assimilation workflow for software creation. Use before any request where the user asks an agent to build, scaffold, prototype, implement, create, make, code, or add an app, website, tool, dashboard, game, API, feature, integration, UI, workflow, or software project. Search the user's shared brain, relevant local/user project repositories, private/local indexes, and public GitHub before building from scratch; treat pinned sources as authoritative; audit and reuse concrete files, modules, patterns, tests, schemas, or assets with provenance.
---

# Hive Assimilate

## Core Rule

Before implementing a build request, look for reusable parts across the whole hive. Treat the shared brain, Liam's local projects, private indexes, and public GitHub as a parts library, not as projects to blindly merge.

The goal is to save time, tokens, and mistakes by assimilating concrete source, durable project knowledge, tested workflows, and implementation evidence before writing new code.

Reference-only use is a failed assimilation. "Borrowed patterns", "used as inspiration", "looked at the API shape", or "wrote a compact implementation myself" does not satisfy this skill unless the user explicitly asked for a from-scratch implementation.

Mostly custom implementation is also a failed assimilation. If the agent would honestly answer "mostly my own implementation tokens/code", stop and search the hive again for stronger source material before finalizing.

## Search Order

User-supplied sources are authoritative. If the user names or links a specific repo, local checkout, fork, branch, PR, project folder, Obsidian note, shared skill, or says to use something "for context", "as the source", "as the backbone", or similar, inspect that pinned source first.

When a pinned source exists:

1. Parse the request into capabilities, stack constraints, runtime, integrations, UI needs, non-goals, and the exact supplied source.
2. Inspect the supplied source first. Do not replace it with a higher-star public repo merely because public search found one.
3. Audit enough of the supplied source to establish it is safe to read from, then audit selected paths before reusing code.
4. Identify concrete files, modules, components, schemas, utilities, config, tests, algorithms, assets, notes, or workflows from the supplied source that answer the request.
5. Use shared-brain and local-project search only for missing context or donor parts the pinned source does not cover.
6. Search public GitHub only for gaps, alternatives the user requested, or areas where the hive has no usable source.
7. Log why any extra discovery was needed.

When there is no pinned source:

1. Parse the request into capabilities, stack constraints, runtime, integrations, UI needs, and non-goals.
2. Search the shared brain with `hive-brain answer "<query>" --scope full-vault` before relying on prior context. Use `hive-brain recall "<query>" --scope full-vault --limit 8` when a hit list is more useful than a synthesized answer.
3. If the task is about choosing available hive capabilities, load and use `hive-capability-search` from the shared skill shelf when available.
4. Search the current project and any user-supplied project folders with `rg`, `rg --files`, docs, tests, and existing implementation paths.
5. Search local/private assimilation indexes with `search_assimilation_index.py` when available.
6. Search known user project roots only when relevant and bounded, such as `~/Documents/code/projects`, `~/Developer`, or a root named by the user. Avoid secret folders, vendored dependency folders, build outputs, and large binary trees.
7. Search public GitHub live for the request and likely implementation terms.
8. Rank candidates by task fit, pinned/user preference, safety, license compatibility, freshness, star count for public GitHub candidates, assimilation cost, and stack compatibility.
9. Select a backbone when possible, then use donors for missing pieces.
10. Clone or inspect candidates as inert source; never execute untrusted project code during assimilation.
11. Audit the whole candidate enough to identify risk, then audit selected paths before copying or adapting code.
12. Copy, translate, or adapt concrete source files/modules/assets/tests before writing missing glue code.
13. Preserve provenance in logs, notes, comments, or the final answer.

## Search Surfaces

Use these sources as appropriate:

- Shared brain: `hive-brain answer`, `hive-brain recall`, `Skills/README.md`, relevant `Skills/<slug>/SKILL.md`, and task-relevant Obsidian notes.
- Capability shelf: `hive-capability-search` for tool/app/agent/workflow selection evidence.
- Current workspace: code, docs, tests, examples, changelog, architecture notes, and local app conventions.
- User project corpus: pinned paths first, then bounded search under user project roots when useful.
- Private/local assimilation index: locally indexed GitHub and local repo chunks.
- Public GitHub: live repository search, star-sorted by default for broad discovery.
- Connected apps/endpoints: only through discovery/catalog surfaces; do not hard-code private Tailnet addresses or transient local URLs.

Never read, print, summarize, copy, or persist secrets. Use credential presence checks by key name only, such as `hive-env-check KEY`.

## Quick Commands

Default local index locations:

- Notes: `~/Documents/hive-assimilate-vault`
- Machine-readable index: `~/.codex/hive-assimilate/index`
- Candidate cache: `~/.codex/hive-assimilate/candidates`

Existing local caches can still be searched when present so project references do not break.

Search the shared brain:

```bash
hive-brain answer "build request or capability query" --scope full-vault
hive-brain recall "build request or capability query" --scope full-vault --limit 8
```

Index specific repos:

```bash
python3 /Users/liam/.codex/skills/hive-assimilate/scripts/index_github_repos.py \
  --repo owner/name \
  --repo another/project
```

Index local project clones:

```bash
python3 /Users/liam/.codex/skills/hive-assimilate/scripts/index_github_repos.py \
  --local /path/to/repo --local /path/to/another-repo
```

Index all repos visible to the authenticated GitHub account, including private repos where the token has access:

```bash
python3 /Users/liam/.codex/skills/hive-assimilate/scripts/index_github_repos.py \
  --authenticated --limit 500 --no-clone
```

Search the local/private index:

```bash
python3 /Users/liam/.codex/skills/hive-assimilate/scripts/search_assimilation_index.py \
  "expo react native chatbot talking anime character voice"
```

Search public GitHub live and write candidate notes:

```bash
python3 /Users/liam/.codex/skills/hive-assimilate/scripts/search_github_public.py \
  "expo react native chatbot talking anime character voice" --limit 30
```

For build requests without a pinned source, prefer the blocking prebuild command after shared-brain and workspace search:

```bash
python3 /Users/liam/.codex/skills/hive-assimilate/scripts/prebuild_assimilation_check.py \
  "Build me a personal finance dashboard that connects to imported bank CSVs"
```

Audit a candidate before assimilating it:

```bash
python3 /Users/liam/.codex/skills/hive-assimilate/scripts/audit_candidate_repo.py owner/name
```

Clone a candidate into the inert local candidate cache:

```bash
python3 /Users/liam/.codex/skills/hive-assimilate/scripts/clone_candidate_repo.py owner/name
```

Audit only selected source paths after choosing what to reuse:

```bash
python3 /Users/liam/.codex/skills/hive-assimilate/scripts/audit_candidate_repo.py /path/to/repo \
  --path packages/loot-core/src --path packages/desktop-client/src/components
```

Record concrete assimilation before finalizing:

```bash
python3 /Users/liam/.codex/skills/hive-assimilate/scripts/write_assimilation_manifest.py \
  --custom-code-assessment balanced \
  --map "actualbudget/actual:packages/loot-core/src/shared/arithmetic.ts=>src/lib/arithmetic.ts::adapted_code::integer money helpers"
```

Allowed `reuse_type` values: `copied_code`, `adapted_code`, `translated_code`, `style_adapted`, `test_adapted`, `config_adapted`, `asset_copied`.

Disallowed as successful reuse: `inspiration`, `pattern`, `api_shape`, `design_reference`, `reference`, `idea`.

Verify the manifest before finalizing:

```bash
python3 /Users/liam/.codex/skills/hive-assimilate/scripts/verify_assimilation_manifest.py
```

## Assimilation Logging

Every build that uses this skill must leave two local logs in the target project:

- `ASSIMILATION_LOG.md` for human review and iteration.
- `ASSIMILATION_LOG.jsonl` for machine-readable analysis.

The log must answer:

- what shared-brain searches were run
- what pinned/user project sources were inspected
- what local/private and public searches were run
- what each search retrieved
- which candidate became the backbone
- which donors were selected
- which candidates were inspected but rejected
- the concrete reason for each rejection
- what source paths were assimilated into target paths
- what audits or verification commands were run

Use the decision logger for manual triage, audit, and rejection notes:

```bash
python3 /Users/liam/.codex/skills/hive-assimilate/scripts/log_assimilation_decision.py \
  --request "Build me a personal finance dashboard" \
  --phase triage \
  --source shared-brain \
  --selected-backbone local-project:hivemind-os \
  --candidate "Skills/hive-capability-search::selected::capability map covers available tools and agents::SKILL.md" \
  --candidate "owner/repo::rejected::wrong framework and no extractable source paths"
```

When a candidate looked promising but was rejected, log it immediately instead of relying on memory.

Final answers for build tasks must include:

- `Assimilated code`: concrete source repos/paths/notes and target files.
- `Assimilation log`: `ASSIMILATION_LOG.md` plus important rejected candidates or unresolved search gaps.

## Minimum Concrete Reuse Threshold

A successful assimilation should include at least one of:

- copied or adapted code, tests, config, assets, schemas, examples, or algorithms
- a pinned project module reused with small adaptation
- a shared-brain workflow or skill that directly determines the implementation path
- an audited local project pattern transplanted into the target project

If none of these are safe or useful, say that explicitly and list the searches and paths that failed before proceeding with custom implementation.
