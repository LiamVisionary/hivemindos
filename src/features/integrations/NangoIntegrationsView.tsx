"use client";

import * as React from "react";
import {
  CheckCircle2,
  CircleAlert,
  Cloud,
  FileText,
  GitPullRequest,
  KeyRound,
  Link2,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Play,
  RefreshCw,
  Server,
  Sparkles,
  TerminalSquare,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NangoHostConfig, NangoHostSetupResult, NangoIntegrationPayload, NangoProviderKey } from "@/lib/types/integrations";
import styles from "@/app/integrations/integrations.module.css";

type FleetMachine = {
  device?: {
    self?: boolean;
    name?: string;
    dnsName?: string;
    os?: string;
    online?: boolean;
    ip?: string;
    collectorUrl?: string;
  };
  collector?: string;
  envSync?: { ready?: boolean };
};

type MachineChoice = {
  id: string;
  name: string;
  os: string;
  online: boolean;
  collectorReady: boolean;
  envReady: boolean;
  self: boolean;
  baseUrl: string;
  collectorUrl: string;
  rank: number;
  note: string;
};

type SetupStep = "welcome" | "host" | "method" | "automatic" | "manual" | "apps";
type SetupMode = "automatic" | "manual" | "";

const PROVIDERS: Array<{
  key: NangoProviderKey;
  label: string;
  icon: React.ReactNode;
  detail: string;
  color: string;
}> = [
  { key: "github", label: "GitHub", icon: <GitPullRequest size={25} />, detail: "Code, issues, pull requests, and releases.", color: "ink" },
  { key: "linear", label: "Linear", icon: <Workflow size={25} />, detail: "Tasks, projects, and triage queues.", color: "violet" },
  { key: "slack", label: "Slack", icon: <MessageSquare size={25} />, detail: "Channels, mentions, and approval messages.", color: "coral" },
  { key: "notion", label: "Notion", icon: <FileText size={25} />, detail: "Docs, project pages, and task databases.", color: "paper" },
  { key: "google", label: "Google", icon: <Cloud size={25} />, detail: "Drive, Gmail, and Calendar context.", color: "sky" },
];

function setupMethodLabel(method?: NangoHostSetupResult["method"]) {
  if (method === "collector-api") return "agent bridge";
  if (method === "local-shell") return "local setup";
  if (method === "tailscale-ssh") return "Tailscale";
  if (method === "plain-ssh") return "SSH";
  return method || "setup";
}

function setupStepForPayload(payload: NangoIntegrationPayload): SetupStep {
  return payload.health.ok ? "apps" : "host";
}

type NangoIntegrationsViewProps = {
  embedded?: boolean;
};

