"use client";

import { useEffect, useRef, useState, type Dispatch, type FormEvent, type InputHTMLAttributes, type SetStateAction, type SVGProps } from "react";
import type { AgentRuntime } from "@/lib/types/agent-runtime";
import type { MachineInitStatus, MachineInitTokenStatus } from "@/features/dashboard/dashboard-types";
import styles from "./MachineInitModal.module.css";

// Redesign of the "New Hetzner agent box" modal into the HivemindOS Setup hive
// system. Four steps — token → configure → provisioning → ready — wired to the
// real machine-init handlers. The provisioning step folds in the one-click
// provision job (POST + poll /api/fleet/machines/provision, the logic formerly
// in MachineProvisionPanel), streaming its real log. A manual "generate setup
// commands" path is preserved as a fallback for machines without the hcloud CLI.

type SelectOption = { value: string; label: string };
type HetznerServerTypeOption = SelectOption & {
  detail: string;
  monthlyEur: number;
  cores: number;
  memoryGb: number;
  diskGb: number;
  cpu: string;
};
type MachineInitDraft = {
  projectName: string;
  serverType: string;
  serverLocation: string;
  serverImage: string;
  runtimeAgent: AgentRuntime;
};

type Props = {
  onClose: () => void;
  draft: MachineInitDraft;
  setDraft: Dispatch<SetStateAction<MachineInitDraft>>;
  token: string;
  setToken: Dispatch<SetStateAction<string>>;
  tokenStatus: MachineInitTokenStatus;
  setTokenStatus: Dispatch<SetStateAction<MachineInitTokenStatus>>;
  saveHetznerToken: () => void | Promise<void>;
  openHetznerEnvFile: () => void | Promise<void>;
  serverTypeOptions: readonly HetznerServerTypeOption[];
  locationOptions: readonly SelectOption[];
  imageOptions: readonly SelectOption[];
  selectedServerType: HetznerServerTypeOption;
  initializeMachineProject: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  initStatus: MachineInitStatus;
  copyCommand: (key: string, command: string) => void;
  copiedKey: string;
  secretInputProps: InputHTMLAttributes<HTMLInputElement>;
  maskedSecretValueClass: string;
};

const EMBLEM_CELLS = 7;
const RUNTIME_OPTIONS: Array<{ value: AgentRuntime; label: string }> = [
  { value: "hermes", label: "Hermes" },
  { value: "openclaw", label: "OpenClaw" },
  { value: "aeon", label: "Aeon" },
];

// Short architecture tag derived from the option's cpu description.
function archTag(cpu: string) {
  const c = cpu.toLowerCase();
  if (c.includes("arm") || c.includes("ampere")) return "ARM";
  if (c.includes("dedicated")) return "Dedicated";
  return "x86";
}

