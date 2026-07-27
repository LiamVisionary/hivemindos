"use client";

/* ChatPill.tsx — the "Message the hive" pill. Collapsed it shows a breathing
   honey orb + label; on hover/focus it glides open into a full input. Pure CSS
   expansion (see fleet-hive.css) so it stays open while typing. */

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import {
  emitQueenVoiceToggle,
  getQueenVoiceOpen,
  listenForQueenVoiceState,
} from "@/lib/native/queen-voice-events";
import { filterChatSlashCommands } from "@/features/chat/hermes-slash-commands";

type ChatPillSlashCommand = {
  name: string;
  category: string;
  description: string;
  argsHint?: string;
  aliases?: string[];
  cliOnly?: boolean;
  gatewayOnly?: boolean;
};

export function ChatPill({
  placeholder,
  offsetX = 0,
  onSend,
  onComposerActiveChange,
  tone = "hive",
  wrapStyle,
  topSlot,
  slashCommands = [],
}: {
  placeholder?: string;
  /** px to nudge left of centre so the pill centres over the canvas, not under the panel */
  offsetX?: number;
  onSend?: (text: string) => void;
  onComposerActiveChange?: (active: boolean) => void;
  /** "hive" = honey palette; "legacy" = blue palette to match the graph/map/list views */
  tone?: "hive" | "legacy";
  /** override the wrap positioning (e.g. anchor to a corner in legacy views) */
  wrapStyle?: React.CSSProperties;
  /** rendered inside the (positioned) wrap so it can attach to the pill — e.g.
   *  the chat-history toggle tab that sits on the pill's top-centre edge. */
  topSlot?: React.ReactNode;
  slashCommands?: readonly ChatPillSlashCommand[];
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Reflect whether Queen Bee voice mode is live so the toggle reads as on/off.
  // The overlay owns the state and broadcasts it (incl. Escape/clap-wake closes).
  const [voiceActive, setVoiceActive] = useState(getQueenVoiceOpen);
  const [value, setValue] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [inputHovered, setInputHovered] = useState(false);
  const [selectedSlashCommandIndex, setSelectedSlashCommandIndex] = useState(0);
  useEffect(() => listenForQueenVoiceState(setVoiceActive), []);
  useEffect(() => {
    onComposerActiveChange?.(inputFocused || inputHovered);
  }, [inputFocused, inputHovered, onComposerActiveChange]);
  useEffect(() => {
    return () => onComposerActiveChange?.(false);
  }, [onComposerActiveChange]);
  const slashTokenMatch = slashCommands.length ? value.match(/^\/([^\s/]*)$/) : null;
  const slashCommandQuery = slashTokenMatch?.[1]?.toLowerCase() ?? "";
  const filteredSlashCommands = useMemo(() => {
    return filterChatSlashCommands(slashCommands, slashCommandQuery);
  }, [slashCommands, slashCommandQuery]);
  const slashCommandOpen = Boolean(inputFocused && slashTokenMatch && filteredSlashCommands.length > 0);

  const activeSlashCommandIndex = Math.min(selectedSlashCommandIndex, Math.max(0, filteredSlashCommands.length - 1));

  const selectSlashCommand = (command: ChatPillSlashCommand) => {
    const nextValue = `/${command.name}${command.name === "<skill-name>" ? "" : " "}`;
    setValue(nextValue);
    setSelectedSlashCommandIndex(0);
    window.requestAnimationFrame(() => {
      const input = ref.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(nextValue.length, nextValue.length);
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (v && onSend) onSend(v);
    setValue("");
    setSelectedSlashCommandIndex(0);
  };
  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!slashCommandOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedSlashCommandIndex((index) => Math.min(index + 1, filteredSlashCommands.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedSlashCommandIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      selectSlashCommand(filteredSlashCommands[activeSlashCommandIndex] ?? filteredSlashCommands[0]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setValue("");
      setSelectedSlashCommandIndex(0);
    }
  };
  const focusInput = () => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  };
  const blurInput = () => {
    setInputFocused(false);
    setInputHovered(false);
  };
  const focusInputFromContainer = (event: PointerEvent<HTMLFormElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button, input, textarea, select, a, [role='button']")) return;
    event.preventDefault();
    focusInput();
  };
  const resolvedWrapStyle = {
    ...(offsetX ? { left: `calc(50% - ${offsetX}px)` } : null),
    ...wrapStyle,
  };
  return (
    <div
      className="fr-chat-wrap"
      style={Object.keys(resolvedWrapStyle).length ? resolvedWrapStyle : undefined}
    >
      {topSlot}
      {slashCommandOpen ? (
        <div className="fr-chat-slash-tooltip" onPointerDown={(event) => event.preventDefault()}>
          <div className="fr-chat-slash-header">
            <strong>Commands</strong>
            <span>{filteredSlashCommands.length} matches</span>
          </div>
          <div className="fr-chat-slash-list" role="listbox" aria-label="Chat slash commands">
            {filteredSlashCommands.map((command, index) => {
              const active = index === activeSlashCommandIndex;
              const usage = `/${command.name}${command.argsHint ? ` ${command.argsHint}` : ""}`;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={active ? "active" : undefined}
                  key={`${command.category}:${command.name}:${index}`}
                  onMouseEnter={() => setSelectedSlashCommandIndex(index)}
                  onClick={() => selectSlashCommand(command)}
                >
                  <span>
                    <strong>{usage}</strong>
                    <small>{command.description}</small>
                    {command.aliases?.length ? <small>Aliases: {command.aliases.map((alias) => `/${alias}`).join(", ")}</small> : null}
                  </span>
                  <em>{command.gatewayOnly ? "gateway" : command.cliOnly ? "cli" : command.category}</em>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <form
        className={`fr-chat${tone === "legacy" ? " fr-chat--legacy" : ""}`}
        onPointerEnter={() => setInputHovered(true)}
        onPointerLeave={() => setInputHovered(false)}
        onPointerDown={focusInputFromContainer}
        onSubmit={onSubmit}
      >
        <span className="fr-chat-orb">
          <span className="ring" />
          <span className="core" />
        </span>
        <span className="fr-chat-label">Message the hive</span>
        <span className="fr-chat-field">
          <input
            ref={ref}
            className="fr-chat-input"
            value={value}
            placeholder={placeholder || "Ask the hive to dispatch a task…"}
            aria-label="Message the hive"
            aria-autocomplete={slashCommands.length ? "list" : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              setSelectedSlashCommandIndex(0);
            }}
            onFocus={() => setInputFocused(true)}
            onBlur={blurInput}
            onKeyDown={onInputKeyDown}
          />
          <button
            type="button"
            className={`fr-chat-voice${voiceActive ? " is-active" : ""}`}
            aria-pressed={voiceActive}
            aria-label={voiceActive ? "Turn off Queen Bee voice" : "Talk to the hive (voice)"}
            title={voiceActive ? "Voice mode on — tap to end" : "Talk to the hive (voice)"}
            onClick={() => emitQueenVoiceToggle()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </button>
          <button type="submit" className="fr-chat-send" aria-label="Send">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </span>
      </form>
    </div>
  );
}
