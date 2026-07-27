"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, LoaderCircle, Pencil, Save, Search } from "lucide-react";

import { maskedSecretValueClass, secretInputProps } from "@/components/ui/secret-input-props";
import { loadSharedHiveEnvKeys, saveSharedHiveEnvValue } from "@/features/dashboard/shared-hive-env-client";
import styles from "./hive-env-honey.module.css";

export type SharedHiveEnvCredential = {
  envKey: string;
  source: "existing" | "manual";
  value?: string;
};

export type SharedHiveEnvCredentialSaveResult = {
  ok: boolean;
  error?: string;
};

type SharedHiveEnvCredentialInputProps = {
  preferredEnvKeys: readonly string[];
  defaultEnvKey?: string;
  valuePlaceholder?: string;
  continueLabel?: string;
  saveLabel?: string;
  disabled?: boolean;
  saveCredential?: (credential: SharedHiveEnvCredential) => Promise<SharedHiveEnvCredentialSaveResult>;
  onSaved?: (credential: SharedHiveEnvCredential) => void | Promise<void>;
};

async function saveWithoutProviderVerification(credential: SharedHiveEnvCredential): Promise<SharedHiveEnvCredentialSaveResult> {
  if (credential.source === "existing") return { ok: true };
  const error = await saveSharedHiveEnvValue(credential.envKey, credential.value ?? "");
  return error ? { ok: false, error } : { ok: true };
}

