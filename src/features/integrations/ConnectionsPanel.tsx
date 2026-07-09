"use client";

import * as React from "react";
import Image from "next/image";
import type { ConnectionProviderKey, ConnectionProviderStatus, ConnectionsPayload } from "@/lib/types/integrations";
import { CLAWBANK_OPEN_EVENT, CLAWBANK_UPDATED_EVENT } from "@/features/dashboard/ClawBankOnboardingModal";
import { openExternalUrl } from "@/lib/native/open-external-url";
import { BBtn, BIcon, ServiceGlyph } from "./integrations-primitives";
import { readJson } from "./integrations-view-helpers";

type FetchErrorPayload = { error?: string; message?: string };

const PROVIDER_STYLE: Record<ConnectionProviderKey, { mono: string; accent: string; logo?: string }> = {
  github: { mono: "Gh", accent: "#c7ccd4" },
  linear: { mono: "Li", accent: "#9b8cf0" },
  slack: { mono: "Sl", accent: "#e09a86" },
  notion: { mono: "No", accent: "#d8d6cf" },
  google: { mono: "Go", accent: "#6f9bd6" },
  "google-cloud": { mono: "Gc", accent: "#5a8dee" },
  posthog: { mono: "Ph", accent: "#f0a868" },
  plausible: { mono: "Pl", accent: "#4fb5a3" },
  clawbank: { mono: "Cb", accent: "#e6dcc6", logo: "/icons/runtimes/clawbank.svg" },
};

/** Provider tile: the real logo when we ship one (ClawBank), else the mono glyph. */
function ProviderGlyph({ providerKey, size = 38, radius = 11 }: { providerKey: ConnectionProviderKey; size?: number; radius?: number }) {
  const style = PROVIDER_STYLE[providerKey];
  if (!style.logo) return <ServiceGlyph accent={style.accent} mono={style.mono} size={size} radius={radius} />;
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flex: "0 0 auto",
        display: "grid",
        placeItems: "center",
        background: `color-mix(in srgb, ${style.accent} 15%, var(--panel-2))`,
        border: `1px solid color-mix(in srgb, ${style.accent} 34%, transparent)`,
      }}
    >
      <Image src={style.logo} alt="" aria-hidden width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} unoptimized />
    </span>
  );
}

