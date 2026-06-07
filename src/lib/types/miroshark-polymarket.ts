export type MiroSharkPolymarketCall = "no" | "yes" | "skip";

export type MiroSharkPolymarketRung = {
  call?: MiroSharkPolymarketCall;
  crowdProbability?: number;
  edge?: number;
  expectedValue?: number;
  noPrice?: number;
  simProbability?: number;
  strength?: number;
  threshold: string;
  volume?: string;
  yesPrice?: number;
};

export type MiroSharkPolymarketBestBet = MiroSharkPolymarketRung & {
  rank?: number;
};

export type MiroSharkPolymarketAttributionItem = {
  amount: number;
  name: string;
};

export type MiroSharkPolymarketAttribution = {
  base?: number;
  baseLabel?: string;
  items?: MiroSharkPolymarketAttributionItem[];
  net?: number;
  netLabel?: string;
};

export type MiroSharkPolymarketFaction = {
  color?: string;
  count?: number;
  name: string;
  value: string;
};

export type MiroSharkPolymarketRisk = {
  detail?: string;
  label: string;
  level?: "high" | "med" | "low";
  value: string;
};

export type MiroSharkPolymarketDetailData = {
  agents?: number;
  attribution?: MiroSharkPolymarketAttribution;
  bestBets?: MiroSharkPolymarketBestBet[];
  callout?: {
    headline?: string;
    label?: string;
    subhead?: string;
  };
  confidence?: number;
  factions?: MiroSharkPolymarketFaction[];
  market?: string;
  marketUrl?: string;
  note?: string;
  outcomes?: number;
  readRule?: string;
  resolves?: string;
  risks?: MiroSharkPolymarketRisk[];
  rungs?: MiroSharkPolymarketRung[];
  source?: "miroshark" | "fallback";
  volume?: string;
};
