// Local brain bridge for Hive Research (hivemindos.app/research).
//
// The /research page runs in a browser on the SAME machine as this app, so it
// can query the local shared brain directly and attach a bounded recall
// snippet to a hosted analysis — brain content never gets stored on hosted
// infra beyond the single run that used it. The surface is deliberately tiny:
// a hello probe and a READ-ONLY recall endpoint, both origin-locked via CORS
// and gated by a dedicated bridge token the user copies from the app once
// (never the dashboard device token — that would grant the whole /api
// surface). Outbound hits are scrubbed: only title/type/date/excerpt leave
// the machine; machine names, tailnet identity, collector URLs, vault paths,
// and Operations/Secure notes never do.

import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { answerFromAgentMemory } from "@/lib/services/obsidian/agent-memory";
import { redactSecretText } from "@/lib/services/agent-security-proxy";
import { optionalEnv } from "@/lib/config/env";

export const RESEARCH_BRIDGE_PROTOCOL = "hivemind.research-bridge.v1";
export const RESEARCH_BRIDGE_TOKEN_HEADER = "x-hivemindos-research-bridge-token";

const TOKEN_PATH = join(homedir(), ".hivemindos", "research-bridge-token");
const TOKEN_PREFIX = "hrb";
const MAX_QUERY_CHARS = 500;
const MAX_HITS = 8;
const MAX_EXCERPT_CHARS = 400;
// Stays under the research-gateway's 4000-char brainContext cap with headroom.
const MAX_SNIPPET_CHARS = 3600;

const DEFAULT_ALLOWED_ORIGINS = ["https://hivemindos.app", "https://www.hivemindos.app"];

function allowedOrigins(): string[] {
  const configured = optionalEnv("HIVEMINDOS_RESEARCH_BRIDGE_ORIGINS");
  const origins = configured
    ? configured.split(",").map((entry) => entry.trim()).filter(Boolean)
    : [...DEFAULT_ALLOWED_ORIGINS];
  // Website development runs on a localhost origin; never widen production.
  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000", "http://127.0.0.1:3000");
  }
  return origins;
}

export function researchBridgeOrigin(origin: string | null): string {
  const value = String(origin ?? "").trim();
  return allowedOrigins().includes(value) ? value : "";
}

export function researchBridgeCorsHeaders(origin: string | null): Headers {
  const allowedOrigin = researchBridgeOrigin(origin);
  const headers = new Headers({
    "Access-Control-Allow-Headers": `Content-Type, ${RESEARCH_BRIDGE_TOKEN_HEADER}`,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });
  if (allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", allowedOrigin);
    // Chromium Private Network Access: an https page fetching 127.0.0.1 sends
    // a PNA preflight and requires this opt-in once enforcement lands.
    headers.set("Access-Control-Allow-Private-Network", "true");
  }
  return headers;
}

export function withResearchBridgeCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  researchBridgeCorsHeaders(origin).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// --- bridge token (dedicated, never the dashboard device token) --------------

function mintToken(): string {
  return `${TOKEN_PREFIX}_${randomBytes(32).toString("base64url")}`;
}

async function readTokenFile(): Promise<string | null> {
  try {
    const raw = await readFile(TOKEN_PATH, "utf8");
    const token = raw.trim();
    return token.startsWith(`${TOKEN_PREFIX}_`) ? token : null;
  } catch {
    return null;
  }
}

async function writeTokenFile(token: string): Promise<void> {
  await mkdir(dirname(TOKEN_PATH), { recursive: true });
  await writeFile(TOKEN_PATH, `${token}\n`, { mode: 0o600 });
}

/** Reads the bridge token, minting one on first use (authed callers only). */
export async function readOrCreateResearchBridgeToken(): Promise<string> {
  const existing = await readTokenFile();
  if (existing) return existing;
  const token = mintToken();
  await writeTokenFile(token);
  return token;
}

