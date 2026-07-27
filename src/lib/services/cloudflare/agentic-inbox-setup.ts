import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { homedir } from "@/lib/home-dir";
import {
  createWorkerRoutingRule,
  enableCloudflareEmailRouting,
  ensureR2Bucket,
  listR2BucketNames,
  listCloudflareZones,
  readCloudflareRoutingStatus,
  resolveCloudflareZone,
  type CloudflareZone,
} from "@/lib/services/cloudflare/cloudflare-email-api";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { AGENTIC_INBOX_BLUEPRINT } from "./agentic-inbox-blueprint";

const execFileAsync = promisify(execFile);
export const AGENTIC_INBOX_PROJECT_DIR = join(homedir(), ".hivemindos", "cloudflare", "agentic-inbox");
export const AGENTIC_INBOX_WORKER_NAME = "hivemindos-agentic-inbox";
export const AGENTIC_INBOX_ATTACHMENTS_BUCKET = "hivemindos-agentic-inbox-attachments";

export type AgenticInboxStatus = {
  id: "agentic-inbox";
  name: string;
  installed: boolean;
  running: boolean;
  openUrl?: string;
  projectDir: string;
  detail: string;
  installMethod: "cloudflare-worker";
  requirements: string[];
  sourceUrl: string;
  mailboxDomain?: string;
  attachmentsBucket: string;
  // `blocking: false` items are readiness hints for a working inbox (domain,
  // Email Routing, R2) that should NOT gate the Deploy button — only the core
  // scaffold/wrangler/auth checks block a deploy.
  preflight: Array<{ key: string; ok: boolean; detail: string; blocking?: boolean }>;
};

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

async function run(command: string, args: string[], timeout = 30_000, cwd = AGENTIC_INBOX_PROJECT_DIR): Promise<CommandResult> {
  return execFileAsync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 1_000_000,
  }).then(
    ({ stdout, stderr }) => ({ ok: true, stdout, stderr }),
    (error: unknown) => {
      const maybe = error as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, stdout: maybe.stdout ?? "", stderr: maybe.stderr ?? maybe.message ?? "" };
    },
  );
}

async function wranglerAvailable() {
  const direct = await run("wrangler", ["--version"], 8_000, process.cwd());
  if (direct.ok) return "Wrangler is installed.";
  const npx = await run("npx", ["--no-install", "wrangler", "--version"], 20_000, process.cwd());
  return npx.ok ? "Wrangler is available through npx." : "";
}

async function wranglerWhoami() {
  const direct = await run("wrangler", ["whoami"], 10_000);
  if (direct.ok) return "Wrangler is authenticated.";
  const npx = await run("npx", ["--no-install", "wrangler", "whoami"], 25_000);
  return npx.ok ? "Wrangler is authenticated." : "";
}

async function readWorkerUrl() {
  const deployed = await readFile(join(AGENTIC_INBOX_PROJECT_DIR, ".hivemindos-deploy.json"), "utf8").catch(() => "");
  if (!deployed) return "";
  try {
    const data = JSON.parse(deployed) as { url?: string };
    return typeof data.url === "string" ? data.url : "";
  } catch {
    return "";
  }
}

