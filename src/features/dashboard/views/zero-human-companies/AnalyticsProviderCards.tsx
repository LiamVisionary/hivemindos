"use client";
// Zero Human Companies — interactive Analytics provider cards. Each card connects a
// provider's shared credential inline (PostHog/Plausible key -> live-validated
// /api/integrations/connections; GA4 -> the shared Google OAuth account) and then
// auto-discovers projects/sites/properties (GET /api/analytics/providers/{key}/
// resources) so nobody types an id. Picking one persists the per-company link via the
// merge-safe /api/companies `set-analytics` action, then asks the panel to refetch.
//
// The provider KEY is a fleet-wide shared credential (every company uses the same
// key; only the project is per-company) — the copy says so.
import React from "react";
import { ExternalSignInButton } from "@/components/ExternalSignInButton";
import { oauthReturnMode } from "@/lib/native/oauth-return-mode";
import { Spinner } from "./primitives";
import type {
  AnalyticsProviderKey,
  AnalyticsProviderStatus,
  AnalyticsResource,
  CompanyAnalyticsConfig,
} from "@/lib/services/company-analytics/types";

const GOOGLE_OAUTH_START = "/api/integrations/google/oauth/start";

type CardMode = "idle" | "connect" | "pick";

async function readJson<T>(res: Response): Promise<T & { ok?: boolean; error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
}

function Btn({
  children,
  onClick,
  variant = "ghost",
  disabled,
  busy,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  busy?: boolean;
}) {
  const primary = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 8,
        fontFamily: "var(--f-mono)",
        fontSize: 11,
        fontWeight: 600,
        cursor: disabled || busy ? "default" : "pointer",
        border: primary ? "1px solid var(--btn-line)" : "1px solid var(--line-2)",
        background: primary ? "var(--btn-bg)" : "transparent",
        color: primary ? "var(--btn-fg)" : "var(--fg-2)",
        opacity: disabled || busy ? 0.55 : 1,
      }}
    >
      {busy && <Spinner size={11} />}
      {children}
    </button>
  );
}

function fieldStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--line-2)",
    background: "var(--bg)",
    color: "var(--fg)",
    fontFamily: "var(--f-mono)",
    fontSize: 12,
  };
}

