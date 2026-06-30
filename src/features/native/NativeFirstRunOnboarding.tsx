"use client";

import { useCallback, useEffect, useMemo, useState, type ReactElement, type SVGProps } from "react";
import Image from "next/image";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";
import { NATIVE_SETUP_DEMO_ENABLED, NATIVE_SETUP_RERUN_EVENT, readNativeSetupStatus, runNativeSetup, type NativeDetectedAgentRuntime, type NativeSetupStatus } from "@/lib/native/setup";
import { requestGuidedTour } from "@/lib/native/guided-tour";
import { runtimeIconFallback, runtimeIconPath, runtimeIconRenderMode } from "@/lib/config/runtime-icons";
import { grantNativePrivateFilesystemAccess } from "@/lib/native/dashboard-bootstrap";
import { dashboardStateValue, loadDashboardStateSnapshot, removeDashboardStateValue, saveDashboardStateValue } from "@/lib/services/dashboard-state-client";
import styles from "./NativeFirstRunOnboarding.module.css";

const DISMISS_KEY = "hivemindos.nativeFirstRun.dismissed.v3";
const LEGACY_DISMISS_KEY = "hivemindos.nativeFirstRun.dismissed.v2";
const DISMISS_FALLBACK_KEY = `${DISMISS_KEY}.localFallback`;

const APP_LOGO_PATH = "/hivemindos-logo.png";
const DASHBOARD_URL = "http://localhost:5020";

type InstallMode = "local" | "link" | "system-tailscale";
type WizardStep = "welcome" | "scope" | "agents" | "plan" | "running" | "done";

const ALL_AGENT_IDS = ["codex", "claude", "hermes", "gemini", "openclaw", "aeon"];
const DEMO_RUN_MESSAGES = [
  "Starting setup. If your system needs permission, a Terminal window will open for that part.",
  "Checking selected agents.",
  "Setup has started. Follow any permission prompts that appear.",
];

// Seven honeycomb cells in the running emblem (matches .cell.c0..c6 in the CSS).
const EMBLEM_CELLS = 7;

// "this Mac" / "this PC" / "this computer", from the platform reported by native_setup_status.
function deviceNoun(platform: string | undefined) {
  if (platform === "windows") return "PC";
  if (platform === "macos" || platform === "demo") return "Mac";
  return "computer";
}

function modeCommand(mode: InstallMode) {
  if (mode === "local") return "./setup.sh --local-only";
  if (mode === "system-tailscale") return "./setup.sh --system-tailscale";
  return "./setup.sh --link";
}

type PlanRow = { icon: ReactElement; label: string; detail: string; opt?: boolean };

// The checklist shown on the "plan" step. The optional Link/Tailnet row only
// appears for multi-machine modes, mirroring how setup.sh wires networking.
function planRows(mode: InstallMode): PlanRow[] {
  const rows: PlanRow[] = [
    { icon: <IconNode />, label: "Check Node.js 20+ and pnpm", detail: "required toolchain" },
    { icon: <IconBox />, label: "Install workspace dependencies", detail: "pnpm install" },
    { icon: <IconWrench />, label: "Install hive env helpers", detail: "hive-env-add · hive-transfer · hive-update" },
    { icon: <IconPulse />, label: "Start the machine monitor", detail: "collector · 127.0.0.1:8787" },
  ];
  if (mode !== "local") {
    rows.push(
      mode === "system-tailscale"
        ? { icon: <IconLink />, label: "Join your Tailnet (system Tailscale)", detail: "tailscaled · SSH · Syncthing", opt: true }
        : { icon: <IconLink />, label: "Connect Hivemind Link", detail: "app-managed tailnet · localhost-bound", opt: true },
    );
  }
  rows.push(
    { icon: <IconBrain />, label: "Seed the shared brain & skills", detail: "shared vault + skill shelf" },
    { icon: <IconWindow />, label: "Start the dashboard", detail: DASHBOARD_URL },
  );
  return rows;
}

function agentIconId(agentId: string) {
  if (agentId === "codex" || agentId === "claude" || agentId === "gemini") return "hivemind-os";
  return agentId;
}

