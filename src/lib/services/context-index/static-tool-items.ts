import type { ContextIndexItem } from "@/lib/services/context-index";
import { JSON_RENDER_COMPONENT_LIST } from "@/components/json-render/catalog";

type AbsolutePathResolver = (path: string) => string;

export function dashboardSwarmGoalContextIndexItem(absolutePath: AbsolutePathResolver): ContextIndexItem {
  const hookPath = absolutePath("src/features/dashboard/hooks/dashboard-swarm-goal-command.ts");
  return {
    id: "tool-schema:dashboard-swarm-goal",
    kind: "tool-schema",
    title: "Dashboard /swarm-goal command",
    summary: "Dashboard chat command that rewrites a loose build request into a richer build prompt, appends parallel-agent /goal instructions, and submits it to Queen Bee for Work Board delegation.",
    tags: ["swarm-goal", "swarm", "goal", "slash-command", "dashboard", "chat", "queen-bee", "orchestration", "parallel-agents", "agent-routing", "build", "implementation", "work-board", "capability"],
    aliases: [
      "/swarm-goal",
      "swarm goal",
      "parallel agent goal",
      "spawn agents with goals",
      "build with swarm",
      "queen bee build delegation",
      "rewrite build prompt",
      "agent swarm build",
      "dedicated /goal",
      "orchestrated build prompt",
    ],
    retrievalText: [
      "Use the dashboard chat slash command /swarm-goal <build request> when the user gives a loose build/create/make request and wants Queen Bee to orchestrate multiple agents.",
      "/swarm-goal rewrites the request into: Build [THING] in [TECH/FRAMEWORK]. It should include [MAIN FEATURES], with [INTERACTION/ANIMATION/BEHAVIOR DETAILS]. Make it feel [MOOD/QUALITY], using [VISUAL DETAILS], [ENVIRONMENT DETAILS], and [EXTRA EFFECTS].",
      "The command appends: For this task, write yourself a new goal and spawn agents in parallel, as many as needed to do it better and faster. Split the work into independent pieces, dispatch them concurrently, and synthesize the results as they return. Give each agent its own dedicated /goal.",
      "Dashboard implementation: src/features/chat/swarm-goal-prompt.ts builds the expanded prompt, src/features/dashboard/hooks/dashboard-swarm-goal-command.ts submits it to /api/queen-bee with mode act, priority high, and skills planner/code/qa.",
      "Queen Bee route: POST /api/queen-bee creates or reuses a Work Board task, ranks chat-capable fleet agents, records receipts under Operations/Brain Services/Queen Bee, and schedules autonomous pickup for act-mode delegated tasks.",
      "Side effects: this creates a Work Board task and may start autonomous agent pickup. Use a plan/dry-run or direct /api/queen-bee mode plan if you only need to inspect routing without launching work.",
    ].join(" "),
    route: "/api/queen-bee",
    methods: ["POST"],
    path: hookPath,
    load: {
      type: "file",
      target: hookPath,
      note: "Load with src/features/chat/swarm-goal-prompt.ts when checking the exact prompt rewrite and Queen Bee payload.",
    },
  };
}

