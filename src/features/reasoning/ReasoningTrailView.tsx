"use client";

import React, { type CSSProperties } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReasoningTrail } from "@/lib/types/reasoning-trail";
import { REASONING_TRAIL_FIELD_LABELS } from "@/lib/types/reasoning-trail";

type ReasoningTrailTone = "approval" | "issue";

type ToneTokens = {
  border: string;
  background: string;
  foreground: string;
  body: string;
  muted: string;
  label: string;
  evidence: string;
  danger: string;
  mono: string;
};

const TONES: Record<ReasoningTrailTone, ToneTokens> = {
  approval: {
    border: "color-mix(in srgb, var(--rc) 22%, var(--ap-line-2))",
    background: "color-mix(in srgb, var(--rc-soft) 42%, transparent)",
    foreground: "var(--ap-fg)",
    body: "var(--ap-fg-2)",
    muted: "var(--ap-fg-4)",
    label: "var(--rc)",
    evidence: "var(--ap-fg-3)",
    danger: "var(--ap-danger)",
    mono: "var(--ap-mono)",
  },
  issue: {
    border: "color-mix(in srgb, var(--honey) 26%, var(--line))",
    background: "color-mix(in srgb, var(--honey) 7%, var(--bg-2))",
    foreground: "var(--fg)",
    body: "var(--fg-2)",
    muted: "var(--fg-4)",
    label: "var(--honey-2)",
    evidence: "var(--fg-3)",
    danger: "var(--danger-2)",
    mono: "var(--f-mono)",
  },
};

export function ReasoningTrailView({
  trail,
  compact = false,
  tone = "issue",
}: {
  trail?: ReasoningTrail;
  compact?: boolean;
  tone?: ReasoningTrailTone;
}) {
  if (!trail) return null;
  const tokens = TONES[tone];
  const evidence = trail.evidence.slice(0, compact ? 4 : 8);
  const missing = (trail.missingContext ?? []).slice(0, compact ? 3 : 6);
  const nextSteps = (trail.nextSteps ?? []).slice(0, compact ? 3 : 5);
  return (
    <section aria-label="Reasoning trail" style={rootStyle(tokens, compact)}>
      <div style={headerStyle}>
        <span style={labelStyle(tokens)}>reasoning trail</span>
        {trail.source ? <span style={sourceStyle(tokens)}>{trail.source}</span> : null}
      </div>
      <p style={headlineStyle(tokens, compact)}>{trail.headline}</p>
      <dl style={gridStyle}>
        <TrailDefinition label={REASONING_TRAIL_FIELD_LABELS.summary} value={trail.summary} tokens={tokens} />
        <TrailDefinition label={REASONING_TRAIL_FIELD_LABELS.whyNow} value={trail.whyNow} tokens={tokens} />
        {trail.impact ? <TrailDefinition label={REASONING_TRAIL_FIELD_LABELS.impact} value={trail.impact} tokens={tokens} /> : null}
        {trail.requestedAction ? <TrailDefinition label={REASONING_TRAIL_FIELD_LABELS.requestedAction} value={trail.requestedAction} tokens={tokens} /> : null}
      </dl>
      {evidence.length ? <TrailList label={REASONING_TRAIL_FIELD_LABELS.evidence} items={evidence} tokens={tokens} /> : null}
      {missing.length ? <TrailList label={REASONING_TRAIL_FIELD_LABELS.missingContext} items={missing} tokens={tokens} danger /> : null}
      {nextSteps.length ? <TrailList label={REASONING_TRAIL_FIELD_LABELS.nextSteps} items={nextSteps} tokens={tokens} /> : null}
    </section>
  );
}

function TrailDefinition({ label, value, tokens }: {
  label: string;
  value: string;
  tokens: ToneTokens;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt style={smallLabelStyle(tokens)}>{label}</dt>
      <dd style={bodyStyle(tokens)}>{value}</dd>
    </div>
  );
}

function TrailList({ label, items, tokens, danger = false }: {
  label: string;
  items: string[];
  tokens: ToneTokens;
  danger?: boolean;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={smallLabelStyle(tokens)}>{label}</div>
      <ul style={listStyle}>
        {items.map((item) => (
          <li key={item} style={listItemStyle(tokens, danger)}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function rootStyle(tokens: ToneTokens, compact: boolean): CSSProperties {
  return {
    border: `1px solid ${tokens.border}`,
    borderRadius: compact ? 9 : 10,
    background: tokens.background,
    padding: compact ? "8px 9px" : "10px 11px",
    display: "flex",
    flexDirection: "column",
    gap: compact ? 7 : 8,
    minWidth: 0,
  };
}

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  flexWrap: "wrap",
};

function labelStyle(tokens: ToneTokens): CSSProperties {
  return {
    fontFamily: tokens.mono,
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: tokens.label,
  };
}

function sourceStyle(tokens: ToneTokens): CSSProperties {
  return {
    fontFamily: tokens.mono,
    fontSize: 9.5,
    color: tokens.muted,
    overflowWrap: "anywhere",
  };
}

function headlineStyle(tokens: ToneTokens, compact: boolean): CSSProperties {
  return {
    margin: 0,
    color: tokens.foreground,
    fontSize: compact ? 11.5 : 12.5,
    lineHeight: 1.45,
    fontWeight: 600,
    overflowWrap: "anywhere",
  };
}

const gridStyle: CSSProperties = {
  margin: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: 6,
};

function smallLabelStyle(tokens: ToneTokens): CSSProperties {
  return {
    margin: "0 0 2px",
    fontFamily: tokens.mono,
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: tokens.muted,
  };
}

function bodyStyle(tokens: ToneTokens): CSSProperties {
  return {
    margin: 0,
    color: tokens.body,
    fontSize: 11.5,
    lineHeight: 1.45,
    overflowWrap: "anywhere",
  };
}

const listStyle: CSSProperties = {
  margin: "4px 0 0",
  paddingLeft: 16,
  display: "flex",
  flexDirection: "column",
  gap: 3,
};

function listItemStyle(tokens: ToneTokens, danger: boolean): CSSProperties {
  return {
    fontFamily: tokens.mono,
    fontSize: 10.5,
    lineHeight: 1.45,
    color: danger ? tokens.danger : tokens.evidence,
    overflowWrap: "anywhere",
  };
}

/**
 * The reasoning trail folded behind a subtle toggle. A card already surfaces the
 * essential ask/reason and the buttons to act; this keeps the full operator-note
 * detail (why now, impact, evidence, missing context) one click away instead of
 * letting it dominate every card. Collapsed by default.
 */
export function CollapsibleReasoningTrail({
  trail,
  tone = "issue",
  label = "Why this is here",
  defaultOpen = false,
}: {
  trail?: ReasoningTrail;
  tone?: ReasoningTrailTone;
  label?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (!trail) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: open ? 7 : 0, minWidth: 0 }}>
      <button
        type="button"
        className="zhc-btn-ghost"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          alignSelf: "flex-start",
          cursor: "pointer",
          borderRadius: 7,
          padding: "3px 8px 3px 5px",
          font: "inherit",
          fontFamily: "var(--f-mono)",
          fontSize: 10,
          letterSpacing: "0.03em",
          border: "1px solid transparent",
          background: "transparent",
          color: "var(--fg-4)",
        }}
      >
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        {open ? "Hide reasoning" : label}
      </button>
      {open ? <ReasoningTrailView trail={trail} tone={tone} compact /> : null}
    </div>
  );
}
