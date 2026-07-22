# Shared Brain Service Rules

These rules apply under `src/lib/services/obsidian/` in addition to the repository root and `src/` instructions.

- Typed durable memory lives in `Memory/Distillations/Agent Memory/`. Keep the typed index, entity index, retrieval telemetry, full-vault lexical index, and optional hash-only proof index at their canonical `Operations/Brain Services/` paths.
- Use canonical `memoryKey` heads. Reviewed replacements use evolve semantics and preserve `supersedes`, `supersededBy`, `evolutionRootId`, stage, and provenance history.
- Routine/high-volume events go to the bounded local operational journal, not Agent Memory. Pattern mining is dry-run and review-gated.
- Generated replay history uses verified compressed checkpoints and content-addressed deltas. Health and CLI output must state the surviving replay boundary after pruning.
- Search uses the generated full-vault index first, then ripgrep, then grep, and only then a full filesystem walk.
- Conversation-note deletion is a hard replicated delete. Validate every replicated `notePath`, remove matching conversation-index rows, and purge full-vault index rows in the same operation.
- Redact secrets before vault writes. Never store raw Tailnet IPs or secret values. Include available agent/runtime/machine/session/project provenance without inventing missing fields.
- Mirror structural changes across setup initializers, public whole-brain docs, and `scripts/test-vault-structure-contract.mjs` in the same change.
