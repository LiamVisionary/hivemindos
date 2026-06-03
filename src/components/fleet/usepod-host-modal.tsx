"use client";

import Image from "next/image";
import * as React from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BatteryCharging,
  Check,
  Clock,
  Copy,
  Gauge,
  Globe,
  LoaderCircle,
  Monitor,
  Moon,
  Pause,
  Play,
  RefreshCcw,
  ShieldCheck,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { Button } from "@/components/ui/button";
import { CopyableCodeLine } from "@/components/ui/copyable-code-line";
import { USEPOD_PROVIDER_BOND_USDC, USEPOD_PROVIDER_EARN_SHARE, USEPOD_SUPPLY_MATRIX } from "@/lib/config/usepod-features";
import type { FleetMachine } from "./fleet-data";
import styles from "./usepod-host-modal.module.css";

const USEPOD_RUNTIME_ICON_PATH = "/icons/runtimes/usepod.webp";
const USEPOD_HOST_DEFAULT_INPUT_USD_PER_1M = 0.5;
const USEPOD_HOST_DEFAULT_OUTPUT_USD_PER_1M = 0.75;
const USEPOD_HOST_WHEN_OPTIONS: { id: UsePodHostWhen; icon: LucideIcon; label: string }[] = [
  { id: "idle", icon: Moon, label: "Idle only" },
  { id: "always", icon: Zap, label: "Always" },
  { id: "sched", icon: Clock, label: "Scheduled" },
];

type UsePodHostSetupAction = "status" | "install" | "preflight" | "run" | "setup" | "pair-status";

type UsePodProviderStatus = "ready" | "funded" | "needs-bond" | "failed";
type UsePodPostSetupStage = "success" | "configure" | "live";
type UsePodHostWhen = "idle" | "always" | "sched";

type UsePodRelayListing = {
  id: string;
  name?: string;
  providerModelId: string;
  backendKind?: string;
  inputPer1m: number;
  outputPer1m: number;
};

type UsePodProviderConfig = {
  markdown: number;
  maxConcurrency: number;
  hostWhen: UsePodHostWhen;
  dailyCapUsd: number | null;
  pauseOnBattery: boolean;
  yieldToUser: boolean;
};

type UsePodProviderPreflight = {
  status?: UsePodProviderStatus;
  message?: string;
  walletAddress?: string;
  bondAmountUsdc?: number;
  balanceUsdc?: number;
  depositCode?: string;
};

type UsePodHostBackendContext = {
  kind?: string;
  label: string;
  host: string;
  reachable: boolean;
  message: string;
};

type UsePodHostContext = {
  backend: UsePodHostBackendContext;
  models: UsePodRelayListing[];
  config?: UsePodProviderConfig;
  payoutWallet?: string;
  bondAmountUsdc?: number;
  earnShare?: number;
  agentConfigPath?: string;
  profileStatus?: string;
  run?: {
    status?: "starting" | "running" | "failed";
    error?: string;
    output?: string;
    startedAt?: number;
  };
};

type UsePodHostSetupResponse = {
  ok?: boolean;
  error?: string;
  status?: { installed?: boolean; version?: string } | "starting" | "waiting" | "paired" | "failed" | "idle" | UsePodProviderStatus;
  provider?: UsePodProviderPreflight;
  pairingCode?: string;
  pairingUrl?: string;
  claim?: {
    status?: "claimed" | "missing-token" | "failed";
    message?: string;
    enrolled?: boolean;
    walletAddress?: string;
  } | null;
  run?: {
    status?: "starting" | "running" | "failed";
    error?: string;
    output?: string;
    startedAt?: number;
  };
  context?: UsePodHostContext;
  output?: string;
  startedAt?: number;
};

const HOST_SETUP_STEPS = [
  { label: "Install", detail: "Provider agent" },
  { label: "Bond", detail: "Operator stake" },
  { label: "Pair", detail: "Machine identity" },
  { label: "Ready", detail: "Provider setup" },
] as const;

function cx(...names: Array<string | false | null | undefined>) {
  return names
    .filter(Boolean)
    .map((name) => (styles as Record<string, string>)[name as string] ?? name)
    .join(" ");
}

function advertisedListUsd(base: number, markdown: number) {
  return base * Math.max(0.2, 1 - markdown / 100);
}