/** Rotates the token; every previously paired page must re-paste. */
export async function rotateResearchBridgeToken(): Promise<string> {
  const token = mintToken();
  await writeTokenFile(token);
  return token;
}

export async function researchBridgeTokenConfigured(): Promise<boolean> {
  return (await readTokenFile()) !== null;
}

/** Constant-time verify. A missing token file always fails — verification never mints. */
export async function verifyResearchBridgeToken(presented: string | null): Promise<boolean> {
  const expected = await readTokenFile();
  const candidate = String(presented ?? "").trim();
  if (!expected || !candidate) return false;
  const digest = (value: string) => new Uint8Array(createHash("sha256").update(value).digest());
  return timingSafeEqual(digest(expected), digest(candidate));
}

// --- recall rate limit -----------------------------------------------------------

// Per-process token bucket for POST /api/research-bridge/recall. Even a valid
// stolen bridge token cannot rapidly bulk-exfiltrate the shared brain with
// arbitrary queries: 10 recalls/minute is far above human research pacing.
// In-memory on purpose — the app is one local process, and a restart
// resetting the bucket costs nothing.
const RECALL_BUCKET_CAPACITY = 10;
const RECALL_REFILL_PER_MS = RECALL_BUCKET_CAPACITY / 60_000;

const recallBucket = { tokens: RECALL_BUCKET_CAPACITY, refilledAtMs: 0 };

/** Takes one recall token; false = rate-limited. `nowMs` is injectable for tests. */
export function takeResearchBridgeRecallToken(nowMs = Date.now()): boolean {
  const elapsedMs = Math.max(0, nowMs - recallBucket.refilledAtMs);
  recallBucket.tokens = Math.min(RECALL_BUCKET_CAPACITY, recallBucket.tokens + elapsedMs * RECALL_REFILL_PER_MS);
  recallBucket.refilledAtMs = Math.max(recallBucket.refilledAtMs, nowMs);
  if (recallBucket.tokens < 1) return false;
  recallBucket.tokens -= 1;
  return true;
}

// --- read-only recall ----------------------------------------------------------

export type ResearchBridgeHit = {
  title: string;
  type: string;
  createdAt: string;
  excerpt: string;
};

export type ResearchBridgeRecall = {
  snippet: string;
  hits: ResearchBridgeHit[];
};

function scrubOutboundText(value: string, maxChars: number): string {
  return redactSecretText(String(value ?? "")).text.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

/**
 * Recalls shared-brain memory for an outbound research run. Output carries
 * ONLY title/type/date/excerpt — never machine, tailnet, collector, path, or
 * proof metadata — and every field passes the secret redactor. Secure-folder
 * notes are dropped entirely.
 */
export async function buildResearchBridgeRecall(input: {
  query: string;
  limit?: number;
}): Promise<ResearchBridgeRecall> {
  const query = String(input.query ?? "").trim().slice(0, MAX_QUERY_CHARS);
  if (!query) return { snippet: "", hits: [] };
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit ?? MAX_HITS)), 1), MAX_HITS);

  const result = await answerFromAgentMemory({
    query,
    limit,
    trackUsage: true,
    usageContext: "research-bridge",
  });

  const hits: ResearchBridgeHit[] = [];
  for (const hit of result.hits) {
    const notePath = String((hit as { notePath?: unknown }).notePath ?? "");
    if (/(^|\/)Operations\/Secure(\/|$)/.test(notePath)) continue;
    hits.push({
      title: scrubOutboundText(hit.title, 160),
      type: scrubOutboundText(hit.type, 40),
      createdAt: String(hit.createdAt ?? "").slice(0, 10),
      excerpt: scrubOutboundText(hit.excerpt, MAX_EXCERPT_CHARS),
    });
  }

  const lines: string[] = [];
  let used = 0;
  for (const hit of hits) {
    const line = `- [${hit.type}] ${hit.createdAt} — ${hit.title}: ${hit.excerpt}`;
    if (used + line.length + 1 > MAX_SNIPPET_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }
  return { snippet: lines.join("\n"), hits };
}
