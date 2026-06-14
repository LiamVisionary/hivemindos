---
title: "HivemindOS UI/UX Philosophy"
---

# HivemindOS UI/UX Philosophy

For the short implementation checklist, see [UI Rules](ui-rules.md).

## Core Idea

HivemindOS should feel like a digital hive: private, coordinated, efficient, modular, and alive.

But before it feels powerful, it must feel calm, obvious, and usable.

A beehive is beautiful because every part works. HivemindOS should follow the same rule:

> Beauty comes from clarity, coordination, trust, and function.

This is not a generic AI dashboard. It is a local control room for agent fleets across private machines.

The app may control complex agent systems, wallets, runtimes, memory layers, and machine networks, but the user should not have to carry that complexity in their head.

Assume the user is a layman.

They may be smart, capable, and ambitious, but they should not need to understand agent runtime internals, Tailnet topology, API routes, env variables, crypto payment protocols, provider keys, or model orchestration just to use the product safely.

## Core Principle

Simple first. Depth on demand.

Every screen should quickly answer three questions:

- What is happening?
- What needs attention?
- What is the next safe action?

If a control, number, explanation, configuration field, or technical label does not help answer one of those questions for an average user, it should not be part of the primary view.

Advanced details are welcome, but they should live one clear tap, press, or disclosure away.

## Design Principles

### 1. Beauty Through Function

Every UI element should help the user understand or act.

The interface should answer:

- What machine is this?
- What agents are running?
- What are they doing?
- Is the node healthy?
- Is it safe?
- What needs attention?
- What is the next safe action?

If something does not clarify the fleet, agents, memory, security, wallet state, setup state, or next action, remove it from the primary surface.

HivemindOS should not look intelligent because it says "AI." It should feel intelligent because the whole system is organized.

### 2. Machines First, Agents Second

Agents live on real machines.

The UI hierarchy should be:

```txt
Fleet
  Machine
    Runtime
      Agent
        Task / Session / Signal
```

Users should always know where an agent is running, whether that machine is reachable, and whether it is safe to interact with.

Do not show agents as floating abstract entities with no machine context.

### 3. Honeycomb Cards

Use modular cells as the base UI pattern.

Examples:

- Machine cell
- Agent cell
- Runtime cell
- Task cell
- Memory cell
- Handoff cell
- Security cell
- Wallet cell
- Setup cell

Each cell should have:

- One clear identity
- One primary status
- One main job
- One obvious safe action
- Expandable details

Cards should not become miniature dashboards.

Compact by default. Deep when inspected.

### 4. Signals Over Noise

The dashboard should prioritize meaningful signals, not raw logs or configuration data.

Default statuses should be human-readable:

- Healthy
- Running
- Idle
- Blocked
- Collector offline
- Needs setup
- Needs funding
- Requires approval
- Risk detected
- Memory synced
- Unknown node
- 3 days left

Avoid primary UI copy like:

- Configure x402 CAIP-2 network selector
- Survival ledger effective balance derivation
- Payment requirement policy resolver
- Runtime probe adapter failure

Technical language is fine in advanced views, docs, tooltips, and logs.

When technical language is unavoidable, pair it with a plain-English meaning.

Example:

```txt
Base wallet
Where this agent receives and spends funds.
```

### 5. Private By Default

HivemindOS's trust model should be visible everywhere.

Use clear labels:

- Tailnet-only
- Read-only collector
- No public port
- Stored locally
- Opt-in shared vault
- Secrets not exposed
- Requires approval

The user should always know what is private, what is local, what is read-only, and what could become risky.

Keep dangerous or money-moving controls separate from read-only status.

Never expose private keys, full card details, secret tokens, billing identity, or high-risk payment execution controls in broad overview UI.

### 6. Coordination With Attribution

The swarm should feel coordinated, but never anonymous.

Do not say:

```txt
The swarm completed this.
```

Say:

- Planner created the task.
- Researcher gathered context.
- Coder made changes.
- Reviewer flagged risks.
- Orchestrator approved handoff.

Show the intelligence of the whole system while preserving accountability for each agent.

The user should understand:

- Who did what?
- Why did it happen?
- What changed?
- What needs approval?
- What happens next?

### 7. Simple First, Deep When Needed

Complex features are welcome, but they need clear layers.

Use this hierarchy:

**Primary surface:** health, human-readable status, and safest next action.

**Secondary surface:** common setup and adjustment controls.

**Advanced surface:** raw provider settings, protocol details, endpoints, environment variables, debug output, logs, irreversible actions, and runtime internals.

Default view:

- Machine
- Status
- Agents
- Activity
- Warnings
- Primary action

Expanded view:

- Runtime details
- Collector metadata
- Ports
- Sessions
- Paths
- Memory sync
- Wallet settings
- Risk checks

Debug view:

- Raw payloads
- Stack traces
- Adapter responses
- Full logs
- Environment variables
- Endpoint paths
- Provider settings
- Payment protocol details

Simple first. Powerful underneath.

## Product Rules

### Primary Surface Rules

- Show the smallest useful surface by default.
- Prefer plain labels over technical protocol names in primary UI.
- Prefer status summaries over raw configuration values.
- Prefer one obvious action over a row of equally loud actions.
- Hide advanced settings behind labels like `Advanced`, `Details`, `Configure`, `View logs`, or `Developer settings`.
- Keep dense debug, logs, raw JSON, endpoint paths, keys, model settings, payment protocol details, and runtime internals out of the default path.
- If a user sees a page for the first time, they should be able to act without reading documentation.
- Write and design for a non-technical person first. Experts can open advanced sections when they need exact controls.

### Setup Rules

Make setup progressive:

1. Connect
2. Verify
3. Configure limits
4. Enable optional features
5. Expose advanced rails

Do not start with a giant configuration form.

The setup flow should feel like activating cells in a hive:

- Control room ready
- Tailscale detected
- Local machine discovered
- Collector verified
- First agent detected
- Shared brain connected
- Wallet configured
- Advanced controls available

Each step should make the system feel safer and clearer.

### Navigation Rules

Top-level tabs should be understandable at a glance.

They are for broad work modes, not every feature.

Recommended top-level structure:

- Fleet
- Agents
- Swarm
- Shared Brain
- Handoffs
- Wallets
- Security
- Settings

Within a work mode:

- Put the most common action close to the object it affects.
- Let users jump from summary cards into the relevant management surface.
- Keep overview pages scannable.
- Avoid making users remember where a feature lives.
- Do not bury important actions in unrelated settings pages.

## Visual Direction

The interface should feel like:

> Private Swarm Command

Use subtle hive structure without becoming cartoonish.

Prefer:

- Modular cards
- Subtle hex/grid geometry
- Dark graphite base
- Warm amber highlights
- Clear status colors
- Thin connection lines
- Calm motion for live activity
- Compact status rows
- Useful empty states

Avoid:

- Bee mascots
- Honey-drip visuals
- Yellow/black hazard cliches
- Fake sci-fi clutter
- Random AI-glow effects
- Nested card piles
- Dense forms by default
- Overanimated dashboards

The visual system should feel alive, but not distracting.

Motion should communicate state, not decorate emptiness.

## Copy Principles

Use direct, human copy.

Good:

- Set up wallet
- Needs funding
- 3 days left
- Requires approval
- Collector offline
- Agent is idle
- Open details
- Review risk

Avoid primary UI copy like:

- Configure x402 CAIP-2 network selector
- Survival ledger effective balance derivation
- Payment requirement policy resolver
- Runtime adapter probe failure
- Hermes task bus state reconciliation

Technical language is allowed in advanced views, logs, docs, and tooltips.

Primary UI should feel human.

## Wallet And Payments

Money features must be especially simple and calm.

Default wallet UI should focus on:

- Can the agent spend?
- How much can it safely spend?
- Will it stop soon?
- Does it need funding?
- Does it require approval?
- What should the user do next?

A wallet card should first show:

- Wallet on/off
- Balance or funding status
- Survival state
- One button to set up or manage

Advanced details belong inside setup flows or advanced sections:

