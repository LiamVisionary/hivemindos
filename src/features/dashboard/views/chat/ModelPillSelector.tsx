"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import styles from "./ModelPillSelector.module.css";

export type ModelPillOption = {
  id: string;
  name?: string;
};

type ModelPillSelectorProps = {
  models: ModelPillOption[];
  selectedModelId: string;
  disabled?: boolean;
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
    };
  }
  return {
    source: "",
    name: label,
    detail: model.name && model.name !== model.id ? model.id : "",
  };
}

export function ModelPillSelector({
  models,
  selectedModelId,
  disabled = false,
  canAddModel = false,
  addModelLabel = "Add model",
  emptyLabel = "No matching models.",
  searchPlaceholder = "Search models",
  onSelectModel,
  onAddModel,
}: ModelPillSelectorProps) {
  const [modelSearch, setModelSearch] = useState("");
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return models;
    return models.filter((model) => `${model.name ?? ""} ${model.id}`.toLowerCase().includes(query));
  }, [models, modelSearch]);

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
          const selected = model.id === selectedModelId;
          const pill = modelPillParts(model);
          return (
            <button
              type="button"
              className={styles.modelPill}
              data-selected={selected || undefined}
              aria-selected={selected}
              role="option"
              key={model.id}
              onClick={() => void onSelectModel(model.id)}
              disabled={disabled}
              title={pill.detail || model.id}
            >
              <span className={styles.modelPillDot} aria-hidden="true" />
              {pill.source ? <span className={styles.modelPillSource}>{pill.source}</span> : null}
              <span className={styles.modelPillName}>{pill.name}</span>
            </button>
          );
        })}
        {canAddModel ? (
          <button
            type="button"
            className={styles.addModelPill}
            onClick={onAddModel}
            disabled={disabled}
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
