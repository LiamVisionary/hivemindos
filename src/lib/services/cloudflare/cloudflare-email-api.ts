// Shared Cloudflare REST client for the agent-mail / agentic-inbox surfaces.
//
// This is the single canonical place that talks to `api.cloudflare.com/client/v4`
// for HivemindOS email infrastructure: zone resolution, Email Routing status,
// Email Routing rule creation, and R2 bucket provisioning for attachments.
// Both the mailbox provider layer (`agent-mailboxes.ts`) and the Agentic Inbox
// setup flow (`agentic-inbox-setup.ts`) import from here so the two surfaces
// share one auth path and one request/error shape instead of each rolling their
// own. Kept dependency-free (only `fetch`) so it can be imported by either file
// without an import cycle.

export type CloudflareZone = {
  id?: string;
  name?: string;
  status?: string;
};

export type CloudflareRoutingSettings = {
  enabled?: boolean;
  status?: string;
  name?: string;
};

export type CloudflareRoutingRule = {
  id?: string;
  enabled?: boolean;
  name?: string;
};

export type CloudflareEnvelope<T> = {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
  messages?: Array<{ code?: number; message?: string }>;
};

export type CloudflareResult<T> = { ok: true; result?: T } | { ok: false; error: string; status?: number };

export async function cloudflareRequest<T>(
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
): Promise<CloudflareResult<T>> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch((error: unknown) => (error instanceof Error ? error : new Error("Cloudflare request failed.")));
  if (response instanceof Error) return { ok: false, error: response.message };
  const payload = (await response.json().catch(() => ({}))) as CloudflareEnvelope<T>;
  if (!response.ok || payload.success === false) {
    return {
      ok: false,
      status: response.status,
      error:
        payload.errors?.map((error) => error.message || `Cloudflare error ${error.code}`).filter(Boolean).join("; ") ||
        `Cloudflare API returned HTTP ${response.status}.`,
    };
  }
  return { ok: true, result: payload.result };
}

/** True when a failed Cloudflare response is an authorization/permission problem
 *  (the token is valid but is not scoped for this resource) rather than a
 *  missing/absent resource. Used to give actionable "grant permission X" copy. */
export function isCloudflarePermissionError(result: { ok: false; status?: number; error: string }) {
  return result.status === 403 || /\b(403|forbidden|not authorized|permission|authentication error)\b/i.test(result.error);
}

export async function resolveCloudflareZone(input: {
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

/** List active zones so the UI can offer a domain picker instead of a free-text field. */
export async function listCloudflareZones(token: string, accountId: string): Promise<CloudflareZone[]> {
  const query = new URLSearchParams({ status: "active", per_page: "50" });
  if (accountId) query.set("account.id", accountId);
  const response = await cloudflareRequest<CloudflareZone[]>(`/zones?${query}`, token);
  if (!response.ok) return [];
  return (response.result ?? []).filter((zone) => zone.id && zone.name);
}

export async function readCloudflareRoutingStatus(token: string, zoneId: string) {
  const response = await cloudflareRequest<CloudflareRoutingSettings>(`/zones/${encodeURIComponent(zoneId)}/email/routing`, token);
  if (!response.ok) {
    return { ok: false, detail: response.error || "Cloudflare Email Routing status could not be verified.", status: "unknown", permission: isCloudflarePermissionError(response) };
  }
  const status = response.result?.status || (response.result?.enabled ? "ready" : "unconfigured");
  const ready = response.result?.enabled === true && status === "ready";
  return {
    ok: ready,
    detail: ready ? "Cloudflare Email Routing is enabled and ready." : `Cloudflare Email Routing is ${status}.`,
    status,
    permission: false,
  };
}

/** Enable Email Routing on a zone (adds and locks the MX + SPF records). Idempotent
 *  enough for setup: re-enabling an already-enabled zone returns success. */
export async function enableCloudflareEmailRouting(token: string, zoneId: string): Promise<CloudflareResult<CloudflareRoutingSettings>> {
  return cloudflareRequest<CloudflareRoutingSettings>(`/zones/${encodeURIComponent(zoneId)}/email/routing/enable`, token, { method: "POST", body: {} });
}

/** Create an Email Routing rule that delivers a single address into a Worker.
 *  This is the one place the `matchers`/`actions` rule shape lives so the mailbox
 *  provisioner and the Agentic Inbox setup flow stay identical. */
export async function createWorkerRoutingRule(
  token: string,
  zoneId: string,
  input: { address: string; ruleName: string; workerName: string },
): Promise<CloudflareResult<CloudflareRoutingRule>> {
  return cloudflareRequest<CloudflareRoutingRule>(`/zones/${encodeURIComponent(zoneId)}/email/routing/rules`, token, {
    method: "POST",
    body: {
      enabled: true,
      name: input.ruleName,
      matchers: [{ type: "literal", field: "to", value: input.address }],
      actions: [{ type: "worker", value: [input.workerName] }],
      priority: 0,
    },
  });
}

export type R2BucketList = { ok: boolean; names: string[]; error?: string; permission?: boolean };

/** List R2 bucket names on the account (read-only). Needs "Workers R2 Storage: Read". */
export async function listR2BucketNames(token: string, accountId: string): Promise<R2BucketList> {
  if (!token || !accountId) return { ok: false, names: [], error: "Cloudflare account credentials are required to list R2 buckets." };
  const list = await cloudflareRequest<{ buckets?: Array<{ name?: string }> }>(`/accounts/${encodeURIComponent(accountId)}/r2/buckets`, token);
  if (!list.ok) return { ok: false, names: [], error: list.error, permission: isCloudflarePermissionError(list) };
  return { ok: true, names: (list.result?.buckets ?? []).map((bucket) => bucket.name || "").filter(Boolean) };
}

export type R2BucketState = { ok: boolean; existed: boolean; created: boolean; detail: string; permission?: boolean };

/** Ensure the attachments R2 bucket exists, creating it if missing. Both the list
 *  and create calls need the token's "Workers R2 Storage: Edit" scope; a 403 is
 *  surfaced as a permission problem rather than a hard failure so the caller can
 *  tell the user exactly which token scope to grant. */
export async function ensureR2Bucket(token: string, accountId: string, bucketName: string): Promise<R2BucketState> {
  if (!token || !accountId) return { ok: false, existed: false, created: false, detail: "Cloudflare account credentials are required to manage the attachments bucket." };
  const list = await listR2BucketNames(token, accountId);
  if (list.ok) {
    if (list.names.includes(bucketName)) return { ok: true, existed: true, created: false, detail: `R2 bucket ${bucketName} already exists.` };
  } else if (list.permission) {
    return { ok: false, existed: false, created: false, permission: true, detail: `${list.error} (grant the token "Workers R2 Storage: Edit").` };
  }
  const create = await cloudflareRequest<{ name?: string }>(`/accounts/${encodeURIComponent(accountId)}/r2/buckets`, token, { method: "POST", body: { name: bucketName } });
  if (create.ok) return { ok: true, existed: false, created: true, detail: `Created R2 bucket ${bucketName}.` };
  // A concurrent create or an existing bucket the list call could not see still counts as ready.
  if (/already (exists|own)/i.test(create.error)) return { ok: true, existed: true, created: false, detail: `R2 bucket ${bucketName} already exists.` };
  if (isCloudflarePermissionError(create)) return { ok: false, existed: false, created: false, permission: true, detail: `${create.error} (grant the token "Workers R2 Storage: Edit").` };
  return { ok: false, existed: false, created: false, detail: create.error };
}
