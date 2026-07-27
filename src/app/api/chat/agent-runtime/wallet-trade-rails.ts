import { NextRequest } from "next/server";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentTradingVenue, AgentWalletConfig } from "@/lib/types/agent-wallet";
import {
  executeStockTrade,
  discoverStockTradeQuote,
  stockTradeConfirmation,
  type StockTradeSide,
  type BuyStockPolicy,
  type BuyStockResult,
} from "@/lib/services/trading/buy-stock";
import { resolveXStock, supportedXStockTickers } from "@/lib/config/xstocks-tokens";
import { resolveRobinhoodStockToken, supportedRobinhoodStockTickers } from "@/lib/config/robinhood-chain";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import {
  bankrActionDraftMessage,
  bankrActionResultMessage,
  bankrActionRequiresConfirmation,
  BANKR_ACTION_TOOL_NAME,
  classifyBankrActionPrompt,
  executeBankrAction,
  isBankrActionConfirmationText,
  parseBankrActionDraftMessage,
  validateBankrActionReadiness,
  type BankrActionDraft,
} from "@/lib/services/bankr-actions";
import { RUNTIME_STREAM_EVENT_TYPES, type RuntimeStreamEvent } from "@/lib/services/runtime-stream-events";
import {
  appendRuntimeChatSessionEvent,
  appendRuntimeChatSessionText,
  finishRuntimeChatSession,
} from "@/lib/services/chat/runtime-session-store";
import { latestUserMessage, messageText, ssePayload, unwrapLatestUserRequest, type IncomingMessage } from "./messages";
import { recordRouteTelemetry, telemetryPayloadForProfile } from "./route-telemetry";
import {
  formatDuration,
  formatMoney,
  maybeExecuteConfirmedB20Issuer,
  maybeExecuteConfirmedPrivateTransfer,
  maybeExecuteConfirmedSend,
  maybeExecuteConfirmedSwap,
  maybeExecuteNaturalPrivateTransfer,
  maybePrepareNaturalB20Issuer,
  maybePrepareNaturalSend,
  maybePrepareNaturalSwap,
  privateTransferSse,
  type ActingWalletSourceHint,
} from "./wallet-transfer-rails";
import {
  maybeExecuteConfirmedPrivateX402,
  maybeExecuteConfirmedPublicX402,
  maybeExecuteNaturalMiroSharkX402,
  maybePrepareNaturalPrivateX402,
  maybePrepareNaturalPublicX402,
} from "./wallet-x402-rails";

type BuyStockDraft = { venue: AgentTradingVenue; ticker: string; notionalUsd?: number; qty?: number; side?: StockTradeSide };

// ---- Buy-stock rail (unified Alpaca / xStocks tool) -------------------------

function buyStockCapUsd(wallet?: AgentWalletConfig): number {
  if (!wallet) return 0;
  const explicit = Number(wallet.maxTradeUsd) || 0;
  return explicit > 0 ? explicit : Number(wallet.maxPaymentUsd) || 0;
}

function buyStockPolicy(wallet: AgentWalletConfig): BuyStockPolicy {
  return {
    agentId: wallet.agentId,
    enabled: wallet.enabled,
    network: wallet.network,
    tradingVenue: wallet.tradingVenue,
    alpacaKeyEnvName: wallet.alpacaKeyEnvName,
    alpacaSecretEnvName: wallet.alpacaSecretEnvName,
    alpacaPaper: wallet.alpacaPaper,
    maxTradeUsd: wallet.maxTradeUsd,
    maxPaymentUsd: wallet.maxPaymentUsd,
  };
}

function detectBuyStockVenue(text: string, wallet?: AgentWalletConfig): AgentTradingVenue | null {
  if (/\b(robinhood\s+(?:agentic|brokerage|mcp)|agentic\s+(?:account|trading))\b/i.test(text)) return "robinhood-agentic";
  if (/\b(robinhood\s+chain|rh\s+chain|robinhood\s+stock\s+tokens?|robinhood\s+tokens?)\b/i.test(text)) return "robinhood-chain";
  if (/\b(xstock|x-stock|tokeni[sz]ed|on-?chain|solana|jupiter)\b/i.test(text)) return "xstocks";
  if (/\b(alpaca|brokerage|paper trad|real (?:stock|share|shares))\b/i.test(text)) return "alpaca";
  return wallet?.tradingVenue ?? null;
}

