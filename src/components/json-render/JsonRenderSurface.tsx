"use client";

import "@/components/json-render/fr/fr-style.css";

import { CATALOG_COMPONENTS, FrJsonRender, REGISTRY, type Cond, type Handler, type JREl, type Spec } from "@/components/json-render/fr";
import { cn } from "@/lib/utils/cn";

export const hiveJsonRenderCatalog = {
  components: CATALOG_COMPONENTS,
} as const;

type JsonRenderPayload = {
  spec: Spec;
  source: "object" | "json" | "fence";
  remainingText?: string;
};

const SUPPORTED_COMPONENTS = new Set(CATALOG_COMPONENTS);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeHandler(value: unknown): Handler | null {
  if (!isPlainRecord(value) || typeof value.action !== "string" || !value.action.trim()) return null;
  return {
    action: value.action,
    ...(isPlainRecord(value.params) ? { params: value.params } : {}),
  };
}

function normalizeHandlerList(value: unknown): Handler | Handler[] | null {
  if (Array.isArray(value)) {
    const handlers = value.map(normalizeHandler).filter((item): item is Handler => Boolean(item));
    return handlers.length ? handlers : null;
  }
  return normalizeHandler(value);
}

function normalizeEvents(value: unknown): JREl["on"] | undefined {
  if (!isPlainRecord(value)) return undefined;
  const events: JREl["on"] = {};
  for (const [eventName, handler] of Object.entries(value)) {
    const normalized = normalizeHandlerList(handler);
    if (normalized) events[eventName] = normalized;
  }
  return Object.keys(events).length ? events : undefined;
}

function isCond(value: unknown): value is Cond {
  if (typeof value === "boolean") return true;
  if (!isPlainRecord(value)) return false;
  return typeof value.$state === "string";
}

function normalizeVisible(value: unknown): JREl["visible"] | undefined {
  if (Array.isArray(value)) {
    const conditions = value.filter(isCond);
    return conditions.length ? conditions : undefined;
  }
  return isCond(value) ? value : undefined;
}

function normalizeElement(value: unknown): JREl | null {
  if (!isPlainRecord(value)) return null;
  const type = typeof value.type === "string" ? value.type : "";
  if (!SUPPORTED_COMPONENTS.has(type)) return null;
  const children = Array.isArray(value.children) ? value.children.filter((child): child is string => typeof child === "string") : [];
  return {
    type,
    props: isPlainRecord(value.props) ? value.props : {},
    children,
    ...(normalizeEvents(value.on) ? { on: normalizeEvents(value.on) } : {}),
    ...(normalizeVisible(value.visible) ? { visible: normalizeVisible(value.visible) } : {}),
  };
}

function normalizeSpec(value: unknown): Spec | null {
  if (!isPlainRecord(value)) return null;
  const candidate = isPlainRecord(value.spec)
    ? value.spec
    : isPlainRecord(value.jsonRender)
      ? value.jsonRender
      : isPlainRecord(value.ui)
        ? value.ui
        : value;
  if (typeof candidate.root !== "string" || !isPlainRecord(candidate.elements)) return null;

  const elements: Record<string, JREl> = {};
  for (const [key, element] of Object.entries(candidate.elements)) {
    const normalized = normalizeElement(element);
    if (!normalized) return null;
    elements[key] = normalized;
  }
  if (!elements[candidate.root]) return null;

  for (const element of Object.values(elements)) {
    for (const child of element.children ?? []) {
      if (!elements[child]) return null;
    }
  }

  return {
    root: candidate.root,
    elements,
    ...(isPlainRecord(candidate.state) ? { state: candidate.state } : {}),
  };
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function extractJsonRenderPayload(value: unknown): JsonRenderPayload | null {
  const objectSpec = normalizeSpec(value);
  if (objectSpec) return { spec: objectSpec, source: "object" };
  if (typeof value !== "string") return null;

  const directSpec = normalizeSpec(parseJson(value.trim()));
  if (directSpec) return { spec: directSpec, source: "json" };

  const fencePattern = /(^|\n)```(?:json-render|jsonrender|json\s+render|json)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(value))) {
    const spec = normalizeSpec(parseJson(match[2].trim()));
    if (spec) {
      const remainingText = `${value.slice(0, match.index)}${value.slice(match.index + match[0].length)}`.trim();
      return { spec, source: "fence", remainingText };
    }
  }

  return null;
}

export function stripJsonRenderPayload(value: string) {
  return extractJsonRenderPayload(value)?.remainingText ?? value;
}

export function JsonRenderSurface({ value, className }: { value: unknown; className?: string }) {
  const payload = extractJsonRenderPayload(value);
  if (!payload) return null;

  return (
    <div className={cn("fr-root fr-scroll my-3 grid min-w-0 gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-soft)] p-3 text-[var(--fg)]", className)}>
      <FrJsonRender
        spec={payload.spec}
        registry={REGISTRY}
        onAction={() => undefined}
      />
    </div>
  );
}
