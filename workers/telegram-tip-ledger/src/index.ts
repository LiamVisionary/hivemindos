type R2ObjectListItem = { key: string; size: number; uploaded?: Date; etag?: string };
type R2Object = { body: ReadableStream; httpEtag: string };
type R2Bucket = {
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ objects: R2ObjectListItem[]; truncated: boolean; cursor?: string }>;
  get(key: string): Promise<R2Object | null>;
};

type ExportedHandler<TEnv> = {
  fetch(request: Request, env: TEnv): Promise<Response>;
};

type Env = {
  BACKUPS: R2Bucket;
  ADMIN_TOKEN?: string;
  READ_TOKEN?: string;
  CORS_ORIGIN?: string;
};

type TipBotState = {
  version: 1;
  settings?: Record<string, unknown>;
  users?: Record<string, unknown>;
  usernameIndex?: Record<string, string>;
  balances?: Record<string, string>;
  ledger?: Array<Record<string, unknown>>;
  deposits?: Record<string, unknown>;
  withdrawals?: Array<Record<string, unknown>>;
  claims?: Record<string, unknown>;
  bounties?: Record<string, unknown>;
  memberTags?: Record<string, unknown>;
  updatedAt?: string;
};

type StateEnvelope = {
  state: TipBotState;
  savedAt: string;
  version: 1;
};

const SNAPSHOT_PREFIX = "telegram-tip-bot/snapshots/";
const LATEST_KEY = `${SNAPSHOT_PREFIX}latest.json`;

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: jsonHeaders(env) });
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return ok(env, { ok: true, service: "hivemindos-telegram-tip-ledger" });
      }
      if (request.method === "GET" && url.pathname === "/summary") {
        requireRead(request, env);
        const state = await readState(env);
        if (!state) return fail(env, "Tip bot state has not been initialized.", 404);
        return ok(env, summarizeState(state));
      }
      if (request.method === "GET" && url.pathname === "/state") {
        requireAdmin(request, env);
        const state = await readState(env);
        if (!state) return fail(env, "Tip bot state has not been initialized.", 404);
        return ok(env, { state });
      }
      if (request.method === "POST" && url.pathname === "/state") {
        requireAdmin(request, env);
        const payload = await request.json().catch(() => null) as { state?: TipBotState } | null;
        if (!isState(payload?.state)) return fail(env, "Invalid tip bot state payload.", 400);
        const savedAt = new Date().toISOString();
        const state = normalizeState(payload.state, savedAt);
        const envelope: StateEnvelope = { state, savedAt, version: 1 };
        const body = JSON.stringify(envelope, null, 2);
        await env.BACKUPS.put(LATEST_KEY, body, {
          httpMetadata: { contentType: "application/json; charset=utf-8" },
          customMetadata: { savedAt, source: "telegram-tip-bot", latest: "true" },
        });
        const objectKey = `${SNAPSHOT_PREFIX}${savedAt.replace(/[:.]/g, "-")}.json`;
        await env.BACKUPS.put(objectKey, body, {
          httpMetadata: { contentType: "application/json; charset=utf-8" },
          customMetadata: { savedAt, source: "telegram-tip-bot" },
        });
        return ok(env, { ok: true, savedAt, backupKey: objectKey, summary: summarizeState(state) });
      }
      if (request.method === "GET" && url.pathname === "/backups") {
        requireAdmin(request, env);
        const listed = await env.BACKUPS.list({ prefix: SNAPSHOT_PREFIX, limit: 1000 });
        const objects = listed.objects
          .filter((item) => item.key !== `${SNAPSHOT_PREFIX}latest.json`)
          .map((item) => ({ key: item.key, size: item.size, uploaded: item.uploaded?.toISOString(), etag: item.etag }))
          .sort((a, b) => String(b.uploaded).localeCompare(String(a.uploaded)));
        return ok(env, { objects, truncated: listed.truncated, cursor: listed.cursor });
      }
      if (request.method === "GET" && url.pathname.startsWith("/backups/")) {
        requireAdmin(request, env);
        const key = decodeURIComponent(url.pathname.slice("/backups/".length));
        if (!key.startsWith(SNAPSHOT_PREFIX)) return fail(env, "Backup key must be under telegram-tip-bot/snapshots/.", 400);
        const object = await env.BACKUPS.get(key);
        if (!object) return fail(env, "Backup not found.", 404);
        return new Response(object.body, { headers: { ...jsonHeaders(env), "ETag": object.httpEtag } });
      }
      return fail(env, "Not found.", 404);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Internal tip ledger error.";
      return fail(env, message, status);
    }
  },
};