const BUY_STOCK_TICKER_STOPWORDS = new Set([
  "USD", "USDC", "BUY", "THE", "AND", "FOR", "A", "AN", "OK", "GO", "AI", "CEO", "ETF",
  "NYSE", "US", "PM", "AM", "OF", "IN", "IT", "MY", "I", "SOME", "WORTH", "LIVE",
]);

function scanBuyStockTicker(text: string): string | null {
  for (const word of text.toUpperCase().match(/\b[A-Z][A-Z.]{0,9}\b/g) ?? []) {
    if (resolveXStock(word)) return resolveXStock(word)!.underlying;
  }
  for (const word of text.match(/\b[A-Z]{1,5}\b/g) ?? []) {
    if (!BUY_STOCK_TICKER_STOPWORDS.has(word)) return word;
  }
  const phrased = text.match(/\b(?:of|in)\s+([A-Za-z]{1,5})\b/i);
  return phrased ? phrased[1].toUpperCase() : null;
}

function parseBuyStockRequest(text: string, wallet?: AgentWalletConfig): BuyStockDraft | null {
  if (!text) return null;
  if (/https?:\/\//i.test(text)) return null; // URL present -> x402 territory, not a stock trade.
  const isSell = /\b(sell|liquidate|offload|dump)\b/i.test(text);
  if (!isSell && !/\b(buy|purchase|invest|acquire|long)\b/i.test(text)) return null;
  if (!/\b(stock|stocks|share|shares|equit|ticker|xstock|alpaca)\b/i.test(text) && !/\$\s*\d/.test(text)) return null;

  const venue = detectBuyStockVenue(text, wallet);
  if (!venue) return null;

  const ticker = scanBuyStockTicker(text);
  if (!ticker) return null;

  const sharesMatch = text.match(/(\d+(?:\.\d+)?)\s*shares?\b/i);
  const amountMatch = text.match(/\$\s*(\d+(?:\.\d{1,2})?)/)
    ?? text.match(/(\d+(?:\.\d{1,2})?)\s*(?:usdc|usd|dollars?|bucks)\b/i)
    ?? text.match(/\b(?:for|worth)\s+\$?(\d+(?:\.\d{1,2})?)\b/i);

  const draft: BuyStockDraft = { venue, ticker, side: isSell ? "sell" : "buy" };
  if (sharesMatch && (venue === "alpaca" || venue === "robinhood-agentic")) draft.qty = Number(sharesMatch[1]);
  if (amountMatch) draft.notionalUsd = Number(amountMatch[1]);
  if (draft.notionalUsd == null && draft.qty == null) return null;
  return draft;
}

function isBuyStockDraftText(text: string) {
  return /\*{0,2}(Buy|Sell) stock ready\*{0,2}/i.test(text);
}

function parseBuyStockDraft(text: string): BuyStockDraft | null {
  const venueMatch = text.match(/Venue\s+`?(alpaca|robinhood-agentic|xstocks|robinhood-chain)`?/i);
  if (!venueMatch) return null;
  const venue = venueMatch[1].toLowerCase() as AgentTradingVenue;
  const sideOf = (verb: string): StockTradeSide => (verb.toLowerCase() === "sell" ? "sell" : "buy");
  const qtyForm = text.match(/(Buy|Sell)\s+\*\*(\d+(?:\.\d+)?)\*\*\s+shares?(?:\(s\))?\s+of\s+\*\*([A-Za-z][A-Za-z.]{0,9})\*\*/i);
  if (qtyForm) return { venue, side: sideOf(qtyForm[1]), ticker: qtyForm[3].toUpperCase(), qty: Number(qtyForm[2]) };
  const notionalForm = text.match(/(Buy|Sell)\s+\*\*([A-Za-z][A-Za-z.]{0,9})\*\*\s+for\s+~?\$(\d+(?:\.\d{1,2})?)/i);
  if (notionalForm) return { venue, side: sideOf(notionalForm[1]), ticker: notionalForm[2].toUpperCase(), notionalUsd: Number(notionalForm[3]) };
  return null;
}

function findLatestBuyStockRequest(messages: IncomingMessage[], wallet?: AgentWalletConfig): BuyStockDraft | null {
  return parseBuyStockRequest(messageText(latestUserMessage(messages)), wallet);
}

function findBuyStockDraft(messages: IncomingMessage[]): BuyStockDraft | null {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = messageText(message);
    if (!isBuyStockDraftText(text)) continue;
    return parseBuyStockDraft(text);
  }
  return null;
}

