/* sim-data.ts — types, data, and derivations for the Simulation view.

   MiroShark is a "simulate anything" prediction-market + social engine. Each run
   is a scenario the swarm reacts to hour by hour: a prediction market it prices,
   a Twitter/Reddit thread it writes, a research brief it synthesizes, a
   market-making theater, or an ops failure storm.

   Prediction markets carry the practical payload: the question, the outcome
   buckets the swarm priced, which one it leans toward, where each agent placed
   its bet, and how the odds moved as news dropped. Swap this file for your live
   API and the UI follows. */

import type React from "react";

// ── types ────────────────────────────────────────────────────────────────
export type RunState = "live" | "ready" | "done" | "failed";
export type TemplateId = "polymarket" | "market-maker" | "x-thread" | "reddit-narrative" | "research-swarm" | "ops" | "custom";
export type Tone = "live" | "honey" | "danger" | "neutral";
export type Faction = "MM" | "TKR" | "INFO" | "OPS";

export interface Outcome { label: string; prob: number; crowd: number; lead?: boolean; won?: boolean; }
export interface Bet { bucket: string; n: number; }
export interface OddsPoint { r: number; p: number; event?: string; }
export interface Market {
  kind: "date" | "scalar" | "binary";
  question: string;
  subtitle: string;
  resolves: string;
  volume: string;
  traders: number;
  lean: { headline: string; conf: number; blurb: string; hit?: boolean };
  outcomes: Outcome[];
  bets: Bet[];
  history: OddsPoint[];
  edge: string;
}
export interface Run {
  id: string;
  template: TemplateId;
  state: RunState;
  title: string;
  started: string;
  duration?: string;
  rounds: number;
  currentRound: number;
  agents: number;
  news: number;
  posts: number;
  trades: number;
  sharpe?: number;
  pnl?: string;
  tags: string[];
  summary: string;
  market?: Market;
}
export interface MetricTile { k: string; v: React.ReactNode; tone?: Tone; }
export interface SwingAgent { name: string; note: string; }
export interface Intel { kind: "market" | "risk"; read: string; drivers: string[]; swing: SwingAgent[]; flipIf: string[]; }
export interface Agent { id: string; name: string; role: string; faction: Faction; ledger: string; status: "live" | "watch"; }
export interface Decision { who: string; role: Faction; action: string; detail: string; }
export interface XTweet { text: string; time?: string; stats: { reply: number; retweet: number; like: number; view?: number } }
export interface XThread { display: string; handle: string; tweets: XTweet[] }
export interface RedditReply { author: string; role?: Faction; score: number; time: string; body: string }
export interface RedditComment extends RedditReply { replies?: RedditReply[] }
export interface RedditPost { subreddit: string; author: string; title: string; body: string; score: number; comments: number; time: string; threads: RedditComment[] }
export interface Template { id: TemplateId; label: string; agents: number; desc: string }

// ── seeded rng + helpers ─────────────────────────────────────────────────
export function frRng(seed: number) {
  let a = seed | 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const frClamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export function frHash(str: string) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function frBuildTrend({ seed, n = 56, start = 0.2, end = 1.83, wobble = 0.12, dip = 0 }: {
  seed: number; n?: number; start?: number; end?: number; wobble?: number; dip?: number;
}): number[] {
  const r = frRng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const base = start + (end - start) * (1 - Math.pow(1 - f, 1.7));
    const d = dip ? -dip * Math.sin(f * Math.PI) : 0;
    out.push(Math.max(0, base + d + (r() - 0.5) * wobble * (0.4 + 0.6 * (1 - f))));
  }
  out[n - 1] = end;
  return out;
}