export function MachineInitModal(props: Props) {
  const {
    onClose, draft, setDraft, token, setToken, tokenStatus, setTokenStatus, saveHetznerToken, openHetznerEnvFile,
    serverTypeOptions, locationOptions, imageOptions, selectedServerType, initializeMachineProject, initStatus,
    copyCommand, copiedKey, secretInputProps, maskedSecretValueClass,
  } = props;

  const [step, setStep] = useState(0); // 0 token · 1 configure · 2 provisioning · 3 ready
  const [manualRequested, setManualRequested] = useState(false);

  // One-click provision job state (folded from the former MachineProvisionPanel).
  const [phase, setPhase] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const [provLog, setProvLog] = useState<string[]>([]);
  const [provError, setProvError] = useState("");
  const [filledCells, setFilledCells] = useState(0);
  const pollRef = useRef(false);

  // Stop polling if the modal unmounts mid-job.
  useEffect(() => () => { pollRef.current = false; }, []);

  // Cosmetic emblem fill while the job runs (capped one short of full); the real
  // job status completes it. Reset to 0 in provision() so re-runs start fresh.
  useEffect(() => {
    if (step !== 2 || jobStatus !== "running") return;
    const id = window.setInterval(() => setFilledCells((c) => Math.min(EMBLEM_CELLS - 1, c + 1)), 1400);
    return () => window.clearInterval(id);
  }, [step, jobStatus]);

  // Reveal the ready step once the real job succeeds.
  useEffect(() => {
    if (step !== 2 || jobStatus !== "succeeded") return;
    const id = window.setTimeout(() => setStep(3), 720);
    return () => window.clearTimeout(id);
  }, [step, jobStatus]);

  const pollJob = async (jobId: string, cursor: number) => {
    if (!pollRef.current) return;
    let data: Record<string, unknown> | null = null;
    try {
      const res = await fetch(`/api/fleet/machines/provision?jobId=${encodeURIComponent(jobId)}&cursor=${cursor}`, { cache: "no-store" });
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      window.setTimeout(() => void pollJob(jobId, cursor), 2500);
      return;
    }
    if (!data?.ok) {
      setProvError(String((data?.error as string) || "Lost track of the provisioning job."));
      setJobStatus("failed");
      pollRef.current = false;
      setStep(1);
      return;
    }
    const job = data.job as Record<string, unknown>;
    const tail = Array.isArray(job.logTail) ? (job.logTail as string[]) : [];
    if (tail.length) setProvLog((prev) => [...prev, ...tail]);
    setPhase(String(job.phase ?? ""));
    const nextCursor = Number(job.cursor ?? cursor);
    if (job.status === "running") {
      window.setTimeout(() => void pollJob(jobId, nextCursor), 1500);
    } else {
      setJobStatus(String(job.status ?? ""));
      pollRef.current = false;
      if (job.status === "failed") {
        setProvError(String(job.error ?? "Provisioning failed."));
        setStep(1);
      }
    }
  };

  const provision = async () => {
    if (!draft.projectName.trim()) return;
    setProvError("");
    setProvLog([]);
    setPhase("starting");
    setJobStatus("running");
    setFilledCells(0);
    pollRef.current = true;
    setStep(2);
    const body = {
      projectName: draft.projectName,
      serverType: draft.serverType,
      serverLocation: draft.serverLocation,
      serverImage: draft.serverImage,
      runtimeAgent: draft.runtimeAgent,
      seedRuntimes: [draft.runtimeAgent],
      seedFromMachineId: "",
      seedFromCollectorUrl: "",
    };
    let data: Record<string, unknown> | null = null;
    try {
      const res = await fetch("/api/fleet/machines/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      data = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      setProvError(err instanceof Error ? err.message : "Could not start provisioning.");
      setJobStatus("failed");
      pollRef.current = false;
      setStep(1);
      return;
    }
    if (!data?.ok || !data.jobId) {
      setProvError(String((data?.error as string) || "Could not start provisioning."));
      setJobStatus("failed");
      pollRef.current = false;
      setStep(1);
      return;
    }
    void pollJob(String(data.jobId), 0);
  };

  const validated = Boolean(tokenStatus.validated);
  const tokenBusy = tokenStatus.busyAction === "save";
  const showCommands = manualRequested && Boolean(initStatus.result);
  const tone = step === 2 ? "live" : undefined;
  const filled = step === 2 ? (jobStatus === "succeeded" ? EMBLEM_CELLS : filledCells) : 0;
  const meterPct = Math.round((filled / EMBLEM_CELLS) * 100);

  // Real job-log lines for the provisioning view; falls back to honest phase text.
  const logLines: Array<{ k: "logOk" | "logRun" | "logDim"; t: string }> = [];
  if (step === 2) {
    logLines.push({ k: "logDim", t: `$ provision ${draft.serverType} · ${draft.serverLocation}` });
    for (const line of provLog) logLines.push({ k: "logRun", t: line });
    if (jobStatus === "succeeded") logLines.push({ k: "logOk", t: "✓ box online · joining your fleet" });
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (step !== 2 && event.target === event.currentTarget) onClose();
      }}
    >
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="machine-init-title">
        {step !== 2 ? (
          <button className={styles.close} type="button" aria-label="Close machine initializer" onClick={onClose}><IconClose /></button>
        ) : null}

        <header className={styles.hero} data-tone={tone}>
          <span className={styles.mark}><IconServer /></span>
          <span className={styles.heroText}>
            <span className={styles.eyebrow}>Hetzner · Machine</span>
            <span className={styles.heroTitle}>Initialize an agent box</span>
          </span>
          <span className={styles.rail} aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <i key={i} data-on={i <= step ? "true" : undefined} data-live={step === 2 && i === 2 ? "true" : undefined} />
            ))}
          </span>
        </header>

        <div className={styles.body}>
          {showCommands ? (
            <CommandsStep result={initStatus.result!} copyCommand={copyCommand} copiedKey={copiedKey} />
          ) : step === 0 ? (
            <TokenStep token={token} setToken={setToken} setTokenStatus={setTokenStatus} tokenStatus={tokenStatus} validated={validated} secretInputProps={secretInputProps} maskedSecretValueClass={maskedSecretValueClass} />
          ) : step === 1 ? (
            <ConfigStep draft={draft} setDraft={setDraft} serverTypeOptions={serverTypeOptions} locationOptions={locationOptions} imageOptions={imageOptions} selectedServerType={selectedServerType} provError={provError} initError={initStatus.error} />
          ) : step === 2 ? (
            <RunningStep filled={filled} meterPct={meterPct} phase={phase} succeeded={jobStatus === "succeeded"} logLines={logLines} />
          ) : (
            <ReadyStep draft={draft} selectedServerType={selectedServerType} locationOptions={locationOptions} />
          )}
        </div>

        <footer className={styles.foot}>
          {showCommands ? (
            <div className={styles.footActions}>
              <button className={`${styles.btn} ${styles.text} ${styles.grow}`} type="button" onClick={() => setManualRequested(false)}><IconChevL /> Back</button>
              <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={onClose}>Done</button>
            </div>
          ) : step === 0 ? (
            <>
              <p className={styles.disclaimer}>The token is validated live and stored only in this machine&rsquo;s local env.</p>
              <div className={styles.footActions}>
                <button className={`${styles.btn} ${styles.ghost} ${styles.grow}`} type="button" onClick={() => void openHetznerEnvFile()} disabled={tokenStatus.busyAction === "open"}>
                  {tokenStatus.busyAction === "open" ? <IconSpinner /> : null} Open env file
                </button>
                {validated ? (
                  <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => setStep(1)}>Continue <IconArrow /></button>
                ) : (
                  <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => void saveHetznerToken()} disabled={tokenBusy || token.trim().length < 8}>
                    {tokenBusy ? <><IconSpinner /> Validating…</> : <>Validate <IconArrow /></>}
                  </button>
                )}
              </div>
            </>
          ) : step === 1 ? (
            <div className={styles.footActions}>
              <button className={`${styles.btn} ${styles.text} ${styles.grow}`} type="button" onClick={() => setStep(0)}><IconChevL /> Back</button>
              <form style={{ display: "contents" }} onSubmit={(event) => { event.preventDefault(); setManualRequested(true); void initializeMachineProject(event); }}>
                <button className={`${styles.btn} ${styles.ghost}`} type="submit" disabled={initStatus.busy}>
                  {initStatus.busy ? <><IconSpinner /> Generating…</> : "Generate commands"}
                </button>
              </form>
              <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => void provision()} disabled={!draft.projectName.trim()}>
                <IconServer /> Provision machine
              </button>
            </div>
          ) : step === 2 ? (
            <div className={styles.footActions}>
              <button className={`${styles.btn} ${styles.text} ${styles.grow}`} type="button" disabled>Provisioning — this can take a few minutes</button>
              <button className={`${styles.btn} ${styles.primary}`} type="button" data-tone="live" disabled><IconSpinner /> Working…</button>
            </div>
          ) : (
            <div className={styles.footActions}>
              <button className={`${styles.btn} ${styles.ghost} ${styles.grow}`} type="button" onClick={onClose}>Close</button>
              <button className={`${styles.btn} ${styles.primary}`} type="button" data-tone="live" onClick={onClose}><IconFleet /> View in Fleet</button>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step views
// ---------------------------------------------------------------------------

function TokenStep({ token, setToken, setTokenStatus, tokenStatus, validated, secretInputProps, maskedSecretValueClass }: {
  token: string;
  setToken: Dispatch<SetStateAction<string>>;
  setTokenStatus: Dispatch<SetStateAction<MachineInitTokenStatus>>;
  tokenStatus: MachineInitTokenStatus;
  validated: boolean;
  secretInputProps: InputHTMLAttributes<HTMLInputElement>;
  maskedSecretValueClass: string;
}) {
  return (
    <div className={styles.step}>
      <h2 id="machine-init-title" className={`${styles.title} ${styles.sm}`}>Connect Hetzner Cloud.</h2>
      <p className={styles.lede}>Paste a Hetzner Cloud API token. We validate it against the live Hetzner API, then store it locally — it never leaves this machine or touches the shared vault.</p>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>HCLOUD_TOKEN</span>
        <input
          {...secretInputProps}
          className={`${styles.input} ${maskedSecretValueClass}`}
          style={{ fontFamily: "var(--f-mono)", fontSize: 14 }}
          placeholder="Paste token"
          value={token}
          onChange={(event) => { setToken(event.target.value); setTokenStatus({}); }}
        />
      </label>
      {validated ? (
        <span className={styles.valid}><IconCheck width={14} height={14} /> {tokenStatus.message || "Token reaches the Hetzner API · saved locally"}</span>
      ) : tokenStatus.error ? (
        <p className={styles.error} role="alert">{tokenStatus.error}</p>
      ) : (
        <p className={styles.tokenHint}>Create one under Hetzner Cloud Console → Security → API Tokens (Read &amp; Write).</p>
      )}
    </div>
  );
}

function ConfigStep({ draft, setDraft, serverTypeOptions, locationOptions, imageOptions, selectedServerType, provError, initError }: {
  draft: MachineInitDraft;
  setDraft: Dispatch<SetStateAction<MachineInitDraft>>;
  serverTypeOptions: readonly HetznerServerTypeOption[];
  locationOptions: readonly SelectOption[];
  imageOptions: readonly SelectOption[];
  selectedServerType: HetznerServerTypeOption;
  provError: string;
  initError?: string;
}) {
  const t = selectedServerType;
  return (
    <div className={styles.step}>
      <h2 id="machine-init-title" className={`${styles.title} ${styles.sm}`}>Configure the agent box.</h2>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Machine name</span>
        <input className={styles.input} type="text" placeholder="seo-worker-1" value={draft.projectName} onChange={(event) => setDraft((current) => ({ ...current, projectName: event.target.value }))} />
      </label>

      <span className={styles.fieldLabel} style={{ marginTop: 4 }}>Server type</span>
      <div className={styles.types}>
        {serverTypeOptions.map((option) => (
          <button type="button" key={option.value} className={styles.type} data-sel={draft.serverType === option.value ? "true" : undefined} onClick={() => setDraft((current) => ({ ...current, serverType: option.value }))}>
            <span className={styles.typeIcon}><IconCpu /></span>
            <span className={styles.typeBody}>
              <span className={styles.typeHead}>
                <strong>{option.label}</strong>
                <span className={styles.typeTag}>{archTag(option.cpu)}</span>
                <span className={styles.typePrice}>€{option.monthlyEur.toFixed(2)}/mo</span>
              </span>
              <small>{option.cores} vCPU · {option.memoryGb} GB RAM · {option.diskGb} GB SSD</small>
            </span>
          </button>
        ))}
      </div>

      <div className={styles.grid2} style={{ marginTop: 4 }}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Location</span>
          <select className={styles.input} value={draft.serverLocation} onChange={(event) => setDraft((current) => ({ ...current, serverLocation: event.target.value }))}>
            {locationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Image</span>
          <select className={styles.input} value={draft.serverImage} onChange={(event) => setDraft((current) => ({ ...current, serverImage: event.target.value }))}>
            {imageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Runtime agent</span>
        <select className={styles.input} value={draft.runtimeAgent} onChange={(event) => setDraft((current) => ({ ...current, runtimeAgent: event.target.value as AgentRuntime }))}>
          {RUNTIME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>

      <div className={styles.cost}>
        <div className={styles.costHead}>
          <span>Estimated compute</span>
          <strong>€{t.monthlyEur.toFixed(2)}<small> /mo</small></strong>
        </div>
        <dl className={styles.specs}>
          <div><dt>vCPU</dt><dd>{t.cores}</dd></div>
          <div><dt>RAM</dt><dd>{t.memoryGb} GB</dd></div>
          <div><dt>SSD</dt><dd>{t.diskGb} GB</dd></div>
          <div><dt>CPU</dt><dd style={{ fontSize: 11 }}>{archTag(t.cpu)}</dd></div>
        </dl>
        <p className={styles.costNote}>{t.detail}. Public IPv4, VAT, and location premiums can change. Setup prints live Hetzner commands you can verify before anything is provisioned.</p>
      </div>

      {provError ? <p className={styles.error} role="alert">{provError}</p> : null}
      {initError ? <p className={styles.error} role="alert">{initError}</p> : null}
    </div>
  );
}

function RunningStep({ filled, meterPct, phase, succeeded, logLines }: {
  filled: number;
  meterPct: number;
  phase: string;
  succeeded: boolean;
  logLines: Array<{ k: "logOk" | "logRun" | "logDim"; t: string }>;
}) {
  const cells = Array.from({ length: EMBLEM_CELLS });
  return (
    <div className={styles.run}>
      <div className={styles.emblem} aria-hidden="true">
        {cells.map((_, i) => {
          const state = i < filled ? "done" : i === filled && !succeeded ? "active" : succeeded ? "done" : "idle";
          return <span key={i} className={`${styles.cell} ${styles[`c${i}`]}`} data-state={state}><IconCheck /></span>;
        })}
      </div>
      <div className={styles.runMeta}>
        <span className={styles.liveTag}><span className={styles.liveDot} /> Provisioning on Hetzner</span>
        <h2 id="machine-init-title" className={`${styles.title} ${styles.sm}`}>{succeeded ? "Box online." : phase ? `${phase}…` : "Setting things up…"}</h2>
      </div>
      <div className={styles.meter}><i style={{ width: `${succeeded ? 100 : Math.max(meterPct, 8)}%` }} /></div>
      <div className={styles.log}>
        {logLines.slice(-6).map((line, i) => (
          <div className={styles.logLine} key={i}><span className={styles[line.k]}>{line.t}</span></div>
        ))}
      </div>
    </div>
  );
}

function ReadyStep({ draft, selectedServerType, locationOptions }: {
  draft: MachineInitDraft;
  selectedServerType: HetznerServerTypeOption;
  locationOptions: readonly SelectOption[];
}) {
  const locationLabel = locationOptions.find((option) => option.value === draft.serverLocation)?.label ?? draft.serverLocation;
  return (
    <div className={`${styles.step} ${styles.center}`}>
      <div className={styles.mkWrap} aria-hidden="true">
        <span className={styles.mkRing} /><span className={styles.mkRing} data-delay="true" /><span className={styles.mkGlow} />
        <svg className={styles.mkSvg} viewBox="0 0 52 52" width="60" height="60">
          <circle className={styles.mkCircle} cx="26" cy="26" r="23" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <path className={styles.mkTick} d="M15 27 L23 34.5 L38 18" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 id="machine-init-title" className={styles.title}>Agent box is live.</h2>
      <p className={styles.lede}><strong>{draft.projectName || "agent box"}</strong> is bootstrapped and joining your fleet now. It appears in the Fleet automatically once its local agent bridge reports in.</p>
      <div className={styles.card}>
        <span className={styles.lead}><span>{selectedServerType.label} · {draft.runtimeAgent}</span><strong>{locationLabel}</strong></span>
      </div>
    </div>
  );
}

function CommandsStep({ result, copyCommand, copiedKey }: {
  result: NonNullable<MachineInitStatus["result"]>;
  copyCommand: (key: string, command: string) => void;
  copiedKey: string;
}) {
  const rows: Array<[string, string, string | undefined]> = [
    ["editEnv", "Add token", result.commands.editEnv],
    ["listServerTypes", "Server types", result.commands.listServerTypes],
    ["listLocations", "Locations", result.commands.listLocations],
    ["provision", "Provision", result.commands.provision],
    ["verify", "Verify SSH", result.commands.verify],
    ["bootstrap", "Bootstrap HivemindOS", result.commands.bootstrap],
    ["destroy", "Destroy", result.commands.destroy],
  ];
  return (
    <div className={styles.step}>
      <h2 id="machine-init-title" className={`${styles.title} ${styles.sm}`}>Run it yourself.</h2>
      <p className={styles.lede}><strong>{result.serverName}</strong> · {result.projectDir}. Run these in order from the project directory — verify the live Hetzner output before provisioning.</p>
      <div className={styles.cmdList}>
        {rows.filter((row): row is [string, string, string] => Boolean(row[2])).map(([key, label, command]) => (
          <div key={key} className={styles.cmd}>
            <span className={styles.lead}><span>{label}</span><code>{command}</code></span>
            <button className={styles.copy} type="button" data-done={copiedKey === key ? "true" : undefined} onClick={() => copyCommand(key, command)}>
              {copiedKey === key ? <IconCheck width={13} height={13} /> : <IconCopy />}{copiedKey === key ? "Copied" : "Copy"}
            </button>
          </div>
        ))}
      </div>
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
function IconServer(p: SVGProps<SVGSVGElement>) { return <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} {...p}><rect x="3" y="4" width="18" height="7" rx="1.8" /><rect x="3" y="13" width="18" height="7" rx="1.8" /><path d="M7 7.5h.01M7 16.5h.01M11 7.5h5M11 16.5h5" /></svg>; }
function IconCpu(p: SVGProps<SVGSVGElement>) { return <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} {...p}><rect x="7" y="7" width="10" height="10" rx="1.6" /><path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3" /></svg>; }
function IconFleet(p: SVGProps<SVGSVGElement>) { return <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} {...p}><path d="M12 3 5 6.5v5L12 15l7-3.5v-5z M5 11.5 12 15M19 11.5 12 15M12 15v6" /></svg>; }
