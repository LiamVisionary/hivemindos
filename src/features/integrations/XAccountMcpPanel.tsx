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
  managedGateway: {
    configured: boolean;
    baseUrlHost: string;
    upstreamReachable: boolean;
    missing: string[];
    errors: string[];
  };
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

export type ManagedXCreditAccountSummary = {
  accountId: string;
  slug: string;
  updatedAt: string;
  balanceUsd: number | null;
  balanceLabel: string;
  error?: string;
};

export type ManagedXConnectionSummary = {
  id: string;
  username?: string;
  xUserId?: string;
  scopes?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
};

export type ManagedXPanelStatus = {
  creditAccounts: ManagedXCreditAccountSummary[];
  connections: ManagedXConnectionSummary[];
  credits?: {
    configured?: boolean;
    balanceUsd?: number | null;
    balanceLabel?: string;
    error?: string;
  };
};

type XAccountMcpPanelProps = {
  status: XMcpStatus | null;
  managedStatus: ManagedXPanelStatus | null;
  busy: string;
  message: string;
  onSaveCredentials: (clientId: string, clientSecret: string, redirectUri: string) => void;
  onStartOAuth: () => void;
  onStartManagedOAuth: (creditAccountId: string, slug: string) => void;
  onSyncRuntimes: () => void;
  onRemoveRuntimes: () => void;
  onRefresh: () => void;
  onRefreshManaged: (creditAccountId?: string, slug?: string) => void;
};

type XMethodId = "managed" | "byo" | "runtimes";

