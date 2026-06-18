"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

import { CloseIconButton } from "@/components/ui/close-icon-button";
import { maskedSecretValueClass, secretInputProps } from "@/components/ui/secret-input-props";

import type { MoneyClawSaveOptions } from "./wallet-card-types";
import styles from "./AgentWalletCard.module.css";

type MoneyClawKeyModalProps = {
  envName: string;
  onClose: () => void;
  onSave: (apiKey: string, options: MoneyClawSaveOptions) => Promise<{ ok: boolean; error?: string }>;
};

export function MoneyClawKeyModal({ envName, onClose, onSave }: MoneyClawKeyModalProps) {
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [shareWithAllAgents, setShareWithAllAgents] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "checking" | "saved">("idle");
  const [saveError, setSaveError] = useState("");
  const portalTarget = typeof document === "undefined" ? null : document.body;

  const saveKey = async () => {
    const apiKey = apiKeyDraft.trim();
    setSaveError("");
    setSaveState("checking");
    const result = await onSave(apiKey, { shareWithAllAgents });
    if (!result.ok) {
      setSaveState("idle");
      setSaveError(result.error || "MoneyClaw key could not be saved.");
      return;
    }
    setSaveState("saved");
    window.setTimeout(() => {
      onClose();
      setApiKeyDraft("");
      setSaveState("idle");
    }, 900);
  };

  if (!portalTarget) return null;

  return createPortal((
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.moneyClawModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="moneyclaw-key-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.modalEyebrow}>Cards rail</p>
            <h3 id="moneyclaw-key-title">MoneyClaw API key</h3>
          </div>
          <CloseIconButton aria-label="Close MoneyClaw setup" onClick={onClose} />
        </div>

        <label className={styles.modalField} htmlFor="moneyclaw-key">
          <span>{envName}</span>
          <input
            id="moneyclaw-key"
            {...secretInputProps}
            value={apiKeyDraft}
            onChange={(event) => {
              setApiKeyDraft(event.target.value);
              setSaveError("");
              if (saveState === "saved") setSaveState("idle");
            }}
            placeholder="mcl_..."
            className={maskedSecretValueClass}
          />
        </label>

        <label className={styles.modalToggle}>
          <input
            type="checkbox"
            checked={shareWithAllAgents}
            onChange={(event) => setShareWithAllAgents(event.target.checked)}
          />
          <span>
            <strong>{shareWithAllAgents ? "Use for all agents" : "Use only for this agent"}</strong>
            <small>{shareWithAllAgents
              ? "Agents will share one MoneyClaw account, wallet, inbox, and balance."
              : "Use this when each agent has its own MoneyClaw account, wallet, inbox, and balance."}</small>
          </span>
        </label>

        <button
          type="button"
          className={styles.modalSaveButton}
          disabled={saveState === "checking" || !apiKeyDraft.trim()}
          onClick={() => void saveKey()}
        >
          {saveState === "saved" ? <Check aria-hidden="true" /> : null}
          {saveState === "checking" ? "Checking..." : saveState === "saved" ? "Saved!" : "Check"}
        </button>

        {saveError ? <p className={styles.modalError}>{saveError}</p> : null}

        <div className={styles.terminalAlternative}>
          <strong>Alternatively, run this in Terminal</strong>
          <code>{shareWithAllAgents
            ? `scripts/hive-env-add ${envName}`
            : "Per-agent MoneyClaw keys should be saved here so they stay attached to this agent's env overlay."}</code>
        </div>
      </section>
    </div>
  ), portalTarget);
}
