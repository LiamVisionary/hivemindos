import "server-only";

import { CommunityHoneyClient } from "./community-honey";
import { telegramPublicLabel } from "./community-honey-logic";
import { honeyAuditDetail, honeyRecognitionAuditId, type HoneyRecognitionAuditEntry } from "./honey-audit-state";
import { finishHoneyRecognitionAudit, startHoneyRecognitionAudit } from "./honey-audit-store";
import { HONEY_REACTION_REASON, HONEY_RECOGNITION_REACTION_EMOJI } from "./honey-recognition";
import { escapeHtml, type TelegramBotApi, type TgUpdate, type TgUser } from "./telegram-api";

type HoneyReactionHandlerInput = {
  api: Pick<TelegramBotApi, "sendMessage">;
  client: CommunityHoneyClient;
  update: TgUpdate;
  recipient: TgUser | null;
  notifyGiver: (userId: string, text: string) => Promise<boolean>;
};

export async function handleHoneyReactionWithAudit(input: HoneyReactionHandlerInput) {
  const reaction = input.update.message_reaction;
  const giver = reaction?.user;
  if (!reaction || !giver) return;

  const now = new Date().toISOString();
  const audit: HoneyRecognitionAuditEntry = {
    id: honeyRecognitionAuditId("reaction", input.update.update_id),
    source: "reaction",
    updateId: input.update.update_id,
    chatId: String(reaction.chat.id),
    messageId: reaction.message_id,
    giverUserId: String(giver.id),
    recipientUserId: input.recipient ? String(input.recipient.id) : undefined,
    outcome: "received",
    createdAt: now,
    updatedAt: now,
  };
  await startHoneyRecognitionAudit(audit);

  if (!input.recipient) {
    const detail = "The reacted-to message was not present in the recent-member index.";
    const auditUpdated = await finishHoneyRecognitionAudit(audit.id, { outcome: "rejected", detail })
      .then(() => true)
      .catch(() => false);
    const notified = await input.notifyGiver(
      String(giver.id),
      `${HONEY_RECOGNITION_REACTION_EMOJI} I couldn't match that message to a recent member. Reply to it with <code>/honey &lt;why&gt;</code> instead.`,
    );
    if (!notified || !auditUpdated) {
      await finishHoneyRecognitionAudit(audit.id, {
        outcome: "rejected-reply-failed",
        detail: `${detail}${notified ? " The audit outcome could not be finalized." : " The giver could not be notified."}`,
      }).catch(() => undefined);
      throw new Error("A rejected HONEY reaction could not be fully audited and reported.");
    }
    return;
  }

  let ledgerOutcome: "recorded" | "duplicate" | null = null;
  try {
    const result = await input.client.givePeerHoney({
      giverTelegramUserId: String(giver.id),
      recipientTelegramUserId: String(input.recipient.id),
      telegramUpdateId: String(input.update.update_id),
      reason: HONEY_REACTION_REASON,
    });
    ledgerOutcome = result.duplicate ? "duplicate" : "recorded";
    await finishHoneyRecognitionAudit(audit.id, {
      outcome: result.duplicate ? "duplicate" : "recorded",
      recognitionsRemainingToday: result.recognitionsRemainingToday,
      dailyRecognitionLimit: result.dailyRecognitionLimit,
      detail: result.duplicate
        ? "The hosted ledger had already processed this Telegram update."
        : "The hosted ledger recorded the recognition.",
    });
    if (result.duplicate) return;
    await input.api.sendMessage({
      chatId: reaction.chat.id,
      replyToMessageId: reaction.message_id,
      text: [
        `${HONEY_RECOGNITION_REACTION_EMOJI} <b>${escapeHtml(telegramPublicLabel(giver))} recognized ${escapeHtml(result.recipientPublicLabel || telegramPublicLabel(input.recipient))} via 🏆 reaction</b>`,
        `🍯 +${Number(result.honeyGiven || 1).toLocaleString()} HONEY`,
        `Quota for ${escapeHtml(telegramPublicLabel(giver))}: ${Number(result.recognitionsRemainingToday || 0).toLocaleString()} of ${Number(result.dailyRecognitionLimit || 0).toLocaleString()} recognitions left this UTC day.`,
        ...(result.recipientLinked === false
          ? ["Banked to their Telegram account — <code>/linkhoney</code> transfers it to HivemindOS anytime."]
          : []),
        `Receipt: <code>${escapeHtml(audit.id)}</code>`,
      ].join("\n"),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The recognition could not be recorded.";
    if (ledgerOutcome) {
      const auditUpdated = await finishHoneyRecognitionAudit(audit.id, {
        outcome: ledgerOutcome === "recorded" ? "recorded-reply-failed" : "duplicate",
        detail: `Post-ledger receipt handling failed: ${honeyAuditDetail(error)}`,
      }).then(() => true).catch(() => false);
      const notified = await input.notifyGiver(
        String(giver.id),
        ledgerOutcome === "recorded"
          ? `${HONEY_RECOGNITION_REACTION_EMOJI} HONEY was recorded, but I couldn't complete its Telegram receipt. An admin can verify <code>${escapeHtml(audit.id)}</code> with <code>/honeyaudit</code>.`
          : `${HONEY_RECOGNITION_REACTION_EMOJI} This Telegram update was already processed; no second HONEY was added. An admin can verify <code>${escapeHtml(audit.id)}</code> with <code>/honeyaudit</code>.`,
      );
      if (!notified || !auditUpdated) throw new Error(`Hosted HONEY receipt ${audit.id} could not be fully audited and delivered.`);
      return;
    }
    const auditUpdated = await finishHoneyRecognitionAudit(audit.id, { outcome: "rejected", detail: honeyAuditDetail(error) })
      .then(() => true)
      .catch(() => false);
    const notified = await input.notifyGiver(
      String(giver.id),
      `${HONEY_RECOGNITION_REACTION_EMOJI} Recognition not recorded: ${escapeHtml(reason)}\nReceipt: <code>${escapeHtml(audit.id)}</code>`,
    );
    if (!notified || !auditUpdated) {
      await finishHoneyRecognitionAudit(audit.id, {
        outcome: "rejected-reply-failed",
        detail: `${honeyAuditDetail(error)}${notified ? " The audit outcome could not be finalized." : " The giver could not be notified."}`,
      }).catch(() => undefined);
      throw new Error(`Rejected HONEY receipt ${audit.id} could not be fully audited and delivered.`);
    }
  }
}
