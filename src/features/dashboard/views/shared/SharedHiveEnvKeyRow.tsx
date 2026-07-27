"use client";

import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { List, LoaderCircle, Search, X } from "lucide-react";
import convoStyles from "@/app/kanban-conversation.module.css";
import type { HumanAsk, HumanAskInput } from "@/features/dashboard/kanban-result-format";
import { isValidHiveEnvKey, type HiveEnvKeyResult } from "@/features/dashboard/shared-hive-env-client";
import { createStyleClass } from "@/features/dashboard/style-classes";

const convoClass = createStyleClass(convoStyles);

export type SharedHiveEnvKeyRowProps = {
  requestedEnvKey?: string;
  compact?: boolean;
  disabled?: boolean;
  loadHiveEnvKeys?: () => Promise<HiveEnvKeyResult>;
  onSaveValue: (envKey: string, value: string) => Promise<string>;
  onUseExistingKey?: (requestedEnvKey: string, selectedEnvKey: string) => Promise<string>;
};

export function humanAskInputsForKind(ask: HumanAsk | null | undefined, kind: HumanAskInput["kind"]) {
  const source = ask?.inputs?.length ? ask.inputs : ask?.input ? [ask.input] : [];
  const seen = new Set<string>();
  return source.filter((input, index) => {
    if (input.kind !== kind) return false;
    const dedupeKey = input.envKey?.trim() || `unnamed-${index}`;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });
}

function scoreEnvKey(key: string, query: string, requestedKey: string) {
  if (requestedKey && key === requestedKey) return 0;
  if (query && key === query) return 1;
  if (query && key.startsWith(query)) return 2;
  if (query && key.includes(query)) return 3;
  return 4;
}

