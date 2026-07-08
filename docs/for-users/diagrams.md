---
title: Diagrams And Maps
description: Visual atlas for HivemindOS architecture, wallets, runtimes, fleet, brain services, and safety boundaries.
---

# Diagrams And Maps

<section class="atlasHero">
  <strong>A visual atlas for the local agent control room.</strong>
  <p>These plates and diagrams are quick maps for the hive: what talks to what, where state lives, which rails move money or tokens, and where the trust boundaries sit.</p>
</section>

## Generated Infographic Plates

<figure class="imagePlate imagePlateHero">
  <img src="../assets/img/diagrams/visual-atlas.jpg" alt="Generated HivemindOS visual atlas infographic showing Fleet, Agents, Brain, Work, Wallets, and Native around the dashboard.">
  <figcaption>Generated overview plate for the full HivemindOS visual atlas.</figcaption>
</figure>

<div class="imagePlateGrid">
  <figure class="imagePlate">
    <img src="../assets/img/diagrams/wallet-token-rails.jpg" alt="Generated wallet and token rails infographic with separate lanes for x402 paid APIs, UsePod prepaid runtime deposits, and Honey to Bankr HIVE claims.">
    <figcaption>Wallet rails are three separate paths: wallet to x402, wallet to UsePod prepaid runtime, and runtime usage to Honey to Bankr HIVE claim.</figcaption>
  </figure>
  <figure class="imagePlate">
    <img src="../assets/img/diagrams/fleet-tailnet-topology.jpg" alt="Generated fleet and Tailnet topology infographic showing dashboard, local collector, Tailnet or Link, remote collectors, apps, and runtimes.">
    <figcaption>Dashboard to local collector, then private Tailnet reachability out to remote collectors, machine health, apps, and runtimes.</figcaption>
  </figure>
  <figure class="imagePlate">
    <img src="../assets/img/diagrams/brain-services-vault.jpg" alt="Generated brain services and shared vault infographic showing ENV vault path, Obsidian Vault, Skills, GBrain, Syntho, Trading Brain, and Synthesis Folder.">
    <figcaption>ENV vault path into Obsidian, shared skills, GBrain retrieval, Syntho reviewed output, Trading Brain, and the Synthesis folder.</figcaption>
  </figure>
  <figure class="imagePlate">
    <img src="../assets/img/diagrams/workboard-scheduler-loop.jpg" alt="Generated workboard and scheduler loop infographic showing Ideas, Ready, Working, Done, Scheduler, Deliverables, and History.">
    <figcaption>Workboard lanes, scheduler loop, deliverables, and history.</figcaption>
  </figure>
  <figure class="imagePlate">
    <img src="../assets/img/diagrams/security-trust-boundaries.jpg" alt="Generated security and trust boundaries infographic showing Public Docs, Browser, Local API, Private Vault, Wallet Keys, Tailnet, and Workers.">
    <figcaption>Security boundaries across public docs, local APIs, wallet keys, Tailnet, and workers.</figcaption>
  </figure>
  <figure class="imagePlate">
    <img src="../assets/img/diagrams/aeon-native-desktop.jpg" alt="Generated AEON and native desktop infographic showing Tauri, Local Files, AEON Repo, GitHub Actions, Deliverables, and Shared Vault.">
    <figcaption>AEON, Tauri native bridge, local files, GitHub Actions, deliverables, and shared vault.</figcaption>
  </figure>
</div>

## Rendered System Maps

