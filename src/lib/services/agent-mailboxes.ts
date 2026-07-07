import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { homedir } from "@/lib/home-dir";
import { AGENTIC_INBOX_PROJECT_DIR, readAgenticInboxStatus } from "@/lib/services/cloudflare/agentic-inbox-setup";
import { createWorkerRoutingRule, readCloudflareRoutingStatus, resolveCloudflareZone } from "@/lib/services/cloudflare/cloudflare-email-api";
import { hiveEnvPresence, hiveEnvValue } from "@/lib/services/shared-hive-env";
import { readMapsAgencyOutboxForCompany } from "@/lib/services/company-outreach-outbox";

const execFileAsync = promisify(execFile);
const STORE_VERSION = 1;
const DEFAULT_CLOUDFLARE_WORKER_NAME = "hivemindos-agentic-inbox";
const DEFAULT_AGENTMAIL_API_BASE_URL = "https://api.agentmail.to";
const DEFAULT_AGENTMAIL_DOMAIN = "agentmail.to";
const AGENTMAIL_CLIENT_ID_PREFIX = "hivemindos-agent-mailbox";
const AGENTMAIL_PROVIDER_KEYS = [
  "AGENTMAIL_API_KEY",
  "AGENTMAIL_API_BASE_URL",
  "AGENTMAIL_API_URL",
  "AGENTMAIL_DOMAIN",
  "HIVEMINDOS_AGENTMAIL_DOMAIN",
] as const;

export type AgentMailboxProviderId = "agentmail" | "cloudflare-agentic-inbox" | "hivemindos-managed" | "none";
export type AgentMailboxStatus = "ready" | "blocked";

export type AgentMailbox = {
  id: string;
  agentId: string;
  agentName: string;
  address: string;
  localPart: string;
  domain: string;
  providerId: AgentMailboxProviderId;
  status: AgentMailboxStatus;
  canSendLiveInternetMail: boolean;
  canReceiveLiveInternetMail: boolean;
  createdAt: string;
  updatedAt: string;
  detail: string;
  providerResourceIds?: Record<string, string>;
};

export type AgentMailboxProviderStatus = {
  id: AgentMailboxProviderId;
  name: string;
  ready: boolean;
  canProvision: boolean;
  canSendLiveInternetMail: boolean;
  canReceiveLiveInternetMail: boolean;
  detail: string;
  domain?: string;
  cloudflare?: {
    accountId?: string;
    zoneId?: string;
    workerName?: string;
    routingStatus?: string;
  };
  agentmail?: {
    apiBaseUrl?: string;
  };
  blockers: string[];
  requiredActions: string[];
  evidence: Array<{ key: string; ok: boolean; detail: string }>;
};

type AgentMailboxStore = {
  version: number;
  mailboxes: AgentMailbox[];
};

type AgentMailInbox = {
  pod_id?: string;
  inbox_id?: string;
  id?: string;
  email?: string;
  client_id?: string;
  display_name?: string;
  metadata?: Record<string, unknown> | null;
  updated_at?: string;
  created_at?: string;
};

/** One thread as returned by `GET /v0/inboxes/{inbox_id}/threads`. */
type AgentMailThread = {
  inbox_id?: string;
  thread_id?: string;
  last_message_id?: string;
  labels?: unknown;
  timestamp?: string;
  received_timestamp?: string;
  sent_timestamp?: string;
  senders?: unknown;
  recipients?: unknown;
  subject?: string;
  preview?: string;
  attachments?: unknown;
  message_count?: number;
  updated_at?: string;
  created_at?: string;
};

type AgentMailErrorEnvelope = {
  name?: string;
  message?: string;
  error?: string;
  errors?: unknown;
};

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export type AgentMailboxCreateInput = {
  agentId: string;
  agentName?: string;
};

export type AgentMailboxProvisionInput = {
  agentId: string;
  agentName: string;
  address: string;
  localPart: string;
  domain: string;
  providerStatus: AgentMailboxProviderStatus;
};

export type AgentMailboxProvisionResult = {
  detail: string;
  address?: string;
  providerResourceIds?: Record<string, string>;
};

export type AgentMailboxCreateOptions = {
  now?: () => Date;
  providerStatus?: AgentMailboxProviderStatus;
  provisionMailbox?: (input: AgentMailboxProvisionInput) => Promise<AgentMailboxProvisionResult>;
};

export type AgentMailboxCreateResult = {
  ok: boolean;
  created: boolean;
  mailbox?: AgentMailbox;
  providerStatus: AgentMailboxProviderStatus;
  error?: string;
};

export function agentMailboxStorePath() {
  return process.env.HIVEMINDOS_AGENT_MAILBOX_STORE_PATH?.trim() || join(homedir(), ".hivemindos", "agent-mailboxes.json");
}

