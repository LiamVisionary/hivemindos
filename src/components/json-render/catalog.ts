import { defineCatalog, defineDirective, resolvePropValue } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const hasOwn = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const stateRefSchema = z.object({ $state: z.string() });
const bindStateRefSchema = z.object({ $bindState: z.string() });
const computedRefSchema = z.object({
  $computed: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
});
const templateRefSchema = z.object({ $template: z.string() });
const condRefSchema = z.object({
  $cond: z.unknown(),
  $then: z.unknown(),
  $else: z.unknown(),
}).passthrough().refine((value) => hasOwn(value, "$cond") && hasOwn(value, "$then") && hasOwn(value, "$else"));
const formatRefSchema = z.object({
  $format: z.enum(["number", "percent", "currency", "date", "relativeTime"]),
  value: z.unknown(),
  locale: z.string().optional(),
  currency: z.string().optional(),
}).passthrough();
const concatRefSchema = z.object({ $concat: z.array(z.unknown()) }).passthrough();
const countRefSchema = z.object({ $count: z.unknown() }).passthrough().refine((value) => hasOwn(value, "$count"));
const truncateRefSchema = z.object({ $truncate: z.unknown(), length: z.number().optional() }).passthrough().refine((value) => hasOwn(value, "$truncate"));
const pluralizeRefSchema = z.object({
  $pluralize: z.unknown(),
  singular: z.string(),
  plural: z.string().optional(),
}).passthrough().refine((value) => hasOwn(value, "$pluralize"));
const joinRefSchema = z.object({ $join: z.unknown(), separator: z.string().optional() }).passthrough().refine((value) => hasOwn(value, "$join"));
const translationRefSchema = z.object({ $t: z.string(), values: z.record(z.string(), z.unknown()).optional() }).passthrough();
const mathRefSchema = z.object({
  $math: z.enum(["sum", "avg", "average", "min", "max"]),
  values: z.array(z.unknown()).optional(),
}).passthrough();
const directiveRefSchema = z.union([
  formatRefSchema,
  concatRefSchema,
  countRefSchema,
  truncateRefSchema,
  pluralizeRefSchema,
  joinRefSchema,
  translationRefSchema,
  mathRefSchema,
]);

const dynamic = (valueSchema: z.ZodType) => z.union([
  valueSchema,
  stateRefSchema,
  bindStateRefSchema,
  computedRefSchema,
  templateRefSchema,
  condRefSchema,
  directiveRefSchema,
]);

const stringValue = dynamic(z.string());
const stringishValue = dynamic(z.union([z.string(), z.number(), z.boolean()]));
const numberValue = dynamic(z.number());
const booleanValue = dynamic(z.boolean());
const unknownRecord = z.record(z.string(), z.unknown());
const toneValue = dynamic(z.enum(["default", "info", "success", "warning", "danger", "muted", "secondary", "destructive", "outline"]));
const gapValue = dynamic(z.enum(["none", "xs", "sm", "md", "lg", "xl"]));
const optionItem = z.object({ label: z.string(), value: z.string() }).passthrough();
const looseProps = <T extends z.ZodRawShape>(shape: T) => z.object(shape).partial().passthrough();

