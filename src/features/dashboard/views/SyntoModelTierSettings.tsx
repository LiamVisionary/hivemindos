"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { CheckCircle2, Cloud, HardDrive, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { Btn } from "@/components/aeon/parts";
import {
  SYNTO_CLOUD_ENDPOINT_PROVIDERS,
  SYNTO_CLOUD_MODEL_ID,
  SYNTO_CLOUD_PROVIDER,
  SYNTO_DEFAULT_LOCAL_MODEL_ID,
  SYNTO_LOCAL_EXTRA_OPTIONS,
  SYNTO_LOCAL_MODEL_ID_SET,
  SYNTO_LOCAL_ROUTE_OPTIONS,
} from "@/lib/config/synto-model-tiers";
import { HIVEMIND_OS_RUNTIME, type AgentProfile, type SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { RuntimeIntegrationStatus } from "@/features/dashboard/dashboard-types";
import { LmStudioModelManager } from "./chat/LmStudioModelManager";

type SyntoModelTierSettingsProps = {
  sharedVault: SharedVaultConfig;
  updateSharedVault: (patch: { synto: SharedVaultConfig["synto"] }) => void;
  runtimeIntegrationBusy?: string;
  runtimeIntegrationMessage?: string;
  runtimeIntegrationStatus?: RuntimeIntegrationStatus | null;
  refreshRuntimeIntegrations?: (agent?: AgentProfile) => void | Promise<void>;
  runRuntimeIntegrationAction?: (
    action: string,
    input: Record<string, unknown>,
    agent: AgentProfile,
  ) => void | Promise<{ ok?: boolean; error?: string; message?: string } | void>;
};

const cloudSummary = [
  "$0.09/M input",
  "$0.10/M output",
  "262k context on the base DeepInfra route",
].join(" · ");

function settingCardStyle(active: boolean): CSSProperties {
  return {
    display: "grid",
    gap: 8,
    alignContent: "start",
    padding: "12px 13px",
    borderRadius: 8,
    border: `1px solid ${active ? "rgba(94,234,212,0.68)" : "var(--line)"}`,
    background: active ? "rgba(45,212,191,0.12)" : "rgba(15,23,42,0.36)",
    boxShadow: active ? "0 0 0 1px rgba(94,234,212,0.14) inset" : "none",
    minWidth: 0,
  };
}

function pillStyle(tone: "accent" | "muted" | "warn" = "muted"): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    width: "fit-content",
    padding: "2px 7px",
    borderRadius: 999,
    border: `1px solid ${tone === "accent" ? "rgba(94,234,212,0.42)" : tone === "warn" ? "rgba(251,191,36,0.34)" : "var(--line)"}`,
    color: tone === "accent" ? "var(--accent-strong)" : tone === "warn" ? "#facc15" : "var(--fg-4)",
    background: tone === "accent" ? "rgba(20,184,166,0.08)" : tone === "warn" ? "rgba(251,191,36,0.08)" : "rgba(2,6,23,0.2)",
    fontSize: 10.5,
    fontWeight: 800,
    lineHeight: 1.3,
  };
}

function SyntoSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

