import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { KanbanTask } from "@/lib/types/kanban";

type RequestKanbanWorkReceiptInput = {
  agent: AgentProfile;
  appDir?: string | null;
  boardSlug: string;
  logClientTelemetry: (event: string, data?: Record<string, unknown>) => void;
  task: KanbanTask;
};

// Fire-and-forget: a missing receipt never blocks task completion, it only
// leaves the task without a verified collector-signed proof.
export function requestKanbanWorkReceipt({
  agent,
  appDir,
  boardSlug,
  logClientTelemetry,
  task,
}: RequestKanbanWorkReceiptInput) {
  void fetch("/api/work-receipts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      collectorUrl: agent.telemetryUrl,
      agentId: agent.agentId || agent.id,
      agentName: agent.name,
      taskId: task.id,
      taskTitle: task.title,
      board: boardSlug,
      repoPath: appDir,
    }),
  })
    .then(async (response) => {
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      logClientTelemetry("kanban.work_receipt", {
        taskId: task.id,
        agentId: agent.id,
        ok: Boolean(data?.ok),
        error: data?.ok ? undefined : data?.error,
      });
    })
    .catch(() => undefined);
}