<div class="diagramIndex">
  <a href="#control-room-map">Control Room Map <span>Dashboard, APIs, collectors, runtimes, vault, workers.</span></a>
  <a href="#fleet-topology">Fleet Topology <span>Local collector, remote collectors, Tailnet, app proxying.</span></a>
  <a href="#runtime-chat-path">Runtime Chat Path <span>Agent profile to adapter to stream/session storage.</span></a>
  <a href="#wallet-token-rails">Wallet Token Rails <span>Base, Solana, USDC, MoneyClaw, UsePod, x402.</span></a>
  <a href="#honey-hive-flow">Honey And HIVE Flow <span>Observed usage, Honey ledger, Bankr claim path.</span></a>
  <a href="#workboard-lifecycle">Workboard Lifecycle <span>Ideas, assignment, runs, deliverables, history.</span></a>
  <a href="#scheduler-loop">Scheduler Loop <span>Shared schedules, runtime actions, skills, run phases.</span></a>
  <a href="#brain-services">Brain Services <span>Obsidian, skills, GBrain, Syntho, trading brain.</span></a>
  <a href="#native-bridge">Native Bridge <span>Tauri-first local actions with browser fallbacks.</span></a>
  <a href="#phone-voice">Phone And Voice <span>Gateway, pairing, ring-agent, dashboard calls.</span></a>
  <a href="#aeon-github">AEON GitHub Path <span>OAuth, repo setup, Actions, OIDC brain access.</span></a>
  <a href="#security-boundaries">Security Boundaries <span>Local-only, Tailnet-only, public Pages, wallet keys.</span></a>
</div>

## Operator Signals

<div class="signalGrid">
  <section class="signalCard"><strong>Primary State</strong><span>Shared Obsidian vault, `~/.hivemindos`, runtime homes, and browser preferences.</span></section>
  <section class="signalCard"><strong>Private Network</strong><span>Collectors, Link proxy, app proxies, Syncthing, and Tailnet services stay private.</span></section>
  <section class="signalCard"><strong>Money Surface</strong><span>Agent wallets, UsePod deposits, Honey/HIVE accounting, x402, and Bankr claims are explicit rails.</span></section>
</div>

## Control Room Map

```mermaid
flowchart LR
  User["Operator"] --> Browser["Browser or Tauri window"]
  Browser --> Dashboard["Next.js dashboard"]
  Dashboard --> Api["App Router API facade"]
  Api --> Vault["Shared Obsidian vault"]
  Api --> Home["~/.hivemindos state"]
  Api --> Native["Tauri native commands"]
  Api --> Collector["Local collector"]
  Collector --> LocalRuntime["Local runtimes"]
  Collector --> LocalApps["Local apps and APIs"]
  Api --> Link["Hivemind Link / Tailscale"]
  Link --> RemoteCollectors["Remote collectors"]
  RemoteCollectors --> RemoteRuntime["Remote runtimes"]
  RemoteCollectors --> RemoteApps["Remote apps and APIs"]
  Api --> Workers["Honey / compute workers"]
  Api --> Integrations["App connections / GitHub / UsePod / MiroShark"]
```

## Product Surface Infographic

<div class="infographicGrid">
  <section class="infoTile"><b>01</b><strong>Fleet</strong><span>Discovers machines, collectors, app badges, health, and hivenet services.</span></section>
  <section class="infoTile"><b>02</b><strong>Agents</strong><span>Profiles bind runtime, model, env, wallet, vault, machine, and call context.</span></section>
  <section class="infoTile"><b>03</b><strong>Work</strong><span>Kanban, scheduler, swarm, history, note intake, and deliverables.</span></section>
  <section class="infoTile"><b>04</b><strong>Brain</strong><span>Obsidian memory, graph, shared skills, GBrain, Syntho, trading brain.</span></section>
  <section class="infoTile"><b>05</b><strong>Wallets</strong><span>Base/Robinhood/Solana, USDC/USDG, UsePod deposits, MoneyClaw, Honey, HIVE, x402.</span></section>
  <section class="infoTile"><b>06</b><strong>Native</strong><span>Tauri status, local folder actions, deliverable opening, packaged server.</span></section>
</div>

## Fleet Topology