const workerSource = `export interface Env {
  INBOX_STORE: DurableObjectNamespace;
  ATTACHMENTS: R2Bucket;
  AI: Ai;
  EMAIL: SendEmail;
  HIVE_CALLBACK_URL?: string;
  HIVE_CALLBACK_TOKEN?: string;
}

type EmailPayload = {
  id?: string;
  from?: string;
  to?: string;
  subject?: string;
  receivedAt?: string;
  headers?: Array<[string, string]>;
  raw?: string;
};

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

function subjectFromHeaders(headers: Array<[string, string]> = []) {
  return headers.find(([key]) => key.toLowerCase() === "subject")?.[1] || "(no subject)";
}

export class InboxStore {
  constructor(private state: DurableObjectState, private env: Env) {}

  private ensureSchema() {
    this.state.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, sender TEXT, recipient TEXT, subject TEXT, received_at TEXT, raw TEXT)"
    );
  }

  async fetch(request: Request) {
    this.ensureSchema();
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/email") return this.saveEmail(await request.json() as EmailPayload);
    if (request.method === "POST" && url.pathname === "/api/inbox/messages") return this.messages(await request.json().catch(() => ({})) as { limit?: number });
    if (request.method === "POST" && url.pathname === "/api/inbox/draft") return this.draft(await request.json().catch(() => ({})) as { id?: string; instruction?: string });
    if (request.method === "POST" && url.pathname === "/api/inbox/approve-send") return this.approveSend(await request.json().catch(() => ({})) as { approved?: boolean; to?: string; from?: string; subject?: string; text?: string; html?: string });
    return json({ ok: false, error: "Unknown inbox route." }, { status: 404 });
  }

  private async saveEmail(payload: EmailPayload) {
    const id = payload.id || crypto.randomUUID();
    const receivedAt = payload.receivedAt || new Date().toISOString();
    const subject = payload.subject || subjectFromHeaders(payload.headers);
    this.state.storage.sql.exec(
      "INSERT OR REPLACE INTO messages (id, sender, recipient, subject, received_at, raw) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      payload.from || "",
      payload.to || "",
      subject,
      receivedAt,
      payload.raw || ""
    );
    await this.forwardTaskIntake({ id, from: payload.from, to: payload.to, subject, receivedAt });
    return json({ ok: true, id });
  }

  private messages(input: { limit?: number }) {
    const limit = Math.min(Math.max(Number(input.limit || 50), 1), 100);
    const rows = [...this.state.storage.sql.exec(
      "SELECT id, sender, recipient, subject, received_at AS receivedAt FROM messages ORDER BY received_at DESC LIMIT ?",
      limit
    )];
    return json({ ok: true, messages: rows });
  }

  private draft(input: { id?: string; instruction?: string }) {
    if (!input.id) return json({ ok: false, error: "id is required." }, { status: 400 });
    const row = [...this.state.storage.sql.exec("SELECT sender, subject, raw FROM messages WHERE id = ?", input.id)][0] as { sender?: string; subject?: string; raw?: string } | undefined;
    if (!row) return json({ ok: false, error: "Message not found." }, { status: 404 });
    const subject = row.subject?.startsWith("Re:") ? row.subject : \`Re: \${row.subject || "your message"}\`;
    const text = [
      "Thanks for the note.",
      "",
      input.instruction ? \`I reviewed it with this instruction: \${input.instruction}\` : "I reviewed it and will follow up shortly.",
      "",
      "Sent from HivemindOS Agentic Inbox after human approval."
    ].join("\\n");
    return json({ ok: true, draft: { to: row.sender || "", subject, text } });
  }

  private async approveSend(input: { approved?: boolean; to?: string; from?: string; subject?: string; text?: string; html?: string }) {
    if (!input.approved) return json({ ok: false, error: "approved must be true before sending." }, { status: 400 });
    if (!input.to || !input.from || !input.subject || !input.text) {
      return json({ ok: false, error: "to, from, subject, and text are required." }, { status: 400 });
    }
    const result = await this.env.EMAIL.send({
      to: input.to,
      from: { email: input.from, name: "HivemindOS" },
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return json({ ok: true, result });
  }

  private async forwardTaskIntake(summary: Record<string, unknown>) {
    if (!this.env.HIVE_CALLBACK_URL) return;
    await fetch(this.env.HIVE_CALLBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.env.HIVE_CALLBACK_TOKEN ? { Authorization: \`Bearer \${this.env.HIVE_CALLBACK_TOKEN}\` } : {}),
      },
      body: JSON.stringify({ source: "agentic-inbox", summary }),
    }).catch(() => undefined);
  }
}

function inboxStub(env: Env) {
  return env.INBOX_STORE.get(env.INBOX_STORE.idFromName("default"));
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "hivemindos-agentic-inbox" });
    if (url.pathname === "/api/hivemind/catalog") {
      return json({
        ok: true,
        service: "hivemindos-agentic-inbox",
        routes: ["/api/inbox/messages", "/api/inbox/draft", "/api/inbox/approve-send"],
      });
    }
    if (url.pathname.startsWith("/api/inbox/")) return inboxStub(env).fetch(request);
    return json({ ok: false, error: "Not found." }, { status: 404 });
  },
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    const raw = await new Response(message.raw).text();
    const payload: EmailPayload = {
      id: crypto.randomUUID(),
      from: message.from,
      to: message.to,
      subject: message.headers.get("subject") || undefined,
      receivedAt: new Date().toISOString(),
      headers: [...message.headers.entries()],
      raw,
    };
    ctx.waitUntil(inboxStub(env).fetch("https://inbox.local/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }));
  },
};
`;

