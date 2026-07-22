import { managedXReturnMessage, managedXReturnPayloadFromSearchParams } from "@/lib/services/managed-x-return";
export { managedXReturnUrl } from "@/lib/services/managed-x-oauth-return";

export function summarizeRegistrarOutput(output?: string) {
  if (!output) return "";
  const changedMatch = output.match(/Done\.\s+([^\n]+)/);
  if (changedMatch) return changedMatch[1].trim();
  const lines = output.split(/\r?\n/).filter(Boolean);
  return lines.at(-1) ?? "";
}

export function tabFromLocation<T extends string>(fallback: T, validTabs: Array<{ id: T }>): T {
  if (typeof window === "undefined") return fallback;
  const raw = new URLSearchParams(window.location.search).get("tab") ?? "";
  return validTabs.some((item) => item.id === raw) ? raw as T : fallback;
}

export function managedXStatusUrl(creditAccountId?: string, slug?: string) {
  const params = new URLSearchParams();
  const urlParams = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const accountId = creditAccountId?.trim() || urlParams.get("x_credit_account_id")?.trim() || "";
  const cleanSlug = slug?.trim() || urlParams.get("x_slug")?.trim() || "";
  if (accountId) params.set("creditAccountId", accountId);
  if (cleanSlug) params.set("slug", cleanSlug);
  const search = params.toString();
  return search ? `/api/integrations/x-managed?${search}` : "/api/integrations/x-managed";
}

export function showManagedXReturnMessage(setMessage: (message: string) => void) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const message = managedXReturnMessage(managedXReturnPayloadFromSearchParams(params, window.location.href));
  if (message) setMessage(message);
}

export function splitArgs(value: string) {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")).filter(Boolean) ?? [];
}

export async function readJson<T>(response: Response): Promise<T> {
  return await response.json().catch(() => ({})) as T;
}

export function timeAgo(ts: number) {
  const seconds = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}
