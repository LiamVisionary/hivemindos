---
title: Whole Brain Shared Skills
description: Shared skill shelf, runtime provider mirrors, and auto-sync policy.
---

# Shared Skills

The shared skill shelf is the primary reusable procedure layer for agents.

It lives in the shared vault. Not in one runtime home. That matters because the whole point is that every agent can learn from the same shelf.

```text
Skills/README.md
Skills/<slug>/SKILL.md
```

Agents should treat the shared shelf as the first skill source. Runtime-local skill folders are supplemental overlays for runtime-specific or personal skills. Agents should read `Skills/README.md` first, then the relevant `SKILL.md`.

## Runtime Projection

Setup projects the shared shelf into supported runtime skill roots as HivemindOS-managed cache folders. This lets runtimes that only scan their own skill directory, such as Codex, still see shared-brain skills like `agent-reach` as native skills.

Projection is non-destructive:

- HivemindOS may replace a runtime skill folder only when it carries `.hivemind-skill-source.json` with `managedBy: "hivemindos"` or shared/bundled HivemindOS provenance.
- Unmanaged runtime-local skill folders are preserved and skipped on slug collision.
- On collision, the shared shelf remains the logical primary source for HivemindOS routing, while the existing runtime-local folder remains available as a supplemental local skill.
- Uninstall removes only HivemindOS-managed projection folders unless the user separately removes a runtime's own skills.

## Provider Inventory

HivemindOS can inspect local and remote runtime skill providers, including common Codex, Claude, Hermes, Gemini, OpenClaw, and Aeon locations.

Provider inventory and import logic live in:

```text
src/lib/services/obsidian/brain-skills.ts
```

## Auto-Sync

Auto sync policy is stored outside the vault:

```text
~/.hivemindos/skill-auto-sync.json
```

Policies can auto import, auto update, track removals, and optionally allow provider deletion handling.

Shared brain managed mirrors must not get imported again as brand new provider skills. That is how duplicate loops start.

Provider inventories must classify runtime mirrors as already handled before import or reconcile. In particular, an Aeon provider skill under `~/.aeon/skills` or `/root/.aeon/skills` whose directory is already provider-prefixed, such as `aeon-*`, `aeon-aeon-*`, `claude-*`, or `hermes-*`, is a mirror artifact rather than a new shared-brain skill. The dashboard importer rejects these again even when an older remote collector sends them as importable.

## Auto-Installed Brain Skills

Setup copies a small default pack from `packaged-skills/auto-install/` into the shared vault `Skills/` shelf.

That default pack includes `harness-engineering`, an attributed fixed-worker experiment method for improving agent context and tools with outcome evidence, and `hive-skill-autoresearch`, the review-gated procedure used when repeated skill failures qualify for measured improvement. Skill autoresearch preserves the installed skill while native HivemindOS agents—or optional Evo experiments—evaluate candidates through the same harness contract.

That default shelf includes `engineering-discipline`, HivemindOS' risk-scoped engineering orchestrator. Users who want the fuller method library can install the **HivemindOS Engineering Discipline** pack in the Skill Browser. Its manifest resolves every skill from the canonical packaged auto-install and optional directories, adds selected `obra/superpowers` methods, archives older HivemindOS-managed adaptations before refreshing them, and leaves unmanaged colliding skills untouched.

The HivemindOS Hive skills are included by default:

| Skill | Why it exists |
| --- | --- |
| `harness-engineering` | Holds the worker constant, compares baseline and treatment runs, separates available/retrieved/invoked/relevant context, and keeps only interventions supported by outcome and proof evidence. |
| `create-zero-human-company` | Turns a business goal or existing repository into a durable, approval-gated company record, verifies its crew and operating setup, and leaves autonomy stopped until explicitly launched. |
| `hive-assimilate` | Requires agents to search pinned sources, the shared brain, user projects, local/private indexes, and public GitHub before building software from scratch. |
| `hive-pulse` | Gives agents a bundled last-30-days signal brief across social, developer, market, GitHub, and web sources using a pinned MIT licensed engine, a setup-installed `hive-pulse` command shim, and Hive safety rules. |
| `hive-quant-research` | Gives agents a research-only, schedulable quant workflow with typed hypotheses, lagged Rust simulation, independent Python statistics, fail-closed overfitting gates, and hashed local artifacts. |
| `hive-capability-search` | Finds available tools, skills, apps, agents, credentials by key name, and delivery channels such as slash commands, API routes, MCP tools, CLIs, and dashboard surfaces for a task. |
| `hive-remote-capability-use` | Runs remote connected apps and fleet capabilities selected by capability search, using fresh discovery, app-proxy routing, private file transfer, artifact verification, and side-effect gates. |
| `hive-skill-fusion` | Turns a capability request into a reusable shared-brain skill. |
| `hive-workflow-fusion` | Composes multi-step hive workflows from skills, apps, agents, and tools. |
| `hive-aeon-fusion` | Converts reusable hive workflows into AEON-ready agent duties when appropriate. |
| `hive-brain-memory` | Teaches agents typed recall, canonical durable-memory heads, operational-event separation, review-gated pattern proposals, and evolution with superseded-history preservation. |
| `hive-brain-compiled-wiki` | Teaches agents the HivemindOS compiled-brain workflow: entity/concept/summary writes, compiled-wiki search, graph-native MCP reads, wiki health, and human collective shared-brain contribution rules. |
| `hive-skill-autoresearch` | Turns repeated, evidence-backed skill failures into a reviewed optimizer task with a measured baseline, four candidate variants, regression floors, and no automatic replacement. |
| `notebooklm` | Teaches agents to use the optional local NotebookLM MCP integration with explicit notebook IDs, private machine-local authentication, verified artifacts, and confirmation for destructive or outward actions. |
| `wrapup` | On an explicit wrap-up request, deduplicates or evolves durable typed memory and archives a concise redacted session summary in the user's verified NotebookLM AI Brain notebook. |
| HyperFrames suite (`hyperframes` + 18 siblings) | Routes explicit HTML / HyperFrames video work into bundled HTML, CSS, media, and seekable-animation workflows. Generic creation requests first present an actionable choice between cloud AI, local AI, and HTML / HyperFrames; ordinary discussion stays conversational. |

