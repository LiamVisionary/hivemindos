"use client";

import { useMemo, useState } from "react";
import { Activity, Check, Cpu, Flame, Gauge, HardDrive, Repeat2, Server, TriangleAlert, Zap } from "lucide-react";
import { Btn } from "@/components/aeon/parts";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { NormalizedSieModel, SieProviderStatus } from "@/lib/services/runtime-adapters/sie";
import styles from "./SieModelManager.module.css";

type SieModelManagerProps = {
  agent: AgentProfile | null | undefined;
  busy: string;
  status?: SieProviderStatus;
  selectedModelId?: string;
  onSelectModel?: (modelKey: string) => void;
  onEndpointChange?: (baseUrl: string) => void | Promise<void>;
  refreshRuntimeIntegrations: (agent?: AgentProfile) => void | Promise<void>;
  runRuntimeIntegrationAction: (
    action: string,
    input: Record<string, unknown>,
    agent: AgentProfile,
  ) => void | Promise<{ ok?: boolean; error?: string; message?: string } | void>;
};

const ALL_TASKS = "all";

function formatBytes(value?: number) {
  if (!value || !Number.isFinite(value)) return "0 GB";
  return `${(value / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
}

function formatContext(value?: number) {
  if (!value || !Number.isFinite(value)) return "";
  return value >= 1_000 ? `${Math.round(value / 1_000)}k context` : `${value} context`;
}

function stateLabel(model: NormalizedSieModel) {
  if (model.state === "loaded") return "Warm";
  if (model.state === "loading") return "Warming";
  if (model.state === "unloading") return "Evicting";
  if (model.state === "failed") return "Failed";
  return "Lazy";
}

function capabilityLabels(model: NormalizedSieModel) {
  const capabilities = model.capabilities;
  if (!capabilities) return [];
  return [
    capabilities.tools ? "Tools" : "",
    capabilities.code ? "Code" : "",
    capabilities.sql ? "SQL" : "",
    capabilities.guard ? "Guard" : "",
    capabilities.grammar?.length ? `Grammar: ${capabilities.grammar.join(", ")}` : "",
    capabilities.loraAdapters?.length ? `${capabilities.loraAdapters.length} LoRA` : "",
  ].filter(Boolean);
}

export function SieModelManager({
  agent,
  busy,
  status,
  selectedModelId = "",
  onSelectModel,
  onEndpointChange,
  refreshRuntimeIntegrations,
  runRuntimeIntegrationAction,
}: SieModelManagerProps) {
  const [taskFilter, setTaskFilter] = useState(ALL_TASKS);
  const [activeModelKey, setActiveModelKey] = useState("");
  const [endpointDraft, setEndpointDraft] = useState("");
  const endpointValue = endpointDraft || status?.baseUrl || agent?.gatewayUrl || "http://127.0.0.1:8080";

  const taskOptions = useMemo(() => {
    const tasks = new Set((status?.models ?? []).flatMap((model) => model.tasks));
    return [ALL_TASKS, ...[...tasks].sort()];
  }, [status?.models]);
  const models = useMemo(() => (status?.models ?? [])
    .filter((model) => taskFilter === ALL_TASKS || model.tasks.includes(taskFilter))
    .sort((left, right) => {
      const selectedDelta = Number(right.key === selectedModelId) - Number(left.key === selectedModelId);
      const loadedDelta = Number(right.loaded) - Number(left.loaded);
      return selectedDelta || loadedDelta || left.displayName.localeCompare(right.displayName);
    }), [selectedModelId, status?.models, taskFilter]);
  const workers = status?.workers ?? [];
  const healthyWorkers = workers.filter((worker) => worker.healthy).length;
  const queued = workers.reduce((total, worker) => total + worker.queueDepth, 0);
  const actionBusy = busy === "warm-model" || busy === "smoke-test-local-model";

  async function runModelAction(action: "warm-model" | "smoke-test-local-model", model: NormalizedSieModel) {
    if (!agent || actionBusy) return;
    setActiveModelKey(model.key);
    try {
      await runRuntimeIntegrationAction(action, { model: model.key }, agent);
    } finally {
      setActiveModelKey("");
    }
  }

  async function applyEndpoint() {
    const baseUrl = endpointValue.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
    if (!baseUrl || baseUrl === status?.baseUrl) return;
    await onEndpointChange?.(baseUrl);
    setEndpointDraft("");
  }

  return (
    <section className={styles.shell} aria-label="SIE model runtime">
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Shared GPU runtime</span>
          <h3 className={styles.title}>SIE models</h3>
          <p className={styles.intro}>Models load on first use. SIE keeps hot models resident and evicts them automatically when GPU demand changes.</p>
        </div>
        <Btn variant="ghost" size="sm" disabled={busy === "status"} onClick={() => refreshRuntimeIntegrations(agent ?? undefined)}>
          <Repeat2 size={13} className={busy === "status" ? "animate-spin" : undefined} aria-hidden="true" /> Refresh
        </Btn>
      </div>

      <div className={styles.endpointRow}>
        <label className={styles.endpointField}>
          <span>Gateway URL</span>
          <input
            type="url"
            value={endpointValue}
            spellCheck={false}
            placeholder="http://127.0.0.1:8080"
            onChange={(event) => setEndpointDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void applyEndpoint();
              }
            }}
          />
        </label>
        <Btn variant="ghost" size="sm" disabled={!endpointValue.trim() || endpointValue.trim().replace(/\/+$/, "").replace(/\/v1$/, "") === status?.baseUrl} onClick={() => void applyEndpoint()}>
          Apply
        </Btn>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <Server aria-hidden="true" />
          <span><strong>{healthyWorkers}/{workers.length}</strong> workers healthy</span>
        </div>
        <div className={styles.stat}>
          <Cpu aria-hidden="true" />
          <span><strong>{status?.cluster.gpuCount ?? 0}</strong> GPUs</span>
        </div>
        <div className={styles.stat}>
          <Flame aria-hidden="true" />
          <span><strong>{status?.cluster.modelsLoaded ?? 0}</strong> models warm</span>
        </div>
        <div className={styles.stat}>
          <Activity aria-hidden="true" />
          <span><strong>{queued}</strong> queued</span>
        </div>
      </div>

      {workers.length ? (
        <div className={styles.workerGrid} aria-label="SIE workers">
          {workers.map((worker) => {
            const memoryPercent = worker.memoryTotalBytes > 0
              ? Math.min(100, Math.round((worker.memoryUsedBytes / worker.memoryTotalBytes) * 100))
              : 0;
            return (
              <article className={styles.worker} key={worker.url || worker.name}>
                <div className={styles.workerHead}>
                  <span className={styles.workerName}><HardDrive aria-hidden="true" />{worker.name}</span>
                  <span className={styles.health} data-healthy={worker.healthy || undefined}>{worker.healthy ? "Healthy" : "Offline"}</span>
                </div>
                <div className={styles.workerMeta}>{[worker.gpu, worker.gpuCount ? `${worker.gpuCount} GPU${worker.gpuCount === 1 ? "" : "s"}` : "", worker.bundle].filter(Boolean).join(" · ")}</div>
                <div className={styles.memoryLine}>
                  <span>{formatBytes(worker.memoryUsedBytes)} / {formatBytes(worker.memoryTotalBytes)}</span>
                  <span>{memoryPercent}% VRAM</span>
                </div>
                <span className={styles.memoryTrack}><span style={{ width: `${memoryPercent}%` }} /></span>
                <div className={styles.workerMeta}>{worker.loadedModels.length ? `Warm: ${worker.loadedModels.join(", ")}` : "No models resident"}</div>
              </article>
            );
          })}
        </div>
      ) : null}

      {status?.error ? (
        <div className={styles.notice} data-tone="error">
          <TriangleAlert aria-hidden="true" />
          <div><strong>SIE is not reachable</strong><span>{status.error}</span></div>
        </div>
      ) : status?.healthError ? (
        <div className={styles.notice}>
          <Gauge aria-hidden="true" />
          <div><strong>Models found; cluster telemetry unavailable</strong><span>{status.healthError}</span></div>
        </div>
      ) : null}

      <div className={styles.inventoryHead}>
        <div>
          <span className={styles.eyebrow}>Inventory</span>
          <span className={styles.inventoryCount}>{status?.models.length ?? 0} configured</span>
        </div>
        {taskOptions.length > 2 ? (
          <div className={styles.filters} role="group" aria-label="Filter SIE models by task">
            {taskOptions.map((task) => (
              <button key={task} type="button" aria-pressed={taskFilter === task} data-active={taskFilter === task || undefined} onClick={() => setTaskFilter(task)}>
                {task === ALL_TASKS ? "All" : task}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.modelList}>
        {models.length ? models.map((model) => {
          const selected = selectedModelId === model.key;
          const currentAction = actionBusy && activeModelKey === model.key;
          const dimensions = model.dims ? Object.entries(model.dims).map(([name, value]) => `${name} ${value}`).join(" · ") : "";
          const capabilities = capabilityLabels(model);
          return (
            <article className={styles.model} data-selected={selected || undefined} key={model.key}>
              <div className={styles.modelBody}>
                <div className={styles.modelTitleRow}>
                  <span className={styles.modelName}>{model.displayName}</span>
                  <span className={styles.state} data-state={model.state}>{stateLabel(model)}</span>
                  {selected ? <span className={styles.selected}><Check aria-hidden="true" />Selected</span> : null}
                </div>
                <div className={styles.chips}>
                  {model.tasks.map((task) => <span key={task}>{task}</span>)}
                  {capabilities.map((capability) => <span key={capability}>{capability}</span>)}
                </div>
                <div className={styles.modelMeta}>
                  {[model.inputs.length ? `In: ${model.inputs.join(", ")}` : "", model.outputs.length ? `Out: ${model.outputs.join(", ")}` : "", formatContext(model.maxContextLength), dimensions, model.profiles.length ? `${model.profiles.length} profile${model.profiles.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}
                </div>
                {model.lastError ? <div className={styles.modelError}>{model.lastError}</div> : null}
                {!model.chatCompatible ? <div className={styles.modelHint}>Visible for runtime management; chat agents can only select SIE generation models.</div> : null}
              </div>
              <div className={styles.actions}>
                {model.chatCompatible ? (
                  <Btn variant={selected ? "ghost" : "primary"} size="sm" disabled={selected} onClick={() => onSelectModel?.(model.key)}>
                    {selected ? <Check size={13} aria-hidden="true" /> : null}{selected ? "Using" : "Use"}
                  </Btn>
                ) : null}
                {model.canWarm ? (
                  <Btn variant="ghost" size="sm" disabled={actionBusy} onClick={() => void runModelAction(model.loaded && model.chatCompatible ? "smoke-test-local-model" : "warm-model", model)}>
                    {currentAction ? <Repeat2 size={13} className="animate-spin" aria-hidden="true" /> : model.loaded ? <Zap size={13} aria-hidden="true" /> : <Flame size={13} aria-hidden="true" />}
                    {currentAction ? "Working" : model.loaded && model.chatCompatible ? "Test" : model.loaded ? "Warm" : "Warm now"}
                  </Btn>
                ) : model.state === "loading" || model.state === "unloading" ? (
                  <span className={styles.lifecycle}><Repeat2 size={13} className="animate-spin" aria-hidden="true" />{stateLabel(model)}</span>
                ) : null}
              </div>
            </article>
          );
        }) : busy === "status" ? (
          <div className={styles.empty}><Repeat2 className="animate-spin" aria-hidden="true" />Discovering SIE models</div>
        ) : (
          <div className={styles.empty}>No models are configured at this SIE endpoint.</div>
        )}
      </div>
    </section>
  );
}
