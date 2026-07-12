import { z } from "zod";
import { defineHiveAction } from "./define";
import { SLACK_TOKEN_ENV } from "@/lib/services/integrations/provider-connection-env";
import { azureResourcesAction } from "./integrations/azure-resources";
import { googleSlidesEditAction, googleSlidesReadAction } from "./integrations/google-slides";
import { deployHivemindosMachineAction, hivemindosMachinesCatalogAction } from "./integrations/hivemindos-machines";
import { managedCloudAgentsAction } from "./managed-cloud-agents";
import { appBuilderAction } from "./app-builder";
import { hostedMediaCatalogAction, hostedMediaGenerationAction, hostedMediaReadAction } from "./hosted-media";
import { robinhoodAgenticReadAction } from "./robinhood-agentic";
export { deployHivemindosMachineAction, hivemindosMachinesCatalogAction } from "./integrations/hivemindos-machines";
export { managedCloudAgentsAction } from "./managed-cloud-agents";
export { appBuilderAction } from "./app-builder";
export { robinhoodAgenticReadAction } from "./robinhood-agentic";
export { googleSlidesEditAction, googleSlidesReadAction } from "./integrations/google-slides";

const handoffTargetSchema = {
  target: z.string().describe("Fuzzy machine name, such as ubuntu."),
  allowAmbiguous: z.boolean().optional(),
};

const jsonObjectSchema = z.record(z.string(), z.unknown());

const kanbanStatusSchema = z.enum([
  "ideas",
  "ready",
  "working",
  "needs-human",
  "done",
  "archived",
]);

const kanbanPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

const cryptoIntentSchema = z
  .enum([
    "status",
    "portfolio",
    "receive",
    "send",
    "private-transfer",
    "paid-api",
    "private-paid-api",
    "trade",
    "crosschain-swap",
    "bridge",
    "crosschain-payment",
    "token-launch",
    "polymarket",
    "hyperliquid",
    "automation",
    "nft",
    "agent-job",
    "card-payment",
    "fund-llm-credits",
  ])
  .optional();

const nansenActionSchema = z.enum([
  "status",
  "token-brief",
  "wallet-brief",
  "hyperliquid-brief",
  "market-scout",
  "simple-template",
  "complex-template",
  "agent",
]);

const nansenSimpleTemplateSchema = z.enum([
  "defi-positions",
  "smart-money-holdings",
  "token-top-holders",
  "token-screener-discovery",
]);

const nansenComplexTemplateSchema = z.enum([
  "token-tracking-smart-money",
  "hyperliquid-wallet-discovery",
  "related-wallets-scale",
  "top-wallet-copytrade-research",
  "cex-health-monitor",
]);

const nansenTemplateSchema = z.union([nansenSimpleTemplateSchema, nansenComplexTemplateSchema]);

export const listHivemindMachinesAction = defineHiveAction({
  id: "fleet.list-machines",
  title: "List HivemindOS machines",
  description:
    "List connected HivemindOS machines and their available agents without side effects.",
  schema: z.object({}),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["fleet", "machine", "agent", "handoff", "mcp"],
  aliases: ["list_hivemind_machines", "fleet machines", "connected machines"],
  mcp: { expose: true, compact: true, toolName: "list_hivemind_machines" },
  contextIndex: {
    summary:
      "Read-only inventory of connected HivemindOS machines and available runtime agents.",
    retrievalText:
      "Use list_hivemind_machines before handoff, remote delegation, fleet routing, or choosing where a task should run. It reads the dashboard fleet state and does not mutate remote machines.",
    route: "/api/fleet/discover",
    methods: ["GET"],
  },
});

export const planHandoffAction = defineHiveAction({
  id: "handoff.plan",
  title: "Plan HivemindOS handoff",
  description:
    "Resolve a fuzzy machine name and select the best target agent without sending files or starting work.",
  schema: z.object({
    ...handoffTargetSchema,
    note: z.string().optional(),
  }),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["handoff", "fleet", "machine", "agent", "planning"],
  aliases: ["plan_handoff", "handoff dry run", "choose target machine"],
  mcp: { expose: true, compact: true, toolName: "plan_handoff" },
  contextIndex: {
    summary: "Dry-run handoff target resolution and best-agent selection.",
    retrievalText:
      "Use plan_handoff when a machine name is ambiguous or before sending a task/file to another HivemindOS machine. It should not create transfer files or start a remote agent.",
    route: "/api/handoff",
    methods: ["POST"],
  },
});

export const workBoardAction = defineHiveAction({
  id: "work-board.lifecycle",
  title: "Work Board lifecycle",
  description:
    "List, create, claim, heartbeat, comment, complete, fail, block, or promote local-first Work Board tasks. When you block or fail a task because it needs human input, access, approval, or a decision, include a line starting exactly `ACTION NEEDED:` in the reason telling the human precisely what to do or decide — it becomes the card's headline on the Work Board. Optionally follow it with `LINK: <url>` (where the human gets or does the thing), `OPTIONS: <a> | <b>` (for decisions), or `NEEDS: api-key <ENV_VAR_NAME>` / `NEEDS: file` / `NEEDS: text` — the board renders these as one-click controls and the answer returns to the task.",
  schema: z.object({
    action: z
      .enum([
        "list",
        "create-task",
        "claim-next",
        "heartbeat",
        "comment",
        "complete",
        "fail",
        "block",
        "promote",
      ])
      .describe("Work Board operation to perform."),
    board: z.string().optional(),
    taskId: z.string().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    status: kanbanStatusSchema.optional(),
    priority: kanbanPrioritySchema.optional(),
    assignee: z.string().optional(),
    tenant: z.string().optional(),
    query: z.string().optional(),
    includeArchived: z.boolean().optional(),
    includeBoards: z.boolean().optional(),
    boardsOnly: z.boolean().optional(),
    workspace: z.string().optional(),
    skills: z.array(z.string()).optional(),
    attachments: z.array(jsonObjectSchema).optional(),
    linkedDirectories: z.array(jsonObjectSchema).optional(),
    deliverables: z.array(jsonObjectSchema).optional(),
    targetMachine: jsonObjectSchema.optional(),
    projectId: z.string().optional(),
    proofs: z.array(jsonObjectSchema).optional(),
    loop: jsonObjectSchema.optional(),
    loopReceipts: z.array(jsonObjectSchema).optional(),
    parents: z.array(z.string()).optional(),
    idempotencyKey: z.string().optional(),
    maxRuntimeMs: z.number().optional(),
    maxAttempts: z.number().optional(),
    runtime: z.string().optional(),
    ttlMs: z.number().optional(),
    claimer: z.string().optional(),
    claimLock: z.string().optional(),
    targetMachineKey: z.string().optional(),
    source: z.string().optional(),
    note: z.string().optional(),
    author: z.string().optional(),
    summary: z.string().optional(),
    result: z.string().optional(),
    metadata: jsonObjectSchema.optional(),
    error: z.string().optional(),
    reason: z.string().optional(),
    failureReason: z.string().optional(),
    force: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    vaultPath: z.string().optional(),
    kanbanFolder: z.string().optional(),
  }),
  sideEffects: ["write", "filesystem"],
  risk: "medium",
  tags: ["work-board", "kanban", "task", "mcp", "orchestration", "agent"],
  aliases: [
    "work_board",
    "get next task",
    "claim work board task",
    "create work board task",
    "complete task",
    "block task",
  ],
  mcp: { expose: true, compact: true, toolName: "work_board" },
  contextIndex: {
    summary: "MCP-native Work Board task lifecycle for local-first agent work.",
    retrievalText:
      "Use work_board for AgentRQ-style task orchestration inside HivemindOS: action list, create-task, claim-next, heartbeat, comment, complete, fail, block, or promote. It routes through /api/kanban and preserves Work Board status, priority, assignee, tenant, skills, attachments, linked directories, machine targets, loops, receipts, idempotency, and shared-vault storage.",
    route: "/api/kanban",
    methods: ["GET", "POST"],
  },
});

export const queenBeeAction = defineHiveAction({
  id: "queen-bee.orchestration",
  title: "Queen Bee orchestration",
  description:
    "Inspect Queen Bee state, queue coordinator work, decompose PRDs, or operate Queen Bee flow runs.",
  schema: z.object({
    action: z
      .enum(["state", "queue-task", "decompose-prd", "flow"])
      .describe("Queen Bee operation to perform."),
    message: z.string().optional(),
    prd: z.string().optional(),
    title: z.string().optional(),
    source: z.string().optional(),
    mode: z.string().optional(),
    priority: kanbanPrioritySchema.optional(),
    loop: jsonObjectSchema.optional(),
    taskTitle: z.string().optional(),
    agentId: z.string().optional(),
    machineId: z.string().optional(),
    skills: z.array(z.string()).optional(),
    projectId: z.string().optional(),
    maxTasks: z.number().optional(),
    preview: z.boolean().optional(),
    flowAction: z
      .enum([
        "list-templates",
        "get-template",
        "list-runs",
        "get-run",
        "save-template",
        "start",
        "advance",
        "resolve-approval",
      ])
      .optional(),
    templateId: z.string().optional(),
    runId: z.string().optional(),
    spec: jsonObjectSchema.optional(),
    state: jsonObjectSchema.optional(),
    result: jsonObjectSchema.optional(),
    approved: z.boolean().optional(),
    vaultPath: z.string().optional(),
    brainServicesFolder: z.string().optional(),
    kanbanFolder: z.string().optional(),
  }),
  sideEffects: ["write", "filesystem"],
  risk: "medium",
  tags: ["queen-bee", "coordinator", "flow", "prd", "mcp", "orchestration"],
  aliases: ["queen_bee", "queue queen bee task", "decompose PRD", "agent flow"],
  mcp: { expose: true, compact: true, toolName: "queen_bee" },
  contextIndex: {
    summary: "MCP-native access to the Queen Bee coordinator and flow runner.",
    retrievalText:
      "Use queen_bee when an agent needs the Queen Bee coordinator: action state for current coordinator state, queue-task for a coordinator message/task, decompose-prd for PRD-to-Work-Board planning, and flow for template/run operations including approvals. It routes through /api/queen-bee and /api/queen-bee/flow.",
    route: "/api/queen-bee",
    methods: ["GET", "POST"],
  },
});