const wranglerConfig = `{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "hivemindos-agentic-inbox",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-14",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [
      { "name": "INBOX_STORE", "class_name": "InboxStore" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["InboxStore"] }
  ],
  "r2_buckets": [
    { "binding": "ATTACHMENTS", "bucket_name": "hivemindos-agentic-inbox-attachments" }
  ],
  "ai": { "binding": "AI" },
  "send_email": [
    { "name": "EMAIL" }
  ],
  "vars": {
    "HIVE_CALLBACK_URL": ""
  }
}
`;

const packageJson = `{
  "name": "hivemindos-agentic-inbox",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "npx wrangler dev",
    "deploy": "npx wrangler deploy",
    "check": "npx wrangler deploy --dry-run"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "latest",
    "typescript": "latest",
    "wrangler": "latest"
  }
}
`;

const readme = `# HivemindOS Agentic Inbox

This project was scaffolded by HivemindOS. It is a deployable Cloudflare Worker that receives Email Routing messages, stores message metadata in a SQLite-backed Durable Object, drafts replies, and only sends replies through the EMAIL binding after an explicit approval call.

## Routes

- \`GET /health\`
- \`GET /api/hivemind/catalog\`
- \`POST /api/inbox/messages\`
- \`POST /api/inbox/draft\`
- \`POST /api/inbox/approve-send\`

## Cloudflare setup

HivemindOS' "Deploy" and "Provision address" actions automate most of this
(R2 bucket creation, the Worker deploy, enabling Email Routing, and the routing
rule). The equivalent manual commands are:

1. Run \`npm install\`.
2. Run \`npx wrangler r2 bucket create hivemindos-agentic-inbox-attachments\` if the bucket does not exist (HivemindOS Deploy does this for you).
3. Deploy with \`npm run deploy\`.
4. Provision an inbound address (HivemindOS Provision does this): enable Email Routing on the domain and add a rule matching your address with a "Send to a Worker" action pointing at \`hivemindos-agentic-inbox\`.
5. Run \`npx wrangler email sending enable <your-domain>\` before outbound replies are sent.
`;

async function writeIfMissing(path: string, content: string) {
  if (existsSync(path)) return false;
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, { mode: 0o600 });
  return true;
}

export async function scaffoldAgenticInbox() {
  await mkdir(join(AGENTIC_INBOX_PROJECT_DIR, "src"), { recursive: true });
  const files = [
    await writeIfMissing(join(AGENTIC_INBOX_PROJECT_DIR, "src", "index.ts"), workerSource),
    await writeIfMissing(join(AGENTIC_INBOX_PROJECT_DIR, "wrangler.jsonc"), wranglerConfig),
    await writeIfMissing(join(AGENTIC_INBOX_PROJECT_DIR, "package.json"), packageJson),
    await writeIfMissing(join(AGENTIC_INBOX_PROJECT_DIR, "README.md"), readme),
  ];
  return { ok: true, createdFiles: files.filter(Boolean).length, projectDir: AGENTIC_INBOX_PROJECT_DIR };
}

type CloudflareContext = {
  token: string;
  accountId: string;
  domain: string;
  zoneId: string;
  zone?: CloudflareZone;
  zoneError?: string;
  availableZones: string[];
};

/** Read the shared Cloudflare mailbox context (the same env keys the mailbox
 *  provider layer uses) and resolve the mailbox zone so preflight and
 *  provisioning agree on one domain. Safe/empty when no token is configured. */
async function readCloudflareContext(): Promise<CloudflareContext> {
  const [token, accountId, mailboxDomain, emailDomain, zoneId] = await Promise.all([
    hiveEnvValue("CLOUDFLARE_API_TOKEN"),
    hiveEnvValue("CLOUDFLARE_ACCOUNT_ID"),
    hiveEnvValue("HIVEMINDOS_AGENT_MAILBOX_DOMAIN"),
    hiveEnvValue("CLOUDFLARE_EMAIL_DOMAIN"),
    hiveEnvValue("CLOUDFLARE_ZONE_ID"),
  ]);
  const domain = (mailboxDomain || emailDomain || "").trim();
  const context: CloudflareContext = { token, accountId, domain, zoneId, availableZones: [] };
  if (!token) return context;
  const resolved = await resolveCloudflareZone({ token, accountId, configuredDomain: domain, configuredZoneId: zoneId, liveCheck: true });
  if (resolved?.zone?.id) context.zone = resolved.zone;
  if (resolved?.error) {
    context.zoneError = resolved.error;
    context.availableZones = (await listCloudflareZones(token, accountId)).map((zone) => zone.name || "").filter(Boolean);
  }
  return context;
}