export const jsonRenderComponentDefinitions = {
  Card: {
    props: looseProps({
      title: stringishValue,
      description: stringishValue,
      maxWidth: dynamic(z.enum(["sm", "md", "lg", "full"])),
      centered: booleanValue,
    }),
    slots: ["default"],
    description: "A bordered content card with optional title and description.",
  },
  Stack: {
    props: looseProps({
      direction: dynamic(z.enum(["vertical", "horizontal", "row", "column"])),
      gap: gapValue,
      align: dynamic(z.enum(["start", "center", "end", "stretch"])),
      justify: dynamic(z.enum(["start", "center", "end", "between", "around"])),
    }),
    slots: ["default"],
    description: "A flex stack for vertical or horizontal layout.",
  },
  Grid: {
    props: looseProps({ columns: numberValue, gap: gapValue }),
    slots: ["default"],
    description: "A responsive grid with one to six columns.",
  },
  Separator: {
    props: looseProps({ orientation: dynamic(z.enum(["horizontal", "vertical"])) }),
    slots: [],
    description: "A horizontal or vertical separator.",
  },
  Tabs: {
    props: looseProps({
      tabs: dynamic(z.array(optionItem)),
      value: stringValue,
      defaultValue: stringValue,
    }),
    slots: ["default"],
    description: "A segmented tab control whose children map to tab panels.",
  },
  Accordion: {
    props: looseProps({
      type: dynamic(z.enum(["single", "multiple"])),
      items: dynamic(z.array(z.object({ title: z.string(), content: z.string() }).passthrough())),
    }),
    slots: [],
    description: "A collapsible list of titled text sections.",
  },
  Collapsible: {
    props: looseProps({ title: stringishValue, defaultOpen: booleanValue }),
    slots: ["default"],
    description: "A titled disclosure section.",
  },
  Dialog: {
    props: looseProps({ openPath: stringValue, title: stringishValue, description: stringishValue }),
    slots: ["default"],
    description: "A modal dialog controlled by a state path.",
  },
  Drawer: {
    props: looseProps({ openPath: stringValue, title: stringishValue, description: stringishValue }),
    slots: ["default"],
    description: "A bottom drawer controlled by a state path.",
  },
  Carousel: {
    props: looseProps({
      items: dynamic(z.array(z.object({ title: z.string().optional(), description: z.string().optional() }).passthrough())),
    }),
    slots: [],
    description: "A horizontal carousel for compact item summaries.",
  },
  Table: {
    props: looseProps({
      caption: stringishValue,
      columns: dynamic(z.array(z.string())),
      rows: dynamic(z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))),
    }),
    slots: [],
    description: "A simple table using string columns and row arrays.",
  },
  Heading: {
    props: looseProps({ text: stringishValue, level: dynamic(z.enum(["h1", "h2", "h3", "h4"])) }),
    slots: [],
    description: "A section heading.",
  },
  Text: {
    props: looseProps({ text: stringishValue, variant: dynamic(z.enum(["body", "lead", "caption", "muted", "code"])) }),
    slots: [],
    description: "Wrapped body, lead, caption, muted, or inline-code text.",
  },
  Image: {
    props: looseProps({ src: stringValue, alt: stringishValue, width: dynamic(z.union([z.string(), z.number()])), height: dynamic(z.union([z.string(), z.number()])) }),
    slots: [],
    description: "An image with safe browser rendering; missing images become placeholders.",
  },
  Avatar: {
    props: looseProps({ name: stringishValue, src: stringValue, size: dynamic(z.enum(["sm", "md", "lg"])) }),
    slots: [],
    description: "A small avatar image or initials badge.",
  },
  Badge: {
    props: looseProps({ label: stringishValue, text: stringishValue, tone: toneValue, variant: toneValue }),
    slots: [],
    description: "A compact status badge.",
  },
  Alert: {
    props: looseProps({ title: stringishValue, message: stringishValue, type: dynamic(z.enum(["info", "success", "warning", "error"])) }),
    slots: [],
    description: "A prominent inline alert with status tone.",
  },
  Progress: {
    props: looseProps({ label: stringishValue, value: numberValue, max: numberValue, detail: stringishValue, tone: toneValue }),
    slots: [],
    description: "A progress meter with optional label and detail.",
  },
  Skeleton: {
    props: looseProps({ width: dynamic(z.union([z.string(), z.number()])), height: dynamic(z.union([z.string(), z.number()])), rounded: booleanValue }),
    slots: [],
    description: "A loading skeleton block.",
  },
  Spinner: {
    props: looseProps({ label: stringishValue, size: dynamic(z.enum(["sm", "md", "lg"])) }),
    slots: [],
    description: "A loading spinner with optional label.",
  },
  Tooltip: {
    props: looseProps({ text: stringishValue, content: stringishValue }),
    slots: [],
    description: "Small hover help for a short text label.",
  },
  Popover: {
    props: looseProps({ trigger: stringishValue, content: stringishValue }),
    slots: [],
    description: "A button-triggered floating text popover.",
  },
  Input: {
    props: looseProps({ label: stringishValue, type: stringValue, value: stringValue, placeholder: stringishValue, checks: dynamic(z.array(unknownRecord)) }),
    slots: [],
    description: "A bound text input with lightweight validation.",
  },
  Textarea: {
    props: looseProps({ label: stringishValue, value: stringValue, placeholder: stringishValue, rows: numberValue }),
    slots: [],
    description: "A bound multi-line text area.",
  },
  Select: {
    props: looseProps({ label: stringishValue, options: dynamic(z.array(z.string())), value: stringValue, placeholder: stringishValue }),
    slots: [],
    description: "A native select control for string options.",
  },
  Checkbox: {
    props: looseProps({ label: stringishValue, checked: booleanValue }),
    slots: [],
    description: "A checkbox control.",
  },
  Radio: {
    props: looseProps({ label: stringishValue, options: dynamic(z.array(z.string())), value: stringValue }),
    slots: [],
    description: "A radio group for string options.",
  },
  Switch: {
    props: looseProps({ label: stringishValue, checked: booleanValue }),
    slots: [],
    description: "A binary switch control.",
  },
  Slider: {
    props: looseProps({ label: stringishValue, min: numberValue, max: numberValue, step: numberValue, value: numberValue }),
    slots: [],
    description: "A numeric range slider.",
  },
  Button: {
    props: looseProps({ label: stringishValue, disabled: booleanValue, variant: dynamic(z.enum(["primary", "secondary", "danger"])), url: stringValue, copyText: stringValue, copiedLabel: stringishValue }),
    slots: [],
    description: "A button that can emit actions, open safe URLs, or copy text.",
  },
  Link: {
    props: looseProps({ label: stringishValue, href: stringValue }),
    slots: [],
    description: "A link-like action trigger.",
  },
  DropdownMenu: {
    props: looseProps({ label: stringishValue, value: stringValue, items: dynamic(z.array(optionItem)) }),
    slots: [],
    description: "A dropdown menu for labeled string choices.",
  },
  Toggle: {
    props: looseProps({ label: stringishValue, pressed: booleanValue, variant: dynamic(z.enum(["default", "outline"])) }),
    slots: [],
    description: "A single toggle button.",
  },
  ToggleGroup: {
    props: looseProps({ items: dynamic(z.array(optionItem)), type: dynamic(z.enum(["single", "multiple"])), value: stringValue }),
    slots: [],
    description: "A segmented toggle group.",
  },
  ButtonGroup: {
    props: looseProps({ buttons: dynamic(z.array(optionItem)), selected: stringValue }),
    slots: [],
    description: "A joined group of mutually exclusive buttons.",
  },
  Pagination: {
    props: looseProps({ totalPages: numberValue, page: numberValue }),
    slots: [],
    description: "A compact pagination control.",
  },
  Panel: {
    props: looseProps({ title: stringishValue, tone: toneValue }),
    slots: ["default"],
    description: "A HivemindOS-styled panel for grouped generated UI.",
  },
  Divider: {
    props: looseProps({}),
    slots: [],
    description: "A simple divider.",
  },
  Metric: {
    props: looseProps({ label: stringishValue, value: stringishValue, detail: stringishValue, tone: toneValue, format: stringValue }),
    slots: [],
    description: "A labeled metric value with optional detail.",
  },
  Callout: {
    props: looseProps({ title: stringishValue, body: stringishValue, tone: toneValue }),
    slots: [],
    description: "A prominent note, warning, result summary, or next action.",
  },
  KeyValueList: {
    props: looseProps({
      items: dynamic(z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]), tone: z.string().optional() }).passthrough())),
    }),
    slots: [],
    description: "A list of labeled facts.",
  },
  DataTable: {
    props: looseProps({
      caption: stringishValue,
      columns: dynamic(z.array(z.object({ key: z.string(), label: z.string().optional(), align: z.enum(["left", "right"]).optional() }).passthrough())),
      rows: dynamic(z.array(unknownRecord)),
    }),
    slots: [],
    description: "A compact table for structured records.",
  },
  CodeBlock: {
    props: looseProps({ language: stringValue, code: stringishValue }),
    slots: [],
    description: "A scrollable code or data block.",
  },
  List: {
    props: looseProps({
      title: stringishValue,
      ordered: booleanValue,
      items: dynamic(z.array(z.union([z.string(), z.object({ label: z.string(), detail: z.string().optional(), tone: z.string().optional() }).passthrough()]))),
    }),
    slots: [],
    description: "An ordered or unordered list with optional item details.",
  },
  Chart: {
    props: looseProps({
      type: dynamic(z.enum(["bar", "line", "area", "pie", "donut"])),
      data: dynamic(z.array(z.object({ label: z.union([z.string(), z.number()]), value: z.union([z.number(), z.string()]) }).passthrough())),
      series: dynamic(z.array(z.object({ name: z.string().optional(), color: z.string().optional(), data: z.array(z.object({ label: z.union([z.string(), z.number()]), value: z.union([z.number(), z.string()]) }).passthrough()) }).passthrough())),
      title: stringishValue,
      caption: stringishValue,
      height: numberValue,
      logScale: booleanValue,
      valueFormat: dynamic(z.enum(["number", "percent", "currency"])),
    }),
    slots: [],
    description: "A data chart rendered inline as SVG. Set type to bar, line, area, pie, or donut. Provide data as [{ label, value }] for one series, or series as [{ name, color, data: [{ label, value }] }] for several. Supports logScale and valueFormat. Prefer this over describing numeric trends or comparisons in prose.",
  },
  Diagram: {
    props: looseProps({
      code: stringishValue,
      mermaid: stringishValue,
      caption: stringishValue,
    }),
    slots: [],
    description: "A conceptual diagram rendered from Mermaid syntax (flowchart, graph, sequence, mindmap, class, ER, etc). Put the Mermaid source string in code. Use for architectures, flows, hierarchies, and relationships.",
  },
  Flashcards: {
    props: looseProps({
      title: stringishValue,
      cards: dynamic(z.array(z.object({ front: z.string(), back: z.string() }).passthrough())),
    }),
    slots: [],
    description: "An interactive flashcard deck the user can flip and step through. Provide cards as [{ front, back }]. Use for study sets, Q&A review, and vocabulary.",
  },
};

