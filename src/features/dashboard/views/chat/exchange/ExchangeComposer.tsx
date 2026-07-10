"use client";

/* Chat-route composer, ported from the `Chat route UI redesign` prototype.
 *
 * This is a chat-only composer. It deliberately does NOT reuse
 * `ComposerField` (src/features/chat/chat-composer.tsx): that component is
 * shared by KanbanTaskModal, KanbanPanel, CompanyDirectiveComposer and the
 * fusion showcase, and the redesign's pill rail / effort slider / context
 * picker would have to be bolted onto all four. It does reuse the same real
 * wiring props and the same slash-command + permission-mode sources, and it
 * renders the same hidden `agentMode` / `permissionMode` inputs that
 * `sendMessage` reads out of the form's FormData.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { CHAT_PERMISSION_MODE_OPTIONS, normalizeChatPermissionMode } from "@/lib/types/chat-permissions";
import type { ChatPermissionMode } from "@/lib/types/chat-permissions";
import { CHAT_SLASH_COMMANDS, filterChatSlashCommands } from "@/features/chat/hermes-slash-commands";
import type { HermesSlashCommand } from "@/features/chat/hermes-slash-commands";
import { useComposerFileDrop, type ComposerFileDropHandler } from "@/features/chat/use-composer-file-drop";
import {
  CHAT_REASONING_EFFORT_OPTIONS,
  modelSupportsReasoningEffort,
  normalizeChatReasoningEffort,
} from "@/lib/types/chat-reasoning-effort";
import type { ChatReasoningEffort } from "@/lib/types/chat-reasoning-effort";

import {
  ClockIco,
  ICON_PATHS,
  Ico,
  MicIco,
  ModelIco,
  PILL_STYLE,
  POP_STYLE,
  SearchIco,
  SpinnerIco,
  SwarmIco,
  iconBtnStyle,
} from "./composer-primitives";

type ModelProvider = {
  slug: string;
  name: string;
  models: Array<{ id: string; name?: string; disabled?: boolean; disabledReason?: string }>;
};

/** One entry per distinct model, carrying every provider that serves it. */
type ModelGroup = {
  modelId: string;
  label: string;
  providers: Array<{ slug: string; name: string; disabled?: boolean }>;
};

/** The composer's model menu groups by MODEL, while `runtimeModelSelectionsByRuntime`
 *  is keyed by PROVIDER. Invert it once, memoized. */
export function groupModelsByModel(providers: ModelProvider[]): ModelGroup[] {
  const byModel = new Map<string, ModelGroup>();
  for (const provider of providers) {
    for (const model of provider.models ?? []) {
      const id = model.id?.trim();
      if (!id) continue;
      const existing = byModel.get(id);
      const entry = { slug: provider.slug, name: provider.name, disabled: model.disabled };
      if (existing) existing.providers.push(entry);
      else byModel.set(id, { modelId: id, label: model.name?.trim() || id, providers: [entry] });
    }
  }
  return [...byModel.values()];
}

export function filterModelGroups(groups: ModelGroup[], query: string): ModelGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((group) => {
      const nameHit = group.label.toLowerCase().includes(q) || group.modelId.toLowerCase().includes(q);
      const providers = nameHit ? group.providers : group.providers.filter((p) => p.name.toLowerCase().includes(q));
      return providers.length ? { ...group, providers } : null;
    })
    .filter((group): group is ModelGroup => group !== null);
}

type Attachment = { id: string; name: string };
type LinkedDirectory = { id: string; name: string; path?: string };
type RecentDirectory = { id: string; name: string; path?: string };