function shortAddress(value: string) {
  if (!value) return "Not set";
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function Hex({
  size = 46,
  fill = "rgba(8,12,19,0.9)",
  stroke = "rgba(94,234,212,0.4)",
  strokeW = 1.3,
  glow = "var(--cyan-glow)",
  className,
  style,
  children,
}: {
  size?: number;
  fill?: string;
  stroke?: string;
  strokeW?: number;
  glow?: string | null;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <span className={className} style={{ position: "relative", width: size, height: size, display: "inline-grid", placeItems: "center", flex: "0 0 auto", ...style }}>
      <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", filter: glow ? `drop-shadow(0 0 9px ${glow})` : undefined }} aria-hidden="true">
        <polygon points="50,2 92,26 92,74 50,98 8,74 8,26" fill={fill} />
        <polygon points="50,2 92,26 92,74 50,98 8,74 8,26" fill="none" stroke={stroke} strokeWidth={strokeW} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {children ? <span style={{ position: "relative", zIndex: 1, display: "grid", placeItems: "center" }}>{children}</span> : null}
    </span>
  );
}

function UsePodSuccessPanel({ machineName, onBegin }: { machineName: string; onBegin: () => void }) {
  const [inView, setInView] = React.useState(false);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setInView(true), 820);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <div className={cx("up-body")} style={{ paddingTop: 10 }}>
      <div className={cx("rp-done")}>
        <div className={cx("rp-done-mark")}>
          <span className={cx("ring")} />
          <span className={cx("ring", "d2")} />
          <Hex className={cx("rp-done-hex")} size={96} fill="rgba(45,212,191,0.10)" stroke="rgba(94,234,212,0.7)" strokeW={1.6} glow="var(--cyan-glow)">
            <span className={cx("rp-check")}><Check width={46} height={46} style={{ color: "var(--cyan-2)" }} /></span>
          </Hex>
        </div>
        <div className={cx("rp-done-text", inView && "in")}>
          <span className={cx("up-eyebrow")}>Setup complete</span>
          <h3>{machineName} can now earn on its spare compute!</h3>
          <p>UsePod is configured on this machine. Review how it hosts, then go live to start receiving compute jobs.</p>
          <button className={cx("up-btn", "primary")} type="button" onClick={onBegin}>
            <Play />Begin hosting &amp; start earning
          </button>
        </div>
      </div>
    </div>
  );
}

