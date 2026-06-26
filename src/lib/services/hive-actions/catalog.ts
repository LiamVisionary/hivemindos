import { z } from "zod";
import { defineHiveAction } from "./define";

const handoffTargetSchema = {
  target: z.string().describe("Fuzzy machine name, such as ubuntu."),
  allowAmbiguous: z.boolean().optional(),
};

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

export const sendUsdcAction = defineHiveAction({
  id: "wallet.send-usdc",
  title: "Send USDC",
  description:
    "Execute a governed USDC send through the wallet route after explicit confirmation.",
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
  tags: ["wallet", "payment", "usdc", "send", "execution"],
  aliases: ["send_usdc", "wallet send", "send payment"],
  mcp: { expose: true, compact: true, toolName: "send_usdc" },
  confirmation: {
    token: "SEND_USDC",
    reason:
      "USDC sends move funds and must pass the wallet route's spend policy and explicit confirmation gate.",
    when: "always",
  },
  contextIndex: {
    summary:
      "Critical governed USDC send execution route.",
    retrievalText:
      "Use send_usdc only after a read-only prepare/review path and explicit SEND_USDC confirmation. The server route remains authoritative for spend policy, wallet selection, caps, recipient, amount, and execution.",
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
    "Execute a governed stock or xStocks trade after explicit buy/sell confirmation.",
  schema: z.object({
    agentId: z.string().optional(),
    wallet: z.record(z.string(), z.unknown()).optional(),
    symbol: z.string().optional(),
    side: z.enum(["buy", "sell"]).optional(),
    quantity: z.number().optional(),
    amountUsd: z.number().optional(),
    notionalUsd: z.number().optional(),
    venue: z.string().optional(),
    alpacaPaper: z.boolean().optional(),
    confirmation: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  sideEffects: ["wallet", "payment", "network"],
  risk: "critical",
  tags: ["wallet", "payment", "stocks", "trade", "execution"],
  aliases: ["stock_trade", "buy stock", "sell stock", "xstocks trade"],
  mcp: { expose: true, compact: true, toolName: "stock_trade" },
  confirmation: {
    tokens: ["CONFIRM_BUY", "CONFIRM_SELL"],
    reason:
      "Stock trades can place real brokerage or tokenized-asset orders and must pass venue policy and explicit side-specific confirmation.",
    when: "always",
  },
  contextIndex: {
    summary:
      "Critical governed stock/xStocks trade execution route.",
    retrievalText:
      "Use stock_trade only after prepare/review paths establish venue, paper/live mode, symbol, side, amount, and required side-specific confirmation. CONFIRM_BUY is required for buys and CONFIRM_SELL for sells; server routes remain authoritative.",
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

export const HIVE_ACTIONS = [
  listHivemindMachinesAction,
  planHandoffAction,
  cryptoCapabilitiesAction,
  reviewCryptoAction,
  prepareCryptoAction,
  sendUsdcAction,
  b20IssuerProofAction,
  dexSwapAction,
  stockTradeAction,
  hyperliquidTradeAction,
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
] as const;

export function listHiveActions() {
  return [...HIVE_ACTIONS];
}
