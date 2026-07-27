/* adapt-miroshark.ts — maps the live MiroShark controller shapes (SwarmRun,
   SwarmMarket, SwarmAgent, SwarmDecision) into the Simulation UI's SimDataset.

   This is the only place that knows both data models. The new surfaces read the
   dataset through useSimData(); everything here is derived from REAL run
   payloads — never the SW_* demo constants. Fields MiroShark doesn't emit
   (crowd markers, agent bet distributions) are derived where honest and left
   empty otherwise, so the UI shows a real-but-sparse read rather than fiction. */

import type { SwarmAgent, SwarmDecision, SwarmEventItem, SwarmMarket, SwarmRun } from "@/components/swarm/swarm-data";
import { buildMiroSharkIntelligence } from "@/lib/services/miroshark/run-intelligence";
import type {
  Agent, Decision, Intel, Market, OddsPoint, Outcome, RedditComment, RedditPost, Run, TemplateId, XThread,
} from "./sim-data";
import type { OpsEvent, ResearchContent, RoundRow, SimDataset, SimStat, TapeData } from "./sim-context";

const TEMPLATE_IDS = ["polymarket", "market-maker", "x-thread", "reddit-narrative", "research-swarm", "ops", "custom"] as const;
function toTemplateId(value: string): TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(value) ? (value as TemplateId) : "custom";
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function roleFromTone(tone?: "bear" | "bull" | "neutral"): Agent["faction"] | undefined {
  return tone === "bull" ? "INFO" : tone === "bear" ? "OPS" : undefined;
}
function isGenericSymbol(symbol: string) {
  return !symbol || symbol === "MiroShark markets" || symbol === "No market data";
}

export interface MiroSharkSource {
  runs: SwarmRun[];
  currentRun: SwarmRun | null;
  market: SwarmMarket;
  agents: SwarmAgent[];
  decisions: SwarmDecision[];
  statusLabel?: string;
}

// ── run ──────────────────────────────────────────────────────────────────
function adaptRun(src: SwarmRun, market: Market | undefined): Run {
  return {
    id: src.id,
    template: toTemplateId(src.template),
    state: src.state,
    title: src.title,
    started: src.started,
    rounds: src.rounds,
    currentRound: src.currentRound,
    agents: src.agents,
    news: src.news,
    posts: src.posts,
    trades: src.trades,
    sharpe: src.sharpe ?? undefined,
    pnl: src.pnl ?? undefined,
    tags: src.tags ?? [],
    // Prefer the scenario over src.summary: the live controller sets summary to
    // the MiroShark status message (e.g. "Simulation started"), which is noise in
    // the read-out. The scenario is the real description.
    summary: src.scenario?.trim() || src.summary?.trim() || "",
    market,
  };
}

// ── prediction market (built only for the run whose tick data we hold) ─────
function buildMarket(src: SwarmRun, tape: SwarmMarket, intelRead?: string): Market | undefined {
  if (toTemplateId(src.template) !== "polymarket") return undefined;
  const ticks = (tape.ticks ?? []).filter((t) => Number.isFinite(t));
  const latest = ticks.length ? ticks[ticks.length - 1] : undefined;
  if (typeof latest !== "number") return undefined; // no priced signal yet → thin state

  const open = ticks[0];
  const yes = clamp(latest, 0, 1);
  const no = 1 - yes;
  const yesLead = yes >= no;
  const done = src.state === "done";
  const yesOutcome: Outcome = { label: "YES", prob: yes, crowd: typeof open === "number" ? clamp(open, 0, 1) : yes, lead: yesLead, won: done && yesLead ? true : undefined };
  const noOutcome: Outcome = { label: "NO", prob: no, crowd: typeof open === "number" ? clamp(1 - open, 0, 1) : no, lead: !yesLead, won: done && !yesLead ? true : undefined };
  const outcomes: Outcome[] = yesLead ? [yesOutcome, noOutcome] : [noOutcome, yesOutcome];
  const lead = outcomes[0];

  const history: OddsPoint[] = ticks.map((p, i) => ({ r: i, p }));
  if (history.length && tape.headlines?.length) {
    const step = Math.max(1, Math.floor(history.length / tape.headlines.length));
    tape.headlines.forEach((h, hi) => {
      const idx = Math.min(history.length - 1, hi * step);
      if (history[idx] && h.body) history[idx] = { ...history[idx], event: h.body.length > 48 ? `${h.body.slice(0, 48)}…` : h.body };
    });
  }

  const question = isGenericSymbol(tape.symbol) ? src.title : tape.symbol;
  const confPct = Math.round(lead.prob * 100);
  const deltaPts = typeof open === "number" ? Math.round((latest - open) * 100) : undefined;
  return {
    kind: "binary",
    question,
    subtitle: src.scenario && src.scenario !== question ? src.scenario : "Swarm-priced market — resolves on the real outcome.",
    resolves: done ? "Resolved" : "Open · live pricing",
    volume: "—",
    traders: src.agents || 0,
    lean: {
      headline: `${done ? "Swarm settled" : "Swarm leans"} ${lead.label} at ${confPct}%`,
      conf: lead.prob,
      blurb: intelRead || src.summary || "",
      hit: false,
    },
    outcomes,
    bets: [],
    history,
    edge: deltaPts !== undefined ? `${deltaPts >= 0 ? "+" : ""}${deltaPts} pts from open` : "",
  };
}

