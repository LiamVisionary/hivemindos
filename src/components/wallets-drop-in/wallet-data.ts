/* eslint-disable */
// @ts-nocheck
export const FR_MACHINES = [];
export const FR_CCY = {
  USD:   { price: 1,    fiat: true, name: "US Dollar", color: "#3b9e6f", chg: 0 },
  USDC:  { price: 1,    name: "USD Coin",  color: "#2775ca", chg: 0.02 },
  ETH:   { price: 3200, name: "Ethereum",  color: "#627eea", chg: 2.48 },
  SOL:   { price: 0,    name: "Solana",    color: "#14f195", chg: 0 },
  BANKR: { price: 0.05, name: "Bankr",     color: "#8b5cf6", chg: 4.1 },
  HIVE:  { price: 0.34, name: "Hive",      color: "#0e1118", chg: 28.4, img: "/hive-icon.png" },
};
export let FR_HONEY_ENABLED = true;
let FR_RUNTIME_APPLIED = false;
export const FR_BALANCES = {};
export function frFmtAmount(sym, amt) {
  const m = FR_CCY[sym];
  if (!Number.isFinite(amt) || amt <= 0) return "0";
  if (sym === "ETH") return amt.toFixed(2);
  if (m && m.fiat) return "$" + Math.round(amt).toLocaleString();
  if (amt < 1) return amt.toLocaleString(undefined, { maximumFractionDigits: 6 });
  if (amt >= 10000) return Math.round(amt / 1000) + "k";
  if (amt >= 1000 && sym !== "USDC") return (amt / 1000).toFixed(1) + "k";
  return Math.round(amt).toLocaleString();
}
export function frFmtUsd(v) {
  if (v >= 1000) return "$" + (v / 1000).toFixed(1) + "k";
  return "$" + Math.round(v);
}
export function frFmtUsdFull(v) {
  if (v >= 1000) return "$" + Math.round(v).toLocaleString();
  return "$" + v.toFixed(2);
}
export function frFmtChange(usdChg) {
  const sign = usdChg < 0 ? "-" : "+";
  const abs = Math.abs(usdChg);
  if (abs === 0) return { text: "$0.00", color: "var(--fg-4)" };
  if (abs < 0.01) return { text: sign + "<$0.01", color: usdChg < 0 ? "var(--danger)" : "var(--live)" };
  const v = abs >= 1000 ? Math.round(abs).toLocaleString() : abs.toFixed(2);
  return { text: sign + "$" + v, color: usdChg < 0 ? "var(--danger)" : "var(--live)" };
}
export function frTopBalances(agentId, n = 4) {
  const raw = FR_BALANCES[agentId] || [];
  const list = raw
    .map(([sym, amount]) => {
      const usd = amount * ((FR_CCY[sym] || {}).price || 0);
      return { sym, amount, usd, change: usd * ((FR_CCY[sym] || {}).chg || 0) / 100 };
    })
    .filter((b) => b.amount > 0)
    .sort((a, b) => b.usd - a.usd);
  return { top: list.slice(0, n), total: list.reduce((s, b) => s + b.usd, 0) };
}
export const FR_STATE = {
  working:   { label: "Working",   color: "var(--live)",   live: true },
  ready:     { label: "Ready",     color: "var(--fg-3)",   live: false },
  scheduled: { label: "Scheduled", color: "var(--honey)",  live: false },
  setup:     { label: "Setup",     color: "var(--honey)",  live: false },
  failed:    { label: "Failed",    color: "var(--danger)", live: false },
};
export function frStateMeta(s) { return FR_STATE[s] || FR_STATE.ready; }
export function frFleetSummary(machines) {
  const agents = machines.reduce((n, m) => n + m.agents.length, 0);
  const working = machines.reduce((n, m) => n + m.agents.filter((a) => a.state === "working").length, 0);
  const attention = machines.reduce(
    (n, m) => n + m.agents.filter((a) => a.state === "failed" || a.state === "setup").length
      + (m.versionState === "needs-setup" ? 1 : 0), 0);
  return { machines: machines.length, agents, working, attention };
}
export function frMachineState(m) {
  if (m.agents.some((a) => a.state === "failed")) return "failed";
  if (m.versionState === "needs-setup" || m.agents.some((a) => a.state === "setup")) return "setup";
  if (m.agents.some((a) => a.state === "working")) return "working";
  return "ready";
}
export const FR_WALLET_PANELS = [
  { id: "agents",   label: "Agents",   title: "Agent wallets", subtitle: "every agent's purse, its runway, and what it may spend" },
  { id: "holdings", label: "Holdings", title: "Agent Treasury holdings", subtitle: "the whole fleet's balance, by token" },
  { id: "activity", label: "Activity", title: "Payment activity", subtitle: "what the agents have been paying for" },
  { id: "usage",    label: "Usage",    title: "Runtime usage", subtitle: "tokens and compute spend, by agent and model" },
  { id: "honey",    label: "Honey",    title: "Honey ledger", subtitle: "rewards earned for useful work — and where they went" },
  { id: "rails",    label: "Rails",    title: "Payment rails", subtitle: "the channels each agent can move money through" },
];
export const FR_MODELS = {
  Hermes: "claude-sonnet-4", OpenClaw: "gpt-4o", Aeon: "claude-haiku", MiroShark: "miroshark-sim",
  Codex: "gpt-4o-mini", Gemini: "gemini-1.5-pro", Syncthing: "—",
};
export function frModelFor(rt) { return FR_MODELS[rt] || "—"; }
export const FR_USAGE_SERIES = [];
export const FR_USAGE_ROWS = [];
export function frUsage() {
  if (FR_RUNTIME_APPLIED) return FR_USAGE_ROWS.slice().sort((a, b) => b.today - a.today);
  return frWallets().filter((w) => !w.meta.setup).map((w) => ({
    id: w.id, name: w.name, runtime: w.runtime, machine: w.machine, state: w.state,
    model: frModelFor(w.runtime), tokens: w.rewards.used, today: w.meta.enabled ? w.meta.burn : 0,
    enabled: w.meta.enabled,
  })).sort((a, b) => b.today - a.today);
}
export const FR_HONEY_LEDGER = [];
export const FR_HONEY_BY_AGENT = [];
export let FR_HONEY_SUMMARY = null;
export const FR_HONEY_KIND = {
  earn:    { icon: "sparkles", label: "Earned",    tone: "var(--honey)" },
  redeem:  { icon: "spark",    label: "Redeemed",  tone: "var(--fg-2)" },
  convert: { icon: "repeat",   label: "Converted", tone: "var(--live)" },
};
export function frHoneySummary() {
  if (FR_RUNTIME_APPLIED && FR_HONEY_SUMMARY) return FR_HONEY_SUMMARY;
  const ws = frWallets();
  const balance = ws.reduce((s, w) => s + (w.meta.honey || 0), 0);
  const earned = FR_HONEY_LEDGER.filter((e) => e.amt > 0).reduce((s, e) => s + e.amt, 0);
  const out = FR_HONEY_LEDGER.filter((e) => e.amt < 0).reduce((s, e) => s + e.amt, 0);
  const billed = ws.reduce((s, w) => s + (w.rewards.used || 0), 0);
  return { balance, earned, redeemed: Math.abs(out), billed, holders: ws.filter((w) => (w.meta.honey || 0) > 0).length };
}
export function frHoneyByAgent() {
  if (FR_RUNTIME_APPLIED) return FR_HONEY_BY_AGENT.slice().sort((a, b) => b.honey - a.honey);
  return frWallets().filter((w) => (w.meta.honey || 0) > 0)
    .map((w) => ({ id: w.id, name: w.name, runtime: w.runtime, honey: w.meta.honey, billed: w.rewards.used, state: w.state }))
    .sort((a, b) => b.honey - a.honey);
}
export const FR_USEPOD = {
  status: "unknown", models: 0, route: "Not checked", tokenEnv: "USEPOD_TOKEN",
  tokenFp: "Missing", tokenSource: "Shared env", fundingRef: "Not available",
  compat: [
    { id: "openai",    label: "OpenAI-compatible",    base: "https://api.usepod.ai/v1", endpoints: "/chat/completions · /models" },
    { id: "anthropic", label: "Anthropic-compatible", base: "https://api.usepod.ai/anthropic", endpoints: "/v1/messages" },
  ],
  routing: [
    { id: "auto",        label: "Auto (price-ceiling)", sub: "Cheapest route under your price caps." },
    { id: "marketplace", label: "Marketplace-only",     sub: "Documented mode; proxy publishes price headers only." },
  ],
  inCap: "1.20 / 1M", outCap: "4.00 / 1M",
};
export const FR_MONEYCLAW_ENV = "MONEYCLAW_API_KEY";
export const FR_MY_WALLETS = [];
export function frMyRanked(w) {
  const list = (w.holdings || []).map(([sym, amount]) => {
    const m = FR_CCY[sym] || {};
    const usd = amount * (m.price || 0);
    return { sym, amount, usd, change: (usd * (m.chg || 0)) / 100 };
  }).filter((b) => b.amount > 0).sort((a, b) => b.usd - a.usd);
  return { top: list, total: list.reduce((s, b) => s + b.usd, 0) };
}
export function frMyWalletsTotal() { return FR_MY_WALLETS.reduce((s, w) => s + frMyRanked(w).total, 0); }
export function frNetworkLabel(net) {
  switch (net) {
    case "base": return "Base mainnet";
    case "base-sepolia": return "Base Sepolia";
    case "solana": return "Solana mainnet";
    default: return net;
  }
}
export const FR_WALLET_META = {};
export function frShortAddr(a) { return !a ? "" : a.length <= 14 ? a : a.slice(0, 6) + "…" + a.slice(-4); }
export const FR_WALLET_REWARDS = {};
export function frApplyRuntimeWalletData(data) {
  if (!data || !Array.isArray(data.machines)) return;
  FR_RUNTIME_APPLIED = true;
  if (data.tokenPrices && typeof data.tokenPrices === "object") {
    Object.entries(data.tokenPrices).forEach(([sym, info]) => {
      const symbol = String(sym || "").toUpperCase();
      const price = Number(info && info.price);
      if (!symbol || !Number.isFinite(price) || price < 0) return;
      FR_CCY[symbol] = {
        ...(FR_CCY[symbol] || { name: symbol, color: "var(--fg-3)", chg: 0 }),
        ...(info || {}),
        price,
      };
    });
  }
  FR_MACHINES.splice(0, FR_MACHINES.length, ...data.machines);
  if (Array.isArray(data.myWallets)) FR_MY_WALLETS.splice(0, FR_MY_WALLETS.length, ...data.myWallets);
  for (const key of Object.keys(FR_WALLET_META)) delete FR_WALLET_META[key];
  Object.assign(FR_WALLET_META, data.walletMeta || {});
  for (const key of Object.keys(FR_BALANCES)) delete FR_BALANCES[key];
  Object.assign(FR_BALANCES, data.balances || {});
  for (const key of Object.keys(FR_WALLET_REWARDS)) delete FR_WALLET_REWARDS[key];
  Object.assign(FR_WALLET_REWARDS, data.rewards || {});
  FR_LEDGER.splice(0, FR_LEDGER.length, ...(Array.isArray(data.activityLedger) ? data.activityLedger : []));
  FR_USAGE_SERIES.splice(0, FR_USAGE_SERIES.length, ...(Array.isArray(data.usageSeries) ? data.usageSeries : []));
  FR_USAGE_ROWS.splice(0, FR_USAGE_ROWS.length, ...(Array.isArray(data.usageRows) ? data.usageRows : []));
  FR_HONEY_LEDGER.splice(0, FR_HONEY_LEDGER.length, ...(Array.isArray(data.honeyLedger) ? data.honeyLedger : []));
  FR_HONEY_BY_AGENT.splice(0, FR_HONEY_BY_AGENT.length, ...(Array.isArray(data.honeyByAgent) ? data.honeyByAgent : []));
  FR_HONEY_SUMMARY = data.honeySummary || null;
  if (data.railOverrides && typeof data.railOverrides === "object") {
    FR_RAIL_CONFIG.forEach((rail) => {
      const override = data.railOverrides[rail.id];
      if (typeof override === "boolean") rail.enabled = override;
      else if (override && typeof override === "object") Object.assign(rail, override);
    });
  }
  if (data.usePod && typeof data.usePod === "object") Object.assign(FR_USEPOD, data.usePod);
  if (typeof data.usePodRoutingMode === "string" && data.usePodRoutingMode.trim()) FR_USEPOD.routingMode = data.usePodRoutingMode.trim();
  if (typeof data.honeyLedgerEnabled === "boolean") FR_HONEY_ENABLED = data.honeyLedgerEnabled;
}
export function frBarColor(sym) { return sym === "HIVE" ? "var(--honey)" : (FR_CCY[sym] || {}).color || "var(--fg-4)"; }
export const FR_PROVIDER = {
  bankr:  { label: "Bankr trading", rail: "Base mainnet · trading broker" },
  usepod: { label: "UsePod prepaid", rail: "Solana USDC · provider-managed x402" },
  veil:   { label: "Veil smart wallet", rail: "Base mainnet · private self-custody" },
  venice: { label: "Venice private inference", rail: "Private inference · token spend" },
  x402:   { label: "x402 local wallet", rail: "HTTP 402 · pay-per-call" },
  crypto: { label: "Local USDC wallet", rail: "Base mainnet · self-custody" },
  manual: { label: "Manual ledger", rail: "Tracked manually · no direct send" },
  cards:  { label: "MoneyClaw card", rail: "Virtual card · USD" },
};
export function frWallets() {
  const out = [];
  FR_MACHINES.forEach((m) => {
    m.agents.forEach((a) => {
      const meta = FR_WALLET_META[a.id] || {};
      const { top, total } = frTopBalances(a.id, 12);
      const liquid = top.filter((b) => b.sym === "USDC" || b.sym === "USD").reduce((s, b) => s + b.usd, 0);
      const change = top.reduce((s, b) => s + b.change, 0);
      const runway = meta.enabled && meta.burn > 0 ? total / meta.burn : null;
      const rewards = FR_WALLET_REWARDS[a.id] || { gas: 0, used: 0 };
      const railId = frAgentRail(meta.provider || "crypto");
      const policy = {
        dailyBudget: Number(meta.dailyBudget ?? Math.round(Math.max(meta.burn * 2, meta.maxPay))) || 0,
        monthlyBudget: Number(meta.monthlyBudget ?? Math.round(Math.max(meta.burn * 2, meta.maxPay) * 20)) || 0,
        custody: meta.provider === "usepod" ? "Provider-managed" : meta.provider === "cards" ? "Custodial" : "Self-custody · session keys",
        dupGuard: meta.duplicateGuard !== false,
      };
      out.push({
        ...a, machine: m.name, meta,
        holdings: top, total, liquid, change, runway, rewards, railId, policy,
        provider: meta.provider || "crypto",
      });
    });
  });
  return out.sort((left, right) => {
    const leftTier = Number(left.meta?.sortTier ?? 1);
    const rightTier = Number(right.meta?.sortTier ?? 1);
    return leftTier - rightTier
      || String(left.name || left.id).localeCompare(String(right.name || right.id), undefined, { sensitivity: "base" })
      || String(left.id).localeCompare(String(right.id), undefined, { sensitivity: "base" });
  });
}
export function frRunway(w) {
  if (w.meta.setup) return { tone: "muted", text: "Needs setup" };
  if (!w.meta.enabled) return { tone: "muted", text: "Spend off" };
  if (w.state === "failed" || w.meta.alert) return { tone: "danger", text: "Rail blocked" };
  if (w.runway == null) return { tone: "muted", text: "No estimate" };
  if (w.runway < 3) return { tone: "danger", text: w.runway.toFixed(1) + "d left" };
  if (w.runway < 10) return { tone: "warn", text: w.runway.toFixed(0) + "d left" };
  return { tone: "ok", text: w.runway.toFixed(0) + "d runway" };
}
export function frWalletSummary() {
  const ws = frWallets();
  const total = ws.reduce((s, w) => s + w.total, 0);
  const onCount = ws.filter((w) => w.meta.enabled && !w.meta.setup).length;
  const tend = ws.filter((w) => w.meta.setup || w.state === "failed" || w.meta.alert || (w.runway != null && w.runway < 3)).length;
  return { total, wallets: ws.length, on: onCount, tend, change: ws.reduce((s, w) => s + w.change, 0) };
}
export function frTokenRollup() {
  const acc = {};
  Object.keys(FR_BALANCES).forEach((id) => {
    (FR_BALANCES[id] || []).forEach(([sym, amount]) => {
      const m = FR_CCY[sym] || {};
      const usd = amount * (m.price || 0);
      acc[sym] = acc[sym] || { sym, amount: 0, usd: 0, holders: 0 };
      acc[sym].amount += amount; acc[sym].usd += usd; acc[sym].holders += amount > 0 ? 1 : 0;
    });
  });
  const list = Object.values(acc).filter((t) => t.usd > 0).sort((a, b) => b.usd - a.usd);
  list.forEach((t) => { t.change = (t.usd * ((FR_CCY[t.sym] || {}).chg || 0)) / 100; });
  return list;
}
export const FR_RAIL_CONFIG = [
  { id: "moneyclaw", icon: "doc",    name: "MoneyClaw", kind: "Cards",             enabled: false, setup: "needs",    env: "MONEYCLAW_API_KEY", cred: false, network: "—",              baseUrl: "api.moneyclaw.com",     caps: ["Virtual cards", "SaaS checkout", "USD"],         health: "Missing MONEYCLAW_API_KEY", blurb: "Virtual cards for SaaS subscriptions and API checkouts." },
  { id: "x402",      icon: "bot",    name: "x402",      kind: "Pay-per-call",      enabled: true,  setup: "ready",    env: "—",                 cred: true,  network: "Base · Solana",  baseUrl: "—",                     caps: ["HTTP 402", "Per-call settle", "Spend caps"],     health: "Operational",        blurb: "Pay-per-call HTTP 402 settlement, bounded by each agent's caps." },
  { id: "veil",      icon: "shield", name: "Veil",      kind: "Smart wallet",      enabled: false, setup: "needs",    env: "VEIL_KEY",          cred: false, network: "Base mainnet",   baseUrl: "—",                     caps: ["Self-custody", "Session keys", "USDC + ETH"],    health: "Missing VEIL_KEY",    blurb: "Self-custody smart wallets with session-key spend caps." },
  { id: "usepod",    icon: "spark",  name: "UsePod",    kind: "Prepaid inference", enabled: false, setup: "needs",    env: "USEPOD_TOKEN",      cred: false, network: "Solana mainnet", baseUrl: "api.usepod.ai/v1",      caps: ["Models not checked", "Provider x402", "Price ceilings"], health: "Missing USEPOD_TOKEN", blurb: "Prepaid Solana USDC token covering inference and machine paywalls." },
  { id: "venice",    icon: "sparkles", name: "Venice",  kind: "Private inference", enabled: false, setup: "needs",    env: "VENICE_API_KEY",    cred: false, network: "—",              baseUrl: "api.venice.ai/v1",      caps: ["Private inference", "Uncensored"],               health: "Not connected",      blurb: "Privacy-first inference; pay per token. Add a key to enable." },
  { id: "bankr",     icon: "trade",  name: "Bankr",     kind: "Trading",           enabled: false, setup: "needs",    env: "BANKR_API_KEY",     cred: false, network: "Base mainnet",   baseUrl: "—",                     caps: ["Perps", "Spot", "Allowlist"],                    health: "Needs key + allowlist", blurb: "Market-making positions via a Bankr key and an allowlist." },
];
export function frRailCfg(id) { return FR_RAIL_CONFIG.find((r) => r.id === id); }
export function frRailReady(id) { const r = frRailCfg(id); return !!(r && r.enabled && r.setup === "ready"); }
export function frAgentRail(provider) {
  if (provider === "cards" || provider === "moneyclaw") return "moneyclaw";
  if (provider === "usepod") return "usepod";
  if (provider === "veil") return "veil";
  if (provider === "venice") return "venice";
  if (provider === "bankr") return "bankr";
  return "x402";
}
export function frRailAgents(railId) {
  return frWallets().filter((w) => {
    if (w.meta.setup) return false;
    return frAgentRail(w.provider) === railId || (railId === "bankr" && !!w.meta.trading);
  });
}
export const FR_LEDGER = [];
export const FR_LEDGER_TYPE = {
  x402:   { icon: "bot",     label: "x402" },
  trade:  { icon: "trade",   label: "Trade" },
  model:  { icon: "spark",   label: "Inference" },
  card:   { icon: "doc",     label: "Card" },
  send:   { icon: "promote", label: "Transfer" },
  topup:  { icon: "download",label: "Top-up" },
  reward: { icon: "sparkles",label: "Reward" },
};
