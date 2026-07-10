"use client";

import {
  getMiroSharkProcessSummary,
  MiroSharkProcessCard,
} from "@/features/dashboard/views/chat/MiroSharkSimulationCard";
import { isHiddenChatProcessEvent } from "@/features/dashboard/views/chat/chat-panel-helpers";
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
    return !isHiddenChatProcessEvent(event);
  });
}

export function processEventsAreActive(events: ProcessEvent[] = []) {
  const visibleEvents = processDisplayEvents(events);
  if (!visibleEvents.length) return false;
  const lastEvent = visibleEvents[visibleEvents.length - 1];
  const lastStatus = String(lastEvent?.status ?? "").trim().toLowerCase();
  const lastText = `${String(lastEvent?.label ?? "").trim()} ${String(lastEvent?.detail ?? "").trim()}`.toLowerCase();
  if (/\b(done|complete|completed|failed|failure|finished|settled|succeeded|cancelled|canceled|error)\b/.test(lastText)) return false;
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

function ProcessMeta({ text, tone = "default" }: { text: string; tone?: string }) {
  // Reuse the fr-process tone concept: success-ish -> live, error -> danger, else muted.
  const color = tone === "danger" ? "var(--danger)" : tone === "live" || tone === "complete" ? "var(--live)" : "var(--fg-4)";
  // Preserve the existing +added −removed diff split (add is live, remove is danger).
  const diff = /([+]\d+)\s+([−-]\d+)/.exec(text);
  return (
    <span style={{ fontFamily: "var(--f-body)", fontSize: 10.5, textAlign: "right", color, whiteSpace: "nowrap" }}>
      {diff ? (
        <>
          <span style={{ color: "var(--live)" }}>{diff[1]}</span>{" "}
          <span style={{ color: "var(--danger)" }}>{diff[2]}</span>
        </>
      ) : text}
    </span>
  );
}

function processTimeLabel(value: unknown) {
  const timestamp = typeof value === "number" ? value : Date.now();
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function AgentProcessPanel(props: { active?: boolean; events?: ProcessEvent[]; agentName?: string }) {
  const { active = false, events = [], agentName } = props;
  const visibleEvents = processDisplayEvents(events);
  const latestActive = active && processEventsAreActive(visibleEvents);
  const mirosharkProcess = getMiroSharkProcessSummary(visibleEvents, latestActive);

  if (!visibleEvents.length) return null;

  const many = visibleEvents.length > 1;
  const stepCount = visibleEvents.length;
  const workerName = mirosharkProcess ? "MiroShark" : agentName?.trim() || "Agent";

  return (
    <section
      aria-label="Agent process"
      data-active={latestActive ? "true" : undefined}
      style={{
        display: "grid",
        gap: 14,
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--bg-soft)",
        padding: "15px 18px",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="var(--honey)" aria-hidden="true">
          <path d={ICON.sparkles} />
        </svg>
        <span style={{ flex: 1, fontFamily: "var(--f-body)", fontSize: 12, fontWeight: 500, color: "var(--fg-3)" }}>
          {workerName} worked · {stepCount} step{stepCount === 1 ? "" : "s"}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-body)", fontSize: 12, color: "var(--live)" }}>
          <span
            className={latestActive ? "cx-dot-live" : undefined}
            style={{ width: 6, height: 6, borderRadius: 99, background: "currentColor" }}
            aria-hidden="true"
          />
          {latestActive ? "working" : "done"}
        </span>
      </header>
      {mirosharkProcess ? (
        <div className="fr-process-miroshark">
          <MiroSharkProcessCard summary={mirosharkProcess} />
        </div>
      ) : null}
      <div
        className={many ? "cx-scroll" : undefined}
        style={{
          position: "relative",
          display: "grid",
          gap: 16,
          ...(many ? { maxHeight: "min(372px, 44vh)", overflowY: "auto", overscrollBehavior: "contain" } : null),
        }}
      >
        <span
          className="cx-tl-line"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 12,
            top: 12,
            bottom: 12,
            width: 1.5,
            background: "linear-gradient(180deg,var(--honey-line),var(--line-2))",
          }}
        />
        {visibleEvents.map((event, index) => {
          const toolKey = processToolKey(event);
          const meta = PROCESS_TOOL_META[toolKey] ?? PROCESS_TOOL_META.unknown;
          const isActive = index === visibleEvents.length - 1 && latestActive;
          const tone = processTone(event, isActive);
          const fileTarget = processFileTarget(event);
          const statusLabel = processStatusLabel(event);
          const { primary, result } = splitProcessDetail(event);
          const detailText = primary || fileTarget;
          const metaText = result || statusLabel;
          return (
            <div
              className="cx-tl-step"
              key={`${event.at ?? "event"}-${index}`}
              title={processTimeLabel(event.at)}
              style={{ display: "grid", gridTemplateColumns: "25px minmax(0,1fr) auto", alignItems: "center", gap: 13 }}
            >
              <span
                aria-hidden="true"
                style={{ display: "grid", placeItems: "center", width: 25, height: 25, borderRadius: 8, background: "var(--bg-soft)", color: "var(--honey)", zIndex: 1 }}
              >
                <Glyph d={processGlyph(meta.icon)} s={15} sw={1.7} />
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", minWidth: 0 }}>
                <span style={{ fontFamily: "var(--f-body)", fontSize: 14, color: "var(--fg-2)" }}>{processDisplayLabel(event)}</span>
                {detailText ? (
                  <code
                    style={{ minWidth: 0, borderRadius: 7, background: "var(--panel-2)", color: "var(--honey-2)", padding: "2px 8px", fontFamily: "var(--f-body)", fontSize: 11.5, overflowWrap: "anywhere" }}
                  >
                    {detailText}
                  </code>
                ) : null}
              </span>
              {metaText ? <ProcessMeta text={metaText} tone={tone} /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
