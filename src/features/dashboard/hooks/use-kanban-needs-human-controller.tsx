// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

// Resolving Needs-You cards from the Work Board UI: one-click decision
// answers, typed replies, and agent-requested API keys. Split from the
// dispatch controller so each stays under the file-size gate.
import { isValidHiveEnvKey, loadSharedHiveEnvKeys, saveSharedHiveEnvValue } from "@/features/dashboard/shared-hive-env-client";
import { parseFleetMachineAccessRequest } from "@/lib/types/fleet-machine-policy";

export function useKanbanNeedsHumanController(props: any) {
  const {
    chatSetupIssue,
    kanbanBoardSlug,
    kanbanStorageBody,
    refreshKanbanOnce,
    selectedKanbanAgent,
    selectedKanbanTask,
    setKanbanError,
    setKanbanNotice,
    steerSelectedKanbanTask,
  } = props;

  // Resolve a Needs-You card with the human's answer (a picked option, a typed
  // reply, or an "the key is saved" confirmation). When the conversation modal
  // has a live reachable agent for this exact task, the answer rides the steer
  // pipeline as an instant chat turn; otherwise the durable server path appends
  // the answer to the task body, moves the card back to Ready with the same
  // assignee, and schedules an immediate autonomous pickup by the agent that
  // asked. Fleet machine-access requests always take the durable path because
  // the collector must apply the human decision before that agent resumes.
  async function answerKanbanNeedsHuman(task: any, answer: string) {
    const text = String(answer ?? "").trim();
    if (!text || !task) return;
    const fleetAccessRequest = parseFleetMachineAccessRequest(task.result).requested;
    if (
      !fleetAccessRequest &&
      task.id === selectedKanbanTask?.id &&
      selectedKanbanAgent &&
      !chatSetupIssue(selectedKanbanAgent)
    ) {
      await steerSelectedKanbanTask(undefined, {
        prompt: `Human answer to your ACTION NEEDED request: ${text}`,
        targetStatus: "working",
      });
      return;
    }
    const response = await fetch(
      `/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...kanbanStorageBody(),
          action: "answer",
          taskId: task.id,
          answer: text,
          author: "dashboard",
        }),
      },
    ).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok || !data?.ok) {
      setKanbanError(data?.error ?? "Could not send the answer.");
      return;
    }
    setKanbanNotice?.(
      data.pickupScheduled
        ? `Answer sent — ${task.assignee?.trim() || "the agent"} is picking the task back up now.`
        : `Answer sent — the task is back in Waiting for Queen${task.assignee?.trim() ? ` for ${task.assignee.trim()}` : ""}.`,
    );
    await refreshKanbanOnce().catch((error) =>
      setKanbanError(
        error instanceof Error ? error.message : "Kanban refresh failed.",
      ),
    );
  }

  // Save an agent-requested API key straight into the shared hive env (via the
  // sanctioned hive-env-add route), then resume the task WITHOUT ever putting
  // the secret value into the task body, comments, or chat.
  async function saveKanbanNeedsHumanApiKey(task: any, envKey: string, value: string): Promise<string> {
    const key = String(envKey ?? "").trim();
    const failure = await saveSharedHiveEnvValue(key, value);
    if (failure) return failure;
    await answerKanbanNeedsHuman(
      task,
      `The requested env variable ${key} is now saved in the shared hive env (via hive-env-add). Load it from the shared env — the value is intentionally not included in this message. Continue the task.`,
    );
    return "";
  }

  async function loadKanbanNeedsHumanEnvKeys(): Promise<{ keys: string[]; error?: string }> {
    return loadSharedHiveEnvKeys();
  }

  async function selectKanbanNeedsHumanEnvKey(task: any, requestedEnvKey: string, selectedEnvKey: string): Promise<string> {
    const requested = String(requestedEnvKey ?? "").trim();
    const selected = String(selectedEnvKey ?? "").trim();
    if (!isValidHiveEnvKey(selected)) return "Choose a valid shared env name.";
    if (requested && !isValidHiveEnvKey(requested)) return "Use a valid requested env name.";
    await answerKanbanNeedsHuman(
      task,
      requested && requested !== selected
        ? `Use the existing shared hive env variable ${selected} for the requested ${requested}. The selected value is intentionally not included in this message. Continue the task.`
        : `The requested env variable ${selected} is already present in the shared hive env. Load it from the shared env — the value is intentionally not included in this message. Continue the task.`,
    );
    return "";
  }

  return {
    answerKanbanNeedsHuman,
    loadKanbanNeedsHumanEnvKeys,
    saveKanbanNeedsHumanApiKey,
    selectKanbanNeedsHumanEnvKey,
  };
}
