"use client";

import { Check, Copy, KeyRound, RotateCcw, ShieldAlert, Terminal } from "lucide-react";
import { useState } from "react";

type DashboardUnlockRecoveryProps = {
  authSecretPresent: boolean;
  deviceTokenPresent: boolean;
};

const copyTokenCommand = "pnpm dashboard-auth copy-token";
const resetTokenCommand = "pnpm dashboard-auth reset-token";
const rotateSecretCommand = "pnpm dashboard-auth rotate-secret";

export default function DashboardUnlockRecovery({ authSecretPresent, deviceTokenPresent }: DashboardUnlockRecoveryProps) {
  const [open, setOpen] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState("");
  const [failedCommand, setFailedCommand] = useState("");
  const tokenCommand = deviceTokenPresent ? copyTokenCommand : resetTokenCommand;
  const tokenCommandLabel = deviceTokenPresent ? "Copy token command" : "Copy reset command";

  async function copyCommand(command: string) {
    const copied = await writeClipboardText(command);
    setFailedCommand(copied ? "" : command);
    if (!copied) return;
    setCopiedCommand(command);
    window.setTimeout(() => {
      setCopiedCommand((current) => current === command ? "" : current);
    }, 1800);
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
          color: "#94a3b8",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 700,
          padding: "4px 6px",
        }}
      >
        {open ? "Back to token input" : "Need the token?"}
      </button>
      {open ? (
        <section
          aria-label="Dashboard token recovery"
          style={{
            display: "grid",
            gap: 14,
            border: "1px solid #263247",
            borderRadius: 8,
            background: "#0c1220",
            padding: 14,
            boxShadow: "0 18px 50px rgba(0, 0, 0, 0.22)",
          }}
        >
          <div style={{ display: "grid", gap: 9 }}>
            <StatusLine ok={authSecretPresent} label="Auth secret" missingLabel="Missing" />
            <StatusLine ok={deviceTokenPresent} label="Device token" missingLabel="Missing" />
          </div>
          <p style={{ margin: 0, color: "#cbd5e1", fontSize: 13, lineHeight: 1.55 }}>
            Run these from the HivemindOS project folder. The token value is never exposed through this locked page.
          </p>
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
          </div>
          {!deviceTokenPresent || !authSecretPresent ? (
            <p style={{ margin: 0, color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
              Restart the dashboard after changing auth values so the server loads the new env.
            </p>
          ) : (
            <p style={{ margin: 0, color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
              Manual fallback: open <code style={codeStyle}>.env.local</code> and copy <code style={codeStyle}>HIVEMINDOS_DASHBOARD_DEVICE_TOKEN</code>.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, color: "#e2e8f0", fontSize: 13 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {ok ? <Check size={15} color="#86efac" /> : <KeyRound size={15} color="#fca5a5" />}
        {label}
      </span>
      <strong style={{ color: ok ? "#86efac" : "#fca5a5", fontSize: 12 }}>{ok ? "Present" : missingLabel}</strong>
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
  const statusColor = copied ? "#86efac" : failed ? "#fca5a5" : "#cbd5e1";
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
        border: "1px solid #334155",
        borderRadius: 8,
        background: "#111827",
        color: "#f8fafc",
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

const codeStyle = {
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 6,
  background: "rgba(15, 23, 42, 0.72)",
  color: "#e2e8f0",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  padding: "2px 5px",
};
