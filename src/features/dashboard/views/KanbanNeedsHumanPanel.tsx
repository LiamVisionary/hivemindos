"use client";

import { useState, type FormEvent, type MouseEvent } from "react";
import { createStyleClass } from "@/features/dashboard/style-classes";
import type { HumanAsk } from "@/features/dashboard/kanban-result-format";
import convoStyles from "@/app/kanban-conversation.module.css";

const convoClass = createStyleClass(convoStyles);

type KanbanNeedsHumanPanelProps = {
  ask: HumanAsk;
  /** Card-sized rendering: tighter controls, file asks defer to the modal. */
  compact?: boolean;
  onAnswer: (answer: string) => void | Promise<void>;
  /** Saves the credential to the shared hive env, then resumes the task.
   * Resolves to an error message, or "" on success. */
  onSaveApiKey?: (envKey: string, value: string) => Promise<string>;
};

/**
 * The interactive body of a Needs-You callout: link buttons to wherever the
 * human gets the thing (API key page, dashboard, doc), one-click decision
 * options that answer the agent directly, an API-key input that saves via
 * hive-env-add (the secret never lands on the task), and an attach-the-file
 * hint that points at the conversation composer. Instances are keyed by task
 * id at the call sites so per-task input state never bleeds between cards.
 */
export function KanbanNeedsHumanPanel({ ask, compact, onAnswer, onSaveApiKey }: KanbanNeedsHumanPanelProps) {
  const [busy, setBusy] = useState(false);
  const [keyName, setKeyName] = useState(ask.input?.envKey ?? "");
  const [keyValue, setKeyValue] = useState("");
  const [error, setError] = useState("");

  const answer = async (text: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onAnswer(text);
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : "Could not send the answer.");
    } finally {
      setBusy(false);
    }
  };

  const submitKey = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !onSaveApiKey) return;
    setBusy(true);
    setError("");
    try {
      const failure = await onSaveApiKey(keyName.trim(), keyValue);
      if (failure) setError(failure);
      else setKeyValue("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the key.");
    } finally {
      setBusy(false);
    }
  };

  // Cards open their conversation on click — keep every interaction local.
  const stop = (event: MouseEvent) => event.stopPropagation();

  const showApiKey = ask.input?.kind === "api-key" && Boolean(onSaveApiKey);
  const hasControls = ask.links.length > 0 || ask.options.length > 0 || showApiKey || ask.input?.kind === "file";
  if (!hasControls && !error) return null;

  return (
    <div className={convoClass("needsYouActions", compact && "compact")} onClick={stop} role="presentation">
      {ask.links.length ? (
        <div className={convoClass("needsYouLinks")}>
          {ask.links.map((link) => (
            <a
              key={link.url}
              className={convoClass("needsYouLink")}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              title={link.url}
              onClick={stop}
            >
              {link.label}
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      ) : null}
      {ask.options.length ? (
        <div className={convoClass("needsYouOptions")} role="group" aria-label="Answer the agent">
          {ask.options.map((option) => (
            <button
              key={option}
              type="button"
              className={convoClass("needsYouOption")}
              disabled={busy}
              onClick={() => void answer(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      {showApiKey ? (
        <form className={convoClass("needsYouKeyForm")} onSubmit={(event) => void submitKey(event)}>
          <div className={convoClass("needsYouKeyRow")}>
            <input
              className={convoClass("needsYouKeyName")}
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              placeholder="ENV_KEY_NAME"
              aria-label="Credential name"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <input
              className={convoClass("needsYouKeyValue")}
              type="password"
              value={keyValue}
              onChange={(event) => setKeyValue(event.target.value)}
              placeholder={`Paste the ${keyName.trim() || "key"} value`}
              aria-label="Credential value"
              autoComplete="off"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !keyValue.trim() || !keyName.trim()}>
              {busy ? "Saving…" : "Save key & resume"}
            </button>
          </div>
          <p className={convoClass("needsYouHint")}>
            Saved to the shared hive env with hive-env-add — the value never lands on the task or in chat.
          </p>
        </form>
      ) : null}
      {ask.input?.kind === "file" ? (
        <p className={convoClass("needsYouHint")}>
          {compact
            ? "Open the card and attach the requested file in the conversation."
            : "Attach the requested file with the composer below, then send — the agent picks the task back up with it."}
        </p>
      ) : null}
      {error ? <p className={convoClass("needsYouError")} role="alert">{error}</p> : null}
    </div>
  );
}
