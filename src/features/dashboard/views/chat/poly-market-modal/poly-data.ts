import type {
  MiroSharkPolymarketAttribution,
  MiroSharkPolymarketDetailData,
  MiroSharkPolymarketFaction,
  MiroSharkPolymarketRisk,
  MiroSharkPolymarketRung,
} from "@/lib/types/miroshark-polymarket";

export type Call = "no" | "yes" | "skip";

export interface Rung {
  call?: Call;
  edge?: number;
  ev?: number;
  no?: number;
  pct?: number;
  sim?: number;
  strength?: number;
  t: number;
  thr: string;
  vol?: string;
  yes?: number;
}

export interface EnrichedRung extends Rung {
  call: Call;
  edge: number;
  ev: number;
  no: number;
  pct: number;
  sim: number;
  strength: number;
  vol: string;
  yes: number;
}

export interface RunMeta {
  agents?: number;
  conf?: number;
  market: string;
  outcomes: number;
  resolves?: string;
  vol?: string;
}

export type PolyMarketModalData = {
  attr: MiroSharkPolymarketAttribution;
  best: EnrichedRung[];
  callout: {
    headline: string;
    label: string;
    subhead: string;
  };
  facs: MiroSharkPolymarketFaction[];
  ladder: EnrichedRung[];
  marketUrl?: string;
  note: string;
  readRule: string;
  risks: MiroSharkPolymarketRisk[];
  run: RunMeta;
  source: "miroshark" | "fallback";
};

const FALLBACK_RUNG_DATA: MiroSharkPolymarketRung[] = [
  { threshold: ">$4T",   volume: "$188k", crowdProbability: 1,  yesPrice: 1.3,  noPrice: 99.0, simProbability: 0.5 },
  { threshold: ">$3.8T", volume: "$56k",  crowdProbability: 2,  yesPrice: 2.3,  noPrice: 98.1, simProbability: 0.8 },
  { threshold: ">$3.6T", volume: "$64k",  crowdProbability: 2,  yesPrice: 1.9,  noPrice: 98.3, simProbability: 1.1 },
  { threshold: ">$3.4T", volume: "$62k",  crowdProbability: 3,  yesPrice: 2.9,  noPrice: 97.7, simProbability: 1.6 },
  { threshold: ">$3.2T", volume: "$302k", crowdProbability: 3,  yesPrice: 3.0,  noPrice: 97.6, simProbability: 2.0 },
  { threshold: ">$3T",   volume: "$1.52M", crowdProbability: 6, yesPrice: 6, noPrice: 95, simProbability: 3.6 },
  { threshold: ">$2.8T", volume: "$199k", crowdProbability: 9, yesPrice: 9, noPrice: 92, simProbability: 5.8 },
  { threshold: ">$2.6T", volume: "$325k", crowdProbability: 14, yesPrice: 15, noPrice: 87, simProbability: 9.5 },
  { threshold: ">$2.4T", volume: "$630k", crowdProbability: 27, yesPrice: 28, noPrice: 74, simProbability: 18 },
  { threshold: ">$2.2T", volume: "$234k", crowdProbability: 43, yesPrice: 43, noPrice: 58, simProbability: 33 },
  { threshold: ">$2T",   volume: "$832k", crowdProbability: 63, yesPrice: 63, noPrice: 38, simProbability: 56 },
  { threshold: ">$1.8T", volume: "$471k", crowdProbability: 79, yesPrice: 79, noPrice: 22, simProbability: 76 },
  { threshold: ">$1.6T", volume: "$341k", crowdProbability: 92, yesPrice: 92.1, noPrice: 8.4, simProbability: 91 },
  { threshold: ">$1.4T", volume: "$219k", crowdProbability: 96, yesPrice: 96.5, noPrice: 3.8, simProbability: 96 },
  { threshold: ">$1.2T", volume: "$317k", crowdProbability: 97, yesPrice: 97.6, noPrice: 3.0, simProbability: 97.2 },
  { threshold: ">$1T",   volume: "$551k", crowdProbability: 99, yesPrice: 99.4, noPrice: 0.9, simProbability: 99.2 },
];