export async function listAgentMailboxes(agentId?: string): Promise<AgentMailbox[]> {
  const store = await readStore();
  const mailboxes = agentId ? store.mailboxes.filter((mailbox) => mailbox.agentId === agentId) : store.mailboxes;
  return mailboxes.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readAgentMailboxOverview(input: { agentId?: string; liveCheck?: boolean } = {}) {
  const [mailboxes, providerStatus] = await Promise.all([
    listAgentMailboxes(input.agentId),
    readAgentMailboxProviderStatus({ liveCheck: Boolean(input.liveCheck) }),
  ]);
  return { mailboxes, providerStatus };
}

export async function createAgentMailbox(input: AgentMailboxCreateInput, options: AgentMailboxCreateOptions = {}): Promise<AgentMailboxCreateResult> {
  const agentId = cleanAgentId(input.agentId);
  const agentName = cleanAgentName(input.agentName || input.agentId);
  const store = await readStore();
  const existing = store.mailboxes.find((mailbox) => mailbox.agentId === agentId && mailbox.status === "ready");
  const providerStatus = options.providerStatus ?? await readAgentMailboxProviderStatus({ liveCheck: true });

  if (existing) {
    return { ok: true, created: false, mailbox: existing, providerStatus };
  }

  if (!providerStatus.ready || !providerStatus.domain) {
    return {
      ok: false,
      created: false,
      providerStatus,
      error: providerStatus.detail,
    };
  }

  const now = (options.now ?? (() => new Date()))().toISOString();
  const localPart = uniqueLocalPart(agentName, agentId, providerStatus.domain, store.mailboxes);
  const address = `${localPart}@${providerStatus.domain}`;
  const provision = await (options.provisionMailbox ?? provisionMailboxWithProvider)({
    agentId,
    agentName,
    address,
    localPart,
    domain: providerStatus.domain,
    providerStatus,
  });
  const provisionedAddress = cleanMailboxAddress(provision.address) || address;
  const provisionedAddressParts = splitMailboxAddress(provisionedAddress, localPart, providerStatus.domain);
  const mailbox: AgentMailbox = {
    id: `mailbox-${randomUUID()}`,
    agentId,
    agentName,
    address: provisionedAddress,
    localPart: provisionedAddressParts.localPart,
    domain: provisionedAddressParts.domain,
    providerId: providerStatus.id,
    status: "ready",
    canSendLiveInternetMail: providerStatus.canSendLiveInternetMail,
    canReceiveLiveInternetMail: providerStatus.canReceiveLiveInternetMail,
    createdAt: now,
    updatedAt: now,
    detail: provision.detail,
    providerResourceIds: provision.providerResourceIds,
  };

  await writeStore({
    ...store,
    mailboxes: [...store.mailboxes, mailbox],
  });
  return { ok: true, created: true, mailbox, providerStatus };
}

export async function readAgentMailboxProviderStatus(input: { liveCheck?: boolean } = {}): Promise<AgentMailboxProviderStatus> {
  if (process.env.HIVEMINDOS_AGENT_MAILBOX_PROVIDER === "disabled") {
    return blockedProviderStatus("none", "Agent mailboxes are disabled for this process.", [
      "Enable a mailbox provider before creating live agent email addresses.",
    ], []);
  }

  const managed = await readManagedMailboxProviderStatus();
  if (managed.ready) return managed;

  const agentmail = await readAgentMailProviderStatus({ liveCheck: Boolean(input.liveCheck) });
  if (agentmail.ready || agentmail.canProvision) return agentmail;

  const cloudflare = await readCloudflareMailboxProviderStatus({ liveCheck: Boolean(input.liveCheck) });
  if (cloudflare.ready || cloudflare.canProvision) return cloudflare;

  return {
    ...cloudflare,
    blockers: [
      ...agentmail.blockers,
      ...cloudflare.blockers,
      "No live mailbox provider is ready. The default user flow must provision mailboxes from a connected provider instead of asking for per-agent mail server settings.",
    ],
    requiredActions: [
      ...agentmail.requiredActions,
      ...cloudflare.requiredActions,
      "Connect AgentMail, a HivemindOS mailbox broker, or a Cloudflare Email Service domain once at the provider level.",
    ],
    evidence: [...managed.evidence, ...agentmail.evidence, ...cloudflare.evidence],
  };
}

async function readAgentMailProviderStatus(input: { liveCheck: boolean }): Promise<AgentMailboxProviderStatus> {
  const evidence: AgentMailboxProviderStatus["evidence"] = [];
  const blockers: string[] = [];
  const requiredActions: string[] = [];
  const presence = Object.fromEntries((await hiveEnvPresence([...AGENTMAIL_PROVIDER_KEYS])).map((item) => [item.key, item]));
  const hasApiKey = Boolean(presence.AGENTMAIL_API_KEY?.present);
  const domain = (await hiveEnvValue("HIVEMINDOS_AGENTMAIL_DOMAIN")) || (await hiveEnvValue("AGENTMAIL_DOMAIN")) || DEFAULT_AGENTMAIL_DOMAIN;
  const apiBaseUrlValue = (await hiveEnvValue("AGENTMAIL_API_BASE_URL")) || (await hiveEnvValue("AGENTMAIL_API_URL")) || DEFAULT_AGENTMAIL_API_BASE_URL;
  let apiBaseUrl = "";

  try {
    apiBaseUrl = normalizeAgentMailApiBaseUrl(apiBaseUrlValue);
  } catch {
    blockers.push("AgentMail API base URL is invalid.");
    requiredActions.push("Fix AGENTMAIL_API_BASE_URL or AGENTMAIL_API_URL before creating AgentMail inboxes.");
  }

  evidence.push({
    key: "agentmail-auth",
    ok: hasApiKey,
    detail: hasApiKey ? "AgentMail API key is present by name only." : "AgentMail API key is not configured.",
  });
  evidence.push({
    key: "agentmail-domain",
    ok: Boolean(domain),
    detail: domain ? `AgentMail mailbox domain is ${domain}.` : "No AgentMail mailbox domain is configured.",
  });
  evidence.push({
    key: "agentmail-api-base",
    ok: Boolean(apiBaseUrl),
    detail: apiBaseUrl ? `AgentMail API base is ${new URL(apiBaseUrl).hostname}.` : "AgentMail API base is not valid.",
  });

  if (!hasApiKey) {
    blockers.push("AgentMail cannot provision live inboxes until AGENTMAIL_API_KEY is configured.");
    requiredActions.push("Add AGENTMAIL_API_KEY to the shared hive env, then agents can create AgentMail inboxes without per-agent mail settings.");
  }

  if (hasApiKey && apiBaseUrl && input.liveCheck) {
    const token = await hiveEnvValue("AGENTMAIL_API_KEY");
    const response = token ? await agentMailRequest<{ inboxes?: AgentMailInbox[] }>(apiBaseUrl, "/v0/inboxes?limit=1", token) : { ok: false as const, error: "AgentMail API key is missing." };
    evidence.push({
      key: "agentmail-live-api",
      ok: response.ok,
      detail: response.ok ? "AgentMail API accepted the configured key." : response.error,
    });
    if (!response.ok) {
      blockers.push(response.error);
      requiredActions.push("Verify AGENTMAIL_API_KEY has inbox access in the AgentMail Console.");
    }
  }

  const ready = Boolean(hasApiKey && domain && apiBaseUrl && blockers.length === 0);
  return {
    id: "agentmail",
    name: "AgentMail",
    ready,
    canProvision: ready,
    canSendLiveInternetMail: ready,
    canReceiveLiveInternetMail: ready,
    detail: ready
      ? `AgentMail can create agent inboxes on ${domain}.`
      : "AgentMail is not ready for one-click live sending and receiving yet.",
    domain,
    agentmail: { apiBaseUrl: apiBaseUrl || undefined },
    blockers: dedupe(blockers),
    requiredActions: dedupe(requiredActions),
    evidence,
  };
}

async function readManagedMailboxProviderStatus(): Promise<AgentMailboxProviderStatus> {
  const apiUrl = process.env.HIVEMINDOS_AGENT_MAILBOX_API_URL?.trim();
  const tokenPresent = Boolean(process.env.HIVEMINDOS_AGENT_MAILBOX_API_TOKEN?.trim());
  const evidence = [
    {
      key: "managed-mailbox-api",
      ok: Boolean(apiUrl),
      detail: apiUrl ? "A managed mailbox broker endpoint is configured." : "No managed mailbox broker endpoint is configured.",
    },
    {
      key: "managed-mailbox-auth",
      ok: tokenPresent,
      detail: tokenPresent ? "Managed mailbox broker auth is available by name only." : "Managed mailbox broker auth is not configured.",
    },
  ];
  if (!apiUrl) {
    return blockedProviderStatus("hivemindos-managed", "HivemindOS managed mailbox broker is not connected.", [
      "Managed mailbox provisioning is unavailable in this install.",
    ], evidence);
  }
  let brokerHost = "";
  try {
    brokerHost = new URL(apiUrl).hostname;
  } catch {
    return blockedProviderStatus("hivemindos-managed", "HivemindOS managed mailbox broker endpoint is invalid.", [
      "Fix the managed mailbox broker endpoint before creating agent mailboxes.",
    ], evidence);
  }
  return {
    id: "hivemindos-managed",
    name: "HivemindOS Mailbox Broker",
    ready: true,
    canProvision: true,
    canSendLiveInternetMail: true,
    canReceiveLiveInternetMail: true,
    detail: "Managed mailbox broker is connected for one-click agent mailbox provisioning.",
    domain: brokerHost,
    blockers: [],
    requiredActions: [],
    evidence,
  };
}

async function readCloudflareMailboxProviderStatus(input: { liveCheck: boolean }): Promise<AgentMailboxProviderStatus> {
  const evidence: AgentMailboxProviderStatus["evidence"] = [];
  const blockers: string[] = [];
  const requiredActions: string[] = [];
  const presence = Object.fromEntries((await hiveEnvPresence([
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_ZONE_ID",
    "CLOUDFLARE_EMAIL_DOMAIN",
    "HIVEMINDOS_AGENT_MAILBOX_DOMAIN",
  ])).map((item) => [item.key, item]));
  const hasToken = Boolean(presence.CLOUDFLARE_API_TOKEN?.present);
  const hasAccount = Boolean(presence.CLOUDFLARE_ACCOUNT_ID?.present);
  evidence.push({
    key: "cloudflare-auth",
    ok: hasToken && hasAccount,
    detail: hasToken && hasAccount
      ? "Cloudflare account credentials are present by name only."
      : "Cloudflare account credentials are not ready for mailbox provisioning.",
  });

  if (!hasToken || !hasAccount) {
    blockers.push("Cloudflare cannot provision live agent mailboxes until account auth is connected.");
    requiredActions.push("Connect Cloudflare once in the provider setup, then agents can create mailboxes without protocol settings.");
  }

  const token = hasToken ? await hiveEnvValue("CLOUDFLARE_API_TOKEN") : "";
  const accountId = hasAccount ? await hiveEnvValue("CLOUDFLARE_ACCOUNT_ID") : "";
  const configuredDomain = (await hiveEnvValue("HIVEMINDOS_AGENT_MAILBOX_DOMAIN")) || (await hiveEnvValue("CLOUDFLARE_EMAIL_DOMAIN"));
  const configuredZoneId = await hiveEnvValue("CLOUDFLARE_ZONE_ID");
  const zone = token ? await resolveCloudflareZone({ token, accountId, configuredDomain, configuredZoneId, liveCheck: input.liveCheck }) : undefined;

  if (zone?.error) {
    blockers.push(zone.error);
    requiredActions.push("Choose one Cloudflare email domain for agent mailboxes in provider setup.");
    evidence.push({ key: "cloudflare-domain", ok: false, detail: zone.error });
  } else if (zone?.zone) {
    evidence.push({
      key: "cloudflare-domain",
      ok: true,
      detail: `Cloudflare email domain resolved as ${zone.zone.name}.`,
    });
  } else {
    blockers.push("No Cloudflare email domain is selected for agent mailboxes.");
    requiredActions.push("Choose one Cloudflare Email Service domain once; individual agents should not configure mail servers.");
    evidence.push({
      key: "cloudflare-domain",
      ok: false,
      detail: "No mailbox domain is selected.",
    });
  }

  const scaffoldExists = existsSync(join(AGENTIC_INBOX_PROJECT_DIR, "wrangler.jsonc"));
  evidence.push({
    key: "agentic-inbox-worker",
    ok: scaffoldExists,
    detail: scaffoldExists ? "Agentic Inbox Worker scaffold exists." : "Agentic Inbox Worker scaffold has not been created.",
  });
  if (!scaffoldExists) {
    blockers.push("Agentic Inbox Worker is not scaffolded yet.");
    requiredActions.push("Use Apps & Services to set up the Agentic Inbox Worker once.");
  }

  const routingStatus = token && zone?.zone?.id && input.liveCheck
    ? await readCloudflareRoutingStatus(token, zone.zone.id)
    : undefined;
  if (routingStatus) {
    evidence.push({
      key: "cloudflare-email-routing",
      ok: routingStatus.ok,
      detail: routingStatus.detail,
    });
    if (!routingStatus.ok) {
      blockers.push(routingStatus.detail);
      requiredActions.push("Enable Cloudflare Email Routing for the selected domain.");
    }
  }

  const sendingStatus = token && accountId && zone?.zone?.name && input.liveCheck
    ? await readCloudflareSendingStatus({ token, accountId, domain: zone.zone.name })
    : undefined;
  if (sendingStatus) {
    evidence.push({
      key: "cloudflare-email-sending",
      ok: sendingStatus.ok,
      detail: sendingStatus.detail,
    });
    if (!sendingStatus.ok) {
      blockers.push(sendingStatus.detail);
      requiredActions.push("Enable Cloudflare Email Sending for the selected domain or update the token permissions so HivemindOS can verify it.");
    }
  }

  const domain = zone?.zone?.name;
  const canReceive = Boolean(token && zone?.zone?.id && scaffoldExists && (!routingStatus || routingStatus.ok));
  const canSend = Boolean(token && accountId && domain && (!input.liveCheck || sendingStatus?.ok));
  const ready = Boolean(domain && canReceive && canSend && blockers.length === 0);

  return {
    id: "cloudflare-agentic-inbox",
    name: "Cloudflare Agentic Inbox",
    ready,
    canProvision: Boolean(domain && canReceive),
    canSendLiveInternetMail: canSend,
    canReceiveLiveInternetMail: canReceive,
    detail: ready
      ? `Agent mailboxes can be created on ${domain}.`
      : "Cloudflare Agentic Inbox is not ready for one-click live sending and receiving yet.",
    domain,
    cloudflare: {
      accountId: accountId ? "present" : undefined,
      zoneId: zone?.zone?.id,
      workerName: DEFAULT_CLOUDFLARE_WORKER_NAME,
      routingStatus: routingStatus?.status,
    },
    blockers: dedupe(blockers),
    requiredActions: dedupe(requiredActions),
    evidence,
  };
}

async function provisionMailboxWithProvider(input: AgentMailboxProvisionInput): Promise<AgentMailboxProvisionResult> {
  if (input.providerStatus.id === "agentmail") {
    return provisionAgentMailMailbox(input);
  }
  if (input.providerStatus.id === "cloudflare-agentic-inbox") {
    return provisionCloudflareMailbox(input);
  }
  throw new Error(`${input.providerStatus.name} does not expose a mailbox provisioner in this build.`);
}

async function provisionAgentMailMailbox(input: AgentMailboxProvisionInput): Promise<AgentMailboxProvisionResult> {
  const token = await hiveEnvValue("AGENTMAIL_API_KEY");
  const apiBaseUrl = input.providerStatus.agentmail?.apiBaseUrl
    || normalizeAgentMailApiBaseUrl((await hiveEnvValue("AGENTMAIL_API_BASE_URL")) || (await hiveEnvValue("AGENTMAIL_API_URL")) || DEFAULT_AGENTMAIL_API_BASE_URL);
  if (!token) throw new Error("AgentMail mailbox provider is missing AGENTMAIL_API_KEY.");
  const clientId = agentMailClientId(input.agentId);
  const response = await agentMailRequest<AgentMailInbox>(apiBaseUrl, "/v0/inboxes", token, {
    method: "POST",
    body: {
      username: input.localPart,
      domain: input.domain,
      display_name: input.agentName,
      client_id: clientId,
      metadata: {
        hivemindos_agent_id: input.agentId.slice(0, 256),
        hivemindos_agent_name: input.agentName.slice(0, 256),
        hivemindos_provider: "agentmail",
      },
    },
  });
  if (!response.ok) throw new Error(response.error);
  const inbox = response.result ?? {};
  const address = cleanMailboxAddress(inbox.email) || cleanMailboxAddress(inbox.inbox_id) || input.address;
  return {
    address,
    detail: `Created AgentMail inbox ${address}.`,
    providerResourceIds: compactRecord({
      inboxId: inbox.inbox_id || inbox.id || address,
      podId: inbox.pod_id,
      clientId: inbox.client_id || clientId,
      apiBaseUrl: new URL(apiBaseUrl).hostname,
    }),
  };
}

async function provisionCloudflareMailbox(input: AgentMailboxProvisionInput): Promise<AgentMailboxProvisionResult> {
  const token = await hiveEnvValue("CLOUDFLARE_API_TOKEN");
  const zoneId = input.providerStatus.cloudflare?.zoneId;
  const workerName = input.providerStatus.cloudflare?.workerName || DEFAULT_CLOUDFLARE_WORKER_NAME;
  if (!token || !zoneId) throw new Error("Cloudflare mailbox provider is missing a verified zone.");
  const response = await createWorkerRoutingRule(token, zoneId, {
    address: input.address,
    ruleName: `HivemindOS ${input.agentName}`,
    workerName,
  });
  if (!response.ok) {
    throw new Error(response.error || "Cloudflare routing rule creation failed.");
  }
  return {
    detail: `Created Cloudflare Email Routing rule for ${input.address}.`,
    providerResourceIds: {
      routingRuleId: response.result?.id || "",
      workerName,
    },
  };
}

async function readCloudflareSendingStatus(input: { token: string; accountId: string; domain: string }) {
  const command = await run("npx", ["--no-install", "wrangler", "email", "sending", "list"], 45_000, {
    CLOUDFLARE_API_TOKEN: input.token,
    CLOUDFLARE_ACCOUNT_ID: input.accountId,
  });
  if (!command.ok) {
    return {
      ok: false,
      detail: compactCommandDetail(command.stderr || command.stdout || "Cloudflare Email Sending status could not be verified."),
    };
  }
  return {
    ok: outputMentionsDomain(command.stdout, input.domain),
    detail: outputMentionsDomain(command.stdout, input.domain)
      ? `Cloudflare Email Sending is enabled for ${input.domain}.`
      : `Cloudflare Email Sending did not report ${input.domain} as an onboarded sending domain.`,
  };
}

async function agentMailRequest<T>(
  apiBaseUrl: string,
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: true; result?: T } | { ok: false; error: string }> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch((error: unknown) => error instanceof Error ? error : new Error("AgentMail request failed."));
  if (response instanceof Error) return { ok: false, error: response.message };
  const payload = await response.json().catch(() => ({})) as T & AgentMailErrorEnvelope;
  if (!response.ok) return { ok: false, error: agentMailErrorMessage(payload, response.status) };
  return { ok: true, result: payload };
}

