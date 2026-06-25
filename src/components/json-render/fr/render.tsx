"use client";

/* jsonui/render.tsx — a compact, dependency-free renderer for the json-render
   (vercel-labs) wire format. Implements the flat spec ({ root, elements, state }),
   the dynamic value forms ($state / $cond / $template / $bindState), `visible`
   conditions, the setState action, and per-element event handlers.

   If you've installed @json-render/react + @json-render/shadcn, you can throw
   this away and pass REGISTRY (see ./registry) to their <Renderer> instead —
   the component names + props match the shadcn catalog 1:1. This local renderer
   exists so the drop-in works with zero extra dependencies. */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";

// ---- types ----------------------------------------------------------------
export type StateModel = Record<string, unknown>;
export type Handler = { action: string; params?: Record<string, unknown> };
export type Cond =
  | { $state: string; eq?: unknown; neq?: unknown; gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown; not?: boolean }
  | { $and: Cond[] }
  | { $or: Cond[] }
  | boolean;
export type ComputedFunctions = Record<string, (args: Record<string, unknown>, state: StateModel) => unknown>;

export interface JREl {
  type: string;
  props?: Record<string, unknown>;
  children?: string[];
  on?: Record<string, Handler | Handler[]>;
  visible?: Cond | Cond[];
  watch?: Record<string, Handler | Handler[]>;
}
export interface Spec { root: string; elements: Record<string, JREl>; state?: StateModel; }

export interface St { state: StateModel; get: (p: string) => unknown; set: (p: string, v: unknown) => void; }
export type OnAction = (name: string, params: Record<string, unknown>, payload?: unknown) => void;
const EMPTY_FUNCTIONS: ComputedFunctions = {};
const NOOP_ACTION: OnAction = () => undefined;

export interface CompProps {
  props: Record<string, unknown>;
  bind: Record<string, string>;
  emit: (event: string, payload?: unknown) => void;
  st: St;
  element: JREl;
  onAction: OnAction;
  children?: ReactNode;
}
export type FrComp = (p: CompProps) => JSX.Element | null;
export type Registry = Record<string, FrComp>;

// ---- state model (JSON-pointer-ish "/a/b" paths) --------------------------
export function frGetPath(obj: unknown, path?: string): unknown {
  if (path == null) return undefined;
  const parts = String(path).split("/").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) { if (cur == null) return undefined; cur = (cur as Record<string, unknown>)[p]; }
  return cur;
}
export function frSetPath(obj: unknown, path: string, value: unknown): unknown {
  const parts = String(path).split("/").filter(Boolean);
  if (!parts.length) return obj;
  const root: Record<string, unknown> = Array.isArray(obj) ? (obj.slice() as unknown as Record<string, unknown>) : { ...(obj as Record<string, unknown>) };
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]; const nx = cur[p];
    cur[p] = Array.isArray(nx) ? nx.slice() : { ...(nx as Record<string, unknown> || {}) };
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return root;
}

// ---- dynamic value resolution ---------------------------------------------
function frResolveComparable(v: unknown, st: St, functions: ComputedFunctions = {}): unknown {
  if (v && typeof v === "object" && !Array.isArray(v) && "$state" in (v as Record<string, unknown>)) {
    return st.get((v as { $state: string }).$state);
  }
  return frResolve(v, st, functions);
}

function frCompare(left: unknown, right: unknown, op: "gt" | "gte" | "lt" | "lte") {
  if (typeof left !== "number" || typeof right !== "number") return false;
  if (op === "gt") return left > right;
  if (op === "gte") return left >= right;
  if (op === "lt") return left < right;
  return left <= right;
}

export function frEvalCond(c: Cond, st: St): boolean {
  if (c == null) return false;
  if (typeof c !== "object") return !!c;
  if ("$and" in c) return c.$and.every((child) => frEvalCond(child, st));
  if ("$or" in c) return c.$or.some((child) => frEvalCond(child, st));
  if ("$state" in c) {
    const val = st.get(c.$state);
    if ("eq" in c) return val === frResolveComparable(c.eq, st);
    if ("neq" in c) return val !== frResolveComparable(c.neq, st);
    if ("gt" in c) return frCompare(val, frResolveComparable(c.gt, st), "gt");
    if ("gte" in c) return frCompare(val, frResolveComparable(c.gte, st), "gte");
    if ("lt" in c) return frCompare(val, frResolveComparable(c.lt, st), "lt");
    if ("lte" in c) return frCompare(val, frResolveComparable(c.lte, st), "lte");
    let t = Array.isArray(val) ? val.length > 0 : !!val;
    if (c.not) t = !t;
    return t;
  }
  return false;
}

