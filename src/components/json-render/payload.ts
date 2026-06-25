import { autoFixSpec, compileSpecStream, parseSpecStreamLine } from "@json-render/core";

import {
  JSON_RENDER_COMPONENT_LIST,
  JSON_RENDER_COMPONENT_NAMES,
  hiveJsonRenderCatalog as upstreamHiveJsonRenderCatalog,
  jsonRenderCatalogPrompt,
  validateJsonRenderProps,
} from "@/components/json-render/catalog";

export const hiveJsonRenderCatalog = {
  components: JSON_RENDER_COMPONENT_NAMES,
  componentList: JSON_RENDER_COMPONENT_LIST,
  prompt: jsonRenderCatalogPrompt,
  schema: upstreamHiveJsonRenderCatalog.jsonSchema(),
} as const;

export type JsonRenderHandler = { action: string; params?: Record<string, unknown> };
export type JsonRenderCond =
  | { $state: string; eq?: unknown; neq?: unknown; gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown; not?: boolean }
  | { $and: JsonRenderCond[] }
  | { $or: JsonRenderCond[] }
  | boolean;

export interface JsonRenderElement {
  type: string;
  props?: Record<string, unknown>;
  children?: string[];
  on?: Record<string, JsonRenderHandler | JsonRenderHandler[]>;
  visible?: JsonRenderCond | JsonRenderCond[];
  watch?: Record<string, JsonRenderHandler | JsonRenderHandler[]>;
}

export interface JsonRenderSpec {
  root: string;
  elements: Record<string, JsonRenderElement>;
  state?: Record<string, unknown>;
}

export type JsonRenderPayload = {
  spec: JsonRenderSpec;
  source: "object" | "json" | "fence" | "stream";
  remainingText?: string;
};

const SUPPORTED_COMPONENTS = new Set(JSON_RENDER_COMPONENT_NAMES);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeHandler(value: unknown): JsonRenderHandler | null {
  if (!isPlainRecord(value) || typeof value.action !== "string" || !value.action.trim()) return null;
  return {
    action: value.action,
    ...(isPlainRecord(value.params) ? { params: value.params } : {}),
  };
}

function normalizeHandlerList(value: unknown): JsonRenderHandler | JsonRenderHandler[] | null {
  if (Array.isArray(value)) {
    const handlers = value.map(normalizeHandler).filter((item): item is JsonRenderHandler => Boolean(item));
    return handlers.length ? handlers : null;
  }
  return normalizeHandler(value);
}

function normalizeEvents(value: unknown): JsonRenderElement["on"] | undefined {
  if (!isPlainRecord(value)) return undefined;
  const events: JsonRenderElement["on"] = {};
  for (const [eventName, handler] of Object.entries(value)) {
    const normalized = normalizeHandlerList(handler);
    if (normalized) events[eventName] = normalized;
  }
  return Object.keys(events).length ? events : undefined;
}

function normalizeWatch(value: unknown): JsonRenderElement["watch"] | undefined {
  if (!isPlainRecord(value)) return undefined;
  const watch: JsonRenderElement["watch"] = {};
  for (const [path, handler] of Object.entries(value)) {
    if (!path.startsWith("/")) continue;
    const normalized = normalizeHandlerList(handler);
    if (normalized) watch[path] = normalized;
  }
  return Object.keys(watch).length ? watch : undefined;
}

function isCond(value: unknown): value is JsonRenderCond {
  if (typeof value === "boolean") return true;
  if (!isPlainRecord(value)) return false;
  if (typeof value.$state === "string") return true;
  if (Array.isArray(value.$and)) return value.$and.every(isCond);
  if (Array.isArray(value.$or)) return value.$or.every(isCond);
  return false;
}

function normalizeVisible(value: unknown): JsonRenderElement["visible"] | undefined {
  if (Array.isArray(value)) {
    const conditions = value.filter(isCond);
    return conditions.length ? conditions : undefined;
  }
  return isCond(value) ? value : undefined;
}

