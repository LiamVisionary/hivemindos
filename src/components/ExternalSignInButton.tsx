"use client";

// Segmented external sign-in control: the main segment opens the sign-in URL
// OUTSIDE the app window in the user's DEFAULT browser; the caret segment opens
// an "Open in" menu listing the browsers actually installed on this machine
// (GET /api/system/browsers) so the user can pick one. Opening always goes
// through the canonical openExternalUrl helper — never window.open into the
// Tauri WKWebView, never a same-tab navigation that swallows the dashboard.
//
// IMPORTANT for callers: an external browser has NO dashboard session, so a
// same-origin `/oauth/start` GET link would 401 at the proxy out there. Pass a
// resolveUrl that returns the ABSOLUTE provider authorization URL (the
// POST-start pattern: the app asks its own server, authenticated, for the
// signed authorization URL, then hands that to the external browser).

import React from "react";
import { ChevronDown } from "lucide-react";
import { Spinner } from "@/features/dashboard/views/zero-human-companies/primitives";
import { openExternalUrl } from "@/lib/native/open-external-url";

type DetectedBrowser = { id: string; label: string };

const segmentBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid var(--line-2)",
  background: "var(--panel-2)",
  color: "var(--fg-1)",
  fontFamily: "var(--f-mono)",
  fontSize: 11.5,
  padding: "7px 12px",
  cursor: "pointer",
};

export function ExternalSignInButton({
  label = "Sign In",
  resolveUrl,
  disabled,
  onOpened,
  onError,
  title,
}: {
  label?: string;
  /** Absolute sign-in URL, or an async getter for flows that must POST first. */
  resolveUrl: string | (() => Promise<string>);
  disabled?: boolean;
  /** Fires after the external browser was asked to open (start polling here). */
  onOpened?: (info: { browserId?: string }) => void;
  onError?: (message: string) => void;
  title?: string;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [browsers, setBrowsers] = React.useState<DetectedBrowser[] | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  const loadBrowsers = React.useCallback(async () => {
    if (browsers) return;
    try {
      const response = await fetch("/api/system/browsers", { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; browsers?: DetectedBrowser[] } | null;
      setBrowsers(data?.ok && Array.isArray(data.browsers) ? data.browsers.map(({ id, label: name }) => ({ id, label: name })) : []);
    } catch {
      setBrowsers([]);
    }
  }, [browsers]);

  const open = React.useCallback(async (browserId?: string) => {
    setMenuOpen(false);
    setBusy(true);
    try {
      const url = typeof resolveUrl === "string" ? resolveUrl : await resolveUrl();
      await openExternalUrl(url, browserId);
      onOpened?.({ browserId });
    } catch (reason) {
      onError?.(reason instanceof Error ? reason.message : "The sign-in could not be opened.");
    } finally {
      setBusy(false);
    }
  }, [onError, onOpened, resolveUrl]);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        title={title}
        disabled={disabled || busy}
        onClick={() => void open()}
        style={{ ...segmentBase, borderRadius: "8px 0 0 8px", borderRight: "none" }}
      >
        {busy ? <Spinner size={11} /> : null} {label}
      </button>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`${label} — choose a browser`}
        disabled={disabled || busy}
        onClick={() => {
          setMenuOpen((current) => !current);
          void loadBrowsers();
        }}
        style={{ ...segmentBase, borderRadius: "0 8px 8px 0", padding: "7px 8px" }}
      >
        <ChevronDown size={12} />
      </button>
      {menuOpen ? (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 60,
            minWidth: 190,
            padding: 6,
            borderRadius: 10,
            border: "1px solid var(--line-2)",
            background: "var(--panel-1, var(--panel-2))",
            boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
          }}
        >
          <div style={{ padding: "4px 8px", fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: 0.06, textTransform: "uppercase", color: "var(--fg-4)" }}>
            Open in
          </div>
          <button type="button" role="menuitem" style={{ ...segmentBase, border: "none", background: "transparent", width: "100%", borderRadius: 7, padding: "7px 8px" }} onClick={() => void open()}>
            Default browser
          </button>
          {browsers === null ? (
            <div role="status" aria-label="Detecting installed browsers" style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 8px", color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 11 }}>
              <Spinner size={11} /> Detecting browsers
            </div>
          ) : (
            browsers.map((browser) => (
              <button
                key={browser.id}
                type="button"
                role="menuitem"
                style={{ ...segmentBase, border: "none", background: "transparent", width: "100%", borderRadius: 7, padding: "7px 8px" }}
                onClick={() => void open(browser.id)}
              >
                {browser.label}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