const FALLBACK_DETAIL: MiroSharkPolymarketDetailData = {
  agents: 48,
  attribution: {
    base: 63,
    baseLabel: "Crowd · >$2T",
    net: 56,
    netLabel: "Sim · >$2T",
    items: [
      { name: "IPO by Dec 2027 - sim 58% vs ~72%", amount: -5.0 },
      { name: "Comp-anchored median ~= $1.98T", amount: -2.5 },
      { name: "Upside lottery premium (>$2.6T)", amount: -1.5 },
      { name: "Starlink + Starship momentum", amount: 1.5 },
    ],
  },
  callout: {
    headline: "Crowd overpays the upside",
    label: "the sim's call",
    subhead: "7 of 16 rungs lean NO · best edge in the $2.0-2.4T band",
  },
  confidence: 80,
  factions: [
    { name: "Bulls", count: 18, value: "$2.34T", color: "var(--cyan)" },
    { name: "Bears", count: 14, value: "$1.71T", color: "var(--pm-no)" },
    { name: "Arb", count: 9, value: "$1.96T", color: "var(--honey)" },
    { name: "News", count: 7, value: "$2.02T", color: "var(--fg-2)" },
  ],
  market: "SpaceX IPO closing market cap above ___ ?",
  note: "MiroShark output - synthetic simulation, not financial advice.",
  outcomes: 16,
  readRule: "sim ~= crowd -> SKIP · sim below crowd -> YES rich -> BET NO",
  resolves: "Dec 31, 2027",
  risks: [
    { label: "Resolution", value: "Dec 31, 2027", detail: "closing cap on IPO day" },
    { label: "IPO risk", value: "high", detail: "no IPO by date -> all rungs resolve NO", level: "high" },
    { label: "Liquidity", value: "mixed", detail: "deep on $2T · tails thin", level: "med" },
    { label: "Model conf.", value: "$1.98T ± 0.34", detail: "synthetic consensus", level: "med" },
  ],
  rungs: FALLBACK_RUNG_DATA,
  source: "fallback",
  volume: "$6.35M",
};

export const pctf = (n: number): string => `${n >= 0 ? "+" : "-"}${Math.abs(n * 100).toFixed(0)}%`;

export function tval(value: string): number {
  const parsed = parseFloat(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberOr(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? value as number : fallback;
}

export function enrich(rung: MiroSharkPolymarketRung): EnrichedRung {
  const pct = numberOr(rung.crowdProbability, numberOr(rung.yesPrice, 0));
  const sim = numberOr(rung.simProbability, pct);
  const yes = numberOr(rung.yesPrice, pct);
  const no = numberOr(rung.noPrice, +(100 - yes).toFixed(2));
  const edge = numberOr(rung.edge, +(pct - sim).toFixed(2));
  const call = rung.call ?? (edge >= 1.8 ? "no" : edge <= -1.8 ? "yes" : "skip");
  const ev = numberOr(
    rung.expectedValue,
    call === "no" ? (1 - sim / 100) / Math.max(no / 100, 0.01) - 1
      : call === "yes" ? (sim / 100) / Math.max(yes / 100, 0.01) - 1
        : 0,
  );
  const mag = Math.abs(edge);
  return {
    call,
    edge,
    ev,
    no,
    pct,
    sim,
    strength: rung.strength ?? (mag >= 8 ? 3 : mag >= 4 ? 2 : mag >= 1.8 ? 1 : 0),
    t: tval(rung.threshold),
    thr: rung.threshold,
    vol: rung.volume ?? "",
    yes,
  };
}

export function buildPolyMarketModalData(
  detail: MiroSharkPolymarketDetailData | undefined,
  fallback: { market?: string; marketUrl?: string } = {},
): PolyMarketModalData {
  const source = detail ?? { ...FALLBACK_DETAIL, market: fallback.market || FALLBACK_DETAIL.market, marketUrl: fallback.marketUrl };
  const ladder = (source.rungs ?? []).map(enrich);
  const best = (source.bestBets?.length ? source.bestBets.map(enrich) : ladder.filter((rung) => rung.call !== "skip"))
    .sort((a, b) => b.ev - a.ev)
    .slice(0, 3);
  const attr = source.attribution ?? {};
  return {
    attr,
    best,
    callout: {
      headline: source.callout?.headline || (best[0]?.call === "yes" ? "Crowd underprices the upside" : "Crowd overpays the upside"),
      label: source.callout?.label || "the sim's call",
      subhead: source.callout?.subhead || `${ladder.filter((rung) => rung.call === "no").length} of ${ladder.length} rungs lean NO`,
    },
    facs: source.factions ?? [],
    ladder,
    marketUrl: source.marketUrl || fallback.marketUrl,
    note: source.note || "MiroShark output - synthetic simulation, not financial advice.",
    readRule: source.readRule || "sim ~= crowd -> SKIP · sim below crowd -> YES rich -> BET NO",
    risks: source.risks ?? [],
    run: {
      agents: source.agents,
      conf: source.confidence,
      market: source.market || fallback.market || "Polymarket simulation",
      outcomes: source.outcomes || ladder.length,
      resolves: source.resolves,
      vol: source.volume,
    },
    source: detail ? detail.source ?? "miroshark" : "fallback",
  };
}