async function run(command: string, args: string[], timeout: number, extraEnv: Record<string, string>): Promise<CommandResult> {
  return execFileAsync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout,
    maxBuffer: 1_000_000,
    env: {
      ...process.env,
      ...extraEnv,
    },
  }).then(
    ({ stdout, stderr }) => ({ ok: true, stdout, stderr }),
    (error: unknown) => {
      const maybe = error as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, stdout: maybe.stdout ?? "", stderr: maybe.stderr ?? maybe.message ?? "" };
    },
  );
}

async function readStore(): Promise<AgentMailboxStore> {
  const raw = await readFile(agentMailboxStorePath(), "utf8").catch(() => "");
  if (!raw.trim()) return { version: STORE_VERSION, mailboxes: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<AgentMailboxStore>;
    return {
      version: STORE_VERSION,
      mailboxes: Array.isArray(parsed.mailboxes) ? parsed.mailboxes.filter(isAgentMailbox) : [],
    };
  } catch {
    return { version: STORE_VERSION, mailboxes: [] };
  }
}

async function writeStore(store: AgentMailboxStore) {
  const file = agentMailboxStorePath();
  await mkdir(dirname(file), { recursive: true });
  const temporaryPath = `${file}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({ version: STORE_VERSION, mailboxes: store.mailboxes }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, file);
}

function isAgentMailbox(value: unknown): value is AgentMailbox {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<AgentMailbox>;
  return typeof record.id === "string"
    && typeof record.agentId === "string"
    && typeof record.address === "string"
    && typeof record.providerId === "string";
}

function cleanAgentId(value: string) {
  const cleaned = value.trim();
  if (!cleaned) throw new Error("agentId is required.");
  if (cleaned.length > 160) throw new Error("agentId is too long.");
  return cleaned;
}

function cleanAgentName(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Agent";
  return cleaned.slice(0, 80);
}

function uniqueLocalPart(agentName: string, agentId: string, domain: string, mailboxes: AgentMailbox[]) {
  const base = slugLocalPart(agentName) || "agent";
  const used = new Set(mailboxes.filter((mailbox) => mailbox.domain === domain).map((mailbox) => mailbox.localPart));
  const suffix = slugLocalPart(agentId).slice(0, 8) || randomUUID().slice(0, 8);
  const first = `agent-${base}`.slice(0, 48);
  if (!used.has(first)) return first;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${first}-${index}`.slice(0, 63);
    if (!used.has(candidate)) return candidate;
  }
  return `${first}-${suffix}`.slice(0, 63);
}

