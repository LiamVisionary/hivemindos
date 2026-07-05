"use client";
// Focused composer for injecting a standing directive into a company: a text
// instruction + an optional skill slug + reference attachments. Reuses the
// chat/task attachment model (createFileReferenceAttachments → KanbanTaskAttachment)
// so attachments behave exactly like the chat composer, without dragging in
// ComposerField's voice/model-picker/directory plumbing that a "redirect the
// crew" box doesn't need.
import React from "react";
import { createFileReferenceAttachments } from "@/features/chat/chat-file-references";
import type { KanbanTaskAttachment } from "@/lib/types/kanban";

export type DirectiveDraft = { text: string; skill?: string; attachments?: KanbanTaskAttachment[] };

export function CompanyDirectiveComposer({
  placeholder = "Tell the crew what to do differently…",
  submitLabel = "Inject knowledge",
  busy = false,
  autoFocus = false,
  onSubmit,
}: {
  placeholder?: string;
  submitLabel?: string;
  busy?: boolean;
  autoFocus?: boolean;
  onSubmit: (draft: DirectiveDraft) => void | Promise<void>;
}) {
  const [text, setText] = React.useState("");
  const [skill, setSkill] = React.useState("");
  const [attachments, setAttachments] = React.useState<KanbanTaskAttachment[]>([]);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const onFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      setAttachments((current) => [...current, ...createFileReferenceAttachments(event.target.files!)]);
    }
    if (fileRef.current) fileRef.current.value = "";
  };
  const removeAttachment = (id: string) => setAttachments((current) => current.filter((a) => a.id !== id));

  const canSubmit = text.trim().length > 0 && !busy;
  const submit = async () => {
    if (!canSubmit) return;
    await onSubmit({
      text: text.trim(),
      skill: skill.trim() || undefined,
      attachments: attachments.length ? attachments : undefined,
    });
    setText("");
    setSkill("");
    setAttachments([]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
        placeholder={placeholder}
        rows={3}
        style={{ resize: "vertical", minHeight: 64, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 13, lineHeight: 1.5 }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={skill}
          onChange={(e) => setSkill(e.target.value)}
          placeholder="skill slug (optional), e.g. self-serve-payment-funnel"
          style={{ flex: 1, minWidth: 220, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg)", fontFamily: "var(--f-mono)", fontSize: 11 }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} title="Attach reference files" style={{ cursor: "pointer", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)", borderRadius: 8, padding: "8px 12px", fontFamily: "var(--f-mono)", fontSize: 11 }}>+ attach</button>
        <input ref={fileRef} type="file" multiple onChange={onFiles} style={{ display: "none" }} />
        <button type="button" onClick={submit} disabled={!canSubmit} style={{ cursor: canSubmit ? "pointer" : "not-allowed", border: "1px solid var(--honey)", background: canSubmit ? "var(--honey)" : "transparent", color: canSubmit ? "var(--bg-0)" : "var(--fg-4)", borderRadius: 8, padding: "8px 14px", fontFamily: "var(--f-display)", fontSize: 12, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>{busy ? "…" : submitLabel}</button>
      </div>
      {attachments.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {attachments.map((a) => (
            <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-3)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 6px 3px 10px" }}>
              📎 {a.name}
              <button type="button" onClick={() => removeAttachment(a.id)} aria-label="Remove attachment" style={{ cursor: "pointer", border: "none", background: "var(--bg-3)", color: "var(--fg-3)", borderRadius: 999, width: 16, height: 16, fontSize: 10, lineHeight: 1 }}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