export async function readAgenticInboxStatus(): Promise<AgenticInboxStatus> {
  const installed = existsSync(join(AGENTIC_INBOX_PROJECT_DIR, "wrangler.jsonc")) && existsSync(join(AGENTIC_INBOX_PROJECT_DIR, "src", "index.ts"));
  const [wrangler, whoami, openUrl, cf] = await Promise.all([
    wranglerAvailable(),
    installed ? wranglerWhoami() : Promise.resolve(""),
    readWorkerUrl(),
    readCloudflareContext(),
  ]);

  // Live Cloudflare readiness for a working inbox (best-effort; only with a token).
  const routing = cf.token && cf.zone?.id
    ? await readCloudflareRoutingStatus(cf.token, cf.zone.id)
    : { ok: false, detail: cf.token ? (cf.zoneError || "Set a Cloudflare mailbox domain to check Email Routing.") : "Add CLOUDFLARE_API_TOKEN to check Email Routing.", status: "unknown", permission: false };
  const bucketList = cf.token && cf.accountId
    ? await listR2BucketNames(cf.token, cf.accountId)
    : { ok: false, names: [] as string[], error: "Add CLOUDFLARE_API_TOKEN to check the attachments bucket.", permission: false };
  const bucketOk = bucketList.ok && bucketList.names.includes(AGENTIC_INBOX_ATTACHMENTS_BUCKET);

  const domainDetail = cf.zone?.name
    ? `Mailbox domain resolved as ${cf.zone.name}.`
    : cf.zoneError
      ? `${cf.zoneError}${cf.availableZones.length ? ` Available zones: ${cf.availableZones.join(", ")} — set CLOUDFLARE_EMAIL_DOMAIN to one.` : ""}`
      : "Set CLOUDFLARE_EMAIL_DOMAIN (or HIVEMINDOS_AGENT_MAILBOX_DOMAIN) to the mailbox domain.";
  const routingDetail = routing.permission
    ? `${routing.detail} Grant the token "Email Routing Rules: Edit" (zone) to enable and verify it.`
    : routing.detail;
  const bucketDetail = bucketOk
    ? `Attachments bucket ${AGENTIC_INBOX_ATTACHMENTS_BUCKET} exists.`
    : bucketList.permission
      ? `${bucketList.error} Grant the token "Workers R2 Storage: Read".`
      : bucketList.ok
        ? `Attachments bucket ${AGENTIC_INBOX_ATTACHMENTS_BUCKET} will be created automatically on Deploy.`
        : bucketList.error || "Attachments bucket not verified yet.";

  const preflight = [
    { key: "scaffold", ok: installed, detail: installed ? `Worker scaffold exists at ${AGENTIC_INBOX_PROJECT_DIR}.` : "Worker scaffold has not been created yet." },
    { key: "wrangler", ok: Boolean(wrangler), detail: wrangler || "Wrangler is required to deploy the inbox Worker." },
    { key: "auth", ok: Boolean(whoami), detail: whoami || "Run wrangler login or provide CLOUDFLARE_API_TOKEN before deploy." },
    { key: "domain", ok: Boolean(cf.zone?.name), detail: domainDetail, blocking: false },
    { key: "email-routing", ok: routing.ok, detail: routingDetail, blocking: false },
    { key: "r2-bucket", ok: bucketOk, detail: bucketDetail, blocking: false },
  ];

  return {
    id: "agentic-inbox",
    name: AGENTIC_INBOX_BLUEPRINT.name,
    installed,
    running: Boolean(openUrl),
    openUrl: openUrl || undefined,
    projectDir: AGENTIC_INBOX_PROJECT_DIR,
    detail: installed
      ? openUrl
        ? `Agentic Inbox is deployed at ${openUrl}.`
        : cf.zone?.name
          ? `Scaffold ready on ${cf.zone.name}. Deploy to create the R2 bucket and publish the Worker, then provision a mailbox address.`
          : "Scaffold ready. Set a Cloudflare mailbox domain (CLOUDFLARE_EMAIL_DOMAIN), then Deploy."
      : "Create the Cloudflare Worker scaffold to set up Agentic Inbox.",
    installMethod: "cloudflare-worker",
    requirements: AGENTIC_INBOX_BLUEPRINT.prerequisites,
    sourceUrl: AGENTIC_INBOX_BLUEPRINT.sourceUrl,
    mailboxDomain: cf.zone?.name || cf.domain || undefined,
    attachmentsBucket: AGENTIC_INBOX_ATTACHMENTS_BUCKET,
    preflight,
  };
}

