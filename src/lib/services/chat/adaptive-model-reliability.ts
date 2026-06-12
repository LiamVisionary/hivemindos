import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "path";

export type AdaptiveModelOutcome = "success" | "capacity" | "unsupported" | "failure" | "low-quality";

type ModelReliabilityRecord = {
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  cooldownUntil?: number;
  lastOutcome?: AdaptiveModelOutcome;
  lastError?: string;
  // Quality gates (evo-style): a completed response only counts as a pass if
  // it survives the garbage checks; "completed but useless" responses are
  // graded here and demote the model in routing without a transport failure.
  qualityPasses?: number;
  qualityFails?: number;
  qualityFailStreak?: number;
};

type ReliabilityStore = {
  updatedAt: string;
  models: Record<string, ModelReliabilityRecord>;
};

const RELIABILITY_STORE_FILE = join(homedir(), ".hivemindos", "openrouter-model-reliability.json");
// Free-tier per-minute rate limits reset quickly; daily quotas keep failing,
// so consecutive capacity hits escalate the cooldown toward the cap.
const CAPACITY_COOLDOWN_MS = 5 * 60_000;
const FAILURE_COOLDOWN_MS = 15 * 60_000;
const UNSUPPORTED_COOLDOWN_MS = 24 * 60 * 60_000;
const MAX_COOLDOWN_MS = 6 * 60 * 60_000;
const RECENT_SUCCESS_WINDOW_MS = 24 * 60 * 60_000;
const MAX_TRACKED_MODELS = 400;
// One bad answer shouldn't bench a model; a streak should. The second
// consecutive low-quality response starts a 10-minute cooldown that doubles
// per repeat (10/20/40/80/160 min).
const LOW_QUALITY_COOLDOWN_MS = 10 * 60_000;
const QUALITY_MIN_GRADED_SAMPLES = 3;
const QUALITY_MIN_PASS_RATIO = 0.5;

const STORE_REREAD_TTL_MS = 5_000;

let storeMemory: ReliabilityStore | null = null;
let storeLoadedAt = 0;
let storeWrite: Promise<unknown> = Promise.resolve();

async function loadReliabilityStore(): Promise<ReliabilityStore> {
  if (storeMemory && Date.now() - storeLoadedAt < STORE_REREAD_TTL_MS) return storeMemory;
  // Flush pending writes first so the re-read can't resurrect stale data,
  // then pick up changes other processes made to the store file.
  await storeWrite.catch(() => undefined);
  const raw = await readFile(RELIABILITY_STORE_FILE, "utf8").catch(() => "");
  let models: Record<string, ModelReliabilityRecord> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ReliabilityStore>;
      if (parsed.models && typeof parsed.models === "object") models = parsed.models;
    } catch {
      // A corrupt store is not worth failing a chat over; start fresh.
    }
  }
  storeMemory = { updatedAt: new Date(0).toISOString(), models };
  storeLoadedAt = Date.now();
  return storeMemory;
}

function persistReliabilityStore(store: ReliabilityStore) {
  store.updatedAt = new Date().toISOString();
  const entries = Object.entries(store.models);
  if (entries.length > MAX_TRACKED_MODELS) {
    entries.sort((left, right) => Math.max(right[1].lastSuccessAt ?? 0, right[1].lastFailureAt ?? 0) - Math.max(left[1].lastSuccessAt ?? 0, left[1].lastFailureAt ?? 0));
    store.models = Object.fromEntries(entries.slice(0, MAX_TRACKED_MODELS));
  }
  const snapshot = JSON.stringify(store, null, 2);
  storeWrite = storeWrite
    .then(() => mkdir(dirname(RELIABILITY_STORE_FILE), { recursive: true }))
    .then(() => writeFile(RELIABILITY_STORE_FILE, snapshot, "utf8"))
    .catch(() => undefined);
}

/**
 * Storage key for a provider/model pair. OpenRouter entries stay as bare
 * model ids — the original store format, already gossiped fleet-wide — while
 * other providers (Models.dev adaptive routing) namespace with "provider::"
 * so a model id shared across providers can't collide.
 */
export function adaptiveReliabilityKey(provider: string, modelId: string) {
  const cleanProvider = (provider || "").trim().toLowerCase();
  const cleanModel = (modelId || "").trim();
  if (!cleanModel) return "";
  return !cleanProvider || cleanProvider === "openrouter" ? cleanModel : `${cleanProvider}::${cleanModel}`;
}

