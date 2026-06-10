// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { createStyleClass } from "@/features/dashboard/style-classes";
import hiveChatStyles from "@/features/dashboard/views/chat/HiveChatView.module.css";
import {
  getMiroSharkProcessSummary,
  MiroSharkProcessCard,
} from "@/features/dashboard/views/chat/MiroSharkSimulationCard";
import { Image as ProcessImageIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const hiveClass = createStyleClass(hiveChatStyles);

const PROCESS_TOOL_META: Record<string, { icon: string; color: string }> = {
  bash: { icon: "terminal", color: "#a78bfa" },
  command: { icon: "terminal", color: "#a78bfa" },
  read: { icon: "file", color: "#94a3b8" },
  file: { icon: "file", color: "#94a3b8" },
  image: { icon: "image", color: "#38bdf8" },
  edit: { icon: "edit", color: "#60a5fa" },
  write: { icon: "edit", color: "#60a5fa" },
  search: { icon: "search", color: "#fb923c" },
  skill: { icon: "sparkles", color: "#2dd4bf" },
  git: { icon: "git", color: "#f59e0b" },
  status: { icon: "activity", color: "#2dd4bf" },
  error: { icon: "alert", color: "#fb7185" },
  unknown: { icon: "hammer", color: "#94a3b8" },
};

export function normalizeProcessEvents(value: any) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.events)) return value.events;
  if (Array.isArray(value?.steps)) return value.steps;
  return [];
}

export function mergeProcessEvents(first: any[] = [], second: any[] = []) {
  const output: any[] = [];
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

function processDisplayEvents(events: any[] = []) {
  return events.filter((event) => {
    const label = String(event?.label ?? "").trim();
    const detail = String(event?.detail ?? "").trim();
    if (/assistant started writing|assistant wrote in session|agent replied|queued chat request/i.test(label)) return false;
    if (/^Runtime event$/i.test(label) || /^Runtime event$/i.test(detail)) return false;
    return true;
  });
}

export function processEventsAreActive(events: any[] = []) {
  const visibleEvents = processDisplayEvents(events);
  if (!visibleEvents.length) return false;
  const lastEvent = visibleEvents[visibleEvents.length - 1];
  const lastStatus = String(lastEvent?.status ?? "").trim().toLowerCase();
  const lastText = `${String(lastEvent?.label ?? "").trim()} ${String(lastEvent?.detail ?? "").trim()}`.toLowerCase();
  if (/\b(done|complete|completed|failed|failure|finished|settled|succeeded|cancelled|canceled)\b/.test(lastText)) return false;
  return lastStatus !== "completed" && lastStatus !== "failed";
}

function processToolKey(event: any) {
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

function processIconComponent(key: string, icons: any) {
  const map: Record<string, any> = {
    activity: icons.Activity,
    alert: icons.CircleAlert,
    edit: icons.Pencil,
    file: icons.FileText,
    git: icons.GitBranch,
    hammer: icons.Hammer,
    image: icons.Image,
    search: icons.Search,
    sparkles: icons.Sparkles,
    terminal: icons.Terminal,
  };
  return map[key] ?? icons.Activity;
}

function processFileTarget(event: any) {
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

function processDisplayLabel(event: any) {
  const label = String(event?.label ?? "Runtime event").trim();
  if (/tool output/i.test(label)) return "Tool output";
  return label;
}

function processTimeLabel(value: unknown) {
  const timestamp = typeof value === "number" ? value : Date.now();
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function AgentProcessPanel(props: any) {
  const {
    Activity,
    ChevronDown,
    ChevronUp,
    CircleAlert,
    FileText,
    GitBranch,
    Hammer,
    Pencil,
    Search,
    Sparkles,
    Terminal,
    active = false,
    events = [],
  } = props;
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const visibleEvents = processDisplayEvents(events);
  const latestActive = active && processEventsAreActive(visibleEvents);
  const mirosharkProcess = getMiroSharkProcessSummary(visibleEvents, latestActive);
  const open = latestActive || expanded;
  const latestEvent = visibleEvents[visibleEvents.length - 1];
  const latestEventSignature = [
    visibleEvents.length,
    latestEvent?.at ?? "",
    latestEvent?.label ?? "",
    latestEvent?.detail ?? "",
    latestEvent?.status ?? "",
  ].join("|");

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [open, latestEventSignature]);

  if (!visibleEvents.length) return null;

  const ToggleIcon = open ? ChevronUp : ChevronDown;
  const iconProps = { Activity, CircleAlert, FileText, GitBranch, Hammer, Image: ProcessImageIcon, Pencil, Search, Sparkles, Terminal };

  return (
    <section className={hiveClass("hiveProcessPanel", open && "expanded")} aria-label="Agent process">
      <button
        type="button"
        className={hiveClass("hiveProcessToggle")}
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={open}
      >
        <span>{mirosharkProcess ? "MiroShark" : "Process"}</span>
        <small>{visibleEvents.length} event{visibleEvents.length === 1 ? "" : "s"}</small>
        {ToggleIcon ? <ToggleIcon aria-hidden="true" /> : null}
      </button>
      {open ? (
        <>
          {mirosharkProcess ? <MiroSharkProcessCard summary={mirosharkProcess} /> : null}
          <div className={hiveClass("hiveProcessScroll")} ref={scrollRef}>
            {visibleEvents.map((event: any, index: number) => {
              const toolKey = processToolKey(event);
              const meta = PROCESS_TOOL_META[toolKey] ?? PROCESS_TOOL_META.unknown;
              const BadgeIcon = processIconComponent(meta.icon, iconProps);
              const isActive = index === visibleEvents.length - 1 && latestActive;
              const fileTarget = processFileTarget(event);
              return (
                <div className={hiveClass("hiveProcessRow", isActive && "active")} key={`${event.at ?? "event"}-${index}`}>
                  <time>{processTimeLabel(event.at)}</time>
                  <div className={hiveClass("hiveProcessBadge", isActive && "active")} style={{ "--process-accent": meta.color } as any} aria-hidden="true">
                    {BadgeIcon ? <BadgeIcon /> : null}
                  </div>
                  <div className={hiveClass("hiveProcessBody")}>
                    <div className={hiveClass("hiveProcessMetaLine")}>
                      <strong>{processDisplayLabel(event)}</strong>
                      {fileTarget ? <code>{fileTarget}</code> : null}
                    </div>
                    {event.detail ? <span>{event.detail}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}
