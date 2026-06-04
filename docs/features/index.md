# Feature Guide

HivemindOS is a control room for local agent fleets.

The feature surface follows the work an operator actually does: connect machines, configure agents, run work, preserve memory, manage money rails, and keep the local system healthy.

<section class="atlasHero">
  <strong>Use this page as the operator map.</strong>
  <p>Each section below explains what the feature area is responsible for, which docs go deeper, and how the pieces connect in the running app. For the full visual pass, use the <a href="../diagrams.html">Diagrams And Maps</a> atlas.</p>
</section>

<div class="signalGrid">
  <section class="signalCard"><strong>Connect</strong><span>Fleet, collectors, Tailnet/Link, apps, and runtime discovery.</span></section>
  <section class="signalCard"><strong>Operate</strong><span>Agents, chat, Work board, Code Proof, Scheduler, Swarm, and deliverables.</span></section>
  <section class="signalCard"><strong>Remember</strong><span>Obsidian vault, shared skills, GBrain, Syntho, Synthesis, and notifications.</span></section>
  <section class="signalCard"><strong>Pay</strong><span>Wallets, Base/Solana, USDC, UsePod prepaid, Honey, HIVE, and x402.</span></section>
  <section class="signalCard"><strong>Integrate</strong><span>GitLawb, MiroShark, Nango, GitHub OAuth, My Apps, phone, and work history.</span></section>
  <section class="signalCard"><strong>Maintain</strong><span>Hivemind Sync, runtime files, native helpers, memory telemetry, and repair checks.</span></section>
</div>

## Control Room

The product starts with machines and agents. Fleet tells you what is online, which collectors are reachable, what runtimes and apps are available, and whether a machine is drifting from the expected setup. Agents and Chat turn those runtimes into configured workers with models, env, wallets, vault context, file attachments, and session history.

<div class="docGrid">
  <section class="docCard">
    <h3>Fleet</h3>
    <p>Machine discovery, local and remote collectors, version drift, setup actions, active app badges, and hivenet API route catalogs.</p>
    <a href="fleet.html">Open Fleet</a>
  </section>
  <section class="docCard">
    <h3>Agents, Runtimes, And Chat</h3>
    <p>Runtime profiles, model selection, adapter behavior, streaming chat, attachments, directory context, and phone-call handoff.</p>
    <a href="runtimes-and-chat.html">Open agents</a>
  </section>
  <section class="docCard">
    <h3>Calling</h3>
    <p>Dashboard and mobile agent calls, BYOK Realtime by default, speaker-only fallback, phone pairing, and paid LiveKit/SFU cloud rooms.</p>
    <a href="calling.html">Open calling docs</a>
  </section>
</div>

## Work Loop

Work is where operator intent turns into agent execution. The board captures rough ideas, promotes ready tasks, tracks claimed work, stores comments and run records, and turns finished output into deliverables. Scheduler adds repeated background work. Swarm and MiroShark handle rehearsal, simulation, and heavier analysis workflows.

<div class="docGrid">
  <section class="docCard">
    <h3>Work Board And Scheduler</h3>
    <p>Kanban tasks, project provenance, Code Proof badges, agent dispatch, deliverables, schedules, machine-aware folder picking, background jobs, and work history.</p>
    <a href="work-and-scheduler.html">Open work docs</a>
  </section>
  <section class="docCard">
    <h3>MiroShark And Runtime Gateways</h3>
    <p>Simulation templates, swarm rehearsal, run intelligence, route catalogs, and the minimal runtime-gateway integration points HivemindOS owns.</p>
    <a href="miroshark-and-openclaw.html">Open gateway docs</a>
  </section>
</div>

## Code Proof

Agent work gets messy fast if the only record is a chat transcript or a commit message. HivemindOS keeps the private trail: which task was opened, which project it belonged to, which machine handled it, and which agent touched it. GitLawb adds the part that code needs, signed provenance.

The goal is not to make every user manage a code node on day one. The normal path is quieter than that. HivemindOS can be Code Proof ready during setup, tasks can attach to projects, and linked projects can carry GitLawb proof metadata. If a project later needs local repo hosting, the deeper GitLawb node path is there.

That gives the Work board a better answer than “an agent changed something.” It can point to the project, the task, the machine, and the proof trail behind the code.

<div class="docGrid">
  <section class="docCard">
    <h3>GitLawb Integration</h3>
    <p>The full integration guide for CLI setup, local DID identity, project links, proof badges, Fleet Code Node status, and lazy node hosting.</p>
    <a href="../integrations/gitlawb.html">Open GitLawb docs</a>
  </section>
  <section class="docCard">
    <h3>Work Board Details</h3>
    <p>How project IDs and sanitized proof records move through tasks without leaking private vault paths, secrets, or machine details.</p>
    <a href="work-and-scheduler.html">Open Work docs</a>
  </section>
</div>

## Shared Brain

The shared brain is a normal Obsidian vault, not a proprietary database. HivemindOS writes durable state into that vault when available: Kanban records, notifications, scheduled runs, wallet records, shared skills, service notes, and reviewed outputs. GBrain indexes and retrieves. Syntho compiles reviewed Synthesis output. Trading Brain stays optional.