function slugLocalPart(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .replace(/_/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function cleanMailboxAddress(value: unknown) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim();
  return /^[^@\s]+@[^@\s]+$/.test(cleaned) ? cleaned : "";
}

function splitMailboxAddress(address: string, fallbackLocalPart: string, fallbackDomain: string) {
  const at = address.lastIndexOf("@");
  if (at <= 0 || at >= address.length - 1) return { localPart: fallbackLocalPart, domain: fallbackDomain };
  return {
    localPart: address.slice(0, at),
    domain: address.slice(at + 1).toLowerCase(),
  };
}

function normalizeAgentMailApiBaseUrl(value: string) {
  const url = new URL(value.trim() || DEFAULT_AGENTMAIL_API_BASE_URL);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("AgentMail API base URL must use http or https.");
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v0$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function agentMailClientId(agentId: string) {
  const slug = agentId
    .trim()
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._~-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 96);
  const digest = createHash("sha256").update(agentId).digest("hex").slice(0, 12);
  return `${AGENTMAIL_CLIENT_ID_PREFIX}-${slug ? `${slug}-` : ""}${digest}`;
}

function legacyAgentMailClientId(agentId: string) {
  return `${AGENTMAIL_CLIENT_ID_PREFIX}:${agentId}`;
}

function agentMailErrorMessage(payload: AgentMailErrorEnvelope, status: number) {
  if (typeof payload.message === "string" && payload.message.trim()) return compactProviderDetail(payload.message);
  if (typeof payload.error === "string" && payload.error.trim()) return compactProviderDetail(payload.error);
  if (Array.isArray(payload.errors) && payload.errors.length) return compactProviderDetail(JSON.stringify(payload.errors).slice(0, 500));
  return `AgentMail API returned HTTP ${status}.`;
}

function blockedProviderStatus(
  id: AgentMailboxProviderId,
  detail: string,
  blockers: string[],
  evidence: AgentMailboxProviderStatus["evidence"],
): AgentMailboxProviderStatus {
  return {
    id,
    name: id === "hivemindos-managed" ? "HivemindOS Mailbox Broker" : "Agent Mailboxes",
    ready: false,
    canProvision: false,
    canSendLiveInternetMail: false,
    canReceiveLiveInternetMail: false,
    detail,
    blockers,
    requiredActions: [],
    evidence,
  };
}

function outputMentionsDomain(output: string, domain: string) {
  return new RegExp(`(^|[^A-Za-z0-9.-])${escapeRegExp(domain)}([^A-Za-z0-9.-]|$)`, "i").test(output);
}

function compactCommandDetail(value: string) {
  return value
    .replace(/https:\/\/api\.cloudflare\.com\/client\/v4\/[^\s]+/g, "Cloudflare API endpoint")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280) || "Cloudflare command failed.";
}

function compactProviderDetail(value: string) {
  return value
    .replace(/https:\/\/api\.agentmail\.[^\s/]+\/[^\s]+/g, "AgentMail API endpoint")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280) || "Provider command failed.";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupe(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function compactRecord(values: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim())));
}

