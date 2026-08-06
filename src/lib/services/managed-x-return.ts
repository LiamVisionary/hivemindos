export const MANAGED_X_RETURN_EVENT = "hivemindos:managed-x-return";

export type ManagedXReturnPayload = {
  status?: string;
  connectionId?: string;
  username?: string;
  error?: string;
  creditAccountId?: string;
  slug?: string;
  returnView?: "integrations" | "socials";
  returnTab?: "mcp" | "xbot";
  url?: string;
};

const MANAGED_X_RETURN_QUERY_KEYS = [
  "x_status",
  "connectionId",
  "username",
  "error",
  "x_credit_account_id",
  "x_slug",
  "x_return_tab",
] as const;

export function managedXDeepLinkFromSearchParams(params: URLSearchParams): string {
  const returnView = params.get("x_return_view") === "socials" ? "socials" : "integrations";
  const scheme = params.get("x_return_scheme") === "hivemindos-dev" ? "hivemindos-dev" : "hivemindos";
  const url = new URL(`${scheme}://${returnView}/x-managed`);
  for (const key of MANAGED_X_RETURN_QUERY_KEYS) {
    const value = params.get(key)?.trim();
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function managedXReturnPayloadFromSearchParams(params: URLSearchParams, sourceUrl = ""): ManagedXReturnPayload {
  return {
    status: params.get("x_status")?.trim() || undefined,
    connectionId: params.get("connectionId")?.trim() || undefined,
    username: params.get("username")?.trim() || undefined,
    error: params.get("error")?.trim() || undefined,
    creditAccountId: params.get("x_credit_account_id")?.trim() || undefined,
    slug: params.get("x_slug")?.trim() || undefined,
    returnView: params.get("x_return_view") === "socials" ? "socials" : "integrations",
    returnTab: params.get("x_return_tab") === "xbot" ? "xbot" : "mcp",
    url: sourceUrl || undefined,
  };
}

export function managedXReturnMessage(payload: ManagedXReturnPayload): string {
  const status = payload.status?.trim().toLowerCase() || "";
  if (status === "connected") {
    const username = payload.username?.trim() || "";
    return username ? `Managed X account @${username} connected.` : "Managed X account connected.";
  }
  if (status === "error") {
    return payload.error?.trim() || "Managed X sign-in failed.";
  }
  return "";
}
