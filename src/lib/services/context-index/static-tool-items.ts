import type { ContextIndexItem } from "@/lib/services/context-index";
import { JSON_RENDER_COMPONENT_LIST } from "@/components/json-render/catalog";

type AbsolutePathResolver = (path: string) => string;

export function founderModeContextIndexItem(absolutePath: AbsolutePathResolver): ContextIndexItem {
  return {
    id: "tool-schema:founder-mode",
    kind: "tool-schema",
    title: "Founder Mode goal-to-company compiler",
    summary: "Compiles one outcome into a governed Zero Human Company blueprint with crew, capabilities, compute routes, budgets, Labs, and proof requirements.",
    tags: ["founder mode", "goal compiler", "zero human company", "company", "crew", "capability routing", "outcome routing", "hivemind labs", "proof pack", "budget", "approval"],
    aliases: ["turn goal into company", "start one person company", "found an ai company", "goal to outcome", "company blueprint", "create outcome lab"],
    retrievalText: [
      "Use POST /api/founder with action compile for a read-only company blueprint from a natural-language outcome. It discovers stored agents, capability-index matches, fleet model fit, privacy preferences, budget tier, and pace.",
      "Use POST /api/founder with action found only after the operator approves the blueprint. Founding creates a local company and its first private Agent Challenge-backed Hivemind Lab; it does not launch autonomous work.",
      "Use /api/hivemind-labs to list a company's Labs, create a bounded experiment, record measured evidence, and generate a capability-promotion draft. A reviewable Lab can run fusion-preview to compose a no-write Hive Skill Fusion draft, then fusion-publish only after explicit operator confirmation; promotion never publishes a skill or marketplace listing automatically.",
      "Adaptive model routing consumes local outcome-routing records so accepted task outcomes can adjust provider/model selection beyond metadata and transport reliability. POST /api/outcome-routing records an operator- or evaluator-confirmed result; local records are not official hosted reputation or commercial authority.",
      "Task detail proof packs combine Work Board deliverables, eval receipts, machine/agent provenance, and signature-verified work receipts. They label unverified gaps instead of claiming blanket verification.",
    ].join(" "),
    route: "/api/founder",
    methods: ["POST"],
    path: absolutePath("src/app/api/founder/route.ts"),
    load: { type: "api", target: "/api/founder", note: "Compile is read-only. Found creates local durable state but does not start autonomy." },
  };
}

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

export function hiveComputeContextIndexItem(): ContextIndexItem {
  return {
    id: "tool-schema:hive-compute-marketplace",
    kind: "tool-schema",
    title: "Hive Compute marketplace routing",
    summary: "GPU-first HivemindOS model routes plus an in-app Hive Compute host flow for spare-GPU earning.",
    tags: ["hive compute", "gpu marketplace", "inference routing", "spare gpu", "worker module", "ollama", "lm studio", "x402", "mpp", "tee", "model provider", "chat completions", "earn"],
    aliases: [
      "rent out GPU",
      "rent compute",
      "earn with spare GPU",
      "marketplace inference",
      "Hive Compute Worker",
      "machine-speed payments",
      "TEE inference privacy",
      "GPU job routing",
    ],
    retrievalText: [
      "Select the HivemindOS model provider and GPU-first routes such as hivemindos/auto, hivemindos/fast, or hivemindos/deep when a user wants marketplace GPUs first with hosted OpenRouter fallback.",
      "The HivemindOS Models chat route tries Hive Compute through the local /api/hive-compute/chat/completions proxy, then falls back to the matching OpenRouter-backed HivemindOS hosted model tier when the marketplace route is unavailable.",
      "The dashboard view 'compute' and Fleet Rent compute modal call /api/hive-compute/marketplace to report setup readiness, install or repair the optional worker module under ~/.hivemindos/modules/hive-compute-worker, install dependencies, discover LM Studio/OpenAI-compatible or Ollama local models, open an MPP machine-payment session, and start or stop the managed worker process.",
      "UsePod compute rentals are retained only behind NEXT_PUBLIC_HIVEMINDOS_USEPOD_COMPUTE_RENTALS_ENABLED; the default in-app compute rental path is Hive Compute.",
      "The worker uses the native hosted WebSocket protocol, supports Ollama or LM Studio/OpenAI-compatible local servers, and requires HIVEMINDOS_HIVE_COMPUTE_WORKER_TOKEN before it can accept jobs.",
      "x402 is the default per-call payment rail. MPP session settlement is optional and requires HIVEMINDOS_HIVE_COMPUTE_MPP_POLICY_URL from a compatible hosted gateway; POST action open-mpp-session stores a short-lived local session token, and HIVEMINDOS_HIVE_COMPUTE_MPP_REQUIRE_SESSION makes workers reject jobs without gateway payment proof.",
      "Standard workers receive prompt contents for jobs they accept. Hardware-enforced privacy requires gateway-verified TEE attestation evidence, encrypted prompt delivery keys, and a compatible policy; set HIVEMINDOS_HIVE_COMPUTE_CONFIDENTIAL_MODE=tee-attested plus TEE provider/evidence/key envs before claiming a worker is hardware-confidential.",
      "Official marketplace matching, payout, quota, entitlement, receipts, fraud controls, provider bonds, reputation, x402/MPP settlement, TEE attestation enforcement, and platform fee authority must stay in HivemindOS-controlled hosted infrastructure. The public repo contains only client adapters, worker setup, self-hosted-compatible protocol code, and docs.",
    ].join(" "),
    route: "/api/hive-compute/marketplace",
    methods: ["GET", "POST"],
    load: {
      type: "api",
      target: "/api/hive-compute/marketplace",
      note: "GET reports non-secret setup readiness. POST installs, repairs, opens MPP sessions, starts, or stops the optional local worker module. It must not enforce official payouts locally.",
    },
  };
}

