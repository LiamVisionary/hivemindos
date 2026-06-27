"use client";

import { Repeat2 } from "lucide-react";
import { Btn } from "@/components/aeon/parts";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { RuntimeIntegrationStatus } from "@/features/dashboard/dashboard-types";
import type { RuntimeModelDraft } from "@/features/dashboard/agent-settings-types";

const inputStyle = {
  width: "100%",
  minWidth: 0,
  border: "1px solid var(--line-2)",
  borderRadius: 9,
  background: "rgba(2,6,23,0.48)",
  color: "var(--fg)",
  fontFamily: "var(--f-body)",
  fontSize: 13,
  outline: "none",
  padding: "9px 12px",
};

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 9 }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ color: "var(--fg-3)", fontSize: 12, fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );
}

type LmStudioModelManagerProps = {
  agent: AgentProfile | null | undefined;
  busy: string;
  discoveryPending?: boolean;
  lmStudioStatus?: NonNullable<RuntimeIntegrationStatus["providerStatus"]>["lmStudio"];
  modelOptions: Array<{ id: string; name?: string; subtitle?: string; group?: string; badge?: string }>;
  pendingLoadModelKeys?: string[];
  runtimeModelDraft: RuntimeModelDraft;
  setRuntimeModelDraft: React.Dispatch<React.SetStateAction<RuntimeModelDraft>>;
  refreshRuntimeIntegrations: (agent?: AgentProfile) => void | Promise<void>;
  runRuntimeIntegrationAction: (action: string, input: Record<string, unknown>, agent: AgentProfile) => void | Promise<{ ok?: boolean; error?: string; message?: string } | void>;
  onLoadModel?: (modelKey: string, modelType?: string) => Promise<void>;
};

export function LmStudioLoadProgress({ label = "Loading on device" }: { label?: string }) {
  return (
    <div style={{ display: "grid", gap: 5, minWidth: 140 }}>
      <span style={{ color: "var(--fg-3)", fontSize: 11, fontWeight: 700 }}>{label}</span>
      <span style={{ display: "block", height: 5, overflow: "hidden", borderRadius: 999, background: "rgba(148,163,184,0.18)" }}>
        <span style={{ display: "block", height: "100%", width: "62%", borderRadius: 999, background: "linear-gradient(90deg, rgba(94,234,212,0.38), rgba(94,234,212,0.92), rgba(125,211,252,0.72))", animation: "lmStudioLoadSweep 1.4s ease-in-out infinite" }} />
      </span>
      <style>{`@keyframes lmStudioLoadSweep{0%{transform:translateX(-85%)}50%{transform:translateX(48%)}100%{transform:translateX(165%)}}`}</style>
    </div>
  );
}

export function LmStudioModelManager({
  agent,
  busy,
  discoveryPending = false,
  lmStudioStatus,
  modelOptions,
  pendingLoadModelKeys = [],
  runtimeModelDraft,
  setRuntimeModelDraft,
  refreshRuntimeIntegrations,
  runRuntimeIntegrationAction,
  onLoadModel,
}: LmStudioModelManagerProps) {
  const inventoryModels = lmStudioStatus?.models ?? [];
  const fallbackModels = inventoryModels.length ? [] : modelOptions.map((model) => ({
    key: model.id,
    displayName: model.name || model.id,
    type: "llm",
    loaded: model.subtitle === "Loaded",
    loadedInstanceIds: [] as string[],
    paramsString: model.group,
    format: null,
    remote: model.badge === "LM Link",
  }));
  const models = inventoryModels.length ? inventoryModels : fallbackModels;
  const actionBusy = busy === "load-model" || busy === "unload-model";
  const loadModel = async (modelKey: string, modelType?: string) => {
    if (!agent) return;
    if (onLoadModel) {
      await onLoadModel(modelKey, modelType);
      return;
    }
    const contextLength = runtimeModelDraft.contextLength.trim();
    await runRuntimeIntegrationAction("load-model", {
      model: modelKey,
      contextLength: modelType === "embedding" || !contextLength ? undefined : Number(contextLength),
    }, agent);
  };
  const unloadModel = async (instanceId: string) => {
    if (!agent) return;
    await runRuntimeIntegrationAction("unload-model", { instanceId }, agent);
  };

  return (
    <div style={{ display: "grid", gap: 9, border: "1px solid var(--line)", borderRadius: 11, background: "var(--panel-bg-soft)", padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <GroupLabel>LM Studio models</GroupLabel>
        <Btn variant="ghost" size="sm" disabled={busy === "status"} onClick={() => refreshRuntimeIntegrations(agent ?? undefined)}>
          <Repeat2 size={13} className={busy === "status" ? "animate-spin" : undefined} aria-hidden="true" /> Refresh
        </Btn>
      </div>
      <Field label="Context length">
        <input
          value={runtimeModelDraft.contextLength}
          onChange={(event) => setRuntimeModelDraft((current) => ({ ...current, contextLength: event.target.value }))}
          placeholder="Default"
          inputMode="numeric"
          style={inputStyle}
        />
      </Field>
      {lmStudioStatus?.error ? (
        <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 12, lineHeight: 1.45 }}>{lmStudioStatus.error}</p>
      ) : null}
      <div style={{ display: "grid", gap: 7 }}>
        {models.length ? models.map((model) => {
          const instanceId = model.loadedInstanceIds?.[0] || model.key;
          const loading = pendingLoadModelKeys.includes(model.key) && !model.loaded;
          return (
            <div key={model.key} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: "9px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "rgba(2,6,23,0.24)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--fg)", fontSize: 12.5, fontWeight: 750, overflowWrap: "anywhere" }}>{model.displayName || model.key}</span>
                  <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", padding: "1px 6px", borderRadius: 999, border: `1px solid ${model.remote ? "var(--aeon-line)" : "var(--line)"}`, color: model.remote ? "var(--cyan-3)" : "var(--fg-4)", background: model.remote ? "var(--aeon-soft)" : "transparent" }}>
                    {model.remote ? "LM Link" : "Local"}
                  </span>
                </div>
                <div style={{ marginTop: 2, color: "var(--fg-4)", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                  {[model.key, model.paramsString, model.format, model.loaded ? "Loaded" : loading ? "Loading" : model.remote ? "Available" : "Downloaded"].filter(Boolean).join(" · ")}
                </div>
              </div>
              {model.remote ? (
                <span style={{ color: "var(--fg-4)", fontSize: 11 }}>Managed on host</span>
              ) : loading ? (
                <LmStudioLoadProgress />
              ) : model.loaded ? (
                <Btn variant="ghost" size="sm" disabled={actionBusy} onClick={() => void unloadModel(instanceId)}>Unload</Btn>
              ) : (
                <Btn variant="primary" size="sm" disabled={actionBusy} onClick={() => void loadModel(model.key, model.type)}>Load</Btn>
              )}
            </div>
          );
        }) : (
          <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 12, lineHeight: 1.45 }}>
            {busy === "status" || discoveryPending ? "Loading LM Studio inventory..." : "No LM Studio model inventory reported by this machine."}
          </p>
        )}
      </div>
    </div>
  );
}
