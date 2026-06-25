import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { homedir } from "@/lib/home-dir";
import { AGENTIC_INBOX_PROJECT_DIR } from "@/lib/services/cloudflare/agentic-inbox-setup";
import { hiveEnvPresence, hiveEnvValue } from "@/lib/services/shared-hive-env";

const execFileAsync = promisify(execFile);
const STORE_VERSION = 1;
const DEFAULT_CLOUDFLARE_WORKER_NAME = "hivemindos-agentic-inbox";
const DEFAULT_AGENTMAIL_API_BASE_URL = "https://api.agentmail.to";
const DEFAULT_AGENTMAIL_DOMAIN = "agentmail.to";
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

type CloudflareZone = {
  id?: string;
  name?: string;
  status?: string;
};

type CloudflareRoutingSettings = {
  enabled?: boolean;
  status?: string;
  name?: string;
};

type CloudflareRoutingRule = {
  id?: string;
  enabled?: boolean;
  name?: string;
};

type CloudflareEnvelope<T> = {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
  messages?: Array<{ code?: number; message?: string }>;
};

type AgentMailInbox = {
  pod_id?: string;
  inbox_id?: string;
  id?: string;
  email?: string;
  client_id?: string;
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
  const response = await cloudflareRequest<CloudflareRoutingRule>(`/zones/${encodeURIComponent(zoneId)}/email/routing/rules`, token, {
    method: "POST",
    body: {
      enabled: true,
      name: `HivemindOS ${input.agentName}`,
      matchers: [{ type: "literal", field: "to", value: input.address }],
      actions: [{ type: "worker", value: [workerName] }],
      priority: 0,
    },
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

async function resolveCloudflareZone(input: {
  token: string;
  accountId: string;
  configuredDomain: string;
  configuredZoneId: string;
  liveCheck: boolean;
}): Promise<{ zone?: CloudflareZone; error?: string } | undefined> {
  if (!input.liveCheck) {
    if (input.configuredDomain || input.configuredZoneId) {
      return { zone: { id: input.configuredZoneId || undefined, name: input.configuredDomain || undefined } };
    }
    return undefined;
  }
  if (input.configuredZoneId) {
    const response = await cloudflareRequest<CloudflareZone>(`/zones/${encodeURIComponent(input.configuredZoneId)}`, input.token);
    if (!response.ok) return { error: response.error || "Cloudflare zone lookup failed." };
    return { zone: response.result };
  }
  if (input.configuredDomain) {
    const query = new URLSearchParams({ name: input.configuredDomain, status: "active", per_page: "5" });
    if (input.accountId) query.set("account.id", input.accountId);
    const response = await cloudflareRequest<CloudflareZone[]>(`/zones?${query}`, input.token);
    if (!response.ok) return { error: response.error || "Cloudflare domain lookup failed." };
    const zone = response.result?.find((item) => item.name === input.configuredDomain) ?? response.result?.[0];
    return zone ? { zone } : { error: `Cloudflare domain ${input.configuredDomain} was not found or is not active.` };
  }
  if (!input.accountId) return undefined;
  const query = new URLSearchParams({ "account.id": input.accountId, status: "active", per_page: "50" });
  const response = await cloudflareRequest<CloudflareZone[]>(`/zones?${query}`, input.token);
  if (!response.ok) return { error: response.error || "Cloudflare zones could not be listed." };
  const zones = response.result?.filter((zone) => zone.id && zone.name) ?? [];
  if (zones.length === 1) return { zone: zones[0] };
  if (zones.length > 1) return { error: "Multiple Cloudflare zones are available, so HivemindOS needs one email domain selected once for mailbox provisioning." };
  return { error: "No active Cloudflare zones are available for mailbox provisioning." };
}

async function readCloudflareRoutingStatus(token: string, zoneId: string) {
  const response = await cloudflareRequest<CloudflareRoutingSettings>(`/zones/${encodeURIComponent(zoneId)}/email/routing`, token);
  if (!response.ok) {
    return { ok: false, detail: response.error || "Cloudflare Email Routing status could not be verified.", status: "unknown" };
  }
  const status = response.result?.status || (response.result?.enabled ? "ready" : "unconfigured");
  return {
    ok: response.result?.enabled === true && status === "ready",
    detail: response.result?.enabled === true && status === "ready"
      ? "Cloudflare Email Routing is enabled and ready."
      : `Cloudflare Email Routing is ${status}.`,
    status,
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

async function cloudflareRequest<T>(
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: true; result?: T } | { ok: false; error: string }> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch((error: unknown) => error instanceof Error ? error : new Error("Cloudflare request failed."));
  if (response instanceof Error) return { ok: false, error: response.message };
  const payload = await response.json().catch(() => ({})) as CloudflareEnvelope<T>;
  if (!response.ok || payload.success === false) {
    return {
      ok: false,
      error: payload.errors?.map((error) => error.message || `Cloudflare error ${error.code}`).filter(Boolean).join("; ")
        || `Cloudflare API returned HTTP ${response.status}.`,
    };
  }
  return { ok: true, result: payload.result };
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
  return `hivemindos-agent-mailbox:${agentId}`;
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
