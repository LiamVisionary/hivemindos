import { z } from "zod";

import { defineHiveAction } from "./define";

const robinhoodAgenticReadToolSchema = z.enum([
  "get_accounts",
  "get_portfolio",
  "get_realized_pnl",
  "get_pnl_trade_history",
  "search",
  "get_watchlists",
  "get_watchlist_items",
  "get_option_watchlist",
  "get_popular_watchlists",
  "get_equity_historicals",
  "get_equity_fundamentals",
  "get_equity_technical_indicators",
  "get_earnings_results",
  "get_earnings_calendar",
  "get_indexes",
  "get_index_quotes",
  "get_equity_positions",
  "get_equity_quotes",
  "get_equity_orders",
  "get_equity_tradability",
  "get_option_level_upgrade_info",
  "get_option_chains",
  "get_option_instruments",
  "get_option_quotes",
  "get_option_positions",
  "get_option_orders",
  "get_scans",
  "run_scan",
]);

export const robinhoodAgenticReadAction = defineHiveAction({
  id: "trading.robinhood-agentic-read",
  title: "Read Robinhood Agentic brokerage data",
  description:
    "Read accounts, portfolios, positions, orders, market data, watchlists, earnings, options context, and scans through Robinhood's official Trading MCP.",
  schema: z.object({
    tool: robinhoodAgenticReadToolSchema.describe("Exact read-only Robinhood MCP tool."),
    arguments: z.record(z.string(), z.unknown()).optional().describe("Arguments matching the live tool schema discovered from Robinhood."),
  }),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["robinhood", "agentic", "brokerage", "mcp", "stocks", "options", "portfolio", "market-data", "watchlist", "scans"],
  aliases: ["robinhood_agentic_read", "robinhood brokerage", "robinhood portfolio", "robinhood market data"],
  mcp: { expose: true, compact: true, toolName: "robinhood_agentic_read" },
  contextIndex: {
    summary: "Read-only Robinhood Agentic brokerage and market-data tools through the official Trading MCP.",
    retrievalText:
      "Use robinhood_agentic_read only for the explicitly allowlisted read tools exposed by Robinhood's official Trading MCP. Connect Robinhood in Integrations first. Never call Robinhood's raw place_equity_order, cancel_equity_order, options mutation, watchlist mutation, or scan mutation tools through this action. Equity trades use the governed stock_trade capability with venue robinhood-agentic, Robinhood pre-trade review, HivemindOS caps, and CONFIRM_BUY or CONFIRM_SELL.",
    route: "/api/integrations/robinhood-mcp",
    methods: ["POST"],
  },
});
