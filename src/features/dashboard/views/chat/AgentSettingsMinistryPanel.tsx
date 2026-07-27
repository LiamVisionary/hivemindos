"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, BrainCircuit, Crown, GripVertical, Network, RefreshCcw, Sparkles, Zap } from "lucide-react";
import { MODEL_PROVIDER_GATEWAYS, modelProviderGateway } from "@/lib/config/model-provider-gateways";
import { PROVIDER_CATALOG, type ProviderCatalogEntry } from "@/lib/config/provider-catalog";
import {
  AGENT_MINISTRY_EFFORTS,
  type AgentCallPreferences,
  type AgentMinistryEffort,
  type AgentMinistryPreferences,
  type AgentMinistrySlotConfig,
  type AgentProfile,
} from "@/lib/types/agent-runtime";
import { Badge, Field, GroupLabel, PanelHead, Toggle } from "./AgentSettingsModalPrimitives";
import styles from "./AgentSettingsCallsPanel.module.css";

type AgentSettingsMinistryPanelProps = {
  agentCallSettings: AgentCallPreferences;
  displayAgents: AgentProfile[];
  roleModalAgent: AgentProfile | null;
  updateAgentCalls: (patch: Partial<AgentCallPreferences>) => void;
};

type SeatTarget = "orchestrator" | "expert-0" | "expert-1" | "expert-2";

type ProviderModelsResponse = {
  ok?: boolean;
  models?: Array<{ id?: string }>;
  error?: string;
};

type MinistryPointerDrag = {
  active: boolean;
  pointerId: number;
  slot: AgentMinistrySlotConfig;
  startX: number;
  startY: number;
  title: string;
};

const EFFORT_COPY: Record<AgentMinistryEffort, { label: string; sub: string }> = {
  fast: { label: "Fast", sub: "Short routing pass" },
  balanced: { label: "Balanced", sub: "Default council pass" },
  deep: { label: "Deep", sub: "More critique and synthesis" },
  council: { label: "Council", sub: "Ask every seated expert" },
};

const SEAT_LABELS: Record<SeatTarget, string> = {
  orchestrator: "Frontier orchestrator",
  "expert-0": "Expert 1",
  "expert-1": "Expert 2",
  "expert-2": "Expert 3",
};

function slotIsSet(slot?: AgentMinistrySlotConfig) {
  return Boolean(slot?.kind === "agent" ? slot.agentId : slot?.provider || slot?.model);
}

function isSeatTarget(value: string | null): value is SeatTarget {
  return value === "orchestrator" || value === "expert-0" || value === "expert-1" || value === "expert-2";
}

function slotSummary(slot: AgentMinistrySlotConfig | undefined, agentsById: Map<string, AgentProfile>, providersBySlug: Map<string, ProviderCatalogEntry>) {
  if (!slotIsSet(slot)) {
    return { title: "Empty slot", sub: "Drop a model or agent here.", kind: "empty" };
  }
  if (slot?.kind === "agent") {
    const agent = agentsById.get(slot.agentId ?? "");
    return {
      title: agent?.name ?? "Agent config",
      sub: [agent?.runtime, agent?.provider, agent?.model].filter(Boolean).join(" · ") || "Full agent profile",
      kind: "agent",
    };
  }
  const provider = providersBySlug.get(slot?.provider ?? "");
  return {
    title: slot?.model || provider?.name || "Model",
    sub: [provider?.name ?? slot?.provider, slot?.provider && slot?.model ? "provider route" : ""].filter(Boolean).join(" · "),
    kind: "model",
  };
}