function validateBuyStockDraft(wallet: AgentWalletConfig | undefined, draft: BuyStockDraft, executing: boolean): string {
  const side = draft.side ?? "buy";
  if (!wallet) return "No wallet is configured for this agent.";
  if (!wallet.tradingVenue) return "Stock trading is off. Set a trading venue (alpaca, robinhood-agentic, xstocks, or robinhood-chain) for this agent first.";
  if (executing && !wallet.enabled) return "Wallet spending is off for this agent. Turn Spend on before trading.";
  const cap = buyStockCapUsd(wallet);
  if (draft.notionalUsd != null) {
    if (!(draft.notionalUsd > 0)) return "Trade amount must be a positive USD value.";
    // The per-trade cap bounds spend (buys); a sell increases USDC, so it isn't capped here.
    if (side === "buy" && cap > 0 && draft.notionalUsd > cap) return `Trade exceeds this agent's per-trade cap ($${cap.toFixed(2)}).`;
  }
  if (draft.venue === "xstocks") {
    if (!resolveXStock(draft.ticker)) return `"${draft.ticker}" is not a verified xStock. Supported: ${supportedXStockTickers().join(", ")}.`;
    if (wallet.network !== "solana:mainnet") return "xStocks swaps require a Solana mainnet wallet.";
    if (draft.qty != null && draft.notionalUsd == null) return "On-chain xStock trades are sized in USDC, not share count — give a $ amount.";
  }
  if (draft.venue === "robinhood-chain") {
    if (!resolveRobinhoodStockToken(draft.ticker)) return `"${draft.ticker}" is not a canonical Robinhood Stock Token. Supported: ${supportedRobinhoodStockTickers().join(", ")}.`;
    if (wallet.network !== "eip155:4663") return "Robinhood Chain stock tokens require a Robinhood Chain wallet (eip155:4663).";
    if (draft.qty != null && draft.notionalUsd == null) return "Robinhood Chain Stock Token trades are sized in USDG, not share count — give a $ amount.";
  }
  if (draft.notionalUsd == null && draft.qty == null) return `Tell me how much to ${side} — a $ amount, or a share count for Alpaca.`;
  return "";
}

function buyStockDraftMessage(draft: BuyStockDraft, wallet: AgentWalletConfig | undefined, quoteDetail: string, validation?: string) {
  const side = draft.side ?? "buy";
  const verb = side === "sell" ? "Sell" : "Buy";
  if (validation) {
    return [`**${verb} stock unavailable**`, "", validation, "", "Fix this blocker, then ask again."].join("\n");
  }
  const cap = buyStockCapUsd(wallet);
  const venueLabel = draft.venue === "alpaca"
    ? `\`alpaca\` ${wallet?.alpacaPaper === false ? "(LIVE)" : "(paper)"}`
    : draft.venue === "xstocks"
      ? "`xstocks` (on-chain)"
      : draft.venue === "robinhood-agentic"
        ? "`robinhood-agentic` (official brokerage MCP)"
        : "`robinhood-chain` (USDG on-chain)";
  const sizeLine = draft.qty != null
    ? `${verb} **${draft.qty}** shares of **${draft.ticker}**`
    : `${verb} **${draft.ticker}** for ~$${(draft.notionalUsd ?? 0).toFixed(2)}`;
  return [
    `**${verb} stock ready**`,
    "",
    `Venue ${venueLabel}`,
    sizeLine,
    quoteDetail,
    side === "buy" && cap > 0 ? `Per-trade cap **$${cap.toFixed(2)}**` : "",
    "",
    wallet?.enabled
      ? `Reply \`confirm\` to ${side}.`
      : `Wallet spending is off, so I prepared the draft only. Turn Spend on before trading.`,
  ].filter(Boolean).join("\n");
}

function buyStockResultMessage(result: BuyStockResult, executionMs: number) {
  const verb = result.side === "sell" ? "Sell" : "Buy";
  const head = result.venue === "alpaca"
    ? `${result.paper ? "paper" : "LIVE"} brokerage order`
    : result.venue === "robinhood-agentic" ? "Robinhood Agentic brokerage order"
      : result.venue === "xstocks" ? "on-chain swap" : "Robinhood Chain stock-token action";
  return [
    `**${verb} stock complete** · ${head}`,
    "",
    result.detail,
    result.priceImpactPct != null ? `Price impact \`${(result.priceImpactPct * 100).toFixed(2)}%\`` : "",
    `Reference \`${result.reference}\``,
    "",
    `Timing **${formatDuration(executionMs)}**`,
  ].filter(Boolean).join("\n");
}