function normalizeElement(value: unknown): JsonRenderElement | null {
  if (!isPlainRecord(value)) return null;
  const type = typeof value.type === "string" ? value.type : "";
  if (!SUPPORTED_COMPONENTS.has(type)) return null;
  const props = isPlainRecord(value.props) ? value.props : {};
  const parsedProps = validateJsonRenderProps(type, props);
  if (!parsedProps.success) return null;
  const children = Array.isArray(value.children) ? value.children.filter((child): child is string => typeof child === "string") : [];

  return {
    type,
    props: parsedProps.props,
    children,
    ...(normalizeEvents(value.on) ? { on: normalizeEvents(value.on) } : {}),
    ...(normalizeVisible(value.visible) ? { visible: normalizeVisible(value.visible) } : {}),
    ...(normalizeWatch(value.watch) ? { watch: normalizeWatch(value.watch) } : {}),
  };
}

export function normalizeJsonRenderSpec(value: unknown): JsonRenderSpec | null {
  if (!isPlainRecord(value)) return null;
  const candidate = isPlainRecord(value.spec)
    ? value.spec
    : isPlainRecord(value.jsonRender)
      ? value.jsonRender
      : isPlainRecord(value.ui)
        ? value.ui
        : value;
  if (typeof candidate.root !== "string" || !isPlainRecord(candidate.elements)) return null;

  const fixed = autoFixSpec({
    root: candidate.root,
    elements: candidate.elements as Record<string, JsonRenderElement>,
    ...(isPlainRecord(candidate.state) ? { state: candidate.state } : {}),
  } as Parameters<typeof autoFixSpec>[0]).spec as unknown as JsonRenderSpec;

  const elements: Record<string, JsonRenderElement> = {};
  for (const [key, element] of Object.entries(fixed.elements)) {
    const normalized = normalizeElement(element);
    if (!normalized) return null;
    elements[key] = normalized;
  }
  if (!elements[fixed.root]) return null;

  for (const element of Object.values(elements)) {
    for (const child of element.children ?? []) {
      if (!elements[child]) return null;
    }
  }

  return {
    root: fixed.root,
    elements,
    ...(isPlainRecord(fixed.state) ? { state: fixed.state } : {}),
  };
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractSpecStreamPayload(value: string): JsonRenderPayload | null {
  const lines = value.split(/\r?\n/);
  const patchLines: string[] = [];
  const textLines: string[] = [];

  for (const line of lines) {
    const patch = parseSpecStreamLine(line);
    if (patch) patchLines.push(line.trim());
    else textLines.push(line);
  }

  if (!patchLines.length) return null;
  const spec = normalizeJsonRenderSpec(compileSpecStream(patchLines.join("\n"), {}));
  if (!spec) return null;
  return { spec, source: "stream", remainingText: textLines.join("\n").trim() };
}

export function extractJsonRenderPayload(value: unknown): JsonRenderPayload | null {
  const objectSpec = normalizeJsonRenderSpec(value);
  if (objectSpec) return { spec: objectSpec, source: "object" };
  if (typeof value !== "string") return null;

  const directSpec = normalizeJsonRenderSpec(parseJson(value.trim()));
  if (directSpec) return { spec: directSpec, source: "json", remainingText: "" };

  const fencePattern = /(^|\n)```(?:json-render|jsonrender|json\s+render|json)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(value))) {
    const spec = normalizeJsonRenderSpec(parseJson(match[2].trim()));
    if (spec) {
      const remainingText = `${value.slice(0, match.index)}${value.slice(match.index + match[0].length)}`.trim();
      return { spec, source: "fence", remainingText };
    }
  }

  return extractSpecStreamPayload(value);
}

export function stripJsonRenderPayload(value: string) {
  return extractJsonRenderPayload(value)?.remainingText ?? value;
}