function uniqueModels(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function fallbackModels(provider: string) {
  const gateway = modelProviderGateway(provider);
  return uniqueModels([
    gateway?.defaultModel,
    ...(gateway?.hermes?.models ?? []),
    MODEL_PROVIDER_GATEWAYS[provider]?.defaultModel,
  ]);
}

function providerMark(provider?: ProviderCatalogEntry) {
  if (!provider) return <span className={styles.ministryMark}>AI</span>;
  if (!provider.iconPath) return <span className={styles.ministryMark}>{provider.fallback}</span>;
  return (
    <span className={styles.ministryMark} aria-hidden="true">
      <span
        className={styles.ministryProviderIcon}
        data-mode={provider.iconMode}
        style={provider.iconMode === "mask"
          ? { WebkitMask: `url(${provider.iconPath}) center / contain no-repeat`, mask: `url(${provider.iconPath}) center / contain no-repeat` }
          : { backgroundImage: `url(${provider.iconPath})` }}
      />
    </span>
  );
}

export function AgentSettingsMinistryPanel({
  agentCallSettings,
  displayAgents,
  roleModalAgent,
  updateAgentCalls,
}: AgentSettingsMinistryPanelProps) {
  const ministry = agentCallSettings.ministry;
  const providersBySlug = useMemo(() => new Map(PROVIDER_CATALOG.map((provider) => [provider.slug, provider])), []);
  const availableAgents = useMemo(
    () => displayAgents.filter((agent) => agent.id !== roleModalAgent?.id),
    [displayAgents, roleModalAgent?.id],
  );
  const agentsById = useMemo(() => new Map(availableAgents.map((agent) => [agent.id, agent])), [availableAgents]);
  const initialProvider = ministry.orchestrator.provider || ministry.experts.find((slot) => slot.provider)?.provider || PROVIDER_CATALOG[0]?.slug || "";
  const [selectedProvider, setSelectedProvider] = useState(initialProvider);
  const [selectedModel, setSelectedModel] = useState(ministry.orchestrator.model || "");
  const [selectedAgentId, setSelectedAgentId] = useState(availableAgents[0]?.id ?? "");
  const [modelOptions, setModelOptions] = useState<string[]>(() => fallbackModels(initialProvider));
  const [modelStatus, setModelStatus] = useState<"idle" | "loading" | "ready" | "error">(initialProvider ? "loading" : "idle");
  const [modelMessage, setModelMessage] = useState("");
  const [selectedSeat, setSelectedSeat] = useState<SeatTarget | null>(null);
  const [dragOverSeat, setDragOverSeat] = useState<SeatTarget | null>(null);
  const [dragPreview, setDragPreview] = useState<{ title: string; x: number; y: number } | null>(null);
  const pointerDragRef = useRef<MinistryPointerDrag | null>(null);

  useEffect(() => {
    if (!selectedProvider) return undefined;
    const controller = new AbortController();
    const fallback = fallbackModels(selectedProvider);
    fetch(`/api/providers/models?provider=${encodeURIComponent(selectedProvider)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.json().catch(() => null) as Promise<ProviderModelsResponse | null>)
      .then((data) => {
        if (controller.signal.aborted) return;
        const liveModels = uniqueModels((data?.models ?? []).map((model) => model.id));
        const nextModels = liveModels.length ? liveModels : fallback;
        setModelOptions(nextModels);
        setSelectedModel((current) => (current && nextModels.includes(current) ? current : nextModels[0] ?? ""));
        setModelStatus(data?.ok && liveModels.length ? "ready" : fallback.length ? "error" : "ready");
        setModelMessage(data?.ok ? "" : data?.error || (fallback.length ? "Using provider defaults until live discovery is available." : "No model list is available for this provider yet."));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setModelOptions(fallback);
        setSelectedModel((current) => (current && fallback.includes(current) ? current : fallback[0] ?? ""));
        setModelStatus("error");
        setModelMessage(error instanceof Error ? error.message : "Model discovery failed.");
      });
    return () => controller.abort();
  }, [selectedProvider]);

  const setMinistry = (next: AgentMinistryPreferences) => updateAgentCalls({ ministry: next });
  const patchMinistry = (patch: Partial<AgentMinistryPreferences>) => setMinistry({ ...ministry, ...patch });
  const selectProvider = (provider: string) => {
    const fallback = fallbackModels(provider);
    setSelectedProvider(provider);
    setModelOptions(fallback);
    setSelectedModel((current) => (current && fallback.includes(current) ? current : fallback[0] ?? ""));
    setModelStatus(provider ? "loading" : "idle");
    setModelMessage("");
  };

  const assignSlot = (target: SeatTarget, slot: AgentMinistrySlotConfig) => {
    if (target === "orchestrator") {
      patchMinistry({ orchestrator: slot });
      return;
    }
    const expertIndex = Number(target.split("-")[1]);
    patchMinistry({
      experts: ministry.experts.map((expert, index) => (index === expertIndex ? slot : expert)),
    });
  };

  const clearSlot = (target: SeatTarget) => assignSlot(target, {});
  const selectSeat = (target: SeatTarget, slot: AgentMinistrySlotConfig) => {
    setSelectedSeat(target);
    if (slotIsSet(slot)) clearSlot(target);
  };
  const assignSelectedSeat = (slot: AgentMinistrySlotConfig) => {
    if (!selectedSeat || !slotIsSet(slot)) return;
    assignSlot(selectedSeat, slot);
  };
  const currentModelSlot: AgentMinistrySlotConfig = { kind: "model", provider: selectedProvider, model: selectedModel };
  const effectiveSelectedAgentId = selectedAgentId || availableAgents[0]?.id || "";
  const currentAgentSlot: AgentMinistrySlotConfig = { kind: "agent", agentId: effectiveSelectedAgentId };
  const selectedProviderEntry = providersBySlug.get(selectedProvider);
  const selectedAgent = agentsById.get(effectiveSelectedAgentId);
  const selectedSeatLabel = selectedSeat ? SEAT_LABELS[selectedSeat] : "No slot selected";
  const modelCardReady = Boolean(currentModelSlot.provider && currentModelSlot.model);
  const agentCardReady = Boolean(effectiveSelectedAgentId);

  const seatTargetFromPoint = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y) as HTMLElement | null;
    const target = element?.closest("[data-ministry-seat]")?.getAttribute("data-ministry-seat") ?? null;
    return isSeatTarget(target) ? target : null;
  };

  const beginPointerDrag = (event: React.PointerEvent<HTMLElement>, slot: AgentMinistrySlotConfig, title: string) => {
    if (event.button !== 0 || !slotIsSet(slot)) return;
    event.preventDefault();
    pointerDragRef.current = { active: false, pointerId: event.pointerId, slot, startX: event.clientX, startY: event.clientY, title };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePointerDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.active && distance < 6) return;
    drag.active = true;
    event.preventDefault();
    const target = seatTargetFromPoint(event.clientX, event.clientY);
    setDragOverSeat(target);
    setDragPreview({ title: drag.title, x: event.clientX, y: event.clientY });
  };

  const endPointerDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const wasDragging = drag.active;
    const target = seatTargetFromPoint(event.clientX, event.clientY);
    pointerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragPreview(null);
    setDragOverSeat(null);
    if (wasDragging) {
      if (target) {
        assignSlot(target, drag.slot);
        setSelectedSeat(target);
      }
      return;
    }
    assignSelectedSeat(drag.slot);
  };

  const cancelPointerDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (pointerDragRef.current?.pointerId === event.pointerId) pointerDragRef.current = null;
    setDragPreview(null);
    setDragOverSeat(null);
  };

  const assignCardByKey = (event: React.KeyboardEvent<HTMLElement>, slot: AgentMinistrySlotConfig) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    assignSelectedSeat(slot);
  };

  const renderSlot = (target: SeatTarget, label: string, slot: AgentMinistrySlotConfig, Icon: typeof Crown | typeof Sparkles) => {
    const summary = slotSummary(slot, agentsById, providersBySlug);
    return (
      <button
        type="button"
        key={target}
        className={styles.ministrySlot}
        data-empty={!slotIsSet(slot) ? "" : undefined}
        data-ministry-seat={target}
        data-drag-over={dragOverSeat === target ? "" : undefined}
        data-kind={summary.kind}
        data-selected={selectedSeat === target ? "" : undefined}
        aria-pressed={selectedSeat === target}
        aria-label={`${slotIsSet(slot) ? "Clear and select" : "Select"} ${label}`}
        onClick={() => selectSeat(target, slot)}
      >
        <span className={styles.ministrySlotOrb}>
          <Icon size={18} aria-hidden="true" />
        </span>
        <div>
          <span className={styles.ministrySlotLabel}>{label}</span>
          <strong>{summary.title}</strong>
          <small>{summary.sub}</small>
        </div>
      </button>
    );
  };

  return (
    <section className={styles.ministryPanel} aria-label="Queen Bee Ministry of Agents">
      <div className={styles.ministryHero}>
        <div>
          <PanelHead
            eyebrow="Queen Bee"
            title="Ministry of agents"
            sub="Seat a frontier orchestrator above three expert model or agent slots."
          />
        </div>
        <div className={styles.ministryEnable}>
          <Badge tone={ministry.enabled ? "honey" : "plain"}>{ministry.enabled ? "Opted in" : "Off by default"}</Badge>
          <Toggle on={ministry.enabled} onChange={() => patchMinistry({ enabled: !ministry.enabled })} />
        </div>
      </div>

      <div className={styles.ministryDial} role="group" aria-label="Ministry effort">
        {AGENT_MINISTRY_EFFORTS.map((effort) => (
          <button
            key={effort}
            type="button"
            className={styles.ministryDialButton}
            data-on={ministry.effort === effort ? "" : undefined}
            onClick={() => patchMinistry({ effort })}
          >
            <Zap size={13} aria-hidden="true" />
            <span>{EFFORT_COPY[effort].label}</span>
            <small>{EFFORT_COPY[effort].sub}</small>
          </button>
        ))}
      </div>

      <div className={styles.ministryGrid}>
        <div className={styles.ministryBench}>
          <GroupLabel>The bench</GroupLabel>
          <div className={styles.ministryBenchCard}>
            <div className={styles.ministryBenchTop}>
              {providerMark(selectedProviderEntry)}
              <div>
                <strong>Model card</strong>
                <small>{modelStatus === "loading" ? "Refreshing live model list." : modelMessage || `Selected slot: ${selectedSeatLabel}`}</small>
              </div>
              {modelStatus === "loading" ? <RefreshCcw size={14} className="animate-spin" aria-hidden="true" /> : <GripVertical size={15} aria-hidden="true" />}
            </div>
            <div className={styles.ministryPickerGrid}>
              <Field label="Provider">
                <select className="fb-select" value={selectedProvider} onChange={(event) => selectProvider(event.target.value)}>
                  {PROVIDER_CATALOG.map((provider) => (
                    <option key={provider.slug} value={provider.slug}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Model">
                <select className="fb-select" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} disabled={!modelOptions.length}>
                  {modelOptions.length ? modelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  )) : (
                    <option value="">No discovered models</option>
                  )}
                </select>
              </Field>
            </div>
            <div
              role="button"
              tabIndex={modelCardReady ? 0 : -1}
              aria-disabled={!modelCardReady}
              className={styles.ministryDragCard}
              data-disabled={!modelCardReady ? "" : undefined}
              data-dragging={dragPreview?.title === (selectedModel || "Choose a model") ? "" : undefined}
              onKeyDown={(event) => assignCardByKey(event, currentModelSlot)}
              onPointerCancel={cancelPointerDrag}
              onPointerDown={(event) => beginPointerDrag(event, currentModelSlot, selectedModel || "Choose a model")}
              onPointerMove={movePointerDrag}
              onPointerUp={endPointerDrag}
            >
              <BrainCircuit size={15} aria-hidden="true" />
              <span>{selectedProviderEntry?.name ?? selectedProvider}</span>
              <strong>{selectedModel || "Choose a model"}</strong>
            </div>
          </div>

          <div className={styles.ministryBenchCard}>
            <div className={styles.ministryBenchTop}>
              <span className={styles.ministryMark}><Bot size={16} aria-hidden="true" /></span>
              <div>
                <strong>Agent card</strong>
                <small>{selectedSeat ? `Selected slot: ${selectedSeatLabel}` : "Uses the selected agent's runtime, tools, prompt, model, and skill profile."}</small>
              </div>
              <GripVertical size={15} aria-hidden="true" />
            </div>
            <Field label="Agent">
              <select className="fb-select" value={effectiveSelectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)} disabled={!availableAgents.length}>
                {availableAgents.length ? availableAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                )) : (
                  <option value="">No other agents yet</option>
                )}
              </select>
            </Field>
            <div
              role="button"
              tabIndex={agentCardReady ? 0 : -1}
              aria-disabled={!agentCardReady}
              className={styles.ministryDragCard}
              data-disabled={!agentCardReady ? "" : undefined}
              data-dragging={dragPreview?.title === (selectedAgent?.name ?? "Choose an agent") ? "" : undefined}
              onKeyDown={(event) => assignCardByKey(event, currentAgentSlot)}
              onPointerCancel={cancelPointerDrag}
              onPointerDown={(event) => beginPointerDrag(event, currentAgentSlot, selectedAgent?.name ?? "Choose an agent")}
              onPointerMove={movePointerDrag}
              onPointerUp={endPointerDrag}
            >
              <Bot size={15} aria-hidden="true" />
              <span>{selectedAgent?.runtime ?? "Agent"}</span>
              <strong>{selectedAgent?.name ?? "Choose an agent"}</strong>
            </div>
          </div>
        </div>

        <div className={styles.ministryTopology}>
          <div className={styles.ministryTopologyHead}>
            <Network size={16} aria-hidden="true" />
            <div>
              <strong>Ministry topology</strong>
              <small>{ministry.enabled ? "Queen Bee will prefer this council when deep orchestration is requested." : "Configure now; activation stays off until you opt in."}</small>
            </div>
          </div>
          <div className={styles.ministryMap}>
            <div className={styles.ministryCoreSlot}>
              {renderSlot("orchestrator", "Frontier orchestrator", ministry.orchestrator, Crown)}
            </div>
            <div className={styles.ministryConnectors} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className={styles.ministryExperts}>
              {ministry.experts.map((slot, index) => renderSlot(`expert-${index}` as SeatTarget, `Expert ${index + 1}`, slot, Sparkles))}
            </div>
          </div>
        </div>
      </div>
      {dragPreview ? (
        <div
          className={styles.ministryDragPreview}
          style={{ transform: `translate3d(${dragPreview.x + 12}px, ${dragPreview.y + 12}px, 0)` }}
        >
          {dragPreview.title}
        </div>
      ) : null}
    </section>
  );
}