export const workEventAction = defineHiveAction({
  id: "work-event.fanout",
  title: "Work event fanout",
  description:
    "Create durable local event triggers and publish events that fan out into Work Board tasks.",
  schema: z.object({
    action: z
      .enum(["list", "create-event", "create-trigger", "publish"])
      .describe("Work event operation to perform."),
    eventName: z.string().optional(),
    name: z.string().optional(),
    payloadGuidelines: z.string().optional(),
    payload: z.unknown().optional(),
    faq: z
      .array(
        z.object({
          question: z.string(),
          answer: z.string(),
        }),
      )
      .optional(),
    source: z.string().optional(),
    board: z.string().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    assignee: z.string().optional(),
    tenant: z.string().optional(),
    priority: kanbanPrioritySchema.optional(),
    status: kanbanStatusSchema.optional(),
    skills: z.array(z.string()).optional(),
    targetMachine: jsonObjectSchema.optional(),
    emitEventName: z.string().optional(),
    enabled: z.boolean().optional(),
    idempotencyKey: z.string().optional(),
    vaultPath: z.string().optional(),
    kanbanFolder: z.string().optional(),
  }),
  sideEffects: ["write", "filesystem"],
  risk: "medium",
  tags: ["work-event", "event", "trigger", "fanout", "work-board", "mcp"],
  aliases: ["work_event", "publish work event", "create event trigger", "event fanout"],
  mcp: { expose: true, compact: true, toolName: "work_event" },
  contextIndex: {
    summary: "Durable local publish-event triggers for Work Board task fanout.",
    retrievalText:
      "Use work_event to adapt publishEvent-style orchestration in HivemindOS. Create event definitions and triggers, then publish an event payload/FAQ to fan out matching triggers into normal Work Board tasks. Trigger templates support {{EVENT_NAME}}, {{EVENT_PAYLOAD}}, {{EVENT_FAQ}}, and {{EVENT_SOURCE}} placeholders.",
    route: "/api/work-events",
    methods: ["GET", "POST"],
  },
});

export const agentChallengeAction = defineHiveAction({
  id: "agent-challenge.arena",
  title: "Agent Challenge arena",
  description:
    "Run a local-first public agent challenge with credited lineage, quota caps, rulings, playbook notes, and significance-aware frontiers.",
  schema: z.object({
    action: z
      .enum(["list", "get", "create", "post-entry", "record-result", "rule", "distill-playbook"])
      .optional()
      .describe("Agent challenge operation to perform."),
    id: z.string().optional(),
    challengeId: z.string().optional(),
    title: z.string().optional(),
    objective: z.string().optional(),
    metricName: z.string().optional(),
    metricDirection: z.enum(["increase", "decrease"]).optional(),
    baselineScore: z.number().optional(),
    significanceThreshold: z.number().optional(),
    dailyRunCap: z.number().optional(),
    workBoard: z.string().optional(),
    type: z.enum(["candidate", "run-request", "finding", "result", "integrity-alert", "ruling", "playbook"]).optional(),
    visibility: z.string().optional(),
    body: z.string().optional(),
    score: z.number().optional(),
    parentIds: z.array(z.string()).optional(),
    originatorId: z.string().optional(),
    originatorName: z.string().optional(),
    runnerId: z.string().optional(),
    runnerName: z.string().optional(),
    verifierId: z.string().optional(),
    verifierName: z.string().optional(),
    authorId: z.string().optional(),
    authorName: z.string().optional(),
    decidedById: z.string().optional(),
    decidedByName: z.string().optional(),
    kind: z.enum(["valid", "invalid", "tie", "needs-human", "policy"]).optional(),
    targetLineageId: z.string().optional(),
    summary: z.string().optional(),
    evidence: z.array(z.string()).optional(),
    notes: z.string().optional(),
    workBoardTaskId: z.string().optional(),
    levers: z.array(z.string()).optional(),
    antiPatterns: z.array(z.string()).optional(),
    triageTools: z.array(z.string()).optional(),
    verifierNotes: z.array(z.string()).optional(),
    openQuestions: z.array(z.string()).optional(),
    createdAt: z.string().optional(),
    vaultPath: z.string().optional(),
    challengesFolder: z.string().optional(),
  }),
  sideEffects: ["write", "filesystem"],
  risk: "medium",
  tags: ["agent", "challenge", "lineage", "quota", "leaderboard", "work-board", "mcp"],
  aliases: ["agent_challenge", "challenge arena", "agent tournament", "coordination board"],
  mcp: { expose: true, compact: true, toolName: "agent_challenge" },
  contextIndex: {
    summary:
      "Local-first agent challenge arena for public coordination, credited results, quota pooling, rulings, and shared playbooks.",
    retrievalText:
      "Use agent_challenge when agents need a bounded shared objective with public board entries, per-agent run caps, credited lineage, significance-aware frontier ties, verifier or human rulings, and playbook distillation. It routes through /api/agent-challenges and stores local-first challenge state in the shared vault when available.",
    route: "/api/agent-challenges",
    methods: ["GET", "POST"],
  },
});

export const requestHumanApprovalAction = defineHiveAction({
  id: "human-approval.request",
  title: "Request human approval",
  description:
    "Create a Needs You Work Board card asking a human to approve, deny, or clarify an agent request.",
  schema: z.object({
    title: z.string().describe("Approval card title."),
    request: z.string().describe("What the agent is asking the human to decide."),
    context: z.string().optional(),
    requestedBy: z.string().optional(),
    board: z.string().optional(),
    priority: kanbanPrioritySchema.optional(),
    relatedTaskId: z.string().optional(),
    approvalKind: z.string().optional(),
    options: z.array(z.string()).optional(),
    idempotencyKey: z.string().optional(),
    vaultPath: z.string().optional(),
    kanbanFolder: z.string().optional(),
  }),
  sideEffects: ["write", "filesystem"],
  risk: "medium",
  tags: ["approval", "human", "needs-human", "work-board", "mcp"],
  aliases: ["request_human_approval", "permission request", "human approval card"],
  mcp: { expose: true, compact: true, toolName: "request_human_approval" },
  contextIndex: {
    summary: "Create a human approval card without granting approval authority to the agent.",
    retrievalText:
      "Use request_human_approval when an agent needs a human decision before a risky or ambiguous action. The tool creates a needs-human Work Board task with context and options; it does not approve the action or bypass any HivemindOS server-side policy.",
    route: "/api/kanban",
    methods: ["POST"],
  },
});

export const cryptoCapabilitiesAction = defineHiveAction({
  id: "crypto.capabilities",
  title: "Crypto capability readiness",
  description:
    "List HivemindOS crypto and payment rail readiness without spending.",
  schema: z.object({
    intent: cryptoIntentSchema,
    agentId: z.string().optional(),
    preferredProvider: z.string().optional(),
  }),
  sideEffects: ["read"],
  risk: "low",
  readOnly: true,
  tags: ["crypto", "wallet", "payment", "readiness", "capability"],
  aliases: ["crypto_capabilities", "wallet readiness", "payment rail status"],
  mcp: { expose: true, compact: true, toolName: "crypto_capabilities" },
  contextIndex: {
    summary:
      "Read-only status and readiness for HivemindOS crypto/payment rails.",
    retrievalText:
      "Use crypto_capabilities before any wallet, payment, x402, Bankr, Veil, MoneyClaw, or UsePod action. This does not execute spends and reports credential readiness by key name/status only.",
    route: "/api/crypto/capabilities",
    methods: ["GET"],
  },
});

