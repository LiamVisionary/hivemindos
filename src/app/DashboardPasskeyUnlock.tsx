"use client";

import { Fingerprint, KeyRound, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

type DashboardPasskeyUnlockProps = {
  authSecretPresent: boolean;
  deviceTokenPresent: boolean;
  nativeMode?: boolean;
  returnTo: string;
};

type PasskeyStatus = {
  ok?: boolean;
  available?: boolean;
  secureContext?: boolean;
  error?: string;
};

type NativeBiometricStatus = {
  available?: boolean;
  kind?: "touch-id" | "face-id" | "optic-id" | "biometric";
};

const nativeBootstrapHashKey = "hivemindos_native_bootstrap";

export default function DashboardPasskeyUnlock({
  authSecretPresent,
  deviceTokenPresent,
  nativeMode = false,
  returnTo,
}: DashboardPasskeyUnlockProps) {
  const [mode, setMode] = useState<"checking" | "ready" | "unlocking" | "native" | "unavailable" | "error">("checking");
  const [message, setMessage] = useState("");
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [nativeBiometryKind, setNativeBiometryKind] = useState<NativeBiometricStatus["kind"]>();
  const [nativeRuntime, setNativeRuntime] = useState(nativeMode);
  const nativeFallbackStarted = useRef(false);
  const nativeHashToken = useRef("");

  const unlockWithNativeToken = useCallback(async (automatic = false) => {
    if (automatic && nativeFallbackStarted.current) return;
    nativeFallbackStarted.current = true;
    setMode("native");
    setMessage(automatic ? "Opening with the saved desktop token…" : "Unlocking with the saved desktop token…");
    try {
      let token: string | null = nativeHashToken.current;
      nativeHashToken.current = "";
      if (!token) {
        const { invoke } = await import("@tauri-apps/api/core");
        token = await invoke<string | null>("native_dashboard_unlock_token");
      }
      if (!token) throw new Error("The saved desktop token is unavailable.");
      await openDashboardSession(token, returnTo);
    } catch {
      nativeFallbackStarted.current = false;
      setMode("error");
      setMessage("The saved desktop token could not unlock the dashboard. Enter the device token manually below or reopen HivemindOS.");
    }
  }, [returnTo]);

  useEffect(() => {
    nativeHashToken.current = readNativeBootstrapTokenFromHash();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkAvailability() {
      const nativeWindow = window as Window & { __TAURI_INTERNALS__?: unknown };
      const nativeRuntimeDetected = nativeMode || Boolean(nativeWindow.__TAURI_INTERNALS__);
      setNativeRuntime(nativeRuntimeDetected);
      if (nativeRuntimeDetected) {
        const nativeStatus = await readNativeBiometricStatus();
        if (cancelled) return;
        if (nativeStatus?.available) {
          setNativeBiometryKind(nativeStatus.kind || "biometric");
          setPasskeyAvailable(true);
          setMode("ready");
          return;
        }
      }
      const response = await fetch("/api/auth/passkeys/status", { cache: "no-store" }).catch(() => null);
      const status = response ? await response.json().catch(() => null) as PasskeyStatus | null : null;
      const browserCapable = Boolean(
        status?.available
        && status.secureContext
        && window.isSecureContext
        && window.PublicKeyCredential,
      );
      let platformAvailable = false;
      if (browserCapable) {
        const { platformAuthenticatorIsAvailable } = await import("@simplewebauthn/browser");
        platformAvailable = await platformAuthenticatorIsAvailable().catch(() => false);
      }
      if (cancelled) return;
      if (browserCapable && platformAvailable) {
        setPasskeyAvailable(true);
        setMode("ready");
        return;
      }
      if (nativeRuntimeDetected && authSecretPresent && deviceTokenPresent) {
        void unlockWithNativeToken(true);
        return;
      }
      setMode("unavailable");
    }
    void checkAvailability();
    return () => {
      cancelled = true;
    };
  }, [authSecretPresent, deviceTokenPresent, nativeMode, unlockWithNativeToken]);

  async function unlockWithDeviceAuthentication() {
    setMode("unlocking");
    setMessage("");
    try {
      if (nativeBiometryKind) {
        const { invoke } = await import("@tauri-apps/api/core");
        const token = await invoke<string | null>("native_dashboard_biometric_unlock");
        if (!token) throw new Error("The saved desktop token is unavailable. Enter the device token manually below.");
        await openDashboardSession(token, returnTo);
        return;
      }
      const optionsResponse = await fetch("/api/auth/passkeys/authentication/options", {
        method: "POST",
        headers: { accept: "application/json" },
      });
      const optionsBody = await optionsResponse.json().catch(() => null) as {
        options?: PublicKeyCredentialRequestOptionsJSON;
        error?: string;
      } | null;
      if (!optionsResponse.ok || !optionsBody?.options) {
        throw new Error(optionsBody?.error || "Could not start device authentication.");
      }
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const authentication = await startAuthentication({ optionsJSON: optionsBody.options });
      const verifyResponse = await fetch("/api/auth/passkeys/authentication/verify", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ response: authentication }),
      });
      const verifyBody = await verifyResponse.json().catch(() => null) as { error?: string } | null;
      if (!verifyResponse.ok) throw new Error(verifyBody?.error || "Device authentication was not accepted.");
      window.location.replace(returnTo);
    } catch (error) {
      setMode("error");
      setMessage(error instanceof Error && error.name !== "NotAllowedError"
        ? error.message
        : "Device authentication was cancelled or timed out. Try again or use the device token.");
    }
  }

  if (mode === "checking" || mode === "unavailable") return null;

  return (
    <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
      {passkeyAvailable && (mode === "ready" || mode === "unlocking" || mode === "error") ? (
        <button
          type="button"
          onClick={() => void unlockWithDeviceAuthentication()}
          disabled={mode === "unlocking"}
          style={{
            display: "inline-flex",
            minHeight: 46,
            alignItems: "center",
            justifyContent: "center",
            gap: 9,
            border: "1px solid color-mix(in srgb, var(--accent-strong, #936811) 48%, transparent)",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--accent-strong, #936811) 13%, var(--surface, #fbf8f1))",
            color: "var(--foreground, #221d14)",
            cursor: mode === "unlocking" ? "wait" : "pointer",
            fontSize: 15,
            fontWeight: 600,
            padding: "12px 14px",
          }}
        >
          {mode === "unlocking" ? <LoaderCircle aria-hidden="true" size={19} style={{ animation: "spin 1s linear infinite" }} /> : <Fingerprint aria-hidden="true" size={20} />}
          {mode === "unlocking" ? "Waiting for your device…" : biometricUnlockLabel(nativeBiometryKind)}
        </button>
      ) : null}
      {mode === "native" ? (
        <p role="status" style={{ margin: 0, color: "var(--muted, #867d6e)", fontSize: 13, textAlign: "center" }}>
          {message}
        </p>
      ) : null}
      {message && mode === "error" ? (
        <p role="alert" style={{ margin: 0, color: "#8e3328", fontSize: 13, lineHeight: 1.5, textAlign: "center" }}>
          {message}
        </p>
      ) : null}
      {nativeRuntime && mode !== "native" ? (
        <button
          type="button"
          onClick={() => void unlockWithNativeToken(false)}
          style={{
            justifySelf: "center",
            border: 0,
            background: "transparent",
            color: "var(--text-soft, #5e574b)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 500,
            padding: 2,
          }}
        >
          <KeyRound aria-hidden="true" size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
          Unlock with saved desktop token
        </button>
      ) : null}
      {mode !== "native" ? (
        <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--muted, #867d6e)", fontSize: 11, textTransform: "uppercase" }}>
          <span style={{ height: 1, flex: 1, background: "var(--line, rgba(54, 46, 30, 0.16))" }} />
          or enter device token manually
          <span style={{ height: 1, flex: 1, background: "var(--line, rgba(54, 46, 30, 0.16))" }} />
        </div>
      ) : null}
    </div>
  );
}

