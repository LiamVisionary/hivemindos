import { type CompProps, type Registry } from "./render";
import { layoutComponents } from "./Layout";
import { controlComponents } from "./Controls";

/* jsonui/registry.tsx — the full fr-styled catalog: all 36 shadcn components
   keyed by name. Pass this to <FrJsonRender registry={REGISTRY} /> (this
   drop-in's local renderer) OR map it into @json-render/react's defineRegistry
   if you've installed the real packages — the names line up 1:1. */

const tone = (value: unknown) => {
  if (value === "success") return { c: "var(--live)", bg: "var(--live-soft)", br: "color-mix(in srgb, var(--live) 38%, transparent)" };
  if (value === "warning") return { c: "var(--honey)", bg: "var(--honey-soft)", br: "var(--honey-line)" };
  if (value === "danger") return { c: "var(--danger)", bg: "var(--danger-soft)", br: "color-mix(in srgb, var(--danger) 42%, transparent)" };
  if (value === "info") return { c: "var(--honey)", bg: "var(--honey-soft)", br: "var(--honey-line)" };
  if (value === "muted") return { c: "var(--fg-3)", bg: "var(--panel-2)", br: "var(--line-2)" };
  return { c: "var(--fg-2)", bg: "var(--panel)", br: "var(--line)" };
};

const textTone = (value: unknown) => tone(value).c;