const OAUTH_START_URL: Partial<Record<ConnectionProviderKey, string>> = {
  github: "/api/integrations/github/oauth/start?source=integrations",
  google: "/api/integrations/google/oauth/start",
  "google-cloud": "/api/integrations/google-cloud/oauth/start",
  slack: "/api/integrations/slack/oauth/start",
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
    let returnMessageTimer: number | undefined;
    const params = new URLSearchParams(window.location.search);
    const returned = params.get("connections");
    if (returned === "github" || returned === "google" || returned === "google-cloud" || returned === "slack") {
      const connectedLabel =
        returned === "github"
          ? "GitHub"
          : returned === "google-cloud"
            ? "Google Cloud"
            : returned === "slack"
              ? "Slack"
              : "Google";
      returnMessageTimer = window.setTimeout(() => {
        setMessage(`${connectedLabel} connected.`);
      }, 0);
      params.delete("connections");
      const search = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
    }
    // The ClawBank guided setup runs in its own modal (email → code → mint);
    // when it lands a key, re-read so the card flips to Connected.
    const onClawBankUpdated = () => {
      setMessage("ClawBank connected.");
      void refresh();
    };
    window.addEventListener(CLAWBANK_UPDATED_EVENT, onClawBankUpdated);
    return () => {
      window.clearTimeout(timer);
      if (returnMessageTimer !== undefined) window.clearTimeout(returnMessageTimer);
      window.removeEventListener(CLAWBANK_UPDATED_EVENT, onClawBankUpdated);
    };
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
                <ProviderGlyph providerKey={provider.key} size={56} radius={16} />
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
  // After the sign-in tab opens in the external browser, poll the connections
  // endpoint so the modal flips to Connected on its own — the user never has to
  // come back and hit Refresh. `pollDeadlineRef` bounds the wait.
  const [polling, setPolling] = React.useState(false);
  const pollDeadlineRef = React.useRef(0);
  // For the Slack broker flow: the flowId returned by /start, polled at /poll
  // (which persists the token) until the hosted Worker reports the token is ready.
  const slackFlowRef = React.useRef("");
  const oauthUrl = OAUTH_START_URL[provider.key];
  const isGoogle = provider.key === "google";
  const isGoogleCloud = provider.key === "google-cloud";
  const isSlack = provider.key === "slack";
  const isClawBank = provider.key === "clawbank";
  // OAuth-only providers connect purely through the browser sign-in button — no
  // pasted-token fallback (the token comes from the OAuth round-trip). `google`
  // uses a one-time pasted OAuth client (web-app model), then browser sign-in;
  // `google-cloud` and `slack` use a baked-in client (PKCE, persistent callback),
  // so they are oauthReady once the client id is set and never show a client form.
  const oauthOnly = isGoogle || isGoogleCloud || isSlack;
  const usesOAuthClient = isGoogle || isGoogleCloud || isSlack;

  // Keep the latest props reachable from the poll interval without making it a
  // dependency (which would tear down and recreate the interval every render).
  const liveRef = React.useRef({ provider, onUpdated, onClose });
  liveRef.current = { provider, onUpdated, onClose };

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  React.useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    async function check() {
      try {
        // Slack broker flow: advance the rendezvous first. /poll persists the
        // token server-side on success; only then does the connections status flip.
        const slackFlow = liveRef.current.provider.key === "slack" ? slackFlowRef.current : "";
        if (slackFlow) {
          const pollRes = await fetch("/api/integrations/slack/oauth/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ flowId: slackFlow }),
          });
          const pollData = await readJson<{ ok?: boolean; status?: string; error?: string } & FetchErrorPayload>(pollRes);
          if (cancelled) return;
          if (pollRes.ok && pollData.ok !== false) {
            if (pollData.status === "pending") {
              if (Date.now() > pollDeadlineRef.current) {
                setPolling(false);
                setNote("Still waiting on Slack. Finish the sign-in in your browser, then click Refresh.");
              }
              return;
            }
            if (pollData.status === "error" || pollData.status === "expired") {
              setPolling(false);
              slackFlowRef.current = "";
              setNote(
                pollData.status === "expired"
                  ? "The Slack sign-in expired. Start it again."
                  : `Slack sign-in failed${pollData.error ? ` (${pollData.error})` : ""}.`,
              );
              return;
            }
            // connected → clear and fall through to refresh the connections status.
            slackFlowRef.current = "";
          }
        }
        const response = await fetch("/api/integrations/connections", { cache: "no-store" });
        const data = await readJson<ConnectionsPayload & FetchErrorPayload>(response);
        if (cancelled || !response.ok || data.ok === false) return;
        const { provider: p, onUpdated: upd, onClose: close } = liveRef.current;
        const me = data.providers?.find((entry) => entry.key === p.key);
        if (me?.connected) {
          setPolling(false);
          if (me.verified) {
            upd(data, `${p.label} connected${me.account ? ` as ${me.account}` : ""}.`);
            close();
          } else {
            // Connected but the live check failed — most often the Cloud Platform
            // consent box was left unticked. Keep the modal open and say why.
            setNote(me.error || `${p.label} connected, but the live check failed. Reconnect below to retry.`);
          }
          return;
        }
        if (Date.now() > pollDeadlineRef.current) {
          setPolling(false);
          setNote(`Still waiting on ${p.label}. Finish the sign-in in your browser, then click Refresh.`);
        }
      } catch {
        // Transient (offline, dev-server restart) — keep polling until the deadline.
      }
    }
    const timer = window.setInterval(() => void check(), 2500);
    // A refresh the instant the app regains focus makes the flip feel immediate
    // when the user switches back from the browser.
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    void check();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [polling]);

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
    const data = await post({ action: "save-oauth-client", provider: provider.key, clientId, clientSecret }, "client");
    if (!data) return;
    onUpdated(data);
    await startOAuthConnect();
  }

  async function startOAuthConnect() {
    setBusy("oauth");
    setNote("");
    try {
      const response = await fetch(oauthUrl as string, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await readJson<{ ok?: boolean; authorizationUrl?: string; flowId?: string } & FetchErrorPayload>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error ?? `Could not start ${provider.label} sign-in.`);
      if (!data.authorizationUrl) throw new Error(`${provider.label} sign-in did not return an authorization URL.`);
      slackFlowRef.current = data.flowId ?? "";
      await openExternalUrl(data.authorizationUrl);
      setNote(
        isGoogleCloud
          ? "Opened Google sign-in in your browser. Finish there — keep the Cloud Platform box ticked — and this window will update on its own."
          : `Opened ${provider.label} sign-in in your browser. Finish there and this window will update on its own.`,
      );
      pollDeadlineRef.current = Date.now() + 3 * 60_000;
      setPolling(true);
    } catch (error) {
      setNote(error instanceof Error ? error.message : `Could not start ${provider.label} sign-in.`);
    } finally {
      setBusy("");
    }
  }

  // Only `google` (web-app model) pastes a client id + secret. `google-cloud`
  // and `slack` bake in a client, so they never show the client-paste form.
  const googleNeedsClient = isGoogle && !provider.oauthReady;
  const googleRedirectUri = typeof window === "undefined"
    ? ""
    : new URL(`/api/integrations/${isGoogleCloud ? "google-cloud" : "google"}/oauth/callback`, window.location.origin.replace("//localhost", "//127.0.0.1")).toString();

  return (
    <div className="fm-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="fm-modal" role="dialog" aria-modal="true" aria-label={`Connect ${provider.label}`}>
        <div className="fm-mhead">
          <div style={{ display: "flex", gap: 13, alignItems: "flex-start", minWidth: 0 }}>
            <ProviderGlyph providerKey={provider.key} size={40} radius={11} />
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

          {isGoogleCloud && !googleNeedsClient ? (
            <div className="fm-note" style={{ alignItems: "flex-start" }}>
              <BIcon name="alert" size={15} />
              {/* Explicit {" "} around <strong> — JSX collapses the newline after
                  a tag to nothing, which jams "ticked" into "for" when Prettier
                  reflows the line. */}
              <span style={{ lineHeight: 1.6 }}>
                On Google&rsquo;s consent screen,{" "}
                <strong>keep the box ticked</strong>{" "}
                for &ldquo;See, edit, configure, and delete your Google Cloud data.&rdquo; HivemindOS needs it to
                set your budgets and API caps &mdash; without it the connection can&rsquo;t manage Google Cloud.
              </span>
            </div>
          ) : null}

          {oauthUrl && !googleNeedsClient ? (
            <BBtn
              variant="primary"
              onClick={() => usesOAuthClient ? void startOAuthConnect() : window.location.assign(oauthUrl)}
              disabled={Boolean(busy) || polling}
              style={{ justifySelf: "start", padding: "11px 18px", fontSize: 13.5 }}
            >
              {busy === "oauth" || polling ? <span className="ni-spin" /> : <BIcon name="key" size={15} />}
              {polling
                ? `Waiting for ${provider.label} sign-in…`
                : busy === "oauth" && usesOAuthClient
                  ? `Opening ${provider.label}…`
                  : isGoogle
                    ? "Sign in with Google"
                    : `Connect with ${provider.label}`}
            </BBtn>
          ) : null}

          {isClawBank ? (
            <BBtn
              variant="primary"
              onClick={() => {
                onClose();
                window.dispatchEvent(new Event(CLAWBANK_OPEN_EVENT));
              }}
              style={{ justifySelf: "start", padding: "11px 18px", fontSize: 13.5 }}
            >
              <BIcon name="key" size={15} /> Set up with email
            </BBtn>
          ) : null}

          {googleNeedsClient ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="fm-note"><BIcon name="shield" size={15} /><span>{provider.tokenHint} Create a <strong>Web application</strong> OAuth client and add the exact redirect URI below to it.</span></div>
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

          {!oauthOnly ? (
            <div style={{ display: "grid", gap: 9 }}>
              <div className="fm-sec" style={{ margin: "2px 0 0" }}>{isClawBank || (oauthUrl && provider.oauthReady) ? "Or paste a token" : "Paste a token"}</div>
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
              {busy === "disconnect" ? <span className="ni-spin" /> : <BIcon name="trash" size={14} />} {busy === "disconnect" ? "Removing…" : "Disconnect"}
            </BBtn>
          ) : (
            <BBtn onClick={onClose} disabled={Boolean(busy)}>Cancel</BBtn>
          )}
          {googleNeedsClient ? (
            <BBtn variant="primary" onClick={() => void saveGoogleClient()} disabled={Boolean(busy) || !clientId.trim() || !clientSecret.trim()}>
              {busy === "client" ? <span className="ni-spin" /> : <BIcon name="key" size={14} />} Save &amp; sign in
            </BBtn>
          ) : null}
          {!oauthOnly ? (
            <BBtn variant="primary" onClick={() => void saveToken()} disabled={Boolean(busy) || token.trim().length < 8}>
              {busy === "token" ? <span className="ni-spin" /> : <BIcon name="plug" size={14} />} {busy === "token" ? "Checking..." : "Validate & save"}
            </BBtn>
          ) : null}
        </div>
      </div>
    </div>
  );
}