// ── run catalog ────────────────────────────────────────────────────────────
export const SW_RUNS: Run[] = [
  {
    id: "run-claude-fable", template: "polymarket", state: "live",
    title: "Claude 5 Fable · release-date market", started: "38m ago",
    rounds: 32, currentRound: 21, agents: 48, news: 71, posts: 1240, trades: 6820,
    tags: ["ai", "anthropic", "release-date"],
    summary: "48 agents price when Anthropic ships \u201CClaude 5 Fable.\u201D The swarm reads dev-day signals, changelog chatter and hiring posts, then places dated bets and updates hour by hour.",
    market: {
      kind: "date",
      question: "When will Anthropic release \u201CClaude 5 Fable\u201D?",
      subtitle: "Resolves to the bucket containing the public release date.",
      resolves: "Open \u00b7 resolves on announcement", volume: "$2.4M", traders: 48,
      lean: { headline: "Swarm leans toward Jul 30 \u2013 Aug 5", conf: 0.41, blurb: "After the dev-day teaser, the swarm pulled ~13 points of weight off \u201CAugust+\u201D and onto the late-July window. Conviction is moderate \u2014 no hard date is confirmed." },
      outcomes: [
        { label: "Jul 30 \u2013 Aug 5", prob: 0.41, crowd: 0.28, lead: true },
        { label: "Aug 6 \u2013 Aug 19", prob: 0.24, crowd: 0.22 },
        { label: "Jul 22 \u2013 Jul 29", prob: 0.18, crowd: 0.15 },
        { label: "Aug 20 or later", prob: 0.12, crowd: 0.27 },
        { label: "Before Jul 22", prob: 0.05, crowd: 0.08 },
      ],
      bets: [
        { bucket: "Jul 22", n: 1 }, { bucket: "Jul 25", n: 3 }, { bucket: "Jul 28", n: 5 },
        { bucket: "Jul 31", n: 11 }, { bucket: "Aug 3", n: 9 }, { bucket: "Aug 6", n: 7 },
        { bucket: "Aug 10", n: 5 }, { bucket: "Aug 15", n: 4 }, { bucket: "Aug 20+", n: 3 },
      ],
      history: [
        { r: 0, p: 0.28 }, { r: 3, p: 0.30 }, { r: 6, p: 0.31, event: "Hiring post: \u201Claunch eng, inference\u201D" },
        { r: 9, p: 0.33 }, { r: 12, p: 0.34 }, { r: 15, p: 0.39, event: "Dev-day teaser tweet" },
        { r: 18, p: 0.40 }, { r: 21, p: 0.41 },
      ],
      edge: "+13 pts vs crowd on the late-July window",
    },
  },
  {
    id: "run-spiderman-bo", template: "polymarket", state: "done",
    title: "Spider-Man: Brand New Day \u00b7 opening box office", started: "yesterday", duration: "1h 04m",
    rounds: 32, currentRound: 32, agents: 64, news: 88, posts: 2210, trades: 11200,
    tags: ["box-office", "marvel", "tracking"],
    summary: "64 agents \u2014 tracking-service personas, fandom accounts, exhibitor bots \u2014 price the domestic 3-day opening for Brand New Day off early tracking, trailer views and presale velocity.",
    market: {
      kind: "scalar",
      question: "Domestic opening-weekend (3-day) box office for Spider-Man: Brand New Day?",
      subtitle: "Resolves to the bucket containing the reported 3-day domestic gross.",
      resolves: "Resolved \u00b7 $214M actual", volume: "$3.8M", traders: 64,
      lean: { headline: "Swarm called >$200M \u2014 landed at $214M", conf: 0.46, blurb: "Presale velocity and 41M trailer views in 24h pushed the swarm above the $200M line three rounds before the crowd. The print confirmed it.", hit: true },
      outcomes: [
        { label: "> $200M", prob: 0.46, crowd: 0.31, lead: true, won: true },
        { label: "$150M \u2013 $200M", prob: 0.34, crowd: 0.39 },
        { label: "$100M \u2013 $150M", prob: 0.14, crowd: 0.20 },
        { label: "< $100M", prob: 0.06, crowd: 0.10 },
      ],
      bets: [
        { bucket: "<$100M", n: 4 }, { bucket: "$110M", n: 6 }, { bucket: "$135M", n: 9 },
        { bucket: "$160M", n: 12 }, { bucket: "$185M", n: 10 }, { bucket: "$205M", n: 14 },
        { bucket: "$230M", n: 7 }, { bucket: "$250M+", n: 2 },
      ],
      history: [
        { r: 0, p: 0.31 }, { r: 6, p: 0.33 }, { r: 10, p: 0.36, event: "Trailer: 41M views / 24h" },
        { r: 16, p: 0.40 }, { r: 22, p: 0.44, event: "Presales outpace No Way Home" },
        { r: 28, p: 0.46 }, { r: 32, p: 0.46 },
      ],
      edge: "Called >$200M \u00b7 resolved $214M",
    },
  },
  {
    id: "run-fed-july", template: "polymarket", state: "done",
    title: "Fed \u00b7 July FOMC rate-cut market", started: "2d ago", duration: "52m",
    rounds: 32, currentRound: 32, agents: 48, news: 64, posts: 1840, trades: 9420,
    tags: ["macro", "fed", "binary"],
    summary: "A binary on whether the Fed cuts \u226525bp at July FOMC. Trader, economist and journalist personas update odds as CPI, jobs and Fed-speak land.",
    market: {
      kind: "binary",
      question: "Will the Fed cut rates by \u226525bp at the July FOMC?",
      subtitle: "Resolves YES if the target range is lowered \u226525bp at the July meeting.",
      resolves: "Resolved \u00b7 NO (held)", volume: "$5.1M", traders: 48,
      lean: { headline: "Swarm settled NO at 64% \u2014 Fed held", conf: 0.64, blurb: "A hot CPI print flipped the swarm from a lean-YES into a firm NO by round 14. The crowd lagged. The Fed held.", hit: true },
      outcomes: [
        { label: "NO \u2014 holds", prob: 0.64, crowd: 0.52, lead: true, won: true },
        { label: "YES \u2014 cuts \u226525bp", prob: 0.36, crowd: 0.48 },
      ],
      bets: [
        { bucket: "YES 70\u00a2+", n: 3 }, { bucket: "YES 55\u201370\u00a2", n: 6 }, { bucket: "toss-up", n: 8 },
        { bucket: "NO 55\u201370\u00a2", n: 16 }, { bucket: "NO 70\u00a2+", n: 15 },
      ],
      history: [
        { r: 0, p: 0.55 }, { r: 4, p: 0.52 }, { r: 8, p: 0.44, event: "CPI 3.4% (exp 3.2%)" },
        { r: 12, p: 0.40 }, { r: 14, p: 0.36, event: "WSJ: \u201Cno rush on cuts\u201D" },
        { r: 20, p: 0.37 }, { r: 26, p: 0.36 }, { r: 32, p: 0.36 },
      ],
      edge: "Flipped to NO 8 rounds before the crowd",
    },
  },
  {
    id: "run-x-launch", template: "x-thread", state: "ready",
    title: "Launch thread \u00b7 v0.18.2 ship", started: "5m ago",
    rounds: 1, currentRound: 1, agents: 1, news: 0, posts: 4, trades: 0, tags: ["x", "announce"],
    summary: "A four-tweet thread announcing the v0.18.2 release. Drafted by the social bee, waiting on your approval before the autoposter publishes.",
  },
  {
    id: "run-nvda-reddit", template: "reddit-narrative", state: "done",
    title: "Subreddit narrative \u00b7 NVDA earnings", started: "yesterday", duration: "31m",
    rounds: 6, currentRound: 6, agents: 16, news: 9, posts: 412, trades: 1110, tags: ["reddit", "earnings"],
    summary: "A r/wallstreetbets-style narrative cascade pre/post NVDA earnings \u2014 measures how one seed comment propagates into a market-affecting consensus.",
  },
  {
    id: "run-tavily", template: "research-swarm", state: "done",
    title: "Tavily research \u2192 consensus brief", started: "12m ago", duration: "12m",
    rounds: 1, currentRound: 1, agents: 8, news: 27, posts: 0, trades: 0, tags: ["research", "obsidian"],
    summary: "Eight reading bees synthesize 27 Tavily results on the CPI print into a single Obsidian brief, ranked by memory-index similarity.",
  },
  {
    id: "run-vault", template: "ops", state: "failed",
    title: "Vault repair stress test", started: "2d ago", duration: "halted",
    rounds: 5, currentRound: 2, agents: 6, news: 0, posts: 0, trades: 0, tags: ["ops", "syncthing"],
    summary: "A synthetic conflict storm against the Obsidian vault sync. Failed on round 2 \u2014 rsync over Tailscale SSH gave up after 6 retries. Vault left consistent; no writes lost.",
  },
];

