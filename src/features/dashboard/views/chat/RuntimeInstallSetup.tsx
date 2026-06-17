"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, KeyRound, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentProfile, AgentRuntime } from "@/lib/types/agent-runtime";
import { runtimeInstallSpec, type RuntimeAuthOption } from "@/lib/services/runtime-install-catalog";

type RuntimeActionResult = { ok?: boolean; error?: string; message?: string; output?: string };

type RuntimeInstallSetupProps = {
  agent?: AgentProfile | null;
  busy?: string;
  fleetClass: (...classes: string[]) => string;
  runtime: AgentRuntime;
  // Current detection state for this runtime on the target machine.
  installed: boolean;
  // OS of the machine the install runs on, when known.
  targetOs?: "windows" | "darwin" | "linux";
  // Where the install runs, for copy ("this Mac", the machine name, etc.).
  targetLabel?: string;
  runRuntimeIntegrationAction: (action: string, input?: Record<string, unknown>, agentOverride?: AgentProfile) => Promise<RuntimeActionResult>;
  // Re-probe runtime availability so the card flips to "Configured".
  refreshAvailability?: () => void;
  onCancel: () => void;
  onComplete: () => void | Promise<void>;
};

const panelStyle: React.CSSProperties = {
  display: "grid",
  gap: 14,
  border: "1px solid var(--line)",
  borderRadius: 12,
  background: "var(--panel-bg-soft)",
  padding: 16,
};

const stepStyle: React.CSSProperties = {
  display: "grid",
  gap: 9,
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: 13,
  background: "var(--bg)",
};

const codeRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel-bg-soft)",
  padding: "7px 10px",
  fontFamily: "var(--f-mono, monospace)",
  fontSize: 12,
  overflowWrap: "anywhere",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--fg)",
  padding: "8px 10px",
  fontSize: 13,
};