export function SharedHiveEnvKeyRow({
  compact,
  disabled = false,
  loadHiveEnvKeys,
  onSaveValue,
  onUseExistingKey,
  requestedEnvKey,
}: SharedHiveEnvKeyRowProps) {
  const requestedKey = requestedEnvKey?.trim() ?? "";
  const [busy, setBusy] = useState(false);
  const [keyName, setKeyName] = useState(requestedKey);
  const [keyValue, setKeyValue] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [envKeys, setEnvKeys] = useState<string[]>([]);
  const [keySearch, setKeySearch] = useState(requestedKey);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [error, setError] = useState("");
  const canPickExisting = Boolean(loadHiveEnvKeys && onUseExistingKey);
  const effectiveRequestedKey = requestedKey || keyName.trim() || selectedKey;

  const filteredEnvKeys = useMemo(() => {
    const query = keySearch.trim().toUpperCase();
    return envKeys
      .filter((key) => !query || key.toUpperCase().includes(query))
      .sort((left, right) => {
        const leftScore = scoreEnvKey(left.toUpperCase(), query, requestedKey.toUpperCase());
        const rightScore = scoreEnvKey(right.toUpperCase(), query, requestedKey.toUpperCase());
        return leftScore - rightScore || left.localeCompare(right);
      })
      .slice(0, compact ? 14 : 24);
  }, [compact, envKeys, keySearch, requestedKey]);

  const loadKeys = async () => {
    if (!loadHiveEnvKeys || keysLoaded || loadingKeys) return;
    setLoadingKeys(true);
    setError("");
    try {
      const result = await loadHiveEnvKeys();
      const keys = [...new Set(result.keys.filter(isValidHiveEnvKey))].sort((left, right) => left.localeCompare(right));
      setEnvKeys(keys);
      setKeysLoaded(true);
      if (result.error) setError(result.error);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not read shared hive env names.");
    } finally {
      setLoadingKeys(false);
    }
  };

  const toggleMenu = () => {
    if (!canPickExisting || disabled || busy) return;
    const nextOpen = !menuOpen;
    setMenuOpen(nextOpen);
    if (nextOpen) void loadKeys();
  };

  const selectExistingKey = (key: string) => {
    setSelectedKey(key);
    setKeyName(key);
    setKeySearch(key);
    setMenuOpen(false);
    setError("");
  };

  const clearExistingKey = () => {
    setSelectedKey("");
    setKeyName(requestedKey);
    setKeySearch(requestedKey);
    setError("");
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "Escape") setMenuOpen(false);
  };

  const submitKey = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || busy) return;
    setBusy(true);
    setError("");
    try {
      const envKey = keyName.trim();
      const failure = selectedKey && onUseExistingKey
        ? await onUseExistingKey(effectiveRequestedKey, selectedKey)
        : await onSaveValue(envKey, keyValue);
      if (failure) setError(failure);
      else setKeyValue("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the key.");
    } finally {
      setBusy(false);
    }
  };

  const saveDisabled = disabled
    || busy
    || (selectedKey
      ? !isValidHiveEnvKey(selectedKey) || !effectiveRequestedKey
      : !keyValue.trim() || !isValidHiveEnvKey(keyName.trim()));

  return (
    <form className={convoClass("needsYouKeyItem")} onClick={(event) => event.stopPropagation()} onSubmit={(event) => void submitKey(event)}>
      {requestedKey && selectedKey && selectedKey !== requestedKey ? (
        <p className={convoClass("needsYouMapping")}>
          Requested <code>{requestedKey}</code>
        </p>
      ) : null}
      <div className={convoClass("needsYouKeyRow")}>
        <div className={convoClass("needsYouKeyNameWrap")}>
          {selectedKey ? (
            <div className={convoClass("needsYouSelectedKey")} aria-label={`Selected shared env key ${selectedKey}`}>
              <span>{selectedKey}</span>
              <button
                type="button"
                className={convoClass("needsYouClearSelected")}
                onClick={clearExistingKey}
                disabled={disabled || busy}
                aria-label={`Clear selected env key ${selectedKey}`}
                title="Clear selected env key"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          ) : (
            <input
              className={convoClass("needsYouKeyName")}
              value={keyName}
              onChange={(event) => {
                const next = event.target.value.toUpperCase();
                setKeyName(next);
                setKeySearch(next);
              }}
              placeholder="ENV_KEY_NAME"
              aria-label="Env variable name"
              autoComplete="off"
              spellCheck={false}
              disabled={disabled || busy}
            />
          )}
          {canPickExisting ? (
            <button
              type="button"
              className={convoClass("needsYouIconButton")}
              onClick={toggleMenu}
              disabled={disabled || busy}
              aria-expanded={menuOpen}
              aria-label="Choose an existing shared env key"
              title="Choose existing shared env key"
            >
              {loadingKeys ? <LoaderCircle aria-hidden="true" className={convoClass("needsYouSpin")} /> : <List aria-hidden="true" />}
            </button>
          ) : null}
          {menuOpen ? (
            <div className={convoClass("needsYouKeyMenu")} role="listbox" aria-label="Shared hive env keys">
              <label className={convoClass("needsYouKeySearch")} aria-label="Search shared env keys">
                <Search aria-hidden="true" />
                <input
                  type="search"
                  value={keySearch}
                  onChange={(event) => setKeySearch(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search env keys"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              {loadingKeys ? (
                <div className={convoClass("needsYouKeyLoading")} role="status" aria-label="Reading shared env keys">
                  <LoaderCircle aria-hidden="true" className={convoClass("needsYouSpin")} />
                  <span>Reading env names</span>
                </div>
              ) : filteredEnvKeys.length ? (
                <div className={convoClass("needsYouKeyOptions")}>
                  {filteredEnvKeys.map((key) => (
                    <button key={key} type="button" role="option" aria-selected={selectedKey === key} onClick={() => selectExistingKey(key)}>
                      {key}
                    </button>
                  ))}
                </div>
              ) : (
                <p className={convoClass("needsYouKeyEmpty")}>{keysLoaded ? "No matching shared env keys." : "Open the list to read env names."}</p>
              )}
            </div>
          ) : null}
        </div>
        {selectedKey ? null : (
          <input
            className={convoClass("needsYouKeyValue")}
            type="password"
            value={keyValue}
            onChange={(event) => setKeyValue(event.target.value)}
            placeholder={`Paste the ${keyName.trim() || "env"} value`}
            aria-label="Env variable value"
            autoComplete="off"
            disabled={disabled || busy}
          />
        )}
        <button type="submit" disabled={saveDisabled}>
          {busy ? (
            <>
              <LoaderCircle aria-hidden="true" className={convoClass("needsYouSpin")} />
              {selectedKey ? "Resuming" : "Saving"}
            </>
          ) : selectedKey ? "Use selected & resume" : "Save key & resume"}
        </button>
      </div>
      {error ? <p className={convoClass("needsYouError")} role="alert">{error}</p> : null}
    </form>
  );
}
