"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Image from "next/image";
import { createStyleClass } from "@/features/dashboard/style-classes";
import type { HumanAsk } from "@/features/dashboard/kanban-result-format";
import {
  isValidHiveEnvKey,
  loadSharedHiveEnvKeys,
  saveSharedHiveEnvValue,
  type HiveEnvKeyResult,
} from "@/features/dashboard/shared-hive-env-client";
import { humanAskInputsForKind } from "@/features/dashboard/views/shared/SharedHiveEnvKeyRow";
import styles from "./KanbanNeedsHumanPanel.module.css";

const wrc = createStyleClass(styles as unknown as Record<string, string>);

// ── exact icons from the design source ────────────────────────────────────
type SvgProps = { size?: number; sw?: number; className?: string };
const svg = (paths: ReactNode, { size = 14, sw = 2, className }: SvgProps = {}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {paths}
  </svg>
);
const IconList = (p: SvgProps = {}) => svg(<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>, { sw: 1.9, ...p });
const IconCheck = (p: SvgProps = {}) => svg(<path d="M20 6 9 17l-5-5" />, p);
const IconX = (p: SvgProps = {}) => svg(<path d="M18 6 6 18M6 6l12 12" />, { sw: 2.2, ...p });
const IconSearch = (p: SvgProps = {}) => svg(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>, { sw: 1.9, ...p });
const IconLock = (p: SvgProps = {}) => svg(<><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>, { sw: 1.7, ...p });
const IconPlay = (p: SvgProps = {}) => svg(<path d="m5 3 14 9-14 9V3Z" />, p);
const IconUp = (p: SvgProps = {}) => svg(<><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></>, p);
const IconLoader = (p: SvgProps = {}) => svg(<><circle cx="12" cy="12" r="9" strokeOpacity="0.25" /><path d="M21 12a9 9 0 0 0-9-9" /></>, { sw: 3, ...p });
const IconDots = ({ size = 15 }: SvgProps = {}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
);
const IconEye = (open: boolean) => svg(
  open
    ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>
    : <><path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 8 10 8a18 18 0 0 1-2.2 3.2M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4-.7" /><path d="m4 4 16 16" /></>,
  { sw: 1.8 },
);

const IconChevron = (p: SvgProps = {}) => svg(<polyline points="6 9 12 15 18 9" />, p);

const ENV_KEY_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/** Render prose with ALL_CAPS_SNAKE env-key tokens in inline mono. */
function renderInstruction(text: string): ReactNode {
  const parts = text.split(ENV_KEY_TOKEN);
  const keys = text.match(ENV_KEY_TOKEN) ?? [];
  const out: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (part) out.push(<span key={`t${index}`}>{part}</span>);
    if (index < keys.length) out.push(<span key={`k${index}`} className={wrc("inlineKey")}>{keys[index]}</span>);
  });
  return out;
}

/** An agent OPTION may embed a description as "Label — help" or "Label: help". */
function splitRoute(option: string): { title: string; help: string } {
  const dash = option.match(/^(.+?)\s+[—–-]\s+(.+)$/);
  if (dash) return { title: dash[1].trim(), help: dash[2].trim() };
  const colon = option.match(/^([^:]+):\s+(.+)$/);
  if (colon && colon[1].length <= 48) return { title: colon[1].trim(), help: colon[2].trim() };
  return { title: option.trim(), help: "" };
}

function scoreEnvKey(key: string, query: string, requestedKey: string) {
  if (requestedKey && key === requestedKey) return 0;
  if (query && key === query) return 1;
  if (query && key.startsWith(query)) return 2;
  if (query && key.includes(query)) return 3;
  return 4;
}

type WorkRouteTask = { id: string; title?: string; assignee?: string; tenant?: string };

type KanbanNeedsHumanPanelProps = {
  ask: HumanAsk;
  task?: WorkRouteTask;
  compact?: boolean;
  /** Avatar image for the assignee bee. */
  beeIcon?: string;
  onAnswer: (answer: string) => void | Promise<void>;
  /** Open the task's action menu / conversation. */
  onMenu?: () => void;
  loadHiveEnvKeys?: () => Promise<HiveEnvKeyResult>;
  /* Accepted for backward-compat with existing call sites; the redesigned card
   * stages every key then does one combined resume via onAnswer. */
  onSaveApiKey?: (envKey: string, value: string) => Promise<string>;
  onUseExistingEnvKey?: (requestedEnvKey: string, selectedEnvKey: string) => Promise<string>;
};