export type ExchangeComposerProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  busy?: boolean;
  canSend: boolean;
  onSubmit: () => void;

  agentMode: "plan" | "act";
  permissionMode: ChatPermissionMode;
  onPermissionModeChange: (mode: ChatPermissionMode) => void;

  reasoningEffort: ChatReasoningEffort;
  onReasoningEffortChange: (effort: ChatReasoningEffort) => void;

  modelProviders: ModelProvider[];
  currentProvider: string;
  currentModel: string;
  onSelectModel: (provider: string, model: string) => void;
  onOpenModelMenu?: () => void;
  modelPickerEnabled: boolean;

  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  /** Drag-and-drop attach. Handles both HTML5 drops and Tauri's native path drops. */
  onDropFileReferences?: ComposerFileDropHandler;
  onAttachDirectory?: () => void;
  directories: LinkedDirectory[];
  onRemoveDirectory?: (id: string) => void;
  recentDirectories: RecentDirectory[];
  onAttachRecentDirectory?: (directory: RecentDirectory) => void;

  machines: Array<{ key: string; name: string; detail?: string }>;
  selectedMachineName: string;
  workingDirectoryLabel: string;
  onChangeWorkingDirectory?: () => void;

  recording?: boolean;
  onToggleRecording?: () => void;
  onSwarmCommand?: () => void;
};

const EFFORT_LEVELS = CHAT_REASONING_EFFORT_OPTIONS;

