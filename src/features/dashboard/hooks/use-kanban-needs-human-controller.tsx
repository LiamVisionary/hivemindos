// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

// Resolving Needs-You cards from the Work Board UI: one-click decision
// answers, typed replies, and agent-requested API keys. Split from the
// dispatch controller so each stays under the file-size gate.
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
  // asked.
  async function answerKanbanNeedsHuman(task: any, answer: string) {
    const text = String(answer ?? "").trim();
    if (!text || !task) return;
    if (
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
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return "Use a valid env name like OPENAI_API_KEY.";
    if (!String(value ?? "").trim()) return "Paste the key value first.";
    const response = await fetch("/api/env", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: "shared", key, value }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok || data?.ok === false) {
      return data?.error ?? "Could not save the key to the shared hive env.";
    }
    await answerKanbanNeedsHuman(
      task,
      `The requested credential ${key} is now saved in the shared hive env (via hive-env-add). Load it from the shared env — the value is intentionally not included in this message. Continue the task.`,
    );
    return "";
  }

  return { answerKanbanNeedsHuman, saveKanbanNeedsHumanApiKey };
}
