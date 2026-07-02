"use client";

import { Check, Copy, KeyRound, RotateCcw, ShieldAlert, Terminal } from "lucide-react";
import { useEffect, useState } from "react";

type DashboardUnlockRecoveryProps = {
  authSecretPresent: boolean;
  deviceTokenPresent: boolean;
  nativeMode?: boolean;
};

const copyTokenCommand = "dashboard-auth copy-token";
const resetTokenCommand = "dashboard-auth reset-token";
const rotateSecretCommand = "dashboard-auth rotate-secret";
const nativeBootstrapHashKey = "hivemindos_native_bootstrap";

export default function DashboardUnlockRecovery({ authSecretPresent, deviceTokenPresent, nativeMode = false }: DashboardUnlockRecoveryProps) {
  const [open, setOpen] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState("");
  const [failedCommand, setFailedCommand] = useState("");
  const [nativeUnlockState, setNativeUnlockState] = useState<"idle" | "signing-in" | "failed">("idle");
  const [tauriRuntime, setTauriRuntime] = useState(false);
  const [terminalState, setTerminalState] = useState<"idle" | "opening" | "opened" | "failed">("idle");
  const tokenCommand = deviceTokenPresent ? copyTokenCommand : resetTokenCommand;
  const tokenCommandLabel = deviceTokenPresent ? "Copy token command" : "Copy reset command";

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nativeWindow = window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
      setTauriRuntime(Boolean(nativeWindow.__TAURI__ || nativeWindow.__TAURI_INTERNALS__));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!nativeMode || !authSecretPresent || !deviceTokenPresent) return;
    let cancelled = false;
    async function unlockNativeDashboard() {
      setNativeUnlockState("signing-in");
      try {
        const hashToken = readNativeBootstrapTokenFromHash();
        let token: string | null = hashToken;
        if (!token) {
          const { invoke } = await import("@tauri-apps/api/core");
          token = await invoke<string | null>("native_dashboard_unlock_token");
        }
        if (cancelled || !token) {
          setNativeUnlockState("idle");
          return;
        }
        const response = await fetch("/api/auth/session", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ token, returnTo: currentReturnTo() }),
        });
        if (!response.ok) throw new Error("Native dashboard token was not accepted.");
        window.location.replace(currentReturnTo());
      } catch {
        if (!cancelled) setNativeUnlockState("failed");
      }
    }
    void unlockNativeDashboard();
    return () => {
      cancelled = true;
    };
  }, [authSecretPresent, deviceTokenPresent, nativeMode]);

  async function copyCommand(command: string) {
    const copied = await writeClipboardText(command);
    setFailedCommand(copied ? "" : command);
    if (!copied) return;
    setCopiedCommand(command);
    window.setTimeout(() => {
      setCopiedCommand((current) => current === command ? "" : current);
    }, 1800);
  }

  async function openProjectTerminal() {
    setTerminalState("opening");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_project_terminal");
      setTerminalState("opened");
      window.setTimeout(() => {
        setTerminalState((current) => current === "opened" ? "idle" : current);
      }, 1800);
    } catch {
      setTerminalState("failed");
    }
  }

  return (
    <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={{
          justifySelf: "center",
          border: 0,
          background: "transparent",
          color: "var(--accent-strong, #936811)",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 800,
          padding: "4px 6px",
        }}
      >
        {open ? "Back to token input" : "Need the token?"}
      </button>
      {nativeUnlockState === "signing-in" ? (
        <p style={{ margin: 0, color: "var(--muted, #867d6e)", fontSize: 12, fontWeight: 700, textAlign: "center" }}>
          Opening signed desktop session...
        </p>
      ) : null}
      {open ? (
        <section
          aria-label="Dashboard token recovery"
          style={{
            display: "grid",
            gap: 14,
            border: "1px solid var(--line, rgba(54, 46, 30, 0.16))",
            borderRadius: 8,
            background: "var(--surface-strong, rgba(244, 239, 228, 0.94))",
            padding: 14,
            boxShadow: "0 18px 42px rgba(82, 61, 22, 0.12)",
          }}
        >
          <div style={{ display: "grid", gap: 9 }}>
            <StatusLine ok={authSecretPresent} label="Auth secret" missingLabel="Missing" />
            <StatusLine ok={deviceTokenPresent} label="Device token" missingLabel="Missing" />
          </div>
          <p style={{ margin: 0, color: "var(--text-soft, #5e574b)", fontSize: 13, lineHeight: 1.55 }}>
            {nativeMode
              ? "The desktop app creates local auth automatically. If this screen stays locked, quit and reopen HivemindOS."
              : "Run these from any terminal after setup. If the command is not on PATH yet, run it from the HivemindOS project folder with pnpm. The token value is never exposed through this locked page."}
          </p>
          {!nativeMode ? (
            <div style={{ display: "grid", gap: 10 }}>
              <CommandButton
                command={tokenCommand}
                copied={copiedCommand === tokenCommand}
                failed={failedCommand === tokenCommand}
                icon={deviceTokenPresent ? <Copy size={15} /> : <RotateCcw size={15} />}
                label={tokenCommandLabel}
                onCopy={copyCommand}
              />
              {!authSecretPresent ? (
                <CommandButton
                  command={rotateSecretCommand}
                  copied={copiedCommand === rotateSecretCommand}
                  failed={failedCommand === rotateSecretCommand}
                  icon={<ShieldAlert size={15} />}
                  label="Copy secret command"
                  onCopy={copyCommand}
                />
              ) : null}
              {tauriRuntime ? (
                <ActionButton
                  icon={<Terminal size={15} />}
                  label={terminalState === "opened" ? "Opened Terminal" : terminalState === "opening" ? "Opening..." : terminalState === "failed" ? "Terminal unavailable" : "Open Terminal here"}
                  onClick={openProjectTerminal}
                  title="Open Terminal in the HivemindOS project folder"
                />
              ) : null}
            </div>
          ) : null}
          {!deviceTokenPresent || !authSecretPresent ? (
            <p style={{ margin: 0, color: "var(--muted, #867d6e)", fontSize: 12, lineHeight: 1.5 }}>
              {nativeMode
                ? "Desktop auth is missing. Reopening the app should create a fresh local auth file."
                : "Restart the dashboard after changing auth values so the server loads the new env."}
            </p>
          ) : (
            <p style={{ margin: 0, color: "var(--muted, #867d6e)", fontSize: 12, lineHeight: 1.5 }}>
              {nativeMode
                ? (nativeUnlockState === "failed" ? "Automatic desktop sign-in failed. Quit and reopen HivemindOS to retry." : "Desktop auth is ready and should open automatically.")
                : <>Manual fallback: open <code style={codeStyle}>.env.local</code> and copy <code style={codeStyle}>HIVEMINDOS_DASHBOARD_DEVICE_TOKEN</code>.</>}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
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

function currentReturnTo() {
  const search = new URLSearchParams(window.location.search);
  search.delete("auth");
  const query = search.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}`;
}

async function writeClipboardText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back for local HTTP contexts where the modern clipboard API can be restricted.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function StatusLine({ ok, label, missingLabel }: { ok: boolean; label: string; missingLabel: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, color: "var(--foreground, #221d14)", fontSize: 13 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {ok ? <Check size={15} color="#356b2f" /> : <KeyRound size={15} color="#8e3328" />}
        {label}
      </span>
      <strong style={{ color: ok ? "#356b2f" : "#8e3328", fontSize: 12 }}>{ok ? "Present" : missingLabel}</strong>
    </div>
  );
}

function CommandButton({ command, copied, failed, icon, label, onCopy }: {
  command: string;
  copied: boolean;
  failed: boolean;
  icon: React.ReactNode;
  label: string;
  onCopy: (command: string) => Promise<void>;
}) {
  const statusColor = copied ? "#356b2f" : failed ? "#8e3328" : "var(--text-soft, #5e574b)";
  const statusText = copied ? "Copied" : failed ? "Failed" : "Copy";
  return (
    <button
      type="button"
      onClick={() => void onCopy(command)}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: 10,
        width: "100%",
        border: "1px solid var(--line, rgba(54, 46, 30, 0.16))",
        borderRadius: 8,
        background: "var(--field, rgba(255, 252, 246, 0.92))",
        color: "var(--foreground, #221d14)",
        cursor: "pointer",
        padding: "10px 11px",
        textAlign: "left",
      }}
      title={label}
    >
      {icon}
      <code style={{ ...codeStyle, overflowWrap: "anywhere" }}>{command}</code>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: statusColor, fontSize: 12, fontWeight: 800 }}>
        {copied ? <Check size={14} /> : <Terminal size={14} />}
        {statusText}
      </span>
    </button>
  );
}

function ActionButton({ icon, label, title, onClick }: {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        width: "100%",
        border: "1px solid var(--line, rgba(54, 46, 30, 0.16))",
        borderRadius: 8,
        background: "var(--field, rgba(255, 252, 246, 0.92))",
        color: "var(--foreground, #221d14)",
        cursor: "pointer",
        padding: "10px 11px",
        fontSize: 12,
        fontWeight: 800,
      }}
      title={title}
    >
      {icon}
      {label}
    </button>
  );
}

const codeStyle = {
  border: "1px solid var(--line, rgba(54, 46, 30, 0.16))",
  borderRadius: 6,
  background: "var(--field, rgba(255, 252, 246, 0.92))",
  color: "var(--foreground, #221d14)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  padding: "2px 5px",
};