// ── native per-run surfaces ────────────────────────────────────────────────
function buildThread(src: SwarmRun): XThread | null {
  const posts = src.threadPosts ?? [];
  if (!posts.length) return null;
  const handle = (posts[0].handle || "@swarm").replace(/^@/, "");
  return {
    display: posts[0].author || "MiroShark",
    handle,
    tweets: posts.map((p) => ({
      text: p.text,
      time: p.time,
      stats: { reply: p.replies ?? 0, retweet: p.reposts ?? 0, like: p.likes ?? 0, view: p.views ?? 0 },
    })),
  };
}

function buildReddit(src: SwarmRun): RedditPost | null {
  const items: SwarmEventItem[] = src.timelineItems?.length
    ? src.timelineItems
    : (src.threadPosts ?? []).map((p) => ({ id: p.id, title: p.author, body: p.text, meta: p.time }));
  if (!items.length) return null;
  const threads: RedditComment[] = items.map((item, i) => ({
    author: item.title || "u/swarm",
    role: roleFromTone(item.tone),
    score: Math.max(1, (src.posts || items.length) - i),
    time: item.meta ?? src.started,
    body: item.body,
  }));
  return {
    subreddit: src.platform === "reddit" ? "miroshark" : (src.platform ?? "miroshark"),
    author: items[0].title ? `u/${items[0].title.replace(/^u\//, "")}` : "u/swarm",
    title: src.title,
    body: src.scenario || src.summary || "",
    score: src.posts ?? items.length,
    comments: src.posts ?? items.length,
    time: src.started,
    threads,
  };
}

function buildResearch(src: SwarmRun): ResearchContent | null {
  const items = [...(src.timelineItems ?? []), ...(src.observabilityItems ?? [])].slice(0, 12);
  return {
    eyebrow: `${src.platform ?? "simulation"} · synthesized from MiroShark run data`,
    title: src.title,
    meta: `${src.agents} agents · ${src.news} records · ${src.started}`,
    body: src.scenario || src.summary || "No brief text was returned for this run yet.",
    records: items.map((item) => ({ title: item.title, body: item.body })),
  };
}

function buildOps(src: SwarmRun): OpsEvent[] {
  const items = src.observabilityItems?.length ? src.observabilityItems : (src.timelineItems ?? []);
  return items.map((item, i) => ({
    t: item.meta ?? String(i + 1).padStart(2, "0"),
    level: item.level ?? (src.state === "failed" ? "error" : "info"),
    msg: `${item.title}: ${item.body}`,
  }));
}

// ── run intelligence (reuses the existing MiroShark analysis service) ───────
function buildIntel(src: SwarmRun, tape: SwarmMarket, agents: SwarmAgent[]): Intel | null {
  const template = toTemplateId(src.template);
  if (template !== "polymarket" && template !== "market-maker") return null;
  const intelligence = buildMiroSharkIntelligence(src, { symbol: tape.symbol, ticks: tape.ticks });
  const isRisk = template === "market-maker";
  const swing = agents
    .filter((a) => a.status === "live")
    .slice(0, 3)
    .map((a) => ({ name: a.name, note: `${a.role}${a.ledger && a.ledger !== "—" ? ` · ${a.ledger}` : ""}` }));
  const drivers = intelligence.proClaims.filter((c) => !c.startsWith("No clear")).slice(0, 3);
  const flipIf = intelligence.conClaims.filter((c) => !c.startsWith("No clear")).slice(0, 3);
  if (!drivers.length && !flipIf.length && !swing.length) {
    // Still surface the headline read so the panel isn't empty for thin runs.
    return { kind: isRisk ? "risk" : "market", read: intelligence.verdict, drivers: [intelligence.marketRead], swing, flipIf: [intelligence.riskRead] };
  }
  return {
    kind: isRisk ? "risk" : "market",
    read: intelligence.verdict,
    drivers: drivers.length ? drivers : [intelligence.marketRead],
    swing,
    flipIf: flipIf.length ? flipIf : [intelligence.riskRead],
  };
}

