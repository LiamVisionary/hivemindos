"use client";

import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { Fingerprint, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import styles from "./DashboardSecurityControl.module.css";

type DashboardPasskey = {
  id: string;
  rpId: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  backedUp: boolean;
};

type DashboardSecurityControlProps = {
  onTooltipOpenChange?: (open: boolean) => void;
};

export function DashboardSecurityControl({ onTooltipOpenChange }: DashboardSecurityControlProps) {
  const [open, setOpen] = useState(false);
  const [passkeys, setPasskeys] = useState<DashboardPasskey[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"" | "add" | "lock" | string>("");
  const [message, setMessage] = useState("");
  const [platformAvailable, setPlatformAvailable] = useState(false);
  const [platformChecked, setPlatformChecked] = useState(false);
  const [nativeBiometricName, setNativeBiometricName] = useState("");
  const [nativeRuntime, setNativeRuntime] = useState(false);
  const [nativeBridgeUnavailable, setNativeBridgeUnavailable] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState("");

  const loadPasskeys = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/passkeys", { cache: "no-store" });
      const body = await response.json().catch(() => null) as { passkeys?: DashboardPasskey[]; error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Could not load device passkeys.");
      setPasskeys(Array.isArray(body?.passkeys) ? body.passkeys : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load device passkeys.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function detectDeviceAuthentication() {
      const nativeWindow = window as Window & { __TAURI_INTERNALS__?: unknown };
      if (nativeWindow.__TAURI_INTERNALS__) {
        if (!cancelled) {
          setNativeRuntime(true);
          setNativeBridgeUnavailable(false);
        }
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const status = await invoke<{ available?: boolean; kind?: string }>("native_dashboard_biometric_status");
          if (!cancelled) {
            if (status.available) {
              setNativeBiometricName(nativeBiometricLabel(status.kind));
            } else {
              setNativeBiometricName("");
            }
            setPlatformChecked(true);
          }
        } catch {
          if (!cancelled) {
            setNativeBridgeUnavailable(true);
            setPlatformChecked(true);
          }
        }
        return;
      }
      try {
        const { browserSupportsWebAuthn, platformAuthenticatorIsAvailable } = await import("@simplewebauthn/browser");
        const available = browserSupportsWebAuthn() && window.isSecureContext
          ? await platformAuthenticatorIsAvailable()
          : false;
        if (!cancelled) setPlatformAvailable(available);
      } catch {
        if (!cancelled) setPlatformAvailable(false);
      } finally {
        if (!cancelled) setPlatformChecked(true);
      }
    }
    void detectDeviceAuthentication();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function addPasskey() {
    setBusy("add");
    setMessage("");
    try {
      const optionsResponse = await fetch("/api/auth/passkeys/registration/options", {
        method: "POST",
        headers: { accept: "application/json" },
      });
      const optionsBody = await optionsResponse.json().catch(() => null) as {
        options?: PublicKeyCredentialCreationOptionsJSON;
        error?: string;
      } | null;
      if (!optionsResponse.ok || !optionsBody?.options) {
        throw new Error(optionsBody?.error || "Could not start passkey registration.");
      }
      const registration = await startRegistration({ optionsJSON: optionsBody.options });
      const verifyResponse = await fetch("/api/auth/passkeys/registration/verify", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ response: registration }),
      });
      const verifyBody = await verifyResponse.json().catch(() => null) as { error?: string } | null;
      if (!verifyResponse.ok) throw new Error(verifyBody?.error || "The passkey was not saved.");
      setMessage("Device passkey added. It will be offered the next time the dashboard is locked.");
      await loadPasskeys();
    } catch (error) {
      setMessage(error instanceof Error && error.name !== "NotAllowedError"
        ? error.message
        : "Passkey setup was cancelled or timed out.");
    } finally {
      setBusy("");
    }
  }

  async function removePasskey(id: string) {
    if (confirmRemoveId !== id) {
      setConfirmRemoveId(id);
      setMessage("Press Confirm remove to forget this device passkey. The device token will still work.");
      return;
    }
    setBusy(id);
    setMessage("");
    try {
      const response = await fetch("/api/auth/passkeys", {
        method: "DELETE",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Could not remove the passkey.");
      setConfirmRemoveId("");
      setMessage("Device passkey removed.");
      await loadPasskeys();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove the passkey.");
    } finally {
      setBusy("");
    }
  }

  async function lockDashboard() {
    setBusy("lock");
    setMessage("");
    try {
      const response = await fetch("/api/auth/session", { method: "DELETE", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Could not close the dashboard session.");
      window.location.replace(window.location.pathname + window.location.search);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not lock the dashboard.");
      setBusy("");
    }
  }

  const dialog = open && typeof document !== "undefined" ? createPortal(
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setOpen(false);
    }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="dashboard-security-title">
        <header className={styles.dialogHeader}>
          <div className={styles.titleGroup}>
            <span className={styles.titleIcon}><ShieldCheck aria-hidden="true" /></span>
            <div>
              <p>Dashboard access</p>
              <h2 id="dashboard-security-title">Face ID, Touch ID & passkeys</h2>
            </div>
          </div>
          <button type="button" className={styles.closeButton} onClick={() => setOpen(false)} aria-label="Close dashboard security">
            <X aria-hidden="true" />
          </button>
        </header>

        <div className={styles.body}>
          <p className={styles.intro}>
            {nativeBiometricName
              ? `${nativeBiometricName} is already enabled for this Mac and does not need to be added in HivemindOS. Lock HivemindOS to use it on the next unlock; the local dashboard token remains an optional fallback.`
              : nativeRuntime
                ? "HivemindOS uses this Mac's built-in biometric enrollment when available. The local dashboard token remains the fallback."
                : "Add this device's built-in authenticator to unlock HivemindOS with Face ID, Touch ID, Windows Hello, or its secure device credential. User verification is required every time."}
          </p>

          <div className={styles.actions}>
            {nativeBiometricName ? (
              <div className={styles.readyStatus} role="status" aria-label={`${nativeBiometricName} already enabled`}>
                <Fingerprint aria-hidden="true" />
                {nativeBiometricName} enabled
              </div>
            ) : !nativeRuntime ? (
              <button type="button" className={styles.primaryButton} onClick={() => void addPasskey()} disabled={!platformAvailable || Boolean(busy)}>
                {busy === "add" ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Fingerprint aria-hidden="true" />}
                {busy === "add" ? "Waiting for your device…" : "Add this device"}
              </button>
            ) : null}
            <button type="button" className={styles.secondaryButton} onClick={() => void lockDashboard()} disabled={Boolean(busy)}>
              {busy === "lock" ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <LockKeyhole aria-hidden="true" />}
              Lock now
            </button>
          </div>

          {nativeBridgeUnavailable ? (
            <p className={styles.notice}>
              The desktop biometric bridge is unavailable. Restart or update HivemindOS, or keep using the device token.
            </p>
          ) : platformChecked && !platformAvailable && !nativeBiometricName ? (
            <p className={styles.notice}>
              {nativeRuntime
                ? "A built-in biometric authenticator is not available on this device. You can keep using the device token."
                : "A built-in biometric or device authenticator is not available in this browser context. Open the dashboard through HTTPS or localhost, or keep using the device token."}
            </p>
          ) : null}
          {message ? <p className={styles.message} role="status">{message}</p> : null}

          <div className={styles.sectionHeading}>
            <div>
              <p>{nativeRuntime ? "Optional browser passkeys" : "Registered devices"}</p>
              <strong>{passkeys.length} {nativeRuntime ? "browser " : ""}passkey{passkeys.length === 1 ? "" : "s"}</strong>
            </div>
            {loading ? <LoaderCircle aria-label="Loading device passkeys" className={styles.spin} /> : null}
          </div>

          <div className={styles.passkeyList}>
            {passkeys.map((passkey) => (
              <article className={styles.passkeyRow} key={passkey.id}>
                <span className={styles.passkeyIcon}><KeyRound aria-hidden="true" /></span>
                <div className={styles.passkeyCopy}>
                  <strong>{passkey.label}</strong>
                  <span>{passkey.rpId} · added {formatDate(passkey.createdAt)}</span>
                  <span>{passkey.lastUsedAt ? `Last used ${formatDate(passkey.lastUsedAt)}` : "Not used to unlock yet"}{passkey.backedUp ? " · synced passkey" : ""}</span>
                </div>
                <button
                  type="button"
                  className={confirmRemoveId === passkey.id ? styles.confirmRemoveButton : styles.removeButton}
                  onClick={() => void removePasskey(passkey.id)}
                  disabled={Boolean(busy)}
                >
                  {busy === passkey.id ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Trash2 aria-hidden="true" />}
                  {confirmRemoveId === passkey.id ? "Confirm remove" : "Remove"}
                </button>
              </article>
            ))}
            {!loading && !passkeys.length ? (
              <div className={styles.emptyState}>
                <Fingerprint aria-hidden="true" />
                <strong>{nativeRuntime ? "No browser passkeys registered" : "No device passkeys yet"}</strong>
                <span>
                  {nativeBiometricName
                    ? `${nativeBiometricName} is already enabled for this Mac, so it does not appear in this optional browser-passkey list. The dashboard token remains the recovery fallback.`
                    : nativeRuntime
                      ? "Browser passkeys are optional in the desktop app. The dashboard token remains the recovery fallback."
                      : "Add one above; the existing dashboard token remains the recovery fallback."}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <Tooltip onOpenChange={onTooltipOpenChange}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="fr-nav"
            onClick={() => {
              setMessage("");
              setConfirmRemoveId("");
              setPlatformAvailable(false);
              setPlatformChecked(false);
              setNativeBiometricName("");
              setOpen(true);
              void loadPasskeys();
            }}
            aria-label="Dashboard security"
          >
            <span className="fr-nav-ico"><ShieldCheck aria-hidden="true" /></span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="z-[80]">Manage security and passkeys</TooltipContent>
      </Tooltip>
      {dialog}
    </>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "unknown date";
}

function nativeBiometricLabel(kind?: string) {
  if (kind === "touch-id") return "Touch ID";
  if (kind === "face-id") return "Face ID";
  if (kind === "optic-id") return "Optic ID";
  return "Device biometrics";
}