export const reviewCryptoAction = defineHiveAction({
  id: "crypto.review-action",
  title: "Review crypto action",
  description:
    "Build a clear-signing review for a crypto, wallet, or payment draft without signing or executing it.",
  schema: z.object({
    kind: z.string().optional(),
    intent: z.string().optional(),
    provider: z.string().optional(),
    agentId: z.string().optional(),
    network: z.string().optional(),
    asset: z.string().optional(),
    amount: z.unknown().optional(),
    amountUsd: z.number().optional(),
    recipientAddress: z.string().optional(),
    toAddress: z.string().optional(),
    url: z.string().optional(),
    method: z.string().optional(),
    prompt: z.string().optional(),
    confirmation: z.string().optional(),
    policy: z.record(z.string(), z.unknown()).optional(),
    paymentRequirement: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  sideEffects: ["read"],
  risk: "low",
  readOnly: true,
  tags: ["crypto", "wallet", "payment", "clear-signing", "review"],
  aliases: ["review_crypto_action", "clear signing", "payment review"],
  mcp: { expose: true, compact: true, toolName: "review_crypto_action" },
  contextIndex: {
    summary:
      "Clear-signing review for crypto/payment drafts before execution.",
    retrievalText:
      "Use review_crypto_action to explain risks, side effects, confirmation text, and fingerprints for a prepared crypto/payment action. It never signs, sends, swaps, trades, or pays.",
    route: "/api/crypto/clear-signing",
    methods: ["POST"],
  },
});

export const prepareCryptoAction = defineHiveAction({
  id: "crypto.prepare-action",
  title: "Prepare crypto action",
  description:
    "Prepare a wallet, payment, trading, x402, or Bankr action draft without executing it.",
  schema: z.object({
    intent: cryptoIntentSchema,
    agentId: z.string().optional(),
    preferredProvider: z.string().optional(),
    wallet: z.record(z.string(), z.unknown()).optional(),
    url: z.string().optional(),
    recipientAddress: z.string().optional(),
    toAddress: z.string().optional(),
    amountUsd: z.number().optional(),
    amount: z.unknown().optional(),
    asset: z.string().optional(),
    network: z.string().optional(),
    fromChain: z.string().optional(),
    toChain: z.string().optional(),
    fromAsset: z.string().optional(),
    toAsset: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  sideEffects: ["read", "network"],
  risk: "medium",
  readOnly: true,
  tags: ["crypto", "wallet", "payment", "prepare", "draft", "capability"],
  aliases: ["prepare_crypto_action", "prepare crypto", "wallet action draft"],
  mcp: { expose: true, compact: true, toolName: "prepare_crypto_action" },
  contextIndex: {
    summary:
      "Prepare wallet/payment action drafts with readiness, approval, and clear-signing metadata.",
    retrievalText:
      "Use prepare_crypto_action before execution for sends, swaps, trades, private transfers, paid APIs, Bankr actions, x402, and credit funding. It prepares provider endpoint/request drafts and approval requirements but does not sign, spend, swap, trade, or pay.",
    route: "/api/crypto/capabilities",
    methods: ["POST"],
  },
});

export const nansenIntelligenceAction = defineHiveAction({
  id: "nansen.intelligence",
  title: "Nansen onchain intelligence",
  description:
    "Read Nansen-powered token, wallet, Hyperliquid, market-scout, simple-template, complex-template, and research-agent briefings for HivemindOS due diligence.",
  schema: z.object({
    action: nansenActionSchema.describe("Which Nansen intelligence route to use."),
    template: nansenTemplateSchema.optional().describe("Nansen template to run when action is simple-template or complex-template."),
    chain: z.string().optional(),
    chains: z.array(z.string()).optional(),
    tokenAddress: z.string().optional(),
    tokenSymbol: z.string().optional(),
    address: z.string().optional(),
    entityName: z.string().optional(),
    date: z.object({ from: z.string().optional(), to: z.string().optional() }).optional(),
    timeframe: z.string().optional(),
    filters: jsonObjectSchema.optional(),
    includeLabels: z.boolean().optional(),
    includeTransactions: z.boolean().optional(),
    includeHistoricalBalances: z.boolean().optional(),
    includePnlSummary: z.boolean().optional(),
    aggregateByEntity: z.boolean().optional(),
    labelType: z.string().optional(),
    premiumLabels: z.boolean().optional(),
    includeTrades: z.boolean().optional(),
    includeIndicators: z.boolean().optional(),
    includeLeaderboard: z.boolean().optional(),
    text: z.string().optional(),
    mode: z.enum(["fast", "expert"]).optional(),
    conversationId: z.string().optional(),
    creditSlug: z.string().optional(),
    idempotencyKey: z.string().optional(),
  }),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["nansen", "crypto", "wallet", "portfolio", "token", "hyperliquid", "market-scout", "simple-template", "complex-template", "smart-money-holdings", "token-holders", "token-screener", "cex-health", "onchain", "due-diligence"],
  aliases: ["nansen", "token brief", "wallet brief", "market scout", "hyperliquid brief", "simple nansen template", "complex nansen template", "smart money holdings", "top holders", "token screener", "cex health", "onchain intelligence"],
  mcp: { expose: true, compact: true, toolName: "nansen_intelligence" },
  contextIndex: {
    summary:
      "Nansen-powered onchain intelligence routes for trade, wallet, simple-template, CEX-health, and complex-template due diligence.",
    retrievalText:
      "Use nansen_intelligence for read-only Nansen context: GET /api/nansen/status, POST /api/nansen/token-brief, /api/nansen/wallet-brief, /api/nansen/hyperliquid-brief, /api/nansen/market-scout, /api/nansen/simple-template, /api/nansen/complex-template, or /api/nansen/agent. Simple template ids are defi-positions, smart-money-holdings, token-top-holders, and token-screener-discovery. Complex template ids are token-tracking-smart-money, hyperliquid-wallet-discovery, related-wallets-scale, top-wallet-copytrade-research, and cex-health-monitor. Prefer BYOK NANSEN_API_KEY; otherwise use HivemindOS hosted credits through the managed Nansen broker. Direct Nansen x402 is not the official cloud product path. Return derived briefs, not raw Smart Money feeds, public rankings, real-time alerts, or copy-trading signals.",
    route: "/api/nansen/status",
    methods: ["GET"],
  },
});

export const sendUsdcAction = defineHiveAction({
  id: "wallet.send-usdc",
  title: "Send stablecoin",
  description:
    "Execute a governed stablecoin send through the wallet route after explicit confirmation: USDC on Base/Solana, USDG on Robinhood Chain.",
  schema: z.object({
    agentId: z.string().optional(),
    wallet: z.record(z.string(), z.unknown()).optional(),
    recipientAddress: z.string().optional(),
    toAddress: z.string().optional(),
    amountUsd: z.number().optional(),
    amount: z.unknown().optional(),
    asset: z.string().optional(),
    network: z.string().optional(),
    confirmation: z.string().optional(),
    memo: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  sideEffects: ["wallet", "payment", "network"],
  risk: "critical",
  tags: ["wallet", "payment", "usdc", "usdg", "robinhood-chain", "send", "execution"],
  aliases: ["send_usdc", "send_usdg", "wallet send", "send payment"],
  mcp: { expose: true, compact: true, toolName: "send_usdc" },
  confirmation: {
    token: "SEND_USDC",
    reason:
      "Stablecoin sends move funds and must pass the wallet route's spend policy and explicit confirmation gate.",
    when: "always",
  },
  contextIndex: {
    summary:
      "Critical governed stablecoin send execution route.",
    retrievalText:
      "Use send_usdc only after a read-only prepare/review path and explicit SEND_USDC confirmation. It sends USDC on Base/Solana and USDG on Robinhood Chain. The server route remains authoritative for spend policy, wallet selection, caps, recipient, amount, asset, network, and execution.",
    route: "/api/wallet/send",
    methods: ["POST"],
  },
});

export const b20IssuerProofAction = defineHiveAction({
  id: "crypto.b20-issuer-proof",
  title: "B20 issuer proof",
  description:
    "Prepare or execute a Base B20 token creation proof through the encrypted local agent wallet.",
  schema: z.object({
    action: z.enum(["draft", "create"]).optional(),
    agentId: z.string().optional(),
    messages: z.array(z.record(z.string(), z.unknown())).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
    draft: z.record(z.string(), z.unknown()).optional(),
    draftMessage: z.string().optional(),
    confirmation: z.string().optional(),
  }),
  sideEffects: ["wallet", "network"],
  risk: "critical",
  tags: ["crypto", "wallet", "base", "b20", "token", "issuer", "execution"],
  aliases: ["b20_issuer_proof", "create b20 token", "make b20 token", "issue b20"],
  mcp: { expose: true, compact: true, toolName: "b20_issuer_proof" },
  confirmation: {
    token: "B20_CREATE",
    reason:
      "B20 creation deploys a token through the Base B20 factory and must show the deterministic proof before signing.",
    when: "always",
  },
  contextIndex: {
    summary:
      "Prepare a deterministic B20 issuer proof and execute it on Base Sepolia only after confirmation.",
    retrievalText:
      "Use b20_issuer_proof when a user asks to create, deploy, make, or issue a B20 token. First call action draft or prepare a proof showing network, token details, predicted address, roles, init calls, salt, calldata hash, and gas readiness. Execute action create only after the user confirms the exact proof with B20_CREATE or the chat confirmation flow maps a plain confirm to B20_CREATE. Default to Base Sepolia while mainnet availability is uncertain.",
    route: "/api/crypto/b20/issuer-proof",
    methods: ["GET", "POST"],
  },
});

export const dexSwapAction = defineHiveAction({
  id: "wallet.dex-swap",
  title: "DEX swap",
  description:
    "Execute a governed local-wallet DEX swap after explicit confirmation.",
  schema: z.object({
    agentId: z.string().optional(),
    wallet: z.record(z.string(), z.unknown()).optional(),
    fromAsset: z.string().optional(),
    toAsset: z.string().optional(),
    asset: z.string().optional(),
    amountUsd: z.number().optional(),
    amount: z.unknown().optional(),
    network: z.string().optional(),
    slippageBps: z.number().optional(),
    confirmation: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  sideEffects: ["wallet", "payment", "network"],
  risk: "critical",
  tags: ["wallet", "payment", "swap", "dex", "execution"],
  aliases: ["dex_swap", "swap tokens", "local wallet swap"],
  mcp: { expose: true, compact: true, toolName: "dex_swap" },
  confirmation: {
    token: "CONFIRM_SWAP",
    reason:
      "DEX swaps trade assets and must pass spend policy, quote review, slippage checks, and explicit confirmation.",
    when: "always",
  },
  contextIndex: {
    summary:
      "Critical governed DEX swap execution route.",
    retrievalText:
      "Use dex_swap only after prepare_crypto_action returns a reviewed swap draft and the user or policy supplies CONFIRM_SWAP. The server route remains authoritative for wallet secret access, quote validity, slippage, amount, and settlement.",
    route: "/api/trading/swap",
    methods: ["POST"],
  },
});

export const stockTradeAction = defineHiveAction({
  id: "wallet.stock-trade",
  title: "Stock trade",
  description:
    "Execute or validate a governed Alpaca, Robinhood Agentic, xStocks, or Robinhood Chain stock-token trade after explicit buy/sell confirmation.",
  schema: z.object({
    agentId: z.string().optional(),
    wallet: z.record(z.string(), z.unknown()).optional(),
    symbol: z.string().optional(),
    ticker: z.string().optional(),
    side: z.enum(["buy", "sell"]).optional(),
    quantity: z.number().optional(),
    qty: z.number().optional(),
    amountUsd: z.number().optional(),
    notionalUsd: z.number().optional(),
    venue: z.string().optional(),
    alpacaPaper: z.boolean().optional(),
    confirmation: z.string().optional(),
    approvalToken: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  sideEffects: ["wallet", "payment", "network"],
  risk: "critical",
  tags: ["wallet", "payment", "stocks", "trade", "execution", "robinhood", "agentic", "brokerage", "mcp"],
  aliases: ["stock_trade", "buy stock", "sell stock", "xstocks trade", "robinhood agentic trade", "robinhood chain stock token"],
  mcp: { expose: true, compact: true, toolName: "stock_trade" },
  confirmation: {
    tokens: ["CONFIRM_BUY", "CONFIRM_SELL"],
    reason:
      "Stock trades can place real brokerage or tokenized-asset orders and must pass venue policy and explicit side-specific confirmation.",
    when: "always",
  },
  contextIndex: {
    summary:
      "Critical governed brokerage/xStocks/Robinhood Chain stock-token route.",
    retrievalText:
      "Use stock_trade only after prepare/review paths establish venue, paper/live mode, symbol, side, amount, and required side-specific confirmation. CONFIRM_BUY is required for buys and CONFIRM_SELL for sells; server routes remain authoritative. The robinhood-agentic venue uses Robinhood's official OAuth MCP and dedicated Agentic brokerage account: it calls review_equity_order before place_equity_order, while HivemindOS enforces caps, company governance, and its ledger. Robinhood Chain remains a separate self-custody venue that swaps USDG through 0x on chain ID 4663; if 0x rejects a Stock Token for legal/eligibility restrictions, surface that block and do not route around it.",
    route: "/api/trading",
    methods: ["POST"],
  },
});

export const hyperliquidTradeAction = defineHiveAction({
  id: "wallet.hyperliquid-trade",
  title: "Hyperliquid trade",
  description:
    "Quote, approve builder fees, trade spot/perps, manage orders, adjust account settings, transfer funds, or run TWAPs on Hyperliquid from a governed local EVM wallet.",
  schema: z.object({
    action: z.enum(["status", "positions", "open-orders", "fills", "fees", "order-status", "quote", "approve-builder", "order", "cancel", "cancel-by-cloid", "modify", "schedule-cancel", "leverage", "margin", "usd-class", "usd-send", "spot-send", "withdraw", "twap-order", "twap-cancel"]).optional(),
    agentId: z.string().optional(),
    wallet: z.record(z.string(), z.unknown()).optional(),
    coin: z.string().optional(),
    marketType: z.enum(["perp", "spot"]).optional(),
    assetId: z.number().optional(),
    side: z.enum(["long", "short", "buy", "sell"]).optional(),
    orderType: z.enum(["market", "limit", "trigger"]).optional(),
    notionalUsd: z.number().optional(),
    size: z.number().optional(),
    limitPrice: z.number().optional(),
    timeInForce: z.enum(["Gtc", "Ioc", "Alo", "FrontendMarket"]).optional(),
    triggerPx: z.number().optional(),
    triggerType: z.enum(["tp", "sl"]).optional(),
    triggerIsMarket: z.boolean().optional(),
    grouping: z.enum(["na", "normalTpsl", "positionTpsl"]).optional(),
    clientOrderId: z.string().optional(),
    reduceOnly: z.boolean().optional(),
    slippageBps: z.number().optional(),
    orderId: z.union([z.number(), z.string()]).optional(),
    oid: z.union([z.number(), z.string()]).optional(),
    cloid: z.string().optional(),
    fastCancel: z.boolean().optional(),
    alwaysPlace: z.boolean().optional(),
    scheduleCancelTime: z.union([z.number(), z.null()]).optional(),
    leverage: z.number().optional(),
    marginMode: z.enum(["cross", "isolated"]).optional(),
    marginDeltaUsd: z.number().optional(),
    transferType: z.enum(["usd-class", "usd-send", "spot-send", "withdraw"]).optional(),
    amount: z.number().optional(),
    amountUsd: z.number().optional(),
    destination: z.string().optional(),
    token: z.string().optional(),
    toPerp: z.boolean().optional(),
    twapMinutes: z.number().optional(),
    twapRandomize: z.boolean().optional(),
    twapId: z.union([z.number(), z.string()]).optional(),
    confirmation: z.string().optional(),
    approvalToken: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  sideEffects: ["wallet", "payment", "network"],
  risk: "critical",
  tags: ["wallet", "payment", "hyperliquid", "perps", "spot", "trade", "execution"],
  aliases: ["hyperliquid_trade", "hyperliquid order", "perp trade", "spot trade", "perps trade"],
  mcp: { expose: true, compact: true, toolName: "hyperliquid_trade" },
  confirmation: {
    tokens: ["CONFIRM_HYPERLIQUID_ORDER", "CONFIRM_HYPERLIQUID_BUILDER", "CONFIRM_HYPERLIQUID_CANCEL", "CONFIRM_HYPERLIQUID_ACCOUNT", "CONFIRM_HYPERLIQUID_TRANSFER", "CONFIRM_HYPERLIQUID_TWAP"],
    reason:
      "Hyperliquid orders, account changes, transfers, withdrawals, cancels, TWAPs, and builder approvals can change real exchange state or funds and require action-specific confirmation.",
    when: "always",
  },
  contextIndex: {
    summary:
      "Critical governed Hyperliquid spot/perp trading and account route with builder-code support.",
    retrievalText:
      "Use hyperliquid_trade for Hyperliquid account status, open orders, fills, fees, order status, spot/perp quotes and orders, cancels, order modification, schedule-cancel, leverage, isolated margin, USDC spot/perp transfers, USDC sends, withdrawals, spot sends, and TWAPs. Builder approval requires CONFIRM_HYPERLIQUID_BUILDER; order/modify requires CONFIRM_HYPERLIQUID_ORDER; cancels require CONFIRM_HYPERLIQUID_CANCEL; leverage/margin require CONFIRM_HYPERLIQUID_ACCOUNT; transfers/withdrawals require CONFIRM_HYPERLIQUID_TRANSFER; TWAP orders/cancels require CONFIRM_HYPERLIQUID_TWAP. The server route remains authoritative for wallet secret access, builder address, builder fee, max trade cap, spend governance, market precision, and signing.",
    route: "/api/trading/hyperliquid",
    methods: ["GET", "POST"],
  },
});

export const cryptoPracticeBookAction = defineHiveAction({
  id: "wallet.crypto-practice-book",
  title: "Crypto practice book",
  description:
    "Maintain a shared crypto practice target book, snapshot Alpaca paper or Hyperliquid positions, plan a Hyperliquid replay, or execute the replay after confirmation.",
  schema: z.object({
    action: z.enum(["read", "snapshot-alpaca-paper", "snapshot-hyperliquid", "manual-holding", "clear-target", "plan-hyperliquid", "execute-hyperliquid-replay"]).optional(),
    agentId: z.string().optional(),
    replaceTarget: z.boolean().optional(),
    symbol: z.enum(["BTC", "ETH", "SOL", "HYPE", "PURR"]).optional(),
    marketType: z.enum(["spot", "perp"]).optional(),
    side: z.enum(["long", "short"]).optional(),
    quantity: z.number().optional(),
    notionalUsd: z.number().optional(),
    avgEntryPrice: z.number().optional(),
    markPrice: z.number().optional(),
    includeCurrent: z.boolean().optional(),
    confirmation: z.string().optional(),
  }),
  sideEffects: ["wallet", "payment", "network"],
  risk: "critical",
  tags: ["crypto", "wallet", "paper", "practice", "alpaca", "hyperliquid", "migration", "execution"],
  aliases: ["crypto_practice_book", "paper crypto book", "alpaca hyperliquid migration", "shared crypto holdings"],
  mcp: { expose: true, compact: true, toolName: "crypto_practice_book" },
  confirmation: {
    token: "CONFIRM_CRYPTO_PRACTICE_REPLAY",
    reason:
      "Reading and planning are safe, but the execute-hyperliquid-replay action can place Hyperliquid orders and must always pass an explicit replay confirmation plus wallet governance.",
    when: "always",
  },
  contextIndex: {
    summary:
      "Shared crypto practice target book that can bridge Alpaca paper snapshots and Hyperliquid replay plans.",
    retrievalText:
      "Use crypto_practice_book to read or update the local normalized crypto practice holdings book, snapshot Alpaca paper crypto positions, snapshot Hyperliquid status, add a manual target, plan the Hyperliquid order diff, or execute the replay only after CONFIRM_CRYPTO_PRACTICE_REPLAY. Provider accounts remain authoritative for custody; the practice book is local target state.",
    route: "/api/trading/practice-book",
    methods: ["GET", "POST"],
  },
});

export const tradingMarketDataAction = defineHiveAction({
  id: "trading.market-data",
  title: "Trading market data",
  description:
    "Fetch read-only crypto and stock market rows, Alpaca account-equity history, and USD FX rates for the Trade desk.",
  schema: z.object({
    kind: z
      .enum(["crypto", "stock", "stock-equity", "fx"])
      .optional()
      .describe("Market-data kind to fetch."),
    symbols: z.array(z.string()).optional().describe("Up to 40 symbols."),
    range: z.enum(["24h", "7d", "30d"]).optional(),
    paper: z.boolean().optional().describe("Use the Alpaca paper account (default true)."),
    withHistory: z.boolean().optional(),
  }),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["trading", "market-data", "prices", "crypto", "stocks", "fx", "sparkline"],
  aliases: ["market data", "crypto prices", "stock prices", "fx rates", "price history", "movers"],
  contextIndex: {
    summary:
      "Read-only market data: crypto/stock prices, 24h change, sparklines, Alpaca equity history, FX rates.",
    retrievalText:
      "Use POST /api/trading/market for live read-only market data feeding the Trade desk: kind crypto or stock for price/change/history rows, kind stock-equity for Alpaca account-value history (paper or live), and kind fx for USD-to-currency rates. No money moves through this route; trades execute through the governed trading routes instead.",
    route: "/api/trading/market",
    methods: ["POST"],
  },
});

export const copyTradeConfigAction = defineHiveAction({
  id: "trading.copy-trade-config",
  title: "Copy-trading configs",
  description:
    "List, create, enable, disable, or delete copy-trading configs and read the mirror daemon's status. The standalone daemon is the sole swap-execution host; this surface only manages its config store.",
  schema: z.object({
    action: z
      .enum(["upsert", "start", "stop", "delete"])
      .optional()
      .describe("Copy-trading config operation to perform."),
    id: z.string().optional().describe("Config id, required for start, stop, and delete."),
    config: jsonObjectSchema
      .optional()
      .describe("Partial CopyTradingConfig for upsert: agentId, network (Base or Solana), targetAddress, maxCopyUsd, and limits."),
  }),
  sideEffects: ["write", "filesystem"],
  risk: "high",
  tags: ["trading", "copy-trade", "mirror", "wallet", "config", "daemon"],
  aliases: ["copy trading", "mirror wallet trades", "copy trade config", "start copy trading", "stop copy trading"],
  contextIndex: {
    summary:
      "Config and status surface for the copy-trading mirror daemon; enabling a config starts live real-fund trade mirroring.",
    retrievalText:
      "Use /api/trading/copy-trade to read copy-trading configs, runtime states, and daemon heartbeat (GET) or to upsert, start, stop, and delete configs (POST). Upsert requires an acting wallet with a local signing key on Base or Solana, rejects self-copy, and caps per-trade size at $10. The route never executes swaps itself — the standalone daemon is the sole execution host — but action start enables live mirroring of the target wallet's trades with real funds, so treat enablement as a user-approved decision.",
    route: "/api/trading/copy-trade",
    methods: ["GET", "POST"],
  },
});

export const hivemindosModelsWalletAction = defineHiveAction({
  id: "hivemindos-models.funding-wallet",
  title: "HivemindOS Models funding wallet",
  description:
    "Create a new encrypted local wallet or link an existing vault wallet as the funding source for wallet-paid HivemindOS Models LLM usage.",
  schema: z.object({
    action: z
      .enum(["create", "link"])
      .optional()
      .describe("create generates a new local wallet (default); link reuses an existing vault wallet."),
    agentId: z.string().optional(),
    agentName: z.string().optional(),
    walletVaultId: z.string().optional().describe("Existing encrypted-vault wallet id, required for link."),
    network: z.string().optional().describe("eip155:8453 (default), eip155:84532, solana:mainnet, or solana:devnet."),
    vaultPath: z.string().optional(),
  }),
  sideEffects: ["write", "credential", "filesystem"],
  risk: "medium",
  tags: ["wallet", "hivemindos-models", "llm", "funding", "credits", "setup"],
  aliases: ["models funding wallet", "wallet-paid models setup", "create models wallet", "link models wallet"],
  contextIndex: {
    summary:
      "Create or link the encrypted local wallet that funds wallet-paid HivemindOS Models usage.",
    retrievalText:
      "Use POST /api/hivemindos/models/wallet during HivemindOS Models (wallet-paid LLM) setup. action create generates a wallet (default Base eip155:8453; also eip155:84532, eip155:4663 Robinhood Chain, solana:mainnet, solana:devnet), stores its secret in the encrypted local wallet vault, and records it in the wallet ledger as a Models funding source with conservative default caps (max $0.50 per payment, approval required over $2). action link designates an existing vault wallet by walletVaultId instead. It never sends funds or spends credits — spending stays behind the governed wallet execution routes.",
    route: "/api/hivemindos/models/wallet",
    methods: ["POST"],
  },
});

export const brainGraphOverviewAction = defineHiveAction({
  id: "brain.graph-overview",
  title: "Compiled brain graph overview",
  description:
    "Return compact counts, hubs, and orphan totals for a compiled-knowledge domain.",
  schema: z.object({
    domain: z.string().optional(),
    vaultPath: z.string().optional(),
  }),
  sideEffects: ["read", "filesystem"],
  risk: "low",
  readOnly: true,
  tags: ["brain", "compiled-knowledge", "graph", "overview"],
  aliases: ["brain_graph_overview", "compiled brain graph"],
  mcp: { expose: true, compact: true, toolName: "brain_graph_overview" },
  contextIndex: {
    summary:
      "Read graph health and overview metadata for HivemindOS compiled knowledge.",
    retrievalText:
      "Use brain_graph_overview when the user asks about compiled brain graph shape, hubs, orphan pages, or domain overview. It reads local/shared vault metadata.",
    route: "/api/brain/knowledge",
    methods: ["GET", "POST"],
  },
});

export const brainSearchKnowledgeAction = defineHiveAction({
  id: "brain.search-knowledge",
  title: "Search compiled brain knowledge",
  description:
    "Search a compiled-knowledge domain with weighted title, slug, tags, frontmatter, and markdown body matches.",
  schema: z.object({
    query: z.string().describe("Search query."),
    domain: z.string().optional(),
    vaultPath: z.string().optional(),
    limit: z.number().optional(),
  }),
  sideEffects: ["read", "filesystem"],
  risk: "low",
  readOnly: true,
  tags: ["brain", "compiled-knowledge", "search", "knowledge"],
  aliases: ["brain_search_knowledge", "compiled brain search"],
  mcp: { expose: true, compact: true, toolName: "brain_search_knowledge" },
  contextIndex: {
    summary: "Search synthesized compiled-knowledge wiki pages.",
    retrievalText:
      "Use brain_search_knowledge before broad full-vault recall when the user wants synthesized HivemindOS compiled wiki entities, concepts, or summaries.",
    route: "/api/brain/knowledge",
    methods: ["GET", "POST"],
  },
});

export const brainGetNodeAction = defineHiveAction({
  id: "brain.get-node",
  title: "Get compiled brain node",
  description:
    "Fetch one compiled-knowledge node with body, outgoing links, and backlinks.",
  schema: z.object({
    slug: z.string().describe("Node slug, such as hivemindos."),
    domain: z.string().optional(),
    vaultPath: z.string().optional(),
  }),
  sideEffects: ["read", "filesystem"],
  risk: "low",
  readOnly: true,
  tags: ["brain", "compiled-knowledge", "node", "wikilink"],
  aliases: ["brain_get_node", "compiled brain node"],
  mcp: { expose: true, compact: true, toolName: "brain_get_node" },
  contextIndex: {
    summary:
      "Fetch a compiled-knowledge wiki page and its graph links by slug.",
    retrievalText:
      "Use brain_get_node after brain_search_knowledge when exact compiled-wiki body, outgoing links, or backlinks are needed.",
    route: "/api/brain/knowledge",
    methods: ["GET", "POST"],
  },
});

export const sharedBrainContractAction = defineHiveAction({
  id: "brain.shared-contract",
  title: "Shared Brain contribution contract",
  description:
    "Explain whether a write is allowed under HivemindOS personal, agent-to-agent, or human-collective shared-brain contribution rules.",
  schema: z.object({
    collaborationMode: z
      .enum(["personal", "agent-to-agent", "human-collective"])
      .optional(),
    optedInDomain: z.string().optional(),
    targetPath: z.string().optional(),
    actorKind: z.string().optional(),
  }),
  sideEffects: ["read"],
  risk: "low",
  readOnly: true,
  tags: ["brain", "shared-brain", "contract", "safety", "collaboration"],
  aliases: ["shared_brain_contract", "brain write rules", "collaboration mode"],
  mcp: { expose: true, compact: true, toolName: "shared_brain_contract" },
  contextIndex: {
    summary:
      "Read-only shared-brain write policy explanation for collaboration modes.",
    retrievalText:
      "Use shared_brain_contract before proposing or executing a compiled-brain/shared-brain write when the collaboration mode is unclear.",
    route: "/api/brain/knowledge",
    methods: ["POST"],
  },
});

export const contextXrayAction = defineHiveAction({
  id: "context.xray",
  title: "Context X-Ray manifests",
  description:
    "Persist and inspect redacted manifests of the context sources an agent run saw.",
  schema: z.object({
    action: z.enum(["create", "list", "get"]).optional(),
    id: z.string().optional(),
    runId: z.string().optional(),
    threadId: z.string().optional(),
    model: z.string().optional(),
    limit: z.number().optional(),
    sources: z.array(z.object({
      id: z.string().optional(),
      kind: z
        .enum([
          "memory",
          "compiled-knowledge",
          "skill",
          "tool",
          "api-route",
          "file",
          "conversation",
          "user-message",
          "workspace-file",
        ])
        .optional(),
      title: z.string().optional(),
      path: z.string().optional(),
      route: z.string().optional(),
      tokenEstimate: z.number().optional(),
      status: z.enum(["active", "pinned", "summarized", "evicted"]).optional(),
      reason: z.string().optional(),
      snippet: z.string().optional(),
    })).optional(),
  }),
  sideEffects: ["write", "filesystem"],
  risk: "medium",
  tags: ["context", "debug", "retrieval", "manifest", "agent"],
  aliases: ["context x-ray", "context manifest", "agent context debug"],
  contextIndex: {
    summary:
      "Local-first manifests of selected context sources for agent/debug visibility.",
    retrievalText:
      "Use /api/context-xray to create, list, or read redacted Context X-Ray manifests showing which memories, tools, skills, files, routes, or conversation sources an agent run saw. The route is authenticated and stores redacted local JSONL metadata under ~/.hivemindos.",
    route: "/api/context-xray",
    methods: ["GET", "POST"],
  },
});

export const visualArtifactsAction = defineHiveAction({
  id: "visual.artifacts",
  title: "Visual plan and recap artifacts",
  description:
    "Store and inspect local-first structured visual plans and recaps.",
  schema: z.object({
    action: z.enum(["create", "list", "get"]).optional(),
    id: z.string().optional(),
    kind: z.enum(["plan", "recap"]).optional(),
    title: z.string().optional(),
    workBoardTaskId: z.string().optional(),
    queenBeeRunId: z.string().optional(),
    projectPath: z.string().optional(),
    vaultPath: z.string().optional(),
    limit: z.number().optional(),
    blocks: z.array(z.union([
      z.object({ type: z.literal("summary"), markdown: z.string() }),
      z.object({
        type: z.literal("file-tree"),
        items: z.array(z.object({
          path: z.string(),
          note: z.string(),
        })),
      }),
      z.object({ type: z.literal("diagram"), mermaid: z.string() }),
      z.object({ type: z.literal("wireframe"), markdown: z.string() }),
      z.object({ type: z.literal("diff-summary"), markdown: z.string() }),
      z.object({ type: z.literal("risk"), markdown: z.string() }),
    ])).optional(),
  }),
  sideEffects: ["write", "filesystem"],
  risk: "medium",
  tags: ["artifact", "plan", "recap", "queen-bee", "work-board"],
  aliases: ["visual artifact", "visual plan", "visual recap", "plan artifact"],
  contextIndex: {
    summary:
      "Local-first store for structured visual plans and recaps.",
    retrievalText:
      "Use /api/visual-artifacts to create, list, or read structured plan and recap artifacts for Queen Bee runs, Work Board tasks, project history, or code changes. It writes to the shared vault when available and falls back to ~/.hivemindos/visual-artifacts. Use public=1 when a response should redact local-only machine paths.",
    route: "/api/visual-artifacts",
    methods: ["GET", "POST"],
  },
});

export const dashboardPinsAction = defineHiveAction({
  id: "dashboard.pins",
  title: "Dashboard feedback pins",
  description:
    "Create, update, archive, and send local dashboard feedback pins to the Work Board.",
  schema: z.object({
    action: z
      .enum(["create", "update-status", "delete", "send-to-work-board"])
      .optional(),
    id: z.string().optional(),
    route: z.string().optional(),
    comment: z.string().optional(),
    selector: z.string().optional(),
    textSnippet: z.string().optional(),
    componentHint: z.string().optional(),
    sourceFileHint: z.string().optional(),
    screenshotPath: z.string().optional(),
    status: z.enum(["open", "sent-to-work-board", "resolved", "archived"]).optional(),
    board: z.string().optional(),
  }),
  sideEffects: ["write", "filesystem"],
  risk: "medium",
  tags: ["dashboard", "feedback", "pin", "annotation", "work-board"],
  aliases: ["dashboard pins", "pin dashboard feedback", "send pin to work board"],
  contextIndex: {
    summary:
      "Local-first dashboard annotation and feedback-pin store.",
    retrievalText:
      "Use /api/dashboard/pins when the user wants to capture dashboard UI feedback, save a feedback pin, mark pin status, or turn a dashboard annotation into a Work Board task. Pins are local dashboard state under ~/.hivemindos and do not use browser storage.",
    route: "/api/dashboard/pins",
    methods: ["GET", "POST", "DELETE"],
  },
});

export const brainReviewQueueAction = defineHiveAction({
  id: "brain.review-queue",
  title: "Shared Brain review queue",
  description:
    "Create, review, and explicitly apply approved durable memory or memory-evolution proposals.",
  schema: z.object({
    action: z
      .enum(["create", "list", "approve", "reject", "preview-apply", "apply"])
      .optional(),
    id: z.string().optional(),
    kind: z
      .enum(["memory", "memory-evolution", "skill", "instruction", "job"])
      .optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    proposedContent: z.string().optional(),
    targetPath: z.string().optional(),
    supersedesMemoryId: z.string().optional(),
    risk: z.enum(["low", "medium", "high"]).optional(),
    status: z.enum(["pending", "approved", "rejected", "applied"]).optional(),
    reason: z.string().optional(),
    vaultPath: z.string().optional(),
    type: z.string().optional(),
    confidence: z.number().optional(),
    cognitiveStage: z.string().optional(),
    evidenceCount: z.number().optional(),
    sourceType: z.string().optional(),
    metaTags: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    entities: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
    actorRole: z.string().optional(),
    memoryOrigin: z.string().optional(),
    source: z.string().optional(),
    agentName: z.string().optional(),
    agentId: z.string().optional(),
    runtime: z.string().optional(),
    machineName: z.string().optional(),
    machineId: z.string().optional(),
    tailnetId: z.string().optional(),
    tailnetName: z.string().optional(),
    tailnetDnsName: z.string().optional(),
    collectorUrl: z.string().optional(),
    sessionId: z.string().optional(),
    project: z.string().optional(),
    proof: z.union([z.boolean(), z.literal("auto")]).optional(),
    evolutionType: z.string().optional(),
    evolutionReason: z.string().optional(),
  }),
  sideEffects: ["write", "filesystem"],
  risk: "medium",
  tags: ["brain", "shared-brain", "review", "memory", "proposal"],
  aliases: ["brain review queue", "memory proposal", "review proposed memory"],
  contextIndex: {
    summary:
      "Local-first review queue for proposed Shared Brain changes.",
    retrievalText:
      "Use /api/brain/review when an agent wants to propose a durable memory, memory evolution, skill edit, instruction edit, or job for human review. The review queue stores proposals locally. action: 'apply' writes only approved memory or memory-evolution proposals through Shared Brain Memory with proof: 'auto' by default; skill, instruction, and job proposals remain manual in v1.",
    route: "/api/brain/review",
    methods: ["GET", "POST"],
  },
});

export const clawbankStatusAction = defineHiveAction({
  id: "clawbank.status",
  title: "ClawBank status",
  description:
    "Read ClawBank readiness and account status (credential presence, KYC, Bridge customer, trading enabled, self-custody wallet) without side effects.",
  schema: z.object({}),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["clawbank", "status", "readiness", "wallet", "banking", "kyc"],
  aliases: ["clawbank_status", "clawbank readiness", "clawbank me", "clawbank account"],
  mcp: { expose: true, compact: true, toolName: "clawbank_status" },
  contextIndex: {
    summary: "Read-only ClawBank account readiness and credential presence.",
    retrievalText:
      "Use clawbank_status first for any ClawBank work. It reports whether a ClawBank credential is configured (by env-key name only) and the live /api/v1/me readiness flags: KYC approval, Bridge customer, trading enabled, and the self-custody wallet address/chain/provisioned state. It never moves funds.",
    route: "/api/clawbank",
    methods: ["GET"],
  },
});

export const clawbankListToolsAction = defineHiveAction({
  id: "clawbank.list-tools",
  title: "ClawBank list tools",
  description:
    "Discover the live, per-account ClawBank tool catalog (MCP tools/list). This is the authoritative surface for coms, contracts, records, fight clubs, Wise, off-ramp, trading engines, and formation checkout that the partial REST docs defer to.",
  schema: z.object({}),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["clawbank", "discovery", "tools", "catalog", "capability"],
  aliases: ["clawbank_list_tools", "clawbank tools", "clawbank discover", "clawbank capabilities"],
  mcp: { expose: true, compact: true, toolName: "clawbank_list_tools" },
  contextIndex: {
    summary: "Discover the live ClawBank per-account tool catalog.",
    retrievalText:
      "Use clawbank_list_tools to enumerate ClawBank's runtime-discovered capabilities before calling clawbank_read or clawbank_call. ClawBank's docs are discovery-first: the per-account tool catalog (with input schemas and read/write classification) is authoritative.",
    route: "/api/clawbank/run",
    methods: ["GET"],
  },
});

export const clawbankReadAction = defineHiveAction({
  id: "clawbank.read",
  title: "ClawBank read tool",
  description:
    "Run a read-only ClawBank discovered tool by name (e.g. get_me, get_balance, get_trading_report, *_guide, inspect_* schema). Rejects state-changing tools — use clawbank_call for those.",
  schema: z.object({
    tool: z.string().describe("Read-only ClawBank tool name from clawbank_list_tools."),
    args: z.record(z.string(), z.unknown()).optional().describe("Tool arguments matching its inputSchema."),
  }),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["clawbank", "read", "discovery", "tools", "guide"],
  aliases: ["clawbank_read", "clawbank get", "clawbank guide", "clawbank inspect"],
  mcp: { expose: true, compact: true, toolName: "clawbank_read" },
  contextIndex: {
    summary: "Invoke a read-only ClawBank discovered tool.",
    retrievalText:
      "Use clawbank_read to call ClawBank read/discovery tools (balances, deposit instructions, reports, company records, capability guides, payload-schema inspectors). The server rejects non-read tools; state changes go through clawbank_call.",
    route: "/api/clawbank/run",
    methods: ["POST"],
  },
});

export const clawbankSendUsdcAction = defineHiveAction({
  id: "clawbank.send-usdc",
  title: "ClawBank send USDC",
  description:
    "EXECUTE a gas-sponsored USDC transfer from the ClawBank self-custody wallet (Base). Moves REAL funds. Requires confirmation \"CLAWBANK_SEND_USDC\". Get the human's go-ahead first; consider clawbank_status to preview the wallet.",
  schema: z.object({
    toAddress: z.string().describe("Recipient address (0x… on Base)."),
    amount: z.union([z.number(), z.string()]).describe("USDC amount to send (1:1 with USD)."),
    confirmation: z.string().describe('Must be "CLAWBANK_SEND_USDC".'),
  }),
  sideEffects: ["wallet", "payment", "network"],
  risk: "critical",
  tags: ["clawbank", "wallet", "payment", "usdc", "send", "execution"],
  aliases: ["clawbank_send_usdc", "clawbank send", "clawbank transfer usdc"],
  mcp: { expose: true, compact: true, toolName: "clawbank_send_usdc" },
  confirmation: {
    token: "CLAWBANK_SEND_USDC",
    reason:
      "ClawBank self-custody USDC sends move real funds on Base and must pass an explicit confirmation gate.",
    when: "always",
  },
  contextIndex: {
    summary: "Critical ClawBank self-custody USDC send.",
    retrievalText:
      "Use clawbank_send_usdc only after a read-only status/preview and explicit CLAWBANK_SEND_USDC confirmation. The server route is authoritative for recipient, amount, and execution.",
    route: "/api/clawbank/wallet",
    methods: ["POST"],
  },
});

export const clawbankTradeAction = defineHiveAction({
  id: "clawbank.trade",
  title: "ClawBank trade",
  description:
    "EXECUTE a one-off ClawBank spot swap against USDC from the self-custody wallet. Moves REAL funds. Requires confirmation \"CONFIRM_CLAWBANK_SWAP\". Get the human's go-ahead first.",
  schema: z.object({
    baseToken: z.string().describe("Token to trade against USDC (symbol or address from clawbank trading tokens)."),
    side: z.enum(["buy", "sell"]).describe("buy spends USDC for the token; sell does the reverse."),
    amountUsdc: z.number().describe("USDC amount for the swap."),
    maxSlippageBps: z.number().optional().describe("Optional max slippage in basis points."),
    confirmation: z.string().describe('Must be "CONFIRM_CLAWBANK_SWAP".'),
  }),
  sideEffects: ["wallet", "payment", "network"],
  risk: "critical",
  tags: ["clawbank", "wallet", "payment", "trade", "swap", "execution"],
  aliases: ["clawbank_trade", "clawbank swap", "clawbank spot swap"],
  mcp: { expose: true, compact: true, toolName: "clawbank_trade" },
  confirmation: {
    token: "CONFIRM_CLAWBANK_SWAP",
    reason:
      "ClawBank swaps trade real funds from the self-custody wallet and must pass an explicit confirmation gate.",
    when: "always",
  },
  contextIndex: {
    summary: "Critical ClawBank spot swap execution.",
    retrievalText:
      "Use clawbank_trade only after reviewing tradeable tokens and with explicit CONFIRM_CLAWBANK_SWAP confirmation. The server route is authoritative for side, amount, slippage, and settlement.",
    route: "/api/clawbank/trading",
    methods: ["POST"],
  },
});

export const clawbankMoneyTransferAction = defineHiveAction({
  id: "clawbank.money-transfer",
  title: "ClawBank custodial transfer",
  description:
    "EXECUTE an on-chain USDC transfer from the ClawBank custodial (Bridge) bank account. KYC-required and moves REAL funds. Requires confirmation \"CONFIRM_CLAWBANK_TRANSFER\". This is the bank-rails wallet, distinct from the self-custody wallet (clawbank_send_usdc).",
  schema: z.object({
    chain: z.string().describe("Settlement chain/network for the transfer."),
    toAddress: z.string().describe("Recipient address."),
    amount: z.union([z.number(), z.string()]).describe("USDC amount to transfer."),
    confirmation: z.string().describe('Must be "CONFIRM_CLAWBANK_TRANSFER".'),
  }),
  sideEffects: ["wallet", "payment", "network"],
  risk: "critical",
  tags: ["clawbank", "wallet", "payment", "bank", "transfer", "bridge", "execution"],
  aliases: ["clawbank_money_transfer", "clawbank bank transfer", "clawbank custodial transfer"],
  mcp: { expose: true, compact: true, toolName: "clawbank_money_transfer" },
  confirmation: {
    token: "CONFIRM_CLAWBANK_TRANSFER",
    reason:
      "ClawBank custodial transfers move real funds from the KYC bank account and must pass an explicit confirmation gate.",
    when: "always",
  },
  contextIndex: {
    summary: "Critical ClawBank custodial (bank-rails) USDC transfer.",
    retrievalText:
      "Use clawbank_money_transfer for the ClawBank bank-rails account (Bridge/KYC), not the self-custody wallet. Requires explicit CONFIRM_CLAWBANK_TRANSFER. The server route is authoritative for chain, recipient, amount, and execution.",
    route: "/api/clawbank/money",
    methods: ["POST"],
  },
});

export const clawbankCallAction = defineHiveAction({
  id: "clawbank.call",
  title: "ClawBank call tool",
  description:
    "EXECUTE any state-changing ClawBank discovered tool by name (off-ramp, custodial transfer, contracts, coms, formation checkout, fight clubs, Wise). May move REAL funds or file a legal entity. Requires confirmation \"CONFIRM_CLAWBANK_CALL\". Inspect the tool with clawbank_list_tools / clawbank_read first and get the human's go-ahead.",
  schema: z.object({
    tool: z.string().describe("ClawBank tool name from clawbank_list_tools."),
    args: z.record(z.string(), z.unknown()).optional().describe("Tool arguments matching its inputSchema."),
    confirmation: z.string().describe('Must be "CONFIRM_CLAWBANK_CALL".'),
  }),
  sideEffects: ["wallet", "payment", "network"],
  risk: "critical",
  tags: ["clawbank", "wallet", "payment", "execution", "offramp", "formation", "contracts"],
  aliases: ["clawbank_call", "clawbank run", "clawbank execute"],
  mcp: { expose: true, compact: true, toolName: "clawbank_call" },
  confirmation: {
    token: "CONFIRM_CLAWBANK_CALL",
    reason:
      "The ClawBank generic runner can invoke money- or entity-moving tools (off-ramp, transfers, formation checkout) and must pass an explicit confirmation gate.",
    when: "always",
  },
  contextIndex: {
    summary: "Critical ClawBank generic write-tool runner.",
    retrievalText:
      "Use clawbank_call to execute non-read ClawBank tools discovered via clawbank_list_tools (off-ramp address minting, custodial transfers, contract create/sign, coms, formation checkout, fight-club writes, Wise sends). Requires CONFIRM_CLAWBANK_CALL; inspect schemas first.",
    route: "/api/clawbank/run",
    methods: ["POST"],
  },
});

export const managedXApiAction = defineHiveAction({
  id: "integrations.x-managed-api",
  title: "Managed X API gateway",
  description:
    "Check the hosted X API gateway, start Sign in with X, read hosted credit balances and X connections, and proxy X API calls paid from hosted HivemindOS credits.",
  schema: z.object({
    action: z
      .enum(["oauth-start", "balance", "connections", "proxy"])
      .optional()
      .describe("Managed X gateway operation to perform (GET returns status, credit accounts, balance, and connections)."),
    creditAccountId: z.string().optional().describe("Wallet/credit account id whose stored hosted credit token pays for the call."),
    walletVaultId: z.string().optional().describe("Accepted alias for creditAccountId."),
    slug: z.string().optional(),
    returnUrl: z.string().optional(),
    scopes: z.string().optional(),
    connectionId: z.string().optional(),
    method: z.string().optional().describe("X API HTTP method for proxy; non-GET requires confirmation."),
    path: z.string().optional().describe("X API path to proxy, e.g. /2/tweets."),
    query: jsonObjectSchema.optional(),
    json: z.unknown().optional(),
    confirmation: z.string().optional().describe('Must be "CONFIRM_X_API_CALL" for non-GET proxy calls.'),
  }),
  sideEffects: ["network", "payment", "public-message"],
  risk: "high",
  tags: ["x", "twitter", "integration", "social", "credits", "oauth", "gateway", "mcp"],
  aliases: ["x_api", "managed x api", "x api proxy", "sign in with x", "hosted x credits", "post to x"],
  confirmation: {
    token: "CONFIRM_X_API_CALL",
    reason:
      "Gateway status, OAuth start, balance, connections, and GET proxy reads do not mutate X, but write (non-GET) proxy calls post or mutate as the connected X account and the route rejects them without CONFIRM_X_API_CALL. All managed calls are paid from hosted HivemindOS credits.",
    when: "always",
  },
  contextIndex: {
    summary:
      "Hosted X API gateway: Sign in with X, hosted-credit billing, and a confirmation-gated X API proxy.",
    retrievalText:
      "Use /api/integrations/x-managed for the managed HivemindOS X API path: GET reports gateway status, stored hosted-credit accounts, credit balance, and X connections; POST action oauth-start begins Sign in with X through the hosted gateway (server-side OAuth token custody), action balance and connections read account state, and action proxy forwards an X API call (method, path, query, json) billed to the stored hosted credit token. Non-GET proxy calls require confirmation CONFIRM_X_API_CALL; the hivemind-mcp x_api tool wraps this proxy with the same gate. Managed X MCP traffic flows through POST /api/integrations/x-managed/mcp with the same credit token.",
    route: "/api/integrations/x-managed",
    methods: ["GET", "POST"],
  },
});

export const xMcpIntegrationAction = defineHiveAction({
  id: "integrations.x-mcp-setup",
  title: "X MCP integration setup",
  description:
    "Read X MCP readiness and manage the BYO X developer app path: save client credentials, start browser OAuth, and sync or remove the xapi MCP server across local runtimes.",
  schema: z.object({
    action: z
      .enum(["save-credentials", "start-oauth", "sync-runtimes", "remove-runtimes"])
      .optional()
      .describe("X MCP setup operation to perform (GET returns status)."),
    clientId: z.string().optional().describe("X developer app OAuth client id (stored as X_MCP_CLIENT_ID)."),
    clientSecret: z.string().optional().describe("X developer app OAuth client secret (stored as X_MCP_CLIENT_SECRET)."),
    redirectUri: z.string().optional().describe("Optional OAuth redirect override (stored as X_MCP_REDIRECT_URI)."),
    targets: z
      .string()
      .optional()
      .describe("Comma-separated runtimes (claude, codex, gemini, openclaw, hermes, aeon) or all."),
  }),
  sideEffects: ["credential", "write", "filesystem", "network"],
  risk: "medium",
  tags: ["x", "twitter", "mcp", "integration", "oauth", "credentials", "runtime", "setup"],
  aliases: ["x mcp", "xapi mcp", "connect x", "x oauth", "sync x mcp to runtimes", "x mcp status"],
  contextIndex: {
    summary:
      "X MCP setup surface: credential save, browser OAuth, and per-runtime xapi MCP config sync.",
    retrievalText:
      "Use /api/integrations/x-mcp to set up the official X API MCP. GET reports readiness: X_MCP_CLIENT_ID / X_MCP_CLIENT_SECRET presence by key name (optional X_MCP_REDIRECT_URI), managed gateway status, xurl cache, bridge script, and which runtimes (claude, codex, gemini, openclaw, hermes, aeon) have the xapi MCP server configured. POST action save-credentials writes the X_MCP_* keys into the shared hive env, start-oauth launches the x-mcp-bridge browser OAuth flow, and sync-runtimes / remove-runtimes run the MCP client registrar to add or remove the xapi server in runtime configs. It stores credentials and edits local runtime config files; it does not post to X.",
    route: "/api/integrations/x-mcp",
    methods: ["GET", "POST"],
  },
});

export const codeSearchGraphAction = defineHiveAction({
  id: "code.search-graph",
  title: "Search the code graph",
  description:
    "Find symbols, routes, classes, or functions in the repository code graph by name pattern or free-text query, without raw file walking.",
  schema: z.object({
    query: z.string().optional().describe("Free-text search across symbol/route names."),
    namePattern: z.string().optional().describe("Regex over symbol names."),
    label: z.string().optional().describe("Filter to a node kind, e.g. Function, Class, Route."),
    filePattern: z.string().optional(),
    limit: z.number().optional(),
    repoPath: z.string().optional().describe("Defaults to the HivemindOS checkout."),
  }),
  sideEffects: ["read", "filesystem"],
  risk: "low",
  readOnly: true,
  tags: ["code", "code-intelligence", "search", "symbols", "routes", "graph"],
  aliases: ["code_search_graph", "search code graph", "find symbol"],
  mcp: { expose: true, compact: true, toolName: "code_search_graph" },
  contextIndex: {
    summary: "Find code symbols and routes via the code graph (or live-scan fallback).",
    retrievalText:
      "Use code_search_graph before broad file search when the project is indexed, to locate functions, classes, and routes by name. Degrades to a live scan when the codebase-memory engine is not installed.",
    route: "/api/code-intelligence",
    methods: ["POST"],
  },
});

export const codeTracePathAction = defineHiveAction({
  id: "code.trace-path",
  title: "Trace code call path",
  description:
    "Trace inbound callers and/or outbound callees of a function through the code graph to understand impact and call flow.",
  schema: z.object({
    functionName: z.string().describe("Function name or qualified name to trace."),
    direction: z.enum(["inbound", "outbound", "both"]).optional(),
    depth: z.number().optional(),
    repoPath: z.string().optional(),
  }),
  sideEffects: ["read", "filesystem"],
  risk: "low",
  readOnly: true,
  tags: ["code", "code-intelligence", "trace", "callers", "callees", "impact"],
  aliases: ["code_trace_path", "what calls this", "call graph"],
  mcp: { expose: true, compact: true, toolName: "code_trace_path" },
  contextIndex: {
    summary: "Trace callers/callees of a function (requires the codebase-memory engine).",
    retrievalText:
      "Use code_trace_path to answer 'what calls this?' / 'what does this call?' before editing. Requires the codebase-memory engine; the fallback returns a clear hint when it is missing.",
    route: "/api/code-intelligence",
    methods: ["POST"],
  },
});

export const codeGetArchitectureAction = defineHiveAction({
  id: "code.get-architecture",
  title: "Get code & system architecture",
  description:
    "Return a structural overview of the repository plus the cross-service route map (Next API routes, Hive actions, MCP tools, and connected fleet apps).",
  schema: z.object({
    path: z.string().optional().describe("Scope the summary to a sub-path."),
    aspects: z.array(z.string()).optional(),
    repoPath: z.string().optional(),
  }),
  sideEffects: ["read", "filesystem"],
  risk: "low",
  readOnly: true,
  tags: ["code", "code-intelligence", "architecture", "routes", "system", "wiring"],
  aliases: ["code_get_architecture", "system map", "which routes expose"],
  mcp: { expose: true, compact: true, toolName: "code_get_architecture" },
  contextIndex: {
    summary: "Structural overview + cross-service route map of how the hive is wired.",
    retrievalText:
      "Use code_get_architecture to understand how HivemindOS is wired — which routes, Hive actions, MCP tools, and connected apps exist and which expose a given capability (e.g. wallet execution).",
    route: "/api/code-intelligence",
    methods: ["POST"],
  },
});

export const codeGetSnippetAction = defineHiveAction({
  id: "code.get-snippet",
  title: "Get code snippet",
  description:
    "Fetch the source for a symbol (by qualified name) or a file/line range, with caller/callee counts when the graph is available.",
  schema: z.object({
    qualifiedName: z.string().optional(),
    filePath: z.string().optional(),
    startLine: z.number().optional(),
    endLine: z.number().optional(),
    includeNeighbors: z.boolean().optional(),
    repoPath: z.string().optional(),
  }),
  sideEffects: ["read", "filesystem"],
  risk: "low",
  readOnly: true,
  tags: ["code", "code-intelligence", "snippet", "source"],
  aliases: ["code_get_snippet", "show source"],
  mcp: { expose: true, compact: true, toolName: "code_get_snippet" },
  contextIndex: {
    summary: "Read a symbol's source with caller/callee context.",
    retrievalText:
      "Use code_get_snippet to read a symbol's source by qualified name (or a file/line range) instead of opening the whole file.",
    route: "/api/code-intelligence",
    methods: ["POST"],
  },
});

export const codeDetectChangesAction = defineHiveAction({
  id: "code.detect-changes",
  title: "Detect code change impact",
  description:
    "Compare the working tree (or a git ref) and report touched files, affected symbols/routes, inbound callers, outbound dependencies, likely-relevant tests, and a risk rating.",
  schema: z.object({
    baseRef: z.string().optional().describe("Base branch to diff against (default main)."),
    since: z.string().optional().describe("Diff since a ref, e.g. HEAD~10."),
    scope: z.enum(["files", "symbols", "impact"]).optional(),
    depth: z.number().optional(),
    repoPath: z.string().optional(),
  }),
  sideEffects: ["read", "filesystem"],
  risk: "low",
  readOnly: true,
  tags: ["code", "code-intelligence", "diff", "impact", "risk", "review"],
  aliases: ["code_detect_changes", "what did i break", "diff impact"],
  mcp: { expose: true, compact: true, toolName: "code_detect_changes" },
  contextIndex: {
    summary: "Diff impact analysis: touched files, affected symbols/routes, callers, risk.",
    retrievalText:
      "Use code_detect_changes before a commit, in code review, or for 'what did I break?' to see touched files, affected routes/symbols, inbound callers, likely tests, and a low/medium/high/critical risk rating.",
    route: "/api/code-intelligence",
    methods: ["POST"],
  },
});

export const codeIndexRepositoryAction = defineHiveAction({
  id: "code.index-repository",
  title: "Index repository code graph",
  description:
    "Build (or refresh) the persistent code-intelligence graph for the repository via the codebase-memory engine. Required before deep graph queries.",
  schema: z.object({
    repoPath: z.string().optional().describe("Defaults to the HivemindOS checkout."),
    mode: z.enum(["full", "moderate", "fast"]).optional(),
    persistence: z.boolean().optional().describe("Write the shareable .codebase-memory artifact (off by default)."),
  }),
  sideEffects: ["write", "filesystem"],
  risk: "medium",
  tags: ["code", "code-intelligence", "index", "graph"],
  aliases: ["code_index_repository", "index code", "build code graph"],
  mcp: { expose: true, compact: true, toolName: "code_index_repository" },
  contextIndex: {
    summary: "Build/refresh the persistent code graph (requires the codebase-memory engine).",
    retrievalText:
      "Use code_index_repository to build or refresh the code graph before deep queries. No-ops with a clear message when the codebase-memory engine is not installed.",
    route: "/api/code-intelligence",
    methods: ["POST"],
  },
});

export const phoneLocalTtsAction = defineHiveAction({
  id: "phone.local-tts",
  title: "Local TTS service management",
  description:
    "Discover launchable local TTS candidates, start the Local TTS service through a machine's collector, and load or unload a local TTS app's model.",
  schema: z.object({
    action: z
      .enum(["start-service", "load-model", "unload-model"])
      .describe("start-service spawns the Local TTS service via the collector; load/unload manage a local TTS app's model."),
    collectorUrl: z.string().optional().describe("Required for start-service: the target machine's collector URL."),
    appId: z.string().optional().describe("Required for load-model/unload-model: the local TTS app id."),
    model: z.string().optional(),
    providerId: z.string().optional(),
  }),
  sideEffects: ["write", "network"],
  risk: "medium",
  tags: ["phone", "voice", "tts", "local-services"],
  aliases: ["local tts", "start tts service", "load tts model", "unload tts model"],
  contextIndex: {
    summary: "Manage the Local TTS service: discover candidates (GET), start via collector, load/unload models.",
    retrievalText:
      "Use /api/phone/local-tts to manage local text-to-speech: GET lists launchable/running local TTS candidates; POST action start-service (with collectorUrl) starts the service on a machine, and POST action load-model/unload-model (with appId) manages a local TTS app's model. Local service/process state changes only — no spend, no external publication.",
    route: "/api/phone/local-tts",
    methods: ["GET", "POST"],
  },
});

export const slackSendMessageAction = defineHiveAction({
  id: "integrations.slack-send",
  title: "Send a Slack message",
  description:
    "Post a message to Slack as the connected user (chat:write). Requires explicit confirmation. Defaults to the connected user's own DM when no channel is given. Surfaces as a capability only when Slack is connected.",
  schema: z.object({
    text: z.string().describe("The message text to post to Slack."),
    channel: z
      .string()
      .optional()
      .describe("Slack channel id (e.g. C0123ABCD) or a user id for a DM. Defaults to the connected user's own DM."),
    confirmation: z.string().optional().describe('Must be "CONFIRM_SLACK_SEND" to actually send.'),
  }),
  sideEffects: ["network", "public-message"],
  risk: "high",
  tags: ["slack", "message", "chat", "integration", "post", "notify", "send", "mcp"],
  aliases: ["slack_send_message", "post to slack", "send slack message", "message slack", "slack message", "dm on slack"],
  // Surfaced in capability search only while Slack is connected (token present).
  requiresConnection: [SLACK_TOKEN_ENV],
  confirmation: {
    token: "CONFIRM_SLACK_SEND",
    reason:
      "Posting to Slack publishes a message visible to others as the connected user; the /api/integrations/slack/send route rejects sends without CONFIRM_SLACK_SEND.",
    when: "always",
  },
  mcp: { expose: true, compact: true, toolName: "slack_send_message" },
  contextIndex: {
    summary: "Send a Slack message as the connected user (confirmation-gated). Available only when Slack is connected.",
    retrievalText:
      "Use the slack_send_message MCP tool (or POST /api/integrations/slack/send) to post a message to Slack as the connected user via chat:write. Required: text. Optional: channel (a channel id C… the connecting user is in, or a user id for a DM; defaults to the connected user's own DM). Sends require confirmation CONFIRM_SLACK_SEND. Only available when Slack is connected (SLACK_BOT_TOKEN present).",
    route: "/api/integrations/slack/send",
    methods: ["POST"],
  },
});

export const HIVE_ACTIONS = [
  appBuilderAction,
  azureResourcesAction,
  googleSlidesReadAction,
  googleSlidesEditAction,
  hivemindosMachinesCatalogAction,
  deployHivemindosMachineAction,
  managedCloudAgentsAction,
  slackSendMessageAction,
  listHivemindMachinesAction,
  planHandoffAction,
  workBoardAction,
  queenBeeAction,
  workEventAction,
  agentChallengeAction,
  requestHumanApprovalAction,
  cryptoCapabilitiesAction,
  reviewCryptoAction,
  prepareCryptoAction,
  nansenIntelligenceAction,
  robinhoodAgenticReadAction,
  sendUsdcAction,
  b20IssuerProofAction,
  dexSwapAction,
  stockTradeAction,
  hyperliquidTradeAction,
  cryptoPracticeBookAction,
  tradingMarketDataAction,
  phoneLocalTtsAction,
  copyTradeConfigAction,
  hivemindosModelsWalletAction,
  hostedMediaCatalogAction,
  hostedMediaReadAction,
  hostedMediaGenerationAction,
  brainGraphOverviewAction,
  brainSearchKnowledgeAction,
  brainGetNodeAction,
  sharedBrainContractAction,
  contextXrayAction,
  visualArtifactsAction,
  dashboardPinsAction,
  brainReviewQueueAction,
  clawbankStatusAction,
  clawbankListToolsAction,
  clawbankReadAction,
  clawbankSendUsdcAction,
  clawbankTradeAction,
  clawbankMoneyTransferAction,
  clawbankCallAction,
  managedXApiAction,
  xMcpIntegrationAction,
  codeSearchGraphAction,
  codeTracePathAction,
  codeGetArchitectureAction,
  codeGetSnippetAction,
  codeDetectChangesAction,
  codeIndexRepositoryAction,
] as const;

export function listHiveActions() {
  return [...HIVE_ACTIONS];
}
