// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { Bot, BrainCircuit, Phone, PlugZap, Settings2, ShieldCheck } from "lucide-react";

const TEXT_COMMIT_DELAY_MS = 200;

export const PANEL_ICONS: Record<string, ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  role: Bot,
  connection: PlugZap,
  memory: BrainCircuit,
  tools: Settings2,
  calls: Phone,
  security: ShieldCheck,
};

const PANEL_DETAILS: Record<string, string> = {
  role: "Runtime and behaviour",
  connection: "Repo, branch and gateway",
  memory: "Shared brain and folders",
  tools: "Runtime integrations",
  calls: "Scheduled phone calls",
  security: "Guards and redaction",
};

export function titleCaseId(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function panelTitle(panel: string) {
  return titleCaseId(panel || "Settings");
}

export function panelDetail(panel: string) {
  return PANEL_DETAILS[panel] ?? "";
}

export function hasUsePodSetup(config = {}) {
  return Boolean(
    config.depositAddress
      || config.depositCode
      || config.dashboardUrl
      || config.lastBalanceRemaining
      || config.lastRoute
      || config.lastCheckedAt
      || typeof config.lastModelCount === "number",
  );
}

export function isUsePodSetupReady(config = {}) {
  return config.lastTestStatus === "ready";
}

export function hasVeniceSetup(config = {}) {
  return Boolean(
    config.walletVaultId
      || config.walletAddress
      || (config.authMode === "api-key" && config.lastKeyPresent)
      || config.lastTestStatus
      || config.lastCheckedAt
      || typeof config.lastModelCount === "number",
  );
}

export function isVeniceSetupReady(config = {}) {
  return config.lastTestStatus === "ready";
}

function useBufferedTextField<E extends HTMLInputElement | HTMLTextAreaElement>({
  value,
  onChange,
  onBlur,
}: {
  value?: string | number | readonly string[];
  onChange?: React.ChangeEventHandler<E>;
  onBlur?: React.FocusEventHandler<E>;
}) {
  const [draft, setDraft] = useState(value);
  const [lastSeenValue, setLastSeenValue] = useState(value);
  const [hasPendingEdits, setHasPendingEdits] = useState(false);
  const pendingEventRef = useRef<React.ChangeEvent<E> | null>(null);
  const commitTimerRef = useRef(0);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  if (value !== lastSeenValue) {
    setLastSeenValue(value);
    if (!hasPendingEdits) setDraft(value);
  }

  const flush = useCallback(() => {
    window.clearTimeout(commitTimerRef.current);
    const event = pendingEventRef.current;
    pendingEventRef.current = null;
    setHasPendingEdits(false);
    if (event) onChangeRef.current?.(event);
  }, []);

  useEffect(() => flush, [flush]);

  const handleChange = useCallback(
    (event: React.ChangeEvent<E>) => {
      setDraft(event.target.value);
      setHasPendingEdits(true);
      pendingEventRef.current = event;
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = window.setTimeout(flush, TEXT_COMMIT_DELAY_MS);
    },
    [flush],
  );

  const handleBlur = useCallback(
    (event: React.FocusEvent<E>) => {
      flush();
      onBlur?.(event);
    },
    [flush, onBlur],
  );

  if (value === undefined || !onChange) return { value, onChange, onBlur };
  return { value: draft, onChange: handleChange, onBlur: handleBlur };
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const buffered = useBufferedTextField<HTMLInputElement>(props);
  return <input {...props} {...buffered} className={["fb-field", props.className].filter(Boolean).join(" ")} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const buffered = useBufferedTextField<HTMLTextAreaElement>(props);
  return <textarea {...props} {...buffered} className={["fb-textarea", props.className].filter(Boolean).join(" ")} />;
}

export function Btn({ variant = "ghost", sm = false, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "ghost" | "primary"; sm?: boolean }) {
  return (
    <button type="button" className={["fb-btn", variant, sm ? "sm" : "", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </button>
  );
}

export function Badge({ tone, children }: { tone?: "live" | "honey" | "danger" | "plain"; children: ReactNode }) {
  return <span className={["fb-badge", tone].filter(Boolean).join(" ")}>{children}</span>;
}

export function Toggle({ on, onChange }: { on: boolean; onChange?: () => void }) {
  return (
    <button type="button" className="fb-switch" data-on={on || undefined} role="switch" aria-checked={on} onClick={onChange}>
      <span />
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="fb-label">
      <span>{label}{hint ? <small>{hint}</small> : null}</span>
      {children}
    </label>
  );
}

export function PanelHead({ eyebrow, title, sub, action }: { eyebrow: string; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="as-phead as-phead-row">
      <div>
        <span className="fb-eyebrow">{eyebrow}</span>
        <h4>{title}</h4>
        {sub ? <p>{sub}</p> : null}
      </div>
      {action ?? null}
    </div>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="as-group">{children}</div>;
}

function HiveMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="12,1.8 21.2,7 21.2,17 12,22.2 2.8,17 2.8,7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
    </svg>
  );
}

export function AsOrb({ state, iconSrc }: { state: "duty" | "idle" | "working"; iconSrc?: string }) {
  const live = state === "duty" || state === "working";
  return (
    <span className={["as-orb", live ? "live" : ""].filter(Boolean).join(" ")}>
      <span className="ring" />
      <span className="ring r2" />
      {iconSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconSrc} alt="" />
      ) : (
        <HiveMark size={40} />
      )}
    </span>
  );
}

export function iconMark({
  label,
  iconPath,
  iconMode,
  fallback,
}: {
  label: string;
  iconPath?: string;
  iconMode?: string;
  fallback?: string;
}) {
  return (
    <span className="as-icon-mark" aria-hidden="true">
      {iconPath ? (
        <span
          className={iconMode === "mask" ? "mask" : "image"}
          style={iconMode === "mask"
            ? { WebkitMask: `url(${iconPath}) center / contain no-repeat`, mask: `url(${iconPath}) center / contain no-repeat` }
            : { backgroundImage: `url(${iconPath})` }}
        />
      ) : (
        <b>{fallback || label.slice(0, 2).toUpperCase()}</b>
      )}
    </span>
  );
}