The Obsidian Native Brain Pack is also included by default:

| Skill | Why it exists |
| --- | --- |
| `obsidian-markdown` | Write Obsidian Flavored Markdown with wikilinks, embeds, callouts, properties, tags, math, Mermaid, and footnotes. |
| `obsidian-bases` | Create and edit native `.base` YAML views over vault notes. |
| `json-canvas` | Create and edit Obsidian `.canvas` maps, boards, and flowcharts. |
| `defuddle` | Optionally extract clean markdown from web pages when the local Defuddle CLI is installed. |

These are curated from [`kepano/obsidian-skills`](https://github.com/kepano/obsidian-skills). HivemindOS does not auto-install the upstream `obsidian-cli` skill because the shared vault already carries safer, HivemindOS-aware Obsidian CLI skills and write policy.

GitHub Pages packaged-skill docs live under [`docs/packaged-skills/`](../packaged-skills/). That section splits HivemindOS-owned Hive skills from curated third-party packaged skills and optional catalog skills.

Optional catalog skills are not auto-installed. Optional crypto helpers such as `packaged-skills/optional/crypto/hivemindos/b20-issuer-proof/`, GTM helpers such as `packaged-skills/optional/gtm/athm793/local-business-scraper/`, the private local-first `packaged-skills/optional/productivity/madslorentzen/ai-job-search/` workflow, writing helpers such as the security-audited `packaged-skills/optional/writing/petergyang/no-ai-slop/`, HivemindOS-authored production helpers such as `packaged-skills/optional/brand/hivemindos/brand-book-concept-page/`, `packaged-skills/optional/brand/hivemindos/hivemindos-brand-visuals/`, `packaged-skills/optional/events/hivemindos/venue-activation-visualizer/`, `packaged-skills/optional/media/hivemindos/launch-video-hyperframes/`, and `packaged-skills/optional/ops/hivemindos/work-board-airtable-bridge/`, the UI Skills design catalog under `packaged-skills/optional/design/<source>/<skill>/`, and the MIT-licensed MengTo design catalog under `packaged-skills/optional/design/mengto/<skill>/` are copied into the shared brain only when the user chooses a skill from the catalog.

Shared skills can also be authored directly into the vault for recurring workflows. `ai-ugc-production-pipeline` owns the performance-creative and asset-production side of AI UGC: public-ad evidence coding, pain/reframe briefs, five-beat scripts, storyboard-first generation, version-aware MiniMax H3/Higgsfield/Seedance routing, controlled variants, platform captions, and metric-driven regeneration. Its authored reusable rows live in the `performance-creative` GTM workflow bank. `video-generator-prompting` is the provider-neutral router used before video prompt compilation: it resolves the exact runtime, endpoint, task mode, duration, frame inputs, and audio behavior, then loads the reviewed model guide and records that decision in the generation receipt. `minimax-h3-video-prompting` owns MiniMax H3 T2VA/I2VA/FL2VA/L2VA/Ref2VA compilation, boundary-frame and full-reference semantics, native audiovisual fields, current license/territory gating, and artifact QA; it links to and paraphrases the official MiniMaxAI guides rather than redistributing them. All three are available as optional HivemindOS media packages. `content-rewards-viral-app-campaign` operates the distribution side: app-readiness gates, viral format banks, creator scoring and course briefs, verified-view reward controls, full-funnel diagnosis, bounded cohort and format-decay loops, and a rights-cleared organic-to-paid handoff. Its reusable operating rows live in the `creator-rewards` GTM workflow bank. `instagram-reel-growth-workflow` captures the Instagram account-study to AI Reel production loop: public profile analysis, current niche research, retention scripting, hook engineering, and a daily human-approved output workflow. `video-shot-transcript` is another shared media-analysis skill: it teaches agents to break local videos into unique shot/angle segments, align each segment with transcript or visible captions, and keep local media private unless an external transcription or vision upload is explicitly approved. `higgsfield-api-quirks` records Higgsfield model-specific API workarounds so agents use the correct Seedance 2.0 audio, aspect-ratio, and reference-slot schema instead of relying only on generic API examples.

The native pack pairs with seeded vault views under `Operations/Brain Services/`:

- `Agent Memory.base`
- `Project Brain.base`
- `Secure References.base`
- `Whole Brain.canvas`

## AEON Mirror Rule

The hidden AEON runtime mirror belongs here:

```text
Operations/Runtime Mirrors/AEON/.aeon
```

Human AEON profile notes stay under `Agents/AEON/<profile>/`. A hidden runtime basename like `.aeon` must not become a visible profile folder.

## Test Skill Rule

Real fleet propagation tests create temporary `hive-e2e-*` skills. Tests must clean up their shared brain copies after proving import, update, and removal tracking.

`vault-doctor` also detects old active `hive-e2e-*` shared skills.

## Skill Hygiene

Use `vault-doctor` when the shared shelf looks noisy:

```bash
pnpm vault:doctor
pnpm vault:doctor -- --fix
```

The doctor reports duplicate active skill hashes, conflict artifacts, and test leftovers.