export function jsonRenderContextIndexItem(absolutePath: AbsolutePathResolver): ContextIndexItem {
  return {
    id: "tool-schema:json-render-dashboard-ui",
    kind: "tool-schema",
    title: "json-render dashboard UI",
    summary: "Guardrailed assistant-generated UI rendering in chat with @json-render/core and @json-render/react.",
    tags: ["json-render", "generative-ui", "dynamic-ui", "dashboard", "chat", "renderer", "json", "react", "spec", "catalog", "tool"],
    aliases: ["json render", "render json ui", "generative ui", "dynamic dashboard card", "assistant generated ui"],
    retrievalText: [
      "HivemindOS chat can render a fenced json-render spec returned by an assistant or tool output.",
      `Use a fenced block labelled \`\`\`json-render containing a flat spec with root and elements, or emit json-render SpecStream JSON patch lines. The dashboard only accepts the local guarded catalog: ${JSON_RENDER_COMPONENT_LIST}.`,
      "Every element must have a supported type, props object, and children array. Every child key must exist in elements. Optional top-level state is allowed for json-render dynamic values.",
      "Dynamic values support $state, $bindState, $cond, $template, $computed, and directive-style helpers such as $format, $concat, $count, $truncate, $pluralize, $join, and $t. Element-level watch can fire guarded actions when a state path changes.",
      "Use Callout for prominent notes, KeyValueList for labeled facts, DataTable for compact records, CodeBlock for specs or snippets, Progress for percentages, List for steps, and form controls only for local non-authoritative interaction. Button props support label, optional safe url, optional copyText, and variant primary/secondary/danger. Generated UI can open safe URLs, copy text, or emit local dashboard events; it must not claim to execute hidden wallet, file, shell, payment, or network mutations.",
      "Unknown component types, invalid props, missing child references, and malformed specs are displayed as plain text instead of executed.",
    ].join(" "),
    path: absolutePath("src/components/json-render/JsonRenderSurface.tsx"),
    load: {
      type: "file",
      target: absolutePath("src/components/json-render/JsonRenderSurface.tsx"),
      note: "Load for the exact supported component catalog and sanitizer before asking an agent to emit json-render UI.",
    },
  };
}

export function loopEngineeringContextIndexItem(absolutePath: AbsolutePathResolver): ContextIndexItem {
  return {
    id: "tool-schema:loop-engineering-readiness",
    kind: "tool-schema",
    title: "Loop engineering readiness",
    summary: "Work Board loop contracts, receipts, budgets, Queen Bee activity, and pattern registry readiness exported as HivemindOS-native L0-L3 loop audits plus LOOP.md / STATE.md snapshots.",
    tags: ["loop", "loop-engineering", "readiness", "audit", "work-board", "queen-bee", "scheduler", "patterns", "registry", "LOOP.md", "STATE.md", "budget", "run-log", "hive-loop", "cobus"],
    aliases: ["loop engineering", "loop readiness", "audit loops", "export LOOP.md", "export STATE.md", "loop budget", "loop run log", "pattern registry", "Cobus loop engineering", "unattended loop readiness"],
    retrievalText: [
      "Use /api/loops when a workflow needs HivemindOS loop engineering readiness, built-in loop patterns, loop templates, verifier definitions, or exportable loop artifacts.",
      "GET /api/loops lists pattern registry entries, templates, and verifiers. GET /api/loops?readiness=true audits the current Work Board. Add artifacts=true to return LOOP.md, STATE.md, loop-budget.md, loop-run-log.md, and patterns/registry.yaml content.",
      "POST /api/loops with action readiness returns the read-only readiness report. POST with action export-artifacts or export returns the same report plus artifact strings. POST with action create-task is the side-effectful path that creates a Work Board task with a generated loop contract attached.",
      "Raw agents can run pnpm loop:audit, node scripts/hive-loop audit --json, node scripts/hive-loop export --write <folder>, or node scripts/hive-loop patterns to inspect the same registry and Work Board state without needing dashboard UI access.",
      "Readiness levels: L0 means registry only or missing state, L1 means report-ready board state, L2 means assisted loop structure with contracts and gates, and L3 means unattended-capable structure with gates, receipts, budgets, recent activity, and human handoff gates.",
      "The readiness score checks pattern registry, durable Work Board state, loop contracts, eval gates, verification receipts, run history, budget limits, human gates, Queen Bee or flow coordination, worktree isolation, and learning memory from experiments or anti-patterns.",
    ].join(" "),
    route: "/api/loops",
    methods: ["GET", "POST"],
    path: absolutePath("src/app/api/loops/route.ts"),
    load: {
      type: "api",
      target: "/api/loops",
      note: "Use readiness/export for read-only audits. Use create-task only when the user wants a new Work Board task.",
    },
  };
}