export async function deployAgenticInbox() {
  await scaffoldAgenticInbox();
  // Auto-create the attachments R2 bucket the Worker binds to — `wrangler deploy`
  // fails when a bound bucket does not exist yet.
  const cf = await readCloudflareContext();
  let bucketNote = "R2 bucket check skipped (no CLOUDFLARE_API_TOKEN).";
  if (cf.token && cf.accountId) {
    const bucket = await ensureR2Bucket(cf.token, cf.accountId, AGENTIC_INBOX_ATTACHMENTS_BUCKET);
    if (!bucket.ok) throw new Error(`Attachments bucket could not be provisioned before deploy: ${bucket.detail}`);
    bucketNote = bucket.detail;
  }
  const install = existsSync(join(AGENTIC_INBOX_PROJECT_DIR, "node_modules"))
    ? { ok: true, stdout: "", stderr: "" }
    : await run("npm", ["install"], 300_000);
  if (!install.ok) throw new Error(install.stderr || "Agentic Inbox dependencies could not be installed.");
  const deploy = await run("npx", ["wrangler", "deploy"], 300_000);
  if (!deploy.ok) throw new Error(deploy.stderr || deploy.stdout || "Agentic Inbox deploy failed.");
  const url = deploy.stdout.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] || "";
  if (url) await writeFile(join(AGENTIC_INBOX_PROJECT_DIR, ".hivemindos-deploy.json"), `${JSON.stringify({ url, deployedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  return { ok: true, message: `Agentic Inbox deploy completed. ${bucketNote}`, output: deploy.stdout, url };
}

export type AgenticInboxProvisionResult = {
  ok: true;
  address: string;
  worker: string;
  routingRuleId: string;
  emailRoutingEnabled: boolean;
};

/** Provision one real inbound mailbox address: resolve the mailbox zone, ensure
 *  Email Routing is enabled, and add a routing rule that delivers that address
 *  into the Agentic Inbox Worker. Requires the token to carry "Email Routing
 *  Rules: Edit" — a 403 is surfaced with the exact scope to grant. */
export async function provisionAgenticInboxAddress(input: { localPart: string }): Promise<AgenticInboxProvisionResult> {
  const localPart = String(input.localPart || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!localPart) throw new Error("A mailbox local part (the text before the @) is required.");
  const cf = await readCloudflareContext();
  if (!cf.token) throw new Error("CLOUDFLARE_API_TOKEN is required to provision an inbox address.");
  if (!cf.zone?.id || !cf.zone?.name) {
    throw new Error(cf.zoneError || "No Cloudflare mailbox domain is configured. Set CLOUDFLARE_EMAIL_DOMAIN to one of your zones first.");
  }
  // Ensure Email Routing is on before adding a rule (idempotent on already-enabled zones).
  const routing = await readCloudflareRoutingStatus(cf.token, cf.zone.id);
  let emailRoutingEnabled = routing.ok;
  if (!routing.ok) {
    const enabled = await enableCloudflareEmailRouting(cf.token, cf.zone.id);
    if (!enabled.ok) {
      const scope = enabled.status === 403 ? ' Grant the token "Email Routing Rules: Edit" (zone) or enable Email Routing in the Cloudflare dashboard.' : "";
      throw new Error(`Email Routing must be enabled on ${cf.zone.name} first: ${enabled.error}.${scope}`);
    }
    emailRoutingEnabled = true;
  }
  const address = `${localPart}@${cf.zone.name}`;
  const rule = await createWorkerRoutingRule(cf.token, cf.zone.id, {
    address,
    ruleName: `HivemindOS Agentic Inbox ${localPart}`,
    workerName: AGENTIC_INBOX_WORKER_NAME,
  });
  if (!rule.ok) {
    const scope = rule.status === 403 ? ' Grant the token "Email Routing Rules: Edit" (zone).' : "";
    throw new Error(`Routing rule creation failed for ${address}: ${rule.error}.${scope}`);
  }
  return { ok: true, address, worker: AGENTIC_INBOX_WORKER_NAME, routingRuleId: rule.result?.id || "", emailRoutingEnabled };
}
