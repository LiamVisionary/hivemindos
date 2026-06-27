import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "@/lib/home-dir";
import {
  createTask,
  type KanbanStorageOptions,
} from "@/lib/services/kanban/local-kanban-store";
import type {
  KanbanPriority,
  KanbanStatus,
  KanbanTask,
} from "@/lib/types/kanban";

const WORK_EVENTS_DIR = join(homedir(), ".hivemindos", "work-events");
const WORK_EVENTS_FILE = join(WORK_EVENTS_DIR, "state.json");
const PRIORITIES: KanbanPriority[] = ["low", "normal", "high", "urgent"];
const STATUSES: KanbanStatus[] = [
  "ideas",
  "ready",
  "working",
  "needs-human",
  "done",
  "archived",
];

export type WorkEventFaqItem = {
  question: string;
  answer: string;
};

export type WorkEventDefinition = {
  name: string;
  payloadGuidelines?: string;
  createdAt: number;
  updatedAt: number;
};

export type WorkEventTrigger = {
  id: string;
  eventName: string;
  board?: string;
  title: string;
  body: string;
  assignee?: string;
  tenant?: string;
  priority: KanbanPriority;
  status: KanbanStatus;
  skills: string[];
  targetMachine?: KanbanTask["targetMachine"];
  emitEventName?: string;
  enabled: boolean;
  idempotencyKey?: string;
  createdAt: number;
  updatedAt: number;
};

export type WorkEventsState = {
  version: 1;
  events: WorkEventDefinition[];
  triggers: WorkEventTrigger[];
};

export type CreateWorkEventInput = {
  name: string;
  payloadGuidelines?: string;
};

export type CreateWorkEventTriggerInput = {
  eventName: string;
  board?: string;
  title: string;
  body?: string;
  assignee?: string;
  tenant?: string;
  priority?: KanbanPriority;
  status?: KanbanStatus;
  skills?: string[];
  targetMachine?: KanbanTask["targetMachine"];
  emitEventName?: string;
  enabled?: boolean;
  idempotencyKey?: string;
};

export type PublishWorkEventInput = {
  eventName: string;
  payload?: unknown;
  faq?: WorkEventFaqItem[];
  source?: string;
};

export async function readWorkEventsState(): Promise<WorkEventsState> {
  if (!existsSync(WORK_EVENTS_FILE)) return emptyState();
  const parsed = JSON.parse(await readFile(WORK_EVENTS_FILE, "utf-8"));
  return normalizeState(parsed);
}

export async function createWorkEvent(
  input: CreateWorkEventInput,
): Promise<{ event: WorkEventDefinition; state: WorkEventsState }> {
  const name = normalizeEventName(input.name);
  const state = await readWorkEventsState();
  const now = Date.now();
  const existing = state.events.find((event) => event.name === name);
  const event: WorkEventDefinition = existing
    ? {
        ...existing,
        payloadGuidelines:
          cleanOptional(input.payloadGuidelines) ?? existing.payloadGuidelines,
        updatedAt: now,
      }
    : {
        name,
        payloadGuidelines: cleanOptional(input.payloadGuidelines),
        createdAt: now,
        updatedAt: now,
      };
  state.events = existing
    ? state.events.map((item) => (item.name === name ? event : item))
    : [...state.events, event];
  await writeWorkEventsState(sortState(state));
  return { event, state: sortState(state) };
}