export default worker;

async function readState(env: Env): Promise<TipBotState | null> {
  const object = await env.BACKUPS.get(LATEST_KEY);
  if (!object) return null;
  const raw = await new Response(object.body).text();
  const parsed = JSON.parse(raw) as StateEnvelope | { state?: TipBotState } | TipBotState;
  const state = "state" in parsed && parsed.state ? parsed.state : parsed as TipBotState;
  return isState(state) ? normalizeState(state, state.updatedAt) : null;
}

function normalizeState(state: TipBotState, fallbackUpdatedAt?: string): TipBotState {
  state.settings ??= {};
  state.users ??= {};
  state.usernameIndex ??= {};
  state.balances ??= {};
  state.ledger ??= [];
  state.deposits ??= {};
  state.withdrawals ??= [];
  state.claims ??= {};
  state.bounties ??= {};
  state.memberTags ??= { chatIds: [], lastSynced: {} };
  state.updatedAt ||= fallbackUpdatedAt || new Date().toISOString();
  return state;
}

function summarizeState(state: TipBotState) {
  return {
    ok: true,
    updatedAt: state.updatedAt,
    settings: {
      paused: Boolean(state.settings?.paused),
      tokenSymbol: String(state.settings?.tokenSymbol ?? "HIVE"),
      botUsername: state.settings?.botUsername ? String(state.settings.botUsername) : undefined,
      lastScannedBlock: state.settings?.lastScannedBlock ? String(state.settings.lastScannedBlock) : undefined,
    },
    counts: {
      users: Object.keys(state.users ?? {}).length,
      usernames: Object.keys(state.usernameIndex ?? {}).length,
      balances: Object.keys(state.balances ?? {}).length,
      ledger: (state.ledger ?? []).length,
      deposits: Object.keys(state.deposits ?? {}).length,
      withdrawals: (state.withdrawals ?? []).length,
      claims: Object.keys(state.claims ?? {}).length,
      bounties: Object.keys(state.bounties ?? {}).length,
    },
  };
}

function isState(value: unknown): value is TipBotState {
  if (!value || typeof value !== "object") return false;
  return (value as { version?: unknown }).version === 1;
}

function requireRead(request: Request, env: Env) {
  const readToken = env.READ_TOKEN || env.ADMIN_TOKEN;
  if (!readToken) throw new HttpError("Tip ledger read token is not configured.", 500);
  if (bearer(request) !== readToken && bearer(request) !== env.ADMIN_TOKEN) throw new HttpError("Unauthorized.", 401);
}

function requireAdmin(request: Request, env: Env) {
  if (!env.ADMIN_TOKEN) throw new HttpError("Tip ledger admin token is not configured.", 500);
  if (bearer(request) !== env.ADMIN_TOKEN) throw new HttpError("Unauthorized.", 401);
}

function bearer(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function ok(env: Env, payload: unknown) {
  return new Response(JSON.stringify(payload, null, 2), { headers: jsonHeaders(env) });
}

function fail(env: Env, message: string, status: number) {
  return new Response(JSON.stringify({ ok: false, error: message }, null, 2), { status, headers: jsonHeaders(env) });
}

function jsonHeaders(env: Env) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": env.CORS_ORIGIN ?? "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
  };
}

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