function biometricUnlockLabel(nativeKind?: NativeBiometricStatus["kind"]) {
  if (nativeKind === "touch-id") return "Unlock with Touch ID";
  if (nativeKind === "face-id") return "Unlock with Face ID";
  if (nativeKind === "optic-id") return "Unlock with Optic ID";
  if (nativeKind === "biometric") return "Unlock with device biometrics";
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  if (platform.includes("mac") || /iphone|ipad/.test(userAgent)) return "Unlock with Face ID or Touch ID";
  if (platform.includes("win") || userAgent.includes("windows")) return "Unlock with Windows Hello";
  return "Unlock with device biometrics";
}

async function readNativeBiometricStatus() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeBiometricStatus>("native_dashboard_biometric_status");
  } catch {
    return null;
  }
}

async function openDashboardSession(token: string, returnTo: string) {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ token, returnTo }),
  });
  if (!response.ok) throw new Error("The saved desktop token was not accepted.");
  window.location.replace(returnTo);
}

function readNativeBootstrapTokenFromHash() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) return "";
  const params = new URLSearchParams(hash);
  const token = params.get(nativeBootstrapHashKey)?.trim() ?? "";
  if (!token) return "";
  params.delete(nativeBootstrapHashKey);
  const nextHash = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
  return token;
}
