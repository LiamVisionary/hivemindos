import type { KanbanTask } from "@/lib/types/kanban";
import {
  formatPreviewSalesJourneyQaBlock,
  previewSalesJourneyQaBlockReason,
} from "@/lib/services/kanban/preview-sales-journey-qa";

export type OutreachCompletionBlock = {
  reason: string;
  requiredFields: string[];
};

const OUTREACH_TERMS = /\b(outreach|pitch|prospect|lead|email|consultation|contact form|customer-facing|website outreach agency|sarasota web agency)\b/i;
const OUTBOUND_ACTION_TERMS = /\b(?:send|sending|sent|submit|submitting|submitted|deliver|delivering|delivered|contact(?:ing|ed)|contact (?:the )?(?:prospects?|leads?|businesses?|clients?)|reach(?:ing)? out|pitch(?:ing|ed)? to|email(?:ing|ed)? (?:the )?(?:prospects?|leads?|businesses?|clients?))\b/i;
const SENT_STATUS = /(?:^|\n)\s*(?:status|outreach status)\s*:\s*(?:sent|submitted|delivered)\b/i;
const BLOCKED_STATUS = /(?:^|\n)\s*(?:status|outreach status)\s*:\s*blocked\b/i;
const RECEIPT_FIELD = /(?:^|\n)\s*(?:receipt|sent_at|sent at|submitted_at|submitted at|message-id|confirmation|provider response|form response|delivery receipt)\s*:/i;
const RECIPIENT_FIELD = /(?:^|\n)\s*(?:recipient|prospect|lead|business|client|to)\s*:/i;
const BLOCKER_FIELD = /(?:^|\n)\s*(?:blocker|blocked reason|reason|action needed)\s*:/i;
const EVIDENCE_FIELD = /(?:^|\n)\s*(?:evidence|verification|verified|checked|proof)\s*:/i;
const PREVIEW_SALES_JOURNEY_TERMS = /\b(preview|customer-facing website|proposal link|proposal page|payment flow|checkout|lead form|sales journey)\b/i;
const FINAL_FAILURE_TERMS = /\b(no final response|silent failure|fetch failed|429|rate limited|rate-limit|usage limit|usage-limit)\b/i;

function taskRequestText(body?: string) {
  const text = body ?? "";
  const request = text.match(
    /(?:^|\n)\s*(?:#{1,6}\s*)?Request\s*\n([\s\S]*?)(?=\n\s*---\s*(?:\n|$)|$)/i,
  )?.[1];
  return request?.trim() || text;
}

function stripNegatedOutboundActions(text: string) {
  return text
    .replace(
      /\b(?:do not|don't|must not|never|without)\b[^\n.;]*(?:[.;]|$)/gi,
      " ",
    )
    .replace(
      /\bno\s+(?:external\s+)?(?:sending|send|contact|outreach|email delivery)\b[^\n.;]*(?:[.;]|$)/gi,
      " ",
    );
}

export function isOutreachRevenueTask(task: Pick<KanbanTask, "title" | "body" | "source">) {
  if (!/company:/i.test(task.source ?? "")) return false;
  const requestText = [task.title, taskRequestText(task.body)]
    .filter(Boolean)
    .join("\n");
  return (
    OUTREACH_TERMS.test(requestText) &&
    OUTBOUND_ACTION_TERMS.test(stripNegatedOutboundActions(requestText))
  );
}

export function validateOutreachCompletion(
  task: Pick<KanbanTask, "title" | "body" | "source">,
  result?: string,
): OutreachCompletionBlock | null {
  if (!isOutreachRevenueTask(task)) return null;
  const text = (result ?? "").trim();
  if (!text) {
    return {
      reason: "Outreach/revenue task completion blocked: final response is empty, so the Work Board would have no sent receipt or blocker.",
      requiredFields: ["Status: sent|blocked", "Receipt: <provider/form/message receipt> OR Blocker:/ACTION NEEDED:", "Evidence: <verification performed>"],
    };
  }
  const hasSentStatus = SENT_STATUS.test(text);
  const hasBlockedStatus = BLOCKED_STATUS.test(text);
  if (FINAL_FAILURE_TERMS.test(text) && !hasSentStatus && !hasBlockedStatus) {
    return {
      reason: "Outreach/revenue task completion blocked: runtime failure text must be recorded as Status: blocked with an explicit blocker instead of closing as done.",
      requiredFields: ["Status: blocked", "Blocker: <429/no-final-response/fetch failure detail>", "ACTION NEEDED: <human or retry decision when applicable>"],
    };
  }
  if (hasSentStatus) {
    const missing: string[] = [];
    if (!RECIPIENT_FIELD.test(text)) missing.push("Recipient:/Prospect:/Lead:");
    if (!RECEIPT_FIELD.test(text)) missing.push("Receipt:/Message-ID:/Confirmation:/Provider response:");
    if (!EVIDENCE_FIELD.test(text)) missing.push("Evidence:/Verification:");
    if (PREVIEW_SALES_JOURNEY_TERMS.test(text)) {
      const qaBlock = previewSalesJourneyQaBlockReason(text);
      if (qaBlock) {
        return {
          reason: formatPreviewSalesJourneyQaBlock(qaBlock),
          requiredFields: qaBlock.requiredEvidence,
        };
      }
    }
    return missing.length
      ? {
          reason: "Outreach/revenue task completion blocked: sent status needs a clear Work Board receipt before it can be done.",
          requiredFields: missing,
        }
      : null;
  }
  if (BLOCKED_STATUS.test(text)) {
    const missing: string[] = [];
    if (!BLOCKER_FIELD.test(text)) missing.push("Blocker:/ACTION NEEDED:");
    if (!EVIDENCE_FIELD.test(text)) missing.push("Evidence:/Verification:");
    return missing.length
      ? {
          reason: "Outreach/revenue task completion blocked: blocked status needs a specific blocker and evidence trail.",
          requiredFields: missing,
        }
      : null;
  }
  return {
    reason: "Outreach/revenue task completion blocked: final response must declare whether outreach was sent or blocked.",
    requiredFields: ["Status: sent|blocked", "Recipient:/Prospect:/Lead:", "Receipt: <if sent>", "Blocker:/ACTION NEEDED: <if blocked>", "Evidence:/Verification:"],
  };
}

export function formatOutreachCompletionBlock(block: OutreachCompletionBlock) {
  return [
    `⚠ ${block.reason}`,
    `Required Work Board evidence fields: ${block.requiredFields.join("; ")}.`,
    "ACTION NEEDED: Re-run or revise the worker result with Status: sent plus a receipt, or Status: blocked plus the exact blocker and evidence.",
  ].join("\n");
}

// The human owner cannot act on "re-run or revise the worker result" — that is a
// directive for the worker, not a decision for a person. When an outreach/revenue
// completion is parked for the OWNER (needs-human) rather than bounced back to the
// worker, store a plain-language ask instead. The required-fields line is kept for
// the record and for a worker that later re-runs.
const OUTREACH_HUMAN_ASK =
  "The crew finished this but couldn't confirm the outreach was actually sent, and nothing goes to a customer without your approval. Nothing was sent and no money was spent. Review what it produced, then use Discuss to tell the crew to send it, hold it as a draft, or fix what's missing.";

export function formatOutreachCompletionHumanBlock(block: OutreachCompletionBlock) {
  return [
    `⚠ ${block.reason}`,
    `Required Work Board evidence fields: ${block.requiredFields.join("; ")}.`,
    `ACTION NEEDED: ${OUTREACH_HUMAN_ASK}`,
  ].join("\n");
}
