---
title: "Work Board And Scheduler"
---

# Work Board And Scheduler

The Work board is where intent turns into agent work.

It gives humans and agents the same shared task surface. Scheduler handles the work that should happen later or repeat in the background.

<figure class="imagePlate">
  <img src="../../assets/img/diagrams/workboard-scheduler-loop.jpg" alt="Generated workboard and scheduler loop infographic showing Ideas, Ready, Working, Done, Scheduler, Deliverables, and History.">
  <figcaption>Work moves from capture to assignment to deliverables and history, while Scheduler feeds repeatable background runs into the same shared record.</figcaption>
</figure>

## Work Board

How it works:

- API route: `/api/kanban`.
- Storage service: `src/lib/services/kanban/local-kanban-store.ts`.
- Shared-vault storage is preferred under the configured Obsidian Kanban folder.
- Local fallback storage is `~/.hivemindos/kanban`.
- Project provenance metadata is stored separately in `Operations/Code Projects/projects.json`, with `~/.hivemindos/projects.json` as fallback.
- Agent dispatch is handled in `use-kanban-dispatch-controller`.

Columns:

| Column | Purpose |
|---|---|
| Ideas | Capture rough thoughts that should not run yet |
| Waiting for Queen | Ready for assignment |
| Working | Claimed by an agent |
| Needs You | Blocked on access, approval, or a decision |
| Done | Completed with notes, evidence, result, or deliverables |
| Archived | Hidden from the main board but retained |

What the Work board can do:

- Create and switch named boards.
- Create, update, move, archive, and delete tasks.
- Filter by tenant, assignee, search text, and archived state.
- Bulk move or bulk assign selected cards.
- Dispatch tasks to agents.
- Detect stale or no-progress work.
- Preserve agent sessions on cards.
- Store attachments, linked directories, target machines, comments, events, run records, child links, and deliverables.
- Optionally attach a Hivemind project to a task with `projectId`.
- Preserve sanitized GitLawb proof records on cards through optional `proofs`.
- Attach closed/open/optimizer loop contracts with success criteria, budgets, pre/post eval gates, and receipts.
- Fail loop-gated tasks closed to Needs You when required eval gates do not have passing receipts.
- Record optimizer loop experiments with parent lineage, hypotheses, scores, gate receipts, selected agents, and outcomes.
- Rank loop frontier candidates with Evo-style strategies such as `argmax`, `top_k`, seeded `epsilon_greedy`, `softmax`, and `pareto_per_task`.
- Preserve "what not to try" anti-patterns on the loop so future agents can avoid repeated failed approaches.
- Store benchmark discovery metadata including target, command, metric direction, score floor, resource profile, instrumentation mode, and discovered gates.
- Expose a loop observation summary with best score, running-best lineage, frontier items, gate counts, experiment counts, and anti-pattern count.
- Show compact Code Proof badges for project-linked tasks.
- Extract local paths and URLs from completed output into deliverables.
- Roll completed child deliverables into parent handoff tasks while filtering planning/source artifacts.
- Open or reveal deliverables through `/api/kanban/deliverable`.
- Import tasks from notes through `/api/note-intake`.
- Use machine-aware directory picking for linked folders: native picker for This Mac in desktop builds, collector directory browsing for remote machines, and API fallback in the browser.
- Capture quick-add text, files, images, directories, target machine, and voice transcripts directly in each lane.
- Steer active tasks with comments, attachments, target-lane selection, and interruption/reclaim actions.

### Agent And MCP Orchestration

Agents can use the same Work Board path through the HivemindOS MCP server. The `work_board` tool covers the normal task lifecycle: list, create task, claim next, heartbeat, comment, complete, fail, block, and promote. This gives raw coding agents a shared queue without bypassing the board, receipts, comments, loops, attachments, target machines, or human review lanes.

The `request_human_approval` MCP tool creates a Needs You card for a decision. It records the request, context, options, and related task, but it does not approve the action or override any HivemindOS safety policy. Humans still decide in the dashboard or through the normal Work Board review flow.

Event-driven work uses `/api/work-events` and the `work_event` MCP tool. Operators or agents can define a local event name, attach triggers, and later publish an event payload. Matching triggers create ordinary Work Board tasks, with optional FAQ text and a note telling the worker which follow-up event to publish when the work completes. This supports publish-event style coordination while keeping execution inspectable in the Work Board.

Agent Challenges use `/api/agent-challenges` and the `agent_challenge` MCP tool for bounded multi-agent objectives. A challenge keeps one public-within-the-hive board for candidates, findings, run requests, results, rulings, integrity alerts, and playbook notes. It records credited lineage across originators, runners, and verifiers; enforces optional per-agent daily run caps; and treats result deltas inside the configured significance threshold as frontier ties. Use a challenge when agents should collaborate on a measurable sprint before individual tasks or final deliverables are promoted through the normal Work Board.

