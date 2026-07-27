"use client";

import * as React from "react";
import { CalendarDays, Cloud, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/design-system/ui/button";
import { openExternalUrl } from "@/lib/native/open-external-url";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";
import type {
  BeelineBrokerConnection,
  BeelineCapability,
  BeelineProfile,
} from "@/lib/types/beeline";
import styles from "./beeline.module.css";

type BrokerStatus = {
  configured: boolean;
  upstreamReachable: boolean;
  baseUrlHost: string;
  errors: string[];
  googleConfigured: boolean;
  mcpConfigured: boolean;
};

type BrokerPayload = {
  ok: true;
  status: BrokerStatus;
  credentialConfigured: boolean;
  authority?: string;
  connections: BeelineBrokerConnection[];
};

type ApiError = { ok?: false; error?: string };

type BrokerReadPayload = ApiError & {
  status?: BrokerStatus;
  credentialConfigured?: boolean;
  connections?: BeelineBrokerConnection[];
};

const CAPABILITY_LABELS: Record<BeelineCapability, string> = {
  browser: "Browser",
  calendar: "Calendar",
  healthcare: "Healthcare",
  messaging: "Messaging",
  shopping: "Shopping",
  travel: "Travel",
};

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as T | ApiError;
  if (!response.ok || ("ok" in (payload as object) && (payload as { ok?: boolean }).ok === false)) {
    throw new Error((payload as ApiError).error || `Beeline broker request failed (${response.status}).`);
  }
  return payload as T;
}

