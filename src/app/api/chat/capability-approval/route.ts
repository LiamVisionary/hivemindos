// guard:allow-hive-action-route - chat approval-plan plumbing: this route IS the human approval flow, not an agent-invocable capability.
import { NextRequest } from "next/server";
import {
  buildCapabilityApprovalPlan,
  capabilityApprovalContinuationPrompt,
  normalizeCapabilityApprovalPlan,
  requiresCapabilityApproval,
} from "@/lib/services/chat/capability-approval";
import { createAgentNotification, setAgentNotificationResolution } from "@/lib/services/obsidian/agent-notifications";
import { capabilityPlanRequiresReview } from "@/lib/types/capability-approval";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notificationId(planId: string) {
  return `capability-approval-${planId}`;
}

function notificationSource(agentId: string, chatLeaf: string) {
  return `chat-capability-approval|${encodeURIComponent(agentId)}|${encodeURIComponent(chatLeaf)}`;
}

function notificationBody(plan: Awaited<ReturnType<typeof buildCapabilityApprovalPlan>>) {
  const mapped = plan.items.map((item) => {
    const selected = item.candidates.find((candidate) => candidate.id === item.selectedCapabilityId) ?? item.candidates[0];
    return `- ${item.label}: ${selected.name}${selected.availability === "setup-required" ? " (setup approval requested)" : " (available)"}`;
  });
  return [
    `${plan.agentName} mapped the requested build to ${plan.items.length} capability ${plan.items.length === 1 ? "family" : "families"}.`,
    "",
    ...mapped,
    "",
    "Open the chat to review alternatives, remove task steps, add a GitHub source or instruction, and submit the plan.",
  ].join("\n");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "draft";
    const vaultPath = typeof body.vaultPath === "string" ? body.vaultPath : undefined;
    const notificationsFolder = typeof body.notificationsFolder === "string" ? body.notificationsFolder : undefined;

    if (action === "resolve") {
      const plan = normalizeCapabilityApprovalPlan(body.plan);
      if (!plan) return errorJson("A valid capability approval plan is required.");
      const approvedPlan = { ...plan, status: "approved" as const, resolvedAt: Date.now() };
      const notificationResolved = await setAgentNotificationResolution(
        notificationId(plan.id),
        { status: "resolved", note: "Capability plan submitted in chat.", by: "dashboard" },
        { vaultPath, notificationsFolder },
      ).then(() => true, () => false);
      return okJson({
        plan: approvedPlan,
        continuationPrompt: capabilityApprovalContinuationPrompt(approvedPlan),
        notificationResolved,
      });
    }

    if (action !== "draft") return errorJson("Unsupported capability approval action.");
    const task = typeof body.task === "string" ? body.task.trim() : "";
    if (!requiresCapabilityApproval(task)) return okJson({ required: false });
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    const chatStorageKey = typeof body.chatStorageKey === "string" ? body.chatStorageKey.trim() : "";
    if (!agentId || !chatStorageKey) return errorJson("Agent and chat thread are required.");
    const plan = await buildCapabilityApprovalPlan({
      task,
      agentId,
      agentName: typeof body.agentName === "string" ? body.agentName : undefined,
      chatStorageKey,
      chatLeaf: typeof body.chatLeaf === "string" ? body.chatLeaf : undefined,
      vaultPath,
      workingDirectory: typeof body.workingDirectory === "string" ? body.workingDirectory : undefined,
      origin: request.nextUrl.origin,
    });
    const notificationCreated = capabilityPlanRequiresReview(plan) ? await createAgentNotification({
      id: notificationId(plan.id),
      title: `Capability plan waiting: ${task.replace(/\s+/g, " ").slice(0, 100)}`,
      body: notificationBody(plan),
      priority: "high",
      kind: "decision",
      agentName: plan.agentName,
      agentId: plan.agentId,
      source: notificationSource(plan.agentId, plan.chatLeaf),
      tags: ["approval", "capability-approval", "chat"],
    }, { vaultPath, notificationsFolder }).then(() => true, () => false) : false;
    return okJson({ required: capabilityPlanRequiresReview(plan), plan, notificationCreated });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not prepare the capability plan.", 500);
  }
}