```mermaid
flowchart TB
  Dashboard["Fleet dashboard"] --> Snapshot["/api/fleet/snapshot"]
  Dashboard --> Apps["/api/fleet/apps"]
  Dashboard --> Icons["/api/fleet/app-icon"]
  Snapshot --> LocalCollector["This Mac collector"]
  Snapshot --> LinkProxy["Hivemind Link proxy"]
  LinkProxy --> RemoteCollectorA["Remote collector A"]
  LinkProxy --> RemoteCollectorB["Remote collector B"]
  LocalCollector --> LocalProcesses["Processes / runtimes / tasks"]
  RemoteCollectorA --> RuntimeA["Hermes / OpenClaw / AEON"]
  RemoteCollectorB --> RuntimeB["Hermes / OpenClaw / AEON"]
  Apps --> AppReports["Collector /apps reports"]
  Apps --> AppProxy["/app-proxy/{port}"]
  AppProxy --> InteractiveApps["Interactive apps"]
  AppProxy --> ApiServices["API-only services"]
  ApiServices --> RouteCatalogs["OpenAPI or Hivemind route catalogs"]
```

## Runtime Chat Path

```mermaid
sequenceDiagram
  participant O as Operator
  participant D as Dashboard
  participant A as Agent Profile
  participant API as /api/chat/agent-runtime
  participant R as Runtime Adapter
  participant C as Collector or Gateway
  participant S as Session Store
  O->>D: Send message, files, directories
  D->>A: Resolve runtime, model, env, wallet, vault
  D->>API: Submit normalized chat request
  API->>R: Select adapter
  R->>C: Local gateway, Link proxy, or remote collector
  C-->>R: Stream events / final response
  R-->>API: Normalized chunks
  API-->>D: Streaming UI events
  API->>S: Session and usage metadata
```

## Wallet Token Rails

```mermaid
flowchart LR
  Agent["Agent wallet config"] --> LocalVault["Local wallet vault"]
  LocalVault --> Base["Base wallet"]
  LocalVault --> Robinhood["Robinhood Chain wallet"]
  LocalVault --> Solana["Solana wallet"]
  Base --> USDC["USDC sends with caps"]
  Robinhood --> USDG["USDG sends and Stock Tokens"]
  Solana --> SolanaUSDC["Solana USDC sends"]
  Agent --> UsePod["UsePod prepaid rail"]
  UsePod --> Deposit["Token deposit address"]
  UsePod --> Proxy["UsePod proxy URL"]
  Agent --> MoneyClaw["MoneyClaw API key"]
  MoneyClaw --> Account["Account / wallet / inbox"]
  Agent --> X402["x402 paid request policy"]
  X402 --> PaidApi["Paid API endpoint"]
  LocalVault --> Backup["Encrypted wallet-vault backup"]
```

## Honey HIVE Flow

```mermaid
flowchart TD
  RuntimeUsage["Runtime usage analytics"] --> Observer["Honey usage observer"]
  Observer --> PrivacyFilter["Privacy filter: no prompts, files, keys, paths, Tailnet IPs"]
  PrivacyFilter --> HoneyLedger["Honey ledger"]
  ComputeGateway["Compute gateway"] --> WorkerReceipt["Signed receipt"]
  WorkerReceipt --> HoneyLedger
  HoneyLedger --> Honey["Available Honey"]
  Honey --> LegacyHive["Legacy ledger HIVE"]
  LegacyHive --> Return["Return to Honey"]
  Honey --> BankrClaim["Claim Bankr HIVE"]
  BankrClaim --> Treasury["Bankr reward treasury"]
  Treasury --> BaseWallet["Operator Base receiving address"]
```

## Workboard Lifecycle

```mermaid
stateDiagram-v2
  [*] --> Ideas
  Ideas --> Ready: promote / note intake
  Ready --> Working: agent claim
  Working --> NeedsYou: auth / approval / blocked
  NeedsYou --> Ready: unblocked
  Working --> Done: completed
  Done --> Archived: archive
  Done --> Ready: child handoff promoted
  Working --> Ready: stale reclaim
  Done --> History: work history entry
```

