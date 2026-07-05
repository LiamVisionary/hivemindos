"use client";

import * as React from "react";
import type { ConnectionProviderKey, ConnectionProviderStatus, ConnectionsPayload } from "@/lib/types/integrations";
import { BBtn, BIcon, ServiceGlyph } from "./integrations-primitives";
import { readJson } from "./integrations-view-helpers";

type FetchErrorPayload = { error?: string; message?: string };

const PROVIDER_STYLE: Record<ConnectionProviderKey, { mono: string; accent: string }> = {
  github: { mono: "Gh", accent: "#c7ccd4" },
  linear: { mono: "Li", accent: "#9b8cf0" },
  slack: { mono: "Sl", accent: "#e09a86" },
  notion: { mono: "No", accent: "#d8d6cf" },
  google: { mono: "Go", accent: "#6f9bd6" },
  posthog: { mono: "Ph", accent: "#f0a868" },
  plausible: { mono: "Pl", accent: "#4fb5a3" },
};

const OAUTH_START_URL: Partial<Record<ConnectionProviderKey, string>> = {
  github: "/api/integrations/github/oauth/start?source=integrations",
  google: "/api/integrations/google/oauth/start",
};

/** One screen: connect apps in place. Credentials are validated live, then
 * saved to the shared hive env, which syncs them to every machine — no host
 * machine, no external dashboard, no separate account. */
export function ConnectionsPanel() {
  const [payload, setPayload] = React.useState<ConnectionsPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [message, setMessage] = React.useState("");
  const [openKey, setOpenKey] = React.useState<ConnectionProviderKey | "">("");

  const refresh = React.useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch("/api/integrations/connections", { cache: "no-store" });
      const next = await readJson<ConnectionsPayload & FetchErrorPayload>(response);
      if (!response.ok || next.ok === false) throw new Error(next.error ?? "Could not read app connections.");
      setPayload(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read app connections.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void refresh(true), 0);
    const params = new URLSearchParams(window.location.search);
    const returned = params.get("connections");
    if (returned === "github" || returned === "google") {
      setMessage(`${returned === "github" ? "GitHub" : "Google"} connected.`);
      params.delete("connections");
      const search = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
    }
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const providers = payload?.providers ?? [];
  const connectedCount = providers.filter((provider) => provider.connected).length;
  const open = providers.find((provider) => provider.key === openKey) ?? null;

  return (
    <>
      <div className="ni-top">
        <div>
          <div className="fr-eyebrow" style={{ color: "var(--honey)" }}>App connections</div>
          <h1>Integrations</h1>
          <p>Connect an app once and your whole hive can use it, on every machine. Nothing to install, nowhere else to sign in.</p>
        </div>
        <div className="ni-abtns">
          <BBtn onClick={() => void refresh(true)}><BIcon name="refresh" size={14} /> Refresh</BBtn>
        </div>
      </div>

      {loading ? (
        <div className="ni-stage ni-center" aria-live="polite">
          <span className="ni-tspin" style={{ width: 28, height: 28, borderWidth: 3 }} />
          <p>Checking your app connections...</p>
        </div>
      ) : (
        <div className="ni-stage ni-pad">
          <div className="ni-atool">
            <div>
              <h2>Apps</h2>
              <p>{connectedCount} connected app{connectedCount === 1 ? "" : "s"} · shared with every machine in your hive</p>
            </div>
          </div>
          <div className="ni-agrid">
            {providers.map((provider) => (
              <button key={provider.key} type="button" className="ni-acard" data-on={provider.connected ? "" : undefined} onClick={() => { setMessage(""); setOpenKey(provider.key); }}>
                <ServiceGlyph accent={PROVIDER_STYLE[provider.key].accent} mono={PROVIDER_STYLE[provider.key].mono} size={56} radius={16} />
                <strong>{provider.label}</strong>
                <span className="adet">{provider.detail}</span>
                <StatusPill provider={provider} />
              </button>
            ))}
          </div>
          {message ? <p className="ni-note good">{message}</p> : null}
        </div>
      )}

      {open ? (
        <ConnectModal
          provider={open}
          onClose={() => setOpenKey("")}
          onUpdated={(next, note) => {
            setPayload(next);
            if (note) setMessage(note);
          }}
        />
      ) : null}
    </>
  );
}

