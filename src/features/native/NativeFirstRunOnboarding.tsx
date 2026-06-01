"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Check, ChevronLeft, Clipboard, Copy, HelpCircle, LoaderCircle, Network, RefreshCcw, ShieldCheck, Sparkles, Terminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { readNativeSetupStatus, runNativeSetup, type NativeDetectedAgentRuntime, type NativeSetupStatus } from "@/lib/native/setup";
import { runtimeIconFallback, runtimeIconPath, runtimeIconRenderMode } from "@/lib/config/runtime-icons";

const DISMISS_KEY = "hivemindos.nativeFirstRun.dismissed.v2";

type InstallMode = "local" | "link" | "system-tailscale";
type WizardStep = "mode" | "agents" | "services" | "run";

const ALL_AGENT_IDS = ["codex", "claude", "hermes", "gemini", "openclaw", "aeon"];

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
    detail: "Your devices share memories, skills, and env inside HivemindOS, without a separate folder sync app.",
    highlights: ["Easiest multi-device", "No folder sync app"],
    capabilities: ["Share across devices", "HivemindOS handles the link", "No always-on vault folder sync"],
    info: "Best default for most people. HivemindOS manages remote app access through its private bridge, so you can add machines without first configuring Tailscale, Syncthing, SSH, or background sync services. It does not install Syncthing-style always-on vault folder sync.",
    command: "./setup.sh --link",
  },
  {
    id: "system-tailscale",
    title: "Full Tailnet Hive",
    detail: "Your devices share memories, skills, and env inside HivemindOS, plus always-on vault folder sync.",
    highlights: ["Most complete", "Always-on sync"],
    capabilities: ["Share across devices", "Sync vault folders", "Best for power users"],
    info: "Choose this if you already use Tailscale or want the full system-level setup: Syncthing folder sync, SSH/env sync, collector services, and persistent remote access between your machines.",
    command: "./setup.sh --system-tailscale",
  },
];

function agentIconId(agentId: string) {
  if (agentId === "codex" || agentId === "claude" || agentId === "gemini") return "openai-compatible";
  return agentId;
}

function AgentIcon({ agent }: { agent: NativeDetectedAgentRuntime }) {
  const iconId = agentIconId(agent.id);
  const icon = runtimeIconPath(iconId);
  const mode = runtimeIconRenderMode(iconId);
  if (icon && mode === "mask") {
    return <span aria-hidden="true" className="h-7 w-7 bg-current" style={{ WebkitMask: `url(${icon}) center / contain no-repeat`, mask: `url(${icon}) center / contain no-repeat` }} />;
  }
  if (icon) return <Image src={icon} alt="" width={28} height={28} className="h-7 w-7 object-contain" unoptimized />;
  return <span className="grid h-7 w-7 place-items-center rounded-md bg-[rgba(148,163,184,0.15)] text-[0.68rem] font-semibold">{runtimeIconFallback(iconId, agent.label)}</span>;
}

function StepDots({ step }: { step: WizardStep }) {
  const steps: WizardStep[] = ["mode", "agents", "services", "run"];
  const activeIndex = steps.indexOf(step);
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {steps.map((item, index) => (
        <span key={item} className={`h-1.5 rounded-full transition-all ${index <= activeIndex ? "w-7 bg-[var(--accent-strong)]" : "w-2 bg-[rgba(148,163,184,0.28)]"}`} />
      ))}
    </div>
  );
}