## Scheduler Loop

```mermaid
flowchart LR
  SharedSchedules["Shared schedule files"] --> SchedulerUI["Scheduler UI"]
  SchedulerUI --> RuntimeAction["/api/scheduler/runtime-action"]
  SchedulerUI --> SkillAction["/api/scheduler/skill-action"]
  RuntimeAction --> Adapter["Runtime adapter"]
  SkillAction --> SharedSkill["Shared skill"]
  Adapter --> Run["Runtime run"]
  SharedSkill --> Run
  Run --> Phases["assigned -> thinking -> executing -> wrapping -> done"]
  Phases --> VaultLog["Shared vault run log"]
  VaultLog --> History["Work History"]
```

## Brain Services

```mermaid
flowchart TB
  Vault["Obsidian vault"] --> Graph["Brain graph"]
  Vault --> Skills["Shared skills shelf"]
  Vault --> ServiceNotes["Operations / Brain Services"]
  Graph --> Dashboard["Brain Services cockpit"]
  Skills --> RuntimeSkills["Runtime skill sync"]
  Dashboard --> GBrain["GBrain import / embed / dream / query"]
  Dashboard --> EnvPath["NEXT_PUBLIC_OBSIDIAN_VAULT_PATH"]
  EnvPath --> Vault
  Dashboard --> Syntho["Syntho reviewed-memory pipeline"]
  Dashboard --> Trading["Trading brain status"]
  Syntho --> Synthesis["Synthesis folder"]
  Syntho --> SourcePolicy["Source access policy: deny by default"]
  GBrain --> Query["Graph memory query"]
```

## Native Bridge

```mermaid
flowchart LR
  Feature["Dashboard feature"] --> IsTauri{"Tauri and local target?"}
  IsTauri -->|yes| NativeCommand["Native command"]
  IsTauri -->|no| ApiFallback["Next API fallback"]
  NativeCommand --> LocalFolder["Local folder browse/create"]
  NativeCommand --> Status["Desktop status"]
  NativeCommand --> Deliverables["Open/reveal deliverables"]
  ApiFallback --> BrowserRoute["Browser route"]
  BrowserRoute --> CollectorRoute["Remote collector route"]
  CollectorRoute --> RemoteMachine["Remote machine"]
```

## Phone Voice

```mermaid
sequenceDiagram
  participant D as Dashboard
  participant API as /api/phone
  participant G as Call Gateway
  participant M as Mobile Device
  participant A as Agent Context
  D->>API: Pair, status, ring, or dashboard call
  API->>G: Build gateway request
  G->>A: Add AEON repo, memory, skills, artifacts
  alt Ring mobile
    G->>M: ring-agent push/call
  else Dashboard call
    G-->>D: LiveKit/dashboard-agent-call config
  end
```

## AEON GitHub

```mermaid
flowchart TD
  OAuth["GitHub OAuth fallback"] --> GHGlobal["GH_GLOBAL in shared env"]
  GHGlobal --> AeonRepo["AEON repo/workspace"]
  AeonRepo --> Secrets["GitHub Actions secrets sync"]
  AeonRepo --> Workflows["Workflow dispatch / schedules"]
  Workflows --> Runner["GitHub Actions runner"]
  Runner --> OIDC["OIDC token"]
  OIDC --> Tailnet["Tailscale short-lived client"]
  Tailnet --> BrainEndpoint["/api/runtimes/aeon/brain"]
  BrainEndpoint --> Policy["Visibility-scoped brain policy"]
  Policy --> VaultRead["Search / read / append / bulk"]
```

## MiroShark And Swarm

```mermaid
flowchart LR
  SwarmUI["Swarm theater"] --> Templates["Scenario templates"]
  Templates --> MiroShark["MiroShark companion"]
  MiroShark --> Simulation["Simulation run"]
  Simulation --> Archive["Run archive"]
  Simulation --> Outputs["Posts / market / graph / telemetry"]
  Outputs --> Intelligence["Run intelligence"]
  Intelligence --> AnalysisAgent["Analysis agent"]
  AnalysisAgent --> Publish["Publish or handoff"]
  Publish --> Workboard["Workboard deliverables"]
```

