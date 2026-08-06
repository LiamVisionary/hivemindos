"use client";

import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export type ManagedXReturnView = "integrations" | "socials";

export const MANAGED_X_RETURN_POLL_INTERVAL_MS = 1_500;
export const MANAGED_X_RETURN_POLL_WINDOW_MS = 5 * 60_000;
export const MANAGED_X_RETURN_POLL_GRACE_MS = 5_000;

/**
 * The managed gateway needs an HTTP(S) return URL. In the desktop app that
 * URL is a self-authenticating local receipt page, which records the result
 * before handing the browser back to the mode-specific registered app scheme.
 * A regular browser build returns to the requested dashboard view directly.
 */
export function managedXReturnUrl(
  creditAccountId: string,
  slug: string,
  view: ManagedXReturnView = "integrations",
  integrationsTab: "mcp" | "xbot" = "mcp",
) {
  const desktop = isTauriDesktopRuntime();
  const url = desktop
    ? new URL("/api/integrations/x-managed/desktop-return", window.location.origin)
    : new URL("/", window.location.origin);

  if (desktop) {
    url.searchParams.set("x_return_view", view);
    if (view === "integrations") url.searchParams.set("x_return_tab", integrationsTab);
    if (process.env.NODE_ENV === "development") url.searchParams.set("x_return_scheme", "hivemindos-dev");
  } else {
    url.searchParams.set("view", view);
    if (view === "integrations") url.searchParams.set("tab", integrationsTab);
  }
  if (creditAccountId.trim()) url.searchParams.set("x_credit_account_id", creditAccountId.trim());
  if (slug.trim()) url.searchParams.set("x_slug", slug.trim());
  return url.toString();
}