function buyStockExecutionSse(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  draft: BuyStockDraft;
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(ssePayload(payload)));
      const sendTool = async (type: string, label: string, detail?: string, status: "running" | "completed" | "failed" = "running") => {
        const event = { type, toolName: "buyStock", name: "buyStock", message: label, detail, status };
        send(event);
        await appendRuntimeChatSessionEvent(input.runtimeSessionId, label, detail, event).catch(() => undefined);
      };
      try {
        const { draft } = input;
        const side = draft.side ?? "buy";
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_START, `Preparing stock ${side}`, `${draft.venue}:${draft.ticker}`);
        const wallet = input.wallet;
        const validation = validateBuyStockDraft(wallet, draft, true);
        if (validation) throw new Error(validation);

        let network: string | undefined;
        let secret: string | undefined;
        let fromAddress: string | undefined;
        if (draft.venue === "xstocks" || draft.venue === "robinhood-chain") {
          const stored = await getWalletSecret(input.profile.id);
          if (!stored) throw new Error(`No local ${draft.venue === "xstocks" ? "Solana" : "Robinhood Chain"} wallet exists for this agent.`);
          network = stored.info.network;
          secret = stored.secret;
          fromAddress = stored.info.address;
        } else if ((draft.venue === "alpaca" && wallet?.alpacaPaper === false) || draft.venue === "robinhood-agentic") {
          const stored = await getWalletSecret(input.profile.id).catch(() => null);
          if (stored) {
            network = stored.info.network;
            secret = stored.secret;
            fromAddress = stored.info.address;
          }
        }

        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Validate trade policy",
          `Venue ${draft.venue}; cap ${formatMoney(buyStockCapUsd(wallet))} USD.`,
          "completed",
        );
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS, `Execute ${side}`, "Submitting the order.", "running");
        const startedAt = Date.now();
        const result = await executeStockTrade({
          agentId: input.profile.id,
          policy: buyStockPolicy(wallet!),
          ticker: draft.ticker,
          notionalUsd: draft.notionalUsd ?? 0,
          qty: draft.qty,
          side,
          confirmation: stockTradeConfirmation(side),
          network,
          secret,
          fromAddress,
        });
        const message = buyStockResultMessage(result, Date.now() - startedAt);
        await recordRouteTelemetry(input.request, "agent_runtime.wallet.buy_stock.completed", {
          ...telemetryPayloadForProfile(input.profile),
          venue: result.venue,
          ticker: result.ticker,
          notionalUsd: result.notionalUsd,
          paper: result.paper,
          elapsedMs: Date.now() - input.routeStartedAt,
        });
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, `${side === "sell" ? "Sell" : "Buy"} finished`, `Total ${formatDuration(Date.now() - input.routeStartedAt)}.`, "completed");
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message, result).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "completed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const verb = (input.draft.side ?? "buy") === "sell" ? "Sell" : "Buy";
        const message = `${verb} stock failed: ${detail}`;
        await recordRouteTelemetry(input.request, "agent_runtime.wallet.buy_stock.failed", {
          ...telemetryPayloadForProfile(input.profile),
          venue: input.draft.venue,
          ticker: input.draft.ticker,
          side: input.draft.side ?? "buy",
          error: detail,
          elapsedMs: Date.now() - input.routeStartedAt,
        }).catch(() => undefined);
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, `${verb} failed`, detail, "failed");
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function maybeExecuteConfirmedBuyStock(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const latestText = messageText(latestUserMessage(input.messages)).trim();
  if (!/^(confirm|confirmed|yes|yes,? confirm|go ahead|buy it|sell it|do it|execute)$/i.test(latestText)) return null;
  const draft = findBuyStockDraft(input.messages);
  if (!draft) return null;
  return buyStockExecutionSse({ ...input, draft });
}