### Queen Bee Swarm Goals

`/swarm-goal <build request>` is the chat shortcut for turning a rough software idea into Queen Bee-orchestrated work.

The command expands a short request into a more complete build brief, including:

- the thing to build and likely framework
- expected features
- interaction, animation, and behavior details
- mood, visual direction, environment context, and effects
- explicit instructions for the coordinator to create a goal, split work into independent pieces, spawn parallel agents, and give each worker its own dedicated `/goal`

After rewriting the prompt, HivemindOS submits it to `/api/queen-bee`. Queen Bee records the request as a Work Board task, ranks online chat-capable fleet agents by worker class and routing context, writes the normal receipt trail, and can schedule autonomous pickup for act-mode tasks. Use ordinary Queen Bee or Work Board planning flows when you want to inspect routing without starting the build.

Queen Bee also writes visual plan artifacts for accepted tasks and PRD decompositions. These artifacts link back to the Work Board task or PRD epic, include a route/dependency diagram, and show risk notes so a human reviewer can understand the plan without opening the full task body first. They are visible from the Memory review workbench and through `/api/visual-artifacts`.

The `queen_bee` MCP tool exposes the same coordinator path for non-dashboard agents: read coordinator state, queue a task, decompose a PRD, or operate Queen Bee flow templates and runs. It still routes through HivemindOS API routes, so fleet routing, idempotency, receipts, and visual plans remain on the normal local-first record.

### Loop Contracts And Eval Gates

Loop contracts are a generic HivemindOS primitive. Work Board tasks can carry one, but the same contract can be started from chat, Scheduler, Queen Bee flows, company dispatch, or Evo-backed optimization. The shared `LoopSpec` records the mode (`closed`, `open`, or `optimizer`), goal, success criteria, retry/runtime budget, handoff rules, required evidence, and named eval gates. Work Board stores it on the task as `loop` for backward compatibility.

Eval gates follow the Evo-style split between `pre` gates and `post` gates. A `pre` gate is intended for checks that can fail early before spend or external work. A `post` gate is intended for checks that need the worker result, benchmark output, artifact, or human review. Required gates must be satisfied by passing `loopReceipts` before `/api/kanban` will complete the task; missing gate receipts move the card to Needs You and leave a `loop.eval-blocked` event instead of silently marking work done.

Optimizer loops add five Evo-derived surfaces on top of the same task record:

- Experiment lineage: `loop.experiments` records each hypothesis, parent experiment, score, per-task scores, status, result, agent, and gate receipts.
- Frontier strategy: `loop.frontierStrategy` controls how the next attempt is selected. The stored observation ranks current leaves so agents can exploit the best branch or preserve specialists.
- What-not-to-try memory: `loop.antiPatterns` captures discarded approaches with reasons and evidence, close to the task rather than buried in chat.
- Benchmark discovery: `loop.benchmark` records the target, command, metric direction, score floor, resource profile, instrumentation choice, and discovery notes.
- Observability: `loop.observation` summarizes best score, running-best experiment ids, frontier candidates, pending gates, experiment totals, and anti-pattern count for dashboard cards and agents.

The generic `/api/loops` facade lists the machine-readable pattern registry, reusable templates, and verifier definitions, builds loop contracts from a natural goal, and can create a normal task with the generated loop attached. It can also audit the current board's loop-readiness level and export `LOOP.md`, `STATE.md`, `loop-budget.md`, `loop-run-log.md`, and `patterns/registry.yaml` snapshots for humans or raw agents. The `hive-loop` CLI exposes the same audit and export path outside the dashboard. It does not store a second loop record. Work Board-specific loop updates still flow through `/api/kanban` actions:

- `loop-discover`: attach or update benchmark discovery, gates, success criteria, and frontier strategy.
- `loop-record`: append/update one experiment and optional anti-pattern records, then refresh the observation summary.

Built-in patterns include code-fix, app-build harness, research, content, daily brief, operating-unit learning, and Evo benchmark loops. Built-in verifiers include lint, typecheck, focused tests, Playwright smoke tests, artifact existence, independent judge review, human approval, evidence receipts, Evo score improvement, and governance policy checks. For the readiness ladder and operator commands, see [Loop Engineering](loop-engineering.html).

### Zero-Human Company Learning Loops

For the full company cockpit and launch flow, see [Zero Human Companies](zero-human-companies.html).

Zero-human companies use the same generic loop contract as their private learning layer. When a company launches its apex goal, HivemindOS decomposes the goal into Work Board tasks and attaches an operating-unit learning loop to each dispatched task.

The default company loop is non-blocking at creation time: agents can finish useful work, while eval gates, evidence requirements, experiment candidates, and Pareto frontier metadata are preserved for later review. This gives the company a model-independent "company veteran" layer made of outcomes, artifacts, workflows, receipts, avoided failure modes, and private eval structure.