const legacyComponents: Registry = {
  Panel({ props, children }: CompProps) {
    const t = tone(props.tone);
    return (
      <section style={{ display: "grid", gap: 12, width: "100%", minWidth: 0, borderRadius: "var(--radius)", border: `1px solid ${t.br}`, background: t.bg, color: "var(--fg)", padding: 16 }}>
        {typeof props.title === "string" && props.title ? <h3 style={{ margin: 0, fontFamily: "var(--f-display)", fontSize: 15, lineHeight: 1.3, fontWeight: 600, letterSpacing: "-0.01em" }}>{props.title}</h3> : null}
        {children}
      </section>
    );
  },
  Divider() {
    return <div style={{ height: 1, width: "100%", background: "var(--line)", margin: "2px 0" }} />;
  },
  Metric({ props }: CompProps) {
    const t = tone(props.tone);
    return (
      <div style={{ display: "grid", gap: 5, minWidth: 144, borderRadius: "var(--radius-sm)", border: `1px solid ${t.br}`, background: t.bg, padding: "10px 12px" }}>
        <span className="fr-eyebrow" style={{ color: "var(--fg-2)", fontWeight: 600 }}>{String(props.label ?? "")}</span>
        <strong style={{ color: "var(--fg)", fontFamily: "var(--f-display)", fontSize: 20, lineHeight: 1.1, fontWeight: 600, wordBreak: "break-word" }}>{String(props.value ?? "")}</strong>
        {props.detail ? <span style={{ color: "var(--fg-2)", fontSize: 12, fontWeight: 500, lineHeight: 1.45 }}>{String(props.detail)}</span> : null}
      </div>
    );
  },
  Callout({ props }: CompProps) {
    const t = tone(props.tone);
    return (
      <aside style={{ display: "grid", gap: 7, borderRadius: "var(--radius-sm)", border: `1px solid ${t.br}`, background: t.bg, padding: "12px 14px", color: t.c }}>
        {props.title ? <strong style={{ color: t.c, fontFamily: "var(--f-display)", fontSize: 13.5 }}>{String(props.title)}</strong> : null}
        <p style={{ margin: 0, color: "var(--fg-2)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{String(props.body ?? "")}</p>
      </aside>
    );
  },
  KeyValueList({ props }: CompProps) {
    const items = Array.isArray(props.items) ? props.items : [];
    return (
      <dl style={{ display: "grid", width: "100%", minWidth: 0, overflow: "hidden", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", margin: 0 }}>
        {items.map((raw, index) => {
          const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
          return (
            <div key={`${String(item.label ?? index)}-${index}`} style={{ display: "grid", gap: 4, borderTop: index ? "1px solid var(--line)" : 0, padding: "9px 12px", gridTemplateColumns: "minmax(7rem,0.45fr) minmax(0,1fr)" }}>
              <dt className="fr-eyebrow">{String(item.label ?? "")}</dt>
              <dd style={{ margin: 0, color: textTone(item.tone), fontSize: 13, lineHeight: 1.45, wordBreak: "break-word" }}>{String(item.value ?? "")}</dd>
            </div>
          );
        })}
      </dl>
    );
  },
  DataTable({ props }: CompProps) {
    const columns = Array.isArray(props.columns) ? props.columns : [];
    const rows = Array.isArray(props.rows) ? props.rows : [];
    return (
      <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
        {props.caption ? <p className="fr-eyebrow" style={{ margin: 0 }}>{String(props.caption)}</p> : null}
        <div className="fr-scroll" style={{ overflowX: "auto", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)" }}>
          <table style={{ width: "100%", minWidth: 420, borderCollapse: "collapse", fontSize: 12.5, textAlign: "left" }}>
            <thead style={{ background: "var(--panel-2)", color: "var(--fg-3)" }}>
              <tr>{columns.map((raw, index) => {
                const column = (raw && typeof raw === "object" ? raw : { key: raw, label: raw }) as Record<string, unknown>;
                return <th key={`${String(column.key ?? index)}-${index}`} style={{ borderBottom: "1px solid var(--line)", padding: "9px 12px", fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: column.align === "right" ? "right" : "left" }}>{String(column.label ?? column.key ?? "")}</th>;
              })}</tr>
            </thead>
            <tbody>{rows.map((rawRow, rowIndex) => {
              const row = rawRow && typeof rawRow === "object" ? rawRow as Record<string, unknown> : {};
              return (
                <tr key={rowIndex}>
                  {columns.map((rawColumn, columnIndex) => {
                    const column = (rawColumn && typeof rawColumn === "object" ? rawColumn : { key: rawColumn }) as Record<string, unknown>;
                    const key = String(column.key ?? columnIndex);
                    const value = row[key];
                    return <td key={`${key}-${columnIndex}`} style={{ borderTop: rowIndex ? "1px solid var(--line)" : 0, color: "var(--fg-2)", padding: "9px 12px", textAlign: column.align === "right" ? "right" : "left", whiteSpace: "nowrap" }}>{value == null ? "" : String(value)}</td>;
                  })}
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </div>
    );
  },
  CodeBlock({ props }: CompProps) {
    return (
      <figure style={{ display: "grid", gap: 7, margin: 0, minWidth: 0 }}>
        {props.language ? <figcaption className="fr-eyebrow">{String(props.language)}</figcaption> : null}
        <pre className="fr-scroll" style={{ margin: 0, maxHeight: 288, overflow: "auto", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--bg-soft)", color: "var(--fg-2)", padding: 12, fontFamily: "var(--f-mono)", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}><code>{String(props.code ?? "")}</code></pre>
      </figure>
    );
  },
  List({ props }: CompProps) {
    const items = Array.isArray(props.items) ? props.items : [];
    const Tag = props.ordered ? "ol" : "ul";
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {props.title ? <strong style={{ color: "var(--fg)", fontSize: 13.5 }}>{String(props.title)}</strong> : null}
        <Tag style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 7, color: "var(--fg-2)", fontSize: 13, lineHeight: 1.5 }}>
          {items.map((raw, index) => {
            const item = (raw && typeof raw === "object" ? raw : { label: raw }) as Record<string, unknown>;
            return <li key={`${String(item.label ?? index)}-${index}`} style={{ color: textTone(item.tone) }}><span style={{ fontWeight: 500 }}>{String(item.label ?? "")}</span>{item.detail ? <span style={{ color: "var(--fg-3)" }}> - {String(item.detail)}</span> : null}</li>;
          })}
        </Tag>
      </div>
    );
  },
};

export const REGISTRY: Registry = { ...layoutComponents, ...legacyComponents, ...controlComponents };

/** The 36 component names this catalog supports, for reference / validation. */
export const CATALOG_COMPONENTS = Object.keys(REGISTRY);
