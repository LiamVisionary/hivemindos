---
title: Whole Brain
description: How the HivemindOS shared Obsidian brain works.
---

# Whole Brain

The HivemindOS whole brain is the shared memory, retrieval, skill, and coordination system for the fleet.

It is not one magic database. The real anchor is a normal Obsidian markdown vault. Everything else either reads it, writes to it, indexes it, repairs it, or helps agents use it without making a mess.

<section class="atlasHero">
  <strong>Short version:</strong>
  <p>The vault is the durable shared brain. Shared Brain Memory gives agents private millisecond typed-memory recall first, memory evolution when reviewed facts replace stale ones, then broader full-vault context retrieval when distilled memory is not enough. Compiled Knowledge turns reviewed source material into searchable entity/concept/summary wiki pages with graph-native lookups. OKF export turns selected memory and conversation notes into a portable markdown bundle for outside agents and catalog tools. The Obsidian Native Brain Pack gives agents shared skills for Markdown, Bases, and Canvas, while the other brain services can index, compile, visualize, or repair the vault without replacing it.</p>
</section>

## Component Pages

<div class="docGrid">
  <section class="docCard">
    <h3>Vault Map</h3>
    <p>The canonical folders, what belongs where, and which paths are operational state.</p>
    <a href="vault-map.html">Open vault map</a>
  </section>
  <section class="docCard">
    <h3>Brain Services</h3>
    <p>Shared Brain Memory, Compiled Knowledge search, OKF exchange bundles, GBrain, Syntho, Trading Brain, the Brain Graph, the context index, and service notes.</p>
    <a href="brain-services.html">Open services</a>
  </section>
  <section class="docCard">
    <h3>Shared Skills</h3>
    <p>The shared skill shelf, provider mirrors, auto sync policy, and test cleanup rules.</p>
    <a href="shared-skills.html">Open shared skills</a>
  </section>
  <section class="docCard">
    <h3>Packaged Skills</h3>
    <p>Repository-shipped Hive skills, third-party packaged skills, auto-install behavior, and optional skill boundaries.</p>
    <a href="../packaged-skills/">Open packaged skills</a>
  </section>
  <section class="docCard">
    <h3>Shared Env</h3>
    <p>Where agent secrets live, how hive env helpers work, and why plaintext keys stay out of the vault.</p>
    <a href="shared-env.html">Open shared env</a>
  </section>
  <section class="docCard">
    <h3>Sync And Health</h3>
    <p>Hivemind Sync, vault doctor, conflict cleanup, secure backups, and migration manifests.</p>
    <a href="sync-and-health.html">Open sync docs</a>
  </section>
  <section class="docCard">
    <h3>Architecture Sync</h3>
    <p>The rule that keeps setup, vault structure, agent instructions, tests, and docs aligned.</p>
    <a href="architecture-sync.html">Open sync rules</a>
  </section>
  <section class="docCard">
    <h3>Code Map</h3>
    <p>The source files and API route families that own brain behavior.</p>
    <a href="code-map.html">Open code map</a>
  </section>
</div>

## Mental Model

```mermaid
flowchart TD
  User["User and agents"] --> Dashboard["HivemindOS dashboard"]
  User --> RawAgents["Raw runtime CLIs"]
  Dashboard --> Vault["Shared Obsidian vault"]
  Dashboard --> ContextIndex["Context index"]
  Dashboard --> BrainMemory["Shared Brain Memory"]
  Dashboard --> BrainGraph["Brain graph"]
  Dashboard --> Skills["Shared skills"]
  RawAgents --> HiveBrain["hive-brain CLI"]
  RawAgents --> ClaudeHook["Claude UserPromptSubmit hook"]
  HiveBrain --> BrainMemory
  ClaudeHook --> HiveBrain
  BrainMemory --> VaultMarkdown["Full vault markdown recall"]
  BrainMemory --> MemoryNotes["Memory/Distillations/Agent Memory"]
  BrainMemory --> MemoryIndex["Private memory index"]
  BrainMemory --> Proofs["Hash-only GitLawb receipts"]
  Vault --> NativeViews["Obsidian Bases and Canvas views"]
  Vault --> SyncOwner["Hivemind Sync"]
  SyncOwner --> VaultOwner["External sync / HivemindOS Syncthing / manual repair"]
  SyncOwner --> Transfers[".hivemindos-transfers handoffs"]
  Vault --> QMD["QMD markdown search"]
  Vault --> GBrain["GBrain retrieval"]
  Vault --> Syntho["Syntho reviewed synthesis"]
  Vault --> Operations["Operations state"]
  Skills --> RuntimeProviders["Codex / Claude / Hermes / Gemini / OpenClaw / Aeon"]
  Operations --> Doctor["Vault doctor and migration manifests"]
```

The important split is access path, not storage path:

- HivemindOS-managed chats inject Shared Brain Memory through the dashboard runtime context.
- Raw or non-managed runtimes use `hive-brain`, which tries `/api/brain/memory` first and falls back to local vault/index search.
- Claude Code also gets `hive-brain-hook` as a `UserPromptSubmit` hook, so raw Claude prompts can receive relevant full-vault context before answering.
- Durable memory writes still go to typed Agent Memory notes; `hive-brain evolve` preserves superseded memory history when reviewed context changes; broad recall can read normal vault notes when the typed layer is not enough.
- OKF export writes selected memory and conversation concepts to `Operations/Brain Services/OKF Export/` for outside agents, catalogs, and graph tools without changing the native vault.
- The Obsidian Native Brain Pack lets agents write durable notes, `.base` views, and `.canvas` maps in formats Obsidian can open directly.

## Source Of Truth

The durable source of truth is the configured vault, usually:

```text
~/Documents/Obsidian/hivemindos-vault
```

Fresh installs seed this structure through the setup scripts and foundation seeder. Existing installs can run:

```bash
pnpm vault:doctor
pnpm vault:doctor -- --fix
```

The doctor is read only unless `--fix` is passed. Fixes move content into canonical folders or archive stale artifacts under `Operations/Vault Migrations/`.

## Read Next

- [Vault Map](vault-map.html)
- [Brain Services](brain-services.html)
- [Packaged Skills](../packaged-skills/)
- [Shared Env](shared-env.html)
- [Sync And Health](sync-and-health.html)
- [Architecture Sync](architecture-sync.html)