export const jsonRenderActionDefinitions = {
  openUrl: {
    params: looseProps({ url: stringValue }),
    description: "Open a safe http, https, mailto, or hash URL in a new tab.",
  },
  copyText: {
    params: looseProps({ text: stringValue }),
    description: "Copy text to the clipboard.",
  },
  emit: {
    params: unknownRecord,
    description: "Emit a local HivemindOS json-render action event for the host dashboard.",
  },
};

export const hiveJsonRenderCatalog = defineCatalog(schema, {
  components: jsonRenderComponentDefinitions,
  actions: jsonRenderActionDefinitions,
});

export const JSON_RENDER_COMPONENT_NAMES = Object.keys(jsonRenderComponentDefinitions);

export const JSON_RENDER_COMPONENT_LIST = JSON_RENDER_COMPONENT_NAMES.join(", ");

export const jsonRenderDirectiveDefinitions = [
  defineDirective({
    name: "$format",
    description: "Format a value as number, percent, currency, date, or relativeTime.",
    schema: z.object({
      $format: z.enum(["number", "percent", "currency", "date", "relativeTime"]),
      value: z.unknown(),
      locale: z.string().optional(),
      currency: z.string().optional(),
    }).passthrough(),
    resolve: (value, ctx) => {
      const resolved = resolvePropValue(value.value, ctx);
      const locale = value.locale;
      if (value.$format === "currency") {
        const amount = typeof resolved === "number" ? resolved : Number(resolved);
        return Number.isFinite(amount) ? new Intl.NumberFormat(locale, { style: "currency", currency: value.currency ?? "USD" }).format(amount) : String(resolved ?? "");
      }
      if (value.$format === "percent") {
        const amount = typeof resolved === "number" ? resolved : Number(resolved);
        return Number.isFinite(amount) ? new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(amount) : String(resolved ?? "");
      }
      if (value.$format === "number") {
        const amount = typeof resolved === "number" ? resolved : Number(resolved);
        return Number.isFinite(amount) ? new Intl.NumberFormat(locale).format(amount) : String(resolved ?? "");
      }
      if (value.$format === "date") {
        const date = resolved instanceof Date ? resolved : new Date(String(resolved ?? ""));
        return Number.isNaN(date.valueOf()) ? String(resolved ?? "") : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
      }
      return String(resolved ?? "");
    },
  }),
  defineDirective({
    name: "$concat",
    description: "Concatenate resolved values into one string.",
    schema: z.object({ $concat: z.array(z.unknown()) }).passthrough(),
    resolve: (value, ctx) => value.$concat.map((part) => String(resolvePropValue(part, ctx) ?? "")).join(""),
  }),
  defineDirective({
    name: "$count",
    description: "Return the length of an array, string, or object.",
    schema: z.object({ $count: z.unknown() }).passthrough(),
    resolve: (value, ctx) => {
      const resolved = resolvePropValue(value.$count, ctx);
      if (Array.isArray(resolved) || typeof resolved === "string") return resolved.length;
      if (resolved && typeof resolved === "object") return Object.keys(resolved).length;
      return 0;
    },
  }),
  defineDirective({
    name: "$truncate",
    description: "Shorten a value to a maximum length.",
    schema: z.object({ $truncate: z.unknown(), length: z.number().optional() }).passthrough(),
    resolve: (value, ctx) => {
      const text = String(resolvePropValue(value.$truncate, ctx) ?? "");
      const length = value.length ?? 80;
      return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}...` : text;
    },
  }),
  defineDirective({
    name: "$pluralize",
    description: "Choose singular or plural text from a count.",
    schema: z.object({
      $pluralize: z.unknown(),
      singular: z.string(),
      plural: z.string().optional(),
    }).passthrough(),
    resolve: (value, ctx) => Number(resolvePropValue(value.$pluralize, ctx) ?? 0) === 1 ? value.singular : value.plural ?? `${value.singular}s`,
  }),
  defineDirective({
    name: "$join",
    description: "Join array items into a string.",
    schema: z.object({ $join: z.unknown(), separator: z.string().optional() }).passthrough(),
    resolve: (value, ctx) => {
      const resolved = resolvePropValue(value.$join, ctx);
      return Array.isArray(resolved) ? resolved.map((item) => String(item ?? "")).join(value.separator ?? ", ") : String(resolved ?? "");
    },
  }),
  defineDirective({
    name: "$math",
    description: "Calculate sum, average, min, or max from resolved numeric values.",
    schema: z.object({
      $math: z.enum(["sum", "avg", "average", "min", "max"]),
      values: z.array(z.unknown()).optional(),
    }).passthrough(),
    resolve: (value, ctx) => {
      const rawValues = Array.isArray(value.values) ? value.values : [];
      const values = rawValues.map((item) => Number(resolvePropValue(item, ctx))).filter(Number.isFinite);
      if (value.$math === "sum") return values.reduce((sum, item) => sum + item, 0);
      if (value.$math === "avg" || value.$math === "average") return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : 0;
      if (value.$math === "min") return values.length ? Math.min(...values) : 0;
      if (value.$math === "max") return values.length ? Math.max(...values) : 0;
      return 0;
    },
  }),
  defineDirective({
    name: "$t",
    description: "Return an i18n key or translated string when the host supplies translations.",
    schema: z.object({ $t: z.string(), values: unknownRecord.optional() }).passthrough(),
    resolve: (value, ctx) => {
      let text = value.$t;
      for (const [key, raw] of Object.entries(value.values ?? {})) {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(new RegExp(`\\{${escapedKey}\\}`, "g"), String(resolvePropValue(raw, ctx) ?? ""));
      }
      return text;
    },
  }),
];

export const jsonRenderCatalogPrompt = hiveJsonRenderCatalog.prompt({
  mode: "inline",
  directives: jsonRenderDirectiveDefinitions,
  customRules: [
    "HivemindOS accepts fenced ```json-render JSON specs and SpecStream JSON patch lines.",
    "Use the flat shape { root, elements, state? }. Every element must have type, props, and children.",
    "Use only catalog components and safe actions. Do not request hidden network, shell, payment, wallet, or file side effects through generated UI.",
  ],
});

export function validateJsonRenderProps(type: string, props: Record<string, unknown>):
  | { success: true; props: Record<string, unknown> }
  | { success: false; error: string } {
  const definition = jsonRenderComponentDefinitions[type as keyof typeof jsonRenderComponentDefinitions];
  if (!definition) return { success: false, error: `Unsupported component type: ${type}` };
  const parsed = definition.props.safeParse(props);
  return parsed.success
    ? { success: true, props: parsed.data as Record<string, unknown> }
    : { success: false, error: parsed.error.message };
}
