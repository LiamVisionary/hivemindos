import type { SwarmMarket, SwarmRun, TemplateId } from "@/components/swarm";
import { asRecord, compactValue, isMiroSharkRunTerminal, payloadCount } from "@/features/swarm/miroshark-payload";
import type { MiroSharkTemplate } from "@/features/swarm/miroshark-templates";

export type SwarmEventItem = {
  id: string;
  title: string;
  body: string;
  meta?: string;
  tone?: "bear" | "bull" | "neutral";
  level?: "info" | "warn" | "error" | "fatal";
  raw?: unknown;
};

type MiroSharkRunStateInput = {
  error?: string;
  status?: "queued" | "running" | "started" | "failed";
  archived?: boolean;
} | null;

export function mirosharkUserName(userId?: number) {
  const names = ["Nora Singh", "Maya Chen", "Ravi Patel", "Diego Morales", "Lena Brooks"];
  return typeof userId === "number" ? names[userId % names.length] ?? `User ${userId}` : "Swarm Agent";
}

export function mirosharkHandle(userId?: number) {
  const handles = ["@healthdesk", "@nomlaunch", "@cafeledger", "@routeops", "@parentswatch"];
  return typeof userId === "number" ? handles[userId % handles.length] ?? `@agent${userId}` : "@swarm";
}

export function mirosharkStat(seed: number | undefined, base: number, spread: number) {
  return base + ((seed ?? 0) * 17) % spread;
}

export function swarmTemplateIdFromSurface(platform?: string): TemplateId {
  if (platform === "reddit") return "reddit-narrative";
  if (platform === "polymarket") return "polymarket";
  if (platform === "twitter" || platform === "x") return "x-thread";
  if (platform === "parallel") return "custom";
  return "custom";
}

export function swarmTemplateIdFromMirosharkTemplate(template: MiroSharkTemplate): TemplateId {
  if (template.id?.trim()) return template.id.trim();

  const text = `${template.id ?? ""} ${template.name ?? ""} ${template.category ?? ""} ${(template.platforms ?? []).join(" ")}`.toLowerCase();
  if (text.includes("polymarket")) return "polymarket";
  if (text.includes("reddit")) return "reddit-narrative";
  if (text.includes("research") || text.includes("tavily")) return "research-swarm";
  if (text.includes("ops") || text.includes("stress")) return "ops";
  if (text.includes("market")) return "market-maker";
  if (text.includes("twitter") || text.includes(" x ") || text.includes("thread")) return "x-thread";
  return "custom";
}

export function swarmRunState(run: MiroSharkRunStateInput, runnerStatus?: string): SwarmRun["state"] {
  if (run?.error || run?.status === "failed" || runnerStatus === "failed") return "failed";
  // A terminal MiroShark runner_status (completed/stopped) or an archived/saved run is
  // finished — even though MiroShark leaves the run's top-level status at "started" after
  // it completes. Without this a just-finished or loaded archived run reads as "live".
  if (isMiroSharkRunTerminal(runnerStatus) || run?.archived) return "done";
  if (run?.status === "started") return "live";
  if (run?.status === "queued" || run?.status === "running") return "ready";
  return "done";
}

