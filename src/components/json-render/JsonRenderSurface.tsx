"use client";

import "@/components/json-render/fr/fr-style.css";

import { FrJsonRender, REGISTRY, type ComputedFunctions, type OnAction, type Spec } from "@/components/json-render/fr";
import {
  extractJsonRenderPayload,
  hiveJsonRenderCatalog,
  stripJsonRenderPayload,
  type JsonRenderPayload,
} from "@/components/json-render/payload";
import { cn } from "@/lib/utils/cn";

export { extractJsonRenderPayload, hiveJsonRenderCatalog, stripJsonRenderPayload, type JsonRenderPayload };

function isSafeGeneratedUrl(value: unknown) {
  return typeof value === "string" && /^(https?:\/\/|mailto:|#)/i.test(value.trim());
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.top = "-999px";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
}

export const defaultJsonRenderFunctions: ComputedFunctions = {
  count: (args) => {
    const value = args.value;
    if (Array.isArray(value) || typeof value === "string") return value.length;
    if (value && typeof value === "object") return Object.keys(value).length;
    return 0;
  },
  concat: (args) => {
    const parts = Array.isArray(args.parts) ? args.parts : Object.values(args);
    return parts.map((part) => String(part ?? "")).join("");
  },
  join: (args) => {
    const value = Array.isArray(args.items) ? args.items : Array.isArray(args.value) ? args.value : [];
    const separator = typeof args.separator === "string" ? args.separator : ", ";
    return value.map((item) => String(item ?? "")).join(separator);
  },
  sum: (args) => {
    const values = Array.isArray(args.values) ? args.values : Object.values(args);
    return values.map(Number).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  },
  average: (args) => {
    const values = (Array.isArray(args.values) ? args.values : Object.values(args)).map(Number).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  },
};

export const defaultJsonRenderActionBridge: OnAction = (name, params, payload) => {
  if (typeof window === "undefined") return;
  if (name === "openUrl" && isSafeGeneratedUrl(params.url ?? params.href)) {
    window.open(String(params.url ?? params.href).trim(), "_blank", "noopener,noreferrer");
  }
  if (name === "copyText") {
    const text = typeof params.text === "string" ? params.text : typeof params.copyText === "string" ? params.copyText : "";
    if (text) void copyText(text).catch(() => undefined);
  }
  window.dispatchEvent(new CustomEvent("hivemindos:json-render-action", {
    detail: { name, params, payload },
  }));
};

export function JsonRenderSurface({
  value,
  className,
  onAction,
  functions,
}: {
  value: unknown;
  className?: string;
  onAction?: OnAction;
  functions?: ComputedFunctions;
}) {
  const payload = extractJsonRenderPayload(value);
  if (!payload) return null;

  return (
    <div className={cn("fr-root fr-scroll my-3 grid min-w-0 gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-soft)] p-3 text-[var(--fg)]", className)}>
      <FrJsonRender
        spec={payload.spec as Spec}
        registry={REGISTRY}
        onAction={onAction ?? defaultJsonRenderActionBridge}
        functions={functions ?? defaultJsonRenderFunctions}
      />
    </div>
  );
}
