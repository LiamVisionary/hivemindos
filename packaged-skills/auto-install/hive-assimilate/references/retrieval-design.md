# Retrieval Design

## Purpose

Hive Assimilate turns a repo universe into a parts catalog. The goal is not to clone the top search result; it is to identify components, services, examples, config, assets, and architectural patterns that can be assimilated quickly into the current project.

## Data Model

Store two parallel representations:

- Obsidian Markdown notes for human inspection and graph browsing.
- JSONL records for agent search, embeddings, reranking, and future vector databases.

Recommended JSONL fields:

- `id`: stable repo or chunk id
- `kind`: `repo`, `file`, `component`, `concept`
- `repo`: `owner/name` or local repo name
- `path`: source file path when applicable
- `title`: human-readable title
- `text`: searchable text
- `url`: GitHub URL when available
- `language`, `topics`, `frameworks`, `packages`
- `license`, `stars`, `pushed_at`
- `obsidian_note`: generated note path

## Hybrid Retrieval

Use hybrid retrieval whenever possible:

- BM25/keyword: exact package names, frameworks, APIs, filenames, and error strings.
- Embeddings: fuzzy intent such as "talking anime companion", "AI tutor with voice", "canvas whiteboard app".
- Graph expansion: related concepts such as `Expo -> React Native -> mobile -> expo-av -> speech`.
- Reranking: ask the model to judge whether a candidate is actually assimilable into the current codebase.

## Assimilation Score

Score each candidate from 0-1 using:

- Popularity: stars first for public Hive discovery, normalized by niche.
- Semantic fit: does it satisfy the requested capability?
- Stack fit: does it match the current repo's language/framework/runtime?
- Extraction cost: can the useful part be isolated without dragging the whole app?
- Freshness: recent enough, or simple enough to remain valid.
- License safety: permissive or only used for inspiration.
- Dependency risk: no obvious conflicts, native modules, or build traps.

Use stars as the first public-repo ordering signal, then rerank for actual assimilability. The default pattern is backbone plus donors: choose the highest-star directionally compatible repo as the backbone, then pull missing capabilities from lower-star specialized alternatives. A high-star repo should lose backbone status only when stack mismatch, license risk, or extraction cost makes it actively unsuitable.

## Backbone Plus Donors

For each build request, produce an internal assimilation map:

- Backbone: highest-star repo that can plausibly anchor the build.
- Donors: lower-star repos that supply missing features, cleaner snippets, assets, integrations, or narrow examples.
- Gaps: requested capabilities not covered by the backbone.
- Assimilation plan: what to adapt from the backbone, what to graft from each donor, and what to build fresh.
- Security audit: pass/fail plus any warnings before using code.

Example for an Expo anime chatbot:

- Backbone: high-star Expo/React Native template or chatbot app.
- Donor: Live2D/anime character repo for avatar rendering.
- Donor: TTS repo for voice generation.
- Donor: small chat UI repo if the backbone lacks message UX.

## Security Audit Gate

GitHub security tooling is useful but incomplete for assimilation. Code scanning can find vulnerabilities and errors when configured. Dependabot alerts depend on dependency graph/advisory matching. Secret scanning detects exposed credentials and known secret patterns. None of these prove that arbitrary repo code is non-malicious.

Before using a repo:

1. Clone or inspect source without running install/build/start commands.
2. Run `scripts/audit_candidate_repo.py`.
3. Manually inspect high-risk findings and candidate entry points.
4. Avoid importing whole repos when a small audited snippet or pattern is enough.
5. If high-risk findings remain unexplained, do not assimilate that repo without explicit user approval.

Audit especially:

- `package.json` lifecycle scripts such as `preinstall`, `install`, `postinstall`, `prepare`.
- Shell commands that download and execute remote code.
- Obfuscated JavaScript, base64 payloads, `eval`, dynamic `Function`, suspicious `child_process`.
- GitHub Actions that exfiltrate secrets or run untrusted scripts.
- Binary artifacts, minified bundles, checked-in executables, or unusually large opaque files.
- Dependency confusion hints, typosquatted packages, and unexpected registries.

## Implementation Behavior

When implementing from candidates:

1. Inspect the current repo first.
2. Inspect candidate files before copying.
3. Prefer translating patterns into the current repo's style.
4. Copy code only when license-compatible and beneficial.
5. Keep provenance: mention source repos in the final answer, and add source comments for substantial copied code if appropriate.

## Future Upgrade Path

The current scripts create an Obsidian graph plus searchable JSONL. A stronger backend can add:

- SQLite FTS5 or Tantivy for BM25.
- Qdrant, LanceDB, Chroma, pgvector, or sqlite-vec for embeddings.
- Tree-sitter chunking for functions/classes/components.
- Dependency graph extraction from package manifests.
- GitHub Actions smoke checks to validate assimilated examples.
