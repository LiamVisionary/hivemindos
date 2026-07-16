"use client";

import * as React from "react";
import { KeyRound, LockKeyhole, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/design-system/ui/button";
import {
  deleteNativeBeelineCredential,
  listNativeBeelineCredentials,
  storeNativeBeelineCredential,
} from "@/lib/native/beeline-credentials";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import type {
  BeelineLocalCredential,
  BeelineLocalCredentialKind,
  BeelineProfile,
} from "@/lib/types/beeline";
import styles from "./beeline.module.css";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type HeaderStyle = "authorization-bearer" | "authorization-raw" | "api-key";
const subscribeDesktopRuntime = () => () => {};

function headerSettings(style: HeaderStyle) {
  if (style === "api-key") return { headerName: "X-API-Key", headerPrefix: "" };
  if (style === "authorization-raw") return { headerName: "Authorization", headerPrefix: "" };
  return { headerName: "Authorization", headerPrefix: "Bearer " };
}

export function BeelineLocalCredentialsPanel({
  profile,
  agentName,
  onMessage,
  onError,
  onCredentialsChange,
  onActivity,
}: {
  profile: BeelineProfile;
  agentName: string;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
  onCredentialsChange: (profileId: string, credentials: BeelineLocalCredential[]) => void;
  onActivity: (profileId: string, action: string, tone?: "live" | "ready" | "muted") => void;
}) {
  const desktop = React.useSyncExternalStore(subscribeDesktopRuntime, isTauriDesktopRuntime, () => false);
  const [credentials, setCredentials] = React.useState<BeelineLocalCredential[]>([]);
  const [available, setAvailable] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [showForm, setShowForm] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [origin, setOrigin] = React.useState("");
  const [kind, setKind] = React.useState<BeelineLocalCredentialKind>("login");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [token, setToken] = React.useState("");
  const [headerStyle, setHeaderStyle] = React.useState<HeaderStyle>("authorization-bearer");
  const [restricted, setRestricted] = React.useState(false);
  const [allowedMethods, setAllowedMethods] = React.useState<string[]>(["GET"]);

  const applyCredentials = React.useCallback((next: BeelineLocalCredential[]) => {
    setCredentials(next);
    onCredentialsChange(profile.id, next);
  }, [onCredentialsChange, profile.id]);

  const refresh = React.useCallback(async () => {
    if (!isTauriDesktopRuntime() || profile.consent.status !== "confirmed") {
      applyCredentials([]);
      return;
    }
    setBusy("refresh");
    try {
      const payload = await listNativeBeelineCredentials(profile.id);
      setAvailable(payload.available);
      applyCredentials(payload.credentials);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not read local credentials.");
    } finally {
      setBusy("");
    }
  }, [applyCredentials, onError, profile.consent.status, profile.id]);

  React.useEffect(() => {
    const refreshTimer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(refreshTimer);
  }, [desktop, profile.consent.status, refresh]);

  const save = React.useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("save");
    onError("");
    onMessage("");
    const savedLabel = label;
    try {
      await storeNativeBeelineCredential({
        profileId: profile.id,
        label,
        kind,
        origin,
        agentUseMode: restricted ? "restricted" : "flexible",
        allowedHttpMethods: restricted && kind === "http-header" ? allowedMethods : [],
        ...(kind === "login" ? { username, password } : { ...headerSettings(headerStyle), token }),
      });
      setLabel("");
      setOrigin("");
      setUsername("");
      setPassword("");
      setToken("");
      setShowForm(false);
      onMessage(`${savedLabel} is saved in this device's secure credential store for ${profile.displayName}.`);
      onActivity(profile.id, `saved ${savedLabel} on this device`, restricted ? "ready" : "live");
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save the local credential.");
    } finally {
      setBusy("");
    }
  }, [allowedMethods, headerStyle, kind, label, onActivity, onError, onMessage, origin, password, profile.displayName, profile.id, refresh, restricted, token, username]);

  const remove = React.useCallback(async (credential: BeelineLocalCredential) => {
    if (!window.confirm(`Delete ${credential.label} from this device's secure credential store?`)) return;
    setBusy(credential.id);
    onError("");
    try {
      await deleteNativeBeelineCredential(profile.id, credential.id);
      const next = credentials.filter((item) => item.id !== credential.id);
      applyCredentials(next);
      onMessage(`${credential.label} was deleted from this device.`);
      onActivity(profile.id, `deleted ${credential.label} from this device`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not delete the local credential.");
    } finally {
      setBusy("");
    }
  }, [applyCredentials, credentials, onActivity, onError, onMessage, profile.id]);

  return (
    <div className={styles.accountSection} data-testid="beeline-local-credentials">
      <div className={styles.accountSectionHeader}>
        <div><LockKeyhole /><span>Saved logins on this computer</span></div>
        <div>
          <span className={styles.deviceStoreLabel}>Operating-system secure store</span>
          {desktop && profile.consent.status === "confirmed" ? <Button variant="ghost" size="icon" onClick={() => void refresh()} isLoading={busy === "refresh"} aria-label="Refresh saved logins"><RefreshCw /></Button> : null}
        </div>
      </div>
      <p className={styles.accountDescription}>For websites {profile.displayName} signs into directly. The secret stays in this computer&apos;s secure store; {agentName} can use it only at the exact saved site and can never read or export it.</p>

      {!desktop ? (
        <div className={styles.connectionNotice}><KeyRound /><span>Open Beeline in the HivemindOS desktop app to add or manage saved logins.</span></div>
      ) : profile.consent.status !== "confirmed" ? (
        <div className={styles.connectionNotice}><ShieldCheck /><span>Give permission for {profile.displayName} before storing credentials for them.</span></div>
      ) : !available ? (
        <div className={styles.connectionNotice}><KeyRound /><span>The operating-system credential store is locked or unavailable.</span></div>
      ) : (
        <>
          {credentials.length ? (
            <div className={styles.connectionList}>
              {credentials.map((credential) => (
                <div key={credential.id} className={styles.connectionRow}>
                  <span className={styles.connectionIcon}><KeyRound /></span>
                  <span className={styles.connectionCopy}>
                    <strong>{credential.label}</strong>
                    <span>{credential.kind === "login" ? "Website login" : credential.headerName || "HTTP credential"} · {credential.origin}</span>
                  </span>
                  <span className={credential.agentUseMode === "restricted" ? styles.restrictedLabel : styles.liveLabel}>
                    {credential.agentUseMode === "restricted" ? "Asks each time" : <><i /> Ready</>}
                  </span>
                  <Button variant="ghost" size="icon" onClick={() => void remove(credential)} isLoading={busy === credential.id} aria-label={`Delete ${credential.label}`}><Trash2 /></Button>
                </div>
              ))}
            </div>
          ) : null}

          {showForm ? (
            <form className={styles.localCredentialForm} onSubmit={save}>
              <div className={styles.formGrid}>
                <label><span>What is it?</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Patient portal" required /></label>
                <label><span>Credential type</span><select value={kind} onChange={(event) => setKind(event.target.value as BeelineLocalCredentialKind)}><option value="login">Website username and password</option><option value="http-header">API or HTTP token</option></select></label>
                <label className={styles.wide}><span>Exact HTTPS website</span><input type="url" inputMode="url" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="https://portal.example.com" required /><small>Every other origin, redirect, private address, and non-HTTPS destination is refused.</small></label>
                {kind === "login" ? (
                  <>
                    <label><span>Username</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
                    <label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></label>
                  </>
                ) : (
                  <>
                    <label><span>How the website accepts it</span><select value={headerStyle} onChange={(event) => setHeaderStyle(event.target.value as HeaderStyle)}><option value="authorization-bearer">Authorization · Bearer token</option><option value="authorization-raw">Authorization · raw token</option><option value="api-key">X-API-Key</option></select></label>
                    <label><span>Token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" required /></label>
                  </>
                )}
              </div>

              <label className={styles.securityToggle}>
                <input type="checkbox" checked={restricted} onChange={(event) => setRestricted(event.target.checked)} />
                <span><strong>Ask me each time</strong><small>Require a separate confirmation before {agentName} uses this credential{kind === "http-header" ? " and limit allowed HTTP methods" : ""}.</small></span>
              </label>

              {restricted && kind === "http-header" ? (
                <fieldset className={styles.capabilities}>
                  <legend>Allowed HTTP methods</legend>
                  {HTTP_METHODS.map((method) => (
                    <label key={method} className={allowedMethods.includes(method) ? styles.capabilityChoiceActive : styles.capabilityChoice}>
                      <input type="checkbox" checked={allowedMethods.includes(method)} onChange={(event) => setAllowedMethods((current) => event.target.checked ? [...current, method] : current.filter((item) => item !== method))} />
                      <span>{method}</span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <div className={styles.buttonRow}>
                <Button type="submit" size="sm" isLoading={busy === "save"} disabled={!available}><KeyRound /> Save on this computer</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowForm(true)}><Plus /> Save a website login</Button>
          )}
        </>
      )}
      <p className={styles.connectionFootnote}>Credential values cannot be revealed or exported. The broker records only the opaque credential ID, exact origin, method, outcome, and time.</p>
    </div>
  );
}
