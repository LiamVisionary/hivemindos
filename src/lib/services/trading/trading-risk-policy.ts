import type {
  TradePlan,
  TradeProposal,
  TradeRiskCheck,
  TradeRiskEvaluation,
  TradingExecutionMode,
  TradingRiskPolicy,
} from "@/lib/types/trading-control";

export const DEFAULT_TRADING_RISK_POLICY: TradingRiskPolicy = {
  maxPositionPct: 25,
  maxConcentrationPct: 35,
  maxLeverage: 2,
  maxDailyLossPct: 5,
  maxDrawdownPct: 10,
  maxSlippageBps: 100,
  minLiquidityUsd: 0,
  cooldownSeconds: 30,
  maxQuoteAgeSeconds: 30,
  allowedSymbols: [],
  requireKnownPortfolioForLive: true,
  requirePlanForLive: true,
};

function finite(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const number = finite(value);
  return Math.min(max, Math.max(min, number ?? fallback));
}

export function normalizeTradingRiskPolicy(value: Partial<TradingRiskPolicy> | undefined): TradingRiskPolicy {
  const policy = value ?? {};
  const symbols = Array.isArray(policy.allowedSymbols)
    ? Array.from(new Set(policy.allowedSymbols.map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean))).slice(0, 200)
    : [];
  return {
    maxPositionPct: clamp(policy.maxPositionPct, DEFAULT_TRADING_RISK_POLICY.maxPositionPct, 1, 100),
    maxConcentrationPct: clamp(policy.maxConcentrationPct, DEFAULT_TRADING_RISK_POLICY.maxConcentrationPct, 1, 100),
    maxLeverage: clamp(policy.maxLeverage, DEFAULT_TRADING_RISK_POLICY.maxLeverage, 1, 100),
    maxDailyLossPct: clamp(policy.maxDailyLossPct, DEFAULT_TRADING_RISK_POLICY.maxDailyLossPct, 0.1, 100),
    maxDrawdownPct: clamp(policy.maxDrawdownPct, DEFAULT_TRADING_RISK_POLICY.maxDrawdownPct, 0.1, 100),
    maxSlippageBps: clamp(policy.maxSlippageBps, DEFAULT_TRADING_RISK_POLICY.maxSlippageBps, 1, 10_000),
    minLiquidityUsd: clamp(policy.minLiquidityUsd, DEFAULT_TRADING_RISK_POLICY.minLiquidityUsd, 0, 10_000_000_000),
    cooldownSeconds: clamp(policy.cooldownSeconds, DEFAULT_TRADING_RISK_POLICY.cooldownSeconds, 0, 86_400),
    maxQuoteAgeSeconds: clamp(policy.maxQuoteAgeSeconds, DEFAULT_TRADING_RISK_POLICY.maxQuoteAgeSeconds, 1, 3_600),
    allowedSymbols: symbols,
    requireKnownPortfolioForLive: policy.requireKnownPortfolioForLive !== false,
    requirePlanForLive: policy.requirePlanForLive !== false,
  };
}

function check(input: Omit<TradeRiskCheck, "status"> & { status?: TradeRiskCheck["status"] }): TradeRiskCheck {
  return { ...input, status: input.status ?? "pass" };
}

function modeStatus(mode: TradingExecutionMode, unsafe: boolean): TradeRiskCheck["status"] {
  if (!unsafe) return "pass";
  return mode === "live" ? "block" : "warn";
}

function addsExposure(proposal: TradeProposal) {
  if (proposal.reduceOnly) return false;
  return proposal.side === "buy" || proposal.side === "long" || proposal.side === "yes" || proposal.side === "add" || proposal.side === "swap";
}

function asIso(now: number) {
  return new Date(now).toISOString();
}