export async function createWorkEventTrigger(
  input: CreateWorkEventTriggerInput,
): Promise<{ trigger: WorkEventTrigger; event: WorkEventDefinition; state: WorkEventsState }> {
  const eventResult = await createWorkEvent({ name: input.eventName });
  const title = cleanOptional(input.title);
  if (!title) throw new Error("Trigger title is required.");
  const now = Date.now();
  const trigger: WorkEventTrigger = {
    id: `wet_${randomUUID()}`,
    eventName: eventResult.event.name,
    board: cleanOptional(input.board),
    title,
    body:
      cleanOptional(input.body) ??
      [
        "Handle HivemindOS work event {{EVENT_NAME}}.",
        "",
        "{{EVENT_PAYLOAD}}",
        "",
        "{{EVENT_FAQ}}",
      ].join("\n"),
    assignee: cleanOptional(input.assignee),
    tenant: cleanOptional(input.tenant),
    priority: PRIORITIES.includes(input.priority as KanbanPriority)
      ? (input.priority as KanbanPriority)
      : "normal",
    status: STATUSES.includes(input.status as KanbanStatus)
      ? (input.status as KanbanStatus)
      : "ready",
    skills: Array.isArray(input.skills)
      ? input.skills.filter((skill) => typeof skill === "string" && skill.trim())
      : [],
    targetMachine: input.targetMachine?.key ? input.targetMachine : undefined,
    emitEventName: cleanOptional(input.emitEventName)
      ? normalizeEventName(input.emitEventName)
      : undefined,
    enabled: input.enabled !== false,
    idempotencyKey: cleanOptional(input.idempotencyKey),
    createdAt: now,
    updatedAt: now,
  };
  const state = {
    ...eventResult.state,
    triggers: [...eventResult.state.triggers, trigger],
  };
  await writeWorkEventsState(sortState(state));
  return { trigger, event: eventResult.event, state: sortState(state) };
}

export async function publishWorkEvent(
  input: PublishWorkEventInput,
  options: KanbanStorageOptions = {},
) {
  const eventName = normalizeEventName(input.eventName);
  const state = await readWorkEventsState();
  const triggers = state.triggers.filter(
    (trigger) => trigger.enabled && trigger.eventName === eventName,
  );
  const context = {
    eventName,
    eventPayload: formatPayload(input.payload),
    eventFaq: formatFaq(input.faq),
    eventSource: cleanOptional(input.source) ?? "work_event",
  };
  const createdTasks = [];
  for (const trigger of triggers) {
    const body = withCompletionEventInstruction(
      renderTemplate(trigger.body, context),
      trigger.emitEventName,
    );
    const result = await createTask(
      trigger.board ?? null,
      {
        title: renderTemplate(trigger.title, context),
        body,
        assignee: trigger.assignee,
        tenant: trigger.tenant,
        priority: trigger.priority,
        status: trigger.status,
        skills: trigger.skills,
        targetMachine: trigger.targetMachine ?? undefined,
        idempotencyKey: trigger.idempotencyKey
          ? renderTemplate(trigger.idempotencyKey, context)
          : undefined,
        source: `work-event:${eventName}`,
      },
      options,
    );
    createdTasks.push({
      triggerId: trigger.id,
      board: result.board.meta.slug,
      task: result.task,
      created: result.created,
    });
  }
  return {
    eventName,
    matchedTriggers: triggers.length,
    tasks: createdTasks,
  };
}

function emptyState(): WorkEventsState {
  return { version: 1, events: [], triggers: [] };
}

function normalizeState(value: unknown): WorkEventsState {
  const parsed = value && typeof value === "object" ? (value as WorkEventsState) : emptyState();
  return sortState({
    version: 1,
    events: Array.isArray(parsed.events)
      ? parsed.events.map(normalizeEvent).filter(isWorkEventDefinition)
      : [],
    triggers: Array.isArray(parsed.triggers)
      ? parsed.triggers.map(normalizeTrigger).filter(isWorkEventTrigger)
      : [],
  });
}

function normalizeEvent(value: unknown): WorkEventDefinition | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Partial<WorkEventDefinition>;
  try {
    const name = normalizeEventName(event.name);
    const now = Date.now();
    return {
      name,
      payloadGuidelines: cleanOptional(event.payloadGuidelines),
      createdAt: positiveNumber(event.createdAt) ?? now,
      updatedAt: positiveNumber(event.updatedAt) ?? now,
    };
  } catch {
    return null;
  }
}