export type AdaptiveReliabilityState = {
  cooling: boolean;
  cooldownUntil: number;
  recentWinner: boolean;
  lastSuccessAt: number;
  poorQuality: boolean;
};

/** Snapshot of routing-relevant reliability state for a set of store keys. */
export async function adaptiveReliabilityStates(keys: string[]): Promise<Map<string, AdaptiveReliabilityState>> {
  const store = await loadReliabilityStore();
  const now = Date.now();
  const states = new Map<string, AdaptiveReliabilityState>();
  for (const key of keys) {
    const record = store.models[key];
    const demoted = poorQuality(record);
    states.set(key, {
      cooling: Boolean(record?.cooldownUntil && record.cooldownUntil > now),
      cooldownUntil: record?.cooldownUntil ?? 0,
      recentWinner: !demoted && Boolean(record?.lastSuccessAt && now - record.lastSuccessAt < RECENT_SUCCESS_WINDOW_MS),
      lastSuccessAt: record?.lastSuccessAt ?? 0,
      poorQuality: demoted,
    });
  }
  return states;
}

/**
 * Pass/fail gate on a completed response (evo-style: a raw "completed" only
 * counts once it survives independent checks). Conservative by design — a
 * false positive demotes a good model — so it only flags confident garbage:
 * bare refusals with no substance, the prompt echoed back, and repetition
 * loops. Everything else passes.
 */
