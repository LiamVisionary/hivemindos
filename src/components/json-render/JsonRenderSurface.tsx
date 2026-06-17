"use client";

import { defineCatalog, type Spec, type UIElement } from "@json-render/core";
import {
  JSONUIProvider,
  Renderer,
  defineRegistry,
  type Components,
} from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

import { cn } from "@/lib/utils/cn";

const toneSchema = z.enum(["default", "muted", "success", "warning", "danger", "info"]);
const gapSchema = z.enum(["xs", "sm", "md", "lg"]);
const sizeSchema = z.enum(["sm", "md", "lg"]);
const tableCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const SUPPORTED_COMPONENT_NAMES = [
  "Stack",
  "Panel",
  "Heading",
  "Text",
  "Metric",
  "Badge",
  "Button",
  "Divider",
  "Callout",
  "KeyValueList",
  "DataTable",
  "CodeBlock",
  "Progress",
  "List",
] as const;

export const hiveJsonRenderCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.object({
        direction: z.enum(["row", "column"]).optional(),
        gap: gapSchema.optional(),
        align: z.enum(["start", "center", "end", "stretch"]).optional(),
      }),
      description: "A responsive layout stack for grouping related UI.",
    },
    Panel: {
      props: z.object({
        title: z.string().optional(),
        tone: toneSchema.optional(),
      }),
      description: "A bordered dashboard panel for a grouped section.",
    },
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.enum(["h2", "h3", "h4"]).optional(),
      }),
      description: "A section heading.",
    },
    Text: {
      props: z.object({
        text: z.string(),
        tone: toneSchema.optional(),
        size: sizeSchema.optional(),
      }),
      description: "Readable body or supporting text.",
    },
    Metric: {
      props: z.object({
        label: z.string(),
        value: z.string(),
        detail: z.string().optional(),
        tone: toneSchema.optional(),
      }),
      description: "A compact metric with label, value, and optional detail.",
    },
    Badge: {
      props: z.object({
        label: z.string(),
        tone: toneSchema.optional(),
      }),
      description: "A compact status badge.",
    },
    Button: {
      props: z.object({
        label: z.string(),
        url: z.string().optional(),
        copyText: z.string().optional(),
        variant: z.enum(["primary", "secondary"]).optional(),
      }),
      description: "A safe action button. Use url for links or copyText for clipboard actions.",
    },
    Divider: {
      props: z.object({}),
      description: "A horizontal separator.",
    },
    Callout: {
      props: z.object({
        title: z.string().optional(),
        body: z.string(),
        tone: toneSchema.optional(),
      }),
      description: "A prominent explanatory or status callout.",
    },
    KeyValueList: {
      props: z.object({
        items: z.array(z.object({
          label: z.string(),
          value: z.string(),
          tone: toneSchema.optional(),
        })),
      }),
      description: "A two-column key/value summary list.",
    },
    DataTable: {
      props: z.object({
        caption: z.string().optional(),
        columns: z.array(z.object({
          key: z.string(),
          label: z.string(),
          align: z.enum(["left", "right"]).optional(),
        })),
        rows: z.array(z.record(z.string(), tableCellSchema)),
      }),
      description: "A compact table for structured records.",
    },
    CodeBlock: {
      props: z.object({
        code: z.string(),
        language: z.string().optional(),
      }),
      description: "A wrapped monospace code or spec excerpt.",
    },
    Progress: {
      props: z.object({
        label: z.string().optional(),
        value: z.number().min(0).max(100),
        detail: z.string().optional(),
        tone: toneSchema.optional(),
      }),
      description: "A percentage progress bar.",
    },
    List: {
      props: z.object({
        title: z.string().optional(),
        ordered: z.boolean().optional(),
        items: z.array(z.object({
          label: z.string(),
          detail: z.string().optional(),
          tone: toneSchema.optional(),
        })),
      }),
      description: "A compact ordered or unordered list.",
    },
  },
  actions: {},
});

const SUPPORTED_COMPONENTS = new Set<string>(SUPPORTED_COMPONENT_NAMES);

const toneClasses: Record<z.infer<typeof toneSchema>, string> = {
  default: "border-[var(--line)] bg-[var(--surface-soft)] text-[var(--foreground)]",
  muted: "border-[var(--line)] bg-[var(--surface)] text-[var(--text-soft)]",
  success: "border-[rgba(64,111,83,0.32)] bg-[rgba(64,111,83,0.12)] text-[var(--success)]",
  warning: "border-[rgba(185,139,47,0.34)] bg-[rgba(212,180,111,0.16)] text-[var(--warning)]",
  danger: "border-[rgba(192,82,77,0.34)] bg-[rgba(192,82,77,0.12)] text-[var(--danger)]",
  info: "border-[var(--accent-strong)] bg-[var(--button-accent)] text-[var(--accent-strong)]",
};