function normalizeTrigger(value: unknown): WorkEventTrigger | null {
  if (!value || typeof value !== "object") return null;
  const trigger = value as Partial<WorkEventTrigger>;
  try {
    const title = cleanOptional(trigger.title);
    if (!title) return null;
    const now = Date.now();
    return {
      id: cleanOptional(trigger.id) ?? `wet_${randomUUID()}`,
      eventName: normalizeEventName(trigger.eventName),
      board: cleanOptional(trigger.board),
      title,
      body: cleanOptional(trigger.body) ?? "{{EVENT_PAYLOAD}}",
      assignee: cleanOptional(trigger.assignee),
      tenant: cleanOptional(trigger.tenant),
      priority: PRIORITIES.includes(trigger.priority as KanbanPriority)
        ? (trigger.priority as KanbanPriority)
        : "normal",
      status: STATUSES.includes(trigger.status as KanbanStatus)
        ? (trigger.status as KanbanStatus)
        : "ready",
      skills: Array.isArray(trigger.skills)
        ? trigger.skills.filter((skill) => typeof skill === "string" && skill.trim())
        : [],
      targetMachine: trigger.targetMachine?.key ? trigger.targetMachine : undefined,
      emitEventName: cleanOptional(trigger.emitEventName)
        ? normalizeEventName(trigger.emitEventName)
        : undefined,
      enabled: trigger.enabled !== false,
      idempotencyKey: cleanOptional(trigger.idempotencyKey),
      createdAt: positiveNumber(trigger.createdAt) ?? now,
      updatedAt: positiveNumber(trigger.updatedAt) ?? now,
    };
  } catch {
    return null;
  }
}

function isWorkEventDefinition(
  value: WorkEventDefinition | null,
): value is WorkEventDefinition {
  return Boolean(value);
}

function isWorkEventTrigger(
  value: WorkEventTrigger | null,
): value is WorkEventTrigger {
  return Boolean(value);
}

function sortState(state: WorkEventsState): WorkEventsState {
  return {
    version: 1,
    events: [...state.events].sort((a, b) => a.name.localeCompare(b.name)),
    triggers: [...state.triggers].sort((a, b) => b.createdAt - a.createdAt),
  };
}

async function writeWorkEventsState(state: WorkEventsState) {
  await mkdir(WORK_EVENTS_DIR, { recursive: true, mode: 0o700 });
  const temp = join(WORK_EVENTS_DIR, `state.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, `${JSON.stringify(sortState(state), null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temp, WORK_EVENTS_FILE);
}

function normalizeEventName(value: unknown) {
  const name = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(name)) {
    throw new Error(
      "Event name must start with a letter or number and contain only letters, numbers, hyphens, or underscores.",
    );
  }
  return name;
}

function renderTemplate(template: string, context: {
  eventName: string;
  eventPayload: string;
  eventFaq: string;
  eventSource: string;
}) {
  return template
    .replaceAll("{{EVENT_NAME}}", context.eventName)
    .replaceAll("{{EVENT_PAYLOAD}}", context.eventPayload)
    .replaceAll("{{EVENT_FAQ}}", context.eventFaq)
    .replaceAll("{{EVENT_SOURCE}}", context.eventSource);
}

function withCompletionEventInstruction(body: string, emitEventName?: string) {
  if (!emitEventName) return body;
  return [
    body,
    "",
    `On successful completion, publish HivemindOS work event \`${emitEventName}\` with a concise payload describing the result.`,
  ].join("\n");
}

function formatPayload(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function formatFaq(items?: WorkEventFaqItem[]) {
  if (!Array.isArray(items) || !items.length) return "";
  return items
    .filter((item) => item?.question?.trim() && item?.answer?.trim())
    .map((item) => `Q: ${item.question.trim()}\nA: ${item.answer.trim()}`)
    .join("\n\n");
}

function cleanOptional(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
