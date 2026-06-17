"use client";

/* jsonui/render.tsx — a compact, dependency-free renderer for the json-render
   (vercel-labs) wire format. Implements the flat spec ({ root, elements, state }),
   the dynamic value forms ($state / $cond / $template / $bindState), `visible`
   conditions, the setState action, and per-element event handlers.

   If you've installed @json-render/react + @json-render/shadcn, you can throw
   this away and pass REGISTRY (see ./registry) to their <Renderer> instead —
   the component names + props match the shadcn catalog 1:1. This local renderer
   exists so the drop-in works with zero extra dependencies. */

import { createContext, useContext, useMemo, useState, type JSX, type ReactNode } from "react";

// ---- types ----------------------------------------------------------------
export type StateModel = Record<string, unknown>;
export type Handler = { action: string; params?: Record<string, unknown> };
export type Cond = { $state: string; eq?: unknown; neq?: unknown; not?: boolean } | boolean;

export interface JREl {
  type: string;
  props?: Record<string, unknown>;
  children?: string[];
  on?: Record<string, Handler | Handler[]>;
  visible?: Cond | Cond[];
}
export interface Spec { root: string; elements: Record<string, JREl>; state?: StateModel; }

export interface St { get: (p: string) => unknown; set: (p: string, v: unknown) => void; }
export type OnAction = (name: string, params: Record<string, unknown>, payload?: unknown) => void;

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
export function frEvalCond(c: Cond, st: St): boolean {
  if (c == null) return false;
  if (typeof c !== "object") return !!c;
  if ("$state" in c) {
    const val = st.get(c.$state);
    if ("eq" in c) return val === c.eq;
    if ("neq" in c) return val !== c.neq;
    let t = Array.isArray(val) ? val.length > 0 : !!val;
    if (c.not) t = !t;
    return t;
  }
  return false;
}
export function frResolve(v: unknown, st: St): unknown {
  if (v == null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => frResolve(x, st));
  const o = v as Record<string, unknown>;
  if ("$state" in o) return st.get(o.$state as string);
  if ("$bindState" in o) return st.get(o.$bindState as string);
  if ("$cond" in o) return frEvalCond(o.$cond as Cond, st) ? frResolve(o.$then, st) : frResolve(o.$else, st);
  if ("$template" in o) return String(o.$template).replace(/\$\{([^}]+)\}/g, (_m, p) => { const val = st.get(p.trim()); return val == null ? "" : String(val); });
  const out: Record<string, unknown> = {}; for (const k in o) out[k] = frResolve(o[k], st); return out;
}
export function frVisible(cond: Cond | Cond[] | undefined, st: St): boolean {
  if (!cond) return true;
  const arr = Array.isArray(cond) ? cond : [cond];
  return arr.every((c) => frEvalCond(c, st));
}

// ---- props + bindings -----------------------------------------------------
function frResolveProps(raw: Record<string, unknown> | undefined, st: St) {
  const props: Record<string, unknown> = {}, bind: Record<string, string> = {};
  for (const k in (raw || {})) {
    const v = (raw as Record<string, unknown>)[k];
    if (v && typeof v === "object" && !Array.isArray(v) && "$bindState" in (v as object)) {
      bind[k] = (v as { $bindState: string }).$bindState; props[k] = st.get(bind[k]);
    } else props[k] = frResolve(v, st);
  }
  return { props, bind };
}

// ---- event handlers -------------------------------------------------------
function frRunHandler(handler: Handler | Handler[] | undefined, payload: unknown, st: St, onAction: OnAction) {
  if (!handler) return;
  (Array.isArray(handler) ? handler : [handler]).forEach((h) => {
    if (!h) return;
    if (h.action === "setState") {
      const p = (h.params && (h.params.statePath || h.params.path)) as string | undefined;
      let val: unknown = h.params ? h.params.value : undefined;
      if (val && typeof val === "object" && (val as Record<string, unknown>).$payload) val = payload;
      else if (val === "$payload") val = payload;
      else val = frResolve(val, st);
      if (p != null) st.set(p, val);
    } else if (h.action) onAction(h.action, (frResolve(h.params || {}, st)) as Record<string, unknown>, payload);
  });
}

// ---- context + walker -----------------------------------------------------
interface Ctx { st: St; elements: Record<string, JREl>; registry: Registry; onAction: OnAction; }
const FrJsonCtx = createContext<Ctx | null>(null);

export function FrEl({ id }: { id: string }) {
  const ctx = useContext(FrJsonCtx)!;
  const el = ctx.elements[id];
  if (!el) return null;
  if (!frVisible(el.visible, ctx.st)) return null;
  const Comp = ctx.registry[el.type];
  const { props, bind } = frResolveProps(el.props, ctx.st);
  const children = (el.children || []).map((cid) => <FrEl key={cid} id={cid} />);
  const emit = (event: string, payload?: unknown) => frRunHandler(el.on && el.on[event], payload, ctx.st, ctx.onAction);
  if (!Comp) return <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--danger)" }}>⚠ unknown component: {el.type}</div>;
  return <Comp props={props} bind={bind} emit={emit} st={ctx.st} element={el} onAction={ctx.onAction}>{children}</Comp>;
}

// ---- public renderer ------------------------------------------------------
export function FrJsonRender({ spec, registry, onAction }: { spec: Spec; registry: Registry; onAction?: OnAction }) {
  const [state, setState] = useState<StateModel>(() => JSON.parse(JSON.stringify(spec.state || {})));
  const st = useMemo<St>(() => ({
    get: (p) => frGetPath(state, p),
    set: (p, v) => setState((s) => frSetPath(s, p, v) as StateModel),
  }), [state]);
  const ctx = useMemo<Ctx>(() => ({ st, elements: spec.elements, registry, onAction: onAction || (() => {}) }), [st, spec, registry, onAction]);
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

export const FR_GAP: Record<string, number> = { none: 0, sm: 6, md: 12, lg: 18, xl: 26 };
export const FR_ALIGN: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
export const FR_JUSTIFY: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around" };

export function FrPlaceholder({ label, h = 140 }: { label: string; h?: number }) {
  return (
    <div style={{ height: h, borderRadius: "var(--radius-sm)", border: "1px solid var(--line-2)", display: "grid", placeItems: "center", overflow: "hidden", backgroundImage: "repeating-linear-gradient(135deg, var(--panel-2) 0 10px, var(--panel) 10px 20px)" }}>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", letterSpacing: "0.06em" }}>{label}</span>
    </div>
  );
}