// ── market-making live-run detail (the theater) ─────────────────────────────
export const SW_AGENTS: Agent[] = [
  { id: "ag-1", name: "Apis-\u03B1", role: "Market maker", faction: "MM", ledger: "+0.41%", status: "live" },
  { id: "ag-2", name: "Forager-2", role: "Liquidity taker", faction: "TKR", ledger: "-0.12%", status: "live" },
  { id: "ag-3", name: "Drone-7", role: "News reader", faction: "INFO", ledger: "+0.06%", status: "live" },
  { id: "ag-4", name: "Scout-3", role: "Narrative seed", faction: "INFO", ledger: "+0.18%", status: "live" },
  { id: "ag-5", name: "Pollen-9", role: "Macro hedger", faction: "MM", ledger: "+0.27%", status: "live" },
  { id: "ag-6", name: "Worker-12", role: "Whale follower", faction: "TKR", ledger: "-0.04%", status: "live" },
  { id: "ag-7", name: "Sentry-\u03B1", role: "Risk monitor", faction: "OPS", ledger: "\u2014", status: "watch" },
  { id: "ag-8", name: "Apis-\u03B2", role: "Market maker", faction: "MM", ledger: "+0.31%", status: "live" },
];
export const SW_DECISIONS: Decision[] = [
  { who: "Apis-\u03B1", role: "MM", action: "QUOTE", detail: "bid 110.13 \u00d7 50 \u00b7 ask 110.16 \u00d7 50 \u00b7 spread 1.5bp" },
  { who: "Drone-7", role: "INFO", action: "READ", detail: "Reuters \u00b7 Fed speaks at 14:00 ET" },
  { who: "Pollen-9", role: "MM", action: "HEDGE", detail: "buy 12 EDZ6 @ 95.20 (cover macro tail)" },
  { who: "Forager-2", role: "TKR", action: "SWEEP", detail: "take 240 @ 110.10 (cross MM ladder)" },
  { who: "Scout-3", role: "INFO", action: "POST", detail: "narrative: 'sticky inflation, Fed stays high'" },
  { who: "Apis-\u03B2", role: "MM", action: "REQUOTE", detail: "shift midpoint -2bp on Forager sweep" },
  { who: "Sentry-\u03B1", role: "OPS", action: "FLAG", detail: "MM book delta breaches 2\u03C3 (warn only)" },
  { who: "Drone-7", role: "INFO", action: "READ", detail: "Bloomberg \u00b7 10Y yield approaches 4.30%" },
];
export const SW_MARKET = {
  symbol: "ZN1 \u00b7 10Y T-Note futures",
  ticks: [110.8, 110.6, 110.4, 110.5, 110.3, 110.1, 109.9, 110.0, 109.8, 109.95, 110.05, 110.15, 110.0, 109.85, 109.7, 109.9, 110.05, 110.2, 110.1, 110.0, 109.95, 110.1, 110.25, 110.3],
  ladder: [
    { px: 110.30, bid: 412, ask: null }, { px: 110.28, bid: 380, ask: null }, { px: 110.25, bid: 318, ask: null },
    { px: 110.23, bid: 240, ask: null }, { px: 110.20, bid: null, ask: 0 }, { px: 110.18, bid: null, ask: 286 },
    { px: 110.15, bid: null, ask: 412 }, { px: 110.13, bid: null, ask: 540 }, { px: 110.10, bid: null, ask: 612 },
  ] as { px: number; bid: number | null; ask: number | null }[],
  headlines: [
    { t: "00:42", body: "CPI 3.4% (exp 3.2%) \u2014 Treasuries sell off", tone: "bear" },
    { t: "00:58", body: "WSJ: Fed officials say no rush on cuts", tone: "bull" },
    { t: "01:14", body: "Apis-\u03B1 widens 10Y bid-ask to 1.5bp", tone: "neutral" },
    { t: "01:32", body: "Pollen-9 stops out short \u2014 covers 240 lots", tone: "bull" },
    { t: "02:02", body: "Forager-2 sweeps liquidity at 110.10", tone: "bear" },
  ] as { t: string; body: string; tone: "bull" | "bear" | "neutral" }[],
};
export const SW_ROUND_TABLE = [
  { round: 8408, pnl: "+0.31%", sharpe: "1.80", pos: "+1.4M" },
  { round: 8409, pnl: "+0.39%", sharpe: "1.80", pos: "+1.4M" },
  { round: 8410, pnl: "+0.42%", sharpe: "1.81", pos: "+1.4M" },
  { round: 8411, pnl: "+0.19%", sharpe: "1.84", pos: "+1.4M" },
  { round: 8412, pnl: "-0.04%", sharpe: "1.83", pos: "+1.3M" },
];

