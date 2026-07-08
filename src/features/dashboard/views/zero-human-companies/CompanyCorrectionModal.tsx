"use client";

// Shared correction/teaching wrapper for company-learning directives. The
// underlying modal is still RejectDeliverableModal, so every correction writes
// through the existing add-directive flow.
import React from "react";
import { RejectDeliverableModal } from "./RejectDeliverableModal";
import type { Theme } from "./types";

type BaseProps = {
  companyId: string;
  deliverableRef: string;
  theme?: Theme;
  onClose: () => void;
  onDone?: () => void;
};

type EmailCorrectionProps = BaseProps & {
  kind: "email";
  companyName: string;
  subject: string;
};

type EmailQaTeachingKind = "teach-note" | "teach-different";

type EmailQaCorrectionProps = BaseProps & {
  kind: EmailQaTeachingKind;
  issueLabel: string;
  affectedCount: number;
  suggestedDirective: string;
};

type CompanyCorrectionModalProps = EmailCorrectionProps | EmailQaCorrectionProps;

const TEACHING_TITLE: Record<EmailQaTeachingKind, string> = {
  "teach-note": "Teach the crew with a note",
  "teach-different": "Teach the crew differently",
};

const TEACHING_PLACEHOLDER: Record<EmailQaTeachingKind, string> = {
  "teach-note": "Add context, examples, exceptions, or references for the crew...",
  "teach-different": "Write the standing directive the crew should follow instead...",
};

function emailCountLabel(count: number) {
  return `${count} sent email${count === 1 ? "" : "s"}`;
}

export function CompanyCorrectionModal(props: CompanyCorrectionModalProps) {
  if (props.kind === "email") {
    return (
      <RejectDeliverableModal
        companyId={props.companyId}
        deliverableRef={props.deliverableRef}
        theme={props.theme}
        icon="✉️"
        title="Correct the agent on this email"
        submitLabel="Send correction"
        placeholder="What's wrong with this email / what to do differently next time..."
        intro={(
          <>
            Correcting how {props.companyName}&apos;s crew handled <b style={{ color: "var(--fg-2)" }}>{props.subject}</b>. Your feedback becomes a standing directive in company knowledge — the crew reads it on every dispatch, so it fixes this next time. Optionally point them at a skill or attach references.
          </>
        )}
        onClose={props.onClose}
        onDone={props.onDone}
      />
    );
  }

  const suggestedDirective = props.suggestedDirective.trim() || `Fix the "${props.issueLabel}" problem in future emails.`;
  const initialText = props.kind === "teach-different"
    ? ""
    : `${suggestedDirective} (Flagged by email QA across ${emailCountLabel(props.affectedCount)}: ${props.issueLabel}.)`;

  return (
    <RejectDeliverableModal
      companyId={props.companyId}
      deliverableRef={props.deliverableRef}
      theme={props.theme}
      icon="🎓"
      title={TEACHING_TITLE[props.kind]}
      submitLabel={props.kind === "teach-different" ? "Save directive" : "Save teaching"}
      placeholder={TEACHING_PLACEHOLDER[props.kind]}
      initialText={initialText}
      intro={(
        <>
          Teaching the crew about <b style={{ color: "var(--fg-2)" }}>{props.issueLabel}</b> across {emailCountLabel(props.affectedCount)}. Your feedback becomes a standing directive in company knowledge — the crew reads it on every dispatch, so future outreach adjusts before it ships.
        </>
      )}
      onClose={props.onClose}
      onDone={props.onDone}
    />
  );
}