async function maybePrepareNaturalBuyStock(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const draft = findLatestBuyStockRequest(input.messages, input.wallet);
  if (!draft) return null;

  const validation = validateBuyStockDraft(input.wallet, draft, false);
  let quoteDetail = "";
  if (!validation && input.wallet) {
    try {
      const quote = await discoverStockTradeQuote({
        side: draft.side ?? "buy",
        policy: buyStockPolicy(input.wallet),
        ticker: draft.ticker,
        notionalUsd: draft.notionalUsd ?? 0,
      });
      quoteDetail = quote.detail;
    } catch {
      quoteDetail = "";
    }
  }
  const message = buyStockDraftMessage(draft, input.wallet, quoteDetail, validation);
  await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
  await finishRuntimeChatSession(input.runtimeSessionId, validation ? "failed" : "completed").catch(() => undefined);
  await recordRouteTelemetry(input.request, "agent_runtime.wallet.buy_stock.draft", {
    ...telemetryPayloadForProfile(input.profile),
    venue: draft.venue,
    ticker: draft.ticker,
    notionalUsd: draft.notionalUsd,
    qty: draft.qty,
    hasValidationError: Boolean(validation),
    elapsedMs: Date.now() - input.routeStartedAt,
  });
  return privateTransferSse(message);
}

// ---- Bankr native action rail ------------------------------------------------

function findBankrActionDraft(messages: IncomingMessage[]): BankrActionDraft | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const draft = parseBankrActionDraftMessage(messageText(message));
    if (draft) return draft;
  }
  return null;
}

function bankrActionExecutionSse(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  draft: BankrActionDraft;
  runtimeSessionId: string;
}) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now();
      const detail = input.draft.jobId ? `Job ${input.draft.jobId}` : input.draft.prompt;
      const send = (payload: RuntimeStreamEvent | Record<string, unknown>) => {
        controller.enqueue(encoder.encode(ssePayload(payload)));
      };
      try {
        send({
          type: RUNTIME_STREAM_EVENT_TYPES.TOOL_START,
          toolName: BANKR_ACTION_TOOL_NAME,
          name: BANKR_ACTION_TOOL_NAME,
          message: "Bankr action",
          detail,
          status: "running",
        });
        await appendRuntimeChatSessionEvent(input.runtimeSessionId, "Bankr action", detail).catch(() => undefined);
        await recordRouteTelemetry(input.request, "agent_runtime.bankr_action.started", {
          ...telemetryPayloadForProfile(input.profile),
          intent: input.draft.intent,
          readOnly: input.draft.readOnly,
          hasJobId: Boolean(input.draft.jobId),
          elapsedMs: Date.now() - input.routeStartedAt,
        });
        const result = await executeBankrAction(input.draft);
        const message = bankrActionResultMessage(result);
        send({
          type: RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
          toolName: BANKR_ACTION_TOOL_NAME,
          name: BANKR_ACTION_TOOL_NAME,
          message: "Bankr action complete",
          detail: result.status || result.jobId || result.threadId || "Completed",
          status: "completed",
        });
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message, result.raw).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "completed").catch(() => undefined);
        await recordRouteTelemetry(input.request, "agent_runtime.bankr_action.completed", {
          ...telemetryPayloadForProfile(input.profile),
          intent: input.draft.intent,
          readOnly: input.draft.readOnly,
          status: result.status ?? null,
          jobId: result.jobId ?? null,
          threadId: result.threadId ?? null,
          executionMs: Date.now() - startedAt,
          elapsedMs: Date.now() - input.routeStartedAt,
        });
      } catch (error) {
        const message = `Bankr action failed: ${error instanceof Error ? error.message : String(error)}`;
        send({
          type: RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
          toolName: BANKR_ACTION_TOOL_NAME,
          name: BANKR_ACTION_TOOL_NAME,
          message: "Bankr action failed",
          detail: message,
          status: "failed",
        });
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
        await recordRouteTelemetry(input.request, "agent_runtime.bankr_action.failed", {
          ...telemetryPayloadForProfile(input.profile),
          intent: input.draft.intent,
          readOnly: input.draft.readOnly,
          errorMessage: error instanceof Error ? error.message : String(error),
          executionMs: Date.now() - startedAt,
          elapsedMs: Date.now() - input.routeStartedAt,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function maybeExecuteConfirmedBankrAction(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  runtimeSessionId: string;
}): Promise<Response | null> {
  const latestText = messageText(latestUserMessage(input.messages)).trim();
  if (!isBankrActionConfirmationText(latestText)) return null;
  const draft = findBankrActionDraft(input.messages);
  if (!draft || !bankrActionRequiresConfirmation(draft)) return null;
  const validation = await validateBankrActionReadiness();
  if (validation) {
    const message = bankrActionDraftMessage(draft, validation);
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    return privateTransferSse(message);
  }
  return bankrActionExecutionSse({ ...input, draft });
}

async function maybeHandleNaturalBankrAction(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  runtimeSessionId: string;
}): Promise<Response | null> {
  const draft = classifyBankrActionPrompt(messageText(latestUserMessage(input.messages)));
  if (!draft) return null;
  const validation = await validateBankrActionReadiness();
  if (validation || bankrActionRequiresConfirmation(draft)) {
    const message = bankrActionDraftMessage(draft, validation);
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, validation ? "failed" : "completed").catch(() => undefined);
    await recordRouteTelemetry(input.request, "agent_runtime.bankr_action.draft", {
      ...telemetryPayloadForProfile(input.profile),
      intent: draft.intent,
      readOnly: draft.readOnly,
      hasValidationError: Boolean(validation),
      elapsedMs: Date.now() - input.routeStartedAt,
    });
    return privateTransferSse(message);
  }
  return bankrActionExecutionSse({ ...input, draft });
}

