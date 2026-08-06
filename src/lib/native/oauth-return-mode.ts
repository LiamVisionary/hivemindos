"use client";

// Which desktop deep-link scheme (if any) an OAuth callback should return
// through. Sent in the body of the authenticated /oauth/start POST and carried
// INSIDE the signed state, so the callback — rendered in a cookie-less
// external browser — can offer the hivemindos:// link back to the app only on
// a signature-verified flow. Mirrors the managed-X return rail's client-side
// scheme selection (dev desktop builds register hivemindos-dev://).

import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export function oauthReturnMode(): "desktop" | "desktop-dev" | undefined {
  if (!isTauriDesktopRuntime()) return undefined;
  return process.env.NODE_ENV === "development" ? "desktop-dev" : "desktop";
}
