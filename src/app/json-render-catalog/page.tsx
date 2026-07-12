import { JsonRenderSurface } from "@/components/json-render/JsonRenderSurface";

const catalogSpecs = [
  {
    title: "Layout, Copy, And Callouts",
    spec: {
      root: "root",
      elements: {
        root: { type: "Panel", props: { title: "Layout, copy, and callouts", tone: "info" }, children: ["columns", "divider", "callout"] },
        columns: { type: "Stack", props: { direction: "row", gap: "md", align: "stretch" }, children: ["headings", "copy"] },
        headings: { type: "Panel", props: { title: "Heading" }, children: ["h2", "h3", "h4"] },
        h2: { type: "Heading", props: { text: "H2 section", level: "h2" }, children: [] },
        h3: { type: "Heading", props: { text: "H3 section", level: "h3" }, children: [] },
        h4: { type: "Heading", props: { text: "H4 section", level: "h4" }, children: [] },
        copy: { type: "Panel", props: { title: "Text" }, children: ["text"] },
        text: { type: "Text", props: { text: "Text renders real wrapped body copy with tone and size controls. It is for readable agent output, not raw JSON display.", tone: "default" }, children: [] },
        divider: { type: "Divider", props: {}, children: [] },
        callout: { type: "Callout", props: { title: "Callout", body: "Use Callout for important notices, warnings, result summaries, or next actions.", tone: "warning" }, children: [] },
      },
    },
  },
  {
    title: "Metrics, Progress, And Badges",
    spec: {
      root: "root",
      elements: {
        root: { type: "Panel", props: { title: "Metrics, progress, and badges", tone: "success" }, children: ["metrics", "progress", "badges"] },
        metrics: { type: "Stack", props: { direction: "row", gap: "sm", align: "stretch" }, children: ["tasks", "latency", "risk"] },
        tasks: { type: "Metric", props: { label: "Tasks", value: "12", detail: "8 done / 4 open", tone: "success" }, children: [] },
        latency: { type: "Metric", props: { label: "Latency", value: "240ms", detail: "p95 response", tone: "info" }, children: [] },
        risk: { type: "Metric", props: { label: "Risk", value: "Medium", detail: "needs review", tone: "warning" }, children: [] },
        progress: { type: "Progress", props: { label: "Implementation readiness", value: 76, detail: "Progress renders as a real bar component.", tone: "success" }, children: [] },
        badges: { type: "Stack", props: { direction: "row", gap: "xs" }, children: ["default", "info", "success", "warning", "danger"] },
        default: { type: "Badge", props: { label: "default" }, children: [] },
        info: { type: "Badge", props: { label: "info", tone: "info" }, children: [] },
        success: { type: "Badge", props: { label: "success", tone: "success" }, children: [] },
        warning: { type: "Badge", props: { label: "warning", tone: "warning" }, children: [] },
        danger: { type: "Badge", props: { label: "danger", tone: "danger" }, children: [] },
      },
    },
  },
  {
    title: "Structured Data",
    spec: {
      root: "root",
      elements: {
        root: { type: "Panel", props: { title: "Structured data", tone: "default" }, children: ["facts", "table"] },
        facts: {
          type: "KeyValueList",
          props: {
            items: [
              { label: "Spec", value: "flat root + elements map", tone: "info" },
              { label: "Validation", value: "component type and child id checks", tone: "success" },
              { label: "Fallback", value: "bad specs remain plain text", tone: "warning" },
            ],
          },
          children: [],
        },
        table: {
          type: "DataTable",
          props: {
            caption: "DataTable example",
            columns: [
              { key: "component", label: "Component" },
              { key: "use", label: "Use" },
              { key: "safe", label: "Safe?", align: "right" },
            ],
            rows: [
              { component: "DataTable", use: "records", safe: "yes" },
              { component: "KeyValueList", use: "facts", safe: "yes" },
              { component: "Progress", use: "status", safe: "yes" },
            ],
          },
          children: [],
        },
      },
    },
  },
  {
    title: "Code, Lists, And Actions",
    spec: {
      root: "root",
      elements: {
        root: { type: "Panel", props: { title: "Code, lists, and actions", tone: "info" }, children: ["code", "list", "actions"] },
        code: { type: "CodeBlock", props: { language: "json-render", code: "{\n  \"type\": \"DataTable\",\n  \"props\": { \"columns\": [], \"rows\": [] }\n}" }, children: [] },
        list: {
          type: "List",
          props: {
            title: "List component",
            ordered: true,
            items: [
              { label: "Render useful UI", detail: "not raw markdown tables" },
              { label: "Keep actions guarded", detail: "safe link/copy only" },
              { label: "Fallback cleanly", detail: "malformed specs stay text" },
            ],
          },
          children: [],
        },
        actions: { type: "Stack", props: { direction: "row", gap: "sm" }, children: ["copy", "repo"] },
        copy: { type: "Button", props: { label: "Copy component list", copyText: "Stack, Panel, Heading, Text, Metric, Badge, Button, Divider, Callout, KeyValueList, DataTable, CodeBlock, Progress, List", variant: "primary" }, children: [] },
        repo: { type: "Button", props: { label: "Open upstream repo", url: "https://github.com/vercel-labs/json-render", variant: "secondary" }, children: [] },
      },
    },
  },
  {
    title: "State, Computed Values, And Watchers",
    spec: {
      root: "root",
      state: { score: 74, enabled: true, dialogOpen: false },
      elements: {
        root: { type: "Panel", props: { title: "State, computed values, and watchers", tone: "info" }, children: ["controls", "summary", "actions", "dialog"] },
        controls: { type: "Stack", props: { direction: "vertical", gap: "md" }, children: ["enabled", "score"] },
        enabled: { type: "Switch", props: { label: "Enabled", checked: { $bindState: "/enabled" } }, children: [] },
        score: {
          type: "Slider",
          props: { label: "Score", min: 0, max: 100, value: { $bindState: "/score" } },
          watch: {
            "/score": { action: "emit", params: { event: "scoreChanged", value: { $state: "/score" } } },
          },
          children: [],
        },
        summary: {
          type: "Metric",
          props: {
            label: "Computed average",
            value: { $format: "number", value: { $computed: "average", args: { values: [{ $state: "/score" }, 100] } } },
            detail: { $cond: { $state: "/enabled" }, $then: "Visible while enabled", $else: "Disabled locally" },
            tone: { $cond: { $state: "/score", gte: 70 }, $then: "success", $else: "warning" },
          },
          visible: { $or: [{ $state: "/enabled" }, { $state: "/score", gte: 90 }] },
          children: [],
        },
        actions: { type: "Stack", props: { direction: "row", gap: "sm" }, children: ["openDialog", "copyState"] },
        openDialog: {
          type: "Button",
          props: { label: "Open dialog", variant: "secondary" },
          on: { press: { action: "setState", params: { path: "/dialogOpen", value: true } } },
          children: [],
        },
        copyState: {
          type: "Button",
          props: { label: "Copy score", copyText: { $template: "Score: ${/score}" }, variant: "primary" },
          children: [],
        },
        dialog: {
          type: "Dialog",
          props: { openPath: "/dialogOpen", title: "State changed", description: { $template: "Current score is ${/score}." } },
          children: ["close"],
        },
        close: {
          type: "Button",
          props: { label: "Close", variant: "secondary" },
          on: { press: { action: "setState", params: { path: "/dialogOpen", value: false } } },
          children: [],
        },
      },
    },
  },
  {
    title: "Charts",
    spec: {
      root: "root",
      elements: {
        root: { type: "Panel", props: { title: "Charts", tone: "default" }, children: ["grid"] },
        grid: { type: "Grid", props: { columns: 2, gap: "md" }, children: ["bars", "line", "pie", "area"] },
        bars: { type: "Chart", props: { type: "bar", title: "Requests by day", data: [{ label: "Mon", value: 120 }, { label: "Tue", value: 200 }, { label: "Wed", value: 150 }, { label: "Thu", value: 280 }, { label: "Fri", value: 240 }] }, children: [] },
        line: { type: "Chart", props: { type: "line", title: "Valuation (log scale)", logScale: true, valueFormat: "currency", data: [{ label: "2019", value: 31000000 }, { label: "2021", value: 240000000 }, { label: "2023", value: 860000000 }, { label: "2025", value: 2100000000 }] }, children: [] },
        pie: { type: "Chart", props: { type: "donut", title: "Traffic sources", data: [{ label: "Search", value: 52 }, { label: "Direct", value: 28 }, { label: "Social", value: 14 }, { label: "Referral", value: 6 }] }, children: [] },
        area: { type: "Chart", props: { type: "area", title: "Active agents", data: [{ label: "w1", value: 3 }, { label: "w2", value: 6 }, { label: "w3", value: 5 }, { label: "w4", value: 9 }, { label: "w5", value: 12 }] }, children: [] },
      },
    },
  },
  {
    title: "Diagram And Flashcards",
    spec: {
      root: "root",
      elements: {
        root: { type: "Stack", props: { direction: "vertical", gap: "md" }, children: ["diagram", "cards"] },
        diagram: { type: "Diagram", props: { caption: "Division of labor (Adam Smith, Wealth of Nations, ch. 3)", code: "graph TD\n  A[Division of labor] --> B[Limited by market size]\n  B --> C[Water transport widens the market]\n  C --> D[Early civilizations on rivers and coasts]\n  D --> E[More specialization]" }, children: [] },
        cards: { type: "Flashcards", props: { title: "Adam Smith", cards: [{ front: "When was Adam Smith baptized?", back: "16 June 1723" }, { front: "Nationality?", back: "Scottish" }, { front: "Best-known work?", back: "The Wealth of Nations (1776)" }] }, children: [] },
      },
    },
  },
];

export default function JsonRenderCatalogPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-8 text-[var(--foreground)]">
      <div className="mx-auto grid max-w-7xl gap-6">
        <header className="grid gap-2">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">json-render catalog</p>
          <h1 className="m-0 text-3xl font-semibold leading-tight">Rendered Component Gallery</h1>
          <p className="m-0 max-w-3xl text-sm leading-6 text-[var(--text-soft)]">
            Every card below is rendered through the same guarded HivemindOS json-render registry used by chat.
          </p>
        </header>
        <section className="grid gap-4 lg:grid-cols-2">
          {catalogSpecs.map((item) => (
            <article key={item.title} className="grid gap-2">
              <h2 className="m-0 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">{item.title}</h2>
              <JsonRenderSurface value={item.spec} className="m-0 h-full" />
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