function UsePodConfigurePanel({
  backend,
  hardware,
  machineName,
  models,
  payoutWallet,
  markdown,
  setMarkdown,
  concurrency,
  setConcurrency,
  when,
  setWhen,
  guards,
  toggleGuard,
  capOn,
  setCapOn,
  cap,
  setCap,
  bondUsd,
}: {
  backend: UsePodHostBackendContext;
  hardware: string;
  machineName: string;
  models: UsePodRelayListing[];
  payoutWallet: string;
  markdown: number;
  setMarkdown: (value: number) => void;
  concurrency: number;
  setConcurrency: (value: number) => void;
  when: UsePodHostWhen;
  setWhen: (value: UsePodHostWhen) => void;
  guards: { battery: boolean; activity: boolean };
  toggleGuard: (key: "battery" | "activity") => void;
  capOn: boolean;
  setCapOn: (value: boolean) => void;
  cap: number;
  setCap: (value: number) => void;
  bondUsd: number;
}) {
  const [tab, setTab] = React.useState<"pricing" | "controls">("pricing");
  const modelCount = models.length;
  const providerSharePercent = Math.round(USEPOD_PROVIDER_EARN_SHARE * 100);
  const treasurySharePercent = 100 - providerSharePercent;

  return (
    <div className={cx("up-body")} style={{ paddingTop: 16 }}>
      <div className={cx("rp-top")}>
        <div className={cx("up-panel", "accent-cyan", "rp-machine")}>
          <div className={cx("rp-machine-head")}>
            <Hex size={44} stroke="rgba(94,234,212,0.5)"><Monitor width={20} height={20} style={{ color: "var(--cyan-2)" }} /></Hex>
            <div className={cx("rp-machine-id")}>
              <b>{machineName}</b>
              <small>{hardware}</small>
            </div>
          </div>
          <span className={cx("up-eyebrow")}>Connected backend</span>
          <span className={cx("rp-backend")}><span className={cx("bdot")} style={{ background: backend.reachable ? undefined : "var(--rose)" }} /><b>{backend.label}</b><code>{backend.host}</code></span>
          <small className={cx("up-msg")}>{backend.message}</small>
          <div className={cx("rp-row-head")} style={{ marginTop: 2 }}>
            <label>Max concurrency</label>
            <div className={cx("rp-stepper")}>
              <button type="button" onClick={() => setConcurrency(Math.max(1, concurrency - 1))} disabled={concurrency <= 1} aria-label="Fewer">-</button>
              <span className={cx("sv")}>{concurrency}</span>
              <button type="button" onClick={() => setConcurrency(Math.min(8, concurrency + 1))} disabled={concurrency >= 8} aria-label="More">+</button>
            </div>
          </div>
        </div>

        <div className={cx("up-panel", "accent-honey", "rp-earn")}>
          <span className={cx("up-eyebrow", "honey")}>Your cut · {providerSharePercent} / {treasurySharePercent} split</span>
          <div className={cx("rp-splitbar")}><i className={cx("you")} style={{ flex: providerSharePercent }} /><i className={cx("tre")} style={{ flex: treasurySharePercent }} /></div>
          <div className={cx("rp-split-legend")}><span><b>You {providerSharePercent}%</b></span><span>Treasury {treasurySharePercent}%</span></div>
          <div className={cx("rp-earn-big")} style={{ marginTop: 2 }}><b>{modelCount}</b><span>{modelCount === 1 ? "model advertised" : "models advertised"}</span></div>
          <div className={cx("rp-earn-sub")}>
            <div><b>{markdown}%</b><span>below default list</span></div>
            <div><b>{concurrency}</b><span>concurrency</span></div>
          </div>
        </div>
      </div>

      <div className={cx("rp-seg", "rp-tabs")} role="tablist" aria-label="Configure section">
        <button type="button" role="tab" aria-selected={tab === "pricing"} className={cx(tab === "pricing" && "on")} onClick={() => setTab("pricing")}><Wallet />Models &amp; pricing</button>
        <button type="button" role="tab" aria-selected={tab === "controls"} className={cx(tab === "controls" && "on")} onClick={() => setTab("controls")}><ShieldCheck />Limits &amp; controls</button>
      </div>

      {tab === "pricing" ? (
        <div className={cx("up-panel", "accent-cyan")}>
          <div className={cx("rp-row-head")} style={{ marginBottom: 10 }}>
            <span className={cx("up-eyebrow")}>Advertised models · {models.length}</span>
            <span className={cx("val")}>{markdown}% list markdown</span>
          </div>
          <div className={cx("rp-range-wrap")} style={{ marginBottom: 4 }}>
            <div className={cx("rp-range-fill")} style={{ width: `${((markdown - 5) / 35) * 100}%`, background: "linear-gradient(90deg, var(--honey), var(--honey-2))", boxShadow: "0 0 10px var(--honey-glow)" }} />
            <input className={cx("rp-range")} type="range" min={5} max={40} step={1} value={markdown} onChange={(event) => setMarkdown(Number(event.target.value))} aria-label="Bulk markdown" />
          </div>
          <div className={cx("rp-pricehint")} style={{ marginBottom: 12 }}>
            <span>Lower list price → more competitive</span><span>Thinner margin →</span>
          </div>
          <div className={cx("rp-models2")}>
            {models.length ? models.map((model) => (
              <div className={cx("rp-mrow")} key={model.id}>
                <div className={cx("rp-mname")}>
                  <b>{model.name || model.id}</b>
                  <small>{model.backendKind ? `${model.backendKind} -> ` : ""}{model.providerModelId}</small>
                </div>
                <div className={cx("rp-mprice")}>
                  <span className={cx("rp-price")}><b>${advertisedListUsd(USEPOD_HOST_DEFAULT_INPUT_USD_PER_1M, markdown).toFixed(2)}</b><span>in $/M</span></span>
                  <span className={cx("rp-price")}><b>${advertisedListUsd(USEPOD_HOST_DEFAULT_OUTPUT_USD_PER_1M, markdown).toFixed(2)}</b><span>out $/M</span></span>
                  <span className={cx("rp-capok")}><Check />listed</span>
                </div>
              </div>
            )) : (
              <div className={cx("rp-mrow")}>
                <div className={cx("rp-mname")}>
                  <b>No local models detected</b>
                  <small>Start LM Studio or Ollama, then reopen this setup or press Go live after models load.</small>
                </div>
              </div>
            )}
          </div>
          <div className={cx("rp-pricehint")} style={{ marginTop: 10 }}>
            <ShieldCheck width={12} height={12} style={{ color: "var(--fg-4)" }} />
            <span style={{ flex: 1 }}>These are the exact prices written into the UsePod agent config.</span>
          </div>
        </div>
      ) : (
        <div className={cx("up-panel", "rp-share")}>
          <span className={cx("up-eyebrow")} style={{ color: "var(--violet-2)" }}>Local controls</span>
          <div className={cx("rp-row")}>
            <div className={cx("rp-row-head")}><label>Host when</label></div>
            <div className={cx("rp-seg")} role="group" aria-label="Host when">
              {USEPOD_HOST_WHEN_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button key={option.id} type="button" className={cx(when === option.id && "on")} aria-pressed={when === option.id} onClick={() => setWhen(option.id)}>
                    <Icon />{option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className={cx("rp-row")}>
            <div className={cx("rp-row-head")}><label>Daily spend cap</label></div>
            <div className={cx("rp-cap-row")}>
              <button type="button" className={cx("rp-toggle", capOn && "on")} onClick={() => setCapOn(!capOn)} aria-pressed={capOn} style={{ flex: 1 }}>
                <ShieldCheck /><span className={cx("tg-txt")}><b>Cap daily earnings</b><small>Drop out of routing past the cap</small></span><span className={cx("rp-switch")} />
              </button>
              <span className={cx("rp-cap-input")}><span>$</span><input type="number" min={1} value={cap} disabled={!capOn} onChange={(event) => setCap(Number(event.target.value))} aria-label="Daily cap USDC" /><span>USDC</span></span>
            </div>
          </div>
          <div className={cx("rp-row")}>
            <div className={cx("rp-row-head")}><label>Guardrails</label></div>
            <div className={cx("rp-toggles")}>
              <button type="button" className={cx("rp-toggle", guards.battery && "on")} onClick={() => toggleGuard("battery")} aria-pressed={guards.battery}>
                <BatteryCharging /><span className={cx("tg-txt")}><b>Pause on battery</b><small>Only host on AC power</small></span><span className={cx("rp-switch")} />
              </button>
              <button type="button" className={cx("rp-toggle", guards.activity && "on")} onClick={() => toggleGuard("activity")} aria-pressed={guards.activity}>
                <Activity /><span className={cx("tg-txt")}><b>Yield to me</b><small>Pause when I&apos;m active</small></span><span className={cx("rp-switch")} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={cx("rp-status")}>
        <span className={cx("rp-chip")}><ShieldCheck /><b>${bondUsd}</b> bond posted</span>
        <span className={cx("rp-chip")}><Globe />outbound-only · <b>no open ports</b></span>
        <span className={cx("rp-chip")}><Wallet />payout <b>{payoutWallet}</b></span>
      </div>
    </div>
  );
}

function UsePodLivePanel({ context, concurrency, when }: { context: UsePodHostContext | null; concurrency: number; when: UsePodHostWhen }) {
  const run = context?.run;
  const startedAt = run?.startedAt ? new Date(run.startedAt) : null;
  const outputLines = (run?.output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3);
  const bars = [40, 70, 95, 60, 85, 50, 75];

  return (
    <div className={cx("up-body")} style={{ paddingTop: 16 }}>
      <div className={cx("rp-live")}>
        <div className={cx("rp-live-hero")}>
          <span className={cx("rp-live-eyebrow")}><span className={cx("dot", "live")} style={{ color: "var(--cyan)" }} />UsePod provider · {run?.status || "running"}</span>
          <div className={cx("rp-ticker")}>{context?.models.length ?? 0}<span className={cx("unit")}>models live</span></div>
          <div className={cx("rp-spark")}>{bars.map((height, index) => <i key={index} style={{ height: `${height}%`, animationDelay: `${index * 0.13}s` }} />)}</div>
          <div className={cx("rp-live-meta")}>{context?.backend.label || "Local backend"} · {startedAt ? `started ${startedAt.toLocaleTimeString()}` : "process started"}</div>
        </div>
        <div className={cx("rp-jobs")}>
          {outputLines.length ? outputLines.map((line, index) => (
            <div className={cx("rp-job")} key={`${line}-${index}`}>
              <span className={cx("jdot")} />
              <span className={cx("jmid")}><b>usepod-agent</b><small>{line}</small></span>
            </div>
          )) : (
            <div className={cx("rp-job")}>
              <span className={cx("jdot")} />
              <span className={cx("jmid")}><b>Waiting for first coordinator event</b><small>The provider process is running and connected output will appear here.</small></span>
            </div>
          )}
        </div>
        <div className={cx("rp-status")}>
          <span className={cx("rp-chip")}><Gauge /><b>{concurrency}</b> concurrent · {when}</span>
          <span className={cx("rp-chip")}><Globe />outbound-only</span>
          <span className={cx("rp-chip")}><Wallet />payout <b>{shortAddress(context?.payoutWallet || "")}</b></span>
        </div>
      </div>
    </div>
  );
}

export function UsePodHostModal({ machine, onClose }: { machine: FleetMachine; onClose: () => void }) {
  const provider = USEPOD_SUPPLY_MATRIX["provider-agent"];
  const keyRelay = USEPOD_SUPPLY_MATRIX["key-relay"];
  const commands = provider.commands ?? [];
  const [setupStarted, setSetupStarted] = React.useState(false);
  const [setupRunning, setSetupRunning] = React.useState(false);
  const [setupStep, setSetupStep] = React.useState(0);
  const [setupMessage, setSetupMessage] = React.useState("");
  const [setupError, setSetupError] = React.useState("");
  const [pairingCode, setPairingCode] = React.useState("");
  const [pairingUrl, setPairingUrl] = React.useState("");
  const [pairingClaim, setPairingClaim] = React.useState("");
  const [manualFallbackAvailable, setManualFallbackAvailable] = React.useState(false);
  const [hostingRunning, setHostingRunning] = React.useState(false);
  const [hostingStarted, setHostingStarted] = React.useState(false);
  const [providerPreflight, setProviderPreflight] = React.useState<UsePodProviderPreflight | null>(null);
  const [hostContext, setHostContext] = React.useState<UsePodHostContext | null>(null);
  const [postSetupStage, setPostSetupStage] = React.useState<UsePodPostSetupStage>("success");
  const [hostMarkdown, setHostMarkdown] = React.useState(20);
  const [hostConcurrency, setHostConcurrency] = React.useState(4);
  const [hostWhen, setHostWhen] = React.useState<UsePodHostWhen>("idle");
  const [hostGuards, setHostGuards] = React.useState({ battery: true, activity: true });
  const [hostCapOn, setHostCapOn] = React.useState(false);
  const [hostCap, setHostCap] = React.useState(25);
  const needsFunding = providerPreflight?.status === "needs-bond" || providerPreflight?.status === "funded";
  const providerFunded = providerPreflight?.status === "funded";
  const displayBondUsdc = hostContext?.bondAmountUsdc ?? providerPreflight?.bondAmountUsdc ?? USEPOD_PROVIDER_BOND_USDC;
  const setupComplete = setupStarted && !needsFunding && setupStep >= HOST_SETUP_STEPS.length && !setupRunning;
  const canGoLive = Boolean(hostContext?.backend.reachable && hostContext.models.length);
  const toggleHostGuard = (key: "battery" | "activity") => setHostGuards((current) => ({ ...current, [key]: !current[key] }));
  const hostConfig = React.useMemo<UsePodProviderConfig>(() => ({
    markdown: hostMarkdown,
    maxConcurrency: hostConcurrency,
    hostWhen,
    dailyCapUsd: hostCapOn ? hostCap : null,
    pauseOnBattery: hostGuards.battery,
    yieldToUser: hostGuards.activity,
  }), [hostCap, hostCapOn, hostConcurrency, hostGuards.activity, hostGuards.battery, hostMarkdown, hostWhen]);
  const appliedContextConfigRef = React.useRef(false);
  const applyContextConfig = React.useCallback((context: UsePodHostContext) => {
    if (appliedContextConfigRef.current || !context.config) return;
    appliedContextConfigRef.current = true;
    setHostMarkdown(context.config.markdown);
    setHostConcurrency(context.config.maxConcurrency);
    setHostWhen(context.config.hostWhen);
    setHostCapOn(context.config.dailyCapUsd !== null);
    if (context.config.dailyCapUsd !== null) setHostCap(context.config.dailyCapUsd);
    setHostGuards({
      battery: context.config.pauseOnBattery,
      activity: context.config.yieldToUser,
    });
  }, []);

  const copyCommands = () => {
    void navigator.clipboard.writeText(commands.join("\n")).catch(() => undefined);
  };

  const callSetupAction = async (action: UsePodHostSetupAction, extra?: Record<string, unknown>) => {
    const response = await fetch("/api/usepod/host/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await response.json().catch(() => null) as UsePodHostSetupResponse | null;
    if (!response.ok || !data?.ok) throw new Error(data?.error || `UsePod host ${action} failed.`);
    if (data.context) {
      setHostContext(data.context);
      applyContextConfig(data.context);
    }
    return data;
  };

  const waitForPairingReady = async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      const status = await callSetupAction("pair-status");
      if (status.status === "paired") return status;
      if (status.status === "failed") throw new Error(status.error || "UsePod host setup failed.");
    }
    return null;
  };

  const runProviderPreflight = async () => {
    const preflight = await callSetupAction("preflight", { displayName: `HivemindOS ${machine.name}` });
    setProviderPreflight((previous) => {
      const next = preflight.provider ?? null;
      if (previous?.status === "funded" && next?.status === "needs-bond") {
        return {
          ...previous,
          message: "Funding was detected. HivemindOS will continue after UsePod marks the provider bond active.",
        };
      }
      return next;
    });
    if (preflight.provider?.status === "failed") {
      throw new Error(preflight.provider.message || "UsePod provider preflight failed.");
    }
    return preflight.provider ?? null;
  };

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      runProviderPreflight()
        .then((preflight) => {
          if (cancelled) return;
          setSetupMessage(preflight?.message || "");
        })
        .catch((error) => {
          if (cancelled) return;
          setSetupError(error instanceof Error ? error.message : "UsePod provider preflight failed.");
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startAutomaticSetup = async (options?: { skipPreflight?: boolean }) => {
    setSetupRunning(true);
    setSetupError("");
    setPairingCode("");
    setPairingUrl("");
    setPairingClaim("");
    setManualFallbackAvailable(false);
    try {
      if (!options?.skipPreflight) {
        setSetupMessage("Checking provider wallet...");
        const preflight = await runProviderPreflight();
        if (preflight?.status === "needs-bond" || preflight?.status === "funded") {
          setSetupStarted(false);
          setSetupMessage("");
          return;
        }
      }
      setSetupStarted(true);
      setProviderPreflight(null);
      setSetupStep(0);
      setSetupMessage("Checking provider agent...");
      const status = await callSetupAction("status");
      const agentStatus = typeof status.status === "object" ? status.status : null;
      if (!agentStatus?.installed) {
        setSetupMessage("Installing provider agent...");
        await callSetupAction("install");
      }

      setSetupStep(1);
      setSetupMessage("Creating provider identity and checking provider activation...");
      const setup = await callSetupAction("setup", { displayName: `HivemindOS ${machine.name}` });
      if (setup.pairingCode) setPairingCode(setup.pairingCode);
      if (setup.pairingUrl) setPairingUrl(setup.pairingUrl);
      if (setup.claim?.message) setPairingClaim(setup.claim.message);
      const pairingStatus = typeof setup.status === "string" ? setup.status : "";
      if (pairingStatus === "paired") {
        setSetupStep(4);
        setSetupMessage("Provider setup complete. This Mac is ready to host.");
      } else if (pairingStatus === "needs-bond" || pairingStatus === "funded" || setup.provider?.status === "needs-bond" || setup.provider?.status === "funded") {
        setSetupStarted(false);
        setProviderPreflight(setup.provider ?? null);
        setSetupMessage(setup.provider?.status === "funded"
          ? "UsePod says the operator bond must be active before pairing. Try Continue again in a moment."
          : "");
      } else if (setup.claim?.status === "claimed") {
        setSetupStep(3);
        setSetupMessage("UsePod accepted the machine. Finishing local provider setup...");
        const finalStatus = await waitForPairingReady();
        if (finalStatus?.status === "paired") {
          setSetupStep(4);
          setSetupMessage("Provider setup complete. This Mac is ready to host.");
        } else {
          setSetupMessage("UsePod accepted the machine. The local provider is still finalizing.");
        }
      } else {
        setManualFallbackAvailable(true);
        setSetupMessage(setup.claim?.message || "Automatic claim failed. Manual pairing is available as a fallback.");
      }
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "UsePod host setup failed.");
    } finally {
      setSetupRunning(false);
    }
  };

  const checkProviderFunding = async () => {
    setSetupRunning(true);
    setSetupError("");
    setSetupMessage("");
    try {
      const preflight = await runProviderPreflight();
      if (!preflight) return;
      if (preflight.status === "funded") {
        setSetupMessage(preflight.message || "Funding detected. Continue posts the provider bond.");
        return;
      }
      if (preflight.status === "needs-bond") {
        setSetupMessage(preflight.message || "No provider wallet funding detected yet.");
        return;
      }
      if (preflight.status !== "ready") return;
      await startAutomaticSetup({ skipPreflight: true });
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "UsePod provider funding check failed.");
    } finally {
      setSetupRunning(false);
    }
  };

  const beginHosting = async () => {
    setHostingRunning(true);
    setSetupError("");
    try {
      const response = await callSetupAction("run", { displayName: `HivemindOS ${machine.name}`, config: hostConfig });
      if (response.run?.status === "failed") throw new Error(response.run.error || "UsePod provider failed to start.");
      setHostingStarted(true);
      setSetupMessage("Hosting started. This Mac is advertising compute through UsePod.");
      return true;
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "UsePod provider failed to start hosting.");
      return false;
    } finally {
      setHostingRunning(false);
    }
  };

  const goLive = async () => {
    const started = await beginHosting();
    if (started) setPostSetupStage("live");
  };

  return (
    <div role="presentation" onClick={onClose} className={styles.backdrop}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`UsePod host setup for ${machine.name}`}
        onClick={(event) => event.stopPropagation()}
        className={styles.modal}
      >
        <span className={`${styles.corner} ${styles.tl}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.tr}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.bl}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.br}`} aria-hidden="true" />
        <CloseIconButton
          type="button"
          onClick={onClose}
          aria-label="Close UsePod host setup"
          title="Close"
          className={styles.close}
        />
        <div className={styles.header}>
          <span className={styles.icon} data-active={setupStarted ? "true" : "false"}>
            <span className={styles.orbit} aria-hidden="true" />
            <Image src={USEPOD_RUNTIME_ICON_PATH} alt="" aria-hidden="true" width={34} height={34} unoptimized />
          </span>
          <div>
            <div className={styles.eyebrow}>UsePod provider</div>
            <h2>Rent out {machine.name}</h2>
            <p>Turn this machine into a UsePod provider.</p>
          </div>
        </div>

        <div className={`${styles.autoPanel} ${setupComplete ? styles.compactStagePanel : ""}`}>
          {setupComplete ? (
            <div className={styles.postSetupShell} aria-live="polite">
              {postSetupStage === "success" ? (
                <UsePodSuccessPanel machineName={machine.name} onBegin={() => setPostSetupStage("configure")} />
              ) : postSetupStage === "live" ? (
                <UsePodLivePanel context={hostContext} concurrency={hostConcurrency} when={hostWhen} />
              ) : (
                <UsePodConfigurePanel
                  backend={hostContext?.backend ?? { label: "Local backend", host: "http://127.0.0.1:1234", reachable: false, message: "Checking local model backend..." }}
                  hardware={`${machine.kind} · ${machine.os || "local provider"}`}
                  machineName={machine.name}
                  models={hostContext?.models ?? []}
                  payoutWallet={shortAddress(hostContext?.payoutWallet || providerPreflight?.walletAddress || "")}
                  markdown={hostMarkdown}
                  setMarkdown={setHostMarkdown}
                  concurrency={hostConcurrency}
                  setConcurrency={setHostConcurrency}
                  when={hostWhen}
                  setWhen={setHostWhen}
                  guards={hostGuards}
                  toggleGuard={toggleHostGuard}
                  capOn={hostCapOn}
                  setCapOn={setHostCapOn}
                  cap={hostCap}
                  setCap={setHostCap}
                  bondUsd={displayBondUsdc}
                />
              )}
              {postSetupStage !== "success" ? (
                <footer className={cx("up-foot")}>
                  <span className={cx("up-msg")}>
                    {postSetupStage === "live" ? "USEPOD_PROVIDER · live" : `USEPOD_PROVIDER · ready · $${displayBondUsdc} bond`}
                  </span>
                  <div className={cx("up-foot-actions")}>
                    {postSetupStage === "configure" ? (
                      <button className={cx("up-btn", "primary")} type="button" onClick={() => void goLive()} disabled={hostingRunning || !canGoLive}>
                        {hostingRunning ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Play aria-hidden="true" />}
                        {hostingRunning ? "Going live" : canGoLive ? "Go live now" : "Start local models first"}
                      </button>
                    ) : (
                      <button className={cx("up-btn", "ghost")} type="button" onClick={() => setPostSetupStage("configure")}>
                        <Pause aria-hidden="true" />View settings
                      </button>
                    )}
                  </div>
                </footer>
              ) : null}
              {setupError ? <p className={styles.status} data-tone="error">{setupError}</p> : null}
              {hostingStarted && postSetupStage === "live" && !setupError ? (
                <p className={styles.status}>Hosting started. This Mac is advertising compute through UsePod.</p>
              ) : null}
              {!canGoLive && postSetupStage === "configure" && hostContext?.backend.message ? (
                <p className={styles.status} data-tone="error">{hostContext.backend.message}</p>
              ) : null}
            </div>
          ) : (
            <>
          <div className={styles.autoVisual} data-active={setupStarted ? "true" : "false"} aria-hidden="true">
            <span />
            <span />
            <Image src={USEPOD_RUNTIME_ICON_PATH} alt="" width={44} height={44} unoptimized />
          </div>
          {needsFunding ? (
            <div className={styles.fundingPanel} aria-live="polite">
              <div className={styles.fundingHeader}>
                <div>
                  <strong>Fund provider wallet</strong>
                  <p>{providerFunded ? "Funding detected. Continue finishes provider setup." : "Deposit Solana USDC here first. Check funding will only verify the wallet balance."}</p>
                </div>
                <span>USDC</span>
              </div>
              <div className={styles.fundingStats}>
                <div>
                  <span>Current</span>
                  <strong>${(providerPreflight?.balanceUsdc ?? 0).toFixed(2)}</strong>
                </div>
                <div>
                  <span>Required</span>
                  <strong>${(providerPreflight?.bondAmountUsdc ?? USEPOD_PROVIDER_BOND_USDC).toFixed(2)}</strong>
                </div>
              </div>
              {providerPreflight?.walletAddress && !providerFunded ? (
                <div className={styles.directDepositField}>
                  <span>Recipient address</span>
                  <CopyableCodeLine value={providerPreflight.walletAddress} label="Copy recipient address" copiedLabel="Address copied" />
                </div>
              ) : null}
              {providerFunded ? (
                <Button type="button" size="default" onClick={() => void startAutomaticSetup({ skipPreflight: true })} disabled={setupRunning}>
                  {setupRunning ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}
                  {setupRunning ? "Continuing" : "Continue"}
                </Button>
              ) : (
                <Button type="button" size="default" onClick={() => void checkProviderFunding()} disabled={setupRunning}>
                  {setupRunning ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <RefreshCcw size={15} aria-hidden="true" />}
                  {setupRunning ? "Checking" : "Check funding"}
                </Button>
              )}
            </div>
          ) : (
            <Button type="button" size="default" onClick={() => void startAutomaticSetup()} disabled={setupRunning}>
              {setupRunning ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <ArrowUpRight size={15} aria-hidden="true" />}
              {setupRunning ? "Setting up" : "Automatic setup"}
            </Button>
          )}
          {setupStarted && !needsFunding ? (
            <div className={styles.setupFlow} aria-live="polite">
              <div className={styles.setupSteps}>
                {HOST_SETUP_STEPS.map((step, index) => {
                  const state = setupError && setupStep === index
                    ? "error"
                    : setupStep > index
                      ? "done"
                      : setupStep === index && setupRunning
                        ? "active"
                        : setupStep >= HOST_SETUP_STEPS.length
                          ? "done"
                          : "idle";
                  return (
                    <div key={step.label} className={styles.setupStep} data-state={state}>
                      <span>{index + 1}</span>
                      <strong>{step.label}</strong>
                      <small>{step.detail}</small>
                    </div>
                  );
                })}
              </div>
              {manualFallbackAvailable && pairingCode ? (
                <button
                  type="button"
                  className={styles.pairingCard}
                  onClick={() => void navigator.clipboard.writeText(pairingCode).catch(() => undefined)}
                >
                  <span>Pairing code</span>
                  <strong>{pairingCode}</strong>
                  {pairingClaim ? <small>{pairingClaim}</small> : null}
                </button>
              ) : null}
              {manualFallbackAvailable && pairingCode && pairingUrl ? (
                <button
                  type="button"
                  className={styles.pairingLink}
                  onClick={() => window.open(pairingUrl, "_blank", "noopener,noreferrer")}
                >
                  <ArrowUpRight size={13} aria-hidden="true" />
                  Open pairing page
                </button>
              ) : null}
            </div>
          ) : null}
          {!needsFunding && !setupStarted ? <div className={styles.stats}>
            <div>
              <span>Bond</span>
              <strong>${displayBondUsdc} USDC</strong>
            </div>
            <div>
              <span>Earn</span>
              <strong>{(USEPOD_PROVIDER_EARN_SHARE * 100).toFixed(0)}%</strong>
            </div>
            <div>
              <span>Mode</span>
              <strong>Compute</strong>
            </div>
          </div> : null}
          {setupMessage || setupError ? <p className={styles.status} data-tone={setupError ? "error" : "ok"}>{setupError || setupMessage}</p> : null}
            </>
          )}
        </div>

        <details className={styles.manual}>
          <summary>Manual setup</summary>
          <div className={styles.commands}>
            {commands.map((command) => (
              <code key={command}>{command}</code>
            ))}
          </div>
          <div className={styles.actions}>
            <button type="button" onClick={copyCommands}>
              <Copy size={13} aria-hidden="true" />
              Copy commands
            </button>
            <button type="button" onClick={() => window.open(keyRelay.docsUrl, "_blank", "noopener,noreferrer")}>
              <ArrowUpRight size={13} aria-hidden="true" />
              Key relay docs
            </button>
          </div>
        </details>
      </section>
    </div>
  );
}
