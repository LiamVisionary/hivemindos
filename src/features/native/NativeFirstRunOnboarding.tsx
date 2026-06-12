"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Check, ChevronLeft, Clipboard, Copy, FolderOpen, HelpCircle, LoaderCircle, Lock, Network, RefreshCcw, ShieldCheck, Smartphone, Sparkles, Terminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";
import { NATIVE_SETUP_DEMO_ENABLED, NATIVE_SETUP_RERUN_EVENT, openFullDiskAccessSettings, readNativeSetupStatus, revealGatewayForFullDiskAccess, runNativeSetup, type NativeDetectedAgentRuntime, type NativeSetupStatus } from "@/lib/native/setup";
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

const INSTALL_MODES: Array<{
  id: InstallMode;
  title: string;
  detail: string;
  highlights: string[];
  capabilities: string[];
  info: string;
  command: string;
}> = [
  {
    id: "local",
    title: "Just this Mac",
    detail: "Only agents on this device share memories, skills, and env. Nothing syncs to your other computers.",
    highlights: ["This device only", "No cross-machine sharing"],
    capabilities: ["Local agent sharing", "No other devices", "Can upgrade later"],
    info: "Choose this when you only want this Mac involved right now. Agents on this machine can share hive context with each other, and you can add other computers later.",
    command: "./setup.sh --local-only",
  },
  {
    id: "link",
    title: "Private Hive Link",
    detail: "Your devices share memories, skills, env, and handoffs through Hivemind Sync, without a separate folder sync app.",
    highlights: ["Easiest multi-device", "No folder sync app"],
    capabilities: ["Hivemind Sync across devices", "HivemindOS handles the link", "No always-on vault folder sync"],
    info: "Best default for most people. HivemindOS manages remote app access through its private bridge, so you can add machines without first configuring Tailscale, Syncthing, SSH, or background sync services. It does not install Syncthing-style always-on vault folder sync.",
    command: "./setup.sh --link",
  },
  {
    id: "system-tailscale",
    title: "Full Tailnet Hive",
    detail: "Your devices share memories, skills, env, and handoffs through Hivemind Sync, plus always-on vault folder sync.",
    highlights: ["Most complete", "Always-on sync"],
    capabilities: ["Share across devices", "Sync vault folders", "Best for power users"],
    info: "Choose this if you already use Tailscale or want the full system-level setup: Syncthing folder sync, SSH pull/repair fallback, collector services, and persistent remote access between your machines.",
    command: "./setup.sh --system-tailscale",
  },
];

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

