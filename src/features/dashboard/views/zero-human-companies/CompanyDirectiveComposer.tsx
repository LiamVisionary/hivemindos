"use client";
// Focused composer for injecting a standing directive into a company: a text
// instruction + optional skill attachments + reference attachments. Reuses the
// chat/task attachment model (createFileReferenceAttachments → KanbanTaskAttachment)
// so attachments behave exactly like the chat composer, without dragging in
// ComposerField's voice/model-picker/directory plumbing that a "redirect the
// crew" box doesn't need.
import React from "react";
import { Paperclip, Puzzle, X } from "lucide-react";
import { createFileReferenceAttachments } from "@/features/chat/chat-file-references";
import { Spinner } from "./primitives";
import type { KanbanTaskAttachment } from "@/lib/types/kanban";
import type { SkillBrowserAttachmentTarget } from "@/features/dashboard/dashboard-types";

type SkillAttachmentBrowserOpener = (target: SkillBrowserAttachmentTarget) => void | Promise<void>;

export type DirectiveDraft = { text: string; skill?: string; skills?: string[]; attachments?: KanbanTaskAttachment[] };

function normalizedSkillSlugs(slugs: string[]) {
  return [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
}

export function CompanyDirectiveComposer({
  placeholder = "Tell the crew what to do differently…",
  submitLabel = "Inject knowledge",
  busy = false,
  autoFocus = false,
  openSkillAttachmentBrowser,
  onSubmit,
}: {
  placeholder?: string;
  submitLabel?: string;
  busy?: boolean;
  autoFocus?: boolean;
  openSkillAttachmentBrowser?: SkillAttachmentBrowserOpener;
  onSubmit: (draft: DirectiveDraft) => void | Promise<void>;
}) {
  const [text, setText] = React.useState("");
  const [skill, setSkill] = React.useState("");
  const [skillSlugs, setSkillSlugs] = React.useState<string[]>([]);
  const [attachments, setAttachments] = React.useState<KanbanTaskAttachment[]>([]);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const onFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      setAttachments((current) => [...current, ...createFileReferenceAttachments(event.target.files!)]);
    }
    if (fileRef.current) fileRef.current.value = "";
  };
  const removeAttachment = (id: string) => setAttachments((current) => current.filter((a) => a.id !== id));
  const removeSkill = (slug: string) => setSkillSlugs((current) => current.filter((item) => item !== slug));
  const attachSkills = () => {
    if (!openSkillAttachmentBrowser) return;
    void openSkillAttachmentBrowser({
      selectedSlugs: skillSlugs,
      onChange: (slugs) => setSkillSlugs(normalizedSkillSlugs(slugs)),
      eyebrow: "Company knowledge",
      title: "Attach skills",
      description: "Select the shared-brain recipes the crew should follow with this standing directive.",
      statusLabel: "selected for this directive",
    });
  };

  const canSubmit = text.trim().length > 0 && !busy;
  const submit = async () => {
    if (!canSubmit) return;
    const selectedSkills = openSkillAttachmentBrowser
      ? normalizedSkillSlugs(skillSlugs)
      : normalizedSkillSlugs(skill ? [skill] : []);
    await onSubmit({
      text: text.trim(),
      skill: selectedSkills[0],
      skills: selectedSkills.length ? selectedSkills : undefined,
      attachments: attachments.length ? attachments : undefined,
    });
    setText("");
    setSkill("");
    setSkillSlugs([]);
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
        style={{ resize: "vertical", minHeight: 64, width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line-2)", background: "var(--panel-2)", color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 13, lineHeight: 1.5, outline: "none" }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {openSkillAttachmentBrowser ? (
          <button type="button" onClick={attachSkills} title="Attach shared-brain skills" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)", borderRadius: 8, padding: "8px 12px", fontFamily: "var(--f-mono)", fontSize: 11 }}>
            <Puzzle size={14} aria-hidden="true" />
            {skillSlugs.length ? `${skillSlugs.length} skill${skillSlugs.length === 1 ? "" : "s"}` : "Attach skills"}
          </button>
        ) : (
          <input
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            placeholder="skill slug (optional), e.g. self-serve-payment-funnel"
            style={{ flex: 1, minWidth: 220, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--panel-2)", color: "var(--fg)", fontFamily: "var(--f-mono)", fontSize: 11, outline: "none" }}
          />
        )}
        <button type="button" onClick={() => fileRef.current?.click()} title="Attach reference files" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)", borderRadius: 8, padding: "8px 12px", fontFamily: "var(--f-mono)", fontSize: 11 }}>
          <Paperclip size={14} aria-hidden="true" />
          Attach refs
        </button>
        <input ref={fileRef} type="file" multiple onChange={onFiles} style={{ display: "none" }} />
        <button type="button" onClick={submit} disabled={!canSubmit} style={{ cursor: canSubmit ? "pointer" : "not-allowed", border: "1px solid var(--btn-line)", background: canSubmit ? "var(--btn-bg)" : "transparent", color: canSubmit ? "var(--btn-fg)" : "var(--fg-4)", borderRadius: 8, padding: "8px 16px", fontFamily: "var(--f-display)", fontSize: 12, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>{busy ? <Spinner size={12} /> : submitLabel}</button>
      </div>
      {skillSlugs.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {skillSlugs.map((slug) => (
            <span key={slug} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-3)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 6px 3px 10px" }}>
              <Puzzle size={12} aria-hidden="true" />
              {slug}
              <button type="button" onClick={() => removeSkill(slug)} aria-label={`Remove ${slug}`} style={{ cursor: "pointer", display: "inline-grid", placeItems: "center", border: "none", background: "var(--bg-3)", color: "var(--fg-3)", borderRadius: 999, width: 16, height: 16, padding: 0 }}>
                <X size={10} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {attachments.map((a) => (
            <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-3)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 6px 3px 10px" }}>
              <Paperclip size={12} aria-hidden="true" />
              {a.name}
              <button type="button" onClick={() => removeAttachment(a.id)} aria-label="Remove attachment" style={{ cursor: "pointer", display: "inline-grid", placeItems: "center", border: "none", background: "var(--bg-3)", color: "var(--fg-3)", borderRadius: 999, width: 16, height: 16, padding: 0 }}>
                <X size={10} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