export function SharedHiveEnvCredentialInput({
  preferredEnvKeys,
  defaultEnvKey = preferredEnvKeys[0] ?? "API_KEY",
  valuePlaceholder = "Paste secret value",
  continueLabel = "Continue",
  saveLabel = "Save",
  disabled = false,
  saveCredential = saveWithoutProviderVerification,
  onSaved,
}: SharedHiveEnvCredentialInputProps) {
  const preferredKeySignature = preferredEnvKeys.join("\n");
  const [envKeys, setEnvKeys] = useState<string[]>([]);
  const [envKey, setEnvKey] = useState(defaultEnvKey);
  const [mode, setMode] = useState<"existing" | "manual">("existing");
  const [secretValue, setSecretValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSharedHiveEnvKeys().then((result) => {
      if (cancelled) return;
      setEnvKeys(result.keys);
      const preferredMatch = preferredEnvKeys.find((key) => result.keys.includes(key));
      if (preferredMatch) {
        setEnvKey(preferredMatch);
        setMode("existing");
      } else {
        setEnvKey(defaultEnvKey);
        setMode("manual");
      }
      setStatus(result.error ?? "");
      setLoading(false);
    });
    return () => { cancelled = true; };
    // Re-run only when the ordered provider key preference actually changes.
  }, [defaultEnvKey, preferredKeySignature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePress = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsidePress);
    return () => document.removeEventListener("mousedown", closeOnOutsidePress);
  }, [menuOpen]);

  const filteredKeys = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return query ? envKeys.filter((key) => key.toLowerCase().includes(query)) : envKeys;
  }, [envKeys, searchQuery]);

  const chooseExistingKey = (key: string) => {
    setEnvKey(key);
    setMode("existing");
    setSecretValue("");
    setSearchQuery("");
    setMenuOpen(false);
    setStatus("");
  };

  const openMenu = () => {
    setMenuOpen((current) => !current);
    setStatus("");
  };

  const save = async () => {
    const credential: SharedHiveEnvCredential = mode === "manual"
      ? { envKey, source: "manual", value: secretValue.trim() }
      : { envKey, source: "existing" };
    if (!credential.envKey || (credential.source === "manual" && !credential.value)) return;
    const failureMessage = credential.source === "existing"
      ? `Could not continue with ${credential.envKey}.`
      : `Could not save ${credential.envKey}.`;
    setSaving(true);
    setStatus("");
    try {
      const result = await saveCredential(credential);
      if (!result.ok) {
        setStatus(result.error || failureMessage);
        return;
      }
      setSecretValue("");
      setStatus(credential.source === "existing"
        ? `Using ${credential.envKey}.`
        : `Saved ${credential.envKey}.`);
      await onSaved?.(credential);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : failureMessage);
    } finally {
      setSaving(false);
    }
  };

  const saveDisabled = disabled || loading || saving || !envKey || (mode === "manual" && !secretValue.trim());
  const actionLabel = mode === "existing" ? continueLabel : saveLabel;
  const busyLabel = mode === "existing" ? "Continuing…" : "Saving…";

  return (
    <div className={`${styles.scope} ${styles.smartCredential}`}>
      <div className={styles.smartCredentialRow}>
        <div className={styles.segmentedCredential} ref={menuRef} data-mode={mode}>
          {mode === "existing" ? (
            <button
              type="button"
              className={styles.envSelectButton}
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              disabled={disabled || loading}
              onClick={openMenu}
            >
              <span><small>Shared Hive Env</small><strong>{loading ? "Finding saved variables…" : envKey}</strong></span>
              <ChevronDown aria-hidden="true" />
            </button>
          ) : (
            <input
              {...secretInputProps}
              className={`${styles.field} ${styles.smartSecretField} ${maskedSecretValueClass}`}
              value={secretValue}
              onChange={(event) => { setSecretValue(event.target.value); setStatus(""); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !saveDisabled) void save();
              }}
              placeholder={valuePlaceholder}
              aria-label={`${envKey} secret value`}
            />
          )}

          {mode === "existing" ? (
            <button
              type="button"
              className={styles.segmentAction}
              aria-label={`Enter a new value for ${envKey}`}
              title={`Enter a new value for ${envKey}`}
              disabled={disabled || loading}
              onClick={() => { setMode("manual"); setMenuOpen(false); setStatus(""); }}
            >
              <Pencil aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className={styles.segmentAction}
              aria-label="Choose an existing Shared Hive Env variable"
              title="Choose an existing Shared Hive Env variable"
              disabled={disabled || loading || envKeys.length === 0}
              onClick={openMenu}
            >
              <ChevronDown aria-hidden="true" />
            </button>
          )}

          {menuOpen ? (
            <div className={styles.envMenu} role="dialog" aria-label="Shared Hive Env variables">
              <label className={styles.envMenuSearch}>
                <Search aria-hidden="true" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search shared env variables"
                  aria-label="Search shared env variables"
                  autoFocus
                  spellCheck={false}
                />
              </label>
              <div className={styles.envMenuList} role="listbox" aria-label="Saved Shared Hive Env variables">
                {filteredKeys.map((key) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={mode === "existing" && envKey === key}
                    key={key}
                    onClick={() => chooseExistingKey(key)}
                  >
                    <span>{key}</span>
                    {mode === "existing" && envKey === key ? <Check aria-hidden="true" /> : null}
                  </button>
                ))}
                {!filteredKeys.length ? <p>No matching saved variables.</p> : null}
              </div>
            </div>
          ) : null}
        </div>

        <button type="button" className={styles.saveBtn} disabled={saveDisabled} onClick={() => void save()}>
          {saving
            ? <LoaderCircle aria-hidden="true" className={styles.spin} />
            : mode === "existing"
              ? <ArrowRight aria-hidden="true" />
              : <Save aria-hidden="true" />}
          {saving ? busyLabel : actionLabel}
        </button>
      </div>

      <p className={styles.smartCredentialHint}>
        {loading
          ? "Checking Shared Hive Env for saved variables…"
          : mode === "existing"
          ? `${envKey} is already stored; its value stays server-side.`
          : `The new value will be saved as ${envKey} in Shared Hive Env.`}
      </p>
      {status ? <p className={styles.smartCredentialStatus} role="status">{status}</p> : null}
    </div>
  );
}
