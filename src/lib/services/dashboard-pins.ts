import "server-only";

import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, isAbsolute, join } from "path";
import { homedir } from "@/lib/home-dir";
import {
  DASHBOARD_PIN_STATUSES,
  type DashboardPin,
  type DashboardPinBoundingBox,
  type DashboardPinCreateInput,
  type DashboardPinsFile,
  type DashboardPinStatus,
} from "@/lib/types/dashboard-pins";
import {
  createTask,
  type KanbanStorageOptions,
} from "@/lib/services/kanban/local-kanban-store";

const DASHBOARD_PINS_FILE = join(homedir(), ".hivemindos", "dashboard-pins.json");
const MAX_ROUTE_LENGTH = 512;
const MAX_COMMENT_LENGTH = 4_000;
const MAX_HINT_LENGTH = 500;
const MAX_SCREENSHOT_PATH_LENGTH = 1_024;

let dashboardPinsWriteQueue: Promise<unknown> = Promise.resolve();

export type DashboardPinsListFilter = {
  status?: DashboardPinStatus | "all" | null;
  route?: string | null;
};

export type SendPinToWorkBoardOptions = {
  board?: string | null;
  kanban?: KanbanStorageOptions;
};

function emptyPinsFile(): DashboardPinsFile {
  return {
    version: 1,
    pins: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export async function readDashboardPins(): Promise<DashboardPinsFile> {
  try {
    const raw = await readFile(DASHBOARD_PINS_FILE, "utf8");
    if (!raw.trim()) return emptyPinsFile();
    return normalizePinsFile(JSON.parse(raw) as unknown);
  } catch {
    return emptyPinsFile();
  }
}

export async function listDashboardPins(filter: DashboardPinsListFilter = {}) {
  const file = await readDashboardPins();
  const route = cleanOptional(filter.route);
  const pins = file.pins.filter((pin) => {
    if (filter.status && filter.status !== "all" && pin.status !== filter.status) {
      return false;
    }
    if (route && pin.route !== route) return false;
    return true;
  });
  return { ...file, pins };
}

export async function createDashboardPin(input: DashboardPinCreateInput) {
  const pin = normalizeCreateInput(input);
  return enqueueDashboardPinsWrite(async () => {
    const current = await readDashboardPins();
    const now = new Date().toISOString();
    const nextPin: DashboardPin = {
      id: `pin_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
      status: "open",
      ...pin,
    };
    const next = {
      version: 1 as const,
      pins: [nextPin, ...current.pins],
      updatedAt: now,
    };
    await writeDashboardPins(next);
    return { file: next, pin: nextPin };
  });
}

export async function updateDashboardPinStatus(
  id: string,
  status: DashboardPinStatus,
) {
  const nextStatus = normalizeStatus(status);
  return enqueueDashboardPinsWrite(async () => {
    const current = await readDashboardPins();
    const now = new Date().toISOString();
    let updatedPin: DashboardPin | undefined;
    const pins = current.pins.map((pin) => {
      if (pin.id !== id) return pin;
      updatedPin = { ...pin, status: nextStatus, updatedAt: now };
      return updatedPin;
    });
    if (!updatedPin) throw new Error("Dashboard pin not found.");
    const next = { version: 1 as const, pins, updatedAt: now };
    await writeDashboardPins(next);
    return { file: next, pin: updatedPin };
  });
}

export async function deleteDashboardPin(id: string) {
  return enqueueDashboardPinsWrite(async () => {
    const current = await readDashboardPins();
    const pins = current.pins.filter((pin) => pin.id !== id);
    if (pins.length === current.pins.length) throw new Error("Dashboard pin not found.");
    const next = {
      version: 1 as const,
      pins,
      updatedAt: new Date().toISOString(),
    };
    await writeDashboardPins(next);
    return next;
  });
}

export async function sendDashboardPinToWorkBoard(
  id: string,
  options: SendPinToWorkBoardOptions = {},
) {
  return enqueueDashboardPinsWrite(async () => {
    const current = await readDashboardPins();
    const pin = current.pins.find((item) => item.id === id);
    if (!pin) throw new Error("Dashboard pin not found.");
    if (pin.workBoardTaskId) {
      return { file: current, pin, taskId: pin.workBoardTaskId, created: false };
    }

    const task = await createTask(
      options.board ?? null,
      {
        title: pin.comment.slice(0, 96),
        body: workBoardBodyForPin(pin),
        status: "ready",
        priority: "normal",
        workspace: "scratch",
        source: `dashboard-pin:${pin.id}`,
        idempotencyKey: `dashboard-pin:${pin.id}`,
      },
      options.kanban ?? {},
    );

    const now = new Date().toISOString();
    const pins = current.pins.map((item) =>
      item.id === id
        ? {
            ...item,
            status: "sent-to-work-board" as const,
            workBoardTaskId: task.task.id,
            updatedAt: now,
          }
        : item,
    );
    const nextPin = pins.find((item) => item.id === id);
    if (!nextPin) throw new Error("Dashboard pin not found.");
    const next = { version: 1 as const, pins, updatedAt: now };
    await writeDashboardPins(next);
    return { file: next, pin: nextPin, taskId: task.task.id, created: task.created };
  });
}

function enqueueDashboardPinsWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = dashboardPinsWriteQueue.catch(() => undefined).then(operation);
  dashboardPinsWriteQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function normalizePinsFile(value: unknown): DashboardPinsFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyPinsFile();
  const record = value as Partial<DashboardPinsFile>;
  const pins = Array.isArray(record.pins)
    ? record.pins.map(normalizeStoredPin).filter(Boolean)
    : [];
  return {
    version: 1,
    pins: pins as DashboardPin[],
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
  };
}

function normalizeStoredPin(value: unknown): DashboardPin | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<DashboardPin>;
  const id = cleanOptional(item.id);
  const route = normalizeRoute(item.route);
  const comment = normalizeComment(item.comment);
  if (!id || !route || !comment) return null;
  return {
    id,
    route,
    comment,
    createdAt: cleanOptional(item.createdAt) ?? new Date(0).toISOString(),
    updatedAt: cleanOptional(item.updatedAt) ?? new Date(0).toISOString(),
    status: normalizeStatus(item.status),
    selector: cleanHint(item.selector),
    textSnippet: cleanHint(item.textSnippet),
    boundingBox: normalizeBoundingBox(item.boundingBox),
    componentHint: cleanHint(item.componentHint),
    sourceFileHint: cleanStoredSourceFileHint(item.sourceFileHint),
    screenshotPath: cleanScreenshotPath(item.screenshotPath),
    workBoardTaskId: cleanOptional(item.workBoardTaskId),
  };
}

function normalizeCreateInput(input: DashboardPinCreateInput) {
  const route = normalizeRoute(input.route);
  if (!route) throw new Error("Dashboard pin route must start with /.");
  const comment = normalizeComment(input.comment);
  if (!comment) throw new Error("Dashboard pin comment is required.");
  return {
    route,
    comment,
    selector: cleanHint(input.selector),
    textSnippet: cleanHint(input.textSnippet),
    boundingBox: normalizeBoundingBox(input.boundingBox),
    componentHint: cleanHint(input.componentHint),
    sourceFileHint: cleanSourceFileHint(input.sourceFileHint),
    screenshotPath: cleanScreenshotPath(input.screenshotPath),
  };
}

function normalizeRoute(value: unknown) {
  const route = cleanOptional(value);
  if (!route || route.length > MAX_ROUTE_LENGTH || !route.startsWith("/")) return "";
  if (/[\0\r\n]/.test(route) || /^[a-z]+:\/\//i.test(route)) return "";
  return route;
}

function normalizeComment(value: unknown) {
  const comment = cleanOptional(value);
  if (!comment || comment.length > MAX_COMMENT_LENGTH) return "";
  return comment;
}

function normalizeStatus(value: unknown): DashboardPinStatus {
  return DASHBOARD_PIN_STATUSES.includes(value as DashboardPinStatus)
    ? (value as DashboardPinStatus)
    : "open";
}

function normalizeBoundingBox(value: unknown): DashboardPinBoundingBox | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const box = value as Partial<DashboardPinBoundingBox>;
  const next = {
    x: finiteNumber(box.x),
    y: finiteNumber(box.y),
    width: finiteNumber(box.width),
    height: finiteNumber(box.height),
  };
  if (
    next.x === null ||
    next.y === null ||
    next.width === null ||
    next.height === null ||
    next.width < 0 ||
    next.height < 0
  ) {
    return undefined;
  }
  return next as DashboardPinBoundingBox;
}

function cleanHint(value: unknown) {
  const text = cleanOptional(value);
  return text && text.length <= MAX_HINT_LENGTH ? text : undefined;
}

function cleanSourceFileHint(value: unknown) {
  const text = cleanHint(value);
  if (!text) return undefined;
  if (isAbsolute(text) || text.startsWith("~") || /[\0\r\n]/.test(text)) {
    throw new Error("Dashboard pin sourceFileHint must be a relative project path.");
  }
  return text;
}

function cleanStoredSourceFileHint(value: unknown) {
  const text = cleanHint(value);
  if (!text || isAbsolute(text) || text.startsWith("~") || /[\0\r\n]/.test(text)) {
    return undefined;
  }
  return text;
}

function cleanScreenshotPath(value: unknown) {
  const text = cleanOptional(value);
  if (!text || text.length > MAX_SCREENSHOT_PATH_LENGTH || /[\0\r\n]/.test(text)) {
    return undefined;
  }
  return text;
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 100_000) return null;
  return number;
}

function cleanOptional(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function workBoardBodyForPin(pin: DashboardPin) {
  return [
    pin.comment,
    "",
    "Dashboard pin",
    `- Route: ${pin.route}`,
    pin.selector ? `- Selector: \`${pin.selector}\`` : "",
    pin.textSnippet ? `- Text: ${pin.textSnippet}` : "",
    pin.componentHint ? `- Component: ${pin.componentHint}` : "",
    pin.sourceFileHint ? `- Source hint: ${pin.sourceFileHint}` : "",
    pin.boundingBox
      ? `- Bounds: x=${pin.boundingBox.x}, y=${pin.boundingBox.y}, w=${pin.boundingBox.width}, h=${pin.boundingBox.height}`
      : "",
    pin.screenshotPath ? `- Screenshot: ${pin.screenshotPath}` : "",
    `- Pin ID: ${pin.id}`,
  ].filter(Boolean).join("\n");
}

async function writeDashboardPins(file: DashboardPinsFile) {
  await mkdir(dirname(DASHBOARD_PINS_FILE), { recursive: true, mode: 0o700 });
  const temporaryPath = `${DASHBOARD_PINS_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, DASHBOARD_PINS_FILE);
}