function AgentIcon({ agent }: { agent: NativeDetectedAgentRuntime }) {
  const iconId = agentIconId(agent.id);
  const icon = runtimeIconPath(iconId);
  const mode = runtimeIconRenderMode(iconId);
  if (icon && mode === "mask") {
    return <span aria-hidden="true" className="h-4 w-4 bg-current" style={{ WebkitMask: `url(${icon}) center / contain no-repeat`, mask: `url(${icon}) center / contain no-repeat` }} />;
  }
  if (icon) return <Image src={icon} alt="" width={16} height={16} className="h-4 w-4 object-contain" unoptimized />;
  return <span className="grid h-4 w-4 place-items-center rounded-full bg-[rgba(148,163,184,0.18)] text-[0.55rem] font-semibold">{runtimeIconFallback(iconId, agent.label)}</span>;
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
  const [rawStep, setStep] = useState<WizardStep>("welcome");
  const [mode, setMode] = useState<InstallMode>("link");
  const [skillAgents, setSkillAgents] = useState<string[]>(ALL_AGENT_IDS);
  const [memoryAgents, setMemoryAgents] = useState<string[]>(ALL_AGENT_IDS);
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState("");
  const [runError, setRunError] = useState("");
  const [launchedCommand, setLaunchedCommand] = useState("");
  const [copied, setCopied] = useState("");
  // Cosmetic activity indicator for the running emblem. It fills toward (but
  // never reaches) the last cell on a timer, then completes only when the real
  // collector signal lands — see setupSettled below. The cells are decorative
  // (aria-hidden); no per-step claim is made about what setup is doing.
  const [filledCells, setFilledCells] = useState(0);

  const detectedAgents = useMemo(() => status?.detected_agents?.length
    ? status.detected_agents
    : ALL_AGENT_IDS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), installed: false, detail: "Not checked" })),
  [status]);
  const device = deviceNoun(status?.platform);
  const isWindows = status?.platform === "windows";
  const isMac = device === "Mac";
  const scope: "local" | "multi" = mode === "local" ? "local" : "multi";
  const sysTs = mode === "system-tailscale";
  // setup.ps1 ignores mode and import selections, so Windows skips the scope/agents/plan steps.
  const wizardSteps = useMemo<WizardStep[]>(() => isWindows ? ["welcome", "running", "done"] : ["welcome", "scope", "agents", "plan", "running", "done"], [isWindows]);
  const step = wizardSteps.includes(rawStep) ? rawStep : wizardSteps[0];
  const stepIndex = wizardSteps.indexOf(step);
  // The local collector starts only near the END of setup, so its check flips to
  // installed once setup has actually finished. Gate "done" on it — otherwise the
  // success screen would appear the instant setup is *launched* (terminal still
  // mid-install), which reads as "done" when it is not.
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
      void loadDashboardStateSnapshot().then(async (snapshot) => {
        const dismissedInDashboardState = dashboardStateValue(snapshot, DISMISS_KEY) === "1";
        const legacyDismissed = dashboardStateValue(snapshot, LEGACY_DISMISS_KEY) === "1";
        const dismissed = dismissedInDashboardState || locallyDismissed;
        if (legacyDismissed && !dismissed) void removeDashboardStateValue(LEGACY_DISMISS_KEY);
        // Auto-recover: a stale dismiss flag must not permanently suppress setup
        // on a machine that genuinely has no collector. The flag lives in
        // ~/.hivemindos/dashboard-state.json, which survives reinstall + "delete
        // all app data" (those only clear the OS app-data dir) — so a
        // once-dismissed, never-set-up machine could otherwise never re-prompt.
        // Only override when we POSITIVELY read a status whose collector check is
        // not installed; on any read error, honor the dismissal as before.
        if (dismissed) {
          let knownNotInstalled = false;
          try {
            const freshStatus = await readNativeSetupStatus({ demoMode });
            if (freshStatus) {
              knownNotInstalled = !freshStatus.checks?.find((c) => c.id === "collector")?.installed;
            }
          } catch { /* unknown — fall through and honor the dismissal */ }
          if (knownNotInstalled) {
            clearLocalDismissal();
            void removeDashboardStateValue(DISMISS_KEY);
            setOpen(true);
            return;
          }
        }
        setOpen(!dismissed);
        if (dismissed && !dismissedInDashboardState) void saveDashboardStateValue(DISMISS_KEY, "1");
      });
    }, 0);
    return () => window.clearTimeout(handle);
  }, [demoMode, refreshStatus]);

  // While the running step waits for setup to finish, keep refreshing status so
  // the screen flips to "done" the moment the local collector comes up.
  useEffect(() => {
    if (step !== "running" || setupSettled) return;
    if (!demoMode && !isTauriDesktopRuntime()) return;
    const id = window.setInterval(() => { void refreshStatus(); }, 4000);
    return () => window.clearInterval(id);
  }, [step, setupSettled, demoMode, refreshStatus]);

  // Cosmetic emblem fill while setup runs in the terminal (capped one short of
  // full); the real collector signal completes it. The counter is reset to 0
  // when setup is launched (see launchSetup) so re-runs start fresh; here we
  // only ever increment, inside the interval callback.
  useEffect(() => {
    if (step !== "running" || setupSettled) return;
    const id = window.setInterval(() => {
      setFilledCells((current) => Math.min(EMBLEM_CELLS - 1, current + 1));
    }, 1500);
    return () => window.clearInterval(id);
  }, [step, setupSettled]);

  // Once the collector is up, briefly hold the full emblem, then reveal "done".
  useEffect(() => {
    if (step !== "running" || !setupSettled) return;
    const id = window.setTimeout(() => setStep("done"), 720);
    return () => window.clearTimeout(id);
  }, [step, setupSettled]);

  useEffect(() => {
    if (!isTauriDesktopRuntime()) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => listen(NATIVE_SETUP_RERUN_EVENT, () => {
      clearLocalDismissal();
      void removeDashboardStateValue(DISMISS_KEY);
      setStep("welcome");
      setRunStatus("");
      setRunError("");
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

  if (!open || !status) return null;

  // setup.ps1 has no mode/import flags (it detects Tailscale and seeds vault/skills itself),
  // so the Windows backup command mirrors build_setup_invocation in src-tauri/src/setup.rs.
  const commandPreview = isWindows
    ? "powershell -ExecutionPolicy Bypass -File setup.ps1 -SkipDashboard -SkipBuild"
    : `${modeCommand(mode)} ${skillAgents.length ? `--import-skills=${skillAgents.join(",")} --share-skills=all` : "--no-shared-skills"} --skip-dashboard${memoryAgents.length ? `\n./scripts/import-agent-memory.sh --sources ${memoryAgents.join(",")}` : ""}`;

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

  async function launchSetup(): Promise<boolean> {
    setRunError("");
    setFilledCells(0);
    if (demoMode) {
      await launchDemoSetup();
      setLaunchedCommand("demo");
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
      setLaunchedCommand(result.command ?? modeCommand(mode));
      void persistDismissal();
      setRunStatus("Setup has started. Follow any permission prompts that appear.");
      return true;
    }
    setRunError(result?.error ?? "Could not start setup.");
    return false;
  }

  // From the welcome step: Mac/Linux moves into scope selection; Windows (no
  // mode/agents choices) launches immediately and jumps to the running step.
  async function beginSetup() {
    if (isWindows) {
      if (await launchSetup()) setStep("running");
      return;
    }
    setStep("scope");
  }

  async function runFromPlan() {
    if (await launchSetup()) setStep("running");
  }

  function copy(key: string, value: string) {
    try { void navigator.clipboard?.writeText(value); } catch { /* clipboard may be unavailable */ }
    setCopied(key);
    window.setTimeout(() => setCopied((current) => (current === key ? "" : current)), 1600);
  }

  const tone = step === "running" ? "live" : undefined;
  const rows = planRows(mode);
  const filled = step === "running" ? (setupSettled ? EMBLEM_CELLS : filledCells) : 0;
  const meterPct = Math.round((filled / EMBLEM_CELLS) * 100);

  const runLog: Array<{ k: "logOk" | "logRun" | "logDim"; t: string }> = [];
  if (step === "running") {
    runLog.push({ k: "logDim", t: `$ ${(launchedCommand || modeCommand(mode)).split("\n")[0]}` });
    runLog.push({ k: "logOk", t: "✓ setup launched in Terminal" });
    if (setupSettled) {
      runLog.push({ k: "logOk", t: "✓ collector online · 127.0.0.1:8787" });
    } else {
      runLog.push({ k: "logRun", t: "→ waiting for the local agent bridge…" });
    }
  }

  return (
    <div className={styles.stage}>
      <div className={styles.backdrop} aria-hidden="true" />
      <div className={styles.comb} aria-hidden="true" />
      <div className={styles.scrim} aria-hidden="true" />

      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="native-setup-title">
        {step !== "running" ? (
          <button className={styles.close} type="button" aria-label="Dismiss setup" onClick={dismiss}><IconClose /></button>
        ) : null}

        <header className={styles.hero} data-tone={tone}>
          <span className={styles.mark}><Image src={APP_LOGO_PATH} alt="" aria-hidden="true" width={50} height={50} unoptimized /></span>
          <span className={styles.heroText}>
            <span className={styles.eyebrow}>HivemindOS · Setup</span>
            <span className={styles.heroTitle}>Get your hive running</span>
          </span>
          <span className={styles.rail} aria-hidden="true">
            {wizardSteps.map((item, index) => (
              <i key={item} data-on={index <= stepIndex ? "true" : undefined} data-live={step === "running" && item === "running" ? "true" : undefined} />
            ))}
          </span>
        </header>

        <div className={styles.body}>
          {step === "welcome" ? <WelcomeStep /> : null}
          {step === "scope" ? (
            <ScopeStep
              device={device}
              scope={scope}
              sysTs={sysTs}
              onScope={(next) => setMode(next === "local" ? "local" : (sysTs ? "system-tailscale" : "link"))}
              onSysTs={(value) => setMode(value ? "system-tailscale" : "link")}
            />
          ) : null}
          {step === "agents" ? (
            <AgentsStep device={device} agents={detectedAgents} skillAgents={skillAgents} memoryAgents={memoryAgents} onToggle={toggleAgent} />
          ) : null}
          {step === "plan" ? <PlanStep rows={rows} mode={mode} runError={runError} /> : null}
          {step === "running" ? (
            <RunningStep filled={filled} meterPct={meterPct} settled={setupSettled} runLog={runLog} runStatus={runStatus} commandPreview={commandPreview} isWindows={isWindows} copied={copied} onCopy={copy} />
          ) : null}
          {step === "done" ? <DoneStep scope={scope} isMac={isMac} isWindows={isWindows} copied={copied} onCopy={copy} /> : null}
        </div>

        <footer className={styles.foot}>
          {step === "welcome" ? <p className={styles.disclaimer}>Everything runs locally. HivemindOS never opens a public port during setup.</p> : null}
          <div className={styles.footActions}>
            {step === "welcome" ? (
              <>
                <button className={`${styles.btn} ${styles.ghost} ${styles.grow}`} type="button" onClick={dismiss}>Maybe later</button>
                <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => void beginSetup()} disabled={running}>
                  {running ? <><IconSpinner /> Starting…</> : <>Begin setup <IconArrow /></>}
                </button>
              </>
            ) : step === "scope" ? (
              <>
                <button className={`${styles.btn} ${styles.text} ${styles.grow}`} type="button" onClick={() => setStep("welcome")}><IconChevL /> Back</button>
                <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => setStep("agents")}>Continue <IconArrow /></button>
              </>
            ) : step === "agents" ? (
              <>
                <button className={`${styles.btn} ${styles.text} ${styles.grow}`} type="button" onClick={() => setStep("scope")}><IconChevL /> Back</button>
                <button className={`${styles.btn} ${styles.ghost}`} type="button" onClick={() => void refreshStatus()}><IconRefresh /> Scan again</button>
                <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => setStep("plan")}>Continue <IconArrow /></button>
              </>
            ) : step === "plan" ? (
              <>
                <button className={`${styles.btn} ${styles.text} ${styles.grow}`} type="button" onClick={() => setStep("agents")}><IconChevL /> Back</button>
                <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => void runFromPlan()} disabled={running}>
                  {running ? <><IconSpinner /> Starting…</> : <>Run setup <IconArrow /></>}
                </button>
              </>
            ) : step === "running" ? (
              <>
                <button className={`${styles.btn} ${styles.text} ${styles.grow}`} type="button" onClick={dismiss}>Close — finishes in the background</button>
                <button className={`${styles.btn} ${styles.primary}`} type="button" data-tone="live" disabled><IconSpinner /> Working…</button>
              </>
            ) : (
              <>
                <button className={`${styles.btn} ${styles.ghost} ${styles.grow}`} type="button" onClick={dismiss}>I&rsquo;ll explore on my own</button>
                <button className={`${styles.btn} ${styles.primary}`} type="button" data-tone="live" onClick={() => { dismiss(); requestGuidedTour(); }}><IconSparkle /> Show me around</button>
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step views
// ---------------------------------------------------------------------------

function WelcomeStep() {
  return (
    <div className={styles.step}>
      <h2 id="native-setup-title" className={styles.title}>Welcome to the hive.</h2>
      <p className={styles.lede}>
        HivemindOS is one private control room for every agent you run — across this machine and any others you trust.
        Setup takes about a minute and runs entirely on your computer.
      </p>
      <ul className={styles.caps}>
        <li className={styles.cap}><span className={styles.capIcon}><IconMesh /></span><span className={styles.capText}><strong>One comb for every agent</strong><small>Hermes, OpenClaw, Aeon, Codex — all on a single dashboard.</small></span></li>
        <li className={styles.cap}><span className={styles.capIcon}><IconBrain /></span><span className={styles.capText}><strong>A shared Obsidian brain</strong><small>Memory, handoffs, skills, and work boards in one local vault.</small></span></li>
        <li className={styles.cap}><span className={styles.capIcon}><IconShield /></span><span className={styles.capText}><strong>Local-first &amp; private</strong><small>No public ports. Nothing leaves your machines without you.</small></span></li>
      </ul>
    </div>
  );
}

function ScopeStep({ device, scope, sysTs, onScope, onSysTs }: {
  device: string;
  scope: "local" | "multi";
  sysTs: boolean;
  onScope: (next: "local" | "multi") => void;
  onSysTs: (value: boolean) => void;
}) {
  return (
    <div className={styles.step}>
      <h2 id="native-setup-title" className={`${styles.title} ${styles.sm}`}>Where should your hive live?</h2>
      <p className={styles.lede}>You can add more machines later — this just sets how setup wires networking today.</p>
      <div className={styles.choices}>
        <button type="button" className={styles.choice} data-sel={scope === "local" ? "true" : undefined} onClick={() => onScope("local")}>
          <span className={styles.choiceIcon}><IconLaptop /></span>
          <span className={styles.choiceBody}>
            <span className={styles.choiceHead}><strong>Just this {device}</strong></span>
            <small>Local-first. Skips Tailscale entirely — every agent and file stays on this computer.</small>
          </span>
          <span className={styles.radio} aria-hidden="true"><i /></span>
        </button>
        <button type="button" className={styles.choice} data-sel={scope === "multi" ? "true" : undefined} onClick={() => onScope("multi")}>
          <span className={styles.choiceIcon}><IconMesh /></span>
          <span className={styles.choiceBody}>
            <span className={styles.choiceHead}><strong>Across my machines</strong><span className={styles.badge}>Recommended</span></span>
            <small>Connect agents on your other computers over Hivemind Link — an app-managed private link. No public ports.</small>
          </span>
          <span className={styles.radio} aria-hidden="true"><i /></span>
        </button>
      </div>
      {scope === "multi" ? (
        <button type="button" className={styles.adv} onClick={() => onSysTs(!sysTs)}>
          <span className={styles.toggle} role="switch" aria-checked={sysTs} data-on={sysTs ? "true" : undefined}><i /></span>
          <span className={styles.advText}>
            <strong>Use full system Tailscale</strong>
            <small>For Tailscale SSH, rsync repair, and Syncthing brain sync. Otherwise Hivemind Link keeps the collector on localhost.</small>
          </span>
        </button>
      ) : null}
    </div>
  );
}

function AgentsStep({ device, agents, skillAgents, memoryAgents, onToggle }: {
  device: string;
  agents: NativeDetectedAgentRuntime[];
  skillAgents: string[];
  memoryAgents: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className={styles.step}>
      <h2 id="native-setup-title" className={`${styles.title} ${styles.sm}`}>Connect your AI helpers.</h2>
      <p className={styles.lede}>We found these on your {device}. They&rsquo;ll share what they know through the hive — tap one only to leave it out.</p>
      <div className={styles.agents}>
        <div className={styles.agentChips}>
          {agents.map((agent) => {
            const active = skillAgents.includes(agent.id) || memoryAgents.includes(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                className={styles.agentChip}
                data-on={active ? "true" : undefined}
                data-found={agent.installed ? undefined : "false"}
                title={agent.installed ? undefined : `Not found on this ${device}`}
                aria-pressed={active}
                onClick={() => onToggle(agent.id)}
              >
                <AgentIcon agent={agent} />
                <span>{agent.label}</span>
                {active ? <IconCheck width="13" height="13" /> : null}
              </button>
            );
          })}
        </div>
        <p className={styles.agentNote}>Everything is on by default. You can run setup again anytime to change this.</p>
      </div>
    </div>
  );
}

function PlanStep({ rows, mode, runError }: { rows: PlanRow[]; mode: InstallMode; runError: string }) {
  const summary = mode === "local" ? "local-only mode" : mode === "system-tailscale" ? "multi-machine mode · system Tailscale" : "multi-machine mode · Hivemind Link";
  return (
    <div className={styles.step}>
      <h2 id="native-setup-title" className={`${styles.title} ${styles.sm}`}>Here&rsquo;s what setup will do.</h2>
      <p className={styles.lede}>No prompts, no surprises. You can re-run any of this later from the dashboard.</p>
      <ul className={styles.plan}>
        {rows.map((row) => (
          <li className={styles.planRow} key={row.label} data-opt={row.opt ? "true" : undefined}>
            <span className={styles.hex}>{row.icon}</span>
            <span className={styles.planText}><strong>{row.label}</strong><small>{row.detail}</small></span>
          </li>
        ))}
      </ul>
      <div className={styles.summary}>
        <IconShield />
        <span>Running in <b>{summary}</b></span>
      </div>
      {runError ? <p className={styles.error} role="alert">{runError}</p> : null}
    </div>
  );
}

function RunningStep({ filled, meterPct, settled, runLog, runStatus, commandPreview, isWindows, copied, onCopy }: {
  filled: number;
  meterPct: number;
  settled: boolean;
  runLog: Array<{ k: "logOk" | "logRun" | "logDim"; t: string }>;
  runStatus: string;
  commandPreview: string;
  isWindows: boolean;
  copied: string;
  onCopy: (key: string, value: string) => void;
}) {
  const cells = Array.from({ length: EMBLEM_CELLS });
  return (
    <div className={styles.run}>
      <div className={styles.emblem} aria-hidden="true">
        {cells.map((_, i) => {
          const state = i < filled ? "done" : i === filled && !settled ? "active" : settled ? "done" : "idle";
          return <span key={i} className={`${styles.cell} ${styles[`c${i}`]}`} data-state={state}><IconCheck /></span>;
        })}
      </div>
      <div className={styles.runMeta}>
        <span className={styles.liveTag}><span className={styles.liveDot} /> Building your hive</span>
        <h2 id="native-setup-title" className={`${styles.title} ${styles.sm}`}>{settled ? "Hive assembled." : "Setting things up…"}</h2>
      </div>
      <div className={styles.meter}><i style={{ width: `${settled ? 100 : Math.max(meterPct, 8)}%` }} /></div>
      <div className={styles.log}>
        {runLog.map((line, i) => (
          <div className={styles.logLine} key={i}><span className={styles[line.k]}>{line.t}</span></div>
        ))}
      </div>
      <p className={styles.lede} style={{ fontSize: 12.5, textAlign: "center" }}>
        {runStatus || `Setup is running in the ${isWindows ? "PowerShell" : "Terminal"} window — follow any permission prompts. This screen updates on its own when it finishes.`}
      </p>
      <details className={styles.detail}>
        <summary className={styles.detailSummary}>Setup didn&rsquo;t start? Run it yourself</summary>
        <div className={styles.detailBody}>
          <p>Paste this into {isWindows ? "PowerShell" : "the Terminal app"}:</p>
          <pre className={styles.pre}>{commandPreview}</pre>
          <button className={styles.copy} type="button" data-done={copied === "cmd" ? "true" : undefined} onClick={() => onCopy("cmd", commandPreview)}>
            {copied === "cmd" ? <IconCheck width="13" height="13" /> : <IconCopy />}{copied === "cmd" ? "Copied" : "Copy command"}
          </button>
        </div>
      </details>
    </div>
  );
}

function DoneStep({ scope, isMac, isWindows, copied, onCopy }: {
  scope: "local" | "multi";
  isMac: boolean;
  isWindows: boolean;
  copied: string;
  onCopy: (key: string, value: string) => void;
}) {
  return (
    <div className={`${styles.step} ${styles.center}`}>
      <div className={styles.mkWrap} aria-hidden="true">
        <span className={styles.mkRing} /><span className={styles.mkRing} data-delay="true" /><span className={styles.mkGlow} />
        <svg className={styles.mkSvg} viewBox="0 0 52 52" width="62" height="62">
          <circle className={styles.mkCircle} cx="26" cy="26" r="23" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <path className={styles.mkTick} d="M15 27 L23 34.5 L38 18" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 id="native-setup-title" className={styles.title}>Your hive is live.</h2>
      <p className={styles.lede}>
        The dashboard is running locally. HivemindOS finishes up in the background.
        {isMac ? " Your phone can reach this Mac automatically, even when the app is closed — just tap “Allow” on the one-time prompt the first time it opens a file." : ""}
      </p>
      <div className={styles.card}>
        <span className={styles.lead}><span>Dashboard</span><strong>{DASHBOARD_URL}</strong></span>
        <button className={styles.copy} type="button" data-done={copied === "url" ? "true" : undefined} onClick={() => onCopy("url", DASHBOARD_URL)}>
          {copied === "url" ? <IconCheck width="13" height="13" /> : <IconCopy />}{copied === "url" ? "Copied" : "Copy"}
        </button>
      </div>
      {scope === "multi" ? (
        <p className={styles.lede} style={{ fontSize: 12.5, color: "var(--fg-3)" }}>
          Adding another machine? Run <code>{isWindows ? "setup.ps1" : "./setup.sh"}</code> there too and it joins this hive automatically.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline icons (stroke-based, inherit currentColor) — ported from the design.
// ---------------------------------------------------------------------------

const stroke = { fill: "none" as const, stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function IconClose(p: SVGProps<SVGSVGElement>) { return <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} strokeWidth={1.9} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>; }
function IconCheck(p: SVGProps<SVGSVGElement>) { return <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} strokeWidth={2.2} {...p}><path d="M5 12.5 10 17.5 19 7" /></svg>; }
function IconArrow(p: SVGProps<SVGSVGElement>) { return <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>; }
function IconChevL(p: SVGProps<SVGSVGElement>) { return <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} {...p}><path d="M15 6l-6 6 6 6" /></svg>; }
function IconCopy(p: SVGProps<SVGSVGElement>) { return <svg width="13" height="13" viewBox="0 0 24 24" {...stroke} {...p}><rect x="9" y="9" width="11" height="11" rx="2.2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>; }
function IconSpinner(p: SVGProps<SVGSVGElement>) { return <svg className={styles.spin} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" {...p}><path d="M12 3a9 9 0 1 0 9 9" /></svg>; }
function IconRefresh(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><path d="M20 11a8 8 0 1 0-1.6 5M20 5v6h-6" /></svg>; }
function IconSparkle(p: SVGProps<SVGSVGElement>) { return <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} {...p}><path d="M12 3v6M12 15v6M3 12h6M15 12h6M6.5 6.5l3 3M14.5 14.5l3 3M17.5 6.5l-3 3M9.5 14.5l-3 3" /></svg>; }

function IconLaptop(p: SVGProps<SVGSVGElement>) { return <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} {...p}><rect x="4" y="5" width="16" height="11" rx="2" /><path d="M2.5 20h19M9.5 16h5" /></svg>; }
function IconMesh(p: SVGProps<SVGSVGElement>) { return <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} {...p}><circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="12" cy="18" r="2.4" /><path d="M8.2 7.3 15.8 16.7M15.8 7.3 8.2 16.7M8.4 6h7.2" /></svg>; }
function IconNode(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><path d="M12 3 4.5 7v10L12 21l7.5-4V7z M12 12v9M12 12 4.7 7.6M12 12l7.3-4.4" /></svg>; }
function IconBox(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5z M3 8l9 5 9-5M12 13v8" /></svg>; }
function IconWrench(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><path d="M14.5 6a3.8 3.8 0 0 0 4.9 4.9l-6.3 6.3a2.3 2.3 0 0 1-3.3-3.3z M5 19l3-3" /></svg>; }
function IconPulse(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><path d="M3 12h4l2-6 4 13 2-7h6" /></svg>; }
function IconBrain(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V15a3 3 0 0 0 4 2.8M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V15a3 3 0 0 1-4 2.8M9 4a2.4 2.4 0 0 1 3 0M9 17.8a2.4 2.4 0 0 0 3 0M12 5v13" /></svg>; }
function IconWindow(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><rect x="3" y="4" width="18" height="16" rx="2.2" /><path d="M3 8.5h18" /></svg>; }
function IconLink(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><path d="M9.5 14.5 14.5 9.5M8 11 6 13a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2" /></svg>; }
function IconShield(p: SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...p}><path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6z" /></svg>; }