export function RuntimeInstallSetup({
  agent,
  busy,
  fleetClass,
  runtime,
  installed,
  targetOs,
  targetLabel,
  runRuntimeIntegrationAction,
  refreshAvailability,
  onCancel,
  onComplete,
}: RuntimeInstallSetupProps) {
  const spec = useMemo(() => runtimeInstallSpec(runtime), [runtime]);

  const [installing, setInstalling] = useState(false);
  const [installOutput, setInstallOutput] = useState("");
  const [installError, setInstallError] = useState("");
  // Detection is authoritative; locally-observed success bridges the gap until
  // the availability re-probe lands.
  const [locallyInstalled, setLocallyInstalled] = useState(false);
  const isInstalled = installed || locallyInstalled;

  const [selectedAuthEnv, setSelectedAuthEnv] = useState(spec?.auth[0]?.env ?? "");
  const [authValue, setAuthValue] = useState("");
  const [savingAuth, setSavingAuth] = useState(false);
  const [authSaved, setAuthSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState("");

  // State resets per runtime via the `key={activeRuntime}` on this component in
  // AgentSettingsModal (a fresh mount), so no reset effect is needed here.

  if (!spec) {
    // No catalog entry — should not happen for cards we made clickable, but
    // degrade gracefully rather than render a blank panel.
    return (
      <section style={panelStyle} aria-label="Runtime setup">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ color: "var(--fg)", fontSize: 14 }}>Set up {runtime}</strong>
          <Button type="button" variant="ghost" size="icon" aria-label="Cancel" onClick={onCancel}><X aria-hidden="true" /></Button>
        </div>
        <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 12.5 }}>
          This runtime is configured outside HivemindOS. Install it on the machine, then re-check.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="button" onClick={() => void onComplete()}>Done</Button>
        </div>
      </section>
    );
  }

  const platformUnsupported = Boolean(targetOs && spec.unsupportedPlatforms?.includes(targetOs));
  const canInstallInApp = spec.inAppInstall && !platformUnsupported;
  const installCommand = targetOs === "windows" ? spec.installPreview.windows : spec.installPreview.unix;
  const where = targetLabel ? ` on ${targetLabel}` : "";

  async function copy(text: string, tag: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard may be unavailable; the command is still visible to copy by hand */
    }
  }

  async function runInstall() {
    setInstalling(true);
    setInstallError("");
    setInstallOutput("");
    setMessage("");
    const result: RuntimeActionResult = await runRuntimeIntegrationAction("install-runtime", {}, agent ?? undefined).catch((error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Install failed.",
    }));
    setInstalling(false);
    if (!result?.ok) {
      setInstallError(result?.error ?? "Install failed.");
      return;
    }
    setInstallOutput(result.output ?? result.message ?? `${spec!.label} installed.`);
    setLocallyInstalled(true);
    refreshAvailability?.();
  }

  async function saveAuth() {
    const option = spec!.auth.find((entry) => entry.env === selectedAuthEnv) ?? spec!.auth[0];
    if (!option) return;
    const value = authValue.trim();
    if (!value) {
      setMessage(`Enter your ${option.label}.`);
      return;
    }
    setSavingAuth(true);
    setMessage("");
    const result = await runRuntimeIntegrationAction("runtime-auth", { env: option.env, value }, agent ?? undefined).catch((error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the key.",
    }));
    setSavingAuth(false);
    if (!result?.ok) {
      setMessage(result?.error ?? "Could not save the key.");
      return;
    }
    setAuthSaved(true);
    setAuthValue("");
    setMessage(`Saved ${option.label} to your shared hive env.`);
  }

  const activeAuth: RuntimeAuthOption | undefined = spec.auth.find((entry) => entry.env === selectedAuthEnv) ?? spec.auth[0];
  const isBusy = installing || savingAuth || busy === "install-runtime" || busy === "runtime-auth";

  return (
    <section style={panelStyle} aria-label={`Set up ${spec.label}`} className={fleetClass("agentRuntimeInstallSetup")}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ display: "inline-flex", color: "var(--cyan-2)" }} aria-hidden="true"><Download /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong style={{ color: "var(--fg)", fontSize: 14.5 }}>Set up {spec.label}</strong>
          <p style={{ margin: "3px 0 0", color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.5 }}>{spec.blurb}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Cancel setup" onClick={onCancel}><X aria-hidden="true" /></Button>
      </div>

      {/* Step 1 — Install */}
      <div style={stepStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isInstalled
            ? <ShieldCheck size={15} aria-hidden="true" style={{ color: "var(--green-2, #34d399)" }} />
            : <Download size={15} aria-hidden="true" style={{ color: "var(--fg-3)" }} />}
          <strong style={{ color: "var(--fg)", fontSize: 13 }}>{isInstalled ? `${spec.label} is installed` : `Install ${spec.label}${where}`}</strong>
        </div>

        {!isInstalled ? (
          <>
            <div style={codeRowStyle}>
              <span style={{ flex: 1 }}>{installCommand}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => void copy(installCommand, "install")} aria-label="Copy install command">
                {copied === "install" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              </Button>
            </div>
            {canInstallInApp ? (
              <Button type="button" onClick={() => void runInstall()} disabled={isBusy}>
                {installing ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
                {installing ? `Installing ${spec.label}…` : `Install ${spec.label}`}
              </Button>
            ) : (
              <div style={{ display: "grid", gap: 7 }}>
                <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.5 }}>
                  {platformUnsupported
                    ? `${spec.label} can't be installed automatically on this machine yet. Run the command above, then re-check.`
                    : `Run the command above on the machine, then re-check.`}
                </p>
                <Button type="button" variant="secondary" onClick={() => { refreshAvailability?.(); }} disabled={isBusy}>
                  <Check aria-hidden="true" /> I&apos;ve installed it — re-check
                </Button>
              </div>
            )}
            {installError ? <p style={{ margin: 0, color: "var(--rose-2, #fb7185)", fontSize: 12 }}>{installError}</p> : null}
          </>
        ) : (
          installOutput ? <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 11.5, whiteSpace: "pre-wrap", maxHeight: 96, overflow: "auto" }}>{installOutput.slice(0, 600)}</p> : null
        )}
        {spec.verifyCommand ? <p style={{ margin: 0, color: "var(--fg-5, var(--fg-4))", fontSize: 11 }}>Verifies with <code>{spec.verifyCommand}</code></p> : null}
      </div>

      {/* Step 2 — Authenticate */}
      {spec.auth.length ? (
        <div style={stepStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {authSaved
              ? <ShieldCheck size={15} aria-hidden="true" style={{ color: "var(--green-2, #34d399)" }} />
              : <KeyRound size={15} aria-hidden="true" style={{ color: "var(--fg-3)" }} />}
            <strong style={{ color: "var(--fg)", fontSize: 13 }}>Add a credential</strong>
          </div>

          {spec.auth.length > 1 ? (
            <select value={selectedAuthEnv} onChange={(event) => { setSelectedAuthEnv(event.target.value); setAuthSaved(false); }} style={inputStyle} disabled={isBusy}>
              {spec.auth.map((option) => <option key={option.env} value={option.env}>{option.label}</option>)}
            </select>
          ) : null}

          {activeAuth ? (
            <>
              <input
                type="password"
                value={authValue}
                onChange={(event) => setAuthValue(event.target.value)}
                placeholder={activeAuth.placeholder || `Paste your ${activeAuth.label}`}
                style={inputStyle}
                autoComplete="off"
                spellCheck={false}
                disabled={isBusy}
              />
              {activeAuth.help ? <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.5 }}>{activeAuth.help}</p> : null}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Button type="button" variant="secondary" onClick={() => void saveAuth()} disabled={isBusy || !authValue.trim()}>
                  {savingAuth ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <KeyRound aria-hidden="true" />}
                  Save key
                </Button>
                {authSaved ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--green-2, #34d399)", fontSize: 12 }}><Check size={13} aria-hidden="true" /> Saved</span> : null}
              </div>
            </>
          ) : null}

          {spec.oauth ? (
            <div style={{ display: "grid", gap: 6, marginTop: 2, paddingTop: 9, borderTop: "1px dashed var(--line)" }}>
              <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.5 }}>{spec.oauth.note}</p>
              <div style={codeRowStyle}>
                <span style={{ flex: 1 }}>{spec.oauth.command}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void copy(spec.oauth!.command, "oauth")} aria-label="Copy sign-in command">
                  {copied === "oauth" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div style={stepStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={15} aria-hidden="true" style={{ color: "var(--green-2, #34d399)" }} />
            <strong style={{ color: "var(--fg)", fontSize: 13 }}>No API key needed</strong>
          </div>
          {spec.notes ? <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.5 }}>{spec.notes}</p> : null}
        </div>
      )}

      {spec.notes && spec.auth.length ? <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.5 }}>{spec.notes}</p> : null}
      {message ? <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 12 }}>{message}</p> : null}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isBusy}>Cancel</Button>
        <Button type="button" onClick={() => void onComplete()} disabled={isBusy || !isInstalled}>
          {isInstalled ? <><Check aria-hidden="true" /> Done</> : "Install to continue"}
        </Button>
      </div>
    </section>
  );
}
