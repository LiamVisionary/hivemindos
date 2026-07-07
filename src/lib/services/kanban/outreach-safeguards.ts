import type { KanbanTask } from "@/lib/types/kanban";

export type OutreachCompletionBlock = {
  reason: string;
  requiredFields: string[];
};

const OUTREACH_TERMS = /\b(outreach|pitch|prospect|lead|email|consultation|contact form|customer-facing|website outreach agency|sarasota web agency)\b/i;
const SENT_STATUS = /(?:^|\n)\s*(?:status|outreach status)\s*:\s*(?:sent|submitted|delivered)\b/i;
const BLOCKED_STATUS = /(?:^|\n)\s*(?:status|outreach status)\s*:\s*blocked\b/i;
const RECEIPT_FIELD = /(?:^|\n)\s*(?:receipt|sent_at|sent at|submitted_at|submitted at|message-id|confirmation|provider response|form response|delivery receipt)\s*:/i;
const RECIPIENT_FIELD = /(?:^|\n)\s*(?:recipient|prospect|lead|business|client|to)\s*:/i;
const BLOCKER_FIELD = /(?:^|\n)\s*(?:blocker|blocked reason|reason|action needed)\s*:/i;
const EVIDENCE_FIELD = /(?:^|\n)\s*(?:evidence|verification|verified|checked|proof)\s*:/i;
const FINAL_FAILURE_TERMS = /\b(no final response|silent failure|fetch failed|429|rate limited|rate-limit|usage limit|usage-limit)\b/i;

export function isOutreachRevenueTask(task: Pick<KanbanTask, "title" | "body" | "source">) {
  const haystack = [task.title, task.body, task.source].filter(Boolean).join("\n");
  return /company:/i.test(task.source ?? "") && OUTREACH_TERMS.test(haystack);
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
  if (FINAL_FAILURE_TERMS.test(text) && !BLOCKED_STATUS.test(text)) {
    return {
      reason: "Outreach/revenue task completion blocked: runtime failure text must be recorded as Status: blocked with an explicit blocker instead of closing as done.",
      requiredFields: ["Status: blocked", "Blocker: <429/no-final-response/fetch failure detail>", "ACTION NEEDED: <human or retry decision when applicable>"],
    };
  }
  if (SENT_STATUS.test(text)) {
    const missing: string[] = [];
    if (!RECIPIENT_FIELD.test(text)) missing.push("Recipient:/Prospect:/Lead:");
    if (!RECEIPT_FIELD.test(text)) missing.push("Receipt:/Message-ID:/Confirmation:/Provider response:");
    if (!EVIDENCE_FIELD.test(text)) missing.push("Evidence:/Verification:");
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