export function numericRecordValue(record: Record<string, unknown>, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = key.split(".").reduce<unknown>((current, part) => asRecord(current)[part], record);
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function swarmEventItem(value: unknown, index: number): SwarmEventItem {
  const record = asRecord(value);
  const title = String(record.event_type ?? record.type ?? record.action_type ?? record.name ?? record.status ?? `record ${index + 1}`);
  const body = String(record.content ?? record.text ?? record.message ?? record.description ?? record.summary ?? compactValue(value));
  const metaValue = record.round ?? record.created_at ?? record.timestamp ?? record.time ?? record.platform;
  const rawLevel = String(record.level ?? record.severity ?? "").toLowerCase();
  const level = rawLevel === "fatal" || rawLevel === "error" || rawLevel === "warn" || rawLevel === "info" ? rawLevel : undefined;
  return {
    id: String(record.id ?? record.post_id ?? record.event_id ?? `${title}-${index}`),
    title,
    body,
    meta: metaValue == null ? undefined : String(metaValue),
    tone: level === "error" || level === "fatal" ? "bear" : level === "warn" ? "neutral" : "bull",
    level,
    raw: value,
  };
}

export function swarmMarketEventItem(value: unknown, index: number): SwarmEventItem {
  const record = asRecord(value);
  const question = String(record.question ?? record.title ?? record.name ?? `market ${index + 1}`);
  const price = numericRecordValue(record, ["price_yes", "yes_price", "price", "probability", "odds"], Number.NaN);
  const outcomes = [record.outcome_a, record.outcome_b].filter((item) => item !== undefined && item !== null).join(" / ");
  return {
    id: String(record.market_id ?? record.id ?? `market-${index}`),
    title: question,
    body: [
      Number.isFinite(price) ? `YES ${Math.round(price * 100)}%` : "",
      outcomes ? `Outcomes ${outcomes}` : "",
    ].filter(Boolean).join(" · ") || compactValue(value),
    meta: record.created_at == null ? undefined : String(record.created_at),
    tone: Number.isFinite(price) ? price >= 0.5 ? "bull" : "bear" : "neutral",
    raw: value,
  };
}

export function swarmMarketPriceEventItem(value: unknown, index: number): SwarmEventItem {
  const record = asRecord(value);
  const data = asRecord(record.data ?? value);
  const market = asRecord(data.market);
  const prices = Array.isArray(data.prices) ? data.prices : [];
  const question = String(market.question ?? record.question ?? `Market price history ${index + 1}`);
  const price = numericRecordValue(market, ["price_yes", "yes_price", "price", "probability", "odds"], Number.NaN);
  return {
    id: `market-prices-${index}`,
    title: question,
    body: [
      prices.length ? `${prices.length} price points` : "",
      Number.isFinite(price) ? `latest snapshot YES ${Math.round(price * 100)}%` : "",
    ].filter(Boolean).join(" · ") || compactValue(value),
    meta: `${payloadCount(value)} price points`,
    tone: "bull",
    raw: value,
  };
}

export function swarmMarketFromItems(items: Record<string, unknown>[], timelineItems: SwarmEventItem[], pricePayloads: unknown[] = []): SwarmMarket {
  const priceRecords = pricePayloads.flatMap((value) => {
    const record = asRecord(value);
    const data = asRecord(record.data ?? value);
    const market = asRecord(data.market);
    const prices = Array.isArray(data.prices) ? data.prices : [];
    return [
      ...prices,
      Object.keys(market).length ? market : null,
      Object.keys(data).length ? data : null,
      Object.keys(record).length ? record : null,
    ].filter((item): item is unknown => item !== null);
  });
  const ticks = [...items, ...priceRecords]
    .map((item) => numericRecordValue(asRecord(item), [
      "price", "odds", "probability", "yes_price", "price_yes", "value",
      "market.price_yes", "market.yes_price", "market.price", "market.probability",
    ], Number.NaN))
    .filter(Number.isFinite);
  const firstPriceRecord = asRecord(pricePayloads[0]);
  const firstPriceData = asRecord(firstPriceRecord.data ?? firstPriceRecord);
  const firstPriceMarket = asRecord(firstPriceData.market);
  return {
    symbol: String(
      items[0]?.question
        ?? items[0]?.title
        ?? items[0]?.name
        ?? firstPriceMarket.question
        ?? firstPriceRecord.question
        ?? "MiroShark markets"
    ),
    ticks: ticks.map((tick) => tick > 1 ? tick / 100 : tick),
    ladder: [...items, ...priceRecords].slice(0, 9).map((item, index) => {
      const record = asRecord(item);
      const px = numericRecordValue(record, [
        "price", "odds", "probability", "yes_price", "price_yes", "value",
        "market.price_yes", "market.yes_price", "market.price", "market.probability",
      ], index + 1);
      return {
        px: px > 1 ? px / 100 : px,
        bid: numericRecordValue(record, ["bid", "yes", "volume", "liquidity"], 0) || null,
        ask: numericRecordValue(record, ["ask", "no"], numericRecordValue(record, ["price_no", "no_price"], 0)) || null,
      };
    }),
    headlines: timelineItems.slice(0, 6).map((item) => ({
      t: item.meta ?? "",
      body: `${item.title}: ${item.body}`,
      tone: item.tone ?? "neutral",
    })),
  };
}
