import { execFile } from "child_process";
import { promisify } from "util";
import { createAgentNotification } from "@/lib/services/obsidian/agent-notifications";
import type { InboxTriageRunResult } from "@/lib/services/brain/inbox-triage";

const execFileAsync = promisify(execFile);
const NOTIFICATION_TITLE = "HivemindOS Inbox Triage";

export type InboxTriageNotificationCopy = {
  title: string;
  body: string;
  desktopBody: string;
};

export type InboxTriageNotificationResult = {
  persisted: boolean;
  desktop: boolean;
  errors: string[];
  skipped?: "disabled" | "no-report";
};

type PublishInboxTriageNotificationOptions = {
  vaultPath?: string;
  desktop?: boolean;
};

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function inboxTriageNotificationCopy(result: InboxTriageRunResult): InboxTriageNotificationCopy {
  const itemCount = result.itemCount ?? 0;
  const newCount = result.newCount ?? 0;
  const reviewCount = result.counts?.review ?? 0;
  const reviewed = countLabel(itemCount, "item") + " reviewed";
  const newItems = `${newCount} new`;
  const review = reviewCount === 0
    ? "none need review"
    : `${countLabel(reviewCount, "item")} ${reviewCount === 1 ? "needs" : "need"} review`;
  return {
    title: "Inbox Triage report ready",
    body: `${reviewed}. ${newItems}; ${review}. The daily report is ready in Brain → Brain Services → Overview.`,
    desktopBody: `${reviewed} · ${newItems} · ${review}. Report ready.`,
  };
}

async function sendMacDesktopNotification(body: string): Promise<void> {
  const script = [
    "on run argv",
    "display notification (item 1 of argv) with title (item 2 of argv)",
    "end run",
  ].join("\n");
  await execFileAsync("/usr/bin/osascript", ["-e", script, "--", body, NOTIFICATION_TITLE], {
    timeout: 8_000,
  });
}

/** Persist a HivemindOS alert and, on macOS, mirror it to Notification Center. */
export async function publishInboxTriageNotification(
  result: InboxTriageRunResult,
  options: PublishInboxTriageNotificationOptions = {},
): Promise<InboxTriageNotificationResult> {
  if (!result.ran || !result.reportDate) {
    return { persisted: false, desktop: false, errors: [], skipped: "no-report" };
  }
  if ((process.env.HIVEMINDOS_INBOX_TRIAGE_NOTIFY || "").trim() === "0") {
    return { persisted: false, desktop: false, errors: [], skipped: "disabled" };
  }

  const copy = inboxTriageNotificationCopy(result);
  const errors: string[] = [];
  let persisted = false;
  let desktop = false;
  try {
    await createAgentNotification({
      id: `inbox-triage-report-${result.reportDate}`,
      title: copy.title,
      body: copy.body,
      priority: (result.newCount ?? 0) > 0 ? "normal" : "low",
      kind: "system",
      agentName: "HivemindOS",
      source: "Inbox Triage",
      tags: ["brain-service", "inbox-triage", "report"],
    }, { vaultPath: options.vaultPath });
    persisted = true;
  } catch (error) {
    errors.push(`alert: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (options.desktop !== false && process.platform === "darwin") {
    try {
      await sendMacDesktopNotification(copy.desktopBody);
      desktop = true;
    } catch (error) {
      errors.push(`desktop: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { persisted, desktop, errors };
}
