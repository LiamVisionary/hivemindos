"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Check, ChevronLeft, Copy, LoaderCircle, Lock, Network, RefreshCcw, ShieldCheck, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";
import { NATIVE_SETUP_DEMO_ENABLED, NATIVE_SETUP_RERUN_EVENT, readNativeSetupStatus, runNativeSetup, type NativeDetectedAgentRuntime, type NativeSetupStatus } from "@/lib/native/setup";
import { requestGuidedTour } from "@/lib/native/guided-tour";
import { runtimeIconFallback, runtimeIconPath, runtimeIconRenderMode } from "@/lib/config/runtime-icons";
import { grantNativePrivateFilesystemAccess } from "@/lib/native/dashboard-bootstrap";
import { dashboardStateValue, loadDashboardStateSnapshot, removeDashboardStateValue, saveDashboardStateValue } from "@/lib/services/dashboard-state-client";

const DISMISS_KEY = "hivemindos.nativeFirstRun.dismissed.v3";
const LEGACY_DISMISS_KEY = "hivemindos.nativeFirstRun.dismissed.v2";
const DISMISS_FALLBACK_KEY = `${DISMISS_KEY}.localFallback`;

type InstallMode = "local" | "link" | "system-tailscale";
type WizardStep = "mode" | "agents" | "run" | "pairing";

const ALL_AGENT_IDS = ["codex", "claude", "hermes", "gemini", "openclaw", "aeon"];
const DEMO_RUN_MESSAGES = [
  "Starting setup. If your system needs permission, a Terminal window will open for that part.",
  "Checking selected agents.",
  "Setup has started. Follow any permission prompts that appear.",
];

// "this Mac" / "this PC" / "this computer", from the platform reported by native_setup_status.
function deviceNoun(platform: string | undefined) {
  if (platform === "windows") return "PC";
  if (platform === "macos" || platform === "demo") return "Mac";
  return "computer";
}

function installModes(device: string): Array<{
  id: InstallMode;
  title: string;
  detail: string;
  badge: string | null;
  command: string;
}> {
  return [
    {
      id: "local",
      title: `Just this ${device}`,
      detail: "Everything stays on this computer. You can add your other devices later.",
      badge: null,
      command: "./setup.sh --local-only",
    },
    {
      id: "link",
      title: `This ${device} + my other devices`,
      detail: "Your computers stay in sync automatically. HivemindOS handles the connection — nothing extra to install.",
      badge: "Recommended",
      command: "./setup.sh --link",
    },
    {
      id: "system-tailscale",
      title: "Full Tailnet Hive",
      detail: "Always-on folder sync between machines, on top of everything above.",
      badge: "Advanced",
      command: "./setup.sh --system-tailscale",
    },
  ];
}

function stepHeaders(device: string, isMac: boolean, isWindows: boolean): Record<WizardStep, { title: string; subtitle: string }> {
  return {
    mode: { title: "Welcome to HivemindOS", subtitle: "One quick question: which computers should be in your hive?" },
    agents: { title: "Connect your AI helpers", subtitle: `We found these on your ${device}. They'll share what they know through the hive.` },
    // On Windows, "run" is the first screen: setup.ps1 makes the mode and import choices itself.
    run: isWindows
      ? { title: "Welcome to HivemindOS", subtitle: "One click and your hive sets itself up." }
      : { title: "You're all set", subtitle: "HivemindOS takes care of everything from here." },
    pairing: isMac
      ? { title: "You're all set", subtitle: "Your phone reaches this Mac automatically — even when the app is closed." }
      : { title: "All set", subtitle: "Setup is running in the background." },
  };
}

function agentIconId(agentId: string) {
  if (agentId === "codex" || agentId === "claude" || agentId === "gemini") return "hivemind-os";
  return agentId;
}

function AgentIcon({ agent, compact = false }: { agent: NativeDetectedAgentRuntime; compact?: boolean }) {
  const iconId = agentIconId(agent.id);
  const icon = runtimeIconPath(iconId);
  const mode = runtimeIconRenderMode(iconId);
  const iconSize = compact ? "h-5 w-5" : "h-7 w-7";
  const fallbackSize = compact ? "h-5 w-5 text-[0.6rem]" : "h-7 w-7 text-[0.68rem]";
  if (icon && mode === "mask") {
    return <span aria-hidden="true" className={`${iconSize} bg-current`} style={{ WebkitMask: `url(${icon}) center / contain no-repeat`, mask: `url(${icon}) center / contain no-repeat` }} />;
  }
  if (icon) return <Image src={icon} alt="" width={compact ? 20 : 28} height={compact ? 20 : 28} className={`${iconSize} object-contain`} unoptimized />;
  return <span className={`grid ${fallbackSize} place-items-center rounded-full bg-[rgba(148,163,184,0.15)] font-semibold`}>{runtimeIconFallback(iconId, agent.label)}</span>;
}