// ── Reading email threads (the Zero Human Companies "Emails" tab) ────────────
// Everything above PROVISIONS inboxes; this reads what those inboxes have
// actually exchanged so the board can stream a crew's real outreach and the
// replies that came back. Read-only: no send/reply happens here.
//
// This is provider-agnostic: every readable mail provider registers a reader in
// MAIL_PROVIDER_READERS and normalizes into the shared CompanyEmailThread shape.
// Adding a provider is one entry + one reader — the API route and UI are generic.
//   - agentmail: threads API, inboxes resolved cross-machine by the client_id we
//     stamp at provisioning (`hivemindos-agent-mailbox-...`) + metadata,
//     with the per-machine local store as a fast-path supplement.
//   - cloudflare-agentic-inbox: the deployed Worker's /api/inbox/messages store
//     (inbound only), filtered to the company's Cloudflare mailbox addresses.
// (ClawBank is intentionally NOT a mail provider: its only comms tool is
// `discover_coms_users`, a user directory — it exposes no readable inbox.)

export type MailProviderId = "agentmail" | "cloudflare-agentic-inbox" | "maps-agency-outbox";
export type CompanyEmailDirection = "outbound" | "inbound" | "mixed" | "queued";

/** A clickable link surfaced from an email body (CTA / booking / preview). */
export type CompanyEmailLink = { label: string; url: string };
/** A real file attachment, when the provider exposes one. */
export type CompanyEmailAttachment = { name: string; url?: string };

/** A normalized outreach thread from any provider, UI-ready. */
export type CompanyEmailThread = {
  /** Stable, unique per (provider, inbox, thread) — safe as a React key. */
  id: string;
  /** Which mail provider this thread came from. */
  provider: MailProviderId;
  providerLabel: string;
  /** Company member agent that owns the inbox (when resolvable). */
  agentId?: string;
  inboxAddress: string;
  threadId: string;
  subject: string;
  preview: string;
  /** The non-inbox participants — the leads/prospects on the other side. */
  correspondents: string[];
  direction: CompanyEmailDirection;
  messageCount: number;
  attachmentCount: number;
  /** Full body of the representative message, when available (for the detail view). Capped. */
  body?: string;
  /** Notable links embedded in the email (CTA / booking / preview), openable in the detail view. */
  links?: CompanyEmailLink[];
  /** Real file attachments, when the provider exposes them. */
  attachments?: CompanyEmailAttachment[];
  /** Epoch ms of the most recent activity, for sorting/display. */
  updatedAt: number;
  labels: string[];
};

export type CompanyMailboxStatus = "ready" | "issue" | "unknown";

/** One agent mailbox for the company, for the "Mailboxes" roster view. */
export type CompanyMailbox = {
  /** Company member agent that owns this mailbox (absent for account-level providers). */
  agentId?: string;
  provider: MailProviderId;
  providerLabel: string;
  address: string;
  /** "issue" surfaces broken/undeployed/blocked mailboxes as attention cards. */
  status: CompanyMailboxStatus;
  /** Why it's an issue (or a short ready detail). */
  detail?: string;
  /** Threads attributed to this mailbox (filled after threads are merged). */
  threadCount: number;
};

/** Per-provider status the UI shows so an empty tab is legible. */
export type MailProviderSummary = {
  id: MailProviderId;
  label: string;
  /** Provider is configured/reachable (regardless of whether it has threads). */
  connected: boolean;
  /** Inboxes resolved for this company on this provider. */
  inboxCount: number;
  threadCount: number;
  /** Honest one-line status (why it's empty, or an error). */
  note?: string;
};

export type CompanyEmailThreadsResult = {
  /** True when ANY provider is connected. */
  configured: boolean;
  /** One-line headline status for the UI. */
  detail: string;
  providers: MailProviderSummary[];
  /** Every resolved agent mailbox, with per-mailbox issue status + thread count. */
  mailboxes: CompanyMailbox[];
  threads: CompanyEmailThread[];
  /** True when more threads exist than the returned cap. */
  truncated: boolean;
};

/** What a single provider reader returns to the orchestrator. */
export type MailReaderResult = {
  connected: boolean;
  /** Resolved mailboxes for this company on this provider (threadCount filled later). */
  mailboxes: CompanyMailbox[];
  threads: CompanyEmailThread[];
  note?: string;
};

/** Everything a provider reader needs to scope mail to one company. */
export type MailReaderContext = {
  /** The company's member agent ids (mailbox-per-agent providers key off these). */
  agentIds: string[];
  /** The company id — providers whose source is the company itself (its outreach
   *  engine outbox) scope by this rather than by agent ids. */
  companyId: string;
  /** Project-registry id of the company's domain code repo, when set. */
  projectId?: string;
};

type MailProviderReader = {
  id: MailProviderId;
  label: string;
  read: (ctx: MailReaderContext) => Promise<MailReaderResult>;
};

const MAIL_PROVIDER_LABELS: Record<MailProviderId, string> = {
  agentmail: "AgentMail",
  "cloudflare-agentic-inbox": "Cloudflare Inbox",
  "maps-agency-outbox": "Outreach Engine",
};

const COMPANY_EMAIL_MAX_INBOXES = 12; // bound inbox fan-out per company/provider
const COMPANY_EMAIL_THREADS_PER_INBOX = 20; // AgentMail page size per inbox
const COMPANY_EMAIL_TOTAL_LIMIT = 40; // merged threads returned to the UI
const COMPANY_EMAIL_INBOX_PAGES = 5; // bound the AgentMail inbox-list sweep
const CLOUDFLARE_INBOX_MESSAGE_LIMIT = 100; // Worker /api/inbox/messages cap

const MAIL_PROVIDER_READERS: MailProviderReader[] = [
  { id: "agentmail", label: MAIL_PROVIDER_LABELS.agentmail, read: readAgentMailForCompany },
  { id: "cloudflare-agentic-inbox", label: MAIL_PROVIDER_LABELS["cloudflare-agentic-inbox"], read: readCloudflareInboxForCompany },
  { id: "maps-agency-outbox", label: MAIL_PROVIDER_LABELS["maps-agency-outbox"], read: readMapsAgencyOutboxForCompany },
];

/**
 * Read a company's outreach threads across every mail provider. Runs each
 * provider's reader independently (one failing never sinks the others), merges
 * threads newest-first, and reports honest per-provider status so an empty tab
 * explains itself: not-connected vs. no-mailboxes vs. mailboxes-live-no-threads.
 */