export default function NangoIntegrationsView({ embedded = false }: NangoIntegrationsViewProps) {
  const [payload, setPayload] = React.useState<NangoIntegrationPayload | null>(null);
  const [machines, setMachines] = React.useState<MachineChoice[]>([]);
  const [selectedId, setSelectedId] = React.useState("");
  const [step, setStep] = React.useState<SetupStep>("welcome");
  const [setupMode, setSetupMode] = React.useState<SetupMode>("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [setupSaving, setSetupSaving] = React.useState(false);
  const [validating, setValidating] = React.useState(false);
  const [manualValidated, setManualValidated] = React.useState(false);
  const [setupResult, setSetupResult] = React.useState<NangoHostSetupResult | null>(null);
  const [message, setMessage] = React.useState("");

  const refresh = React.useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setMessage("");
    try {
      const [nangoResponse, fleetResponse] = await Promise.all([
        fetch("/api/integrations/nango", { cache: "no-store" }),
        fetch("/api/fleet/discover?includeSnapshots=0", { cache: "no-store" }).catch(() => null),
      ]);
      const nextPayload = await nangoResponse.json() as NangoIntegrationPayload;
      const fleet = fleetResponse?.ok ? await fleetResponse.json() as { machines?: FleetMachine[] } : { machines: [] };
      const choices = machineChoices(fleet.machines ?? [], nextPayload.config);
      setPayload(nextPayload);
      setMachines(choices);
      setSelectedId((current) => nextPayload.config.hostMachineId || current || choices[0]?.id || "self");
      setStep((current) => current === "welcome" || (current === "apps" && !nextPayload.health.ok) ? setupStepForPayload(nextPayload) : current);
      return nextPayload;
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void refresh(true), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const selected = machines.find((machine) => machine.id === selectedId) ?? machines[0];
  const providerSet = new Set(payload?.config.allowedProviders ?? []);
  const ready = payload?.health.ok === true;
  const configured = Boolean(payload?.config.hostMachineId && payload.config.baseUrl);

  async function saveHost(nextStep: SetupStep = "method") {
    if (!payload || !selected) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/integrations/nango", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          hostMachineId: selected.id,
          hostMachineName: selected.name,
          baseUrl: selected.baseUrl,
          mode: selected.self ? "local" : "tailnet",
          allowedProviders: payload.config.allowedProviders,
        }),
      });
      const nextPayload = await response.json() as NangoIntegrationPayload & { error?: string };
      if (!response.ok) throw new Error(nextPayload.error ?? "Could not save this machine.");
      setPayload(nextPayload);
      setStep(nextStep);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this machine.");
    } finally {
      setSaving(false);
    }
  }

  async function setupHost() {
    if (!payload || !selected) return;
    setSetupSaving(true);
    setSetupResult(null);
    setMessage("");
    try {
      const response = await fetch("/api/integrations/nango/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          hostMachineId: selected.id,
          hostMachineName: selected.name,
          baseUrl: selected.baseUrl,
          mode: selected.self ? "local" : "tailnet",
          allowedProviders: payload.config.allowedProviders,
          collectorUrl: selected.collectorUrl,
          target: selected.self ? "local" : setupTargetFromBaseUrl(selected.baseUrl),
        }),
      });
      const result = await response.json() as NangoHostSetupResult & { error?: string };
      if (!response.ok || result.ok === false) {
        setSetupResult(result.health ? result : null);
        throw new Error(result.error ?? result.health?.error ?? "Nango is not ready yet.");
      }
      setSetupResult(result);
      await refresh();
    } catch (error) {
      setMessage(friendlySetupError(error));
    } finally {
      setSetupSaving(false);
    }
  }

  async function validateManualSetup() {
    setValidating(true);
    setManualValidated(false);
    setMessage("");
    const nextPayload = await refresh();
    window.setTimeout(() => {
      setManualValidated(nextPayload?.health.ok === true);
      setMessage(nextPayload?.health.ok === true ? "Nango validated!" : "Nango is not reachable yet. Check the setup and try again.");
      setValidating(false);
    }, 650);
  }

  async function toggleProvider(provider: NangoProviderKey) {
    if (!payload) return;
    const providers = providerSet.has(provider)
      ? payload.config.allowedProviders.filter((item) => item !== provider)
      : [...payload.config.allowedProviders, provider];
    const response = await fetch("/api/integrations/nango", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowedProviders: providers }),
    });
    if (response.ok) setPayload(await response.json() as NangoIntegrationPayload);
  }

  function chooseMode(mode: Exclude<SetupMode, "">) {
    setSetupMode(mode);
    setMessage("");
  }

  function continueFromMethod() {
    if (setupMode === "automatic") setStep("automatic");
    if (setupMode === "manual") setStep("manual");
  }

  return (
    <main className={`${styles.page} ${embedded ? styles.embedded : ""}`}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div>
            <div className={styles.eyebrow}>Nango</div>
            <h1 className={styles.title}>{step === "apps" ? "Integrations" : "Welcome to Nango"}</h1>
            <p className={styles.subtitle}>
              {step === "apps" ? "Choose the integrations your hive can use." : "The unified integration system."}
            </p>
          </div>
          {step === "apps" ? (
            <div className={styles.statusCluster}>
              <StatusBadge good={configured} label={configured ? "Host saved" : "Needs host"} />
              <StatusBadge good={ready} warn={configured && !ready} label={ready ? "Nango live" : "Checking"} />
            </div>
          ) : null}
        </header>

        {loading ? <LoadingView /> : null}
        {!loading && step === "welcome" ? <WelcomeView onStart={() => setStep("host")} /> : null}
        {!loading && step === "host" ? (
          <HostView
            machines={machines}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            onBack={() => setStep("welcome")}
            onContinue={() => void saveHost("method")}
            saving={saving}
            message={message}
          />
        ) : null}
        {!loading && step === "method" ? (
          <MethodView
            setupMode={setupMode}
            chooseMode={chooseMode}
            onBack={() => setStep("host")}
            onContinue={continueFromMethod}
          />
        ) : null}
        {!loading && step === "automatic" ? (
          <AutomaticView
            selected={selected}
            setupResult={setupResult}
            setupSaving={setupSaving}
            message={message}
            onBack={() => setStep("method")}
            onRun={() => void setupHost()}
            onFinish={() => setStep("apps")}
          />
        ) : null}
        {!loading && step === "manual" ? (
          <ManualView
            payload={payload}
            manualValidated={manualValidated}
            validating={validating}
            message={message}
            onBack={() => setStep("method")}
            onValidate={() => void validateManualSetup()}
            onFinish={() => setStep("apps")}
          />
        ) : null}
        {!loading && step === "apps" ? (
          <AppsView
            payload={payload}
            providerSet={providerSet}
            ready={ready}
            onRefresh={() => void refresh(true)}
            onSetup={() => setStep("host")}
            onToggleProvider={toggleProvider}
          />
        ) : null}
      </div>
    </main>
  );
}

