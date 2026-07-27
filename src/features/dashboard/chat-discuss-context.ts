/* chat-discuss-context.ts — the "discuss this inbox item with the Queen" bridge.
 *
 * When the user hits Discuss on an Alerts-inbox card (an automation-health
 * warning, a spend approval, or any alert row) the dashboard deep-links to the
 * /chat route with the Queen Bee agent selected, pre-fills an editable draft,
 * and pins a context BADGE for that item. The badge is folded (invisibly) into
 * the FIRST message the user sends so the Queen answers from the real item,
 * then it clears. Kept dependency-light so both the inbox and the chat send
 * path can import it without pulling in UI.
 */

export type ChatDiscussContextKind = "alert" | "approval" | "automation-health";

export type ChatDiscussContext = {
  /** Stable identity for the source inbox item (badge key / de-dupe). */
  id: string;
  kind: ChatDiscussContextKind;
  /** Short chip label shown in the composer badge. */
  label: string;
  /** Fact block folded into the first message so the Queen has the real item. */
  body: string;
};

function kindNoun(kind: ChatDiscussContextKind): string {
  if (kind === "approval") return "spend approval";
  if (kind === "automation-health") return "automation-health warning";
  return "alert";
}

/**
 * The context block appended (invisibly) to the FIRST message the user sends
 * while a discuss badge is attached. It never appears in the transcript — the
 * visible message stays exactly what the user typed — but the runtime receives
 * it so the Queen answers from the real inbox item.
 */
export function formatDiscussContextForPrompt(context: ChatDiscussContext): string {
  return [
    "———",
    `Context for this conversation — the ${kindNoun(context.kind)} I opened from my inbox:`,
    context.body.trim(),
    "———",
  ].join("\n");
}

/**
 * A short, editable question pre-filled into the composer. The user can send it
 * as-is, edit it, or clear it and write their own — the badge rides along with
 * whatever they send either way.
 */
export function discussDraftForContext(context: ChatDiscussContext): string {
  if (context.kind === "approval") return "Should I approve or reject this? What would you do?";
  if (context.kind === "automation-health") return "What's going on here, and what should I do about it?";
  return "What should I do about this?";
}