export function XAccountMcpPanel({
  status,
  managedStatus,
  busy,
  message,
  onSaveCredentials,
  onStartOAuth,
  onStartManagedOAuth,
  onSyncRuntimes,
  onRemoveRuntimes,
  onRefresh,
  onRefreshManaged,
}: XAccountMcpPanelProps) {
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");
  const [redirectUri, setRedirectUri] = React.useState("");
  const [showSecret, setShowSecret] = React.useState(false);
  const [selectedManagedKey, setSelectedManagedKey] = React.useState("");
  const [activeMethod, setActiveMethod] = React.useState<XMethodId>("managed");
  const credentialsReady = status?.credentialsReady === true;
  const hasOAuthCache = status?.xurlCachePresent === true;
  const managedGatewayReady = status?.managedGateway?.configured === true && status.managedGateway.upstreamReachable === true;
  const installedCount = status?.installedRuntimeCount ?? 0;
  const configuredCount = status?.configuredRuntimeCount ?? 0;
  const saveDisabled = !clientId.trim() && !clientSecret.trim() && !redirectUri.trim();
  const working = Boolean(busy);
  const managedAccounts = managedStatus?.creditAccounts ?? [];
  const selectedManagedAccount = managedAccounts.find((account) => managedAccountKey(account) === selectedManagedKey) ?? managedAccounts[0] ?? null;
  const selectedManagedAccountKey = selectedManagedAccount ? managedAccountKey(selectedManagedAccount) : "";
  const managedConnectionCount = managedStatus?.connections.length ?? 0;
  const managedReady = managedGatewayReady && managedAccounts.length > 0;
  const byoReady = credentialsReady && hasOAuthCache;
  const runtimeReady = configuredCount > 0;

  return (
    <div className="ni-stage ni-pad">
      <div className="ni-atool">
        <div style={{ display: "flex", gap: 13, alignItems: "flex-start", minWidth: 0 }}>
          <ServiceGlyph accent="#f3f0e9" mono="X" size={44} radius={12} />
          <div style={{ minWidth: 0 }}>
            <h2>X Account MCP</h2>
            <p>Choose how agents should reach X, then configure only that method.</p>
          </div>
        </div>
        <div className="ni-abtns">
          <BBtn sm onClick={onRefresh} disabled={working}><BIcon name="refresh" size={13} /> Refresh</BBtn>
        </div>
      </div>

      <div className="x-method-grid" aria-label="X connection methods">
        <MethodCard
          id="managed"
          active={activeMethod === "managed"}
          icon="shield"
          title="Managed credits"
          status={managedConnectionCount > 0 ? `${managedConnectionCount} X account${managedConnectionCount === 1 ? "" : "s"}` : managedReady ? "Ready to connect" : managedGatewayReady ? "Needs credits" : "Gateway offline"}
          good={managedConnectionCount > 0 || managedReady}
          warn={managedGatewayReady && !managedReady}
          onSelect={setActiveMethod}
        >
          HivemindOS hosts OAuth token custody, encrypts X tokens, and bills X API calls to hosted credits.
        </MethodCard>
        <MethodCard
          id="byo"
          active={activeMethod === "byo"}
          icon="key"
          title="Bring your own X app"
          status={byoReady ? "Signed in locally" : credentialsReady ? "Needs sign-in" : "Needs app credentials"}
          good={byoReady}
          warn={credentialsReady && !byoReady}
          onSelect={setActiveMethod}
        >
          Use your own X developer app through xurl. Tokens stay in the local xurl cache.
        </MethodCard>
        <MethodCard
          id="runtimes"
          active={activeMethod === "runtimes"}
          icon="network"
          title="Runtime reach"
          status={runtimeReady ? `${configuredCount}/${installedCount || status?.runtimeTargets.length || 0} configured` : "Not synced"}
          good={runtimeReady}
          warn={!runtimeReady && installedCount > 0}
          onSelect={setActiveMethod}
        >
          Sync the local xurl bridge into installed agent runtimes when you want direct runtime-level access.
        </MethodCard>
      </div>

      {activeMethod === "managed" ? (
        <section className="x-method-panel" aria-label="Managed X credits setup">
          <div className="ni-connhead">
            <strong>Managed X account</strong>
            <NiBadge
              good={managedReady || managedConnectionCount > 0}
              warn={managedGatewayReady && !managedReady}
              label={managedGatewayReady ? `${managedAccounts.length} credit account${managedAccounts.length === 1 ? "" : "s"}` : "gateway offline"}
            />
          </div>
          <p className="x-muted">Best for normal HivemindOS use. App-routed agents get the hosted `x_api` MCP tool after one X OAuth connection, and X API charges debit the selected credit account.</p>
          {managedGatewayReady ? (
            managedAccounts.length ? (
              <div className="x-method-detail">
                <label className="fb-label">Credits to charge
                  <select
                    className="fb-field fb-mono"
                    value={selectedManagedAccountKey}
                    onChange={(event) => setSelectedManagedKey(event.target.value)}
                  >
                    {managedAccounts.map((account) => (
                      <option key={managedAccountKey(account)} value={managedAccountKey(account)}>
                        {managedAccountLabel(account)}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedManagedAccount ? (
                  <div className="ni-connrow x-info-row">
                    <ServiceGlyph accent="var(--honey)" mono="Cr" size={30} radius={9} />
                    <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                      <div className="cname">{selectedManagedAccount.balanceLabel || "Unknown balance"}</div>
                      <div style={{ color: "var(--fg-4)", fontSize: 11.5, overflowWrap: "anywhere" }}>{selectedManagedAccount.accountId}</div>
                      {selectedManagedAccount.error ? <div style={{ color: "var(--danger)", fontSize: 11.5 }}>{selectedManagedAccount.error}</div> : null}
                    </div>
                    <span className="ckey">{selectedManagedAccount.slug}</span>
                  </div>
                ) : null}
                <div className="x-actions">
                  <BBtn
                    variant="primary"
                    disabled={working || !selectedManagedAccount}
                    onClick={() => selectedManagedAccount ? onStartManagedOAuth(selectedManagedAccount.accountId, selectedManagedAccount.slug) : undefined}
                  >
                    {busy === "managed-oauth" ? <><span className="ni-spin" /> Opening X...</> : <><BIcon name="plug" size={14} /> Connect managed X account</>}
                  </BBtn>
                  <BBtn disabled={working} onClick={() => onRefreshManaged(selectedManagedAccount?.accountId, selectedManagedAccount?.slug)}>
                    <BIcon name="refresh" size={14} /> Refresh managed status
                  </BBtn>
                </div>
                {managedStatus?.connections.length ? (
                  <div className="x-connection-list">
                    {managedStatus.connections.map((connection) => (
                      <div key={connection.id} className="ni-connrow">
                        <ServiceGlyph accent="var(--live)" mono="X" size={30} radius={9} />
                        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                          <div className="cname">{connection.username ? `@${connection.username}` : connection.xUserId || connection.id}</div>
                          <div style={{ color: "var(--fg-4)", fontSize: 11.5, overflowWrap: "anywhere" }}>{connection.scopes || "X OAuth connection"}</div>
                        </div>
                        <span className="ckey">connected</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ni-empty">
                    <strong>No managed X account connected yet.</strong>
                    <span>Connect once with X OAuth. Agents can then use the managed `x_api` MCP tool through hosted credits.</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="ni-empty">
                <strong>No hosted credit account found.</strong>
                <span>Fund HivemindOS credits with Stripe or crypto first; funded accounts appear here automatically.</span>
              </div>
            )
          ) : (
            <div className="ni-empty">
              <strong>Managed gateway is not ready.</strong>
              <span>{status?.managedGateway?.errors?.[0] || status?.managedGateway?.missing?.join(", ") || "Deploy the hosted X API gateway and refresh."}</span>
            </div>
          )}
        </section>
      ) : null}

      {activeMethod === "byo" ? (
        <section className="x-method-panel" aria-label="Bring your own X developer app setup">
          <div className="ni-connhead">
            <strong>BYO X developer app</strong>
            <NiBadge good={byoReady} warn={credentialsReady && !hasOAuthCache} label={byoReady ? "signed in" : credentialsReady ? "credentials saved" : "needs credentials"} />
          </div>
          <div className="x-method-detail">
            <p className="x-muted">Use this when you want to bring your own X developer app credentials. OAuth runs through the local xurl cache on this machine.</p>
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
                <BBtn variant="primary" onClick={() => onSaveCredentials(clientId, clientSecret, redirectUri)} disabled={working || saveDisabled}>
                  {busy === "save-credentials" ? <><span className="ni-spin" /> Saving...</> : <><BIcon name="key" size={14} /> Save credentials</>}
                </BBtn>
              </div>
            </details>
            <div className="x-actions">
              <BBtn variant="primary" disabled={working || !credentialsReady} onClick={onStartOAuth}>
                {busy === "start-oauth" ? <><span className="ni-spin" /> Starting sign-in...</> : <><BIcon name="plug" size={14} /> Sign in with X</>}
              </BBtn>
              <span className="x-muted">Local xurl cache: {hasOAuthCache ? "detected" : "not detected"}</span>
            </div>
          </div>
        </section>
      ) : null}

      {activeMethod === "runtimes" ? (
        <section className="x-method-panel" aria-label="Runtime MCP sync">
          <div className="ni-connhead">
            <strong>Runtime reach</strong>
            <NiBadge good={configuredCount > 0} warn={configuredCount === 0} label={`${configuredCount} configured`} />
          </div>
          <p className="x-muted">This installs the local BYO xurl bridge into external runtimes. Managed-credit access for app-routed agents is available through the HivemindOS MCP once a managed X account is connected.</p>
          <div className="x-actions">
            <BBtn variant="primary" disabled={working || !credentialsReady} onClick={onSyncRuntimes}>
              {busy === "sync-runtimes" ? <><span className="ni-spin" /> Syncing runtimes...</> : <><BIcon name="network" size={14} /> Enable for all agents</>}
            </BBtn>
            <BBtn onClick={onRemoveRuntimes} disabled={working || configuredCount === 0}><BIcon name="trash" size={13} /> Remove runtime config</BBtn>
          </div>
          {status?.runtimeTargets.length ? (
            <div className="x-connection-list">
              {status.runtimeTargets.map((target) => (
                <div key={target.runtime} className="ni-connrow">
                  <ServiceGlyph accent={target.configured ? "var(--live)" : "var(--fg-3)"} mono={runtimeMono(target.runtime)} size={30} radius={9} />
                  <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                    <div className="cname">{runtimeLabel(target.runtime)}</div>
                    <div style={{ color: "var(--fg-4)", fontSize: 11.5 }}>{target.installed ? "installed" : "not installed"} - {target.configured ? "xapi configured" : "not configured"}</div>
                  </div>
                  <span className="ckey">{target.runtime}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="ni-empty">
              <strong>No installed runtime targets detected.</strong>
              <span>Install an agent runtime, then refresh this panel to sync X MCP configuration.</span>
            </div>
          )}
        </section>
      ) : null}

      {message ? <p className="ni-note">{message}</p> : null}
    </div>
  );
}

function MethodCard({
  id,
  active,
  icon,
  title,
  status,
  good,
  warn,
  children,
  onSelect,
}: {
  id: XMethodId;
  active: boolean;
  icon: string;
  title: string;
  status: string;
  good?: boolean;
  warn?: boolean;
  children: React.ReactNode;
  onSelect: (id: XMethodId) => void;
}) {
  return (
    <button
      type="button"
      className="x-method-card"
      data-sel={active ? "" : undefined}
      onClick={() => onSelect(id)}
      aria-pressed={active}
    >
      <span className="x-method-icon"><BIcon name={icon} size={20} /></span>
      <span className="x-method-copy">
        <strong>{title}</strong>
        <span>{children}</span>
      </span>
      <span className={`ni-badge ${good ? "good" : warn ? "warn" : "bad"}`}>
        <BIcon name={good ? "check" : "alert"} size={13} />
        {status}
      </span>
    </button>
  );
}

function managedAccountKey(account: ManagedXCreditAccountSummary) {
  return `${account.accountId}::${account.slug}`;
}

function managedAccountLabel(account: ManagedXCreditAccountSummary) {
  const balance = account.balanceLabel || "Unknown balance";
  return `${balance} - ${account.accountId} (${account.slug})`;
}

function runtimeLabel(runtime: XMcpStatus["runtimeTargets"][number]["runtime"]) {
  if (runtime === "openclaw") return "OpenClaw";
  return runtime.charAt(0).toUpperCase() + runtime.slice(1);
}

function runtimeMono(runtime: XMcpStatus["runtimeTargets"][number]["runtime"]) {
  if (runtime === "openclaw") return "Oc";
  return runtime.slice(0, 2).replace(/^./, (letter) => letter.toUpperCase());
}