function StepDots({ step, steps }: { step: WizardStep; steps: WizardStep[] }) {
  const activeIndex = steps.indexOf(step);
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {steps.map((item, index) => (
        <span key={item} className={`h-1.5 rounded-full transition-all ${index <= activeIndex ? "w-7 bg-[var(--accent-strong)]" : "w-2 bg-[rgba(148,163,184,0.28)]"}`} />
      ))}
    </div>
  );
}

function readLocalDismissal() {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1" || window.localStorage.getItem(DISMISS_FALLBACK_KEY) === "1";
  } catch {
    return false;
  }
}

function writeLocalDismissal() {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
    window.localStorage.setItem(DISMISS_FALLBACK_KEY, "1");
  } catch {
    // Dashboard state remains the primary persistence layer when browser storage is unavailable.
  }
}

function clearLocalDismissal() {
  try {
    window.localStorage.removeItem(DISMISS_KEY);
    window.localStorage.removeItem(DISMISS_FALLBACK_KEY);
  } catch {
    // Re-run setup should still continue even when browser storage is unavailable.
  }
}

export function NativeFirstRunOnboarding() {
  const demoMode = NATIVE_SETUP_DEMO_ENABLED;
  const [status, setStatus] = useState<NativeSetupStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [rawStep, setStep] = useState<WizardStep>("mode");
  const [mode, setMode] = useState<InstallMode>("link");
  const [skillAgents, setSkillAgents] = useState<string[]>(ALL_AGENT_IDS);
  const [memoryAgents, setMemoryAgents] = useState<string[]>(ALL_AGENT_IDS);
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState("");
  const [stepHeight, setStepHeight] = useState<number | null>(null);
  const stepContentRef = useRef<HTMLDivElement | null>(null);

  const detectedAgents = useMemo(() => status?.detected_agents?.length
    ? status.detected_agents
    : ALL_AGENT_IDS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), installed: false, detail: "Not checked" })),
  [status]);
  const device = deviceNoun(status?.platform);
  const isWindows = status?.platform === "windows";
  const isMac = device === "Mac";
  const modes = useMemo(() => installModes(device), [device]);
  const headers = useMemo(() => stepHeaders(device, isMac, isWindows), [device, isMac, isWindows]);
  // setup.ps1 ignores mode and import selections, so Windows skips straight to the run step.
  const wizardSteps = useMemo<WizardStep[]>(() => isWindows ? ["run", "pairing"] : ["mode", "agents", "run", "pairing"], [isWindows]);
  const step = wizardSteps.includes(rawStep) ? rawStep : wizardSteps[0];
  const selectedMode = modes.find((item) => item.id === mode) ?? modes[1];
  const stepShellStyle = stepHeight === null ? undefined : { height: `min(${stepHeight + 40}px, calc(100vh - 15rem))` };
  // The local collector starts only near the END of setup.ps1, so its check
  // flips to installed once setup has actually finished. Gate the "pairing"
  // step's "all set / take the tour" UI on it — otherwise the tour appears the
  // instant setup is *launched* (while the terminal is still mid-install), which
  // reads as "done" when it is not.
  const collectorReady = Boolean(status?.checks?.find((check) => check.id === "collector")?.installed);
  const setupSettled = demoMode || collectorReady;

  const refreshStatus = useCallback(async () => {
    if (!demoMode && !isTauriDesktopRuntime()) return;
    const next = await readNativeSetupStatus({ demoMode });
    setStatus(next);
    const installed = next?.detected_agents?.filter((agent) => agent.installed).map((agent) => agent.id) ?? [];
    if (installed.length > 0) {
      setSkillAgents((current) => current.length === ALL_AGENT_IDS.length ? installed : current);
      setMemoryAgents((current) => current.length === ALL_AGENT_IDS.length ? installed : current);
    }
  }, [demoMode]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (demoMode) {
        setOpen(true);
        void refreshStatus();
        return;
      }
      if (!isTauriDesktopRuntime()) return;
      void refreshStatus();
      const locallyDismissed = readLocalDismissal();
      setOpen(!locallyDismissed);
      void loadDashboardStateSnapshot().then((snapshot) => {
        const dismissedInDashboardState = dashboardStateValue(snapshot, DISMISS_KEY) === "1";
        const legacyDismissed = dashboardStateValue(snapshot, LEGACY_DISMISS_KEY) === "1";
        const dismissed = dismissedInDashboardState || locallyDismissed;
        if (legacyDismissed && !dismissed) void removeDashboardStateValue(LEGACY_DISMISS_KEY);
        setOpen(!dismissed);
        if (dismissed && !dismissedInDashboardState) void saveDashboardStateValue(DISMISS_KEY, "1");
      });
    }, 0);
    return () => window.clearTimeout(handle);
  }, [demoMode, refreshStatus]);

  // While the "pairing" step waits for setup to finish, keep refreshing status
  // so the screen flips from "finishing setup" to "all set" the moment the
  // local collector comes up.
  useEffect(() => {
    if (step !== "pairing" || setupSettled) return;
    if (!demoMode && !isTauriDesktopRuntime()) return;
    const id = window.setInterval(() => { void refreshStatus(); }, 4000);
    return () => window.clearInterval(id);
  }, [step, setupSettled, demoMode, refreshStatus]);

  useEffect(() => {
    if (!isTauriDesktopRuntime()) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => listen(NATIVE_SETUP_RERUN_EVENT, () => {
      clearLocalDismissal();
      void removeDashboardStateValue(DISMISS_KEY);
      setStep("mode");
      setRunStatus("");
      setOpen(true);
      void refreshStatus();
    })).then((unlisten) => {
      const safeUnlisten = createSafeTauriUnlisten(unlisten);
      if (cancelled) {
        safeUnlisten();
        return;
      }
      cleanup = safeUnlisten;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [refreshStatus]);

  useLayoutEffect(() => {
    if (!open) return;
    const node = stepContentRef.current;
    if (!node) return;
    const updateHeight = () => setStepHeight(Math.ceil(node.scrollHeight));
    updateHeight();

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateHeight);
    observer?.observe(node);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [open, step, status, skillAgents, memoryAgents, running, runStatus]);

  if (!open || !status) return null;

  // setup.ps1 has no mode/import flags (it detects Tailscale and seeds vault/skills itself),
  // so the Windows backup command mirrors build_setup_invocation in src-tauri/src/setup.rs.
  const commandPreview = isWindows
    ? "powershell -ExecutionPolicy Bypass -File setup.ps1 -SkipDashboard -SkipBuild"
    : `${selectedMode.command} ${skillAgents.length ? `--import-skills=${skillAgents.join(",")} --share-skills=all` : "--no-shared-skills"} --skip-dashboard${memoryAgents.length ? `\n./scripts/import-agent-memory.sh --sources ${memoryAgents.join(",")}` : ""}`;

  function toggleAgent(id: string) {
    const active = skillAgents.includes(id) || memoryAgents.includes(id);
    const update = (current: string[]) => active ? current.filter((item) => item !== id) : [...current.filter((item) => item !== id), id];
    setSkillAgents(update);
    setMemoryAgents(update);
  }

  async function persistDismissal() {
    writeLocalDismissal();
    return saveDashboardStateValue(DISMISS_KEY, "1");
  }

  function dismiss() {
    if (demoMode) {
      setOpen(false);
      return;
    }
    void persistDismissal();
    setOpen(false);
  }

  async function launchDemoSetup() {
    setRunning(true);
    for (const message of DEMO_RUN_MESSAGES) {
      setRunStatus(message);
      await new Promise((resolve) => window.setTimeout(resolve, 520));
    }
    setRunning(false);
  }

  async function launchSetup() {
    if (demoMode) {
      await launchDemoSetup();
      return true;
    }
    setRunning(true);
    setRunStatus("Starting setup. If your system needs permission, a Terminal window will open for that part.");
    const result = await runNativeSetup({
      installMode: mode,
      skillAgents,
      memoryAgents,
      importSkills: skillAgents.length > 0,
      importMemory: memoryAgents.length > 0,
      startDashboard: false,
      installCollector: true,
      buildDashboard: false,
      installDeps: true,
      force: false,
    }, { demoMode });
    setRunning(false);
    if (result?.ok) {
      grantNativePrivateFilesystemAccess();
      void persistDismissal();
    }
    setRunStatus(result?.ok ? "Setup has started. Follow any permission prompts that appear." : result?.error ?? "Could not start setup.");
    return Boolean(result?.ok);
  }

  async function copySetupCommand() {
    try {
      await navigator.clipboard.writeText(commandPreview);
      setRunStatus("Backup command copied.");
    } catch {
      setRunStatus("Could not copy automatically. You can select the command text below.");
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(20,184,166,0.18),rgba(2,6,23,0.82)_34%,rgba(2,6,23,0.92))] p-4 backdrop-blur-md">
      <section className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[rgba(148,163,184,0.20)] bg-[rgba(8,13,22,0.96)] text-[var(--foreground)] shadow-2xl">
        <header className="shrink-0 flex items-start justify-between gap-4 border-b border-[rgba(148,163,184,0.14)] p-4">
          <div className="flex min-w-0 gap-3">
            <Image src="/hivemindos-logo.png" alt="" width={44} height={44} className="h-11 w-11 rounded-lg object-cover" unoptimized />
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[rgba(45,212,191,0.26)] bg-[rgba(20,184,166,0.12)] px-2.5 py-1 text-xs font-medium text-[var(--accent-strong)]">
                <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
                Guided setup
              </div>
              <h2 className="text-xl font-semibold tracking-normal">{headers[step].title}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">{headers[step].subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StepDots step={step} steps={wizardSteps} />
            <CloseIconButton aria-label="Dismiss native setup" onClick={dismiss} />
          </div>
        </header>

        <div className="native-setup-step-shell min-h-0 p-4" style={stepShellStyle}>
          <div key={step} ref={stepContentRef} className={`native-setup-step ${step === "mode" ? "" : "min-h-[360px]"}`}>
          {step === "mode" ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {modes.filter((item) => item.id !== "system-tailscale").map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`flex min-h-[180px] w-full flex-col items-start justify-between gap-4 rounded-lg border p-5 text-left transition-all hover:-translate-y-0.5 ${mode === item.id ? "border-[rgba(45,212,191,0.58)] bg-[rgba(20,184,166,0.13)]" : "border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.42)]"}`}
                    onClick={() => { setMode(item.id); setStep("agents"); }}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="grid h-10 w-10 place-items-center rounded-lg border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.30)] text-[var(--accent-strong)]">
                        {item.id === "local" ? <Lock aria-hidden="true" className="h-5 w-5" /> : <Network aria-hidden="true" className="h-5 w-5" />}
                      </span>
                      {item.badge ? (
                        <span className="rounded-md border border-[rgba(45,212,191,0.30)] bg-[rgba(20,184,166,0.14)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">{item.badge}</span>
                      ) : null}
                    </span>
                    <span>
                      <span className="block text-lg font-semibold">{item.title}</span>
                      <span className="mt-2 block text-sm leading-6 text-[var(--muted)]">{item.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.28)] px-4 py-3 text-left text-sm text-[var(--muted)] transition-colors hover:border-[rgba(45,212,191,0.38)] hover:text-[var(--foreground)]"
                onClick={() => { setMode("system-tailscale"); setStep("agents"); }}
              >
                <span>
                  <span className="font-medium text-[var(--foreground)]">Power user?</span> Get the Full Tailnet Hive: always-on folder sync via Tailscale.
                </span>
                <span aria-hidden="true" className="shrink-0 text-[var(--accent-strong)]">→</span>
              </button>
              <p className="text-xs leading-5 text-[var(--muted)]">
                Not sure? Pick “{modes[1].title}.” You can change this anytime by running setup again.
              </p>
            </div>
          ) : null}

          {step === "agents" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.42)] p-4">
                <p className="text-sm leading-6 text-[var(--muted)]">
                  Everything is already turned on. Tap a helper only if you want to leave it out.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {detectedAgents.map((agent) => {
                    const active = skillAgents.includes(agent.id) || memoryAgents.includes(agent.id);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        title={agent.installed ? undefined : `Not found on this ${device}`}
                        className={`inline-flex min-h-7 max-w-full shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-1 text-left text-xs font-medium leading-tight transition-all hover:-translate-y-px hover:shadow-[0_0_0_3px_rgba(45,212,191,0.08)] focus-visible:border-[var(--button-ring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--button-ring)_45%,transparent)] ${active ? "border-transparent bg-[var(--button-primary)] text-[var(--button-primary-foreground)] hover:brightness-105" : "border-transparent bg-[var(--button-secondary)] text-[var(--button-secondary-foreground)] hover:border-[rgba(94,234,212,0.18)] hover:bg-[color-mix(in_srgb,var(--button-secondary)_88%,var(--button-primary))] hover:text-[var(--foreground)]"} ${agent.installed ? "" : "opacity-60"}`}
                        aria-pressed={active}
                        onClick={() => toggleAgent(agent.id)}
                      >
                        <AgentIcon agent={agent} compact />
                        <span className="min-w-0 [overflow-wrap:anywhere]">{agent.label}</span>
                        {active ? <Check aria-hidden="true" className="h-3 w-3 shrink-0" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="text-xs leading-5 text-[var(--muted)]">
                Don’t worry about getting this perfect — you can run setup again anytime.
              </p>
            </div>
          ) : null}

          {step === "run" ? (
            <div className="rounded-lg border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.46)] p-5">
              <div className="flex items-center gap-3">
                <Sparkles aria-hidden="true" className="h-6 w-6 text-[var(--accent-strong)]" />
                <div>
                  <h3 className="text-lg font-semibold">{isWindows ? "HivemindOS sets everything up for you" : "That’s it — HivemindOS does the rest"}</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                    Click <span className="font-medium text-[var(--foreground)]">Start setup</span> below. If your {device} asks for permission along the way, just click OK or Allow.
                  </p>
                </div>
              </div>
              <details className="mt-5 rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.36)] p-3 text-xs text-[var(--muted)]">
                <summary className="cursor-pointer text-sm font-medium text-[var(--foreground)]">Setup didn’t start? Run it yourself</summary>
                <p className="mt-3 leading-5">Copy this command and paste it into {isWindows ? "PowerShell" : "the Terminal app"}:</p>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md bg-[rgba(2,6,23,0.50)] p-3">{commandPreview}</pre>
                <Button type="button" variant="secondary" className="mt-3" onClick={() => void copySetupCommand()}>
                  <Copy aria-hidden="true" />
                  Copy command
                </Button>
              </details>
              {runStatus ? <p className="mt-3 text-sm text-[var(--muted)]">{runStatus}</p> : null}
            </div>
          ) : null}

          {step === "pairing" ? (
            <div className="rounded-lg border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.46)] p-5">
              <div className="flex items-center gap-3">
                {setupSettled ? (
                  <Check aria-hidden="true" className="h-6 w-6 text-[var(--accent-strong)]" />
                ) : (
                  <LoaderCircle aria-hidden="true" className="h-6 w-6 animate-spin text-[var(--muted)]" />
                )}
                <div>
                  <h3 className="text-lg font-semibold">{setupSettled ? "You're all set" : "Finishing setup…"}</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                    {setupSettled ? (
                      <>
                        You can close this window — HivemindOS finishes up in the background.
                        {isMac
                          ? " Your phone can reach this Mac automatically, even when the app is closed. The first time it opens a file, just tap “Allow” on the one-time prompt."
                          : " If a window pops up asking for permission, just click OK or Allow."}
                      </>
                    ) : (
                      "Setup is still running in the other window — this can take a few minutes while it installs dependencies and the local agent bridge. This screen updates on its own when it finishes."
                    )}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
          </div>
        </div>

        <footer className="shrink-0 flex flex-col gap-3 border-t border-[rgba(148,163,184,0.14)] p-4 sm:flex-row sm:items-center sm:justify-between">
          {step === wizardSteps[0] ? <span aria-hidden="true" /> : (
            <Button type="button" variant="ghost" onClick={() => setStep(wizardSteps[Math.max(0, wizardSteps.indexOf(step) - 1)])}>
              <ChevronLeft aria-hidden="true" />
              Back
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            {step === "agents" ? (
              <Button type="button" variant="ghost" onClick={() => void refreshStatus()}>
                <RefreshCcw aria-hidden="true" />
                Scan again
              </Button>
            ) : null}
            {step === "run" ? (
              <Button type="button" onClick={async () => { if (await launchSetup()) setStep("pairing"); }} disabled={running}>
                {running ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Sparkles aria-hidden="true" />}
                Start setup
              </Button>
            ) : step === "pairing" ? (
              setupSettled ? (
                <>
                  <Button type="button" variant="secondary" onClick={dismiss}>
                    I’ll explore on my own
                  </Button>
                  <Button type="button" onClick={() => { dismiss(); requestGuidedTour(); }}>
                    <Sparkles aria-hidden="true" />
                    Show me around
                  </Button>
                </>
              ) : (
                <Button type="button" variant="ghost" onClick={dismiss}>
                  <X aria-hidden="true" />
                  Close — I’ll come back
                </Button>
              )
            ) : step === "agents" ? (
              <Button type="button" onClick={() => setStep("run")}>
                <Sparkles aria-hidden="true" />
                Continue
              </Button>
            ) : null}
            {step !== "pairing" ? (
              <Button type="button" variant="secondary" onClick={dismiss}>
                <X aria-hidden="true" />
                Set up later
              </Button>
            ) : null}
          </div>
        </footer>
      </section>
      <style jsx>{`
        .native-setup-step-shell {
          overflow-x: hidden;
          overflow-y: auto;
          transition: height 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        .native-setup-step {
          animation: nativeSetupStepIn 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        @keyframes nativeSetupStepIn {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.992);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .native-setup-step-shell {
            transition: none;
          }

          .native-setup-step {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