export function managedCloudAgentsContextIndexItem(): ContextIndexItem {
  return {
    id: "tool-schema:managed-cloud-agents",
    kind: "tool-schema",
    title: "HivemindOS managed cloud agents",
    summary: "One-click dedicated Hermes agents with persistent workspaces, server-metered credits, managed inference, and stop/start lifecycle controls.",
    tags: ["managed cloud", "cloud agent", "hosted agent", "always on", "hermes", "persistent workspace", "pay as you go", "Base USDC", "agent hosting"],
    aliases: ["deploy cloud agent", "agent runs while computer is off", "host hermes", "always-on agent", "one-click agent deploy", "stop cloud agent", "start cloud agent"],
    retrievalText: [
      "Use GET /api/managed-cloud-agents to read the official plan catalog, encrypted hosted-account readiness, eligible governed Base wallets, current credit balance, and owned managed agents.",
      "Use POST /api/managed-cloud-agents action top_up to request a server-authored Base USDC quote and fund managed credits through the selected local wallet. The route enforces wallet custody, network, per-payment cap, cumulative budgets, company kill switches, approval thresholds, exact USDC contract, amount, recipient, quote expiry, and onchain settlement before storing the hosted account credential in an encrypted local vault.",
      "Use POST action create to provision a dedicated Hermes VM, firewall, stable Primary IP, and persistent volume. Plans, regions, model tiers, provider resource IDs, prices, credit balances, and official payment recipients are controlled by HivemindOS hosted infrastructure rather than the downloaded client.",
      "Use POST actions status, start, stop, delete, and chat for lifecycle and browser chat. Stop deletes compute but retains persistent storage; start creates fresh compute around the same workspace; delete removes compute and storage.",
      "Current beta managed agents include the persistent Hermes workspace and managed inference. A cloud-native OAuth/MCP must be promoted into hosted secret storage to remain available while personal machines are off. A machine-hosted MCP or local file/app capability remains available only while its source machine and Tailnet bridge are online. Do not claim automatic Tailnet enrollment, Shared Brain sync, or local-MCP portability until those user-authorized bridges report ready.",
    ].join(" "),
    route: "/api/managed-cloud-agents",
    methods: ["GET", "POST"],
    load: {
      type: "api",
      target: "/api/managed-cloud-agents",
      note: "GET is read-only. Top-up spends Base USDC, create/start/stop/delete mutate hosted resources, and chat spends managed inference credit.",
    },
  };
}