## Storage Map

```mermaid
flowchart TB
  Home["~/.hivemindos"] --> DashboardState["Dashboard state"]
  DashboardState --> UIPrefs["UI prefs and fast caches"]
  Home --> Env["Shared env"]
  Home --> Kanban["Kanban fallback"]
  Home --> WalletVault["Wallet vault"]
  Home --> MemorySamples["Memory samples"]
  Home --> RuntimeRegistry["Runtime agent registry"]
  Vault["Obsidian vault"] --> SharedBrain["Shared brain notes"]
  Vault --> Skills["Skills"]
  Vault --> Schedules["Schedules"]
  Vault --> WalletLedger["Wallet records"]
  RuntimeHomes["Runtime homes"] --> Hermes["~/.config/hermes"]
  RuntimeHomes --> OpenClaw["~/.openclaw"]
  RuntimeHomes --> Aeon["AEON repos/workspaces"]
```

## API Surface Map

```mermaid
flowchart TB
  Api["/api"] --> Fleet["fleet/*"]
  Api --> Chat["chat/*"]
  Api --> Runtimes["runtimes/*"]
  Api --> Brain["brain/* and obsidian/*"]
  Api --> Work["kanban, scheduler, work-history"]
  Api --> Wallet["wallet/* and honey-ledger"]
  Api --> Integrations["integrations/*, gitlawb/*, projects/*, usepod/*, miroshark/*"]
  Api --> Ops["maintenance, memory-telemetry, runtime-files"]
  Fleet --> Collectors["Collectors and app proxies"]
  Chat --> RuntimeAdapters["Runtime adapters"]
  Brain --> Vault["Obsidian vault"]
  Work --> SharedSchedules["Schedules, task boards, and project proof links"]
  Wallet --> PaymentRails["Token and payment rails"]
```

## Security Boundaries

```mermaid
flowchart LR
  PublicDocs["Public GitHub Pages docs: no secrets"]:::public
  Browser["Operator browser"]:::local
  LocalApi["Local dashboard API"]:::local
  Native["Tauri native commands"]:::local
  Vault["Private Obsidian vault"]:::private
  WalletKeys["Wallet keys"]:::private
  Tailnet["Tailnet / Link"]:::tailnet
  Collector["Collectors"]:::tailnet
  RemoteApps["Remote apps"]:::tailnet
  Workers["Honey / compute workers"]:::external

  PublicDocs -.-> Browser
  Browser --> LocalApi
  LocalApi --> Native
  LocalApi --> Vault
  LocalApi --> WalletKeys
  LocalApi --> Tailnet
  Tailnet --> Collector
  Collector --> RemoteApps
  LocalApi --> Workers

  classDef public fill:#f7ead8,stroke:#b87319,color:#141716
  classDef local fill:#e6f3f0,stroke:#0a8fa6,color:#141716
  classDef private fill:#f8f3e8,stroke:#1e2724,color:#141716
  classDef tailnet fill:#eef5ef,stroke:#27865f,color:#141716
  classDef external fill:#fffdf8,stroke:#bbb3a3,color:#141716
```

## Visual Reading Order

<div class="infographicGrid">
  <section class="infoTile"><b>A</b><strong>Start with topology</strong><span>Use Control Room and Fleet maps to understand reachability.</span></section>
  <section class="infoTile"><b>B</b><strong>Follow state</strong><span>Use Storage, Brain, Workboard, and Scheduler maps for durable data.</span></section>
  <section class="infoTile"><b>C</b><strong>Inspect risk</strong><span>Use Wallet, Honey/HIVE, Native, AEON, and Security maps for trust boundaries.</span></section>
</div>