type KeyRowState = { name: string; value: string; selected: string };

export function KanbanNeedsHumanPanel({ ask, task, beeIcon, loadHiveEnvKeys, onAnswer, onMenu }: KanbanNeedsHumanPanelProps) {
  const keyInputs = useMemo(() => humanAskInputsForKind(ask, "api-key"), [ask]);
  const fileInputs = useMemo(() => humanAskInputsForKind(ask, "file"), [ask]);
  const textInputs = useMemo(() => humanAskInputsForKind(ask, "text"), [ask]);
  const options = ask.options ?? [];
  const wantsText = textInputs.length > 0 || (options.length === 0 && keyInputs.length === 0);
  const loadKeys = loadHiveEnvKeys ?? loadSharedHiveEnvKeys;

  const [route, setRoute] = useState("");
  const [rows, setRows] = useState<KeyRowState[]>(() => keyInputs.map((input) => ({ name: input.envKey?.trim() ?? "", value: "", selected: "" })));
  const [answerText, setAnswerText] = useState("");
  const [busy, setBusy] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const updateRow = (index: number, patch: Partial<KeyRowState>) =>
    setRows((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));

  const rowFilled = (row: KeyRowState) => Boolean(row.selected) || Boolean(row.value.trim());
  const filledCount = rows.filter(rowFilled).length;
  const routeReady = options.length === 0 || Boolean(route);
  const keysReady = rows.every((row) => row.selected || (row.value.trim() && isValidHiveEnvKey(row.name.trim())));
  const textReady = !wantsText || Boolean(answerText.trim());
  const ready = routeReady && keysReady && textReady;

  const missing: string[] = [];
  const keysLeft = keyInputs.length - filledCount;
  if (keysLeft > 0) missing.push(`${keysLeft} key${keysLeft === 1 ? "" : "s"} left`);
  if (options.length && !route) missing.push("route not chosen");
  if (wantsText && !answerText.trim()) missing.push("answer needed");

  const stop = (event: MouseEvent) => event.stopPropagation();

  const saveAndResume = async () => {
    if (!ready || busy || resumed) return;
    setBusy(true);
    setError("");
    try {
      for (const row of rows) {
        if (row.selected) continue;
        const failure = await saveSharedHiveEnvValue(row.name.trim(), row.value);
        if (failure) { setError(failure); setBusy(false); return; }
      }
      const segments: string[] = [];
      if (options.length && route) segments.push(route);
      rows.forEach((row, index) => {
        const requested = keyInputs[index]?.envKey?.trim() ?? "";
        if (row.selected) {
          segments.push(
            requested && requested !== row.selected
              ? `Use the existing shared hive env variable ${row.selected} for the requested ${requested}. The selected value is intentionally not included in this message.`
              : `The requested env variable ${row.selected} is already present in the shared hive env. Load it from the shared env — the value is intentionally not included in this message.`,
          );
        } else {
          segments.push(`The requested env variable ${row.name.trim()} is now saved in the shared hive env (via hive-env-add). Load it from the shared env — the value is intentionally not included in this message.`);
        }
      });
      if (wantsText && answerText.trim()) segments.push(answerText.trim());
      const structured = Boolean((options.length && route) || rows.length);
      await onAnswer(`${segments.join("\n\n")}${structured ? "\n\nContinue the task." : ""}`.trim());
      setResumed(true);
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : "Could not resume the task.");
    } finally {
      setBusy(false);
    }
  };

  const answerOnly = keyInputs.length === 0;
  const actionLabel = answerOnly ? (options.length || wantsText ? "Send answer" : "Resume") : "Save keys & resume";

  const context = [task?.assignee?.trim(), task?.tenant?.trim()].filter(Boolean).join(" · ");
  const taskName = task?.title?.trim() ?? "";
  const askText = ask.ask.trim();
  const hasSeparateTitle = Boolean(taskName) && taskName !== askText;
  const title = hasSeparateTitle ? taskName : askText;
  const instruction = hasSeparateTitle ? askText : "";

  // Default to a compact card: header + task only, with the route/keys/actions
  // collapsed behind an expand toggle.
  const collapsible = !resumed && (options.length > 0 || keyInputs.length > 0 || wantsText || fileInputs.length > 0);
  const showZones = expanded || resumed;
  const summaryBits: string[] = [];
  if (keyInputs.length) summaryBits.push(`${keyInputs.length} key${keyInputs.length === 1 ? "" : "s"}`);
  if (options.length) summaryBits.push("a route");
  if (wantsText) summaryBits.push("a reply");
  const toggleSummary = ready ? "Ready to resume" : summaryBits.length ? `Needs ${summaryBits.join(" · ")}` : "Respond below";

  return (
    <div className={wrc("wrc")} role="group" aria-label="Needs you — work route">
      {/* header */}
      <div className={wrc("header")}>
        <div className={wrc("headLeft")}>
          <span className={wrc("badge", resumed && "badgeLive")}>{resumed ? "Resumed" : "Needs you"}</span>
          {context ? <span className={wrc("context")} title={context}>{context}</span> : null}
        </div>
        <div className={wrc("headRight")}>
          {beeIcon ? (
            <span className={wrc("avatar")} title={task?.assignee}>
              <span className={wrc("avatarRing")} aria-hidden="true" />
              <span className={wrc("avatarInner")}>
                <Image src={beeIcon} alt="" width={24} height={24} aria-hidden="true" unoptimized />
              </span>
            </span>
          ) : null}
          {onMenu ? (
            <button type="button" className={wrc("menuBtn")} onClick={(event) => { stop(event); onMenu(); }} aria-label="Task actions">
              <IconDots />
            </button>
          ) : null}
        </div>
      </div>

      {/* task */}
      <div
        className={wrc("task", collapsible && "taskClickable")}
        onClick={collapsible ? (event) => { stop(event); setExpanded((value) => !value); } : undefined}
        role={collapsible ? "button" : undefined}
        aria-expanded={collapsible ? expanded : undefined}
      >
        <h3 className={wrc("taskTitle")}>{title}</h3>
        {instruction ? <p className={wrc("taskInstruction")}>{renderInstruction(instruction)}</p> : null}
        {ask.links.length ? (
          <div className={wrc("links")} onClick={stop} role="presentation">
            {ask.links.map((link) => (
              <a key={link.url} className={wrc("link")} href={link.url} target="_blank" rel="noreferrer" title={link.url}>
                {link.label}
                <IconUp size={13} />
              </a>
            ))}
          </div>
        ) : null}
      </div>

      {collapsible ? (
        <button
          type="button"
          className={wrc("collapsedHint")}
          onClick={(event) => { stop(event); setExpanded((value) => !value); }}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse actions" : "Expand actions"}
        >
          <span className={wrc("collapsedHintLabel", ready && "collapsedHintReady")}>{toggleSummary}</span>
          <IconChevron size={16} />
        </button>
      ) : null}

      {showZones ? (
        <>
      {/* handoff route */}
      {options.length ? (
        <>
          <div className={wrc("divider")} />
          <div className={wrc("zone")} onClick={stop} role="presentation">
            <div className={wrc("zoneHead")}>
              <span className={wrc("zoneLabel")}>Handoff route</span>
              <span className={wrc("zoneTag", route && "zoneTagOn")}>{route ? "Chosen" : "Pick one"}</span>
            </div>
            <div className={wrc("routes")}>
              {options.map((option) => {
                const selected = route === option;
                const { title: rTitle, help } = splitRoute(option);
                return (
                  <button key={option} type="button" className={wrc("route", selected && "routeSelected")} disabled={busy || resumed} aria-pressed={selected} onClick={() => setRoute(option)}>
                    <span className={wrc("radio", selected && "radioSelected")}>{selected ? IconCheck({ size: 11, sw: 3.4 }) : null}</span>
                    <span className={wrc("routeText")}>
                      <span className={wrc("routeTitle")}>{rTitle}</span>
                      {help ? <span className={wrc("routeHelp")}>{help}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {/* keys */}
      {keyInputs.length ? (
        <>
          <div className={wrc("divider")} />
          <div className={wrc("zone")} onClick={stop} role="presentation">
            <div className={wrc("zoneHead", "zoneHeadKeys")}>
              <span className={wrc("zoneLabel")}>Add to shared hive env</span>
              <span className={wrc("keyCount", filledCount === keyInputs.length && "keyCountReady")}>{filledCount} of {keyInputs.length} staged</span>
            </div>
            <div className={wrc("keys")}>
              {keyInputs.map((input, index) => (
                <WorkRouteKeyRow
                  key={`${input.envKey ?? "env"}:${index}`}
                  requestedEnvKey={input.envKey}
                  disabled={busy || resumed}
                  state={rows[index] ?? { name: input.envKey?.trim() ?? "", value: "", selected: "" }}
                  onChange={(patch) => updateRow(index, patch)}
                  loadHiveEnvKeys={loadKeys}
                />
              ))}
            </div>
          </div>
        </>
      ) : null}

      {/* free-text answer */}
      {wantsText ? (
        <>
          <div className={wrc("divider")} />
          <div className={wrc("answer")} onClick={stop} role="presentation">
            <div className={wrc("zoneHead")}>
              <span className={wrc("zoneLabel")}>Your answer</span>
            </div>
            <textarea className={wrc("answerField")} value={answerText} onChange={(event) => setAnswerText(event.target.value)} placeholder="Type your reply to the agent…" aria-label="Answer the agent" disabled={busy || resumed} />
          </div>
        </>
      ) : null}

      {fileInputs.length ? (
        <p className={wrc("hint")}>Open the card and attach the requested file in the conversation.</p>
      ) : null}

      {error ? <p className={wrc("error")} role="alert">{error}</p> : null}

      {/* action */}
      <div className={wrc("action")} onClick={stop} role="presentation">
        {resumed ? (
          <div className={wrc("resumedBanner")}>
            <span className={wrc("resumedDot")} aria-hidden="true" />
            <span>{keyInputs.length ? "Saved to hive env · card resumed" : "Answer sent · card resumed"}</span>
          </div>
        ) : (
          <>
            <button type="button" className={wrc("saveBtn")} disabled={!ready || busy} onClick={() => void saveAndResume()}>
              {busy ? IconLoader({ size: 14, className: wrc("spin") }) : IconPlay({ size: 14 })}
              {busy ? "Resuming" : actionLabel}
            </button>
            <p className={wrc("helper", ready && "helperReady")}>
              {ready
                ? keyInputs.length
                  ? "Ready — keys will be written to the shared env, then the card reruns."
                  : "Ready — the agent picks the task back up."
                : `Still needed: ${missing.join(" · ")}.`}
            </p>
          </>
        )}
      </div>

      {/* footer */}
      {keyInputs.length ? (
        <div className={wrc("footer")}>
          <IconLock size={13} />
          <p className={wrc("footerNote")}>Stored with <code>hive-env-add</code> — the value never lands on the task or in chat.</p>
        </div>
      ) : null}
        </>
      ) : null}
    </div>
  );
}

type WorkRouteKeyRowProps = {
  requestedEnvKey?: string;
  disabled?: boolean;
  state: KeyRowState;
  onChange: (patch: Partial<KeyRowState>) => void;
  loadHiveEnvKeys: () => Promise<HiveEnvKeyResult>;
};

function WorkRouteKeyRow({ requestedEnvKey, disabled, state, onChange, loadHiveEnvKeys }: WorkRouteKeyRowProps) {
  const requestedKey = requestedEnvKey?.trim() ?? "";
  const hasRequestedName = Boolean(requestedKey);
  const [revealed, setRevealed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [envKeys, setEnvKeys] = useState<string[]>([]);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [keySearch, setKeySearch] = useState("");
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [error, setError] = useState("");
  const rowRef = useRef<HTMLDivElement>(null);

  const selected = state.selected;
  const filled = Boolean(selected) || Boolean(state.value.trim());
  const badgeText = selected ? "Linked" : filled ? "Staged" : "Missing";
  const placeholder = `Paste the ${(state.name || requestedKey || "env").toLowerCase().replace(/_/g, " ")} value`;

  const filteredEnvKeys = useMemo(() => {
    const query = keySearch.trim().toUpperCase();
    return envKeys
      .filter((key) => !query || key.toUpperCase().includes(query))
      .sort((left, right) => scoreEnvKey(left.toUpperCase(), query, requestedKey.toUpperCase()) - scoreEnvKey(right.toUpperCase(), query, requestedKey.toUpperCase()) || left.localeCompare(right))
      .slice(0, 14);
  }, [envKeys, keySearch, requestedKey]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: globalThis.MouseEvent) => {
      if (rowRef.current && !rowRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const loadKeys = async () => {
    if (keysLoaded || loadingKeys) return;
    setLoadingKeys(true);
    setError("");
    try {
      const result = await loadHiveEnvKeys();
      setEnvKeys([...new Set(result.keys.filter(isValidHiveEnvKey))].sort((a, b) => a.localeCompare(b)));
      setKeysLoaded(true);
      if (result.error) setError(result.error);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not read shared hive env names.");
    } finally {
      setLoadingKeys(false);
    }
  };

  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <div className={wrc("keyRow")} ref={rowRef} onClick={stop} role="presentation">
      {requestedKey && selected && selected !== requestedKey ? (
        <p className={wrc("keyMapping")}>Requested <code>{requestedKey}</code></p>
      ) : null}

      <div className={wrc("keyTop")}>
        <span className={wrc("keyDot", filled && "keyDotFilled")} aria-hidden="true" />
        {selected ? (
          <span className={wrc("keySelectedChip")} aria-label={`Selected shared env key ${selected}`}>
            <span>{selected}</span>
            <button type="button" className={wrc("keyClear")} onClick={() => onChange({ selected: "", name: requestedKey })} disabled={disabled} aria-label={`Clear selected env key ${selected}`} title="Clear selected env key">
              {IconX({ size: 12 })}
            </button>
          </span>
        ) : hasRequestedName ? (
          <span className={wrc("keyName")}>{state.name || requestedKey}</span>
        ) : (
          <input className={wrc("keyNameInput")} value={state.name} onChange={(event) => onChange({ name: event.target.value.toUpperCase() })} placeholder="ENV_KEY_NAME" aria-label="Env variable name" autoComplete="off" spellCheck={false} disabled={disabled} />
        )}
        <span className={wrc("keyBadge", filled && "keyBadgeFilled")}>{badgeText}</span>
      </div>

      {selected ? (
        <p className={wrc("keyLinkedNote")}>
          {IconCheck({ size: 12, sw: 2 })}
          Reuses the existing value from the shared env — nothing to paste.
        </p>
      ) : (
        <>
          <div className={wrc("keyInputRow")}>
            <div className={wrc("keyInputWrap")}>
              <input className={wrc("keyInput", filled && "keyInputFilled")} type={revealed ? "text" : "password"} value={state.value} onChange={(event) => onChange({ value: event.target.value })} placeholder={placeholder} aria-label="Env variable value" autoComplete="off" spellCheck={false} disabled={disabled} />
              <button type="button" className={wrc("keyPickerBtn", menuOpen && "keyPickerBtnOpen")} onClick={() => { if (disabled) return; const next = !menuOpen; setMenuOpen(next); if (next) void loadKeys(); }} disabled={disabled} aria-expanded={menuOpen} aria-label="Link an existing shared env key" title="Link an existing shared env key">
                {loadingKeys ? IconLoader({ size: 14, className: wrc("spin") }) : IconList({ size: 14 })}
              </button>
            </div>
            <button type="button" className={wrc("keyReveal")} onClick={() => setRevealed((current) => !current)} disabled={disabled} aria-label={revealed ? "Hide value" : "Show value"} title={revealed ? "Hide value" : "Show value"}>
              {IconEye(revealed)}
            </button>
          </div>
          <p className={wrc("keyHelp")}>Paste a value, or use {IconList({ size: 11, sw: 2 })} to link an existing hive env key.</p>

          {menuOpen ? (
            <div className={wrc("picker")} role="listbox" aria-label="Shared hive env keys">
              <label className={wrc("pickerSearch")} aria-label="Search shared env keys">
                {IconSearch({ size: 14 })}
                <input type="search" value={keySearch} onChange={(event) => setKeySearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); if (event.key === "Escape") setMenuOpen(false); }} placeholder="Search shared env keys…" spellCheck={false} autoComplete="off" />
              </label>
              {loadingKeys ? (
                <p className={wrc("pickerLoading")} role="status">{IconLoader({ size: 14, className: wrc("spin") })}Reading env names</p>
              ) : filteredEnvKeys.length ? (
                <div className={wrc("pickerOptions")}>
                  {filteredEnvKeys.map((key) => {
                    const match = Boolean(keySearch.trim()) && key.toUpperCase().startsWith(keySearch.trim().toUpperCase());
                    return (
                      <button key={key} type="button" role="option" aria-selected={selected === key} className={wrc("pickerOption", selected === key && "pickerOptionActive")} onClick={() => { onChange({ selected: key, name: key, value: "" }); setMenuOpen(false); }}>
                        <span>{key}</span>
                        {match ? <span className={wrc("pickerMatch")}>match</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className={wrc("pickerEmpty")}>{keysLoaded ? "No matching shared env keys." : "Open the list to read env names."}</p>
              )}
            </div>
          ) : null}
        </>
      )}

      {error ? <p className={wrc("error")} role="alert" style={{ margin: "6px 0 0" }}>{error}</p> : null}
    </div>
  );
}