function StatusPill({ provider }: { provider: ConnectionProviderStatus }) {
  if (!provider.connected) return <span className="ni-pill">Not connected</span>;
  if (!provider.verified) return <span className="ni-pill warn">Saved · check failed</span>;
  return (
    <span className="ni-pill good" style={{ maxWidth: "100%", minWidth: 0 }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        Connected{provider.account ? ` · ${provider.account}` : ""}
      </span>
    </span>
  );
}

function ConnectModal({
  provider,
  onClose,
  onUpdated,
}: {
  provider: ConnectionProviderStatus;
  onClose: () => void;
  onUpdated: (payload: ConnectionsPayload, note?: string) => void;
}) {
  const [token, setToken] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [note, setNote] = React.useState("");
  const style = PROVIDER_STYLE[provider.key];
  const oauthUrl = OAUTH_START_URL[provider.key];
  const isGoogle = provider.key === "google";

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function post(body: Record<string, unknown>, pending: string) {
    setBusy(pending);
    setNote("");
    try {
      const response = await fetch("/api/integrations/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson<ConnectionsPayload & FetchErrorPayload & { account?: string }>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error ?? "Connection update failed.");
      return data;
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Connection update failed.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function saveToken() {
    const data = await post({ action: "save-token", provider: provider.key, token }, "token");
    if (!data) return;
    onUpdated(data, `${provider.label} connected${data.account ? ` as ${data.account}` : ""}.`);
    onClose();
  }

  async function disconnect() {
    const data = await post({ action: "disconnect", provider: provider.key }, "disconnect");
    if (!data) return;
    onUpdated(data, `${provider.label} disconnected.`);
    onClose();
  }

  async function saveGoogleClient() {
    const data = await post({ action: "save-oauth-client", provider: "google", clientId, clientSecret }, "client");
    if (!data) return;
    onUpdated(data);
    window.location.assign(OAUTH_START_URL.google as string);
  }

  const googleNeedsClient = isGoogle && !provider.oauthReady;
  const googleRedirectUri = typeof window === "undefined"
    ? ""
    : new URL("/api/integrations/google/oauth/callback", window.location.origin.replace("//localhost", "//127.0.0.1")).toString();

  return (
    <div className="fm-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="fm-modal" role="dialog" aria-modal="true" aria-label={`Connect ${provider.label}`}>
        <div className="fm-mhead">
          <div style={{ display: "flex", gap: 13, alignItems: "flex-start", minWidth: 0 }}>
            <ServiceGlyph accent={style.accent} mono={style.mono} size={40} radius={11} />
            <div style={{ minWidth: 0 }}>
              <div className="fb-eyebrow" style={{ marginBottom: 6 }}>{provider.connected ? "Connected" : "Connect app"}</div>
              <h3>{provider.label}</h3>
            </div>
          </div>
          <button type="button" className="fm-x" onClick={onClose} style={{ transform: "rotate(45deg)" }} disabled={Boolean(busy)}><BIcon name="plus" size={15} sw={2} /></button>
        </div>

        <div className="fm-mbody">
          {provider.connected ? (
            <div className="fm-note">
              <BIcon name={provider.verified ? "check" : "alert"} size={15} />
              <span>
                {provider.verified
                  ? `Connected${provider.account ? ` as ${provider.account}` : ""}. Reconnect below to switch accounts.`
                  : `A credential is saved but the live check failed: ${provider.error ?? "unknown error"}. Reconnect below to replace it.`}
              </span>
            </div>
          ) : null}

          {oauthUrl && !googleNeedsClient ? (
            <BBtn variant="primary" onClick={() => window.location.assign(oauthUrl)} style={{ justifySelf: "start", padding: "11px 18px", fontSize: 13.5 }}>
              <BIcon name="key" size={15} /> {isGoogle ? "Sign in with Google" : `Connect with ${provider.label}`}
            </BBtn>
          ) : null}

          {googleNeedsClient ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="fm-note"><BIcon name="shield" size={15} /><span>{provider.tokenHint} Give it the redirect URI below (Desktop app clients accept it automatically).</span></div>
              <label className="fb-label">Client ID
                <input className="fb-field fb-mono" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="....apps.googleusercontent.com" />
              </label>
              <label className="fb-label">Client secret
                <div className="fm-keyrow">
                  <input className="fb-field fb-mono" type={show ? "text" : "password"} value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="GOCSPX-..." />
                  <button type="button" className="fm-x" style={{ width: 38, height: 38 }} onClick={() => setShow((value) => !value)} title={show ? "Hide" : "Show"}><BIcon name={show ? "eye-off" : "eye"} size={15} /></button>
                </div>
              </label>
              <label className="fb-label">Redirect URI (copy into the OAuth client if asked)
                <input className="fb-field fb-mono" readOnly value={googleRedirectUri} onFocus={(event) => event.currentTarget.select()} />
              </label>
            </div>
          ) : null}

          {!isGoogle ? (
            <div style={{ display: "grid", gap: 9 }}>
              <div className="fm-sec" style={{ margin: "2px 0 0" }}>{oauthUrl && provider.oauthReady ? "Or paste a token" : "Paste a token"}</div>
              <div className="fm-note"><BIcon name="shield" size={15} /><span>{provider.tokenHint} The token is checked live, then stored in the shared hive env.</span></div>
              <label className="fb-label">{provider.label} token
                <div className="fm-keyrow">
                  <input className="fb-field fb-mono" type={show ? "text" : "password"} value={token} onChange={(event) => setToken(event.target.value)} placeholder={provider.tokenPlaceholder} />
                  <button type="button" className="fm-x" style={{ width: 38, height: 38 }} onClick={() => setShow((value) => !value)} title={show ? "Hide" : "Show"}><BIcon name={show ? "eye-off" : "eye"} size={15} /></button>
                </div>
              </label>
            </div>
          ) : null}

          {note ? <p className="ni-note">{note}</p> : null}
        </div>

        <div className="fm-mfoot">
          {provider.connected ? (
            <BBtn onClick={() => void disconnect()} disabled={Boolean(busy)}>
              <BIcon name="trash" size={14} /> {busy === "disconnect" ? "Removing..." : "Disconnect"}
            </BBtn>
          ) : (
            <BBtn onClick={onClose} disabled={Boolean(busy)}>Cancel</BBtn>
          )}
          {googleNeedsClient ? (
            <BBtn variant="primary" onClick={() => void saveGoogleClient()} disabled={Boolean(busy) || !clientId.trim() || !clientSecret.trim()}>
              {busy === "client" ? <span className="ni-spin" /> : <BIcon name="key" size={14} />} Save &amp; sign in
            </BBtn>
          ) : null}
          {!isGoogle ? (
            <BBtn variant="primary" onClick={() => void saveToken()} disabled={Boolean(busy) || token.trim().length < 8}>
              {busy === "token" ? <span className="ni-spin" /> : <BIcon name="plug" size={14} />} {busy === "token" ? "Checking..." : "Validate & save"}
            </BBtn>
          ) : null}
        </div>
      </div>
    </div>
  );
}