function ProviderCard({
  companyId,
  provider: p,
  isActive,
  activeConfig,
  onChanged,
}: {
  companyId: string;
  provider: AnalyticsProviderStatus;
  isActive: boolean;
  activeConfig?: CompanyAnalyticsConfig;
  onChanged: () => void;
}) {
  const isGoogle = p.connectVia === "google-oauth";
  // Local optimism: after a successful inline key connect the props are stale until
  // the panel refetches, so track it locally to advance straight into the picker.
  const [justConnected, setJustConnected] = React.useState(false);
  const connected = !p.requiresCredential || p.credentialPresent || justConnected;

  const [mode, setMode] = React.useState<CardMode>("idle");
  const [busy, setBusy] = React.useState("");
  const [note, setNote] = React.useState("");
  const [token, setToken] = React.useState("");
  const [showToken, setShowToken] = React.useState(false);

  const [resources, setResources] = React.useState<AnalyticsResource[] | null>(null);
  const [resourceHost, setResourceHost] = React.useState<string | undefined>(undefined);
  const [enumError, setEnumError] = React.useState("");
  const [selected, setSelected] = React.useState(activeConfig?.projectId ?? "");
  const [manual, setManual] = React.useState(activeConfig?.projectId ?? "");
  const [manualMode, setManualMode] = React.useState(false);

  const ready = !p.requiresCredential || p.credentialPresent || justConnected;
  const dotColor = isActive ? "var(--honey-2)" : ready ? "var(--cyan-2)" : "var(--fg-4)";
  const statusLabel = isActive
    ? "● active"
    : !p.requiresCredential
      ? "ready"
      : ready
        ? "connected"
        : isGoogle
          ? "sign in"
          : "no key";

  // Resolves the ABSOLUTE Google authorization URL via the authenticated POST
  // start route — the external browser has no dashboard session cookie, so a
  // same-origin /oauth/start GET link would 401 at the proxy out there.
  async function resolveGoogleAuthUrl(): Promise<string> {
    const res = await fetch(GOOGLE_OAUTH_START, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Desktop flows: the callback deep-links back via hivemindos://, carried
      // in the signed state.
      body: JSON.stringify(oauthReturnMode() ? { returnMode: oauthReturnMode() } : {}),
    });
    const data = await readJson<{ authorizationUrl?: string }>(res);
    if (!res.ok || data.ok === false || !data.authorizationUrl) {
      throw new Error(data.error || "Google sign-in could not start.");
    }
    return data.authorizationUrl;
  }

  async function fetchResources() {
    if (!p.canEnumerate) {
      setManualMode(true);
      return;
    }
    setBusy("enumerate");
    setEnumError("");
    try {
      const res = await fetch(`/api/analytics/providers/${encodeURIComponent(p.key)}/resources`, { cache: "no-store" });
      const data = await readJson<{ resources?: AnalyticsResource[]; host?: string }>(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || "Could not list projects.");
      const list = data.resources ?? [];
      setResources(list);
      setResourceHost(data.host);
      if (list.length && !list.some((r) => r.id === selected)) setSelected(list[0].id);
      if (!list.length) setManualMode(true);
    } catch (err) {
      setEnumError(err instanceof Error ? err.message : "Could not list projects.");
      setManualMode(true);
    } finally {
      setBusy("");
    }
  }

  function openPicker() {
    setMode("pick");
    setNote("");
    setManualMode(false);
    setResources(null);
    setSelected(activeConfig?.projectId ?? "");
    setManual(activeConfig?.projectId ?? "");
    void fetchResources();
  }

  async function connectKey() {
    if (token.trim().length < 8) {
      setNote("Paste the full key.");
      return;
    }
    setBusy("connect");
    setNote("");
    try {
      const res = await fetch("/api/integrations/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-token", provider: p.key, token: token.trim() }),
      });
      const data = await readJson<{ account?: string }>(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || "The provider rejected that key.");
      setJustConnected(true);
      setToken("");
      // Straight into the picker now that the key is live.
      setMode("pick");
      setManualMode(false);
      setResources(null);
      void fetchResources();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not connect.");
    } finally {
      setBusy("");
    }
  }

  async function save(providerKey: AnalyticsProviderKey | "", projectId?: string) {
    setBusy("save");
    setNote("");
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-analytics",
          id: companyId,
          analyticsProvider: providerKey,
          analyticsConfig: providerKey
            ? { projectId: projectId || undefined, host: resourceHost || activeConfig?.host || undefined }
            : undefined,
        }),
      });
      const data = await readJson<Record<string, unknown>>(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || "Could not save.");
      setMode("idle");
      onChanged();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy("");
    }
  }

  function savePicked() {
    const projectId = (manualMode ? manual : selected).trim();
    if (p.requiresCredential && !projectId && p.key !== "hivemind-funnel") {
      setNote(`Pick or enter a ${p.configFieldLabel.toLowerCase()}.`);
      return;
    }
    void save(p.key, projectId);
  }

  const needsProject = p.key !== "hivemind-funnel";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "13px 14px",
        borderRadius: 12,
        border: `1px solid ${isActive ? "var(--honey-2)" : "var(--line)"}`,
        background: isActive ? "color-mix(in srgb, var(--honey-2) 7%, var(--bg-2))" : "var(--bg-2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="dot" style={{ color: dotColor }} />
        <span style={{ flex: 1, fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{p.label}</span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: dotColor }}>{statusLabel}</span>
      </div>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", lineHeight: 1.45 }}>{p.detail}</span>
      {isActive && activeConfig?.projectId ? (
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--honey-2)" }}>
          {p.configFieldLabel}: {activeConfig.projectId}
        </span>
      ) : null}

      {/* Action row */}
      {mode === "idle" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
          {!connected && !isGoogle && (
            <Btn variant="primary" onClick={() => { setMode("connect"); setNote(""); }}>Connect key</Btn>
          )}
          {!connected && isGoogle && (
            <ExternalSignInButton
              label="Connect Google"
              resolveUrl={resolveGoogleAuthUrl}
              onOpened={() => setNote("Opened Google sign-in in your browser — finish there, then come back; this card updates on the next refresh.")}
              onError={(message) => setNote(message)}
            />
          )}
          {connected && (
            <Btn variant={isActive ? "ghost" : "primary"} onClick={openPicker}>
              {!needsProject ? (isActive ? "In use" : "Use for this company") : isActive ? "Change project" : "Use for this company"}
            </Btn>
          )}
          {connected && needsProject && !isGoogle && (
            <Btn onClick={() => { setMode("connect"); setNote(""); }}>Replace key</Btn>
          )}
          {connected && isGoogle && (
            <ExternalSignInButton
              label="Reconnect Google"
              resolveUrl={resolveGoogleAuthUrl}
              onOpened={() => setNote("Opened Google sign-in in your browser — finish there, then come back; this card updates on the next refresh.")}
              onError={(message) => setNote(message)}
            />
          )}
          {isActive && (
            <Btn onClick={() => void save("", undefined)} busy={busy === "save"}>Unlink</Btn>
          )}
        </div>
      )}

      {/* Inline key connect */}
      {mode === "connect" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 4 }}>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", lineHeight: 1.5 }}>
            {p.credentialHint} Checked live, then stored in the shared hive env — every company can use it.
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              autoFocus
              type={showToken ? "text" : "password"}
              value={token}
              placeholder={p.credentialPlaceholder || "paste key"}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void connectKey(); }}
              style={fieldStyle()}
            />
            <Btn onClick={() => setShowToken((v) => !v)}>{showToken ? "Hide" : "Show"}</Btn>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Btn variant="primary" onClick={() => void connectKey()} busy={busy === "connect"}>Connect &amp; verify</Btn>
            <Btn onClick={() => { setMode("idle"); setNote(""); }}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* Project picker */}
      {mode === "pick" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 4 }}>
          {!needsProject ? (
            <>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", lineHeight: 1.5 }}>
                Reads this company&apos;s own revenue and apex-goal numbers — no project to pick.
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <Btn variant="primary" onClick={() => void save(p.key, undefined)} busy={busy === "save"}>Use for this company</Btn>
                <Btn onClick={() => { setMode("idle"); setNote(""); }}>Cancel</Btn>
              </div>
            </>
          ) : busy === "enumerate" ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>
              <Spinner size={12} /> Finding {p.label} projects…
            </span>
          ) : (
            <>
              {enumError && (
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--danger-2)", lineHeight: 1.5 }}>{enumError}</span>
              )}
              {!manualMode && resources && resources.length > 0 ? (
                <select value={selected} onChange={(e) => setSelected(e.target.value)} style={fieldStyle()}>
                  {resources.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  autoFocus
                  value={manual}
                  placeholder={p.configFieldPlaceholder || "id"}
                  onChange={(e) => setManual(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") savePicked(); }}
                  style={fieldStyle()}
                />
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <Btn variant="primary" onClick={savePicked} busy={busy === "save"}>Save</Btn>
                {p.canEnumerate && resources && resources.length > 0 && (
                  <Btn onClick={() => setManualMode((v) => !v)}>{manualMode ? "Pick from list" : "Enter id manually"}</Btn>
                )}
                <Btn onClick={() => { setMode("idle"); setNote(""); }}>Cancel</Btn>
              </div>
            </>
          )}
        </div>
      )}

      {note && (
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--danger-2)", lineHeight: 1.5 }}>{note}</span>
      )}
    </div>
  );
}

export function AnalyticsProviderCards({
  companyId,
  providers,
  activeProvider,
  activeConfig,
  onChanged,
}: {
  companyId: string;
  providers: AnalyticsProviderStatus[];
  activeProvider?: AnalyticsProviderKey;
  activeConfig?: CompanyAnalyticsConfig;
  onChanged: () => void;
}) {
  return (
    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", marginTop: 14 }}>
      {providers.map((p) => (
        <ProviderCard
          key={p.key}
          companyId={companyId}
          provider={p}
          isActive={activeProvider === p.key}
          activeConfig={activeProvider === p.key ? activeConfig : undefined}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}