function LoadingView() {
  return (
    <section className={styles.centerStage} aria-live="polite">
      <div className={styles.loadingMark}>
        <LoaderCircle className="animate-spin" />
      </div>
      <h2>Finding your machines</h2>
      <p>One moment while Nango gets the full list ready.</p>
      <div className={styles.loadingRows}>
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

function WelcomeView({ onStart }: { onStart: () => void }) {
  return (
    <section className={styles.welcomeStage}>
      <div className={styles.nangoMark}><Sparkles /></div>
      <h2>Welcome to Nango.</h2>
      <p>The unified integration system.</p>
      <Button className={styles.primaryCta} size="lg" onClick={onStart}>
        <Play /> Set up Nango
      </Button>
    </section>
  );
}

function HostView({
  machines,
  selectedId,
  setSelectedId,
  onBack,
  onContinue,
  saving,
  message,
}: {
  machines: MachineChoice[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  onBack: () => void;
  onContinue: () => void;
  saving: boolean;
  message: string;
}) {
  return (
    <section className={styles.stage}>
      <StepHeader kicker="Step 1" title="Choose a home for Nango" detail="Pick the machine that should keep your app connections running." />
      <div className={styles.machineGrid}>
        {machines.map((machine) => (
          <button
            key={machine.id}
            className={`${styles.machineCard} ${machine.id === selectedId ? styles.machineCardSelected : ""}`}
            type="button"
            onClick={() => setSelectedId(machine.id)}
          >
            <span className={styles.machineIcon}><Monitor /></span>
            <strong>{machine.name}</strong>
            <span>{machine.self ? "This computer" : machine.note}</span>
            <span className={`${styles.pill} ${machine.online ? styles.pillGood : styles.pillWarn}`}>
              {machine.online ? "Online" : "Offline"}
            </span>
            <span className={styles.machineActions}>
              <span>Set primary</span>
            </span>
          </button>
        ))}
      </div>
      <FooterActions onBack={onBack}>
        <Button onClick={onContinue} isLoading={saving} disabled={!selectedId}>
          <Server /> Continue
        </Button>
      </FooterActions>
      {message ? <p className={styles.note}>{message}</p> : null}
    </section>
  );
}

function MethodView({
  setupMode,
  chooseMode,
  onBack,
  onContinue,
}: {
  setupMode: SetupMode;
  chooseMode: (mode: Exclude<SetupMode, "">) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <section className={styles.stage}>
      <StepHeader kicker="Step 2" title="How would you like to set up this machine?" detail="Most people should choose automatic." />
      <div className={styles.methodGrid}>
        <button className={`${styles.methodCard} ${setupMode === "automatic" ? styles.methodCardSelected : ""}`} type="button" onClick={() => chooseMode("automatic")}>
          <Sparkles />
          <strong>Automatic</strong>
          <span>HivemindOS prepares Nango for you, then checks that it works.</span>
        </button>
        <button className={`${styles.methodCard} ${setupMode === "manual" ? styles.methodCardSelected : ""}`} type="button" onClick={() => chooseMode("manual")}>
          <TerminalSquare />
          <strong>Manual</strong>
          <span>Use your own setup, then let HivemindOS validate it.</span>
        </button>
      </div>
      <FooterActions onBack={onBack}>
        <Button onClick={onContinue} disabled={!setupMode}>Next</Button>
      </FooterActions>
    </section>
  );
}

function AutomaticView({
  selected,
  setupResult,
  setupSaving,
  message,
  onBack,
  onRun,
  onFinish,
}: {
  selected?: MachineChoice;
  setupResult: NangoHostSetupResult | null;
  setupSaving: boolean;
  message: string;
  onBack: () => void;
  onRun: () => void;
  onFinish: () => void;
}) {
  const complete = setupResult?.ok === true;
  return (
    <section className={styles.stage}>
      <StepHeader kicker="Step 3" title="Start automatic setup" detail={`Nango will be prepared on ${selected?.name ?? "the selected machine"}.`} />
      <button className={`${styles.bigSetupButton} ${setupSaving ? styles.bigSetupButtonBusy : ""}`} type="button" onClick={onRun} disabled={setupSaving || !selected}>
        {setupSaving ? <LoaderCircle className="animate-spin" /> : complete ? <CheckCircle2 /> : <Sparkles />}
        <span>{setupSaving ? "Setting up Nango" : complete ? "Nango is ready" : "Start automatic setup"}</span>
      </button>
      {complete ? (
        <div className={styles.successBurst}>
          <CheckCircle2 />
          <strong>Success</strong>
          <span>{setupMethodLabel(setupResult.method)} finished on {setupResult.target}.</span>
        </div>
      ) : null}
      {message ? <p className={complete ? styles.noteGood : styles.note}>{message}</p> : null}
      <FooterActions onBack={onBack}>
        <Button onClick={onFinish} disabled={!complete}>Finish</Button>
      </FooterActions>
    </section>
  );
}

function ManualView({
  payload,
  manualValidated,
  validating,
  message,
  onBack,
  onValidate,
  onFinish,
}: {
  payload: NangoIntegrationPayload | null;
  manualValidated: boolean;
  validating: boolean;
  message: string;
  onBack: () => void;
  onValidate: () => void;
  onFinish: () => void;
}) {
  return (
    <section className={styles.stage}>
      <StepHeader kicker="Step 3" title="Manual setup" detail="Set up Nango on the chosen machine, then validate it here." />
      <div className={styles.manualBox}>
        <strong>Run Nango on this address</strong>
        <span>{payload?.config.baseUrl ?? "Nango host address"}</span>
        <pre>{(payload?.setupCommands ?? []).join("\n")}</pre>
      </div>
      <div className={styles.validateRow}>
        <Button onClick={onValidate} isLoading={validating}>
          <RefreshCw /> Validate
        </Button>
        {manualValidated ? <span className={styles.validated}><CheckCircle2 /> Nango validated!</span> : null}
      </div>
      {message ? <p className={manualValidated ? styles.noteGood : styles.note}>{message}</p> : null}
      <FooterActions onBack={onBack}>
        <Button onClick={onFinish} disabled={!manualValidated}>Finish</Button>
      </FooterActions>
    </section>
  );
}

function AppsView({
  payload,
  providerSet,
  ready,
  onRefresh,
  onSetup,
  onToggleProvider,
}: {
  payload: NangoIntegrationPayload | null;
  providerSet: Set<NangoProviderKey>;
  ready: boolean;
  onRefresh: () => void;
  onSetup: () => void;
  onToggleProvider: (provider: NangoProviderKey) => void;
}) {
  if (!ready) {
    return (
      <section className={styles.appsStage}>
        <div className={styles.appsToolbar}>
          <div>
            <h2>Nango setup incomplete</h2>
            <p>{payload?.config.hostMachineName || "The selected host"} is saved, but Nango is not reachable yet.</p>
          </div>
          <div className={styles.toolbarButtons}>
            <Button variant="secondary" onClick={onSetup}><KeyRound /> Set up again</Button>
            <Button variant="ghost" onClick={onRefresh}><RefreshCw /> Refresh</Button>
          </div>
        </div>
        <div className={styles.setupRequired}>
          <CircleAlert />
          <div>
            <strong>Finish setup before adding app connections.</strong>
            <span>{payload?.health.error || payload?.connectionError || "Nango health is failing, so connected accounts and provider setup are paused."}</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.appsStage}>
      <div className={styles.appsToolbar}>
        <div>
          <h2>Integrations</h2>
          <p>{payload?.connections.length ?? 0} connected account{payload?.connections.length === 1 ? "" : "s"}</p>
        </div>
        <div className={styles.toolbarButtons}>
          {payload?.config.baseUrl ? (
            <Button asChild variant="secondary">
              <a href={payload.config.baseUrl} target="_blank" rel="noreferrer">
                <span className="inline-flex items-center gap-2"><Link2 /> Open Nango</span>
              </a>
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onSetup}><KeyRound /> Setup</Button>
          <Button variant="ghost" onClick={onRefresh}><RefreshCw /> Refresh</Button>
        </div>
      </div>

      <div className={styles.appGrid}>
        {PROVIDERS.map((provider) => {
          const enabled = providerSet.has(provider.key);
          return (
            <button
              key={provider.key}
              className={`${styles.appCard} ${enabled ? styles.appCardEnabled : ""}`}
              type="button"
              onClick={() => onToggleProvider(provider.key)}
              aria-pressed={enabled}
            >
              <span className={`${styles.appIcon} ${styles[`appIcon${provider.color}`]}`}>{provider.icon}</span>
              <strong>{provider.label}</strong>
              <span className={styles.appDetail}>{provider.detail}</span>
              <span className={`${styles.pill} ${enabled ? styles.pillGood : styles.pillNeutral}`}>{enabled ? "Enabled" : "Off"}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.connectionList}>
        <div className={styles.connectionHeader}>
          <strong>Connected accounts</strong>
          <StatusBadge good={ready} warn={Boolean(payload?.config.hostMachineId)} label={ready ? "Nango live" : "Waiting"} />
        </div>
        {payload?.connections.length ? payload.connections.map((connection) => (
          <div key={`${connection.providerConfigKey}:${connection.id}`} className={styles.connectionRow}>
            <strong>{connection.providerConfigKey}</strong>
            <span>{connection.displayName || connection.email || connection.id}</span>
          </div>
        )) : (
          <div className={styles.emptyAccounts}>
            <strong>No accounts connected yet.</strong>
            <span>When people connect apps through Nango, they will appear here.</span>
          </div>
        )}
        {payload?.connectionError ? <p className={styles.note}>{payload.connectionError}</p> : null}
      </div>
    </section>
  );
}

function StepHeader({ kicker, title, detail }: { kicker: string; title: string; detail: string }) {
  return (
    <div className={styles.stepHeader}>
      <span>{kicker}</span>
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

function FooterActions({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className={styles.footerActions}>
      <Button variant="ghost" onClick={onBack}>Back</Button>
      {children}
    </div>
  );
}

function StatusBadge({ good, warn, label }: { good?: boolean; warn?: boolean; label: string }) {
  return (
    <span className={`${styles.badge} ${good ? styles.badgeGood : warn ? styles.badgeWarn : styles.badgeBad}`}>
      {good ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
      {label}
    </span>
  );
}

function machineChoices(machines: FleetMachine[], config: NangoHostConfig): MachineChoice[] {
  const choices = machines.map((machine) => {
    const device = machine.device ?? {};
    const name = device.self ? "This Mac" : device.name || dnsLabel(device.dnsName) || device.ip || "Unknown machine";
    const id = device.self ? "self" : normalizeId(device.dnsName || device.name || device.ip || name);
    const online = device.self || device.online === true;
    const collectorReady = machine.collector === "ready";
    const envReady = machine.envSync?.ready === true;
    const serverLike = /linux|ubuntu|debian|server|cloud|hetzner/i.test(`${device.os} ${name} ${device.dnsName}`);
    const baseHost = device.self ? "127.0.0.1" : (device.dnsName || device.ip || name).replace(/\.$/, "");
    const rank = (online ? 32 : 0) + (collectorReady ? 18 : 0) + (envReady ? 14 : 0) + (serverLike ? 28 : 0) + (device.self ? 4 : 0);
    return {
      id,
      name,
      os: device.os || "unknown OS",
      online,
      collectorReady,
      envReady,
      self: device.self === true,
      baseUrl: `http://${baseHost}:3003`,
      collectorUrl: device.collectorUrl || "",
      rank,
      note: device.self ? "current machine" : serverLike ? "always-on candidate" : "tailnet machine",
    };
  });

  if (!choices.some((choice) => choice.id === "self")) {
    choices.push({
      id: "self",
      name: "This Mac",
      os: "local",
      online: true,
      collectorReady: false,
      envReady: false,
      self: true,
      baseUrl: "http://127.0.0.1:3003",
      collectorUrl: "http://127.0.0.1:8787",
      rank: 18,
      note: "current machine",
    });
  }

  if (config.hostMachineId && !choices.some((choice) => choice.id === config.hostMachineId)) {
    choices.push({
      id: config.hostMachineId,
      name: config.hostMachineName || config.hostMachineId,
      os: "saved host",
      online: false,
      collectorReady: false,
      envReady: false,
      self: false,
      baseUrl: config.baseUrl,
      collectorUrl: "",
      rank: 10,
      note: "saved host",
    });
  }

  return choices.sort((left, right) => right.rank - left.rank || left.name.localeCompare(right.name));
}

function dnsLabel(value?: string) {
  return value?.replace(/\.$/, "").split(".")[0] ?? "";
}

function normalizeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "machine";
}

function setupTargetFromBaseUrl(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").split(":")[0] || "integration-host";
  }
}

function friendlySetupError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/fetch failed|failed to fetch|network/i.test(message)) {
    return "Could not reach that machine. Make sure it is online, then try again.";
  }
  return message || "Could not start Nango. Try again in a moment.";
}
