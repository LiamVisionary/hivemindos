"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";

import { useSocialsDesk } from "@/components/socials/socials-context";
import { SocialsSpinner } from "@/components/socials/skeletons";
import { loadSharedHiveEnvKeys } from "@/features/dashboard/shared-hive-env-client";
import { openExternalUrl } from "@/lib/native/open-external-url";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";
import {
  MANAGED_X_RETURN_POLL_GRACE_MS,
  MANAGED_X_RETURN_POLL_INTERVAL_MS,
  MANAGED_X_RETURN_POLL_WINDOW_MS,
  managedXReturnUrl,
} from "@/lib/services/managed-x-oauth-return";
import {
  MANAGED_X_RETURN_EVENT,
  managedXReturnMessage,
  type ManagedXReturnPayload,
} from "@/lib/services/managed-x-return";
import { SharedHiveEnvCredentialInput } from "@/features/env/SharedHiveEnvCredentialInput";
import { BrowserProfileConnectFlow } from "@/components/socials/BrowserProfileConnectFlow";
import {
  managedXConnectionHandle,
  managedXConnectionId,
  type ManagedXConnectionRecord,
} from "@/lib/services/managed-x-connections";

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

type ManagedXCreditAccount = { accountId?: string; slug?: string; balanceLabel?: string };
type ManagedXReturnPoll = {
  creditAccountId: string;
  slug: string;
  since: number;
  until: number;
};

