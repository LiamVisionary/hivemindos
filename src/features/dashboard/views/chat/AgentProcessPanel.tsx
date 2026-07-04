"use client";

import {
  getMiroSharkProcessSummary,
  MiroSharkProcessCard,
} from "@/features/dashboard/views/chat/MiroSharkSimulationCard";
import { Glyph, ICON } from "@/features/dashboard/views/chat/exchange/primitives";

export type ProcessEvent = {
  at?: number;
  label?: string;
  detail?: string;
  status?: string;
  runId?: string;
};

const PROCESS_TOOL_META: Record<string, { icon: string }> = {
  bash: { icon: "terminal" },
  command: { icon: "terminal" },
  read: { icon: "file" },
  file: { icon: "file" },
  image: { icon: "image" },
  edit: { icon: "edit" },
  write: { icon: "edit" },
  search: { icon: "search" },
  skill: { icon: "sparkles" },
  git: { icon: "git" },
  status: { icon: "activity" },
  error: { icon: "alert" },
  unknown: { icon: "hammer" },
};

const TOOL_GLYPH: Record<string, string | readonly string[]> = {
  activity: ["M4 12h3l2-6 4 12 2-6h5"],
  alert: ["M12 9v4", "M12 17h.01", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"],
  edit: ["M4 20l4.5-1L19 8.5 15.5 5 5 15.5z", "M14 6.5l3.5 3.5"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v4h4", "M9 12h6", "M9 15.5h4"],
  flow: ["M8.5 6h11.5", "M8.5 12h11.5", "M8.5 18h8.5", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
  git: ["M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6", "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M12 6h6"],
  hammer: ["M14.5 5.5 18 2l4 4-3.5 3.5", "M2 22l7.5-7.5", "M8.5 15.5l6-6"],
  image: ["M3 5h18v14H3z", "M3 16l5-5 4 4 3-3 6 6", "M8.5 9.5a1.2 1.2 0 1 0 0-.001"],
  search: ["M11 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", "M20 20l-4-4"],
  sparkles: ICON.sparkles,
  terminal: ["M4 5h16v14H4z", "M7.5 9.5l3 2.5-3 2.5", "M13 15h4"],
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
  const output: ProcessEvent[] = [];
  const indexByKey = new Map<string, number>();
  for (const event of [...first, ...second]) {
    if (!event) continue;
    const key = [event.runId ?? "", event.label ?? "", event.detail ?? "", event.status ?? ""].join("\u001f");
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, output.length);
      output.push(event);
    } else if (Number(event.at ?? 0) >= Number(output[existingIndex]?.at ?? 0)) {
      output[existingIndex] = event;
    }
  }
  return output.sort((left, right) => Number(left.at ?? 0) - Number(right.at ?? 0)).slice(-80);
}

function processDisplayEvents(events: ProcessEvent[] = []) {
  return events.filter((event) => {
    const label = String(event?.label ?? "").trim();
    const detail = String(event?.detail ?? "").trim();
    if (/assistant started writing|assistant wrote in session|agent replied|queued chat request/i.test(label)) return false;
    if (/^Attached .+ session$/i.test(label)) return false;
    if (/^Runtime event$/i.test(label) || /^Runtime event$/i.test(detail)) return false;
    return true;
  });
}

export function processEventsAreActive(events: ProcessEvent[] = []) {
  const visibleEvents = processDisplayEvents(events);
  if (!visibleEvents.length) return false;
  const lastEvent = visibleEvents[visibleEvents.length - 1];
  const lastStatus = String(lastEvent?.status ?? "").trim().toLowerCase();
  const lastText = `${String(lastEvent?.label ?? "").trim()} ${String(lastEvent?.detail ?? "").trim()}`.toLowerCase();
  if (/\b(done|complete|completed|failed|failure|finished|settled|succeeded|cancelled|canceled)\b/.test(lastText)) return false;
  return lastStatus !== "completed" && lastStatus !== "failed";
}

function processToolKey(event: ProcessEvent) {
  const text = `${event?.label ?? ""} ${event?.detail ?? ""}`.toLowerCase();
  if (/error|failed|interrupted|timed out/.test(text)) return "error";
  if (/git|commit|branch|origin\//.test(text)) return "git";
  if (/image|screenshot|vision/.test(text)) return "image";
  if (/skill context|skill loaded/.test(text)) return "skill";
  if (/file content|read file|cat\b|view file/.test(text)) return "read";
  if (/edit|write|patch|created|updated/.test(text)) return "edit";
  if (/grep|search|rg\b|find/.test(text)) return "search";
  if (/command|bash|shell|terminal|exit\s+\d+/.test(text)) return "bash";
  if (/tool/.test(text)) return "unknown";
  return "status";
}

function processGlyph(key: string) {
  return TOOL_GLYPH[key] ?? TOOL_GLYPH.activity;
}

function processFileTarget(event: ProcessEvent) {
  const detail = String(event?.detail ?? "");
  const label = String(event?.label ?? "");
  const haystack = `${label}\n${detail}`;
  const structured = detail.match(/"?(?:path|file|filename|target)"?\s*[:=]\s*"?([^"',}\]\s]+)"?/i)?.[1];
  const gitStatus = haystack.match(/(?:^|\s)[AMDRC?]{1,2}\s+([^\s]+\.[A-Za-z0-9]{1,8}|[^\s]+\/[^\s]+)/m)?.[1];
  const mentioned = haystack.match(/(?:^|\s)([~./A-Za-z0-9_-]+\/[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*\.[A-Za-z0-9]{1,8})\b/)?.[1]
    ?? haystack.match(/`([^`]+\.[A-Za-z0-9]{1,8})`/)?.[1];
  const target = structured ?? gitStatus ?? mentioned ?? "";
  return target ? target.split(/[)\],]/)[0].replace(/^["'`]+|["'`]+$/g, "") : "";
}

function processDisplayLabel(event: ProcessEvent) {
  const label = String(event?.label ?? "Runtime event").trim();
  if (/tool output/i.test(label)) return "Tool output";
  return label;
}

function processStatusLabel(event: ProcessEvent) {
  const status = String(event?.status ?? "").trim();
  if (!status) return "";
  return status.replace(/[-_]+/g, " ");
}

function processTone(event: ProcessEvent, active: boolean) {
  const text = `${event?.label ?? ""} ${event?.detail ?? ""} ${event?.status ?? ""}`.toLowerCase();
  if (/\b(error|failed|failure|interrupted|timed out|cancelled|canceled)\b/.test(text)) return "danger";
  if (active) return "live";
  if (/\b(done|complete|completed|succeeded|success|finished|settled)\b/.test(text)) return "complete";
  return "default";
}

function splitProcessDetail(event: ProcessEvent) {
  const detail = String(event?.detail ?? "").trim();
  if (!detail) return { primary: "", result: "" };
  const parts = detail.split(" · ");
  if (parts.length > 1) return { primary: parts[0], result: parts.slice(1).join(" · ") };
  return { primary: detail, result: "" };
}

function ResultChip({ text, tone = "default" }: { text: string; tone?: string }) {
  const diff = /([+]\d+)\s+([−-]\d+)/.exec(text);
  return (
    <span className="fr-process-result" data-tone={tone}>
      {diff ? (
        <>
          <span data-diff="add">{diff[1]}</span>
          <span data-diff="remove">{diff[2]}</span>
        </>
      ) : text}
    </span>
  );
}

function processTimeLabel(value: unknown) {
  const timestamp = typeof value === "number" ? value : Date.now();
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function AgentProcessPanel(props: { active?: boolean; events?: ProcessEvent[] }) {
  const { active = false, events = [] } = props;
  const visibleEvents = processDisplayEvents(events);
  const latestActive = active && processEventsAreActive(visibleEvents);
  const mirosharkProcess = getMiroSharkProcessSummary(visibleEvents, latestActive);

  if (!visibleEvents.length) return null;

  const many = visibleEvents.length > 1;

  return (
    <section className="fr-process-card" data-active={latestActive ? "true" : undefined} aria-label="Agent process">
      <header className="fr-process-header">
        <Glyph d={TOOL_GLYPH.flow} s={12} sw={1.7} />
        <span>{mirosharkProcess ? "MiroShark" : "Process"}</span>
        <span aria-hidden="true">·</span>
        <span>{visibleEvents.length} step{visibleEvents.length === 1 ? "" : "s"}</span>
        {latestActive ? (
          <span className="fr-process-live">
            <span className="fr-dot live" aria-hidden="true" />
            running
          </span>
        ) : null}
      </header>
      {mirosharkProcess ? (
        <div className="fr-process-miroshark">
          <MiroSharkProcessCard summary={mirosharkProcess} />
        </div>
      ) : null}
      <div className="fr-process-list fr-scroll" data-many={many ? "true" : undefined}>
        {visibleEvents.map((event, index) => {
          const toolKey = processToolKey(event);
          const meta = PROCESS_TOOL_META[toolKey] ?? PROCESS_TOOL_META.unknown;
          const isActive = index === visibleEvents.length - 1 && latestActive;
          const tone = processTone(event, isActive);
          const fileTarget = processFileTarget(event);
          const statusLabel = processStatusLabel(event);
          const { primary, result } = splitProcessDetail(event);
          return (
            <div className="fr-process-step" data-active={isActive ? "true" : undefined} key={`${event.at ?? "event"}-${index}`}>
              <span className="fr-process-icon" data-rail={many ? "true" : undefined} data-tone={tone} aria-hidden="true">
                <Glyph d={processGlyph(meta.icon)} s={12.5} sw={1.7} />
              </span>
              <span className="fr-process-step-main">
                <span className="fr-process-step-line">
                  <strong>{processDisplayLabel(event)}</strong>
                  {fileTarget ? <code>{fileTarget}</code> : null}
                  {statusLabel ? <ResultChip text={statusLabel} tone={tone} /> : null}
                  {result ? <ResultChip text={result} /> : null}
                </span>
                {primary ? <span className="fr-process-step-detail">{primary}</span> : null}
              </span>
              <span className="fr-process-step-meta" data-tone={tone}>
                <Glyph d={tone === "danger" ? ICON.close : ICON.check} s={11.5} sw={2.2} />
                <time>{processTimeLabel(event.at)}</time>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