The Zero Human Company cockpit summarizes that layer as capability capital:

- learning assets from completed work, durable outputs, committed experiments, and anti-patterns
- workflow assets from reusable task skills and committed loop branches
- private eval gates and pass rate
- Evo-style frontier candidates and experiment count
- distillation queue for completed work that should be reviewed before it becomes durable Shared Brain Memory
- model-independence score from runtime diversity, eval structure, and Evo-compatible frontier metadata

This keeps the company learning loop owned by the workspace rather than any single model. Future workers can change, but the company's charter, evals, receipts, artifacts, and reviewed memory remain portable.

## Note Intake And Work History

The Work surface also acts as an audit and intake console:

- `/api/note-intake` scans configured vault folders for unchecked markdown tasks and "Next action" sections, then imports selected items into Ideas.
- The board settings surface controls note-intake enablement and folder scope through the shared-vault config.
- `/api/work-history` reads dynamic changelog and repository activity, then supports project filters, text search, paging, and append loading in the History tab.
- Work History is rendered beside Workboard, Automations, and Simulation so local changes and agent work stay visible without leaving the control room.

## Project Provenance

The Work board can link tasks to Hivemind projects without forcing every task to be part of a repo.

How it works:

- `GET /api/projects` reads the project registry.
- `POST /api/projects` creates or updates a project.
- `POST /api/projects/link-gitlawb` links a project to GitLawb repo metadata.
- Kanban task records can include `projectId` and sanitized `proofs`.
- Queen Bee uses the same registry plus collector-reported `version.projects` / `version.projectCheckouts` git state to assign code tasks to the machine with the matching and freshest checkout.

This lets one machine work across many projects and many GitLawb repos. The shared Brain keeps private task and memory context. GitLawb carries public-key code provenance.

## Scheduler

How it works:

- Shared schedule files are stored through `src/lib/services/obsidian/scheduled-runs.ts`.
- Runtime schedule APIs are exposed through `/api/runtimes/[runtime]/schedules` and `/api/scheduler/runtime-action`.
- Scheduler UI behavior lives in `src/features/dashboard/hooks/use-scheduler-controller.tsx`.
- Skill-backed actions use `/api/scheduler/skill-action`.
- Local folder browsing can use the Tauri native filesystem bridge through `src/lib/native/filesystem.ts` before falling back to `/api/scheduler/browse-folder`.

What Scheduler can do:

- Create and import schedules.
- Run, pause, resume, and inspect runtime schedules where supported.
- Track past scheduled runs in the shared vault.
- Browse folders and attach runtime or skill context.
- Route scheduled prompts through supported agents.
- Expand or collapse long schedule descriptions without silently truncating them.
- Show run-state phases such as assigned, thinking, executing, wrapping, and done.
- Create new jobs from the scheduler rail and use cadence templates for cron, interval, daily, weekday, and market/session-like schedules.

## AEON Deliverables And Scheduled Work

AEON work now has a stronger handoff loop:

- `/api/runtimes/aeon/deliverables` discovers recent artifacts from the shared vault and local AEON output folders.
- AEON repo cards can show new deliverable counts.
- The Deliverables tab renders artifact cards with readable titles, excerpts, facts, open/download actions, and download-to-machine flows.
- Scheduler controls can be embedded in AEON context so scheduled background work and repo deliverables stay connected.

## Main Code Paths

- `src/app/api/kanban/route.ts`
- `src/app/api/kanban/deliverable/route.ts`
- `src/app/api/work-events/route.ts`
- `src/app/api/agent-challenges/route.ts`
- `src/app/api/note-intake/route.ts`
- `src/app/api/work-history/route.ts`
- `src/lib/services/work-events.ts`
- `src/lib/services/agent-challenges.ts`
- `src/lib/services/kanban/local-kanban-store.ts`
- `src/lib/services/projects/project-registry.ts`
- `src/lib/services/gitlawb/gitlawb-service.ts`
- `src/lib/services/notes/note-task-intake.ts`
- `src/lib/services/work-history/dynamic-changelog.ts`
- `src/features/dashboard/views/KanbanPanel.tsx`
- `src/features/dashboard/hooks/use-kanban-task-controller.tsx`
- `src/app/api/projects/**`
- `src/app/api/gitlawb/**`
- `src/features/dashboard/hooks/use-kanban-dispatch-controller.tsx`
- `src/features/dashboard/hooks/use-scheduler-controller.tsx`
- `src/components/scheduler/**`
- `src/features/dashboard/views/AeonAutopilotPanel.tsx`
- `src/features/dashboard/views/AeonDeliverablesPanel.tsx`
- `src/app/api/runtimes/aeon/deliverables/route.ts`
- `src/lib/native/filesystem.ts`
