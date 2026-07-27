"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { maskedSecretValueClass, secretInputProps } from "@/components/ui/secret-input-props";
import styles from "./hive-env-honey.module.css";

export type HiveEnvKeyInputProps = {
  /** The secret value being entered. */
  value: string;
  onValueChange: (value: string) => void;
  onSave: () => void;
  saving?: boolean;
  /** Label on the primary button. Defaults to "Save key". */
  saveLabel?: string;
  /** Explicit disable override; by default the button disables while saving or when required fields are empty. */
  saveDisabled?: boolean;
  valuePlaceholder?: string;
  /** Whether the value field masks its characters. Defaults to true (it's a secret). */
  masked?: boolean;
  /**
   * When `onKeyChange` is provided, an editable KEY field is rendered before the
   * value field (the Env-panel "add a variable" context). Omit it for the
   * missing-key context, where the key is already known.
   */
  keyValue?: string;
  onKeyChange?: (value: string) => void;
  keyPlaceholder?: string;
  /** Slot rendered between the value field and the save button (e.g. a generate-secret button). */
  extraAction?: ReactNode;
  /** Extra class names on the container. */
  className?: string;
};

/**
 * Single source of truth for the dark-honey hive-env key-entry input.
 * Controlled; the caller owns state + the save handler so each context keeps
 * its own logic (see MissingSharedEnvKeySetup and BrainEnvPanel's add-key row).
 */
export function HiveEnvKeyInput({
  value,
  onValueChange,
  onSave,
  saving = false,
  saveLabel = "Save key",
  saveDisabled,
  valuePlaceholder = "value",
  masked = true,
  keyValue = "",
  onKeyChange,
  keyPlaceholder = "KEY",
  extraAction,
  className,
}: HiveEnvKeyInputProps) {
  const editableKey = typeof onKeyChange === "function";
  const requiredEmpty = !value.trim() || (editableKey && !keyValue.trim());
  const disabled = saving || (saveDisabled ?? requiredEmpty);

  const handleEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !disabled) {
      event.preventDefault();
      onSave();
    }
  };

  return (
    <div className={`${styles.scope} ${styles.container}${className ? ` ${className}` : ""}`}>
      {editableKey ? (
        <input
          className={`${styles.field} ${styles.keyField}`}
          value={keyValue}
          onChange={(event) => onKeyChange?.(event.target.value)}
          onKeyDown={handleEnter}
          placeholder={keyPlaceholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      ) : null}
      <input
        {...secretInputProps}
        className={`${styles.field} ${styles.valueField}${masked ? ` ${maskedSecretValueClass}` : ""}`}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleEnter}
        placeholder={valuePlaceholder}
      />
      {extraAction}
      <button
        type="button"
        className={styles.saveBtn}
        disabled={disabled}
        onClick={onSave}
        title="Save this key with hive-env-add."
      >
        {saving ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Plus aria-hidden="true" />}
        {saveLabel}
      </button>
    </div>
  );
}
