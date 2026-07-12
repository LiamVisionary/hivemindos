"use client";

import { useMemo, useState } from "react";
import { Plus, Search, ShieldCheck } from "lucide-react";
import styles from "./ModelPillSelector.module.css";

export type ModelPillOption = {
  id: string;
  name?: string;
  subtitle?: string;
  group?: string;
  badge?: string;
  trust?: "confidential-verified";
  disabled?: boolean;
  disabledReason?: string;
};

type ModelPillSelectorProps = {
  models: ModelPillOption[];
  selectedModelId: string;
  disabled?: boolean;
  addModelDisabled?: boolean;
  canAddModel?: boolean;
  addModelLabel?: string;
  emptyLabel?: string;
  searchPlaceholder?: string;
  onSelectModel: (modelId: string) => void | Promise<void>;
  onAddModel?: () => void;
};

function modelPillParts(model: ModelPillOption) {
  const label = model.name || model.id;
  const slashIndex = label.indexOf("/");
  if (slashIndex > 0) {
    return {
      source: label.slice(0, slashIndex),
      name: label.slice(slashIndex + 1),
      detail: model.name && model.name !== model.id ? model.id : "",
      subtitle: model.subtitle,
    };
  }
  return {
    source: "",
    name: label,
    detail: model.name && model.name !== model.id ? model.id : "",
    subtitle: model.subtitle,
  };
}

export function ModelPillSelector({
  models,
  selectedModelId,
  disabled = false,
  addModelDisabled = false,
  canAddModel = false,
  addModelLabel = "Add model",
  emptyLabel = "No matching models.",
  searchPlaceholder = "Search models",
  onSelectModel,
  onAddModel,
}: ModelPillSelectorProps) {
  const [modelSearch, setModelSearch] = useState("");
  const [optimisticSelection, setOptimisticSelection] = useState<{ modelId: string; baseSelectedModelId: string } | null>(null);

  const markOptimisticModel = (modelId: string) => {
    setOptimisticSelection({ modelId, baseSelectedModelId: selectedModelId });
  };

  const selectModel = (modelId: string) => {
    if (models.find((model) => model.id === modelId)?.disabled) return;
    markOptimisticModel(modelId);
    requestAnimationFrame(() => {
      window.setTimeout(() => void onSelectModel(modelId), 0);
    });
  };

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    const ordered = [...models].sort((left, right) => Number(right.trust === "confidential-verified") - Number(left.trust === "confidential-verified"));
    if (!query) return ordered;
    return ordered.filter((model) => `${model.name ?? ""} ${model.id} ${model.trust === "confidential-verified" ? "confidential verified hardware attested" : ""}`.toLowerCase().includes(query));
  }, [models, modelSearch]);
  const effectiveOptimisticModelId = optimisticSelection
    && models.some((model) => model.id === optimisticSelection.modelId)
    && (selectedModelId === optimisticSelection.baseSelectedModelId || selectedModelId === optimisticSelection.modelId)
    ? optimisticSelection.modelId
    : null;

  return (
    <div className={styles.modelSelector}>
      <label className={styles.modelSearch}>
        <Search aria-hidden="true" />
        <input
          type="search"
          value={modelSearch}
          onChange={(event) => setModelSearch(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className={styles.modelPillGrid} role="listbox" aria-label="Models">
        {filteredModels.map((model) => {
          const selected = model.id === (effectiveOptimisticModelId ?? selectedModelId);
          const pill = modelPillParts(model);
          const modelDisabled = disabled || Boolean(model.disabled);
          return (
            <button
              type="button"
              className={styles.modelPill}
              data-selected={selected || undefined}
              aria-selected={selected}
              role="option"
              data-bee="agent-model"
              data-bee-model={model.id}
              data-confidential-verified={model.trust === "confidential-verified" || undefined}
              key={model.id}
              onPointerDown={() => {
                if (!model.disabled) markOptimisticModel(model.id);
              }}
              onClick={() => selectModel(model.id)}
              disabled={modelDisabled}
              title={[pill.detail || model.id, pill.subtitle, model.trust === "confidential-verified" ? "Fresh hardware attestation verified by HivemindOS; output is encrypted to the renter" : "", model.disabledReason].filter(Boolean).join(" - ")}
            >
              <span className={styles.modelPillDot} aria-hidden="true" />
              {pill.source ? <span className={styles.modelPillSource}>{pill.source}</span> : null}
              <span className={styles.modelPillText}>
                <span className={styles.modelPillName}>{pill.name}</span>
                {pill.subtitle ? <span className={styles.modelPillSubtitle}>{pill.subtitle}</span> : null}
              </span>
              {model.trust === "confidential-verified" ? <span className={styles.modelPillTrust}><ShieldCheck aria-hidden="true" />Confidential verified</span> : null}
              {model.badge || model.disabledReason ? <span className={styles.modelPillBadge}>{model.disabledReason ? "Credits" : model.badge}</span> : null}
            </button>
          );
        })}
        {canAddModel ? (
          <button
            type="button"
            className={styles.addModelPill}
            onClick={onAddModel}
            disabled={disabled || addModelDisabled}
          >
            <Plus aria-hidden="true" />
            <span>{addModelLabel}</span>
          </button>
        ) : null}
      </div>
      {filteredModels.length ? null : <p className={styles.emptySearch}>{emptyLabel}</p>}
    </div>
  );
}