export function NativeFirstRunOnboarding() {
  const [status, setStatus] = useState<NativeSetupStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>("mode");
  const [mode, setMode] = useState<InstallMode>("link");
  const [skillAgents, setSkillAgents] = useState<string[]>(ALL_AGENT_IDS);
  const [memoryAgents, setMemoryAgents] = useState<string[]>(ALL_AGENT_IDS);
  const [startDashboard, setStartDashboard] = useState(false);
  const [installCollector, setInstallCollector] = useState(true);
  const [buildDashboard, setBuildDashboard] = useState(false);
  const [installDeps, setInstallDeps] = useState(true);
  const [force, setForce] = useState(false);
  const [infoCard, setInfoCard] = useState("");
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState("");
  const [stepHeight, setStepHeight] = useState<number | null>(null);
  const stepContentRef = useRef<HTMLDivElement | null>(null);

  const detectedAgents = useMemo(() => status?.detected_agents?.length
    ? status.detected_agents
    : ALL_AGENT_IDS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), installed: false, detail: "Not checked" })),
  [status]);
  const selectedMode = INSTALL_MODES.find((item) => item.id === mode) ?? INSTALL_MODES[1];

  async function refreshStatus() {
    if (!isTauriDesktopRuntime()) return;
    const next = await readNativeSetupStatus();
    setStatus(next);
    const installed = next?.detected_agents?.filter((agent) => agent.installed).map((agent) => agent.id) ?? [];
    if (installed.length > 0) {
      setSkillAgents((current) => current.length === ALL_AGENT_IDS.length ? installed : current);
      setMemoryAgents((current) => current.length === ALL_AGENT_IDS.length ? installed : current);
    }
  }

  useEffect(() => {
    if (!isTauriDesktopRuntime()) return;
    const handle = window.setTimeout(() => {
      const dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
      setOpen(!dismissed);
      void refreshStatus();
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

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
  }, [open, step, infoCard, status, skillAgents, memoryAgents, startDashboard, installCollector, buildDashboard, installDeps, force, running, runStatus]);

  if (!open || !status) return null;

  const serviceOptions: Array<{
    id: string;
    title: string;
    detail: string;
    active: boolean;
    setActive: (value: boolean) => void;
  }> = [
    {
      id: "installCollector",
      title: "Let HivemindOS talk to local agents",
      detail: "Adds or refreshes the small background bridge that lets the app see local agent activity.",
      active: installCollector,
      setActive: setInstallCollector,
    },
    {
      id: "startDashboard",
      title: "Open the browser dashboard too",
      detail: "Useful when you are developing from the repo. Most native app installs can leave this off.",
      active: startDashboard,
      setActive: setStartDashboard,
    },
    {
      id: "buildDashboard",
      title: "Refresh the web dashboard build",
      detail: "Only needed when preparing a browser/web build from source. The native app already includes its UI.",
      active: buildDashboard,
      setActive: setBuildDashboard,
    },
    {
      id: "installDeps",
      title: "Install missing project pieces",
      detail: "Lets setup install or refresh required packages when something is missing.",
      active: installDeps,
      setActive: setInstallDeps,
    },
    {
      id: "force",
      title: "Redo setup checks from scratch",
      detail: "Use this when something feels stuck or you want setup to refresh work it previously skipped.",
      active: force,
      setActive: setForce,
    },
  ];

  const commandPreview = `${selectedMode.command} ${skillAgents.length ? `--import-skills=${skillAgents.join(",")} --share-skills=all` : "--no-shared-skills"}${installCollector ? "" : " --skip-collector"}${startDashboard ? "" : " --skip-dashboard"}${buildDashboard ? " --build" : ""}${installDeps ? "" : " --skip-deps"}${force ? " --force" : ""}${memoryAgents.length ? `\n./scripts/import-agent-memory.sh --sources ${memoryAgents.join(",")}` : ""}`;

  function toggleSelection(kind: "skills" | "memory", id: string) {
    const setter = kind === "skills" ? setSkillAgents : setMemoryAgents;
    setter((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
  }

  async function launchSetup() {
    setRunning(true);
    setRunStatus("Starting setup. If your system needs permission, a Terminal window will open for that part.");
    const result = await runNativeSetup({
      installMode: mode,
      skillAgents,
      memoryAgents,
      importSkills: skillAgents.length > 0,
      importMemory: memoryAgents.length > 0,
      startDashboard,
      installCollector,
      buildDashboard,
      installDeps,
      force,
    });
    setRunning(false);
    setRunStatus(result?.ok ? "Setup has started. Follow any permission prompts that appear." : result?.error ?? "Could not start setup.");
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
      <section className="w-full max-w-4xl overflow-hidden rounded-lg border border-[rgba(148,163,184,0.20)] bg-[rgba(8,13,22,0.96)] text-[var(--foreground)] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[rgba(148,163,184,0.14)] p-5">
          <div className="flex min-w-0 gap-4">
            <Image src="/hivemindos-logo.png" alt="" width={56} height={56} className="h-14 w-14 rounded-lg object-cover" unoptimized />
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[rgba(45,212,191,0.26)] bg-[rgba(20,184,166,0.12)] px-2.5 py-1 text-xs font-medium text-[var(--accent-strong)]">
                <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
                Native setup
              </div>
              <h2 className="text-2xl font-semibold tracking-normal">Welcome to the HivemindOS</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">How would you like to install the hive?</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StepDots step={step} />
            <CloseIconButton aria-label="Dismiss native setup" onClick={dismiss} />
          </div>
        </header>

        <div className="native-setup-step-shell p-5" style={stepHeight === null ? undefined : { height: `${stepHeight + 40}px` }}>
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
                    <span key={agent.id} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${agent.installed ? "border-[rgba(45,212,191,0.35)] bg-[rgba(20,184,166,0.11)]" : "border-[rgba(148,163,184,0.16)] bg-[rgba(15,23,42,0.38)] opacity-70"}`}>
                      <AgentIcon agent={agent} />
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
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {detectedAgents.map((agent) => {
                        const active = selected.includes(agent.id);
                        return (
                          <button key={`${kind}-${agent.id}`} type="button" className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-all ${active ? "border-[rgba(45,212,191,0.58)] bg-[rgba(20,184,166,0.13)]" : "border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.28)]"}`} onClick={() => toggleSelection(kind, agent.id)}>
                            <AgentIcon agent={agent} />
                            <span className="min-w-0 flex-1">{agent.label}</span>
                            {active ? <Check aria-hidden="true" className="h-4 w-4 text-[var(--accent-strong)]" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {step === "services" ? (
            <div className="grid gap-3">
              {serviceOptions.map((option) => (
                <button key={option.id} type="button" className={`rounded-lg border p-4 text-left transition-all ${option.active ? "border-[rgba(45,212,191,0.58)] bg-[rgba(20,184,166,0.13)]" : "border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.42)]"}`} onClick={() => option.setActive(!option.active)}>
                  <div className="flex min-h-24 flex-col justify-between gap-4">
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="text-base font-semibold">{option.title}</h3>
                      {option.active ? <Check aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--accent-strong)]" /> : null}
                    </div>
                    <p className="text-sm leading-6 text-[var(--muted)]">{option.detail}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {step === "run" ? (
            <div className="rounded-lg border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.46)] p-5">
              <div className="flex items-center gap-3">
                <Network aria-hidden="true" className="h-6 w-6 text-[var(--accent-strong)]" />
                <div>
                  <h3 className="text-lg font-semibold">Ready to set up the hive</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">HivemindOS will handle the setup work it can. If your computer requires permission, we open Terminal only for that approval step.</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.32)] p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles aria-hidden="true" className="h-4 w-4 text-[var(--accent-strong)]" />We do the setup</div>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">The app prepares the selected install path and imports.</p>
                </div>
                <div className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.32)] p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold"><Terminal aria-hidden="true" className="h-4 w-4 text-[var(--accent-strong)]" />Approve if asked</div>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Terminal appears only when your computer needs visible permission.</p>
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
          </div>
        </div>

        <footer className="flex flex-col gap-3 border-t border-[rgba(148,163,184,0.14)] p-5 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" disabled={step === "mode"} onClick={() => setStep(step === "run" ? "services" : step === "services" ? "agents" : "mode")}>
            <ChevronLeft aria-hidden="true" />
            Back
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={() => void refreshStatus()}>
              <RefreshCcw aria-hidden="true" />
              Rescan
            </Button>
            {step !== "run" ? (
              <Button type="button" onClick={() => setStep(step === "mode" ? "agents" : step === "agents" ? "services" : "run")}>
                <Sparkles aria-hidden="true" />
                Continue
              </Button>
            ) : (
              <Button type="button" onClick={() => void launchSetup()} disabled={running}>
                {running ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Clipboard aria-hidden="true" />}
                Start setup
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={dismiss}>
              <X aria-hidden="true" />
              Skip
            </Button>
          </div>
        </footer>
      </section>
      <style jsx>{`
        .native-setup-step-shell {
          overflow: hidden;
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
