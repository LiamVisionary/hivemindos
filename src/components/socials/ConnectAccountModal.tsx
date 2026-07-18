"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, X } from "lucide-react";

import { useSocialsDesk } from "@/components/socials/socials-context";
import { SocialsSpinner } from "@/components/socials/skeletons";
import { loadSharedHiveEnvKeys } from "@/features/dashboard/shared-hive-env-client";
import { openExternalUrl } from "@/lib/native/open-external-url";
import { SharedHiveEnvCredentialInput } from "@/features/env/SharedHiveEnvCredentialInput";

/**
 * Connect flow: pick platform → pick method → identify the account.
 * Credentials themselves live in the shared hive env / gateway rails — this
 * modal links an account record to those rails and live-probes it.
 *
 * Managed X is special: the account identity IS a gateway connection, so the
 * modal lists existing connections to pick from (no typed handles) and can
 * launch the managed sign-in to mint a new one. A record without a connection
 * slug would probe as "finish the managed X sign-in" forever.
 */

type ManagedXConnection = Record<string, unknown>;

function managedConnectionSlug(connection: ManagedXConnection): string {
  for (const key of ["slug", "connectionSlug", "id"]) {
    const value = connection[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function managedConnectionHandle(connection: ManagedXConnection): string {
  for (const key of ["handle", "username", "screenName", "xUsername", "accountHandle"]) {
    const value = connection[key];
    if (typeof value === "string" && value.trim()) return value.trim().replace(/^@/, "");
  }
  return "";
}

export function ConnectAccountModal() {
  const desk = useSocialsDesk();
  const [platformKey, setPlatformKey] = useState("x");
  const [methodKey, setMethodKey] = useState("");
  const [handle, setHandle] = useState("");
  const [binding, setBinding] = useState<Record<string, string>>({});
  const [soulPath, setSoulPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [managedLoading, setManagedLoading] = useState(false);
  const [managedError, setManagedError] = useState<string | null>(null);
  const [managedConnections, setManagedConnections] = useState<ManagedXConnection[]>([]);
  const [managedCreditAccountId, setManagedCreditAccountId] = useState("");
  const [signInBusy, setSignInBusy] = useState(false);

  const platform = useMemo(
    () => desk.platforms.find((candidate) => candidate.platform === platformKey) ?? desk.platforms[0],
    [desk.platforms, platformKey],
  );
  const method = platform?.methods.find((candidate) => candidate.method === methodKey) ?? platform?.methods[0];
  const isManagedX = platform?.platform === "x" && method?.method === "managed-oauth";

  useEffect(() => {
    if (!desk.connectOpen || !isManagedX) return;
    let cancelled = false;
    // Deferred like ClawBankStatusCard's initial refresh: the set-state-in-effect
    // rule forbids kicking a state-setting fetch synchronously in the effect body.
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setManagedLoading(true);
      setManagedError(null);
      void (async () => {
        try {
          const res = await fetch("/api/integrations/x-managed", { cache: "no-store" });
          const payload = (await res.json()) as {
            ok?: boolean;
            connections?: ManagedXConnection[];
            selectedCreditAccountId?: string;
            creditAccounts?: Array<{ accountId?: string }>;
            error?: string;
          };
          if (cancelled) return;
          if (!payload.ok) {
            setManagedError(payload.error ?? `HTTP ${res.status}`);
            return;
          }
          setManagedConnections(Array.isArray(payload.connections) ? payload.connections : []);
          setManagedCreditAccountId(payload.selectedCreditAccountId ?? payload.creditAccounts?.[0]?.accountId ?? "");
        } catch (fetchError) {
          if (!cancelled) setManagedError(fetchError instanceof Error ? fetchError.message : String(fetchError));
        } finally {
          if (!cancelled) setManagedLoading(false);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [desk.connectOpen, isManagedX]);

  // Auto-detect saved credentials: when a canonical key is absent from the
  // shared env but a known same-meaning alias (matrix envKeyAliases) is saved,
  // pre-bind the alias so its row prefills with zero clicks. Deferred kick per
  // the set-state-in-effect rule; never overwrites an existing choice.
  const methodEnvKeySignature = (method?.envKeys ?? []).join("\n");
  const methodAliasSignature = JSON.stringify(method?.envKeyAliases ?? {});
  useEffect(() => {
    if (!desk.connectOpen || !methodEnvKeySignature) return;
    const aliases = JSON.parse(methodAliasSignature) as Record<string, string[]>;
    if (!Object.keys(aliases).length) return;
    const envKeys = methodEnvKeySignature.split("\n");
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadSharedHiveEnvKeys().then((result) => {
        if (cancelled || result.error) return;
        const saved = new Set(result.keys);
        setBinding((current) => {
          let next: Record<string, string> | null = null;
          for (const canonicalKey of envKeys) {
            const bindKey = `env:${canonicalKey}`;
            if (saved.has(canonicalKey) || current[bindKey]) continue;
            const detected = (aliases[canonicalKey] ?? []).find((alias) => saved.has(alias));
            if (!detected) continue;
            next = next ?? { ...current };
            next[bindKey] = detected;
          }
          return next ?? current;
        });
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [desk.connectOpen, methodEnvKeySignature, methodAliasSignature]);

  if (!desk.connectOpen || !platform || !method) return null;

  const close = () => {
    desk.setConnectOpen(false);
    setError(null);
  };

  const startManagedSignIn = async () => {
    setSignInBusy(true);
    setManagedError(null);
    try {
      if (!managedCreditAccountId) {
        setManagedError("No managed X credit account found — fund one in Credit Accounts first.");
        return;
      }
      const res = await fetch("/api/integrations/x-managed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "oauth-start", creditAccountId: managedCreditAccountId, returnUrl: window.location.href }),
      });
      const payload = (await res.json()) as { ok?: boolean; url?: string; authorizeUrl?: string; authorizationUrl?: string; error?: string };
      const target = payload.url ?? payload.authorizeUrl ?? payload.authorizationUrl;
      if (!payload.ok || !target) {
        setManagedError(payload.error ?? "Could not start the managed X sign-in.");
        return;
      }
      await openExternalUrl(target);
      setManagedError("Finish the sign-in in the opened tab, then come back and pick the new connection (reopen this modal to refresh the list).");
    } catch (startError) {
      setManagedError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setSignInBusy(false);
    }
  };

  const managedReady = !isManagedX || Boolean(binding.connectionSlug && handle.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await desk.createAccount({
        platform: platform.platform,
        handle,
        method: method.method,
        ...(Object.keys(binding).length ? { binding } : {}),
        ...(soulPath ? { soulPath } : {}),
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to create the account.");
        return;
      }
      setHandle("");
      setBinding({});
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sc-modal-backdrop" role="dialog" aria-modal="true" aria-label="Connect social account" onClick={close}>
      <div className="sc-modal" onClick={(event) => event.stopPropagation()}>
        <div className="sc-card-head" style={{ marginBottom: 0 }}>
          <span className="sc-card-title" style={{ fontSize: 15 }}>Connect a social account</span>
          <button type="button" className="sc-src-remove" aria-label="Close" onClick={close}>
            <X aria-hidden="true" width={16} height={16} />
          </button>
        </div>

        <div className="sc-field">
          <span className="sc-label">Platform</span>
          <div className="sc-plat-grid">
            {desk.platforms.map((candidate) => (
              <button
                key={candidate.platform}
                type="button"
                className="sc-plat"
                data-active={candidate.platform === platform.platform}
                onClick={() => {
                  setPlatformKey(candidate.platform);
                  setMethodKey("");
                  setBinding({});
                  setHandle("");
                }}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sc-field">
          <span className="sc-label">Connect method</span>
          <select
            className="sc-select"
            value={method.method}
            onChange={(event) => {
              setMethodKey(event.target.value);
              setBinding({});
              setHandle("");
            }}
          >
            {platform.methods.map((candidate) => (
              <option key={candidate.method} value={candidate.method}>{candidate.label}</option>
            ))}
          </select>
          {method.notes ? <div className="sc-note">{method.notes}</div> : null}
        </div>

        {!isManagedX && method.envKeys.length ? (
          <div className="sc-field">
            <span className="sc-label">Credentials (Shared Hive Env)</span>
            <div className="sc-note" style={{ marginTop: 0 }}>
              One picker per variable: keep the saved value, paste a new one, or pick a differently-named
              saved variable to use for this account only.
            </div>
            {method.envKeys.map((canonicalKey) => {
              const override = binding[`env:${canonicalKey}`] ?? "";
              return (
                <div key={`${method.method}:${canonicalKey}`} className="sc-env-var">
                  <span className="sc-env-var-name">
                    {canonicalKey}
                    {override ? <em> ← using {override}</em> : null}
                  </span>
                  <SharedHiveEnvCredentialInput
                    preferredEnvKeys={[override || canonicalKey, ...(method.envKeyAliases?.[canonicalKey] ?? [])]}
                    defaultEnvKey={canonicalKey}
                    valuePlaceholder={`Paste ${canonicalKey} value`}
                    continueLabel="Use"
                    saveLabel="Save"
                    onSaved={(credential) => {
                      setBinding((current) => {
                        const next = { ...current };
                        if (credential.envKey && credential.envKey !== canonicalKey) next[`env:${canonicalKey}`] = credential.envKey;
                        else delete next[`env:${canonicalKey}`];
                        return next;
                      });
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : null}

        {isManagedX ? (
          <div className="sc-field">
            <span className="sc-label">X account</span>
            {managedLoading ? (
              <div className="sc-note" role="status" aria-label="Loading managed X connections" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <SocialsSpinner /> Checking the managed gateway for existing connections
              </div>
            ) : (
              <>
                <select
                  className="sc-select"
                  value={binding.connectionSlug ?? ""}
                  onChange={(event) => {
                    const slug = event.target.value;
                    const picked = managedConnections.find((connection) => managedConnectionSlug(connection) === slug);
                    const pickedHandle = picked ? managedConnectionHandle(picked) : "";
                    setBinding(slug ? { ...binding, connectionSlug: slug } : (() => { const next = { ...binding }; delete next.connectionSlug; return next; })());
                    setHandle(pickedHandle || (slug ? slug : ""));
                  }}
                >
                  <option value="">
                    {managedConnections.length ? "Pick a connected X account" : "No gateway connections yet — sign in below"}
                  </option>
                  {managedConnections.map((connection) => {
                    const slug = managedConnectionSlug(connection);
                    const connHandle = managedConnectionHandle(connection);
                    if (!slug) return null;
                    return (
                      <option key={slug} value={slug}>
                        {connHandle ? `@${connHandle}` : slug}
                      </option>
                    );
                  })}
                </select>
                <div>
                  <button type="button" className="sc-btn" disabled={signInBusy} onClick={() => void startManagedSignIn()}>
                    {signInBusy ? <SocialsSpinner /> : <ExternalLink aria-hidden="true" width={13} height={13} />} Sign in with X to add a new connection
                  </button>
                </div>
              </>
            )}
            {managedError ? <div className="sc-note">{managedError}</div> : null}
          </div>
        ) : (
          <div className="sc-field">
            <span className="sc-label">Handle</span>
            <input
              className="sc-input"
              placeholder={platform.platform === "telegram" ? "channel name" : "@handle"}
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
            />
          </div>
        )}

        {(method.setupFields ?? []).map((field) => (
          <div key={field} className="sc-field">
            <span className="sc-label">{field}</span>
            <input
              className="sc-input"
              placeholder={field === "chatId" ? "-100…" : field}
              value={binding[field] ?? ""}
              onChange={(event) => setBinding({ ...binding, [field]: event.target.value })}
            />
          </div>
        ))}

        <div className="sc-field">
          <span className="sc-label">Posting voice (optional)</span>
          <select className="sc-select" value={soulPath} onChange={(event) => setSoulPath(event.target.value)}>
            <option value="">Pick later</option>
            {desk.souls.map((soul) => (
              <option key={soul.path} value={soul.path}>{soul.label}</option>
            ))}
          </select>
        </div>

        {platform.limits.length ? (
          <div className="sc-note">{platform.limits.join(" ")}</div>
        ) : null}
        {error ? <div className="sc-error">{error}</div> : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="sc-btn" onClick={close}>Cancel</button>
          <button
            type="button"
            className="sc-btn"
            data-tone="primary"
            disabled={busy || !handle.trim() || !managedReady}
            onClick={() => void submit()}
          >
            {busy ? <SocialsSpinner /> : null} Connect
          </button>
        </div>
      </div>
    </div>
  );
}