async function readBrokerPayload(path: string): Promise<BrokerPayload> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as BrokerReadPayload;
  if (payload.status) {
    return {
      ok: true,
      status: payload.status,
      credentialConfigured: Boolean(payload.credentialConfigured),
      connections: Array.isArray(payload.connections) ? payload.connections : [],
    };
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Beeline broker request failed (${response.status}).`);
  }
  throw new Error("Beeline broker returned an invalid status response.");
}

export function BeelineConnectionsPanel({
  profile,
  onMessage,
  onError,
  onConnectionsChange,
  onActivity,
}: {
  profile: BeelineProfile;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
  onConnectionsChange: (profileId: string, connections: BeelineBrokerConnection[]) => void;
  onActivity: (profileId: string, action: string, tone?: "live" | "ready" | "muted") => void;
}) {
  const [payload, setPayload] = React.useState<BrokerPayload | null>(null);
  const [busy, setBusy] = React.useState("");
  const [showMcpForm, setShowMcpForm] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [endpointUrl, setEndpointUrl] = React.useState("");
  const [bearerToken, setBearerToken] = React.useState("");
  const [capability, setCapability] = React.useState<BeelineCapability>(profile.capabilities[0] || "browser");

  const loadPayload = React.useCallback(() => (
    readBrokerPayload(`/api/beeline/broker?profileId=${encodeURIComponent(profile.id)}`)
  ), [profile.id]);

  const applyPayload = React.useCallback((next: BrokerPayload) => {
    setPayload(next);
    onConnectionsChange(profile.id, next.connections);
  }, [onConnectionsChange, profile.id]);

  const refresh = React.useCallback(async () => {
    setBusy("refresh");
    try {
      applyPayload(await loadPayload());
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load family connections.");
    } finally {
      setBusy("");
    }
  }, [applyPayload, loadPayload, onError]);

  React.useEffect(() => {
    let cancelled = false;
    loadPayload().then((next) => {
      if (!cancelled) applyPayload(next);
    }).catch((error: unknown) => {
      if (!cancelled) onError(error instanceof Error ? error.message : "Could not load family connections.");
    });
    return () => { cancelled = true; };
  }, [applyPayload, loadPayload, onError]);

  const connectGoogle = React.useCallback(async () => {
    setBusy("google");
    onError("");
    onMessage("");
    try {
      const response = await apiJson<{ ok: true; authorizationUrl: string }>("/api/beeline/broker", {
        method: "POST",
        body: JSON.stringify({ action: "google-oauth-start", profileId: profile.id }),
      });
      await openExternalUrl(response.authorizationUrl);
      onMessage("Opened Google sign-in in your browser. Finish there, then refresh the account list.");
      onActivity(profile.id, `opened Google sign-in for ${profile.displayName}`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not start Google authorization.");
    } finally {
      setBusy("");
    }
  }, [onActivity, onError, onMessage, profile.displayName, profile.id]);

  const connectMcp = React.useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("mcp");
    onError("");
    onMessage("");
    const connectedLabel = label;
    try {
      await apiJson("/api/beeline/broker", {
        method: "POST",
        body: JSON.stringify({
          action: "mcp-connect",
          profileId: profile.id,
          label,
          endpointUrl,
          bearerToken,
          capability,
        }),
      });
      setLabel("");
      setEndpointUrl("");
      setBearerToken("");
      setShowMcpForm(false);
      onMessage(`${connectedLabel} is now scoped to ${profile.displayName}.`);
      onActivity(profile.id, `connected ${connectedLabel} for ${profile.displayName}`, "live");
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not connect the MCP server.");
    } finally {
      setBusy("");
    }
  }, [bearerToken, capability, endpointUrl, label, onActivity, onError, onMessage, profile.displayName, profile.id, refresh]);

  const disconnect = React.useCallback(async (connection: BeelineBrokerConnection) => {
    if (!(await confirmUserAction(`Disconnect ${connection.label} from ${profile.displayName}? The broker will revoke its stored credential.`))) return;
    setBusy(connection.id);
    onError("");
    try {
      await apiJson("/api/beeline/broker", {
        method: "POST",
        body: JSON.stringify({ action: "disconnect", profileId: profile.id, connectionId: connection.id }),
      });
      onMessage(`${connection.label} was disconnected from ${profile.displayName}.`);
      onActivity(profile.id, `disconnected ${connection.label} from ${profile.displayName}`);
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not disconnect the family account.");
    } finally {
      setBusy("");
    }
  }, [onActivity, onError, onMessage, profile.displayName, profile.id, refresh]);

  const ready = Boolean(payload?.status.upstreamReachable && payload.credentialConfigured);
  const googleReady = Boolean(ready && payload?.status.googleConfigured);
  const mcpReady = Boolean(ready && payload?.status.mcpConfigured);
  const authorityReady = profile.consent.status === "confirmed";
  const statusLabel = ready && (googleReady || mcpReady)
    ? "Broker ready"
    : payload?.status.upstreamReachable ? "Setup needed" : "Broker offline";

  return (
    <div className={styles.accountSection} data-testid="beeline-online-accounts">
      <div className={styles.accountSectionHeader}>
        <div><Cloud /><span>Online accounts</span></div>
        <div>
          <span className={ready ? styles.accountStatusLive : styles.accountStatusMuted}>{statusLabel}</span>
          <Button variant="ghost" size="icon" onClick={() => void refresh()} isLoading={busy === "refresh"} aria-label="Refresh online accounts"><RefreshCw /></Button>
        </div>
      </div>

      {!authorityReady ? (
        <div className={styles.connectionNotice}><Cloud /><span>Give permission for {profile.displayName} before connecting accounts.</span></div>
      ) : !payload?.credentialConfigured ? (
        <div className={styles.connectionNotice}><Cloud /><span>Set up a HivemindOS hosted account credential before using the encrypted broker.</span></div>
      ) : !payload?.status.upstreamReachable ? (
        <div className={styles.connectionNotice}><Cloud /><span>The hosted broker is not reachable. Their dedicated browser remains available.</span></div>
      ) : null}
      {ready && (!payload?.status.googleConfigured || !payload?.status.mcpConfigured) ? (
        <div className={styles.connectionNotice}><Cloud /><span>{[
          !payload?.status.googleConfigured ? "Google OAuth" : "",
          !payload?.status.mcpConfigured ? "MCP credential custody" : "",
        ].filter(Boolean).join(" and ")} still needs hosted configuration.</span></div>
      ) : null}

      {payload?.connections.length ? (
        <div className={styles.connectionList}>
          {payload.connections.map((connection) => (
            <div key={connection.id} className={styles.connectionRow}>
              <span className={styles.connectionIcon}>{connection.provider === "google-calendar" ? <CalendarDays /> : <Link2 />}</span>
              <span className={styles.connectionCopy}>
                <strong>{connection.label}</strong>
                <span>{connection.provider === "google-calendar" ? "Google Calendar" : `MCP · ${connection.endpointOrigin || "remote endpoint"}`} · {CAPABILITY_LABELS[connection.capability]}</span>
              </span>
              <span className={styles.liveLabel}><i /> Live</span>
              <Button variant="ghost" size="icon" onClick={() => void disconnect(connection)} isLoading={busy === connection.id} aria-label={`Disconnect ${connection.label}`}><Trash2 /></Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.connectionActions}>
        <div className={styles.connectionActionCard}>
          <span className={styles.connectionIcon}><CalendarDays /></span>
          <div><strong>Google Calendar</strong><p>Let the agent see {profile.displayName}&apos;s calendar and add events with your approval.</p></div>
          <Button variant="secondary" size="sm" onClick={() => void connectGoogle()} isLoading={busy === "google"} disabled={!googleReady || !profile.capabilities.includes("calendar")}>Connect Google</Button>
        </div>

        <div className={styles.connectionActionCard}>
          <span className={styles.connectionIcon}><Link2 /></span>
          <div><strong>Another account or service</strong><p>Connect a public HTTPS MCP service and keep its optional bearer credential in the encrypted broker.</p></div>
          <Button variant="outline" size="sm" onClick={() => setShowMcpForm((current) => !current)} disabled={!mcpReady || !profile.capabilities.length} aria-expanded={showMcpForm}>
            {showMcpForm ? "Cancel" : <><Plus /> Connect</>}
          </Button>
        </div>

        {showMcpForm ? (
          <form className={styles.mcpForm} onSubmit={connectMcp}>
            <div className={styles.formGrid}>
              <label><span>Connection name</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Care portal" required /></label>
              <label><span>Allowed area</span><select value={capability} onChange={(event) => setCapability(event.target.value as BeelineCapability)}>{profile.capabilities.map((item) => <option key={item} value={item}>{CAPABILITY_LABELS[item]}</option>)}</select></label>
              <label className={styles.wide}><span>HTTPS MCP endpoint</span><input type="url" value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} placeholder="https://mcp.example.com/rpc" required /></label>
              <label className={styles.wide}><span>Bearer token, if required</span><input type="password" value={bearerToken} onChange={(event) => setBearerToken(event.target.value)} autoComplete="new-password" placeholder="Sent once to the hosted broker" /></label>
            </div>
            <Button type="submit" size="sm" isLoading={busy === "mcp"}>Connect service</Button>
          </form>
        ) : null}
      </div>
      <p className={styles.connectionFootnote}>Online account secrets go directly to the hosted broker. Agents receive opaque connection IDs and approved results, never token values.</p>
    </div>
  );
}