export function evaluateTradingRisk(input: {
  proposal: TradeProposal;
  policy?: Partial<TradingRiskPolicy>;
  executionMode: TradingExecutionMode;
  recentPlans?: TradePlan[];
  now?: number;
}): TradeRiskEvaluation {
  const policy = normalizeTradingRiskPolicy(input.policy);
  const proposal = input.proposal;
  const mode = input.executionMode;
  const now = input.now ?? Date.now();
  const checks: TradeRiskCheck[] = [];
  const missingContext: string[] = [];
  const asset = String(proposal.asset || "").trim().toUpperCase();
  const notionalUsd = finite(proposal.notionalUsd) ?? 0;

  checks.push(check({
    id: "notional",
    label: "Order amount",
    status: notionalUsd > 0 ? "pass" : "block",
    detail: notionalUsd > 0 ? `Order notional is $${notionalUsd.toFixed(2)}.` : "Enter a positive order amount before review.",
    actual: notionalUsd,
    limit: "> 0",
  }));

  const allowlistActive = policy.allowedSymbols.length > 0;
  const symbolAllowed = !allowlistActive || policy.allowedSymbols.includes(asset);
  checks.push(check({
    id: "symbol-allowlist",
    label: "Allowed asset",
    status: modeStatus(mode, !symbolAllowed),
    detail: symbolAllowed
      ? allowlistActive ? `${asset} is in the configured allowlist.` : "No asset allowlist is active."
      : `${asset || "This asset"} is not in the configured allowlist.`,
    actual: asset || "missing",
    limit: allowlistActive ? policy.allowedSymbols.join(", ") : "any",
  }));

  const portfolio = proposal.portfolio;
  const hasKnownPortfolio = Boolean(
    portfolio
    && Number.isFinite(portfolio.totalValueUsd)
    && portfolio.totalValueUsd > 0
    && Number.isFinite(portfolio.currentAssetValueUsd),
  );
  if (!hasKnownPortfolio && addsExposure(proposal)) missingContext.push("Current portfolio value and asset exposure");
  const projectedAssetValue = hasKnownPortfolio
    ? Math.max(0, Number(portfolio!.currentAssetValueUsd) + (addsExposure(proposal) ? notionalUsd : -notionalUsd))
    : undefined;
  const projectedPositionPct = projectedAssetValue !== undefined
    ? projectedAssetValue / Number(portfolio!.totalValueUsd) * 100
    : undefined;
  const exposureUnknownUnsafe = addsExposure(proposal) && !hasKnownPortfolio && policy.requireKnownPortfolioForLive;
  const positionUnsafe = exposureUnknownUnsafe || (projectedPositionPct !== undefined && projectedPositionPct > policy.maxPositionPct + 1e-9);
  checks.push(check({
    id: "position-size",
    label: "Projected position size",
    status: modeStatus(mode, positionUnsafe),
    detail: projectedPositionPct === undefined
      ? addsExposure(proposal)
        ? "Projected position size cannot be estimated from the available portfolio data."
        : "This order reduces exposure, so an added-position estimate is not required."
      : `Projected ${asset} exposure is ${projectedPositionPct.toFixed(1)}% of the portfolio.`,
    actual: projectedPositionPct === undefined ? "unknown" : Number(projectedPositionPct.toFixed(2)),
    limit: policy.maxPositionPct,
  }));

  const concentrationUnsafe = projectedPositionPct !== undefined && projectedPositionPct > policy.maxConcentrationPct + 1e-9;
  checks.push(check({
    id: "concentration",
    label: "Portfolio concentration",
    status: modeStatus(mode, concentrationUnsafe),
    detail: projectedPositionPct === undefined
      ? "Concentration will be shown after the portfolio context is available."
      : `The resulting single-asset concentration is ${projectedPositionPct.toFixed(1)}%.`,
    actual: projectedPositionPct === undefined ? "unknown" : Number(projectedPositionPct.toFixed(2)),
    limit: policy.maxConcentrationPct,
  }));

  const leverage = finite(proposal.leverage);
  const leverageRequired = proposal.assetClass === "perp";
  if (leverageRequired && leverage === undefined) missingContext.push("Requested leverage");
  const leverageUnsafe = (leverageRequired && leverage === undefined) || (leverage !== undefined && leverage > policy.maxLeverage + 1e-9);
  checks.push(check({
    id: "leverage",
    label: "Leverage",
    status: modeStatus(mode, leverageUnsafe),
    detail: leverage === undefined
      ? leverageRequired ? "Leverage is missing for this perpetual order." : "This order does not require leverage."
      : `${leverage.toFixed(2)}× requested leverage.`,
    actual: leverage ?? "not applicable",
    limit: policy.maxLeverage,
  }));

  const dailyPnl = finite(portfolio?.dailyPnlPct);
  const dailyLossUnsafe = dailyPnl !== undefined && dailyPnl < -policy.maxDailyLossPct;
  checks.push(check({
    id: "daily-loss",
    label: "Daily loss limit",
    status: modeStatus(mode, dailyLossUnsafe),
    detail: dailyPnl === undefined ? "Daily P&L is not reported by this account." : `Account daily P&L is ${dailyPnl.toFixed(2)}%.`,
    actual: dailyPnl ?? "unavailable",
    limit: `-${policy.maxDailyLossPct}%`,
  }));

  const drawdown = finite(portfolio?.drawdownPct);
  const drawdownUnsafe = drawdown !== undefined && drawdown > policy.maxDrawdownPct;
  checks.push(check({
    id: "drawdown",
    label: "Drawdown limit",
    status: modeStatus(mode, drawdownUnsafe),
    detail: drawdown === undefined ? "Drawdown is not reported by this account." : `Current drawdown is ${drawdown.toFixed(2)}%.`,
    actual: drawdown ?? "unavailable",
    limit: policy.maxDrawdownPct,
  }));

  const slippage = finite(proposal.quote?.slippageBps);
  if (slippage === undefined && proposal.orderType === "market") missingContext.push("Quoted or bounded slippage");
  const slippageUnsafe = proposal.orderType === "market"
    && (slippage === undefined || slippage > policy.maxSlippageBps);
  checks.push(check({
    id: "slippage",
    label: "Slippage",
    status: modeStatus(mode, slippageUnsafe),
    detail: proposal.orderType !== "market"
      ? "The order uses an explicit price condition instead of an unbounded market fill."
      : slippage === undefined
        ? "Market-order slippage is not bounded by the available quote."
        : `Quoted maximum slippage is ${(slippage / 100).toFixed(2)}%.`,
    actual: slippage ?? "unknown",
    limit: policy.maxSlippageBps,
  }));

  const liquidity = finite(proposal.quote?.liquidityUsd);
  const liquidityRequired = policy.minLiquidityUsd > 0;
  if (liquidityRequired && liquidity === undefined) missingContext.push("Market liquidity");
  const liquidityUnsafe = liquidityRequired && (liquidity === undefined || liquidity < policy.minLiquidityUsd);
  checks.push(check({
    id: "liquidity",
    label: "Market liquidity",
    status: modeStatus(mode, liquidityUnsafe),
    detail: !liquidityRequired
      ? "No minimum-liquidity rule is active."
      : liquidity === undefined
        ? "Liquidity is unavailable for this quote."
        : `Reported liquidity is $${liquidity.toLocaleString(undefined, { maximumFractionDigits: 0 })}.`,
    actual: liquidity ?? "unknown",
    limit: policy.minLiquidityUsd,
  }));

  const capturedAtMs = proposal.quote?.capturedAt ? Date.parse(proposal.quote.capturedAt) : Number.NaN;
  const quoteAgeSeconds = Number.isFinite(capturedAtMs) ? Math.max(0, (now - capturedAtMs) / 1_000) : undefined;
  if (quoteAgeSeconds === undefined) missingContext.push("Quote timestamp");
  const quoteUnsafe = quoteAgeSeconds === undefined || quoteAgeSeconds > policy.maxQuoteAgeSeconds;
  checks.push(check({
    id: "quote-age",
    label: "Quote freshness",
    status: modeStatus(mode, quoteUnsafe),
    detail: quoteAgeSeconds === undefined
      ? "The quote does not include a valid timestamp."
      : `The quote is ${quoteAgeSeconds.toFixed(0)} seconds old.`,
    actual: quoteAgeSeconds === undefined ? "unknown" : Number(quoteAgeSeconds.toFixed(1)),
    limit: policy.maxQuoteAgeSeconds,
  }));

  const lastExecutionAt = (input.recentPlans ?? [])
    .filter((plan) => plan.proposal.accountId === proposal.accountId && plan.proposal.asset.toUpperCase() === asset && plan.execution?.submittedAt)
    .map((plan) => Date.parse(plan.execution!.submittedAt))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  const secondsSince = lastExecutionAt === undefined ? undefined : Math.max(0, (now - lastExecutionAt) / 1_000);
  const cooldownUnsafe = secondsSince !== undefined && secondsSince < policy.cooldownSeconds;
  checks.push(check({
    id: "cooldown",
    label: "Trade cooldown",
    status: modeStatus(mode, cooldownUnsafe),
    detail: secondsSince === undefined
      ? "No recent matching execution was found."
      : `${secondsSince.toFixed(0)} seconds since the last ${asset} execution on this account.`,
    actual: secondsSince === undefined ? "clear" : Number(secondsSince.toFixed(1)),
    limit: policy.cooldownSeconds,
  }));

  const blocked = checks.filter((item) => item.status === "block");
  const warnings = checks.filter((item) => item.status === "warn");
  const decision = blocked.length ? "block" : "allow";
  const summary = blocked.length
    ? blocked[0]!.detail
    : warnings.length
      ? `${warnings.length} risk warning${warnings.length === 1 ? "" : "s"} will remain visible in ${mode} mode.`
      : "All configured trading-risk checks passed.";
  const evidence = checks
    .filter((item) => item.status !== "pass" || ["position-size", "slippage", "quote-age"].includes(item.id))
    .map((item) => `${item.label}: ${item.detail}`)
    .slice(0, 8);

  return {
    decision,
    summary,
    evaluatedAt: asIso(now),
    policyVersion: 1,
    checks,
    reasoning: {
      headline: decision === "block" ? "This trade plan is blocked before execution." : "This trade plan is ready for review.",
      summary,
      whyNow: `The plan was evaluated for ${mode === "live" ? "live execution" : `${mode} mode`} before it could continue.`,
      impact: decision === "block"
        ? "No order can be submitted from this plan until the blocking inputs or policy change."
        : mode === "live"
          ? "Approval can allow the existing governed rail to submit this order."
          : "No real funds can move in this mode.",
      requestedAction: decision === "block" ? "Resolve every blocked check, then create a fresh review." : "Review the order, account, quote, and evidence before approving.",
      evidence,
      missingContext: Array.from(new Set(missingContext)),
      nextSteps: decision === "block" ? ["Refresh the quote and portfolio context.", "Reduce the order or adjust the reviewed policy if intended."] : ["Approve, reject, or leave the plan in review."],
      source: "Trading risk policy",
    },
  };
}