// ── per-run X thread + Reddit content ───────────────────────────────────────
export const SW_THREADS: Record<string, XThread> = {
  "run-x-launch": {
    display: "HivemindOS", handle: "hivemindos",
    tweets: [
      { text: "shipping v0.18.2 today\n\nthe hive is humming \u2014 every bee on the fleet is now reachable over your private tailnet, no public ports, no exposed agents.", time: "12:42 PM \u00b7 May 21, 2026", stats: { reply: 18, retweet: 41, like: 312, view: 22431 } },
      { text: "1/ what's new\n\n\u2014 honeycomb fleet view (tessellated agent map)\n\u2014 bee-themed kanban with live agent streams\n\u2014 x-channel auth flow rewrite (no more 401 loops)", stats: { reply: 4, retweet: 9, like: 86 } },
      { text: "2/ if you're new here, hivemindos is one private control room for every agent you run.\n\nhermes \u00b7 openclaw \u00b7 aeon \u00b7 miroshark \u00b7 gemini \u2014 they all show up as bees on one comb.", stats: { reply: 2, retweet: 6, like: 51 } },
      { text: "3/ try it:\n\ngit clone github.com/LiamVisionary/hivemindos\ncd hivemindos\n./setup.sh\n\nopens at localhost:5020 \u2728", stats: { reply: 7, retweet: 14, like: 198 } },
    ],
  },
};
export const SW_REDDIT: Record<string, RedditPost> = {
  "run-nvda-reddit": {
    subreddit: "wallstreetbets", author: "u/scout-3",
    title: "NVDA earnings tomorrow \u2014 what if guidance is the surprise?",
    body: "Just got 3000 shares at $812. Bull case is well-known. The interesting question is what happens if datacenter guidance comes in 5% light. Mag-7 correlations get weird, vol curves invert, and everyone's long the wrong leg. Thoughts?",
    score: 4128, comments: 412, time: "6h",
    threads: [
      { author: "u/apis-\u03B1", role: "MM", score: 312, time: "5h", body: "Vol is priced for a 9% move. Skew is bid (puts > calls), so the market is already paying for tail. If guidance is light, you're paying for protection at the peak. Not great risk/reward to buy puts here.",
        replies: [
          { author: "u/scout-3", score: 88, time: "5h", body: "fair, but vol-of-vol is also at like 20th percentile. there's room for it to repace itself" },
          { author: "u/forager-2", role: "TKR", score: 42, time: "4h", body: "\uD83D\uDC46 this. realized > implied for 3 weeks running" },
        ] },
      { author: "u/pollen-9", role: "MM", score: 196, time: "4h", body: "Watch the AI capex revisions out of META and GOOG. If they fade their cadence, NVDA can print and still sell off on the conference call.", replies: [] },
      { author: "u/drone-7", role: "INFO", score: 84, time: "3h", body: "Reuters just published a piece saying CSP capex is on track. I'd ignore the headline though \u2014 they always say that.", replies: [] },
    ],
  },
};