export function ExchangeComposer(props: ExchangeComposerProps) {
  const {
    value, onChange, placeholder, busy, canSend, onSubmit,
    agentMode, permissionMode, onPermissionModeChange,
    reasoningEffort, onReasoningEffortChange,
    modelProviders, currentProvider, currentModel, onSelectModel, onOpenModelMenu, modelPickerEnabled,
    attachments, onRemoveAttachment, fileInputRef, imageInputRef, onFileChange, onImageChange, onDropFileReferences,
    onAttachDirectory, directories, onRemoveDirectory, recentDirectories, onAttachRecentDirectory,
    machines, selectedMachineName, workingDirectoryLabel, onChangeWorkingDirectory,
    recording, onToggleRecording, onSwarmCommand,
  } = props;

  const [menu, setMenu] = useState<"" | "perm" | "model" | "ctx" | "attach">("");
  const [attachRecentsOpen, setAttachRecentsOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [modelExpanded, setModelExpanded] = useState<Record<string, boolean>>({});
  const [slashIndex, setSlashIndex] = useState(0);
  // Drop stays enabled while the agent is streaming — the old ComposerField was
  // mounted with `disabled={false}`, so you could always queue an attachment.
  const { dropRef: rootRef, dropActive, dropHandlers } = useComposerFileDrop({
    enabled: true,
    onDropFileReferences,
  });
  const effortTrackRef = useRef<HTMLDivElement | null>(null);
  const effortDraggingRef = useRef(false);

  // One outside-pointer listener for every popover in the composer.
  useEffect(() => {
    if (!menu) return undefined;
    function closeOnOutside(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setMenu("");
      setAttachRecentsOpen(false);
    }
    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [menu, rootRef]);

  const slashMatches = useMemo<readonly HermesSlashCommand[]>(() => {
    const token = value.trim();
    if (!/^\/[a-z0-9-]*$/i.test(token)) return [];
    return filterChatSlashCommands(CHAT_SLASH_COMMANDS, token.slice(1)).slice(0, 8);
  }, [value]);

  // Reset the highlighted slash-command row whenever the draft text changes.
  // Adjusted during render (React's documented pattern for state derived from a
  // prop) instead of in an effect, which would paint one frame with a stale
  // highlight before correcting it.
  const [slashValueSeen, setSlashValueSeen] = useState(value);
  if (slashValueSeen !== value) {
    setSlashValueSeen(value);
    setSlashIndex(0);
  }

  const modelGroups = useMemo(() => groupModelsByModel(modelProviders), [modelProviders]);
  const visibleModelGroups = useMemo(() => filterModelGroups(modelGroups, modelSearch), [modelGroups, modelSearch]);
  const effortSupported = modelSupportsReasoningEffort(currentProvider, currentModel) && !modelSearch.trim();
  const effortIndex = Math.max(0, EFFORT_LEVELS.findIndex((level) => level.effort === normalizeChatReasoningEffort(reasoningEffort)));

  function applySlash(command: HermesSlashCommand) {
    onChange(`/${command.name} `);
    setSlashIndex(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashMatches.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashIndex((current) => (current + 1) % slashMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashIndex((current) => (current - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applySlash(slashMatches[Math.min(slashIndex, slashMatches.length - 1)]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onChange("");
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && (event.metaKey || event.ctrlKey || !event.nativeEvent.isComposing)) {
      event.preventDefault();
      if (canSend && !busy) onSubmit();
    }
  }

  function setEffortFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const track = effortTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const index = Math.round(fraction * (EFFORT_LEVELS.length - 1));
    const next = EFFORT_LEVELS[index]?.effort;
    if (next && next !== reasoningEffort) onReasoningEffortChange(next);
  }

  const permissionOption = CHAT_PERMISSION_MODE_OPTIONS.find((option) => option.mode === permissionMode)
    ?? CHAT_PERMISSION_MODE_OPTIONS[0];

  const contextActive = Boolean(selectedMachineName || workingDirectoryLabel);
  const contextLabel = !contextActive
    ? "Add context"
    : selectedMachineName && workingDirectoryLabel
      ? `${selectedMachineName} · ${workingDirectoryLabel}`
      : selectedMachineName || workingDirectoryLabel;

  const percent = (index: number) => `${(index / (EFFORT_LEVELS.length - 1)) * 100}%`;

  return (
    <div
      ref={rootRef}
      {...dropHandlers}
      data-drop-active={dropActive || undefined}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        minHeight: 140,
        border: `1px solid ${dropActive ? "var(--honey)" : "var(--line-2)"}`,
        borderRadius: 22,
        background: dropActive ? "color-mix(in srgb, var(--honey-soft) 60%, var(--panel))" : "color-mix(in srgb, var(--panel) 94%, transparent)",
        boxShadow: dropActive
          ? "0 20px 60px -30px rgba(0,0,0,0.5), inset 0 0 0 1px var(--honey-line)"
          : "0 20px 60px -30px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)",
        transition: "border-color 140ms ease, background 140ms ease",
      }}
    >
      {/* sendMessage() reads these out of the form's FormData. */}
      <input type="hidden" name="agentMode" value={agentMode} />
      <input type="hidden" name="permissionMode" value={permissionMode} />
      <input type="hidden" name="reasoningEffort" value={reasoningEffort} />

      {slashMatches.length ? (
        <div className="cx-pop cx-scroll" role="listbox" aria-label="Slash commands" style={{ position: "absolute", left: 0, right: 0, bottom: "calc(100% + 10px)", zIndex: 120, maxHeight: 288, overflowY: "auto", ...POP_STYLE, borderRadius: 14 }}>
          <div style={{ padding: "5px 9px 6px", fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--fg-4)" }}>Slash commands</div>
          {slashMatches.map((command, index) => (
            <button
              key={command.name}
              type="button"
              role="option"
              aria-selected={index === slashIndex}
              onClick={() => applySlash(command)}
              style={{ display: "flex", alignItems: "baseline", gap: 9, width: "100%", border: 0, borderRadius: 9, background: index === slashIndex ? "var(--panel-hi)" : "transparent", color: "var(--fg)", cursor: "pointer", padding: "8px 10px", textAlign: "left" }}
            >
              <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, flexShrink: 0 }}>
                <span style={{ fontFamily: "var(--f-body)", fontSize: 13, fontWeight: 500, color: "var(--honey)" }}>/{command.name}</span>
                {command.argsHint ? <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{command.argsHint}</span> : null}
              </span>
              <span style={{ flex: 1, fontSize: 11.5, lineHeight: 1.4, color: "var(--fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{command.description}</span>
            </button>
          ))}
        </div>
      ) : null}

      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label="Message composer"
        spellCheck
        style={{ flex: 1, minHeight: 66, maxHeight: 170, border: 0, outline: 0, background: "transparent", color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 14, lineHeight: 1.6, resize: "none", padding: "16px 18px 8px" }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "2px 12px 11px" }}>
        {attachments.length || directories.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, width: "100%", padding: "0 0 2px" }}>
            {attachments.map((attachment) => (
              <Chip key={attachment.id} label={attachment.name} onRemove={() => onRemoveAttachment(attachment.id)} />
            ))}
            {directories.map((directory) => (
              <Chip key={directory.id} label={directory.name} folder onRemove={onRemoveDirectory ? () => onRemoveDirectory(directory.id) : undefined} />
            ))}
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <input ref={fileInputRef} type="file" multiple onChange={onFileChange} style={{ display: "none" }} aria-hidden />
            <input ref={imageInputRef} type="file" accept="image/*" multiple onChange={onImageChange} style={{ display: "none" }} aria-hidden />

            {/* attach */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="cx-iconbtn"
                onClick={() => { setMenu((current) => (current === "attach" ? "" : "attach")); setAttachRecentsOpen(false); }}
                aria-expanded={menu === "attach"}
                title="Add to chat"
                aria-label="Add to chat"
                style={{ ...iconBtnStyle(menu === "attach"), transition: "transform 160ms cubic-bezier(0.2,0.9,0.2,1)", transform: menu === "attach" ? "rotate(45deg)" : "rotate(0deg)" }}
              >
                <Ico d={ICON_PATHS.plus} size={18} sw={2} />
              </button>
              {menu === "attach" ? (
                <div className="cx-pop" role="menu" aria-label="Add to chat" style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 120, width: 216, ...POP_STYLE }}>
                  <MenuItem icon={ICON_PATHS.paperclip} label="Images" onClick={() => { setMenu(""); imageInputRef.current?.click(); }} />
                  <MenuItem icon={ICON_PATHS.fileUp} label="Files" onClick={() => { setMenu(""); fileInputRef.current?.click(); }} />
                  {onAttachDirectory ? (
                    <MenuItem icon={ICON_PATHS.folder} label="Directories" onClick={() => { setMenu(""); onAttachDirectory(); }} />
                  ) : null}
                  {recentDirectories.length > 0 && onAttachRecentDirectory ? (
                    <>
                      <div style={{ height: 1, background: "var(--line)", margin: "5px 8px" }} />
                      <button type="button" className="cx-menuitem" onClick={() => setAttachRecentsOpen((open) => !open)} aria-expanded={attachRecentsOpen} style={menuItemStyle}>
                        <ClockIco size={17} />
                        <span style={{ flex: 1 }}>Recents</span>
                        <Ico d={ICON_PATHS.chevronDown} size={14} sw={2} stroke="var(--fg-4)" style={{ transition: "transform 160ms ease", transform: attachRecentsOpen ? "rotate(180deg)" : "rotate(0deg)" }} />
                      </button>
                      {attachRecentsOpen ? (
                        <div style={{ display: "grid", gap: 1, padding: "2px 0 0" }}>
                          {recentDirectories.slice(0, 6).map((directory) => (
                            <button
                              key={directory.id}
                              type="button"
                              className="cx-menuitem"
                              onClick={() => { setMenu(""); setAttachRecentsOpen(false); onAttachRecentDirectory(directory); }}
                              style={{ ...menuItemStyle, color: "var(--fg-2)", fontSize: 12.5, padding: "7px 10px 7px 12px" }}
                              title={directory.path || directory.name}
                            >
                              <Ico d={ICON_PATHS.folder} size={15} sw={1.7} stroke="var(--fg-4)" />
                              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{directory.name}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* permission mode */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="cx-pill"
                onClick={() => setMenu((current) => (current === "perm" ? "" : "perm"))}
                aria-expanded={menu === "perm"}
                title="Permission mode"
                style={{ ...PILL_STYLE, border: "1px solid color-mix(in srgb, var(--honey) 40%, transparent)", background: "var(--honey-soft)", color: "var(--honey)" }}
              >
                <Ico d={ICON_PATHS.shield} size={13} />
                {permissionOption.label.split(" ")[0]}
                <Ico d={ICON_PATHS.chevronDown} size={13} sw={2} />
              </button>
              {menu === "perm" ? (
                <div className="cx-pop" role="menu" aria-label="Permission mode" style={{ position: "absolute", left: 0, bottom: "calc(100% + 8px)", zIndex: 120, width: 342, ...POP_STYLE, borderRadius: 13 }}>
                  {CHAT_PERMISSION_MODE_OPTIONS.map((option) => {
                    const active = option.mode === permissionMode;
                    return (
                      <button
                        key={option.mode}
                        type="button"
                        className="cx-menuitem"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => { onPermissionModeChange(normalizeChatPermissionMode(option.mode)); setMenu(""); }}
                        style={{ display: "flex", alignItems: "flex-start", gap: 11, width: "100%", border: `1px solid ${active ? "color-mix(in srgb, var(--honey) 40%, transparent)" : "transparent"}`, borderRadius: 10, background: active ? "var(--honey-soft)" : "transparent", color: "var(--fg)", cursor: "pointer", padding: "10px 11px", textAlign: "left" }}
                      >
                        <span style={{ flex: 1, display: "grid", gap: 2, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: active ? "var(--honey)" : "var(--fg)" }}>{option.label}</span>
                          <span style={{ fontSize: 11.5, lineHeight: 1.4, color: "var(--fg-4)" }}>{option.detail}</span>
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, paddingTop: 1 }}>
                          {active ? <Ico d={ICON_PATHS.check} size={15} sw={2.4} stroke="var(--honey)" /> : null}
                          <span style={{ display: "grid", placeItems: "center", minWidth: 22, height: 22, border: "1px solid var(--line-2)", borderRadius: 6, background: "var(--panel-2)", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", padding: "0 4px" }}>{option.shortcut}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* model + reasoning effort */}
            {modelPickerEnabled ? (
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className="cx-pill"
                  onClick={() => { setMenu((current) => (current === "model" ? "" : "model")); setModelSearch(""); onOpenModelMenu?.(); }}
                  aria-expanded={menu === "model"}
                  title="Switch model"
                  style={{ ...PILL_STYLE, border: "1px solid var(--line-2)", background: "var(--panel-2)", color: "var(--fg-2)" }}
                >
                  <ModelIco size={14} />
                  {currentModel || "Model"}
                  <Ico d={ICON_PATHS.chevronDown} size={13} sw={2} />
                </button>
                {menu === "model" ? (
                  <div className="cx-pop cx-scroll" role="menu" aria-label="Model" style={{ position: "absolute", left: 0, bottom: "calc(100% + 8px)", zIndex: 90, width: 262, maxHeight: 360, overflowY: "auto", transformOrigin: "bottom", ...POP_STYLE, borderRadius: 12 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 2px 6px", minHeight: 34, border: "1px solid var(--line-2)", borderRadius: 9, background: "color-mix(in srgb, var(--bg-soft) 74%, transparent)", padding: "0 10px" }}>
                      <SearchIco size={14} />
                      <input
                        type="search"
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        placeholder="Search models & providers"
                        spellCheck={false}
                        style={{ width: "100%", minWidth: 0, border: 0, outline: 0, background: "transparent", color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 13 }}
                      />
                    </label>

                    {visibleModelGroups.length === 0 ? (
                      <p style={{ margin: "8px 4px 4px", color: "var(--fg-4)", fontSize: 11, lineHeight: 1.5, padding: 12, textAlign: "center" }}>No models match.</p>
                    ) : null}

                    {visibleModelGroups.map((group) => {
                      const single = group.providers.length === 1;
                      const activeProvider = group.providers.find((provider) => provider.slug === currentProvider && group.modelId === currentModel);
                      if (single) {
                        const only = group.providers[0];
                        const active = only.slug === currentProvider && group.modelId === currentModel;
                        return (
                          <button
                            key={group.modelId}
                            type="button"
                            className="cx-menuitem"
                            role="menuitemradio"
                            aria-checked={active}
                            onClick={() => { onSelectModel(only.slug, group.modelId); setMenu(""); setModelSearch(""); }}
                            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: 0, borderRadius: 8, background: active ? "var(--honey-soft)" : "transparent", color: active ? "var(--honey)" : "var(--fg-2)", cursor: "pointer", padding: "8px 10px", textAlign: "left", fontSize: 13 }}
                          >
                            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.label}</span>
                            {active ? <Ico d={ICON_PATHS.check} size={14} sw={2.2} stroke="var(--honey)" /> : null}
                          </button>
                        );
                      }
                      const expanded = Boolean(modelExpanded[group.modelId]);
                      return (
                        <div key={group.modelId} style={{ marginBottom: 1 }}>
                          <button
                            type="button"
                            className="cx-menuitem"
                            onClick={() => setModelExpanded((current) => ({ ...current, [group.modelId]: !current[group.modelId] }))}
                            aria-expanded={expanded}
                            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: 0, borderRadius: 8, background: "transparent", color: activeProvider ? "var(--honey)" : "var(--fg-2)", cursor: "pointer", padding: "8px 10px", textAlign: "left", fontSize: 13 }}
                          >
                            <span style={{ flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.label}</span>
                            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, color: "var(--fg-4)" }}>
                              {activeProvider ? activeProvider.name : `${group.providers.length} providers`}
                            </span>
                            <Ico d={ICON_PATHS.chevronDown} size={13} sw={2} style={{ transition: "transform 160ms ease", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }} />
                          </button>
                          {expanded ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 1, margin: "1px 0 3px 16px", paddingLeft: 8, borderLeft: "1px solid var(--line)" }}>
                              {group.providers.map((provider) => {
                                const active = provider.slug === currentProvider && group.modelId === currentModel;
                                return (
                                  <button
                                    key={provider.slug}
                                    type="button"
                                    className="cx-menuitem"
                                    role="menuitemradio"
                                    aria-checked={active}
                                    disabled={provider.disabled}
                                    onClick={() => { onSelectModel(provider.slug, group.modelId); setMenu(""); setModelSearch(""); }}
                                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: 0, borderRadius: 8, background: active ? "var(--honey-soft)" : "transparent", color: active ? "var(--honey)" : "var(--fg-2)", cursor: provider.disabled ? "not-allowed" : "pointer", opacity: provider.disabled ? 0.45 : 1, padding: "7px 10px", textAlign: "left", fontSize: 13 }}
                                  >
                                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.name}</span>
                                    {active ? <Ico d={ICON_PATHS.check} size={14} sw={2.2} stroke="var(--honey)" /> : null}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {/* Only rendered when the capability matrix says this model honours it. */}
                    {effortSupported ? (
                      <div style={{ margin: "6px 2px 2px", padding: "11px 11px 12px", borderTop: "1px solid var(--line-2)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 11 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--honey)" aria-hidden><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" /></svg>
                          <span style={{ flex: 1, fontSize: 11.5, fontWeight: 600, color: "var(--fg-2)" }}>Reasoning effort</span>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--honey)" }}>{EFFORT_LEVELS[effortIndex]?.label}</span>
                        </div>
                        <div
                          role="slider"
                          tabIndex={0}
                          aria-label="Reasoning effort"
                          aria-valuemin={0}
                          aria-valuemax={EFFORT_LEVELS.length - 1}
                          aria-valuenow={effortIndex}
                          aria-valuetext={EFFORT_LEVELS[effortIndex]?.label}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowLeft" && effortIndex > 0) { event.preventDefault(); onReasoningEffortChange(EFFORT_LEVELS[effortIndex - 1].effort); }
                            if (event.key === "ArrowRight" && effortIndex < EFFORT_LEVELS.length - 1) { event.preventDefault(); onReasoningEffortChange(EFFORT_LEVELS[effortIndex + 1].effort); }
                          }}
                          style={{ position: "relative", height: 26, outline: "none" }}
                        >
                          <div style={{ position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", height: 22, borderRadius: 999, background: "var(--panel-2)", border: "1px solid var(--line-2)" }} />
                          <div ref={effortTrackRef} style={{ position: "absolute", left: 13, right: 13, top: 0, bottom: 0 }}>
                            <div style={{ position: "absolute", top: "50%", left: 0, transform: "translateY(-50%)", height: 6, borderRadius: 999, background: "var(--honey)", width: percent(effortIndex), transition: "width 160ms cubic-bezier(0.2,0.9,0.2,1)" }} />
                            {EFFORT_LEVELS.map((level, index) => (
                              <span key={level.effort} title={level.label} style={{ position: "absolute", top: "50%", left: percent(index), transform: "translate(-50%,-50%)", width: 4, height: 4, borderRadius: 999, background: index <= effortIndex ? "rgba(255,255,255,0.85)" : "var(--fg-4)" }} />
                            ))}
                            <div style={{ position: "absolute", top: "50%", left: percent(effortIndex), transform: "translate(-50%,-50%)", width: 18, height: 18, borderRadius: 999, background: "#fff", boxShadow: "0 2px 7px rgba(0,0,0,0.45)", transition: "left 160ms cubic-bezier(0.2,0.9,0.2,1)" }} />
                            <div
                              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); effortDraggingRef.current = true; setEffortFromPointer(event); }}
                              onPointerMove={(event) => { if (effortDraggingRef.current) setEffortFromPointer(event); }}
                              onPointerUp={() => { effortDraggingRef.current = false; }}
                              style={{ position: "absolute", inset: "-8px 0", cursor: "grab", touchAction: "none" }}
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* machine + working directory */}
            <div style={{ position: "relative", minWidth: 0 }}>
              <button
                type="button"
                className="cx-pill"
                onClick={() => setMenu((current) => (current === "ctx" ? "" : "ctx"))}
                aria-expanded={menu === "ctx"}
                title="Set machine & working directory"
                style={{ ...PILL_STYLE, maxWidth: 230, border: `1px solid ${contextActive ? "var(--honey)" : "var(--line-2)"}`, background: contextActive ? "var(--honey-soft)" : "var(--panel-2)", color: contextActive ? "var(--honey)" : "var(--fg-2)" }}
              >
                <Ico d={contextActive && workingDirectoryLabel ? ICON_PATHS.folder : ICON_PATHS.chat} size={14} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{contextLabel}</span>
                <Ico d={ICON_PATHS.chevronDown} size={13} sw={2} style={{ opacity: 0.65 }} />
              </button>
              {menu === "ctx" ? (
                <div className="cx-pop" role="dialog" aria-label="Task context" style={{ position: "absolute", left: 0, bottom: "calc(100% + 8px)", zIndex: 90, width: 320, transformOrigin: "bottom", ...POP_STYLE, borderRadius: 14, padding: 14 }}>
                  <p style={{ margin: "0 0 4px", fontSize: 12.5, fontWeight: 700, color: "var(--fg)" }}>Task context</p>
                  <p style={{ margin: "0 0 13px", fontSize: 11, lineHeight: 1.45, color: "var(--fg-4)" }}>
                    Optional. Pick a machine to run on and a folder to work in — or leave both empty for a general chat.
                  </p>

                  <p style={{ margin: "0 0 7px", fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-4)" }}>Machine</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 15 }}>
                    {machines.length === 0 ? (
                      <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>No fleet machines are online.</span>
                    ) : machines.map((machine) => {
                      const active = machine.name === selectedMachineName;
                      return (
                        <span
                          key={machine.key}
                          className="cx-chip"
                          aria-pressed={active}
                          title={machine.detail || machine.name}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, minHeight: 28, border: `1px solid ${active ? "var(--honey)" : "var(--line-2)"}`, borderRadius: 999, background: active ? "var(--honey-soft)" : "var(--panel-2)", color: active ? "var(--honey)" : "var(--fg-2)", fontSize: 11.5, fontWeight: 600, padding: "0 11px" }}
                        >
                          {machine.name}
                        </span>
                      );
                    })}
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 7 }}>
                    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-4)" }}>Working directory</p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 9, borderRadius: 8, background: workingDirectoryLabel ? "var(--honey-soft)" : "transparent", color: workingDirectoryLabel ? "var(--honey)" : "var(--fg-2)", padding: "9px 10px", fontSize: 12 }}>
                      <Ico d={ICON_PATHS.folder} size={15} sw={1.7} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{workingDirectoryLabel || "No folder"}</span>
                    </span>
                    {onChangeWorkingDirectory ? (
                      <button type="button" className="cx-diritem" onClick={() => { setMenu(""); onChangeWorkingDirectory(); }} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", border: 0, borderRadius: 8, background: "transparent", color: "var(--fg-3)", cursor: "pointer", padding: "9px 10px", textAlign: "left", fontSize: 12 }}>
                        <Ico d={ICON_PATHS.folderPlus} size={15} sw={1.7} />
                        <span style={{ flex: 1 }}>Browse for a folder…</span>
                        <Ico d={ICON_PATHS.chevronRight} size={14} sw={2} stroke="var(--fg-4)" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {onSwarmCommand ? (
              <button type="button" className="cx-iconbtn" onClick={onSwarmCommand} title="Route to the swarm" aria-label="Swarm command" style={iconBtnStyle(false)}>
                <SwarmIco size={17} />
              </button>
            ) : null}
            {onToggleRecording ? (
              <button
                type="button"
                className={`cx-iconbtn${recording ? " is-rec cx-dot-live" : ""}`}
                onClick={onToggleRecording}
                aria-pressed={recording}
                title={recording ? "Stop voice input" : "Start voice input"}
                aria-label={recording ? "Stop voice input" : "Start voice input"}
                style={iconBtnStyle(false)}
              >
                <MicIco size={17} />
              </button>
            ) : null}
            <button
              type="submit"
              className="cx-send"
              disabled={!canSend || busy}
              title={busy ? "Waiting for the agent" : "Send"}
              aria-label="Send"
              style={{ display: "grid", placeItems: "center", width: 34, height: 34, border: 0, borderRadius: 999, background: canSend && !busy ? "var(--honey)" : "var(--panel-hi)", color: canSend && !busy ? "#1a1305" : "var(--fg-4)", cursor: canSend && !busy ? "pointer" : "default" }}
            >
              {busy ? <SpinnerIco size={17} /> : <Ico d={ICON_PATHS.sendUp} size={17} sw={2.2} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  width: "100%",
  border: 0,
  borderRadius: 9,
  background: "transparent",
  color: "var(--fg)",
  cursor: "pointer",
  padding: "9px 10px",
  textAlign: "left",
  fontSize: 13.5,
};

function MenuItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" className="cx-menuitem" onClick={onClick} style={menuItemStyle}>
      <Ico d={icon} size={17} />
      <span>{label}</span>
    </button>
  );
}

function Chip({ label, folder, onRemove }: { label: string; folder?: boolean; onRemove?: () => void }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 200, border: "1px solid var(--line-2)", borderRadius: 8, background: "var(--panel-2)", color: "var(--fg-2)", fontSize: 11, padding: "4px 6px 4px 9px" }}>
      <Ico
        d={folder ? ICON_PATHS.folder : ICON_PATHS.file}
        size={12}
        stroke="var(--fg-4)"
      />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>{label}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} style={{ display: "grid", placeItems: "center", width: 16, height: 16, border: 0, borderRadius: 5, background: "transparent", color: "var(--fg-4)", cursor: "pointer", padding: 0 }}>
          <Ico d={ICON_PATHS.close} size={11} sw={2.2} />
        </button>
      ) : null}
    </span>
  );
}
