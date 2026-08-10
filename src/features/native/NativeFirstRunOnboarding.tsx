"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type SVGProps,
} from "react";

import { requestGuidedTour } from "@/lib/native/guided-tour";
import { requestFirstTask } from "@/lib/native/first-task";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { grantNativePrivateFilesystemAccess } from "@/lib/native/dashboard-bootstrap";
import {
  NATIVE_SETUP_DEMO_ENABLED,
  NATIVE_SETUP_RERUN_EVENT,
  readNativeSetupStatus,
  runNativeSetup,
  type NativeDetectedAgentRuntime,
  type NativeSetupStatus,
} from "@/lib/native/setup";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";
import { runtimeIconFallback, runtimeIconPath, runtimeIconRenderMode } from "@/lib/config/runtime-icons";
import {
  dashboardStateValue,
  loadDashboardStateSnapshot,
  removeDashboardStateValue,
  saveDashboardStateValue,
} from "@/lib/services/dashboard-state-client";
import { useModalFocusTrap } from "@/lib/ui/use-modal-focus-trap";

import styles from "./NativeFirstRunOnboarding.module.css";

const COMPLETE_KEY = "hivemindos.nativeFirstRun.dismissed.v3";
const SKIP_KEY = "hivemindos.nativeFirstRun.skipped.v1";
const LEGACY_DISMISS_KEY = "hivemindos.nativeFirstRun.dismissed.v2";
const LOCAL_COMPLETE_KEY = `${COMPLETE_KEY}.localFallback`;
const LOCAL_SKIP_KEY = `${SKIP_KEY}.localFallback`;
const NATIVE_SETUP_PROGRESS_EVENT = "native-setup-progress";
const SETUP_WARNING_PREFIX = "HIVEMINDOS_SETUP_WARNING:";
const APP_LOGO_PATH = "/icon-512.png";
const ALL_AGENT_IDS = ["codex", "claude", "hermes", "gemini", "openclaw", "aeon"];
const WIZARD_STEPS = ["welcome", "setup", "running", "done"] as const;
const EMBLEM_CELLS = 7;

type WizardStep = (typeof WIZARD_STEPS)[number];
type InstallMode = "local" | "link" | "system-tailscale";
type SetupProgressPayload = {
  runId?: string;
  kind?: "start" | "line" | "done";
  line?: string;
  exitCode?: number | null;
};

const SETUP_MILESTONES: Array<{ re: RegExp; cell: number; label: string }> = [
  { re: /Downloading HivemindOS setup files|Unpacking setup files/i, cell: 1, label: "Downloading the pinned setup files…" },
  { re: /HivemindOS (Windows )?setup\b|Node (found|is missing)|Downloading Node/i, cell: 2, label: "Checking the tools this computer needs…" },
  { re: /Python (found|ready)|hive-env-add installed|hive-pulse installed/i, cell: 3, label: "Preparing local HivemindOS helpers…" },
  { re: /shared skill projection|hive-brain-sync|shared skills/i, cell: 4, label: "Preparing your private workspace…" },
  { re: /MCP registration|Registered into \d+ harness|Runtime skill and memory hints/i, cell: 5, label: "Connecting your AI helpers…" },
  { re: /\bReady\b|Dashboard:|Local-only mode is ready/i, cell: 6, label: "Starting the local agent bridge…" },
];

function setupMilestoneCells(lines: string[]) {
  return SETUP_MILESTONES.reduce((max, milestone) => (
    lines.some((line) => milestone.re.test(line)) ? Math.max(max, milestone.cell) : max
  ), 0);
}

function setupPhaseLabel(lines: string[], settled: boolean) {
  if (settled) return "This computer is ready.";
  const current = [...SETUP_MILESTONES].reverse().find((milestone) => lines.some((line) => milestone.re.test(line)));
  return current?.label ?? "Starting setup…";
}

function setupWarningMessages(lines: string[]) {
  return [...new Set(lines.flatMap((line) => {
    const marker = line.indexOf(SETUP_WARNING_PREFIX);
    if (marker < 0) return [];
    const message = line.slice(marker + SETUP_WARNING_PREFIX.length).trim();
    return message ? [message] : [];
  }))];
}

function deviceNoun(platform: string | undefined) {
  if (platform === "windows") return "PC";
  if (platform === "macos" || platform === "demo") return "Mac";
  return "computer";
}

function modeCommand(mode: InstallMode) {
  if (mode === "local") return "--local-only";
  if (mode === "system-tailscale") return "--system-tailscale";
  return "--link";
}

function readLocalState(key: string) {
  // guard:allow-browser-storage - disposable setup-state mirror; dashboard state is authoritative and loss only re-prompts
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}