export async function readCompanyEmailThreads(input: {
  agentIds: string[];
  companyId: string;
  projectId?: string;
  totalLimit?: number;
}): Promise<CompanyEmailThreadsResult> {
  const agentIds = dedupe((input.agentIds ?? []).map((id) => (typeof id === "string" ? id.trim() : "")));
  const totalLimit = clampInt(input.totalLimit ?? COMPANY_EMAIL_TOTAL_LIMIT, 1, 200);
  const ctx: MailReaderContext = {
    agentIds,
    companyId: typeof input.companyId === "string" ? input.companyId.trim() : "",
    projectId: typeof input.projectId === "string" ? input.projectId.trim() || undefined : undefined,
  };

  const results = await Promise.all(
    MAIL_PROVIDER_READERS.map(async (reader) => {
      try {
        return { reader, ...(await reader.read(ctx)) };
      } catch (error) {
        return {
          reader,
          connected: false,
          mailboxes: [] as CompanyMailbox[],
          threads: [] as CompanyEmailThread[],
          note: error instanceof Error ? error.message : `${reader.label} lookup failed.`,
        };
      }
    }),
  );

  const merged = results.flatMap((r) => r.threads).sort((left, right) => right.updatedAt - left.updatedAt);
  const mailboxes = results.flatMap((r) => r.mailboxes);
  // Attribute merged threads back to each mailbox by provider + inbox address.
  for (const mailbox of mailboxes) {
    const addr = mailbox.address.trim().toLowerCase();
    mailbox.threadCount = merged.filter(
      (thread) => thread.provider === mailbox.provider && thread.inboxAddress.trim().toLowerCase() === addr,
    ).length;
  }
  mailboxes.sort((left, right) => {
    if ((left.status === "issue") !== (right.status === "issue")) return left.status === "issue" ? -1 : 1;
    if (left.threadCount !== right.threadCount) return right.threadCount - left.threadCount;
    return left.address.localeCompare(right.address);
  });

  const providers: MailProviderSummary[] = results.map((r) => ({
    id: r.reader.id,
    label: r.reader.label,
    connected: r.connected,
    inboxCount: r.mailboxes.length,
    threadCount: r.threads.length,
    note: r.note,
  }));
  const truncated = merged.length > totalLimit;
  return {
    configured: providers.some((p) => p.connected),
    detail: composeMailDetail(providers, merged.length, truncated, totalLimit, agentIds.length),
    providers,
    mailboxes,
    threads: merged.slice(0, totalLimit),
    truncated,
  };
}

function composeMailDetail(
  providers: MailProviderSummary[],
  threadCount: number,
  truncated: boolean,
  totalLimit: number,
  agentCount: number,
): string {
  if (agentCount === 0 && threadCount === 0) return "Staff this company with agents to give it mailboxes.";
  const connected = providers.filter((p) => p.connected);
  if (connected.length === 0) {
    return providers.find((p) => p.note)?.note || "No mail provider is connected yet.";
  }
  if (threadCount === 0) {
    const inboxes = connected.reduce((sum, p) => sum + p.inboxCount, 0);
    const names = connected.map((p) => p.label).join(", ");
    return inboxes > 0
      ? `Mailboxes are live across ${names} — no threads yet. Outreach the crew sends will stream here.`
      : `Connected to ${names}, but no mailboxes are provisioned for this crew yet.`;
  }
  const shown = truncated ? totalLimit : threadCount;
  const perProvider = connected.filter((p) => p.threadCount > 0).map((p) => `${p.label} (${p.threadCount})`).join(", ");
  return `${shown}${truncated ? ` of ${threadCount}` : ""} thread${threadCount === 1 ? "" : "s"} across ${perProvider}.`;
}

// ── AgentMail provider ───────────────────────────────────────────────────────
async function readAgentMailForCompany({ agentIds }: MailReaderContext): Promise<MailReaderResult> {
  const token = await hiveEnvValue("AGENTMAIL_API_KEY");
  if (!token) return { connected: false, mailboxes: [], threads: [], note: "AgentMail isn't connected (set AGENTMAIL_API_KEY)." };

  let apiBaseUrl: string;
  try {
    apiBaseUrl = normalizeAgentMailApiBaseUrl(
      (await hiveEnvValue("AGENTMAIL_API_BASE_URL")) || (await hiveEnvValue("AGENTMAIL_API_URL")) || DEFAULT_AGENTMAIL_API_BASE_URL,
    );
  } catch {
    return { connected: false, mailboxes: [], threads: [], note: "AgentMail API base URL is misconfigured." };
  }
  if (agentIds.length === 0) return { connected: true, mailboxes: [], threads: [] };

  const inboxes = await resolveAgentMailInboxes({ agentIds, apiBaseUrl, token });
  const mailboxes: CompanyMailbox[] = inboxes.map((inbox) => ({
    agentId: inbox.agentId,
    provider: "agentmail",
    providerLabel: MAIL_PROVIDER_LABELS.agentmail,
    address: inbox.address,
    status: inbox.blocked ? "issue" : "ready",
    detail: inbox.blocked ? inbox.detail || "Mailbox is blocked." : undefined,
    threadCount: 0,
  }));
  if (inboxes.length === 0) return { connected: true, mailboxes, threads: [] };

  const perInbox = await Promise.all(
    inboxes.slice(0, COMPANY_EMAIL_MAX_INBOXES).map(async (inbox) => {
      const response = await agentMailRequest<{ threads?: AgentMailThread[] }>(
        apiBaseUrl,
        `/v0/inboxes/${encodeURIComponent(inbox.inboxId)}/threads?limit=${COMPANY_EMAIL_THREADS_PER_INBOX}`,
        token,
      );
      if (!response.ok) return [] as CompanyEmailThread[];
      return (response.result?.threads ?? []).map((thread) => normalizeAgentMailThread(thread, inbox));
    }),
  );
  return { connected: true, mailboxes, threads: perInbox.flat() };
}

type ResolvedAgentMailInbox = { agentId?: string; inboxId: string; address: string; blocked?: boolean; detail?: string };

/**
 * Map a company's member agent ids to their AgentMail inboxes. Merges the local
 * per-machine store (fast path) with a bounded sweep of AgentMail's own inbox
 * list matched by the provisioning-time `client_id` / metadata — so a mailbox
 * provisioned on any fleet machine still resolves here. Deduped by inbox id.
 */
async function resolveAgentMailInboxes(input: {
  agentIds: string[];
  apiBaseUrl: string;
  token: string;
}): Promise<ResolvedAgentMailInbox[]> {
  const clientIdToAgent = new Map(input.agentIds.flatMap((agentId) => [
    [agentMailClientId(agentId), agentId] as const,
    [legacyAgentMailClientId(agentId), agentId] as const,
  ]));
  const wantedAgentIds = new Set(input.agentIds);
  const found = new Map<string, ResolvedAgentMailInbox>();

  // Fast path: the local store, if this machine provisioned the mailboxes.
  for (const agentId of input.agentIds) {
    for (const mailbox of await listAgentMailboxes(agentId)) {
      if (mailbox.providerId !== "agentmail") continue;
      const inboxId = mailbox.providerResourceIds?.inboxId || mailbox.address;
      const blocked = mailbox.status !== "ready";
      if (inboxId && !found.has(inboxId)) {
        found.set(inboxId, { agentId, inboxId, address: mailbox.address, blocked, detail: blocked ? mailbox.detail : undefined });
      }
    }
  }

  // Cross-machine source of truth: AgentMail's inbox list, matched by client_id
  // / metadata. Paginated with a hard page cap so one tab open can't sweep an
  // arbitrarily large account.
  let pageToken = "";
  for (let page = 0; page < COMPANY_EMAIL_INBOX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (pageToken) query.set("page_token", pageToken);
    const response = await agentMailRequest<{ inboxes?: AgentMailInbox[]; next_page_token?: string }>(
      input.apiBaseUrl,
      `/v0/inboxes?${query.toString()}`,
      input.token,
    );
    if (!response.ok) break;
    for (const inbox of response.result?.inboxes ?? []) {
      const inboxId = inbox.inbox_id || inbox.id;
      if (!inboxId) continue;
      const clientId = typeof inbox.client_id === "string" ? inbox.client_id : "";
      const metaAgentId = readMetadataAgentId(inbox.metadata);
      const matchedAgentId = clientIdToAgent.get(clientId) ?? (metaAgentId && wantedAgentIds.has(metaAgentId) ? metaAgentId : undefined);
      if (!matchedAgentId) continue;
      const address = cleanMailboxAddress(inbox.email) || cleanMailboxAddress(inboxId);
      const existing = found.get(inboxId);
      if (existing) {
        if (!existing.agentId) existing.agentId = matchedAgentId;
        if (!existing.address && address) existing.address = address;
      } else {
        found.set(inboxId, { agentId: matchedAgentId, inboxId, address: address || inboxId });
      }
    }
    pageToken = typeof response.result?.next_page_token === "string" ? response.result.next_page_token : "";
    if (!pageToken) break;
  }

  return [...found.values()];
}