// Deterministic wallet / trade intent dispatch. A "swap / send / buy / bankr / x402
// ..." request must be intercepted and run on the rails here - NOT streamed to the
// raw agent, which has no deterministic money path and returns nothing usable. This
// runs for EVERY runtime path, including the low-latency voice fast path, so the
// hive chat can transact on the user's acting wallet. Conversational turns fall
// through (every handler parses the text and returns null synchronously) at
// negligible cost. Returns the matched rail Response, or null to continue.
export async function dispatchWalletAndTradeIntents(ctx: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  actingWalletSource?: ActingWalletSourceHint;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const { request, routeStartedAt, profile, wallet, actingWalletSource, runtimeSessionId } = ctx;
  // Match on the user's bare request, not the prepended screen-context briefing.
  const messages = unwrapLatestUserRequest(ctx.messages);
  const naturalMiroSharkX402 = await maybeExecuteNaturalMiroSharkX402({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (naturalMiroSharkX402) return naturalMiroSharkX402;
  const confirmedBankrAction = await maybeExecuteConfirmedBankrAction({
    request,
    routeStartedAt,
    profile,
    messages,
    runtimeSessionId,
  });
  if (confirmedBankrAction) return confirmedBankrAction;
  const confirmedSend = await maybeExecuteConfirmedSend({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    actingWalletSource,
    runtimeSessionId,
  });
  if (confirmedSend) return confirmedSend;
  const naturalSend = await maybePrepareNaturalSend({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    actingWalletSource,
    runtimeSessionId,
  });
  if (naturalSend) return naturalSend;
  const confirmedSwap = await maybeExecuteConfirmedSwap({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    actingWalletSource,
    runtimeSessionId,
  });
  if (confirmedSwap) return confirmedSwap;
  const naturalSwap = await maybePrepareNaturalSwap({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    actingWalletSource,
    runtimeSessionId,
  });
  if (naturalSwap) return naturalSwap;
  const confirmedB20Issuer = await maybeExecuteConfirmedB20Issuer({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (confirmedB20Issuer) return confirmedB20Issuer;
  const naturalB20Issuer = await maybePrepareNaturalB20Issuer({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (naturalB20Issuer) return naturalB20Issuer;
  const naturalBankrAction = await maybeHandleNaturalBankrAction({
    request,
    routeStartedAt,
    profile,
    messages,
    runtimeSessionId,
  });
  if (naturalBankrAction) return naturalBankrAction;
  const confirmedBuyStock = await maybeExecuteConfirmedBuyStock({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (confirmedBuyStock) return confirmedBuyStock;
  const naturalBuyStock = await maybePrepareNaturalBuyStock({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (naturalBuyStock) return naturalBuyStock;
  const confirmedPrivateX402 = await maybeExecuteConfirmedPrivateX402({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (confirmedPrivateX402) return confirmedPrivateX402;
  const confirmedPublicX402 = await maybeExecuteConfirmedPublicX402({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (confirmedPublicX402) return confirmedPublicX402;
  const naturalPrivateX402 = await maybePrepareNaturalPrivateX402({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (naturalPrivateX402) return naturalPrivateX402;
  const naturalPublicX402 = await maybePrepareNaturalPublicX402({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (naturalPublicX402) return naturalPublicX402;
  const naturalPrivateTransfer = await maybeExecuteNaturalPrivateTransfer({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (naturalPrivateTransfer) return naturalPrivateTransfer;
  const confirmedPrivateTransfer = await maybeExecuteConfirmedPrivateTransfer({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (confirmedPrivateTransfer) return confirmedPrivateTransfer;
  return null;
}