// ── lookups ──────────────────────────────────────────────────────────────
export const FR_STATE_TONE: Record<RunState, Tone> = { live: "live", ready: "honey", done: "neutral", failed: "danger" };
export const FR_TEMPLATE_LABEL: Record<string, string> = {
  "polymarket": "Prediction market", "market-maker": "Market maker", "x-thread": "X thread",
  "reddit-narrative": "Reddit narrative", "research-swarm": "Research swarm", "ops": "Ops stress test", "custom": "Custom",
};
export const FR_FACTION: Record<Faction, { label: string; tone: Tone; name: string }> = {
  MM: { label: "MM", tone: "honey", name: "Market maker" },
  TKR: { label: "TKR", tone: "danger", name: "Liquidity taker" },
  INFO: { label: "INFO", tone: "live", name: "Information" },
  OPS: { label: "OPS", tone: "neutral", name: "Operations" },
};
export const SW_TEMPLATES: Template[] = [
  { id: "polymarket", label: "Prediction market", agents: 48, desc: "Price a binary, dated, or bucketed question. Agents bet and update on news." },
  { id: "market-maker", label: "Market maker", agents: 24, desc: "MMs vs takers on one instrument, with a configurable shock." },
  { id: "x-thread", label: "X thread", agents: 1, desc: "Draft a Twitter/X thread the autoposter will publish." },
  { id: "reddit-narrative", label: "Reddit narrative", agents: 16, desc: "Seed comment \u2192 cascade. Measure consensus drift." },
  { id: "research-swarm", label: "Research swarm", agents: 8, desc: "N agents read sources \u2192 one consensus brief." },
  { id: "ops", label: "Ops stress test", agents: 6, desc: "Synthetic failure storm on the brain / sync layer." },
  { id: "custom", label: "Blank canvas", agents: 1, desc: "Empty scenario you script line by line." },
];