- Provider keys
- x402 networks
- Burn-rate math
- Approval thresholds
- Payment policy internals
- Raw policy controls
- Protocol configuration

Never expose private keys, full card details, secret tokens, billing identity, or high-risk payment execution controls in broad overview UI.

Money-moving actions should require explicit confirmation and should never sit beside passive read-only status as if they are equally safe.

## Layout Philosophy

Recommended main dashboard structure:

```txt
Top Bar
  Fleet health
  Tailnet status
  Security state
  Wallet health

Left Rail
  Fleet
  Agents
  Swarm
  Shared Brain
  Handoffs
  Wallets
  Security
  Settings

Main View
  Machine groups
  Agent cells
  Activity timeline
  Alerts
  Setup prompts

Right Inspector
  Selected machine / agent / task details
  Logs
  Actions
  Risk notes
  Advanced controls
```

The right inspector is important.

The user should be able to inspect deeply without losing the fleet overview.

Do not make every click navigate away.

## Screen Philosophy

### Fleet Overview

Purpose: show all machines, collectors, runtimes, and agents.

Must answer:

- What is alive?
- What is unreachable?
- Where are my agents?
- Which machines need setup?
- What needs attention?

### Machine Detail

Purpose: show everything known about one device.

Must answer:

- What runtimes are present?
- What collector is running?
- What agents are active?
- What recent tasks exist?
- Is this machine safe and reachable?

### Agent Detail

Purpose: show one agent's activity, health, runtime, memory, and wallet state.

Must answer:

- What is this agent doing?
- What can it access?
- What has it recently completed?
- What is blocked?
- Does it need funding or approval?
- What context is attached?

### Shared Brain

Purpose: coordinate memory, handoffs, skills, and shared context.

Must answer:

- What does the swarm know?
- What needs to be handed off?
- What context is shared?
- Which agents are opted in?

### Swarm

Purpose: show multi-agent coordination.

Must answer:

- What is the objective?
- Who is assigned?
- What phase are we in?
- What decisions were made?
- What is the next action?

### Wallets

Purpose: show whether agents can safely spend and operate.

Must answer:

- Which agents can spend?
- Which agents need funding?
- Which agents are close to stopping?
- Which actions require approval?
- What is the safest next step?

### Security

Purpose: make trust visible.

Must answer:

- Is this private?
- What is exposed?
- What is read-only?
- Are secrets protected?
- Which nodes are trusted?
- Which actions are risky?

## Empty States

Empty states should teach, but briefly.

Bad:

```txt
No agents found.
```

Good:

```txt
No agent nodes found yet.

Install the read-only collector on another Tailscale-connected machine to detect agents inside your private network.
```

Bad:

```txt
No wallet configured.
```

Good:

```txt
No wallet set up yet.

Set up a wallet when you want this agent to pay for approved tools or services.
```

Bad:

```txt
No Obsidian vault configured.
```

Good:

```txt
No shared brain connected yet.

Connect an Obsidian vault to give agents a common place for memory, handoffs, and shared project context.
```

## Acceptance Check

Before shipping a UI change, ask:

- Can a first-time user understand the screen in ten seconds?
- Is the safest next action visually obvious?
- Did we hide non-essential complexity behind a clear control?
- Are advanced controls available without dominating the page?
- Did we avoid turning a simple task into a configuration exercise?
- Does every card have one main job?
- Are dangerous or money-moving actions clearly separated from read-only status?
- Is the copy understandable to a non-technical user?

If the answer is no, simplify the primary surface before adding more capability.

## Product Feeling

The ideal user experience:

```txt
I open HivemindOS.

I instantly see my private fleet.
I know which machines are alive.
I know which agents are working.
I know what they are doing.
I know what needs attention.
I know what is private and safe.
I know whether agents can spend safely.
I can approve, configure, or inspect only when needed.
I can coordinate many agents like one intelligent organism.
```

That is the hive principle:

- Many small cells
- Clear local signals
- Shared memory
- Efficient coordination
- Visible trust
- Simple surfaces
- Depth on demand
- Distributed intelligence

HivemindOS should not overwhelm users with power.

It should make power feel obvious, safe, and usable.
