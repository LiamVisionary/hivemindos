---
name: hive-brain-memory
description: Use when recalling, writing, correcting, or evolving HivemindOS typed Shared Brain Memory for durable preferences, decisions, instructions, commitments, goals, credential status, project context, lessons, artifacts, or reusable operational facts.
---

# Hive Brain Memory

Typed Shared Brain Memory is the first stop for durable personal, project, and operational context. It lives in the shared Obsidian vault as Agent Memory notes plus a private JSONL index, and agents should use the `hive-brain` CLI or `/api/brain/memory` instead of hand-writing memory notes.

Use this skill when you need to recall or update preferences, decisions, instructions, commitments, goals, credential status, project context, lessons, artifacts, or reusable operational facts. Use `hive-brain-compiled-wiki` instead for synthesized entity/concept/summary wiki knowledge under `Synthesis/Compiled Knowledge/<domain>/`.

## Recall

Before relying on prior context, run:

```bash
hive-brain answer "<query>"
```

Use a hit list when you need evidence paths:

```bash
hive-brain recall "<query>" --scope agent-memory --limit 8
hive-brain recall "<query>" --scope full-vault --limit 8
```

Default recall is tiered: typed Agent Memory first, then full-vault augmentation through the generated lexical index when needed. For broad vault search, prefer the generated `Operations/Brain Services/Full Vault Search Index.jsonl` path; fall back to `rg`, then `grep`, then filesystem walking only when indexed search is unavailable.

## Remember

Only store durable reviewed facts, decisions, preferences, goals, instructions, commitments, artifacts, errors, learnings, credential-presence facts, or reusable context:

```bash
hive-brain remember \
  --type preference \
  --title "Short durable title" \
  --content "Reviewed memory body." \
  --project "<project>" \
  --source "<source or reason>"
```

Memory writes live under `Memory/Distillations/Agent Memory/`. The typed index lives at `Operations/Brain Services/Agent Memory Index.jsonl`. Optional GitLawb proof receipts live at `Operations/Brain Services/Agent Memory Proofs.jsonl` and store hashes/provenance instead of raw memory bodies.

Include available provenance fields when writing: `agentName`, `agentId`, `runtime`, `machineName`, `machineId`, `tailnetId`, `tailnetName`, `tailnetDnsName`, `collectorUrl`, `sessionId`, and `project`. Use `proof: "auto"` unless explicit proof is requested.

## Evolve

When new reviewed context replaces or corrects an older durable memory, evolve it instead of creating a conflicting duplicate:

```bash
hive-brain evolve \
  --memory-id mem-... \
  --content "Updated durable memory." \
  --reason "What changed or why this supersedes the old memory"
```

Equivalent API shape:

```json
{
  "action": "evolve",
  "memoryId": "mem-...",
  "content": "Updated durable memory.",
  "evolutionReason": "What changed or why this supersedes the old memory"
}
```

Evolution writes a fresh active memory, marks older memories as `superseded`, and records `supersedes`, `supersededBy`, `evolutionRootId`, `evolutionType`, `cognitiveStage`, `sourceType`, `evidenceCount`, and `metaTags` when available. Treat the latest active chain item as current truth; use prior superseded versions as history/evidence, not as competing active instructions.

## API Actions

`/api/brain/memory` supports:

- `answer`
- `recall`
- `remember`
- `evolve`
- `rebuild-index`

The CLI discovers the running HivemindOS API when possible. Recall can fall back to local vault/index search; write actions should use the API path so markdown notes, indexes, proofs, and evolution chains stay consistent.

## Safety

- Never store provider secrets, private keys, bearer tokens, plaintext passwords, raw Tailnet IPs, or private chat IDs in shared memory.
- Store credential status by key name only, such as `OPENAI_API_KEY is set`, not the secret value.
- Keep raw captures in `Intake/` and drafts in `Synthesis/`; memory is for durable reviewed facts.
- If manually importing or repairing Agent Memory notes, run the memory API `rebuild-index` action afterward.
