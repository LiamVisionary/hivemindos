// hivemindos-issues — collects anonymized client health reports (e.g. a desktop
// install that can't reach its local dashboard service and is stuck on a loading
// screen) so broken installs are visible centrally without asking users to open
// devtools. POST /issues is open (bounded by a per-install daily cap + size
// limits); GET /issues is bearer-gated for the operator.

type Env = {
  DB: D1Database;
  CORS_ORIGIN?: string;
  DAILY_REPORT_CAP?: string;
  ISSUES_READ_TOKEN?: string;
};

type IssueReport = {
  kind?: unknown;
  severity?: unknown;
  installId?: unknown;
  appVersion?: unknown;
  commit?: unknown;
  platform?: unknown;
  detail?: unknown;
  failureKind?: unknown;
  status?: unknown;
  attempt?: unknown;
  context?: unknown;
};

const MAX_BODY_BYTES = 8_192;
const MAX_FIELD = 200;
const MAX_DETAIL = 500;
const MAX_CONTEXT = 2_000;
const KNOWN_SEVERITIES = new Set(["info", "warning", "error", "critical"]);

const corsHeaders = (env: Env) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": env.CORS_ORIGIN ?? "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
});

const json = (env: Env, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(env) });

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Replace ASCII control characters (code < 32, or DEL) with spaces.
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : char;
  }
  return out.trim().slice(0, max);
}

function intOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

// Fingerprint that collapses repeated occurrences of the same problem from the
// same install into one row. Deliberately excludes attempt/detail so a retry
// loop updates a single row.
function fingerprint(parts: string[]): string {
  return parts.map((part) => part.replace(/\|/g, "/").slice(0, 64)).join("|").slice(0, 320);
}

async function handleReport(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(env, { ok: false, error: "Report too large." }, 413);

  let body: IssueReport;
  try {
    body = JSON.parse(raw) as IssueReport;
  } catch {
    return json(env, { ok: false, error: "Invalid JSON." }, 400);
  }

  const kind = clean(body.kind, MAX_FIELD);
  if (!kind) return json(env, { ok: false, error: "Missing kind." }, 400);

  const installId = clean(body.installId, MAX_FIELD) || "anonymous";
  const severityRaw = clean(body.severity, MAX_FIELD).toLowerCase();
  const severity = KNOWN_SEVERITIES.has(severityRaw) ? severityRaw : "error";
  const appVersion = clean(body.appVersion, MAX_FIELD);
  const commit = clean(body.commit, MAX_FIELD);
  const platform = clean(body.platform, MAX_FIELD);
  const detail = clean(body.detail, MAX_DETAIL);
  const failureKind = clean(body.failureKind, MAX_FIELD);
  const status = intOrNull(body.status);
  const attempt = intOrNull(body.attempt);
  const context = clean(typeof body.context === "string" ? body.context : JSON.stringify(body.context ?? null), MAX_CONTEXT);

  const now = new Date().toISOString();
  const day = utcDay(now);
  const cap = intOrNull(env.DAILY_REPORT_CAP) ?? 200;

  // Per-install daily cap. Bump first; if over, drop silently (still 200 so the
  // client never retries a rejected report).
  await env.DB.prepare(
    `INSERT INTO report_quota (install_id, day, count) VALUES (?1, ?2, 1)
     ON CONFLICT(install_id, day) DO UPDATE SET count = count + 1`,
  ).bind(installId, day).run();
  const quota = await env.DB.prepare(
    `SELECT count FROM report_quota WHERE install_id = ?1 AND day = ?2`,
  ).bind(installId, day).first<{ count: number }>();
  if (quota && quota.count > cap) {
    return json(env, { ok: true, accepted: false, reason: "daily-cap" });
  }

  const id = fingerprint([installId, kind, appVersion, failureKind, status === null ? "" : String(status)]);

  await env.DB.prepare(
    `INSERT INTO issues
       (id, kind, severity, install_id, app_version, commit_sha, platform, detail,
        failure_kind, status_code, attempt, context, count, created_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, ?13, ?13)
     ON CONFLICT(id) DO UPDATE SET
       count = count + 1,
       last_seen_at = ?13,
       detail = ?8,
       attempt = ?11,
       context = ?12,
       app_version = ?5,
       commit_sha = ?6,
       platform = ?7,
       severity = ?3`,
  ).bind(
    id, kind, severity, installId, appVersion, commit, platform, detail,
    failureKind, status, attempt, context, now,
  ).run();

  return json(env, { ok: true, accepted: true });
}

async function handleList(request: Request, env: Env, url: URL): Promise<Response> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!env.ISSUES_READ_TOKEN || token !== env.ISSUES_READ_TOKEN) {
    return json(env, { ok: false, error: "Unauthorized." }, 401);
  }
  const limit = Math.min(Math.max(intOrNull(url.searchParams.get("limit")) ?? 100, 1), 500);
  const kind = clean(url.searchParams.get("kind"), MAX_FIELD);
  const query = kind
    ? env.DB.prepare(`SELECT * FROM issues WHERE kind = ?1 ORDER BY last_seen_at DESC LIMIT ?2`).bind(kind, limit)
    : env.DB.prepare(`SELECT * FROM issues ORDER BY last_seen_at DESC LIMIT ?1`).bind(limit);
  const result = await query.all();
  return json(env, { ok: true, count: result.results.length, issues: result.results });
}

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(env) });
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json(env, { ok: true, service: "hivemindos-issues" });
      }
      if (request.method === "POST" && url.pathname === "/issues") {
        return await handleReport(request, env);
      }
      if (request.method === "GET" && url.pathname === "/issues") {
        return await handleList(request, env, url);
      }
      return json(env, { ok: false, error: "Not found." }, 404);
    } catch (error) {
      return json(env, { ok: false, error: error instanceof Error ? error.message : "Unexpected error." }, 500);
    }
  },
};

export default worker;
