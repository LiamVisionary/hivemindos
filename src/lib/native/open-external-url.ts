"use client";

// Open an external http(s) URL reliably from BOTH a normal browser tab and the
// packaged Tauri desktop shell.
//
// In the Tauri WKWebView a plain `<a target="_blank">` (and `window.open`) is
// dropped — the webview can't spawn a second window and nothing routes the click
// to the OS browser, so clicking an external link does nothing. The robust path,
// already proven by the chat-message links, is to POST the URL to the server,
// which shells out to the OS opener (`open`/`start`/`xdg-open`).
//
// A NORMAL browser tab, though, opens instantly with `window.open` — routing it
// through the server added a needless round trip plus an `open`-shell spawn that
// made links take several seconds to open. So we only reach for the server
// opener in the Tauri shell; everywhere else opens the tab directly.
//
// Callers pair this with `event.preventDefault()` so the dead `_blank` navigation
// never runs. Keep this in sync with the chat-link path in ChatMarkdown.tsx.

import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export function isExternalHttpUrl(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export async function openExternalUrl(href: string, browserId?: string): Promise<void> {
  // Browser tab: open instantly and synchronously (inside the click gesture, so
  // no popup-blocker). Only the Tauri WKWebView needs the server opener — and a
  // caller that forces a specific browser (browserId, e.g. chat "open in Chrome")
  // also needs the server route, which is the only path that can honor it.
  if (typeof window !== "undefined" && !browserId && !isTauriDesktopRuntime()) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    const response = await fetch("/api/system/browsers/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(browserId ? { url: href, browserId } : { url: href }),
    });
    const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !data?.ok) throw new Error(data?.error ?? "Could not open the external link.");
  } catch {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}