function writeLocalState(key: string) {
  // guard:allow-browser-storage - disposable setup-state mirror; dashboard state is authoritative and loss only re-prompts
  try { window.localStorage.setItem(key, "1"); } catch { /* dashboard state remains authoritative */ }
}

function clearLocalState(key: string) {
  // guard:allow-browser-storage - disposable setup-state mirror; dashboard state is authoritative and loss only re-prompts
  try { window.localStorage.removeItem(key); } catch { /* best effort cache clear */ }
}

function newRunId() {
  try { return window.crypto.randomUUID(); } catch { return `setup-${Date.now()}`; }
}

function agentIconId(agentId: string) {
  if (agentId === "codex" || agentId === "claude" || agentId === "gemini") return "hivemind-os";
  return agentId;
}

function AgentIcon({ agent }: { agent: NativeDetectedAgentRuntime }) {
  const iconId = agentIconId(agent.id);
  const icon = runtimeIconPath(iconId);
  const renderMode = runtimeIconRenderMode(iconId);
  if (icon && renderMode === "mask") {
    return <span aria-hidden="true" className="h-4 w-4 bg-current" style={{ WebkitMask: `url(${icon}) center / contain no-repeat`, mask: `url(${icon}) center / contain no-repeat` }} />;
  }
  if (icon) return <Image src={icon} alt="" width={16} height={16} className="h-4 w-4 object-contain" unoptimized />;
  return <span aria-hidden="true" className="grid h-4 w-4 place-items-center rounded-full bg-[rgba(148,163,184,0.18)] text-[0.55rem] font-semibold">{runtimeIconFallback(iconId, agent.label)}</span>;
}

type NativeFirstRunOnboardingProps = {
  demoMode?: boolean;
  demoPlatform?: "macos" | "windows" | "linux";
  demoHasAgents?: boolean;
};

