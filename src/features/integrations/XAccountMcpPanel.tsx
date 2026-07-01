"use client";

import * as React from "react";
import { BBtn, BIcon, NiBadge, ServiceGlyph } from "./integrations-primitives";

export type XMcpEnvPresence = {
  key: string;
  present: boolean;
  source: "process" | "shared-hive-env" | "official-policy" | "missing";
};

export type XMcpStatus = {
  credentials: XMcpEnvPresence[];
  optionalCredentials: XMcpEnvPresence[];
  credentialsReady: boolean;
  xurlCachePresent: boolean;
  bridgeScriptPresent: boolean;
  runtimeTargets: Array<{
    runtime: "claude" | "codex" | "gemini" | "openclaw" | "hermes" | "aeon";
    installed: boolean;
    configured: boolean;
    path: string;
  }>;
  configuredRuntimeCount: number;
  installedRuntimeCount: number;
  apiMcpUrl: string;
  docsMcpUrl: string;
};

type XAccountMcpPanelProps = {
  status: XMcpStatus | null;
  busy: string;
  message: string;
  onSaveCredentials: (clientId: string, clientSecret: string, redirectUri: string) => void;
  onStartOAuth: () => void;
  onSyncRuntimes: () => void;
  onRemoveRuntimes: () => void;
  onRefresh: () => void;
};

export function XAccountMcpPanel({
  status,
  busy,
  message,
  onSaveCredentials,
  onStartOAuth,
  onSyncRuntimes,
  onRemoveRuntimes,
  onRefresh,
}: XAccountMcpPanelProps) {
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");
  const [redirectUri, setRedirectUri] = React.useState("");
  const [showSecret, setShowSecret] = React.useState(false);
  const credentialsReady = status?.credentialsReady === true;
  const hasOAuthCache = status?.xurlCachePresent === true;
  const installedCount = status?.installedRuntimeCount ?? 0;
  const configuredCount = status?.configuredRuntimeCount ?? 0;
  const saveDisabled = !clientId.trim() && !clientSecret.trim() && !redirectUri.trim();
  const working = Boolean(busy);

  return (
    <div className="ni-stage ni-pad">
      <div className="ni-atool">
        <div style={{ display: "flex", gap: 13, alignItems: "flex-start", minWidth: 0 }}>
          <ServiceGlyph accent="#f3f0e9" mono="X" size={44} radius={12} />
          <div style={{ minWidth: 0 }}>
            <h2>X Account MCP</h2>
            <p>Sign in once, then sync the X API MCP bridge into installed agent runtimes.</p>
          </div>
        </div>
        <div className="ni-abtns">
          <BBtn sm onClick={onRefresh} disabled={working}><BIcon name="refresh" size={13} /> Refresh</BBtn>
          <BBtn sm onClick={onRemoveRuntimes} disabled={working || configuredCount === 0}><BIcon name="trash" size={13} /> Remove runtime config</BBtn>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        <span className={`ni-pill ${credentialsReady ? "good" : "warn"}`}>{credentialsReady ? "App credentials saved" : "App credentials needed"}</span>
        <span className={`ni-pill ${hasOAuthCache ? "good" : "warn"}`}>{hasOAuthCache ? "OAuth cache found" : "Sign-in not detected"}</span>
        <span className={`ni-pill ${configuredCount > 0 ? "good" : ""}`}>{configuredCount}/{installedCount || status?.runtimeTargets.length || 0} runtimes configured</span>
        <span className={`ni-pill ${status?.bridgeScriptPresent ? "good" : "warn"}`}>{status?.bridgeScriptPresent ? "Bridge ready" : "Bridge missing"}</span>
      </div>

      <details className="fm-advanced" open={!credentialsReady}>
        <summary>X developer app credentials</summary>
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div className="fb-grid2">
            <label className="fb-label">Client ID
              <input className="fb-field fb-mono" type="password" autoComplete="off" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="X_MCP_CLIENT_ID" />
            </label>
            <label className="fb-label">Client Secret
              <div className="fm-keyrow">
                <input className="fb-field fb-mono" type={showSecret ? "text" : "password"} autoComplete="off" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="X_MCP_CLIENT_SECRET" />
                <button type="button" className="fm-x" style={{ width: 38, height: 38 }} onClick={() => setShowSecret((value) => !value)} title={showSecret ? "Hide" : "Show"}><BIcon name={showSecret ? "eye-off" : "eye"} size={15} /></button>
              </div>
            </label>
          </div>
          <label className="fb-label">Redirect URI
            <input className="fb-field fb-mono" value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} placeholder="http://localhost:8080/callback" />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
            <BBtn variant="primary" onClick={() => onSaveCredentials(clientId, clientSecret, redirectUri)} disabled={working || saveDisabled}>
              {busy === "save-credentials" ? <><span className="ni-spin" /> Saving...</> : <><BIcon name="key" size={14} /> Save credentials</>}
            </BBtn>
          </div>
        </div>
      </details>

      <div className="ni-meth" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <button type="button" className="ni-methcard" disabled={working || !credentialsReady} onClick={onStartOAuth}>
          <BIcon name={busy === "start-oauth" ? "sync" : "plug"} size={28} />
          <strong>{busy === "start-oauth" ? "Starting sign-in" : "Sign in with X"}</strong>
          <span>Opens browser OAuth through xurl. Tokens stay in the local xurl cache.</span>
        </button>
        <button type="button" className="ni-methcard" disabled={working || !credentialsReady} onClick={onSyncRuntimes}>
          <BIcon name={busy === "sync-runtimes" ? "sync" : "network"} size={28} />
          <strong>{busy === "sync-runtimes" ? "Syncing runtimes" : "Enable for all agents"}</strong>
          <span>Writes a merge-only xapi MCP entry into installed runtime configs.</span>
        </button>
      </div>

      {status?.runtimeTargets.length ? (
        <div className="ni-conn">
          <div className="ni-connhead">
            <strong>Runtime reach</strong>
            <NiBadge good={configuredCount > 0} warn={configuredCount === 0} label={`${configuredCount} configured`} />
          </div>
          {status.runtimeTargets.map((target) => (
            <div key={target.runtime} className="ni-connrow">
              <ServiceGlyph accent={target.configured ? "var(--live)" : "var(--fg-3)"} mono={runtimeMono(target.runtime)} size={30} radius={9} />
              <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                <div className="cname">{runtimeLabel(target.runtime)}</div>
                <div style={{ color: "var(--fg-4)", fontSize: 11.5 }}>{target.installed ? "installed" : "not installed"} · {target.configured ? "xapi configured" : "not configured"}</div>
              </div>
              <span className="ckey">{target.runtime}</span>
            </div>
          ))}
        </div>
      ) : null}

      {message ? <p className="ni-note">{message}</p> : null}
    </div>
  );
}

function runtimeLabel(runtime: XMcpStatus["runtimeTargets"][number]["runtime"]) {
  if (runtime === "openclaw") return "OpenClaw";
  return runtime.charAt(0).toUpperCase() + runtime.slice(1);
}

function runtimeMono(runtime: XMcpStatus["runtimeTargets"][number]["runtime"]) {
  if (runtime === "openclaw") return "Oc";
  return runtime.slice(0, 2).replace(/^./, (letter) => letter.toUpperCase());
}