function normalizeAgentMailThread(thread: AgentMailThread, inbox: { agentId?: string; inboxId: string; address: string }): CompanyEmailThread {
  const self = inbox.address.trim().toLowerCase();
  const isSelf = (participant: string) => Boolean(self) && participant.toLowerCase().includes(self);
  const senders = parseParticipants(thread.senders);
  const recipients = parseParticipants(thread.recipients);
  const correspondents = dedupe([...senders, ...recipients].filter((participant) => !isSelf(participant)));
  const hasSent = Boolean(thread.sent_timestamp) || senders.some(isSelf);
  const hasReceived = Boolean(thread.received_timestamp) || recipients.some(isSelf);
  const direction: CompanyEmailDirection = hasSent && hasReceived ? "mixed" : hasReceived && !hasSent ? "inbound" : "outbound";
  const threadId = (thread.thread_id || thread.last_message_id || "").trim() || `${inbox.inboxId}-thread`;
  return {
    id: `agentmail:${inbox.inboxId}:${threadId}`,
    provider: "agentmail",
    providerLabel: MAIL_PROVIDER_LABELS.agentmail,
    agentId: inbox.agentId,
    inboxAddress: inbox.address,
    threadId,
    subject: (thread.subject || "").trim() || "(no subject)",
    preview: (thread.preview || "").trim(),
    correspondents,
    direction,
    messageCount: Math.max(1, Math.round(Number(thread.message_count) || 1)),
    attachmentCount: parseCount(thread.attachments),
    updatedAt:
      parseTimestampMs(thread.updated_at)
      || parseTimestampMs(thread.timestamp)
      || parseTimestampMs(thread.sent_timestamp)
      || parseTimestampMs(thread.received_timestamp)
      || parseTimestampMs(thread.created_at)
      || 0,
    labels: parseParticipants(thread.labels),
  };
}

// ── Per-thread detail (full body + real attachments) ─────────────────────────
// The thread LIST stays lean (subject/preview/counts). The Emails tab detail
// modal fetches the full body + attachments on open, per provider, keyed off the
// thread id prefix. The maps-agency outbox already ships its body in the list, so
// the modal never asks us for it. AgentMail is fetched from its documented message
// API; Cloudflare needs a Worker message-detail endpoint that isn't deployed yet.

type AgentMailAttachment = { attachment_id?: string; filename?: string; content_type?: string; size?: number; content_disposition?: string };
type AgentMailMessage = { message_id?: string; text?: string; html?: string; preview?: string; attachments?: AgentMailAttachment[]; timestamp?: string };
type AgentMailThreadDetail = { messages?: AgentMailMessage[] };

export type CompanyEmailThreadDetail = {
  body?: string;
  links?: CompanyEmailLink[];
  attachments?: CompanyEmailAttachment[];
  /** Honest one-line reason when a provider can't return a full body yet. */
  note?: string;
};

/**
 * Full body + attachments for one thread, dispatched by the provider encoded in
 * the thread id (`agentmail:<inboxId>:<threadId>` / `cloudflare:<id>` /
 * `maps-agency-outbox:…`). Returns {} for providers whose body already rode the
 * list payload (the outbox), so the caller falls back to the thread it already has.
 */
export async function readCompanyEmailThreadDetail(input: { threadId: string }): Promise<CompanyEmailThreadDetail> {
  const threadId = (input.threadId || "").trim();
  if (threadId.startsWith("agentmail:")) {
    const rest = threadId.slice("agentmail:".length);
    const split = rest.indexOf(":");
    const inboxId = split >= 0 ? rest.slice(0, split) : "";
    const providerThreadId = split >= 0 ? rest.slice(split + 1) : rest;
    if (!inboxId || !providerThreadId) return { note: "Malformed AgentMail thread id." };
    return readAgentMailThreadDetail(inboxId, providerThreadId);
  }
  if (threadId.startsWith("cloudflare:")) {
    return { note: "Cloudflare inbox message bodies aren't available yet — the inbox Worker needs its message-detail endpoint deployed." };
  }
  // maps-agency-outbox and any future body-in-list provider: nothing to fetch.
  return {};
}

export type CompanyEmailReplyResult = { messageId?: string; threadId?: string };

/**
 * Reply into an existing company email thread (used by the mobile inbox).
 * Only AgentMail threads carry real inbound bodies + a reply path today, so
 * Cloudflare inbox and Outreach-outbox threads throw a clear "not supported
 * yet" error rather than silently dropping the reply. The provider is encoded
 * in the thread id, exactly like readCompanyEmailThreadDetail.
 */
export async function replyToCompanyEmailThread(input: {
  threadId: string;
  text: string;
  html?: string;
}): Promise<CompanyEmailReplyResult> {
  const threadId = (input.threadId || "").trim();
  const text = (input.text || "").trim();
  if (!text) throw new Error("Reply text is required.");
  if (threadId.startsWith("agentmail:")) {
    const rest = threadId.slice("agentmail:".length);
    const split = rest.indexOf(":");
    const inboxId = split >= 0 ? rest.slice(0, split) : "";
    const providerThreadId = split >= 0 ? rest.slice(split + 1) : rest;
    if (!inboxId || !providerThreadId) throw new Error("Malformed AgentMail thread id.");
    return replyToAgentMailThread(inboxId, providerThreadId, text, input.html);
  }
  if (threadId.startsWith("cloudflare:")) {
    throw new Error("Replies to Cloudflare inbox threads aren't supported yet.");
  }
  throw new Error("This thread can't be replied to.");
}

async function replyToAgentMailThread(
  inboxId: string,
  threadId: string,
  text: string,
  html?: string,
): Promise<CompanyEmailReplyResult> {
  const token = await hiveEnvValue("AGENTMAIL_API_KEY");
  if (!token) throw new Error("AgentMail isn't connected (set AGENTMAIL_API_KEY).");
  const apiBaseUrl = normalizeAgentMailApiBaseUrl(
    (await hiveEnvValue("AGENTMAIL_API_BASE_URL")) || (await hiveEnvValue("AGENTMAIL_API_URL")) || DEFAULT_AGENTMAIL_API_BASE_URL,
  );
  // The reply endpoint is keyed by message id, so resolve the thread's latest
  // message first (the same lookup the detail view uses).
  const thread = await agentMailRequest<AgentMailThreadDetail>(
    apiBaseUrl,
    `/v0/inboxes/${encodeURIComponent(inboxId)}/threads/${encodeURIComponent(threadId)}`,
    token,
  );
  if (!thread.ok) throw new Error(thread.error);
  const messages = Array.isArray(thread.result?.messages) ? thread.result!.messages! : [];
  const latest = messages[messages.length - 1];
  if (!latest?.message_id) throw new Error("This thread has no message to reply to.");
  // Omit `to`/`reply_all` so AgentMail addresses the reply to the original
  // sender by default.
  const reply = await agentMailRequest<{ message_id?: string; thread_id?: string }>(
    apiBaseUrl,
    `/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(latest.message_id)}/reply`,
    token,
    { method: "POST", body: { text, ...(html ? { html } : {}) } },
  );
  if (!reply.ok) throw new Error(reply.error);
  return { messageId: reply.result?.message_id, threadId: reply.result?.thread_id };
}