const textToneClasses: Record<z.infer<typeof toneSchema>, string> = {
  default: "text-[var(--foreground)]",
  muted: "text-[var(--text-soft)]",
  success: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  danger: "text-[var(--danger)]",
  info: "text-[var(--accent-strong)]",
};

const gapClasses: Record<z.infer<typeof gapSchema>, string> = {
  xs: "gap-1.5",
  sm: "gap-2.5",
  md: "gap-4",
  lg: "gap-6",
};

function safeExternalUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (/^(https?:\/\/|mailto:|#)/i.test(trimmed)) return trimmed;
  return "";
}

function displayValue(value: string | number | boolean | null | undefined) {
  if (value === null || typeof value === "undefined") return "";
  return String(value);
}

function progressBarClass(tone: z.infer<typeof toneSchema>) {
  if (tone === "success") return "bg-[var(--success)]";
  if (tone === "warning") return "bg-[var(--warning)]";
  if (tone === "danger") return "bg-[var(--danger)]";
  if (tone === "info") return "bg-[var(--accent-strong)]";
  return "bg-[var(--text-soft)]";
}

const components = {
  Stack: ({ props, children }) => (
    <div
      className={cn(
        "flex min-w-0 flex-wrap",
        props.direction === "row" ? "flex-row" : "flex-col",
        gapClasses[props.gap ?? "md"],
        props.align === "center" && "items-center",
        props.align === "end" && "items-end",
        props.align === "stretch" && "items-stretch",
        (!props.align || props.align === "start") && "items-start",
      )}
    >
      {children}
    </div>
  ),
  Panel: ({ props, children }) => (
    <section className={cn("grid w-full min-w-0 gap-3 rounded-md border p-4", toneClasses[props.tone ?? "default"])}>
      {props.title ? <h3 className="text-sm font-semibold leading-5 text-[var(--foreground)]">{props.title}</h3> : null}
      {children}
    </section>
  ),
  Heading: ({ props }) => {
    const className = "m-0 text-pretty font-semibold leading-tight text-[var(--foreground)]";
    if (props.level === "h2") return <h2 className={cn(className, "text-lg")}>{props.text}</h2>;
    if (props.level === "h4") return <h4 className={cn(className, "text-sm")}>{props.text}</h4>;
    return <h3 className={cn(className, "text-base")}>{props.text}</h3>;
  },
  Text: ({ props }) => (
    <p
      className={cn(
        "m-0 max-w-full whitespace-pre-wrap break-words leading-6",
        props.size === "sm" ? "text-xs" : props.size === "lg" ? "text-base" : "text-sm",
        textToneClasses[props.tone ?? "muted"],
      )}
    >
      {props.text}
    </p>
  ),
  Metric: ({ props }) => (
    <div className={cn("grid min-w-[9rem] gap-1 rounded-md border px-3 py-2", toneClasses[props.tone ?? "default"])}>
      <span className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{props.label}</span>
      <strong className="break-words text-lg font-semibold leading-tight text-[var(--foreground)]">{props.value}</strong>
      {props.detail ? <span className="break-words text-xs leading-5 text-[var(--text-soft)]">{props.detail}</span> : null}
    </div>
  ),
  Badge: ({ props }) => (
    <span className={cn("inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold", toneClasses[props.tone ?? "muted"])}>
      {props.label}
    </span>
  ),
  Button: ({ props, emit }) => (
    <button
      type="button"
      className={cn(
        "inline-flex w-fit items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold transition",
        props.variant === "primary"
          ? "border-[var(--accent-strong)] bg-[var(--button-accent)] text-[var(--accent-strong)] hover:bg-[var(--surface-strong)]"
          : "border-[var(--line)] bg-[var(--surface-soft)] text-[var(--foreground)] hover:border-[var(--accent-strong)] hover:bg-[var(--button-accent)]",
      )}
      onClick={() => {
        const url = safeExternalUrl(props.url);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
        if (props.copyText) void navigator.clipboard?.writeText(props.copyText);
        emit("press");
      }}
    >
      {props.label}
    </button>
  ),
  Divider: () => <hr className="h-px w-full border-0 bg-[var(--line)]" />,
  Callout: ({ props }) => (
    <aside className={cn("grid w-full gap-2 rounded-md border px-3 py-3", toneClasses[props.tone ?? "info"])}>
      {props.title ? <strong className="text-sm leading-5 text-[var(--foreground)]">{props.title}</strong> : null}
      <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground)]">{props.body}</p>
    </aside>
  ),
  KeyValueList: ({ props }) => (
    <dl className="grid w-full min-w-0 overflow-hidden rounded-md border border-[var(--line)]">
      {props.items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="grid gap-1 border-b border-[var(--line)] px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(7rem,0.45fr)_minmax(0,1fr)]">
          <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{item.label}</dt>
          <dd className={cn("m-0 break-words text-sm leading-5", textToneClasses[item.tone ?? "default"])}>{item.value}</dd>
        </div>
      ))}
    </dl>
  ),
  DataTable: ({ props }) => (
    <div className="grid w-full min-w-0 gap-2">
      {props.caption ? <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{props.caption}</p> : null}
      <div className="w-full overflow-x-auto rounded-md border border-[var(--line)]">
        <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
          <thead className="bg-[var(--surface-soft)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
            <tr>
              {props.columns.map((column) => (
                <th key={column.key} className={cn("border-b border-[var(--line)] px-3 py-2 font-semibold", column.align === "right" && "text-right")}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)] text-[var(--foreground)]">
            {props.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="align-top">
                {props.columns.map((column) => (
                  <td key={column.key} className={cn("px-3 py-2", column.align === "right" && "text-right tabular-nums")}>{displayValue(row[column.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  ),
  CodeBlock: ({ props }) => (
    <figure className="grid w-full min-w-0 gap-2">
      {props.language ? <figcaption className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{props.language}</figcaption> : null}
      <pre className="max-h-72 overflow-auto rounded-md border border-[var(--line)] bg-[var(--field)] p-3 text-xs leading-5 text-[var(--foreground)]">
        <code>{props.code}</code>
      </pre>
    </figure>
  ),
  Progress: ({ props }) => {
    const tone = props.tone ?? "info";
    return (
      <div className="grid w-full gap-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold text-[var(--foreground)]">{props.label ?? "Progress"}</span>
          <span className="tabular-nums text-[var(--text-soft)]">{Math.round(props.value)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-soft)]">
          <div className={cn("h-full rounded-full", progressBarClass(tone))} style={{ width: `${props.value}%` }} />
        </div>
        {props.detail ? <p className="m-0 text-xs leading-5 text-[var(--text-soft)]">{props.detail}</p> : null}
      </div>
    );
  },
  List: ({ props }) => {
    const ListTag = props.ordered ? "ol" : "ul";
    return (
      <div className="grid w-full gap-2">
        {props.title ? <strong className="text-sm text-[var(--foreground)]">{props.title}</strong> : null}
        <ListTag className={cn("m-0 grid gap-2 pl-5 text-sm leading-5 text-[var(--foreground)]", props.ordered ? "list-decimal" : "list-disc")}>
          {props.items.map((item, index) => (
            <li key={`${item.label}-${index}`} className={textToneClasses[item.tone ?? "default"]}>
              <span className="font-medium">{item.label}</span>
              {item.detail ? <span className="text-[var(--text-soft)]"> - {item.detail}</span> : null}
            </li>
          ))}
        </ListTag>
      </div>
    );
  },
} satisfies Components<typeof hiveJsonRenderCatalog>;

const { registry } = defineRegistry(hiveJsonRenderCatalog, { components });

type JsonRenderPayload = {
  spec: Spec;
  source: "object" | "json" | "fence";
  remainingText?: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeElement(value: unknown): UIElement | null {
  if (!isPlainRecord(value)) return null;
  const type = typeof value.type === "string" ? value.type : "";
  if (!SUPPORTED_COMPONENTS.has(type)) return null;
  const children = Array.isArray(value.children) ? value.children.filter((child): child is string => typeof child === "string") : [];
  return {
    ...value,
    type,
    props: isPlainRecord(value.props) ? value.props : {},
    children,
  } as UIElement;
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

  const elements: Record<string, UIElement> = {};
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
    <div className={cn("my-3 grid min-w-0 gap-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-[var(--foreground)]", className)}>
      <JSONUIProvider registry={registry} initialState={payload.spec.state ?? {}}>
        <Renderer spec={payload.spec} registry={registry} />
      </JSONUIProvider>
    </div>
  );
}