export function assessAdaptiveResponseQuality(userText: string, responseText: string): { ok: boolean; reason?: string } {
  const response = (responseText || "").trim();
  const prompt = (userText || "").trim();
  if (!response) return { ok: false, reason: "empty response" };
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedResponse = normalize(response);
  const normalizedPrompt = normalize(prompt);
  const refusal = /^(?:i(?:'m| am) sorry[,.]? *)?(?:but +)?i (?:can(?:'t|not|’t)|won'?t be able to|am unable to|am not able to|do(?:n'?t| not) have the ability)/i;
  const promptMentionsRefusal = /i (?:can(?:'t|not|’t)|won'?t be able to|am unable to|am not able to|do(?:n'?t| not) have the ability)/i.test(prompt);
  // A refusal that pivots into an alternative ("...but here's how to...") is
  // partial value, not garbage — only bare dead-end refusals fail the gate.
  const refusalPivot = /\b(?:but|however|instead|alternatively|though|that said|here(?:'s| is| are)|you c(?:an|ould)|try)\b/i;
  if (response.length < 400 && refusal.test(response) && !promptMentionsRefusal && !refusalPivot.test(response)) {
    return { ok: false, reason: "refusal without substance" };
  }
  // Don't flag obedient echoes the user explicitly asked for.
  const promptRequestsEcho = /\b(?:exactly|verbatim|repeat|echo|reply with|say)\b/i.test(prompt);
  if (!promptRequestsEcho && normalizedResponse.length >= 24 && normalizedPrompt.includes(normalizedResponse)) {
    return { ok: false, reason: "echoed the prompt back" };
  }
  const lines = response.split(/\n+/).map((line) => line.trim()).filter((line) => line.length > 2);
  if (lines.length >= 6) {
    const counts = new Map<string, number>();
    for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
    if (Math.max(...counts.values()) / lines.length > 0.6) {
      return { ok: false, reason: "repetition loop" };
    }
  }
  return { ok: true };
}

export function classifyAdaptiveModelFailure(message: string): Exclude<AdaptiveModelOutcome, "success"> {
  const text = (message || "").toLowerCase();
  if (/(^|\D)429(\D|$)|rate.?limit|too many request|capacity|overloaded|quota|resource.?exhausted|temporarily (?:unavailable|rate)|try again later|provider.* busy|(^|\D)(502|503)(\D|$)/.test(text)) return "capacity";
  if (/model.{0,20}not.?found|(^|\D)404(\D|$)|invalid model|unsupported model|no allowed providers|no endpoints|does not support|deprecated/.test(text)) return "unsupported";
  return "failure";
}

export async function recordAdaptiveModelOutcome(modelId: string, outcome: AdaptiveModelOutcome, detail?: string) {
  const id = modelId.trim();
  if (!id) return;
  const store = await loadReliabilityStore();
  const record: ModelReliabilityRecord = store.models[id] ?? { successes: 0, failures: 0, consecutiveFailures: 0 };
  const now = Date.now();
  record.lastOutcome = outcome;
  if (outcome === "success") {
    record.successes += 1;
    record.consecutiveFailures = 0;
    record.qualityPasses = (record.qualityPasses ?? 0) + 1;
    record.qualityFailStreak = 0;
    record.lastSuccessAt = now;
    record.cooldownUntil = 0;
    record.lastError = undefined;
  } else if (outcome === "low-quality") {
    // The request transported fine — the answer was garbage. Grade it without
    // touching the transport-failure counters, and only bench on a streak.
    record.qualityFails = (record.qualityFails ?? 0) + 1;
    record.qualityFailStreak = (record.qualityFailStreak ?? 0) + 1;
    record.lastFailureAt = now;
    record.lastError = detail?.slice(0, 300);
    if (record.qualityFailStreak >= 2) {
      const escalated = LOW_QUALITY_COOLDOWN_MS * 2 ** Math.min(4, record.qualityFailStreak - 2);
      record.cooldownUntil = now + Math.min(MAX_COOLDOWN_MS, escalated);
    }
  } else {
    record.failures += 1;
    record.consecutiveFailures += 1;
    record.lastFailureAt = now;
    record.lastError = detail?.slice(0, 300);
    const base = outcome === "capacity" ? CAPACITY_COOLDOWN_MS : outcome === "unsupported" ? UNSUPPORTED_COOLDOWN_MS : FAILURE_COOLDOWN_MS;
    const escalated = base * 2 ** Math.min(6, record.consecutiveFailures - 1);
    record.cooldownUntil = now + Math.min(outcome === "unsupported" ? UNSUPPORTED_COOLDOWN_MS : MAX_COOLDOWN_MS, escalated);
  }
  store.models[id] = record;
  persistReliabilityStore(store);
}

function qualityProfile(record: ModelReliabilityRecord | undefined) {
  const passes = record?.qualityPasses ?? 0;
  const fails = record?.qualityFails ?? 0;
  const graded = passes + fails;
  return { graded, ratio: graded ? passes / graded : 1 };
}

function poorQuality(record: ModelReliabilityRecord | undefined) {
  const { graded, ratio } = qualityProfile(record);
  return graded >= QUALITY_MIN_GRADED_SAMPLES && ratio < QUALITY_MIN_PASS_RATIO;
}

/**
 * Reorder ranked candidate ids by observed reliability: models that recently
 * completed a quality-passing request go first (most recent winner leads, so
 * routing sticks to a known-good free model until it hits a limit), untried or
 * neutral models keep their ranking order, models with a poor quality record
 * (mostly-garbage answers) drop behind untried ones, and models inside a
 * failure cooldown move to the back (soonest to recover first) instead of
 * being dropped, as a last resort.
 */
export async function orderAdaptiveModelsByReliability(modelIds: string[]): Promise<string[]> {
  if (modelIds.length < 2) return modelIds;
  const store = await loadReliabilityStore();
  const now = Date.now();
  const recentWinners: string[] = [];
  const neutral: string[] = [];
  const qualityDemoted: string[] = [];
  const cooled: Array<{ id: string; cooldownUntil: number }> = [];
  for (const id of modelIds) {
    const record = store.models[id];
    if (record?.cooldownUntil && record.cooldownUntil > now) {
      cooled.push({ id, cooldownUntil: record.cooldownUntil });
    } else if (poorQuality(record)) {
      qualityDemoted.push(id);
    } else if (record?.lastSuccessAt && now - record.lastSuccessAt < RECENT_SUCCESS_WINDOW_MS) {
      recentWinners.push(id);
    } else {
      neutral.push(id);
    }
  }
  recentWinners.sort((left, right) => {
    const leftRecord = store.models[left];
    const rightRecord = store.models[right];
    return qualityProfile(rightRecord).ratio - qualityProfile(leftRecord).ratio
      || (rightRecord?.lastSuccessAt ?? 0) - (leftRecord?.lastSuccessAt ?? 0);
  });
  qualityDemoted.sort((left, right) => qualityProfile(store.models[right]).ratio - qualityProfile(store.models[left]).ratio);
  cooled.sort((left, right) => left.cooldownUntil - right.cooldownUntil);
  return [...recentWinners, ...neutral, ...qualityDemoted, ...cooled.map((entry) => entry.id)];
}