function frFormat(value: unknown, format: unknown, raw: Record<string, unknown>) {
  const locale = typeof raw.locale === "string" ? raw.locale : undefined;
  if (format === "currency") {
    const currency = typeof raw.currency === "string" ? raw.currency : "USD";
    const amount = typeof value === "number" ? value : Number(value);
    return Number.isFinite(amount) ? new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount) : String(value ?? "");
  }
  if (format === "percent") {
    const amount = typeof value === "number" ? value : Number(value);
    return Number.isFinite(amount) ? new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(amount) : String(value ?? "");
  }
  if (format === "number") {
    const amount = typeof value === "number" ? value : Number(value);
    return Number.isFinite(amount) ? new Intl.NumberFormat(locale).format(amount) : String(value ?? "");
  }
  if (format === "date") {
    const date = value instanceof Date ? value : new Date(String(value ?? ""));
    const options: Intl.DateTimeFormatOptions = { dateStyle: "medium" };
    if (raw.timeStyle) options.timeStyle = "short";
    return Number.isNaN(date.valueOf()) ? String(value ?? "") : new Intl.DateTimeFormat(locale, options).format(date);
  }
  return String(value ?? "");
}

function frResolveDirective(raw: Record<string, unknown>, st: St, functions: ComputedFunctions) {
  if ("$format" in raw) return frFormat(frResolve(raw.value, st, functions), raw.$format, raw);
  if ("$concat" in raw) {
    const parts = Array.isArray(raw.$concat) ? raw.$concat : [];
    return parts.map((part) => String(frResolve(part, st, functions) ?? "")).join("");
  }
  if ("$count" in raw) {
    const value = frResolve(raw.$count, st, functions);
    if (Array.isArray(value) || typeof value === "string") return value.length;
    if (value && typeof value === "object") return Object.keys(value).length;
    return 0;
  }
  if ("$truncate" in raw) {
    const text = String(frResolve(raw.$truncate, st, functions) ?? "");
    const length = typeof raw.length === "number" ? raw.length : 80;
    return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}...` : text;
  }
  if ("$pluralize" in raw) {
    const count = Number(frResolve(raw.$pluralize, st, functions) ?? 0);
    const singular = String(raw.singular ?? "");
    const plural = String(raw.plural ?? `${singular}s`);
    return count === 1 ? singular : plural;
  }
  if ("$join" in raw) {
    const value = frResolve(raw.$join, st, functions);
    const separator = typeof raw.separator === "string" ? raw.separator : ", ";
    return Array.isArray(value) ? value.map((item) => String(item ?? "")).join(separator) : String(value ?? "");
  }
  if ("$t" in raw) {
    let text = String(raw.$t ?? "");
    const values = raw.values && typeof raw.values === "object" && !Array.isArray(raw.values) ? raw.values as Record<string, unknown> : {};
    for (const [key, value] of Object.entries(values)) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`\\{${escapedKey}\\}`, "g"), String(frResolve(value, st, functions) ?? ""));
    }
    return text;
  }
  if ("$math" in raw) {
    const values = Array.isArray(raw.values) ? raw.values.map((item) => Number(frResolve(item, st, functions))) : [];
    const finiteValues = values.filter(Number.isFinite);
    if (raw.$math === "sum") return finiteValues.reduce((sum, value) => sum + value, 0);
    if (raw.$math === "avg" || raw.$math === "average") return finiteValues.length ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length : 0;
    if (raw.$math === "min") return finiteValues.length ? Math.min(...finiteValues) : 0;
    if (raw.$math === "max") return finiteValues.length ? Math.max(...finiteValues) : 0;
  }
  return undefined;
}

export function frResolve(v: unknown, st: St, functions: ComputedFunctions = {}): unknown {
  if (v == null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => frResolve(x, st, functions));
  const o = v as Record<string, unknown>;
  if ("$state" in o) return st.get(o.$state as string);
  if ("$bindState" in o) return st.get(o.$bindState as string);
  if ("$cond" in o) return frEvalCond(o.$cond as Cond, st) ? frResolve(o.$then, st, functions) : frResolve(o.$else, st, functions);
  if ("$computed" in o) {
    const name = String(o.$computed ?? "");
    const fn = functions[name];
    const rawArgs = o.args && typeof o.args === "object" && !Array.isArray(o.args) ? o.args as Record<string, unknown> : {};
    const args: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawArgs)) args[key] = frResolve(value, st, functions);
    return fn ? fn(args, st.state) : undefined;
  }
  if ("$template" in o) return String(o.$template).replace(/\$\{([^}]+)\}/g, (_m, p) => { const val = st.get(p.trim()); return val == null ? "" : String(val); });
  const directiveValue = frResolveDirective(o, st, functions);
  if (directiveValue !== undefined) return directiveValue;
  const out: Record<string, unknown> = {}; for (const k in o) out[k] = frResolve(o[k], st, functions); return out;
}
export function frVisible(cond: Cond | Cond[] | undefined, st: St): boolean {
  if (!cond) return true;
  const arr = Array.isArray(cond) ? cond : [cond];
  return arr.every((c) => frEvalCond(c, st));
}

// ---- props + bindings -----------------------------------------------------
function frResolveProps(raw: Record<string, unknown> | undefined, st: St, functions: ComputedFunctions) {
  const props: Record<string, unknown> = {}, bind: Record<string, string> = {};
  for (const k in (raw || {})) {
    const v = (raw as Record<string, unknown>)[k];
    if (v && typeof v === "object" && !Array.isArray(v) && "$bindState" in (v as object)) {
      bind[k] = (v as { $bindState: string }).$bindState; props[k] = st.get(bind[k]);
    } else props[k] = frResolve(v, st, functions);
  }
  return { props, bind };
}

// ---- event handlers -------------------------------------------------------
function frRunHandler(handler: Handler | Handler[] | undefined, payload: unknown, st: St, onAction: OnAction, functions: ComputedFunctions = {}) {
  if (!handler) return;
  (Array.isArray(handler) ? handler : [handler]).forEach((h) => {
    if (!h) return;
    if (h.action === "setState") {
      const p = (h.params && (h.params.statePath || h.params.path)) as string | undefined;
      let val: unknown = h.params ? h.params.value : undefined;
      if (val && typeof val === "object" && (val as Record<string, unknown>).$payload) val = payload;
      else if (val === "$payload") val = payload;
      else val = frResolve(val, st, functions);
      if (p != null) st.set(p, val);
    } else if (h.action) onAction(h.action, (frResolve(h.params || {}, st, functions)) as Record<string, unknown>, payload);
  });
}

// ---- context + walker -----------------------------------------------------
interface Ctx { st: St; elements: Record<string, JREl>; registry: Registry; onAction: OnAction; functions: ComputedFunctions; }
const FrJsonCtx = createContext<Ctx | null>(null);

export function FrEl({ id }: { id: string }) {
  const ctx = useContext(FrJsonCtx)!;
  const el = ctx.elements[id];
  if (!el) return null;
  if (!frVisible(el.visible, ctx.st)) return null;
  const Comp = ctx.registry[el.type];
  const { props, bind } = frResolveProps(el.props, ctx.st, ctx.functions);
  const children = (el.children || []).map((cid) => <FrEl key={cid} id={cid} />);
  const emit = (event: string, payload?: unknown) => frRunHandler(el.on && el.on[event], payload, ctx.st, ctx.onAction, ctx.functions);
  if (!Comp) return <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--danger)" }}>⚠ unknown component: {el.type}</div>;
  return <Comp props={props} bind={bind} emit={emit} st={ctx.st} element={el} onAction={ctx.onAction}>{children}</Comp>;
}

// ---- public renderer ------------------------------------------------------
function collectWatchers(elements: Record<string, JREl>) {
  return Object.values(elements).flatMap((element) => Object.entries(element.watch ?? {}).map(([path, handler]) => ({ path, handler })));
}

export function FrJsonRender({ spec, registry, onAction, functions }: { spec: Spec; registry: Registry; onAction?: OnAction; functions?: ComputedFunctions }) {
  const [state, setState] = useState<StateModel>(() => JSON.parse(JSON.stringify(spec.state || {})));
  const activeFunctions = functions ?? EMPTY_FUNCTIONS;
  const previousStateRef = useRef<StateModel | null>(null);
  const watchers = useMemo(() => collectWatchers(spec.elements), [spec.elements]);
  const st = useMemo<St>(() => ({
    state,
    get: (p) => frGetPath(state, p),
    set: (p, v) => setState((s) => frSetPath(s, p, v) as StateModel),
  }), [state]);
  const safeOnAction = onAction || NOOP_ACTION;
  useEffect(() => {
    const previous = previousStateRef.current;
    previousStateRef.current = state;
    if (!previous || !watchers.length) return;
    for (const watcher of watchers) {
      const before = frGetPath(previous, watcher.path);
      const after = frGetPath(state, watcher.path);
      if (Object.is(before, after)) continue;
      frRunHandler(watcher.handler, { path: watcher.path, previous: before, value: after }, st, safeOnAction, activeFunctions);
    }
  }, [activeFunctions, safeOnAction, st, state, watchers]);
  const ctx = useMemo<Ctx>(() => ({ st, elements: spec.elements, registry, onAction: safeOnAction, functions: activeFunctions }), [st, spec, registry, safeOnAction, activeFunctions]);
  return <FrJsonCtx.Provider value={ctx}><FrEl id={spec.root} /></FrJsonCtx.Provider>;
}

// ---- helpers shared by the component files --------------------------------
export function useFrBound<T>(bind: Record<string, string>, key: string, st: St, fallback: T): [T, (v: T) => void, boolean] {
  const bound = bind && bind[key] != null;
  const [local, setLocal] = useState<T>(fallback);
  const value = (bound ? st.get(bind[key]) : local) as T;
  const setValue = (v: T) => { if (bound) st.set(bind[key], v); else setLocal(v); };
  return [value == null ? fallback : value, setValue, bound];
}

export const FR_GAP: Record<string, number> = { none: 0, xs: 4, sm: 6, md: 12, lg: 18, xl: 26 };
export const FR_ALIGN: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
export const FR_JUSTIFY: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around" };

export function FrPlaceholder({ label, h = 140 }: { label: string; h?: number }) {
  return (
    <div style={{ height: h, borderRadius: "var(--radius-sm)", border: "1px solid var(--line-2)", display: "grid", placeItems: "center", overflow: "hidden", backgroundImage: "repeating-linear-gradient(135deg, var(--panel-2) 0 10px, var(--panel) 10px 20px)" }}>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", letterSpacing: "0.06em" }}>{label}</span>
    </div>
  );
}