<div class="docGrid">
  <section class="docCard">
    <h3>Brain, Vault, And Skills</h3>
    <p>Obsidian vault routing, graph access, shared skills, GBrain, Syntho, Trading Brain, Synthesis, and sync ownership.</p>
    <a href="brain-vault-and-skills.html">Open brain docs</a>
  </section>
  <section class="docCard">
    <h3>Hive Fusion</h3>
    <p>Capability search plus skill authoring: turn a normal prompt into a reusable shared-brain skill built from the agents, apps, tools, and workflows the hive already has.</p>
    <a href="hive-fusion.html">Open fusion docs</a>
  </section>
  <section class="docCard">
    <h3>Whole Brain</h3>
    <p>The separated GitHub Pages guide for vault structure, brain services, shared skills, sync health, and architecture sync rules.</p>
    <a href="../whole-brain/">Open whole brain</a>
  </section>
  <section class="docCard">
    <h3>Hivemind Sync</h3>
    <p>The cross-machine route for shared brain files, shared env keys, and vault-backed handoff transfers.</p>
    <a href="hivemind-sync.html">Open sync docs</a>
  </section>
  <section class="docCard">
    <h3>Env, Files, Notifications, And Maintenance</h3>
    <p>Shared env, runtime file browsing, notification storage, process telemetry, and conservative repair checks.</p>
    <a href="env-files-notifications-maintenance.html">Open system docs</a>
  </section>
</div>

## Economy And Integrations

Wallet and token features are explicit rails, not a background permission pool. Agent wallets handle controlled Base and Solana balances plus x402 paid requests. UsePod is prepaid runtime access. Honey and Bankr HIVE are reward and claim paths. Integrations connect the control room to outside systems without making those systems own local state.

<div class="docGrid">
  <section class="docCard">
    <h3>Wallets, Tokens, Honey, HIVE, And x402</h3>
    <p>Agent wallets, USDC sends, MoneyClaw, UsePod deposits, wallet-vault backups, Honey rewards, Bankr HIVE claims, and paid requests.</p>
    <a href="wallets-honey-and-x402.html">Open wallet docs</a>
  </section>
  <section class="docCard">
    <h3>Monetization</h3>
    <p>The free-vs-paid product boundary, including HivemindOS Cloud Agent Calls as a premium managed LiveKit feature.</p>
    <a href="../monetization/">Open monetization</a>
  </section>
  <section class="docCard">
    <h3>Integrations And Work History</h3>
    <p>GitLawb Code Proof, Nango, GitHub OAuth fallback, My Apps, API-service launchers, phone pairing, dynamic changelog, and work history.</p>
    <a href="integrations-and-work-history.html">Open integrations</a>
  </section>
</div>

## Native And Background Surfaces

The browser and native app share the same Next.js UI. Tauri adds local filesystem and status helpers on This Mac, while AEON and Hermes keep their runtime-specific setup and background work docs separate.

<div class="docGrid">
  <section class="docCard">
    <h3>Native App</h3>
    <p>Tauri development shell, packaged Next server, native status bridge, and desktop filesystem helpers.</p>
    <a href="../native-app.html">Open native docs</a>
  </section>
  <section class="docCard">
    <h3>AEON Brain Access</h3>
    <p>GitHub Actions tailnet brain access with visibility-scoped policy and OIDC-gated brain endpoint calls.</p>
    <a href="../runtimes/aeon/github-actions-brain-access.html">Open AEON docs</a>
  </section>
  <section class="docCard">
    <h3>Hermes Local Setup</h3>
    <p>Local Hermes runtime setup notes for running interactive agent work beside the HivemindOS dashboard.</p>
    <a href="../runtimes/hermes/local-setup.html">Open Hermes docs</a>
  </section>
</div>

## Feature Map

```mermaid
flowchart TD
  Fleet["Fleet"] --> Runtimes["Agents and runtimes"]
  Fleet --> Apps["My Apps and API services"]
  Runtimes --> Chat["Chat"]
  Runtimes --> Phone["Phone calls"]
  Chat --> Work["Work board"]
  Work --> Scheduler["Scheduler"]
  Work --> Deliverables["Deliverables"]
  Work --> CodeProof["GitLawb Code Proof"]
  Work --> History["Work history"]
  Vault["Brain and vault"] --> Skills["Shared skills"]
  Vault --> GBrain["GBrain"]
  Vault --> Syntho["Syntho / Synthesis"]
  Vault --> Notifications["Notifications"]
  Vault --> Env["Shared env"]
  Runtimes --> OpenClaw["OpenClaw"]
  Runtimes --> MiroShark["MiroShark"]
  MiroShark --> Swarm["Swarm theater"]
  Runtimes --> Wallets["Wallets and tokens"]
  Wallets --> UsePod["UsePod prepaid"]
  Wallets --> TokenRails["Base / Solana / USDC"]
  Wallets --> Bankr["Bankr HIVE"]
  CodeProof --> Projects["Project registry"]
```