export function ConnectAccountModal() {
  const desk = useSocialsDesk();
  const setConnectOpen = desk.setConnectOpen;
  const [platformKey, setPlatformKey] = useState("x");
  const [methodKey, setMethodKey] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [handle, setHandle] = useState("");
  const [binding, setBinding] = useState<Record<string, string>>({});
  const [soulPath, setSoulPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [managedLoading, setManagedLoading] = useState(false);
  const [managedError, setManagedError] = useState<string | null>(null);
  const [managedConnections, setManagedConnections] = useState<ManagedXConnectionRecord[]>([]);
  const [managedCreditAccounts, setManagedCreditAccounts] = useState<ManagedXCreditAccount[]>([]);
  const [managedCreditAccountId, setManagedCreditAccountId] = useState("");
  const [managedCreditSlug, setManagedCreditSlug] = useState("");
  const [managedRefreshKey, setManagedRefreshKey] = useState(0);
  const [managedReturnPoll, setManagedReturnPoll] = useState<ManagedXReturnPoll | null>(null);
  const [signInBusy, setSignInBusy] = useState(false);
  const preferredManagedConnectionId = useRef("");
  const modalRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setConnectOpen(false);
    setStep(1);
    setError(null);
  }, [setConnectOpen]);

  const platform = useMemo(
    () => desk.platforms.find((candidate) => candidate.platform === platformKey) ?? desk.platforms[0],
    [desk.platforms, platformKey],
  );
  const method = platform?.methods.find((candidate) => candidate.method === methodKey) ?? platform?.methods[0];
  const isManagedX = platform?.platform === "x" && method?.method === "managed-oauth";
  const isBrowserProfile = method?.method === "browser-profile";

  const handleManagedXReturn = useCallback((payload: ManagedXReturnPayload) => {
    setManagedReturnPoll(null);
    preferredManagedConnectionId.current = payload.connectionId?.trim() || "";
    setManagedError(managedXReturnMessage(payload) || "X sign-in returned to HivemindOS.");
    setManagedRefreshKey((current) => current + 1);
  }, []);

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
          const query = new URLSearchParams();
          if (managedCreditAccountId) query.set("creditAccountId", managedCreditAccountId);
          if (managedCreditSlug) query.set("slug", managedCreditSlug);
          const res = await fetch(`/api/integrations/x-managed${query.size ? `?${query.toString()}` : ""}`, { cache: "no-store" });
          const payload = (await res.json()) as {
            ok?: boolean;
            connections?: ManagedXConnectionRecord[];
            selectedCreditAccountId?: string;
            creditAccounts?: ManagedXCreditAccount[];
            error?: string;
          };
          if (cancelled) return;
          if (!payload.ok) {
            setManagedError(payload.error ?? `HTTP ${res.status}`);
            return;
          }
          const connections = Array.isArray(payload.connections) ? payload.connections : [];
          const creditAccounts = Array.isArray(payload.creditAccounts) ? payload.creditAccounts : [];
          const selectedCreditAccountId = managedCreditAccountId || payload.selectedCreditAccountId || creditAccounts[0]?.accountId || "";
          const selectedCreditAccount = payload.creditAccounts?.find((account) => account.accountId === selectedCreditAccountId)
            ?? payload.creditAccounts?.[0];
          setManagedConnections(connections);
          setManagedCreditAccounts(creditAccounts);
          setManagedCreditAccountId(selectedCreditAccountId);
          setManagedCreditSlug(selectedCreditAccount?.slug ?? "");
          const preferredId = preferredManagedConnectionId.current;
          const preferred = preferredId
            ? connections.find((connection) => managedXConnectionId(connection) === preferredId)
            : undefined;
          if (preferred) {
            preferredManagedConnectionId.current = "";
            setBinding((current) => ({ ...current, connectionSlug: preferredId }));
            setHandle(managedXConnectionHandle(preferred) || preferredId);
          }
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
  }, [desk.connectOpen, isManagedX, managedCreditAccountId, managedCreditSlug, managedRefreshKey]);

  useEffect(() => {
    if (!desk.connectOpen || !isManagedX || !isTauriDesktopRuntime()) return undefined;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen<ManagedXReturnPayload>(MANAGED_X_RETURN_EVENT, (event) => {
        if (event.payload?.returnView && event.payload.returnView !== "socials") return;
        handleManagedXReturn(event.payload ?? {});
      }))
      .then((unlisten) => {
        const safeUnlisten = createSafeTauriUnlisten(unlisten);
        if (cancelled) {
          safeUnlisten();
          return;
        }
        cleanup = safeUnlisten;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [desk.connectOpen, handleManagedXReturn, isManagedX]);

  useEffect(() => {
    if (!managedReturnPoll) return undefined;
    let cancelled = false;
    let timeoutId: number | undefined;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() > managedReturnPoll.until) {
        setManagedReturnPoll(null);
        setManagedError("X sign-in is still pending. Finish in the browser, then reopen this modal to refresh.");
        return;
      }
      const params = new URLSearchParams({
        creditAccountId: managedReturnPoll.creditAccountId,
        since: String(managedReturnPoll.since),
      });
      if (managedReturnPoll.slug) params.set("slug", managedReturnPoll.slug);
      try {
        const response = await fetch(`/api/integrations/x-managed/desktop-return-pending?${params.toString()}`, { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          returned?: ManagedXReturnPayload | null;
        };
        if (response.ok && data.ok !== false && data.returned) {
          handleManagedXReturn(data.returned);
          return;
        }
      } catch {
        // Keep polling while the external browser completes the OAuth redirect.
      }
      if (!cancelled) {
        timeoutId = window.setTimeout(() => void poll(), MANAGED_X_RETURN_POLL_INTERVAL_MS);
      }
    };

    timeoutId = window.setTimeout(() => void poll(), MANAGED_X_RETURN_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [handleManagedXReturn, managedReturnPoll]);

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

  useEffect(() => {
    if (!desk.connectOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const focusFrame = window.requestAnimationFrame(() => {
      modalRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(modalRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [close, desk.connectOpen]);

  if (!desk.connectOpen || !platform || !method) return null;

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
        body: JSON.stringify({
          action: "oauth-start",
          creditAccountId: managedCreditAccountId,
          slug: managedCreditSlug,
          returnUrl: managedXReturnUrl(managedCreditAccountId, managedCreditSlug, "socials"),
        }),
      });
      const payload = (await res.json()) as { ok?: boolean; url?: string; authorizeUrl?: string; authorizationUrl?: string; error?: string };
      const target = payload.url ?? payload.authorizeUrl ?? payload.authorizationUrl;
      if (!payload.ok || !target) {
        setManagedError(payload.error ?? "Could not start the managed X sign-in.");
        return;
      }
      await openExternalUrl(target);
      if (isTauriDesktopRuntime()) {
        const now = Date.now();
        setManagedReturnPoll({
          creditAccountId: managedCreditAccountId,
          slug: managedCreditSlug,
          since: now - MANAGED_X_RETURN_POLL_GRACE_MS,
          until: now + MANAGED_X_RETURN_POLL_WINDOW_MS,
        });
        setManagedError("Finish the sign-in in the opened tab. HivemindOS will reopen and select the connected account automatically.");
      } else {
        setManagedError("Finish the sign-in in the opened tab, then return here and refresh the connection list.");
      }
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
      const accountBinding = isManagedX
        ? { ...binding, creditAccountId: managedCreditAccountId, creditSlug: managedCreditSlug }
        : binding;
      const result = await desk.createAccount({
        platform: platform.platform,
        handle,
        method: method.method,
        ...(Object.keys(accountBinding).length ? { binding: accountBinding } : {}),
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
    <div ref={modalRef} className="sc-modal-backdrop" role="dialog" aria-modal="true" aria-label="Connect social account" onClick={close}>
      <div className="sc-modal" onClick={(event) => event.stopPropagation()}>
        <div className="sc-card-head sc-connect-modal-head" style={{ marginBottom: 0 }}>
          <div>
            <span className="sc-card-title">Connect a social account</span>
            <p>Three steps. Credentials go to Shared Hive Env, never into the account record.</p>
          </div>
          <button type="button" className="sc-src-remove" aria-label="Close" onClick={close}>
            <X aria-hidden="true" width={16} height={16} />
          </button>
        </div>

        <div className="sc-connect-progress" aria-label={`Connect account step ${step} of 3`}>
          {(["Platform", "Method", "Identify"] as const).map((label, index) => {
            const number = (index + 1) as 1 | 2 | 3;
            return <div key={label} data-active={step === number} data-complete={step > number}><span>{step > number ? "✓" : number}</span><strong>{label}</strong>{number < 3 ? <i /> : null}</div>;
          })}
        </div>

        {step === 1 ? <div className="sc-field sc-connect-step">
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
                <strong>{candidate.label}</strong>
                <span>{Object.entries(candidate.capabilities).filter(([, support]) => support !== "unsupported").map(([capability]) => capability).join(" · ")}</span>
              </button>
            ))}
          </div>
        </div> : null}

        {step === 2 ? <div className="sc-field sc-connect-step">
          <span className="sc-label">Connect method</span>
          <div className="sc-method-list">
            {platform.methods.map((candidate) => (
              <button
                key={candidate.method}
                type="button"
                data-active={candidate.method === method.method}
                onClick={() => {
                  setMethodKey(candidate.method);
                  setBinding({});
                  setHandle("");
                }}
              >
                <i />
                <span><strong>{candidate.label}</strong><em>{candidate.notes || (candidate.browserProfile ? "Uses a persistent managed browser profile." : "Connect with credentials stored outside the account record.")}</em></span>
                <small>{candidate.method === "browser-profile" ? "recommended" : candidate.method === "managed-oauth" ? "metered" : "advanced"}</small>
              </button>
            ))}
          </div>
        </div> : null}

        {step === 3 ? <div className="sc-connect-step sc-connect-identify">
        {isBrowserProfile ? (
          <div className="sc-field">
            <BrowserProfileConnectFlow
              provider={platform.platform}
              providerLabel={platform.label}
              onDone={async ({ accountId, importCatalog }) => {
                if (importCatalog) {
                  // Best-effort initial catalog import; the monitor re-syncs hourly anyway.
                  await fetch("/api/marketplace/listings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "sync-catalog", accountId }),
                  }).catch(() => undefined);
                }
                await desk.refresh();
                close();
              }}
              onCancel={close}
            />
          </div>
        ) : null}

        {!isBrowserProfile && !isManagedX && method.envKeys.length ? (
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

        {isBrowserProfile ? null : isManagedX ? (
          <div className="sc-field">
            {managedCreditAccounts.length > 1 ? (
              <>
                <span className="sc-label">Credit account for X usage</span>
                <select
                  className="sc-select"
                  value={managedCreditAccountId}
                  onChange={(event) => {
                    const accountId = event.target.value;
                    const account = managedCreditAccounts.find((candidate) => candidate.accountId === accountId);
                    setManagedCreditAccountId(accountId);
                    setManagedCreditSlug(account?.slug ?? "");
                    setManagedConnections([]);
                    setBinding({});
                    setHandle("");
                  }}
                >
                  {managedCreditAccounts.map((account) => (
                    <option key={`${account.accountId}:${account.slug}`} value={account.accountId}>
                      {account.accountId}{account.balanceLabel ? ` · ${account.balanceLabel}` : ""}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
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
                    const picked = managedConnections.find((connection) => managedXConnectionId(connection) === slug);
                    const pickedHandle = picked ? managedXConnectionHandle(picked) : "";
                    setBinding(slug ? { ...binding, connectionSlug: slug } : (() => { const next = { ...binding }; delete next.connectionSlug; return next; })());
                    setHandle(pickedHandle || (slug ? slug : ""));
                  }}
                >
                  <option value="">
                    {managedConnections.length ? "Pick a connected X account" : "No gateway connections yet — sign in below"}
                  </option>
                  {managedConnections.map((connection) => {
                    const slug = managedXConnectionId(connection);
                    const connHandle = managedXConnectionHandle(connection);
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

        {(isBrowserProfile ? [] : method.setupFields ?? []).map((field) => (
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

        {!isBrowserProfile ? (
          <div className="sc-field">
            <span className="sc-label">Posting voice (optional)</span>
            <select className="sc-select" value={soulPath} onChange={(event) => setSoulPath(event.target.value)}>
              <option value="">Pick later</option>
              {desk.souls.map((soul) => (
                <option key={soul.path} value={soul.path}>{soul.label}</option>
              ))}
            </select>
          </div>
        ) : null}

        {platform.limits.length ? (
          <div className="sc-note">{platform.limits.join(" ")}</div>
        ) : null}
        {error ? <div className="sc-error">{error}</div> : null}
        <div className="sc-manual-mode-note">Posting starts in manual mode. Nothing publishes until you approve it in review.</div>
        </div> : null}

        <div className="sc-connect-footer">
          <button type="button" className="sc-btn" disabled={step === 1} onClick={() => setStep((current) => Math.max(1, current - 1) as 1 | 2 | 3)}>Back</button>
          <div>
            <button type="button" className="sc-btn" onClick={close}>Cancel</button>
            {step < 3 ? <button type="button" className="sc-btn sc-connect-primary" onClick={() => setStep((current) => Math.min(3, current + 1) as 1 | 2 | 3)}>Continue</button> : null}
            {step === 3 && !isBrowserProfile ? (
              <button type="button" className="sc-btn sc-connect-primary" disabled={busy || !handle.trim() || !managedReady} onClick={() => void submit()}>
                {busy ? <SocialsSpinner /> : null} Connect account
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