export function SyntoModelTierSettings({
  sharedVault,
  updateSharedVault,
  runtimeIntegrationBusy = "",
  runtimeIntegrationMessage = "",
  runtimeIntegrationStatus,
  refreshRuntimeIntegrations,
  runRuntimeIntegrationAction,
}: SyntoModelTierSettingsProps) {
  const synto = sharedVault.synto;
  const selectedRoute = synto.modelRoute ?? "cloud-best";
  const selectedLocalModelId = synto.localModelId || SYNTO_DEFAULT_LOCAL_MODEL_ID;
  const selectedRuntimeModelId = synto.localLoadedModelKey || selectedLocalModelId;
  const cloudRequireZdr = synto.cloudRequireZdr !== false;
  const lmStudioStatus = runtimeIntegrationStatus?.providerStatus?.lmStudio;
  const requestedStatusRef = useRef(false);
  const catalogIdByModelKey = useMemo(() => {
    const pairs = new Map<string, string>();
    for (const entry of lmStudioStatus?.catalog ?? []) {
      pairs.set(entry.id, entry.id);
      pairs.set(entry.filename, entry.id);
      if (entry.installedModelKey) pairs.set(entry.installedModelKey, entry.id);
      for (const key of entry.matchKeys ?? []) pairs.set(key, entry.id);
    }
    return pairs;
  }, [lmStudioStatus?.catalog]);

  const localAgent = useMemo<AgentProfile>(() => ({
    id: "synto-local-model-manager",
    name: "Syntho Local Models",
    runtime: HIVEMIND_OS_RUNTIME,
    provider: "lm-studio",
    gatewayUrl: "http://127.0.0.1:1234",
    chatPath: "/v1/chat/completions",
    statusPath: "/v1/models",
    model: selectedLocalModelId,
  }), [selectedLocalModelId]);

  useEffect(() => {
    if (selectedRoute === "cloud-best" || requestedStatusRef.current || !refreshRuntimeIntegrations || lmStudioStatus || runtimeIntegrationBusy === "status") return;
    requestedStatusRef.current = true;
    void refreshRuntimeIntegrations(localAgent);
  }, [lmStudioStatus, localAgent, refreshRuntimeIntegrations, runtimeIntegrationBusy, selectedRoute]);

  const updateSynto = (patch: Partial<SharedVaultConfig["synto"]>) => {
    updateSharedVault({ synto: { ...synto, ...patch } });
  };

  const selectCloud = () => {
    updateSynto({
      modelRoute: "cloud-best",
      cloudProvider: SYNTO_CLOUD_PROVIDER,
      cloudModel: SYNTO_CLOUD_MODEL_ID,
      cloudRequireZdr,
      compareHeavyModel: SYNTO_CLOUD_MODEL_ID,
    });
  };

  const selectLocalTier = (option: typeof SYNTO_LOCAL_ROUTE_OPTIONS[number]) => {
    updateSynto({
      modelRoute: option.route,
      localProvider: "lm-studio",
      localModelId: option.modelId,
      localLoadedModelKey: "",
      compareHeavyModel: option.compareModel,
    });
  };

  const selectLocalModel = (modelKey: string) => {
    const catalogModelId = catalogIdByModelKey.get(modelKey) || modelKey;
    const route = catalogModelId === "synto-qwen3-5-9b-q4-k-m" ? "local-light" : "local-recommended";
    const compareHeavyModel = catalogModelId === "synto-qwen3-6-27b-q4-k-m"
      ? "qwen3.6:27b"
      : catalogModelId === "synto-qwen3-6-35b-a3b-q4-k-m"
        ? "qwen3.6:35b-a3b"
        : catalogModelId === "synto-qwen3-5-9b-q4-k-m"
          ? "qwen3.5:9b"
          : "qwen3:30b";
    updateSynto({
      modelRoute: route,
      localProvider: "lm-studio",
      localModelId: catalogModelId,
      localLoadedModelKey: catalogModelId === modelKey ? "" : modelKey,
      compareHeavyModel,
    });
  };

  const loadLocalModel = async (modelKey: string, modelType?: string) => {
    selectLocalModel(modelKey);
    if (!runRuntimeIntegrationAction) return;
    await runRuntimeIntegrationAction("load-model", { model: modelKey, type: modelType || "llm" }, localAgent);
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <SyntoSectionLabel>Model route</SyntoSectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 9 }}>
          <div style={settingCardStyle(selectedRoute === "cloud-best")}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span style={{ ...pillStyle("accent"), textTransform: "uppercase" }}><Cloud size={12} aria-hidden="true" /> Best cloud</span>
              {selectedRoute === "cloud-best" ? <CheckCircle2 size={15} color="var(--accent-strong)" aria-hidden="true" /> : null}
            </div>
            <div style={{ display: "grid", gap: 3 }}>
              <strong style={{ color: "var(--fg)", fontSize: 13.5, lineHeight: 1.25 }}>Pay as you go: Qwen3 235B</strong>
              <span style={{ color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.4, overflowWrap: "anywhere" }}>{SYNTO_CLOUD_MODEL_ID}</span>
            </div>
            <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 12, lineHeight: 1.45 }}>{cloudSummary}</p>
            <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.45 }}>
              Providers currently include {SYNTO_CLOUD_ENDPOINT_PROVIDERS.join(", ")}. OpenRouter prompt/response logging is off by default, but provider endpoint policies vary.
            </p>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, color: "var(--fg-3)", fontSize: 11.5, lineHeight: 1.4 }}>
              <input
                type="checkbox"
                checked={cloudRequireZdr}
                onChange={(event) => updateSynto({ cloudRequireZdr: event.target.checked })}
                style={{ marginTop: 2 }}
              />
              <span>Prefer ZDR-only routing. Enforce the same policy in OpenRouter privacy settings before using sensitive notes.</span>
            </label>
            <div style={{ ...pillStyle("warn"), alignItems: "flex-start", borderRadius: 8, width: "auto" }}>
              <TriangleAlert size={12} style={{ marginTop: 1, flexShrink: 0 }} aria-hidden="true" />
              <span>Syntho 0.4 cannot enforce OpenRouter ZDR per request, so this records your policy but does not prove endpoint compliance.</span>
            </div>
            <Btn variant={selectedRoute === "cloud-best" ? "ghost" : "primary"} size="sm" onClick={selectCloud}>
              <Sparkles size={13} aria-hidden="true" />
              {selectedRoute === "cloud-best" ? "Selected" : "Use cloud tier"}
            </Btn>
          </div>

          {SYNTO_LOCAL_ROUTE_OPTIONS.map((option) => {
            const active = selectedRoute === option.route && selectedLocalModelId === option.modelId;
            return (
              <div key={option.route} style={settingCardStyle(active)}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ ...pillStyle(option.route === "local-recommended" ? "accent" : "muted"), textTransform: "uppercase" }}>
                    <HardDrive size={12} aria-hidden="true" /> {option.title}
                  </span>
                  {active ? <CheckCircle2 size={15} color="var(--accent-strong)" aria-hidden="true" /> : null}
                </div>
                <div style={{ display: "grid", gap: 3 }}>
                  <strong style={{ color: "var(--fg)", fontSize: 13.5, lineHeight: 1.25 }}>{option.subtitle}</strong>
                  <span style={{ color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.4 }}>{option.sizeLabel} · {option.ramLabel}</span>
                </div>
                <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 12, lineHeight: 1.45 }}>{option.description}</p>
                <Btn variant={active ? "ghost" : "primary"} size="sm" onClick={() => selectLocalTier(option)}>
                  <HardDrive size={13} aria-hidden="true" />
                  {active ? "Selected" : "Use local tier"}
                </Btn>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, padding: "10px 11px", borderRadius: 8, border: "1px solid var(--line)", background: "rgba(2,6,23,0.18)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <SyntoSectionLabel>Privacy posture</SyntoSectionLabel>
          <span style={pillStyle("accent")}><ShieldCheck size={12} aria-hidden="true" /> Local tiers stay on-device</span>
        </div>
        <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 12, lineHeight: 1.45 }}>
          Cloud tier is the quality ceiling and paid-feature candidate. Local tiers avoid cloud provider collection and use the same LM Studio download/load flow as Swarm Scout.
        </p>
      </div>

      {selectedRoute !== "cloud-best" ? <div style={{ display: "grid", gap: 7 }}>
        <SyntoSectionLabel>Extra local candidates</SyntoSectionLabel>
        <div style={{ display: "grid", gap: 7 }}>
          {SYNTO_LOCAL_EXTRA_OPTIONS.map((option) => {
            const active = selectedLocalModelId === option.modelId;
            return (
              <div key={option.modelId} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: "9px 10px", borderRadius: 9, border: `1px solid ${active ? "rgba(94,234,212,0.68)" : "var(--line)"}`, background: active ? "rgba(45,212,191,0.1)" : "rgba(15,23,42,0.3)" }}>
                <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                  <strong style={{ color: "var(--fg)", fontSize: 12.5, lineHeight: 1.25, overflowWrap: "anywhere" }}>{option.title}</strong>
                  <span style={{ color: "var(--fg-4)", fontSize: 11, lineHeight: 1.35 }}>{option.sizeLabel} · {option.ramLabel}</span>
                  <span style={{ color: "var(--fg-3)", fontSize: 11.5, lineHeight: 1.4 }}>{option.description}</span>
                </div>
                <Btn variant={active ? "ghost" : "primary"} size="sm" onClick={() => selectLocalModel(option.modelId)}>
                  {active ? "Selected" : "Use"}
                </Btn>
              </div>
            );
          })}
        </div>
      </div> : null}

      {selectedRoute !== "cloud-best" && refreshRuntimeIntegrations && runRuntimeIntegrationAction ? (
        <LmStudioModelManager
          agent={localAgent}
          busy={runtimeIntegrationBusy}
          discoveryPending={runtimeIntegrationBusy === "status"}
          lmStudioStatus={lmStudioStatus}
          modelOptions={[]}
          selectedModelId={selectedRuntimeModelId}
          refreshRuntimeIntegrations={refreshRuntimeIntegrations}
          runRuntimeIntegrationAction={runRuntimeIntegrationAction}
          onLoadModel={loadLocalModel}
          onSelectModel={selectLocalModel}
          catalogFilter={(entry) => SYNTO_LOCAL_MODEL_ID_SET.has(entry.id)}
        />
      ) : null}

      {selectedRoute !== "cloud-best" && runtimeIntegrationMessage ? (
        <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.4, overflowWrap: "anywhere" }}>{runtimeIntegrationMessage}</p>
      ) : null}

    </div>
  );
}