function StepDots({ step }: { step: WizardStep }) {
  const steps: WizardStep[] = ["mode", "agents", "run", "pairing"];
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
  const [step, setStep] = useState<WizardStep>("mode");
  const [mode, setMode] = useState<InstallMode>("link");
  const [skillAgents, setSkillAgents] = useState<string[]>(ALL_AGENT_IDS);
  const [memoryAgents, setMemoryAgents] = useState<string[]>(ALL_AGENT_IDS);
  const [infoCard, setInfoCard] = useState("");
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState("");
  const [pairingExpanded, setPairingExpanded] = useState(false);
  const [pairingStatus, setPairingStatus] = useState("");
  const [stepHeight, setStepHeight] = useState<number | null>(null);
  const stepContentRef = useRef<HTMLDivElement | null>(null);

  const detectedAgents = useMemo(() => status?.detected_agents?.length
    ? status.detected_agents
    : ALL_AGENT_IDS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), installed: false, detail: "Not checked" })),
  [status]);
  const selectedMode = INSTALL_MODES.find((item) => item.id === mode) ?? INSTALL_MODES[1];
  const stepShellStyle = stepHeight === null ? undefined : { height: `min(${stepHeight + 40}px, calc(100vh - 15rem))` };

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
  }, [open, step, infoCard, status, skillAgents, memoryAgents, running, runStatus, pairingExpanded, pairingStatus]);

  if (!open || !status) return null;

  const commandPreview = `${selectedMode.command} ${skillAgents.length ? `--import-skills=${skillAgents.join(",")} --share-skills=all` : "--no-shared-skills"} --skip-dashboard${memoryAgents.length ? `\n./scripts/import-agent-memory.sh --sources ${memoryAgents.join(",")}` : ""}`;

  function toggleSelection(kind: "skills" | "memory", id: string) {
    const setter = kind === "skills" ? setSkillAgents : setMemoryAgents;
    setter((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
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

  async function openFolderAccessSettings() {
    setPairingStatus("");
    const ok = demoMode ? true : await openFullDiskAccessSettings();
    if (!ok) {
      setPairingStatus(
        "Couldn't open Settings automatically — open System Settings → Privacy & Security → Full Disk Access.",
      );
    }
  }

  async function revealGatewayBinary() {
    setPairingStatus("");
    const ok = demoMode ? true : await revealGatewayForFullDiskAccess();
    setPairingStatus(
      ok
        ? "Finder is highlighting “HivemindOS Gateway”. Drag it into the Full Disk Access list (or click +, then add it) and switch it on."
        : "Couldn't reveal the file automatically. Make sure HivemindOS is installed on this Mac, then try again.",
    );
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
                Native setup
              </div>
              <h2 className="text-xl font-semibold tracking-normal">Welcome to the HivemindOS</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">How would you like to install the hive?</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StepDots step={step} />
            <CloseIconButton aria-label="Dismiss native setup" onClick={dismiss} />
          </div>
        </header>

        <div className="native-setup-step-shell min-h-0 p-4" style={stepShellStyle}>
          <div key={step} ref={stepContentRef} className={`native-setup-step ${step === "mode" ? "" : "min-h-[360px]"}`}>
          {step === "mode" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {INSTALL_MODES.map((item) => (
                <div key={item.id} className={`relative min-h-[260px] rounded-lg border transition-all ${mode === item.id ? "border-[rgba(45,212,191,0.58)] bg-[rgba(20,184,166,0.13)]" : "border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.42)]"}`}>
                  <button type="button" className="flex h-full min-h-[260px] w-full flex-col items-start justify-between p-5 text-left transition-all hover:-translate-y-0.5" onClick={() => { setMode(item.id); setStep("agents"); }}>
                    <span className="grid h-10 w-10 place-items-center rounded-lg border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.30)] text-[var(--accent-strong)]">
                      <Network aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block text-lg font-semibold">{item.title}</span>
                      <span className="mt-3 block text-sm leading-6 text-[var(--muted)]">{item.detail}</span>
                      <span className="mt-4 flex flex-wrap gap-2">
                        {item.highlights.map((highlight) => (
                          <span key={highlight} className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.28)] px-2 py-1 text-xs font-medium text-[var(--muted)]">
                            {highlight}
                          </span>
                        ))}
                      </span>
                      <span className="mt-5 block">
                        <span className="block text-[0.68rem] font-semibold uppercase tracking-normal text-[var(--muted)]">Capabilities</span>
                        <span className="mt-2 grid gap-1.5">
                          {item.capabilities.map((capability) => (
                            <span key={capability} className="flex items-start gap-2 text-xs leading-5 text-[var(--muted)]">
                              <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-strong)]" />
                              {capability}
                            </span>
                          ))}
                        </span>
                      </span>
                    </span>
                    <span className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-[var(--accent-strong)]">
                      Choose this
                      {mode === item.id ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
                    </span>
                  </button>
                  <button type="button" className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.55)] text-[var(--muted)] transition-colors hover:text-[var(--foreground)]" aria-label={`Explain ${item.title}`} onClick={() => setInfoCard(infoCard === item.id ? "" : item.id)}>
                    <HelpCircle aria-hidden="true" className="h-4 w-4" />
                  </button>
                  {infoCard === item.id ? (
                    <div className="mx-4 mb-4 rounded-md border border-[rgba(45,212,191,0.24)] bg-[rgba(2,6,23,0.50)] p-3 text-xs leading-5 text-[var(--muted)]">
                      {item.info}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {step === "agents" ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Detected agents</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {detectedAgents.map((agent) => (
                    <span key={agent.id} className={`inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-tight transition-all hover:-translate-y-px hover:shadow-[0_0_0_3px_rgba(45,212,191,0.08)] ${agent.installed ? "border-transparent bg-[var(--button-primary)] text-[var(--button-primary-foreground)] hover:brightness-105" : "border-[rgba(148,163,184,0.20)] bg-[var(--button-secondary)] text-[var(--button-secondary-foreground)] opacity-70 hover:border-[rgba(94,234,212,0.18)] hover:bg-[color-mix(in_srgb,var(--button-secondary)_88%,var(--button-primary))] hover:text-[var(--foreground)]"}`}>
                      <AgentIcon agent={agent} compact />
                      {agent.label}
                    </span>
                  ))}
                </div>
              </div>
              {(["skills", "memory"] as const).map((kind) => {
                const selected = kind === "skills" ? skillAgents : memoryAgents;
                return (
                  <div key={kind} className="rounded-lg border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.42)] p-4">
                    <h4 className="text-sm font-semibold">{kind === "skills" ? "Import skills" : "Import memory"}</h4>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{kind === "skills" ? "Bring over reusable agent abilities so HivemindOS can share them." : "Bring over saved agent context files so they can be reviewed in the hive."}</p>
                    <div className="mt-3 flex flex-wrap gap-[7px]">
                      {detectedAgents.map((agent) => {
                        const active = selected.includes(agent.id);
                        return (
                          <button
                            key={`${kind}-${agent.id}`}
                            type="button"
                            className={`inline-flex min-h-7 max-w-full shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-1 text-left text-xs font-medium leading-tight transition-all hover:-translate-y-px hover:shadow-[0_0_0_3px_rgba(45,212,191,0.08)] focus-visible:border-[var(--button-ring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--button-ring)_45%,transparent)] ${active ? "border-transparent bg-[var(--button-primary)] text-[var(--button-primary-foreground)] hover:brightness-105" : "border-transparent bg-[var(--button-secondary)] text-[var(--button-secondary-foreground)] hover:border-[rgba(94,234,212,0.18)] hover:bg-[color-mix(in_srgb,var(--button-secondary)_88%,var(--button-primary))] hover:text-[var(--foreground)]"}`}
                            aria-pressed={active}
                            onClick={() => toggleSelection(kind, agent.id)}
                          >
                            <AgentIcon agent={agent} compact />
                            <span className="min-w-0 [overflow-wrap:anywhere]">{agent.label}</span>
                            {active ? <Check aria-hidden="true" className="h-3 w-3 shrink-0" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {step === "run" ? (
            <div className="rounded-lg border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.46)] p-5">
              <div className="flex items-center gap-3">
                <Network aria-hidden="true" className="h-6 w-6 text-[var(--accent-strong)]" />
                <div>
                  <h3 className="text-lg font-semibold">Ready to set up the hive</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                    HivemindOS will connect local agents, add missing pieces, and import your selected skills and memory.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.32)] p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles aria-hidden="true" className="h-4 w-4 text-[var(--accent-strong)]" />Handled for you</div>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Setup uses the choices you already made.</p>
                </div>
                <div className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.32)] p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold"><Terminal aria-hidden="true" className="h-4 w-4 text-[var(--accent-strong)]" />Approve if asked</div>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Only system permission steps need approval.</p>
                </div>
                <button type="button" className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.32)] p-3 text-left transition-colors hover:border-[rgba(45,212,191,0.38)]" onClick={() => void copySetupCommand()}>
                  <div className="flex items-center gap-2 text-sm font-semibold"><Copy aria-hidden="true" className="h-4 w-4 text-[var(--accent-strong)]" />Copy backup command</div>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Only needed if automatic setup cannot open your command line.</p>
                </button>
              </div>
              <details className="mt-4 rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.36)] p-3 text-xs text-[var(--muted)]">
                <summary className="cursor-pointer text-sm font-medium text-[var(--foreground)]">Show backup command</summary>
                <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-md bg-[rgba(2,6,23,0.50)] p-3">{commandPreview}</pre>
              </details>
              {runStatus ? <p className="mt-3 text-sm text-[var(--muted)]">{runStatus}</p> : null}
            </div>
          ) : null}

          {step === "pairing" ? (
            <div className="rounded-lg border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.46)] p-5">
              <div className="flex items-center gap-3">
                <Smartphone aria-hidden="true" className="h-6 w-6 text-[var(--accent-strong)]" />
                <div>
                  <h3 className="text-lg font-semibold">Pair your phone</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                    Let the HivemindOS app on your phone browse and work with files on this Mac — your projects, Downloads, Desktop, and more. macOS needs a one-time OK on this computer.
                  </p>
                </div>
              </div>

              {!pairingExpanded ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button type="button" onClick={() => setPairingExpanded(true)}>
                    <Lock aria-hidden="true" />
                    Set it up
                  </Button>
                  <Button type="button" variant="secondary" onClick={dismiss}>
                    Skip for now
                  </Button>
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  <p className="text-sm leading-6 text-[var(--muted)]">
                    Two quick steps, once. After this your phone can browse this Mac anytime — even when this app is closed.
                  </p>
                  <div className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.32)] p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--button-primary)] text-xs font-semibold text-[var(--button-primary-foreground)]">1</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">Open the permission settings</div>
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Opens straight to Privacy &amp; Security → Full Disk Access.</p>
                        <Button type="button" variant="secondary" className="mt-2" onClick={() => void openFolderAccessSettings()}>
                          <ShieldCheck aria-hidden="true" />
                          Open Full Disk Access
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.32)] p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--button-primary)] text-xs font-semibold text-[var(--button-primary-foreground)]">2</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">Add “HivemindOS Gateway”</div>
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">We’ll highlight it in Finder. Drag it into the list (or click +, then add it) and switch it on.</p>
                        <Button type="button" variant="secondary" className="mt-2" onClick={() => void revealGatewayBinary()}>
                          <FolderOpen aria-hidden="true" />
                          Show me the file
                        </Button>
                      </div>
                    </div>
                  </div>
                  {pairingStatus ? <p className="text-sm leading-6 text-[var(--muted)]">{pairingStatus}</p> : null}
                </div>
              )}
            </div>
          ) : null}
          </div>
        </div>

        <footer className="shrink-0 flex flex-col gap-3 border-t border-[rgba(148,163,184,0.14)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" disabled={step === "mode"} onClick={() => setStep(step === "pairing" ? "run" : step === "run" ? "agents" : "mode")}>
            <ChevronLeft aria-hidden="true" />
            Back
          </Button>
          <div className="flex flex-wrap gap-2">
            {step !== "pairing" ? (
              <Button type="button" variant="ghost" onClick={() => void refreshStatus()}>
                <RefreshCcw aria-hidden="true" />
                Rescan
              </Button>
            ) : null}
            {step === "run" ? (
              <Button type="button" onClick={async () => { if (await launchSetup()) setStep("pairing"); }} disabled={running}>
                {running ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Clipboard aria-hidden="true" />}
                Start setup
              </Button>
            ) : step === "pairing" ? (
              <Button type="button" onClick={dismiss}>
                <Check aria-hidden="true" />
                Done
              </Button>
            ) : (
              <Button type="button" onClick={() => setStep(step === "mode" ? "agents" : "run")}>
                <Sparkles aria-hidden="true" />
                Continue
              </Button>
            )}
            {step !== "pairing" ? (
              <Button type="button" variant="secondary" onClick={dismiss}>
                <X aria-hidden="true" />
                Skip
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