// ── round table (theater "Last rounds") — derived from market ticks ────────
function buildRoundTable(src: SwarmRun | null, tape: SwarmMarket): RoundRow[] {
  if (!src || toTemplateId(src.template) !== "market-maker") return [];
  const ticks = (tape.ticks ?? []).filter((t) => Number.isFinite(t));
  if (ticks.length < 2) return [];
  return ticks.slice(-5).map((p, i, arr) => {
    const prev = i > 0 ? arr[i - 1] : p;
    const delta = ((p - prev) * 100).toFixed(2);
    return {
      round: src.currentRound - (arr.length - 1 - i),
      pnl: `${Number(delta) >= 0 ? "+" : ""}${delta}%`,
      sharpe: src.sharpe != null ? src.sharpe.toFixed(2) : "—",
      pos: src.pnl ?? "—",
    };
  });
}

// ── top-level ──────────────────────────────────────────────────────────────
export function buildSimDataset(src: MiroSharkSource): Omit<SimDataset, "loading" | "loadingLabel" | "emptyLabel" | "onLaunch" | "onPublish" | "onSelectRun"> {
  const { runs: rawRuns, currentRun, market: tape, agents: rawAgents, decisions: rawDecisions } = src;

  // Use the controller's run list as-is. It already merges the hydrated current
  // run's payloads into the selected shelf entry AND corrects its state: archived
  // runs stay "done" even when their saved body has a stale status "started"
  // (which swarmRunState() would otherwise classify "live"). Substituting the raw
  // currentRun here would resurrect that stale "running" state — so don't. Only
  // add currentRun separately when it's a fresh run not yet in the list.
  const sources: SwarmRun[] = currentRun && !rawRuns.some((r) => r.id === currentRun.id)
    ? [currentRun, ...rawRuns]
    : rawRuns;

  const intelByRun = new Map<string, Intel | null>();
  const marketByRun = new Map<string, Market | undefined>();
  for (const s of sources) {
    const isCurrent = currentRun ? s.id === currentRun.id : false;
    // Market + intel are only meaningful for the run whose tick data we currently hold.
    const intel = isCurrent ? buildIntel(s, tape, rawAgents) : null;
    intelByRun.set(s.id, intel);
    marketByRun.set(s.id, isCurrent ? buildMarket(s, tape, intel?.read) : undefined);
  }

  const byId = new Map<string, SwarmRun>(sources.map((s) => [s.id, s]));
  const runs: Run[] = sources.map((s) => adaptRun(s, marketByRun.get(s.id)));
  const live = runs.filter((r) => r.state === "live");
  const others = runs.filter((r) => r.state !== "live");
  const active = live[0] ?? runs[0] ?? null;

  const agents: Agent[] = rawAgents.map((a) => ({ id: a.id, name: a.name, role: a.role, faction: a.faction, ledger: a.ledger, status: a.status }));
  const decisions: Decision[] = rawDecisions.map((d) => ({ who: d.who, role: d.role, action: d.action, detail: d.detail }));
  const roundTable = buildRoundTable(currentRun, tape);
  const tapeData: TapeData = { symbol: tape.symbol, ticks: tape.ticks ?? [], ladder: tape.ladder ?? [], headlines: tape.headlines ?? [] };

  const stats: SimStat[] = [
    { value: live.length, label: "running", live: true, tone: "var(--live)" },
    { value: currentRun?.agents ?? agents.length, label: "agents in arena", tone: "var(--honey)" },
    { value: runs.length, label: "runs on the shelf" },
  ];

  const getSrc = (run: Run) => byId.get(run.id) ?? null;
  return {
    runs,
    active,
    live,
    others,
    stats,
    getRun: (id) => runs.find((r) => r.id === id) ?? null,
    agents,
    decisions,
    roundTable,
    tape: tapeData,
    threadFor: (run) => { const s = getSrc(run); return s ? buildThread(s) : null; },
    redditFor: (run) => { const s = getSrc(run); return s ? buildReddit(s) : null; },
    researchFor: (run) => { const s = getSrc(run); return s ? buildResearch(s) : null; },
    opsFor: (run) => { const s = getSrc(run); return s ? buildOps(s) : []; },
    intelFor: (run) => intelByRun.get(run.id) ?? null,
  };
}
