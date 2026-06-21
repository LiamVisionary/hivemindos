# Packaged Skills

This folder is the product-facing catalog for HivemindOS skills used by setup and future one-click install flows.

Use this folder only for skills intended to ship with HivemindOS as installable user content. Agent-only working skills should live in the shared Obsidian brain skill shelf, not in this repository.

Expected layout:

```text
packaged-skills/
  auto-install/
    <slug>/
      SKILL.md
      ...
  optional/
    <slug>/
      SKILL.md
      ...
    <category>/
      <source>/
        <slug>/
          SKILL.md
          ...
```

## Auto-Install

Skills in `auto-install/` are copied into the user's shared HivemindOS brain `Skills/` shelf during setup. Agents discover those skills from the shared brain after installation, not because they live in this repository folder.

Keep this folder small and foundational. These skills become part of the default shared context for HivemindOS users.

Current auto-install set:

- `hive-assimilate` for mandatory pre-build search across the shared brain, user projects, local/private indexes, and public GitHub before software creation.
- `hive-pulse` for built-in last-30-days signal briefs across Reddit, X, YouTube, TikTok, Hacker News, Polymarket, GitHub, and web sources. It bundles the pinned MIT licensed `mvanhorn/last30days-skill` engine with Hive-facing instructions, audit notes, a setup-installed command shim, and a local deterministic default path for out-of-the-box use.
- `hive-capability-search`, `hive-skill-fusion`, `hive-workflow-fusion`, and `hive-aeon-fusion` for capability discovery and reusable hive workflows.
- `hive-brain-memory` for typed Shared Brain Memory recall, durable writes, and memory evolution with superseded-history preservation.
- `hive-brain-compiled-wiki` for HivemindOS compiled-brain entity/concept/summary writes, compiled-wiki search, graph-native MCP reads, wiki health, and shared-brain contribution contracts.
- Obsidian Native Brain Pack: `obsidian-markdown`, `obsidian-bases`, `json-canvas`, and optional `defuddle`, curated from `kepano/obsidian-skills` so agents can write Obsidian-native notes, Bases, Canvas maps, and clean web-source markdown.

## Catalog Subdivisions

GitHub Pages docs split packaged skills into:

- **Hive skills:** HivemindOS-native skills under `docs/packaged-skills/hive-skills.md`.
- **Third-party packaged skills:** curated external or optional skills under `docs/packaged-skills/third-party-skills.md`.

Any packaged skill addition, removal, rename, install-policy change, or source relocation must update this README and the GitHub Pages docs in `docs/packaged-skills/`.

## Optional

Skills in `optional/` are a store/catalog for later one-click install. They must not be automatically copied into the shared brain, mirrored into runtime skill folders, or injected into agent context.

Optional skills may be flat (`packaged-skills/optional/<slug>/`) or grouped by catalog category (`packaged-skills/optional/<category>/<source>/<slug>/`). When a user installs an optional skill, the app should copy the selected package directory into the configured shared brain `Skills/<slug>/` folder and rebuild the shared skill index.

Grouped optional directories can also expose a whole-directory pack in the Skill Browser's Packs tab. Installing that pack copies every packaged skill in the directory into the shared brain in one pass, still using local package files and audit checks instead of upstream installer commands.

Current optional catalog:

- `design/`: 109 optional UI and design-engineering skills imported from the UI Skills directory, preserving upstream source namespaces as `design/<source>/<skill>/` and available as the `Design Optional Skills Directory` pack.
- `media/higgsfield/higgsfield-api-quirks`: optional Higgsfield API workaround skill for undocumented model-specific payload requirements, including Seedance 2.0 audio, aspect-ratio, and reference-slot constraints.
- `media/higgsfield/higgsfield-generate`: optional Higgsfield media-generation skill for Cloud API and standard consumer Higgsfield CLI/dashboard workflows. It keeps API-key/env usage separate from dashboard login, and asks which surface to use when unspecified.
- `media/hivemindos/ai-ugc-production-pipeline`: optional HivemindOS media-production skill for turning campaign research, visual anchors, Higgsfield/Seedance generation, batch UGC scripts, and metric-driven regeneration into one approval-gated short-form ad workflow.
- `media/hivemindos/instagram-reel-growth-workflow`: optional HivemindOS media-growth skill for studying a public Instagram account, finding current short-form niche angles, writing retention-optimized Reel scripts, engineering stronger hooks, and structuring a human-approved daily AI video loop.
- `media/hivemindos/video-shot-transcript`: optional HivemindOS media-analysis skill for local video shot/angle dissection with transcript or visible-caption alignment, using FFmpeg/Tesseract locally and requiring explicit approval before external transcription.
- `n8n/`: 8 optional n8n GTM-automation skills imported from `forma-norden/n8n-gtm-workflow-pack` (MIT), grouped as `n8n/forma-norden/<skill>/` and available as the `N8N Optional Skills Directory` pack. The upstream pack ships flat fragment files without frontmatter, so the importer synthesizes `name`/`description` and records provenance.

### Importing optional skills

`scripts/import-packaged-skills.mjs` vendors external `SKILL.md` repos into this folder repeatably. It clones the upstream repo at a pinned commit, normalizes each skill into `<category>/<source>/<slug>/SKILL.md` (synthesizing frontmatter when the upstream file has none), writes `.hivemind-skill-source.json` provenance (license, repo, commit, source URL), and records a `sha256` of each vendored `SKILL.md` in `skills-lock.json`.

- `node scripts/import-packaged-skills.mjs --list` — show configured sources.
- `node scripts/import-packaged-skills.mjs n8n` — import a source (use `--dry-run` first for unvalidated sources).
- `node scripts/import-packaged-skills.mjs --verify` — re-hash every vendored skill against `skills-lock.json` and fail on drift.

Keep packaged skills self-contained, user-safe, and installable without relying on Liam's local agent runtime paths.
