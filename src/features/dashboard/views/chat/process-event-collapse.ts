// Pure process-event transforms for the chat "Agent worked" timeline. No
// React, no CSS — kept out of AgentProcessPanel so the hermetic suites can
// import them directly under Node.

import { mergeChatProcessEvents } from "../../../../lib/services/chat/chat-process-events";

export type ProcessEvent = {
  at?: number;
  label?: string;
  detail?: string;
  status?: string;
  runId?: string;
};

export function normalizeProcessEvents(value: unknown): ProcessEvent[] {
  // External boundary: process events arrive as untyped JSON from runtime/session payloads.
  const source = value as ProcessEvent[] | { events?: ProcessEvent[]; steps?: ProcessEvent[] } | null | undefined;
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.events)) return source.events;
  if (Array.isArray(source?.steps)) return source.steps;
  return [];
}

export function mergeProcessEvents(first: ProcessEvent[] = [], second: ProcessEvent[] = []) {
  return mergeChatProcessEvents(first, second);
}

// Runtime tool lifecycles stream as separate "Starting X" / "X running" /
// "X finished" events. One command is one step: fold the lifecycle into a
// single row whose status advances in place, with a human label instead of the
// raw tool id.
const TOOL_LIFECYCLE_LABELS: Record<string, { running: string; completed: string; failed: string }> = {
  terminal: { running: "Running a command", completed: "Ran a command", failed: "Command failed" },
  write_file: { running: "Writing a file", completed: "Wrote a file", failed: "File write failed" },
  read_file: { running: "Reading a file", completed: "Read a file", failed: "File read failed" },
  edit_file: { running: "Editing a file", completed: "Edited a file", failed: "File edit failed" },
};

function toolLifecycleLabel(tool: string, phase: "running" | "completed" | "failed") {
  const known = TOOL_LIFECYCLE_LABELS[tool.toLowerCase()];
  if (known) return known[phase];
  if (phase === "running") return `Running ${tool}`;
  return phase === "failed" ? `${tool} failed` : `Ran ${tool}`;
}

function toolLifecyclePhase(event: ProcessEvent): { tool: string; phase: "start" | "running" | "finish" } | null {
  const label = String(event?.label ?? "").trim();
  const starting = label.match(/^Starting (\S+)$/);
  if (starting) return { tool: starting[1], phase: "start" };
  const running = label.match(/^(\S+) running$/);
  if (running) return { tool: running[1], phase: "running" };
  const finished = label.match(/^(\S+) finished$/);
  if (finished) return { tool: finished[1], phase: "finish" };
  return null;
}

function toolLifecycleDetail(tool: string, detail: unknown) {
  const text = String(detail ?? "").trim();
  // The runtime often echoes the tool id as the detail — that chip says nothing.
  return text && text.toLowerCase() !== tool.toLowerCase() ? text : "";
}

export function collapseProcessEvents(events: ProcessEvent[] = []) {
  const output: ProcessEvent[] = [];
  const openByTool = new Map<string, number>();
  const narrationIndexByText = new Map<string, number>();
  for (const event of events) {
    const lifecycle = toolLifecyclePhase(event);
    if (!lifecycle) {
      // The same narration often arrives twice — streamed live, then echoed by
      // the session log with a completion status. Identical text is the same
      // step: upgrade the existing row instead of appending a twin.
      const text = `${String(event.label ?? "").trim()}\n${String(event.detail ?? "").trim()}`;
      const meaningful = text.trim().length > 0;
      const existingIndex = meaningful ? narrationIndexByText.get(text) : undefined;
      if (existingIndex !== undefined) {
        const existing = output[existingIndex];
        output[existingIndex] = {
          ...existing,
          at: event.at ?? existing.at,
          status: event.status ?? existing.status,
        };
        continue;
      }
      if (meaningful) narrationIndexByText.set(text, output.length);
      output.push(event);
      continue;
    }
    const { tool, phase } = lifecycle;
    const detail = toolLifecycleDetail(tool, event.detail);
    const openIndex = openByTool.get(tool);
    const open = openIndex !== undefined ? output[openIndex] : undefined;
    if (phase === "finish") {
      const failed = String(event.status ?? "").toLowerCase() === "failed";
      const finished: ProcessEvent = {
        ...(open ?? {}),
        at: event.at ?? open?.at,
        label: toolLifecycleLabel(tool, failed ? "failed" : "completed"),
        detail: detail || toolLifecycleDetail(tool, open?.detail) || undefined,
        status: failed ? "failed" : "completed",
        runId: event.runId ?? open?.runId,
      };
      if (openIndex !== undefined) {
        output[openIndex] = finished;
        openByTool.delete(tool);
      } else {
        output.push(finished);
      }
      continue;
    }
    const runningRow: ProcessEvent = {
      at: event.at ?? open?.at,
      label: toolLifecycleLabel(tool, "running"),
      detail: detail || toolLifecycleDetail(tool, open?.detail) || undefined,
      status: "running",
      runId: event.runId ?? open?.runId,
    };
    if (openIndex !== undefined) {
      output[openIndex] = runningRow;
    } else {
      openByTool.set(tool, output.length);
      output.push(runningRow);
    }
  }
  return output;
}
