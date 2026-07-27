"use client";

import * as React from "react";
import { ChevronLeft, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/design-system/ui/button";
import {
  createDefaultFleetMachinePolicy,
  FLEET_MACHINE_ACCESS_CAPABILITIES,
  FLEET_MACHINE_ACCESS_OPTIONS,
  type FleetMachineAccessPolicy,
  type FleetMachinePerformancePolicy,
  type FleetMachinePolicyResponse,
} from "@/lib/types/fleet-machine-policy";
import type { HiveMachine } from "./fleet-hive-types";
import styles from "./machine-settings.module.css";

type SettingsTab = "permissions" | "performance" | "authority";

const THRESHOLD_OPTIONS = [50, 60, 70, 75, 80, 85, 90, 95, 100];

async function machinePolicyRequest(collectorUrlValue: string, action?: Record<string, unknown>) {
  const collectorUrl = collectorUrlValue.trim();
  if (!collectorUrl) throw new Error("This machine does not expose a collector policy endpoint yet.");
  const response = action
    ? await fetch("/api/fleet/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectorUrl, ...action }),
      })
    : await fetch(`/api/fleet/policy?collectorUrl=${encodeURIComponent(collectorUrl)}`, { cache: "no-store" });
  const data = await response.json().catch(() => null) as FleetMachinePolicyResponse | null;
  if (!response.ok || !data?.ok) throw new Error(data?.error || "Machine policy request failed.");
  return data;
}

function thresholdStatus(machine: HiveMachine, policy: FleetMachinePerformancePolicy) {
  if (policy.ignore) return { eligible: false, detail: "Manually ignored by Queen Bee." };
  if (!policy.enabled) return { eligible: true, detail: "Automatic usage limits are off." };
  const checks = [
    { label: "CPU", value: machine.cpu, limit: policy.maxCpuPct },
    { label: "RAM", value: machine.ram, limit: policy.maxRamPct },
    { label: "storage", value: machine.disk, limit: policy.maxDiskPct },
  ];
  const blocked = checks.find((check) => check.value > check.limit);
  return blocked
    ? { eligible: false, detail: `${blocked.label} is ${Math.round(blocked.value)}%, above the ${blocked.limit}% limit.` }
    : { eligible: true, detail: "Live usage is inside every routing limit." };
}