// ── derivations ──────────────────────────────────────────────────────────
// Every tile shows a REAL field from the run payload \u2014 no hardcoded placeholders.
// Fields MiroShark didn't emit (sharpe/pnl on a thin run) are dropped, not faked.
export function frRunMetrics(run: Run): MetricTile[] {
  if (run.template === "polymarket" && run.market) {
    const lead = run.market.outcomes[0];
    return [
      { k: "swarm lean", v: lead.label, tone: run.market.lean.hit ? "live" : "honey" },
      { k: "confidence", v: Math.round(lead.prob * 100) + "%", tone: "honey" },
      { k: "agents", v: run.agents },
      { k: "rounds", v: run.rounds },
    ];
  }
  const sharpe: MetricTile | null = run.sharpe != null
    ? { k: "sharpe", v: run.sharpe.toFixed(2), tone: run.state === "live" || run.sharpe >= 1.5 ? "live" : "honey" }
    : null;
  const statusLabel = run.state === "live" ? "running" : run.state === "ready" ? "awaiting you" : run.state === "failed" ? "failed" : "done";
  const tiles: (MetricTile | null)[] = (() => {
    switch (run.template) {
      case "market-maker": return [sharpe, run.pnl ? { k: "pnl \u0394 / round", v: run.pnl } : null, { k: "trades", v: run.trades.toLocaleString() }, { k: "agents", v: run.agents }];
      case "reddit-narrative": return [{ k: "posts", v: run.posts.toLocaleString() }, { k: "agents", v: run.agents }, { k: "rounds", v: run.rounds }];
      case "research-swarm": return [{ k: "sources", v: run.news }, { k: "reading bees", v: run.agents }, { k: "rounds", v: run.rounds }];
      case "x-thread": return [{ k: "tweets", v: run.posts }, { k: "author bees", v: run.agents }, { k: "status", v: statusLabel, tone: run.state === "ready" ? "honey" : undefined }];
      case "ops": return [{ k: "round", v: run.currentRound + " / " + run.rounds, tone: "danger" }, { k: "agents", v: run.agents }, { k: "rounds", v: run.rounds }];
      default: return [sharpe, { k: "agents", v: run.agents }, { k: "rounds", v: run.rounds }];
    }
  })();
  return tiles.filter((t): t is MetricTile => t != null);
}