async function readAgentMailThreadDetail(inboxId: string, threadId: string): Promise<CompanyEmailThreadDetail> {
  const token = await hiveEnvValue("AGENTMAIL_API_KEY");
  if (!token) return { note: "AgentMail isn't connected (set AGENTMAIL_API_KEY)." };
  let apiBaseUrl: string;
  try {
    apiBaseUrl = normalizeAgentMailApiBaseUrl(
      (await hiveEnvValue("AGENTMAIL_API_BASE_URL")) || (await hiveEnvValue("AGENTMAIL_API_URL")) || DEFAULT_AGENTMAIL_API_BASE_URL,
    );
  } catch {
    return { note: "AgentMail API base URL is misconfigured." };
  }

  const response = await agentMailRequest<AgentMailThreadDetail>(
    apiBaseUrl,
    `/v0/inboxes/${encodeURIComponent(inboxId)}/threads/${encodeURIComponent(threadId)}`,
    token,
  );
  if (!response.ok) return { note: "Couldn't load this AgentMail thread." };
  const messages = Array.isArray(response.result?.messages) ? response.result!.messages! : [];
  const latest = messages[messages.length - 1] ?? {};
  const body = (latest.text || htmlToPlainText(latest.html) || latest.preview || "").trim().slice(0, 20000);
  const links = extractLinksFromText(body);

  // Resolve a presigned download URL per attachment (bounded; only on modal open).
  const attachments: CompanyEmailAttachment[] = [];
  for (const attachment of (latest.attachments ?? []).slice(0, 12)) {
    if (!attachment.filename) continue;
    let url: string | undefined;
    if (attachment.attachment_id && latest.message_id) {
      const download = await agentMailRequest<{ download_url?: string }>(
        apiBaseUrl,
        `/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(latest.message_id)}/attachments/${encodeURIComponent(attachment.attachment_id)}`,
        token,
      );
      if (download.ok && typeof download.result?.download_url === "string") url = download.result.download_url;
    }
    attachments.push({ name: attachment.filename, url });
  }
  return { body, links, attachments };
}

/** Loose http(s) links from a plain-text body, deduped and capped. */
function extractLinksFromText(text: string): CompanyEmailLink[] {
  const urls = new Set<string>();
  const matches = text.match(/https?:\/\/[^\s<>")\]]+/g);
  if (matches) for (const match of matches) urls.add(match.replace(/[.,);]+$/, ""));
  const out: CompanyEmailLink[] = [];
  for (const url of urls) {
    if (out.length >= 8) break;
    out.push({ label: "Link", url });
  }
  return out;
}

/** Minimal HTML→text fallback for when a message has no plain-text part. */
function htmlToPlainText(html?: string): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Cloudflare Agentic Inbox provider ────────────────────────────────────────
// The deployed Worker keeps every received email in one Durable-Object store and
// exposes POST /api/inbox/messages ({ id, sender, recipient, subject, receivedAt }).
// It's inbound-only, so each message becomes a one-message inbound thread. We
// resolve the company's Cloudflare mailbox addresses from the local store and
// keep only messages addressed to them.
type CloudflareInboxMessage = { id?: string; sender?: string; recipient?: string; subject?: string; receivedAt?: string };

async function readCloudflareInboxForCompany({ agentIds }: MailReaderContext): Promise<MailReaderResult> {
  // Resolve this company's Cloudflare mailboxes from the local store first, so a
  // provisioned-but-undeployed inbox still shows up as an issue card.
  const cfMailboxes: CompanyMailbox[] = [];
  const addressToAgent = new Map<string, string>();
  for (const agentId of agentIds) {
    for (const mailbox of await listAgentMailboxes(agentId)) {
      if (mailbox.providerId !== "cloudflare-agentic-inbox" || !mailbox.address) continue;
      const address = mailbox.address.trim();
      if (addressToAgent.has(address.toLowerCase())) continue;
      addressToAgent.set(address.toLowerCase(), agentId);
      cfMailboxes.push({
        agentId,
        provider: "cloudflare-agentic-inbox",
        providerLabel: MAIL_PROVIDER_LABELS["cloudflare-agentic-inbox"],
        address,
        status: mailbox.status === "ready" ? "ready" : "issue",
        detail: mailbox.status === "ready" ? undefined : mailbox.detail,
        threadCount: 0,
      });
    }
  }

  // If this company has no Cloudflare mailboxes, there is nothing provider-specific
  // to read. Avoid the full Agentic Inbox deployment/status probe here; it shells
  // out to Wrangler and does live Cloudflare checks, which made the Comms tab wait
  // many seconds even when every visible email came from another provider.
  if (cfMailboxes.length === 0) return { connected: false, mailboxes: [], threads: [] };

  const markIssue = (detail: string): CompanyMailbox[] => cfMailboxes.map((mb) => ({ ...mb, status: "issue", detail }));

  const status = await readAgenticInboxStatus();
  const workerUrl = status.openUrl?.trim();
  if (!workerUrl) {
    return { connected: false, mailboxes: markIssue("Cloudflare Agentic Inbox isn't deployed yet."), threads: [], note: "Cloudflare Agentic Inbox isn't deployed yet." };
  }
  const response = await fetch(`${workerUrl.replace(/\/+$/, "")}/api/inbox/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: CLOUDFLARE_INBOX_MESSAGE_LIMIT }),
  }).catch((error: unknown) => (error instanceof Error ? error : new Error("Cloudflare inbox request failed.")));
  if (response instanceof Error) return { connected: true, mailboxes: markIssue(response.message), threads: [], note: response.message };

  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; messages?: CloudflareInboxMessage[] };
  if (!response.ok || payload.ok === false) {
    return { connected: true, mailboxes: markIssue("Cloudflare inbox did not return messages."), threads: [], note: "Cloudflare inbox did not return messages." };
  }

  const threads: CompanyEmailThread[] = [];
  for (const message of payload.messages ?? []) {
    const recipient = (message.recipient || "").trim().toLowerCase();
    const match = [...addressToAgent.entries()].find(([addr]) => recipient.includes(addr));
    if (!match) continue; // only this company's Cloudflare addresses
    const [, agentId] = match;
    const threadId = (message.id || "").trim() || `msg-${threads.length}`;
    threads.push({
      id: `cloudflare:${threadId}`,
      provider: "cloudflare-agentic-inbox",
      providerLabel: MAIL_PROVIDER_LABELS["cloudflare-agentic-inbox"],
      agentId,
      inboxAddress: message.recipient || match[0],
      threadId,
      subject: (message.subject || "").trim() || "(no subject)",
      preview: "",
      correspondents: message.sender ? [message.sender.trim()] : [],
      direction: "inbound",
      messageCount: 1,
      attachmentCount: 0,
      updatedAt: parseTimestampMs(message.receivedAt),
      labels: ["received"],
    });
  }
  return { connected: true, mailboxes: cfMailboxes, threads };
}

/** Parse an AgentMail participant/label list — tolerant of string or object entries. */
function parseParticipants(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) out.push(trimmed);
    } else if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const label = String(record.email ?? record.address ?? record.name ?? "").trim();
      if (label) out.push(label);
    }
  }
  return out;
}

function parseCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (Array.isArray(value)) return value.length;
  return 0;
}

function parseTimestampMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value.trim());
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

function readMetadataAgentId(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  const value = (metadata as Record<string, unknown>).hivemindos_agent_id;
  return typeof value === "string" ? value.trim() : "";
}

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded)) return min;
  return Math.max(min, Math.min(max, rounded));
}