export function MachineSettingsPanel({ machine, onClose }: { machine: HiveMachine; onClose: () => void }) {
  const collectorUrl = machine.source.collectorUrl?.trim() || "";
  const [tab, setTab] = React.useState<SettingsTab>("permissions");
  const [snapshot, setSnapshot] = React.useState<FleetMachinePolicyResponse | null>(null);
  const [access, setAccess] = React.useState<FleetMachineAccessPolicy>(() => ({
    ...createDefaultFleetMachinePolicy(machine.id).access,
  }));
  const [performance, setPerformance] = React.useState<FleetMachinePerformancePolicy>(() => ({
    ...createDefaultFleetMachinePolicy(machine.id).performance,
  }));
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [releaseArmed, setReleaseArmed] = React.useState(false);

  const load = React.useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const next = await machinePolicyRequest(collectorUrl);
      setSnapshot(next);
      setAccess({ ...next.policy.access });
      setPerformance({ ...next.policy.performance });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load machine policy.");
    } finally {
      setBusy(false);
    }
  }, [collectorUrl]);

  React.useEffect(() => {
    let active = true;
    machinePolicyRequest(collectorUrl)
      .then((next) => {
        if (!active) return;
        setSnapshot(next);
        setAccess({ ...next.policy.access });
        setPerformance({ ...next.policy.performance });
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load machine policy.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => { active = false; };
  }, [collectorUrl]);

  const mutate = React.useCallback(async (action: Record<string, unknown>, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await machinePolicyRequest(collectorUrl, action);
      setSnapshot(next);
      setAccess({ ...next.policy.access });
      setPerformance({ ...next.policy.performance });
      setNotice(success);
      setReleaseArmed(false);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Could not update machine policy.");
    } finally {
      setBusy(false);
    }
  }, [collectorUrl]);

  const canManage = Boolean(snapshot?.canManage && snapshot.policy.authority);
  const routing = thresholdStatus(machine, performance);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <button type="button" className={styles.back} onClick={onClose} aria-label={`Back to ${machine.name}`}>
          <ChevronLeft size={15} aria-hidden="true" />
          Machine
        </button>
        <Button type="button" variant="ghost" size="xs" onClick={() => void load()} disabled={busy} aria-label="Refresh machine policy">
          <RefreshCw size={13} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className={styles.titleRow}>
        <span className={styles.titleIcon}><ShieldCheck size={18} aria-hidden="true" /></span>
        <div>
          <div className={styles.eyebrow}>Machine settings</div>
          <h2>{machine.name}</h2>
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label={`${machine.name} settings`}>
        {(["permissions", "performance", "authority"] as SettingsTab[]).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={styles.tab}
            data-active={tab === item ? "true" : undefined}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      {!snapshot && busy ? <div className={styles.loading}>Loading the collector policy…</div> : null}

      {snapshot && tab === "permissions" ? (
        <div className={styles.section} role="tabpanel">
          <p className={styles.intro}>
            “Ask” stops the agent and creates a Needs You decision with Allow 15 min, Always allow, and Deny choices. The same card can reach your configured hub messaging channels.
          </p>
          <div className={styles.policyRows}>
            {FLEET_MACHINE_ACCESS_CAPABILITIES.map((capability) => (
              <label key={capability.id} className={styles.policyRow}>
                <span>
                  <strong>{capability.label}</strong>
                  <small>{capability.description}</small>
                </span>
                <select
                  value={access[capability.id]}
                  disabled={!canManage || busy}
                  onChange={(event) => setAccess((current) => ({
                    ...current,
                    [capability.id]: event.target.value as FleetMachineAccessPolicy[typeof capability.id],
                  }))}
                  aria-label={`${capability.label} access`}
                >
                  {FLEET_MACHINE_ACCESS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!canManage || busy}
            onClick={() => void mutate({ action: "update", access, performance: snapshot.policy.performance }, "Permissions saved on the collector.")}
          >
            Save permissions
          </Button>
          {!snapshot.policy.authority ? <p className={styles.hint}>Claim this machine in Authority before saving.</p> : null}
        </div>
      ) : null}

      {snapshot && tab === "performance" ? (
        <div className={styles.section} role="tabpanel">
          <div className={styles.routingState} data-eligible={routing.eligible ? "true" : "false"}>
            <strong>{routing.eligible ? "Eligible for Queen Bee routing" : "Paused for Queen Bee routing"}</strong>
            <span>{routing.detail}</span>
          </div>

          <label className={styles.toggleRow}>
            <span><strong>Automatic usage limits</strong><small>Re-evaluate every fresh Fleet discovery.</small></span>
            <input
              type="checkbox"
              checked={performance.enabled}
              disabled={!canManage || busy}
              onChange={(event) => setPerformance((current) => ({ ...current, enabled: event.target.checked }))}
            />
          </label>
          <label className={styles.toggleRow}>
            <span><strong>Ignore this machine</strong><small>Never delegate here, regardless of live usage.</small></span>
            <input
              type="checkbox"
              checked={performance.ignore}
              disabled={!canManage || busy}
              onChange={(event) => setPerformance((current) => ({ ...current, ignore: event.target.checked }))}
            />
          </label>

          <div className={styles.thresholds}>
            {([
              ["CPU", "maxCpuPct", machine.cpu],
              ["RAM", "maxRamPct", machine.ram],
              ["Storage", "maxDiskPct", machine.disk],
            ] as const).map(([label, key, live]) => (
              <label key={key} className={styles.thresholdRow}>
                <span><strong>{label}</strong><small>Live: {Math.round(live)}%</small></span>
                <select
                  value={performance[key]}
                  disabled={!canManage || busy || !performance.enabled}
                  onChange={(event) => setPerformance((current) => ({ ...current, [key]: Number(event.target.value) }))}
                  aria-label={`${label} routing limit`}
                >
                  {THRESHOLD_OPTIONS.map((value) => <option key={value} value={value}>Pause over {value}%</option>)}
                </select>
              </label>
            ))}
          </div>

          <Button
            type="button"
            size="sm"
            disabled={!canManage || busy}
            onClick={() => void mutate({ action: "update", access: snapshot.policy.access, performance }, "Performance routing saved on the collector.")}
          >
            Save routing limits
          </Button>
        </div>
      ) : null}

      {snapshot && tab === "authority" ? (
        <div className={styles.section} role="tabpanel">
          <div className={styles.authorityCard}>
            <LockKeyhole size={17} aria-hidden="true" />
            <div>
              <strong>{snapshot.policy.authority ? "Master hub locked" : "No master hub yet"}</strong>
              <span>
                {snapshot.policy.authority
                  ? `${snapshot.policy.authority.masterHubLabel} is the only hub allowed to change permissions and routing limits.`
                  : "The first hub to claim this collector becomes its policy authority."}
              </span>
            </div>
          </div>
          <dl className={styles.authorityFacts}>
            <div><dt>This hub</dt><dd>{snapshot.caller.label}</dd></div>
            <div><dt>Permission</dt><dd>{snapshot.canManage ? "Can manage" : "Read only"}</dd></div>
            <div><dt>Collector policy</dt><dd>{snapshot.configured ? "Configured" : "Unclaimed"}</dd></div>
          </dl>

          {!snapshot.policy.authority ? (
            <Button type="button" size="sm" disabled={busy || !snapshot.canManage} onClick={() => void mutate({ action: "claim-master" }, "This hub is now the master policy authority.")}>
              Claim as master hub
            </Button>
          ) : snapshot.canManage ? (
            releaseArmed ? (
              <div className={styles.releaseConfirm}>
                <p>Releasing authority lets another hub claim this collector. Existing access and performance settings stay in place.</p>
                <div>
                  <Button type="button" variant="ghost" size="xs" onClick={() => setReleaseArmed(false)}>Cancel</Button>
                  <Button type="button" variant="danger" size="xs" disabled={busy} onClick={() => void mutate({ action: "release-master" }, "Master-hub authority released.")}>Confirm release</Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="ghost" size="sm" onClick={() => setReleaseArmed(true)}>Release master hub</Button>
            )
          ) : (
            <p className={styles.hint}>Open HivemindOS on the master hub to change this machine.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