export function frRunVerdict(run: Run): { tone: Tone; head: string; why: string } {
  if (run.template === "polymarket" && run.market) {
    const hit = run.market.lean.hit;
    if (run.state === "live") return { tone: "live", head: "Live \u00b7 pricing", why: run.market.lean.headline };
    return { tone: hit ? "live" : "neutral", head: run.market.lean.headline, why: run.market.lean.blurb };
  }
  switch (run.state) {
    case "failed": return { tone: "danger", head: "Failed \u00b7 round " + run.currentRound, why: run.summary };
    case "ready": return { tone: "honey", head: run.template === "x-thread" ? "Ready \u00b7 awaiting approval" : "Ready \u00b7 queued", why: run.summary };
    case "done": return { tone: "neutral", head: "Done \u00b7 archived", why: run.summary };
    default: return { tone: "live", head: "Live \u00b7 running", why: run.summary };
  }
}

export const frSimRuns = () => SW_RUNS;
export const frSimActive = () => SW_RUNS.find((r) => r.state === "live")!;
export const frSimLive = () => SW_RUNS.filter((r) => r.state === "live");
export const frSimOthers = () => SW_RUNS.filter((r) => r.state !== "live");
export const frSimRun = (id: string) => SW_RUNS.find((r) => r.id === id)!;
export const frRunShort = (run: Run) => run.title.split(" \u00b7 ")[0].split(" (")[0];
export const frRunTrend = (run: Run) => frBuildTrend({ seed: frHash(run.id), start: Math.max(0.2, (run.sharpe || 1) * 0.35), end: run.sharpe || 1, wobble: 0.14, dip: run.state === "failed" ? 0.3 : 0 });

// ── run intelligence (the analysis panel) ───────────────────────────────────
export const SW_INTEL: Record<string, Intel> = {
  "run-claude-fable": {
    kind: "market",
    read: "A moderate-conviction late-July call riding the dev-day teaser \u2014 not yet a hard date.",
    drivers: [
      "Dev-day teaser tweet pulled ~5 pts onto the late-July window (round 15).",
      "An \u201Cinference, launch eng\u201D hiring post added early weight (round 6).",
      "Changelog cadence matches a ~6-week ship from the last point release.",
    ],
    swing: [
      { name: "Drone-7", note: "holds 3 agents on \u201CAug 20+\u201D citing an eval backlog" },
      { name: "Scout-3", note: "narrative bee pushing the late-July thesis hardest" },
    ],
    flipIf: [
      "A dated changelog or RC tag snaps the call to that exact week.",
      "If dev-day slips, weight flows back onto \u201CAugust+.\u201D",
    ],
  },
  "run-spiderman-bo": {
    kind: "market",
    read: "High-confidence >$200M call, confirmed at $214M. Presales did the work.",
    drivers: [
      "41M trailer views in 24h re-rated the ceiling (round 10).",
      "Presales outpaced No Way Home at the same window (round 22).",
      "Exhibitor screen count came in at the top of the range.",
    ],
    swing: [{ name: "Tracker-12", note: "lone holdout in $150\u2013200M on weather risk" }],
    flipIf: [
      "Soft Thursday previews would have capped it at the $200M line.",
      "A review-embargo miss could have shaved the upper wing.",
    ],
  },
  "run-fed-july": {
    kind: "market",
    read: "A firm NO that flipped 8 rounds before the crowd, on the CPI print.",
    drivers: [
      "CPI 3.4% vs 3.2% expected (round 8) flipped the swarm out of a YES lean.",
      "WSJ \u201Cno rush on cuts\u201D framing (round 14) cemented the NO.",
    ],
    swing: [{ name: "Econ-3", note: "held a YES lean right up to the CPI print" }],
    flipIf: ["A soft jobs number before the meeting would have re-opened YES."],
  },
};
export const frRunIntel = (run: Run): Intel | null => SW_INTEL[run.id] || null;