export function NativeFirstRunOnboarding({
  demoMode: demoModeProp,
  demoPlatform,
  demoHasAgents = true,
}: NativeFirstRunOnboardingProps = {}) {
  const demoMode = demoModeProp ?? NATIVE_SETUP_DEMO_ENABLED;
  const [status, setStatus] = useState<NativeSetupStatus | null>(null);
  const [open, setOpen] = useState(demoMode);
  const [step, setStep] = useState<WizardStep>("welcome");
  const [mode, setMode] = useState<InstallMode>("local");
  const [installWebResearch, setInstallWebResearch] = useState(false);
  const [enableCodeProof, setEnableCodeProof] = useState(false);
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState("");
  const [runError, setRunError] = useState("");
  const [copied, setCopied] = useState(false);
  const [setupLines, setSetupLines] = useState<string[]>([]);
  const [setupProcessDone, setSetupProcessDone] = useState(false);
  const [setupExitError, setSetupExitError] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const activeRunIdRef = useRef("");
  const completionSavedRef = useRef(false);
  const previousStepRef = useRef<WizardStep>("welcome");

  const refreshStatus = useCallback(async () => {
    if (!demoMode && !isTauriDesktopRuntime()) return;
    const next = await readNativeSetupStatus({ demoMode });
    if (next && demoMode && demoPlatform) next.platform = demoPlatform;
    if (next && demoMode && !demoHasAgents) {
      next.detected_agents = next.detected_agents?.map((agent) => ({ ...agent, installed: false }));
    }
    setStatus(next);
  }, [demoHasAgents, demoMode, demoPlatform]);

  const dismissTemporarily = useCallback(() => setOpen(false), []);
  useModalFocusTrap(open && Boolean(status), modalRef, { onEscape: dismissTemporarily, portalRootRef: stageRef });

  useEffect(() => {
    if (!open || previousStepRef.current === step) return;
    previousStepRef.current = step;
    const frame = window.requestAnimationFrame(() => modalRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, step]);

  const detectedAgents = useMemo(() => status?.detected_agents?.length
    ? status.detected_agents
    : ALL_AGENT_IDS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), installed: false, detail: "Not detected" })),
  [status]);
  const readyAgents = detectedAgents.filter((agent) => agent.installed);
  const laterAgents = detectedAgents.filter((agent) => !agent.installed);
  const selectedAgentIds = readyAgents.map((agent) => agent.id);
  const device = deviceNoun(status?.platform);
  const isWindows = status?.platform === "windows";
  const collectorReady = Boolean(status?.checks?.find((check) => check.id === "collector")?.installed);
  const setupSettled = setupProcessDone && !setupExitError && (demoMode || collectorReady);
  const stepIndex = WIZARD_STEPS.indexOf(step);

  useEffect(() => {
    if (demoMode) {
      const refreshTimer = window.setTimeout(() => { void refreshStatus(); }, 0);
      return () => window.clearTimeout(refreshTimer);
    }
    if (!isTauriDesktopRuntime()) return;
    let cancelled = false;
    const hydrateTimer = window.setTimeout(() => {
      void refreshStatus();
      const cached = readLocalState(LOCAL_COMPLETE_KEY) || readLocalState(LOCAL_SKIP_KEY);
      setOpen(!cached);
      void loadDashboardStateSnapshot().then((snapshot) => {
        if (cancelled) return;
        const complete = dashboardStateValue(snapshot, COMPLETE_KEY) === "1";
        const skipped = dashboardStateValue(snapshot, SKIP_KEY) === "1";
        const legacy = dashboardStateValue(snapshot, LEGACY_DISMISS_KEY) === "1";
        if (legacy) void removeDashboardStateValue(LEGACY_DISMISS_KEY);
        setOpen(!(complete || skipped || cached));
        if (complete && !readLocalState(LOCAL_COMPLETE_KEY)) writeLocalState(LOCAL_COMPLETE_KEY);
        if (skipped && !readLocalState(LOCAL_SKIP_KEY)) writeLocalState(LOCAL_SKIP_KEY);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(hydrateTimer);
    };
  }, [demoMode, refreshStatus]);

  useEffect(() => {
    if (step !== "running" || setupSettled || demoMode || !isTauriDesktopRuntime()) return;
    const id = window.setInterval(() => { void refreshStatus(); }, 4000);
    return () => window.clearInterval(id);
  }, [demoMode, refreshStatus, setupSettled, step]);

  useEffect(() => {
    if (step !== "running" || setupSettled || setupExitError || !setupProcessDone || demoMode) return;
    const id = window.setTimeout(() => {
      setSetupExitError("Setup finished, but the local agent bridge did not come online.");
    }, 8000);
    return () => window.clearTimeout(id);
  }, [demoMode, setupExitError, setupProcessDone, setupSettled, step]);

  useEffect(() => {
    if (step !== "running" || !setupSettled) return;
    if (!demoMode && !completionSavedRef.current) {
      completionSavedRef.current = true;
      writeLocalState(LOCAL_COMPLETE_KEY);
      void saveDashboardStateValue(COMPLETE_KEY, "1");
    }
    const id = window.setTimeout(() => setStep("done"), 650);
    return () => window.clearTimeout(id);
  }, [demoMode, setupSettled, step]);

  useEffect(() => {
    if (!isTauriDesktopRuntime()) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => listen<SetupProgressPayload>(NATIVE_SETUP_PROGRESS_EVENT, (event) => {
      const payload = event.payload ?? {};
      if (!payload.runId || payload.runId !== activeRunIdRef.current) return;
      if (payload.kind === "start") {
        setSetupLines([]);
        setSetupProcessDone(false);
        setSetupExitError("");
        return;
      }
      if (payload.kind === "line" && typeof payload.line === "string") {
        setSetupLines((current) => [...current.slice(-199), payload.line as string]);
        return;
      }
      if (payload.kind === "done") {
        setSetupProcessDone(true);
        void refreshStatus();
        if (payload.exitCode == null) setSetupExitError("Setup ended without reporting whether it succeeded.");
        else if (payload.exitCode !== 0) setSetupExitError(`Setup stopped with code ${payload.exitCode}.`);
      }
    })).then((unlisten) => {
      const safeUnlisten = createSafeTauriUnlisten(unlisten);
      if (cancelled) safeUnlisten();
      else cleanup = safeUnlisten;
    }).catch(() => undefined);
    return () => { cancelled = true; cleanup?.(); };
  }, [refreshStatus]);

  useEffect(() => {
    if (!isTauriDesktopRuntime()) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => listen(NATIVE_SETUP_RERUN_EVENT, () => {
      clearLocalState(LOCAL_COMPLETE_KEY);
      clearLocalState(LOCAL_SKIP_KEY);
      void removeDashboardStateValue(COMPLETE_KEY);
      void removeDashboardStateValue(SKIP_KEY);
      completionSavedRef.current = false;
      activeRunIdRef.current = "";
      setStep("welcome");
      setMode("local");
      setRunStatus("");
      setRunError("");
      setOpen(true);
      void refreshStatus();
    })).then((unlisten) => {
      const safeUnlisten = createSafeTauriUnlisten(unlisten);
      if (cancelled) safeUnlisten();
      else cleanup = safeUnlisten;
    }).catch(() => undefined);
    return () => { cancelled = true; cleanup?.(); };
  }, [refreshStatus]);

  async function skipSetup() {
    if (!demoMode) {
      writeLocalState(LOCAL_SKIP_KEY);
      await saveDashboardStateValue(SKIP_KEY, "1");
    }
    setOpen(false);
  }

  async function launchDemoSetup() {
    setSetupLines(["Checking this computer…"]);
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    setSetupLines((current) => [...current, "Preparing your private workspace…"]);
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    setSetupLines((current) => [...current, "Ready"]);
    setSetupProcessDone(true);
  }

  async function launchSetup() {
    setRunning(true);
    setRunError("");
    setSetupExitError("");
    setSetupProcessDone(false);
    setSetupLines([]);
    setRunStatus("Setup is running in the background. You can close this window and return later.");
    setStep("running");
    const runId = newRunId();
    activeRunIdRef.current = runId;
    if (demoMode) {
      await launchDemoSetup();
      setRunning(false);
      return;
    }
    const result = await runNativeSetup({
      runId,
      installMode: mode,
      skillAgents: selectedAgentIds,
      memoryAgents: selectedAgentIds,
      importSkills: selectedAgentIds.length > 0,
      importMemory: selectedAgentIds.length > 0,
      installWebResearch,
      enableCodeProof,
      startDashboard: false,
      installCollector: true,
      buildDashboard: false,
      installDeps: false,
      force: false,
    }, { demoMode });
    setRunning(false);
    if (result?.ok && result.runId === runId) {
      grantNativePrivateFilesystemAccess();
      return;
    }
    activeRunIdRef.current = "";
    setRunError(result?.error ?? "Setup could not start. Nothing was changed.");
    setStep("setup");
  }

  function copyCommand(value: string) {
    try { void navigator.clipboard?.writeText(value); } catch { /* clipboard may be unavailable */ }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function finishWith(action: "task" | "tour" | "dashboard") {
    setOpen(false);
    if (action === "task") requestFirstTask();
    if (action === "tour") requestGuidedTour();
  }

  if (!open || !status || typeof document === "undefined") return null;

  const runtimeTargets = selectedAgentIds.length ? selectedAgentIds.join(",") : "none";
  const extras = `${installWebResearch ? " -InstallWebResearch" : ""}${enableCodeProof ? " -EnableCodeProof" : ""}`;
  const unixExtras = `HIVE_INSTALL_WEB_RESEARCH=${installWebResearch ? "true" : "false"} HIVE_GITLAWB_SETUP=${enableCodeProof ? "true" : "false"} HIVE_GITLAWB_IDENTITY=${enableCodeProof ? "true" : "false"} HIVE_GITLAWB_REGISTER=${enableCodeProof ? "true" : "false"}`;
  const commandPreview = isWindows
    ? `powershell -ExecutionPolicy Bypass -File setup.ps1 -NonInteractive -NetworkMode ${mode} -RuntimeTargets ${runtimeTargets} -SkipDeps -SkipDashboard -SkipBuild${extras}`
    : `${unixExtras} ./setup.sh --non-interactive ${modeCommand(mode)} --skip-deps --skip-dashboard ${selectedAgentIds.length ? `--import-skills=none --share-skills=${runtimeTargets}` : "--no-shared-skills"}${selectedAgentIds.length ? `\n./scripts/import-agent-memory.sh --sources ${runtimeTargets}` : ""}`;
  const filled = setupSettled ? EMBLEM_CELLS : setupMilestoneCells(setupLines);
  const meterPct = Math.round((filled / EMBLEM_CELLS) * 100);
  const phaseLabel = setupExitError ? "Setup needs attention." : setupPhaseLabel(setupLines, setupSettled);
  const activity = setupLines.map((line) => line.trim()).filter(Boolean).slice(-8);
  const setupWarnings = setupWarningMessages(setupLines);

  return createPortal(
    <div className={styles.stage} ref={stageRef}>
      <div className={styles.backdrop} aria-hidden="true" />
      <div className={styles.comb} aria-hidden="true" />
      <div className={styles.scrim} aria-hidden="true" />
      <section
        className={styles.modal}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="native-setup-title"
        aria-describedby="native-setup-description"
        tabIndex={-1}
      >
        <button className={styles.close} type="button" aria-label={step === "running" ? "Close setup progress" : "Close setup"} onClick={dismissTemporarily}><IconClose /></button>
        <header className={styles.hero} data-tone={step === "running" ? "live" : undefined}>
          <span className={styles.mark}><Image src={APP_LOGO_PATH} alt="" aria-hidden="true" width={50} height={50} unoptimized /></span>
          <span className={styles.heroText}>
            <span className={styles.eyebrow}>HivemindOS · First-time setup</span>
            <span className={styles.heroTitle}>Set up this {device}</span>
            <span className={styles.srStatus} aria-live="polite">Step {stepIndex + 1} of {WIZARD_STEPS.length}: {step}</span>
          </span>
          <span className={styles.rail} aria-hidden="true">
            {WIZARD_STEPS.map((item, index) => <i key={item} data-on={index <= stepIndex ? "true" : undefined} data-live={step === "running" && item === "running" ? "true" : undefined} />)}
          </span>
        </header>

        <div className={styles.body}>
          {step === "welcome" ? <WelcomeStep device={device} /> : null}
          {step === "setup" ? (
            <SetupStep
              device={device}
              mode={mode}
              setMode={setMode}
              readyAgents={readyAgents}
              laterAgents={laterAgents}
              installWebResearch={installWebResearch}
              setInstallWebResearch={setInstallWebResearch}
              enableCodeProof={enableCodeProof}
              setEnableCodeProof={setEnableCodeProof}
              status={status}
              runError={runError}
              onScan={refreshStatus}
            />
          ) : null}
          {step === "running" ? (
            <RunningStep
              filled={filled}
              meterPct={meterPct}
              settled={setupSettled}
              phaseLabel={phaseLabel}
              activity={activity}
              runStatus={setupExitError ? `${setupExitError} Retry setup below, or open Technical details for the manual command.` : runStatus}
              commandPreview={commandPreview}
              isWindows={isWindows}
              copied={copied}
              onCopy={copyCommand}
            />
          ) : null}
          {step === "done" ? <DoneStep device={device} hasReadyAgent={readyAgents.length > 0} mode={mode} warnings={setupWarnings} /> : null}
        </div>

        <footer className={styles.foot}>
          {step === "welcome" ? <p className={styles.disclaimer}>Your workspace stays on this {device}. Setup downloads pinned open-source components; optional network features are clearly labeled.</p> : null}
          <div className={styles.footActions} data-layout={step === "welcome" || step === "done" ? "three" : "two"}>
            {step === "welcome" ? (
              <>
                <button className={`${styles.btn} ${styles.primary}`} type="button" data-modal-autofocus onClick={() => setStep("setup")}>See setup choices <IconArrow /></button>
                <button className={`${styles.btn} ${styles.text}`} type="button" onClick={() => void skipSetup()}>Use without setup</button>
                <button className={`${styles.btn} ${styles.ghost}`} type="button" onClick={dismissTemporarily}>Not now — ask next time</button>
              </>
            ) : step === "setup" ? (
              <>
                <button className={`${styles.btn} ${styles.text}`} type="button" onClick={() => setStep("welcome")}><IconChevL /> Back</button>
                <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => void launchSetup()} disabled={running}>
                  {running ? <><IconSpinner /> Starting…</> : <>Set up this {device} <IconArrow /></>}
                </button>
              </>
            ) : step === "running" ? (
              <>
                <button className={`${styles.btn} ${styles.text}`} type="button" onClick={dismissTemporarily}>Close — setup keeps running</button>
                {setupExitError ? (
                  <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => void launchSetup()} disabled={running}><IconRefresh /> Retry setup</button>
                ) : <button className={`${styles.btn} ${styles.primary}`} type="button" data-tone="live" disabled><IconSpinner /> Working…</button>}
              </>
            ) : (
              <>
                <button className={`${styles.btn} ${styles.primary}`} type="button" data-tone="live" data-modal-autofocus onClick={() => finishWith("task")}>{readyAgents.length > 0 ? "Try a first task" : "Add your first agent"} <IconArrow /></button>
                <button className={`${styles.btn} ${styles.text}`} type="button" onClick={() => finishWith("dashboard")}>Go to dashboard</button>
                <button className={`${styles.btn} ${styles.ghost}`} type="button" onClick={() => finishWith("tour")}>Show me around</button>
              </>
            )}
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function WelcomeStep({ device }: { device: string }) {
  return (
    <div className={styles.step}>
      <h2 id="native-setup-title" className={styles.title}>Let&rsquo;s make HivemindOS useful.</h2>
      <p id="native-setup-description" className={styles.lede}>Setup prepares a private workspace on this {device}, finds AI helpers you already use, and starts the local bridge that lets the dashboard talk to them.</p>
      <ul className={styles.caps}>
        <li className={styles.cap}><span className={styles.capIcon}><IconLaptop /></span><span className={styles.capText}><strong>Simple local start</strong><small>Only this {device} is selected by default. Add other computers whenever you are ready.</small></span></li>
        <li className={styles.cap}><span className={styles.capIcon}><IconBrain /></span><span className={styles.capText}><strong>Your own workspace</strong><small>Memories, skills, and work stay in local files you control.</small></span></li>
        <li className={styles.cap}><span className={styles.capIcon}><IconShield /></span><span className={styles.capText}><strong>You choose every extra</strong><small>Research downloads, public Code Proof registration, and multi-computer networking start off.</small></span></li>
      </ul>
    </div>
  );
}

function SetupStep({
  device,
  mode,
  setMode,
  readyAgents,
  laterAgents,
  installWebResearch,
  setInstallWebResearch,
  enableCodeProof,
  setEnableCodeProof,
  status,
  runError,
  onScan,
}: {
  device: string;
  mode: InstallMode;
  setMode: (mode: InstallMode) => void;
  readyAgents: NativeDetectedAgentRuntime[];
  laterAgents: NativeDetectedAgentRuntime[];
  installWebResearch: boolean;
  setInstallWebResearch: (enabled: boolean) => void;
  enableCodeProof: boolean;
  setEnableCodeProof: (enabled: boolean) => void;
  status: NativeSetupStatus;
  runError: string;
  onScan: () => void | Promise<void>;
}) {
  return (
    <div className={styles.step}>
      <h2 id="native-setup-title" className={`${styles.title} ${styles.sm}`}>Choose what to set up.</h2>
      <p id="native-setup-description" className={styles.lede}>The safe, simplest choices are already selected. You can change any of this later in Settings.</p>

      <ul className={styles.plan} aria-label="What the standard setup does">
        <PlanRow icon={<IconWrench />} label="Prepare HivemindOS" detail="Downloads only the pinned files and required local helpers." />
        <PlanRow icon={<IconBrain />} label="Create your private workspace" detail={`Stores local memory, skills, and work files on this ${device}.`} />
        <PlanRow icon={<IconMesh />} label="Connect helpers already here" detail={readyAgents.length ? `${readyAgents.length} detected AI helper${readyAgents.length === 1 ? "" : "s"} will be connected.` : "No AI helper was detected yet; you can add one later."} />
        <PlanRow icon={<IconPulse />} label="Start the local agent bridge" detail="Keeps dashboard-to-agent traffic on this computer in local-only mode." />
      </ul>

      <fieldset className={styles.fieldset}>
        <legend>Where to connect</legend>
        <div className={styles.choices} role="radiogroup" aria-label="Computer connection mode">
          <button type="button" role="radio" aria-checked={mode === "local"} className={styles.choice} data-sel={mode === "local" ? "true" : undefined} onClick={() => setMode("local")}>
            <span className={styles.choiceIcon}><IconLaptop /></span><span className={styles.choiceBody}><span className={styles.choiceHead}><strong>Only this {device}</strong><span className={styles.badge}>Simplest</span></span><small>No multi-computer network. You can add one later.</small></span><span className={styles.radio} aria-hidden="true"><i /></span>
          </button>
          <button type="button" role="radio" aria-checked={mode !== "local"} className={styles.choice} data-sel={mode !== "local" ? "true" : undefined} onClick={() => setMode(mode === "system-tailscale" ? "system-tailscale" : "link")}>
            <span className={styles.choiceIcon}><IconMesh /></span><span className={styles.choiceBody}><span className={styles.choiceHead}><strong>Connect my other computers</strong></span><small>Uses Hivemind Link, an app-managed private connection. Sign-in may be required.</small></span><span className={styles.radio} aria-hidden="true"><i /></span>
          </button>
        </div>
        {mode !== "local" ? (
          <button type="button" className={styles.adv} role="switch" aria-checked={mode === "system-tailscale"} onClick={() => setMode(mode === "system-tailscale" ? "link" : "system-tailscale")}>
            <span className={styles.toggle} data-on={mode === "system-tailscale" ? "true" : undefined} aria-hidden="true"><i /></span>
            <span className={styles.advText}><strong>Use my full system Tailscale instead</strong><small>Advanced: also enables Tailscale SSH and optional file-sync tools.</small></span>
          </button>
        ) : null}
      </fieldset>

      <section className={styles.helperGroups} aria-labelledby="detected-helpers-title">
        <h3 id="detected-helpers-title">AI helpers on this {device}</h3>
        <HelperGroup label="Ready to connect" agents={readyAgents} empty="None detected yet. Setup still works, and you can add a helper later." />
        {laterAgents.length ? <HelperGroup label="Can add later" agents={laterAgents} /> : null}
        <button className={`${styles.btn} ${styles.text} ${styles.scan}`} type="button" onClick={() => void onScan()}><IconRefresh /> Scan again</button>
      </section>

      <fieldset className={styles.fieldset}>
        <legend>Optional extras — off by default</legend>
        <button type="button" className={styles.adv} role="switch" aria-checked={installWebResearch} onClick={() => setInstallWebResearch(!installWebResearch)}>
          <span className={styles.toggle} data-on={installWebResearch ? "true" : undefined} aria-hidden="true"><i /></span>
          <span className={styles.advText}><strong>Install web research tools</strong><small>Downloads a pinned local search and browser runtime from package sources. Using it later can contact websites you ask it to visit.</small></span>
        </button>
        <button type="button" className={styles.adv} role="switch" aria-checked={enableCodeProof} onClick={() => setEnableCodeProof(!enableCodeProof)}>
          <span className={styles.toggle} data-on={enableCodeProof ? "true" : undefined} aria-hidden="true"><i /></span>
          <span className={styles.advText}><strong>Enable public Code Proof</strong><small>Downloads GitLawb, creates a local identity, and publishes its public ID to the GitLawb network. Private keys stay on this {device}.</small></span>
        </button>
      </fieldset>

      <details className={styles.detail}>
        <summary className={styles.detailSummary}>Technical details</summary>
        <div className={styles.detailBody}>
          <p>App version: <code>{status.app_version ?? "unknown"}</code></p>
          <p>Pinned setup source: <code>{status.setup_source_ref ?? "this installed build"}</code></p>
          <p>Local bridge: <code>127.0.0.1:8787</code></p>
          <p>Setup may download Node.js and required HivemindOS helpers if this computer does not already have them.</p>
        </div>
      </details>
      {runError ? <p className={styles.error} role="alert">{runError}</p> : null}
    </div>
  );
}

function PlanRow({ icon, label, detail }: { icon: ReactElement; label: string; detail: string }) {
  return <li className={styles.planRow}><span className={styles.hex}>{icon}</span><span className={styles.planText}><strong>{label}</strong><small>{detail}</small></span></li>;
}

function HelperGroup({ label, agents, empty }: { label: string; agents: NativeDetectedAgentRuntime[]; empty?: string }) {
  return (
    <div className={styles.helperGroup}>
      <p>{label}</p>
      {agents.length ? (
        <ul className={styles.agentChips}>
          {agents.map((agent) => <li className={styles.agentChip} data-found={agent.installed ? "true" : "false"} key={agent.id}><AgentIcon agent={agent} /><span>{agent.label}</span>{agent.installed ? <IconCheck width="13" height="13" /> : null}</li>)}
        </ul>
      ) : <small>{empty}</small>}
    </div>
  );
}

function RunningStep({ filled, meterPct, settled, phaseLabel, activity, runStatus, commandPreview, isWindows, copied, onCopy }: {
  filled: number;
  meterPct: number;
  settled: boolean;
  phaseLabel: string;
  activity: string[];
  runStatus: string;
  commandPreview: string;
  isWindows: boolean;
  copied: boolean;
  onCopy: (value: string) => void;
}) {
  return (
    <div className={styles.run} aria-busy={!settled}>
      <div className={styles.emblem} aria-hidden="true">
        {Array.from({ length: EMBLEM_CELLS }).map((_, index) => {
          const state = index < filled ? "done" : index === filled && !settled ? "active" : settled ? "done" : "idle";
          return <span key={index} className={`${styles.cell} ${styles[`c${index}`]}`} data-state={state}><IconCheck /></span>;
        })}
      </div>
      <div className={styles.runMeta} role={settled ? "status" : undefined} aria-live="polite">
        <span className={styles.liveTag}><span className={styles.liveDot} /> Setting up this computer</span>
        <h2 id="native-setup-title" className={`${styles.title} ${styles.sm}`}>{phaseLabel}</h2>
        <p id="native-setup-description" className={styles.srStatus}>{Math.max(meterPct, 8)} percent complete</p>
      </div>
      <div className={styles.meter} role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={settled ? 100 : Math.max(meterPct, 8)}><i style={{ width: `${settled ? 100 : Math.max(meterPct, 8)}%` }} /></div>
      <div className={styles.log} role="log" aria-live="polite" aria-relevant="additions text">
        {(activity.length ? activity : ["Starting setup…"]).map((line, index) => <div className={styles.logLine} key={`${index}-${line}`}><span className={index === activity.length - 1 && !settled ? styles.logRun : styles.logDim}>{line}</span></div>)}
        {settled ? <div className={styles.logLine}><span className={styles.logOk}>✓ Local agent bridge is online</span></div> : null}
      </div>
      <p className={styles.lede} style={{ fontSize: 12.5, textAlign: "center" }} role={runStatus.includes("attention") || runStatus.includes("stopped") ? "alert" : "status"}>{runStatus}</p>
      <details className={styles.detail}>
        <summary className={styles.detailSummary}>Technical details and manual repair</summary>
        <div className={styles.detailBody}>
          <p>If setup cannot run here, paste this into {isWindows ? "PowerShell" : "Terminal"}:</p>
          <pre className={styles.pre}>{commandPreview}</pre>
          <button className={styles.copy} type="button" data-done={copied ? "true" : undefined} onClick={() => onCopy(commandPreview)}>{copied ? <IconCheck width="13" height="13" /> : <IconCopy />}{copied ? "Copied" : "Copy command"}</button>
        </div>
      </details>
    </div>
  );
}

function DoneStep({ device, hasReadyAgent, mode, warnings }: { device: string; hasReadyAgent: boolean; mode: InstallMode; warnings: string[] }) {
  return (
    <div className={`${styles.step} ${styles.center}`}>
      <div className={styles.mkWrap} aria-hidden="true"><span className={styles.mkRing} /><span className={styles.mkRing} data-delay="true" /><span className={styles.mkGlow} /><svg className={styles.mkSvg} viewBox="0 0 52 52" width="62" height="62"><circle className={styles.mkCircle} cx="26" cy="26" r="23" fill="none" stroke="currentColor" strokeWidth="2.4" /><path className={styles.mkTick} d="M15 27 L23 34.5 L38 18" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
      <h2 id="native-setup-title" className={styles.title}>This {device} is ready.</h2>
      <p id="native-setup-description" className={styles.lede}>{hasReadyAgent
        ? "The local agent bridge answered and this setup run finished successfully. Try one small task now, take a short tour, or go straight to the dashboard."
        : "The local agent bridge is online. No AI helper was detected yet, so add your first agent before starting a task."}</p>
      {warnings.length ? (
        <div className={styles.setupWarnings} role="status" aria-label="Optional setup steps that need attention">
          <strong>One optional step is paused</strong>
          {warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}
      {mode !== "local" ? <p className={styles.lede} style={{ fontSize: 12.5 }}>Your private multi-computer connection is prepared. If sign-in is still needed, Fleet will show the next step.</p> : null}
      <p className={styles.agentNote}>Optional integrations, wallets, and financial tools remain off until you choose them from the dashboard.</p>
    </div>
  );
}

const stroke = { fill: "none" as const, stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function IconClose(p: SVGProps<SVGSVGElement>) { return <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} strokeWidth={1.9} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>; }
function IconCheck(p: SVGProps<SVGSVGElement>) { return <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} strokeWidth={2.2} {...p}><path d="M5 12.5 10 17.5 19 7" /></svg>; }
function IconArrow(p: SVGProps<SVGSVGElement>) { return <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>; }
function IconChevL(p: SVGProps<SVGSVGElement>) { return <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} {...p}><path d="M15 6l-6 6 6 6" /></svg>; }
function IconCopy(p: SVGProps<SVGSVGElement>) { return <svg width="13" height="13" viewBox="0 0 24 24" {...stroke} {...p}><rect x="9" y="9" width="11" height="11" rx="2.2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>; }
function IconSpinner(p: SVGProps<SVGSVGElement>) { return <svg className={styles.spin} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" {...p}><path d="M12 3a9 9 0 1 0 9 9" /></svg>; }
function IconRefresh(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><path d="M20 11a8 8 0 1 0-1.6 5M20 5v6h-6" /></svg>; }
function IconLaptop(p: SVGProps<SVGSVGElement>) { return <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} {...p}><rect x="4" y="5" width="16" height="11" rx="2" /><path d="M2.5 20h19M9.5 16h5" /></svg>; }
function IconMesh(p: SVGProps<SVGSVGElement>) { return <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} {...p}><circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="12" cy="18" r="2.4" /><path d="M8.2 7.3 15.8 16.7M15.8 7.3 8.2 16.7M8.4 6h7.2" /></svg>; }
function IconWrench(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><path d="M14.5 6a3.8 3.8 0 0 0 4.9 4.9l-6.3 6.3a2.3 2.3 0 0 1-3.3-3.3z M5 19l3-3" /></svg>; }
function IconPulse(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><path d="M3 12h4l2-6 4 13 2-7h6" /></svg>; }
function IconBrain(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V15a3 3 0 0 0 4 2.8M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V15a3 3 0 0 1-4 2.8M9 4a2.4 2.4 0 0 1 3 0M9 17.8a2.4 2.4 0 0 0 3 0M12 5v13" /></svg>; }
function IconShield(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6z" /></svg>; }
