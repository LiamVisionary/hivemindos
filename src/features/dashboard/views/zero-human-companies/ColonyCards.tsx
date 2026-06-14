"use client";
// Zero Human Companies — portfolio overview: detailed + minimal colony cards.
import React from "react";
import { STATUS_TONE } from "./data";
import { Ring, StatusPill, RoleGlyph, CardLabel } from "./primitives";
import type { CardStyle, Colony, Density } from "./types";

interface CardProps {
  colony: Colony;
  density: Density;
  showBudget: boolean;
  onOpen: (id: string) => void;
}

export function ColonyCard({ colony: c, density, showBudget, onOpen }: CardProps) {
  const [hover, setHover] = React.useState(false);
  const fresh = c.status === "setup";
  const alignColor = fresh ? "var(--fg-3)" : c.alignment >= 75 ? "var(--cyan)" : c.alignment >= 55 ? "var(--honey-2)" : "var(--danger)";
  const pad = density === "compact" ? 22 : 28;
  const gap = density === "compact" ? 20 : 26;
  const burnPct = c.burn.cap > 0 ? Math.min(100, Math.round((c.burn.today / c.burn.cap) * 100)) : 0;
  const burnColor = burnPct >= 85 ? "var(--danger)" : burnPct >= 65 ? "var(--honey-2)" : "var(--fg-2)";
  const r = c.revenue;
  const isUsers = r && r.kind === "users";
  // when the headline metric IS the apex goal, the ring carries its progress.
  const ringIsMetric = !!(r && r.isApex && r.pct != null);
  const ringPct = ringIsMetric ? (r!.pct as number) : (fresh ? 0 : c.alignment);
  const ringColor = ringIsMetric ? (r!.up ? "var(--cyan)" : "var(--danger)") : alignColor;

  return (
    <div
      onClick={() => onOpen(c.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", cursor: "pointer", borderRadius: 16,
        border: `1px solid ${hover ? "var(--line-2)" : "var(--line)"}`,
        background: "var(--bg-1)", padding: pad,
        transform: hover ? "translateY(-3px)" : "none",
        boxShadow: hover ? "0 18px 44px rgba(0,0,0,0.32)" : "none",
        transition: "transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease",
        display: "flex", flexDirection: "column", gap,
      }}
    >
      {/* header: identity + status */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "var(--f-display)", fontSize: 20, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
        <span style={{ flexShrink: 0, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{c.ticker}</span>
        <span style={{ flex: 1 }} />
        <StatusPill status={c.status} />
      </div>

      {/* apex goal + ring */}
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Ring pct={ringPct} size={66} stroke={5} color={ringColor} track="var(--bg-3)">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--f-display)", fontSize: ringIsMetric ? 17 : 20, fontWeight: 600, lineHeight: 1, color: "var(--fg)" }}>{ringIsMetric ? r!.pct + "%" : (fresh ? "—" : c.alignment)}</div>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 7.5, color: "var(--fg-4)", letterSpacing: 0.1, marginTop: 2 }}>{ringIsMetric ? "GOAL" : "ALIGN"}</div>
          </div>
        </Ring>
        <div style={{ minWidth: 0 }}>
          <CardLabel>apex goal</CardLabel>
          <div style={{ fontSize: 15.5, fontWeight: 500, color: "var(--fg)", lineHeight: 1.4, marginTop: 7, textWrap: "pretty", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.apex.title}</div>
        </div>
      </div>

      {showBudget && (
        <>
          <div style={{ height: 1, background: "var(--line)" }} />
          {/* money moment — headline (revenue or users) is the hero */}
          <div>
            {r && (!fresh || r.isApex) ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                  <CardLabel>{r.label}</CardLabel>
                  <span style={{ flex: 1 }} />
                  {r.delta && (
                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 600, color: r.up ? "var(--cyan-2)" : "var(--danger-2)" }}>
                      {r.up ? "▲" : "▼"} {r.delta}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: "var(--f-display)", fontSize: 32, fontWeight: 600, letterSpacing: -1, color: r.up ? "var(--cyan-2)" : "var(--danger-2)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{r.value}</span>
                  {r.target && (
                    <span style={{ fontFamily: "var(--f-display)", fontSize: 19, fontWeight: 500, color: "var(--fg-2)", fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ color: "var(--fg-4)", fontWeight: 400 }}>/ </span>{r.target}{isUsers ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)" }}> DAU</span> : null}
                    </span>
                  )}
                  {isUsers && r.mau && (
                    <span style={{ marginLeft: "auto", fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-3)", fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ color: "var(--fg-2)", fontWeight: 600 }}>{r.mau}</span> MAU
                    </span>
                  )}
                </div>
              </>
            ) : (
              <CardLabel>{fresh ? "no revenue yet · bootstrapping" : "internal · cost center"}</CardLabel>
            )}

            {/* spend — its own labeled block with a bar */}
            <div style={{ marginTop: r && (!fresh || r.isApex) ? 16 : 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <CardLabel>spend today</CardLabel>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 13.5, fontWeight: 600, color: burnColor, fontVariantNumeric: "tabular-nums" }}>${c.burn.today}</span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 12.5, fontWeight: 600, color: "var(--fg-2)", fontVariantNumeric: "tabular-nums" }}><span style={{ color: "var(--fg-4)", fontWeight: 400 }}>/ </span>{c.burn.cap > 0 ? `$${c.burn.cap}` : "∞"}</span>
                </div>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>runway ~{c.burn.runway}d</span>
              </div>
              <div style={{ height: 4, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden" }}>
                <div style={{ width: burnPct + "%", height: "100%", background: burnColor, transition: "width 500ms ease" }} />
              </div>
            </div>
          </div>
        </>
      )}

      {/* footer: agents + approvals */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: showBudget ? 0 : "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 3 }}>
            {c.agents.slice(0, 5).map((a) => <RoleGlyph key={a.id ?? a.name} role={a.role} size={20} />)}
          </div>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{c.agents.length} agents</span>
        </div>
        {c.approvals.length > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, whiteSpace: "nowrap", fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 600, color: "var(--honey-2)", border: "1px solid color-mix(in srgb, var(--honey) 32%, transparent)", borderRadius: 999, padding: "3px 10px" }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: "var(--honey-2)", flexShrink: 0 }} />
            {c.approvals.length} to approve
          </span>
        )}
      </div>

      <div style={{ position: "absolute", top: pad + 2, right: pad, opacity: hover ? 0.6 : 0, transition: "opacity 160ms ease", fontFamily: "var(--f-mono)", fontSize: 14, color: "var(--fg-2)" }}>→</div>
    </div>
  );
}

/** Minimal card: tall + breathable, few data points. */
export function MinimalColonyCard({ colony: c, density, showBudget, onOpen }: CardProps) {
  const [hover, setHover] = React.useState(false);
  const tone = STATUS_TONE[c.status];
  const fresh = c.status === "setup";
  const compact = density === "compact";
  const alignColor = fresh ? "var(--fg-3)" : c.alignment >= 75 ? "var(--cyan)" : c.alignment >= 55 ? "var(--honey-2)" : "var(--danger)";
  const pad = compact ? 26 : 34;
  const minH = compact ? 300 : 360;
  return (
    <div
      onClick={() => onOpen(c.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", cursor: "pointer", borderRadius: 16, overflow: "hidden",
        border: `1px solid ${hover ? "var(--line-2)" : "var(--line)"}`,
        background: "var(--bg-1)", padding: pad,
        display: "flex", flexDirection: "column", minHeight: minH,
        transform: hover ? "translateY(-3px)" : "none",
        boxShadow: hover ? "0 18px 44px rgba(0,0,0,0.32)" : "none",
        transition: "transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: tone.dot }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: tone.color, textTransform: "uppercase", letterSpacing: 0.1 }}>{tone.label}</span>
        <span style={{ flex: 1 }} />
        {c.approvals.length > 0 && (
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 600, color: "var(--honey-2)", whiteSpace: "nowrap" }}>{c.approvals.length} to approve</span>
        )}
      </div>

      <div style={{ marginTop: compact ? 22 : 30 }}>
        <div style={{ fontFamily: "var(--f-display)", fontSize: compact ? 24 : 28, fontWeight: 600, letterSpacing: -0.7, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)", marginTop: 9, textTransform: "uppercase", letterSpacing: 0.08 }}>{c.ticker} · {c.sector}</div>
      </div>

      <div style={{ flex: 1, minHeight: compact ? 20 : 32 }} />

      <div>
        <div className="mono-cap" style={{ color: "var(--fg-4)", marginBottom: 10 }}>apex goal</div>
        <div style={{ fontSize: compact ? 16 : 18, fontWeight: 500, color: "var(--fg)", lineHeight: 1.45, textWrap: "pretty", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.apex.title}</div>
      </div>

      <div style={{ marginTop: compact ? 22 : 30, paddingTop: compact ? 16 : 20, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 18, fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)", fontVariantNumeric: "tabular-nums" }}>
        <span>{fresh ? "—" : <span style={{ color: alignColor, fontWeight: 600 }}>{c.alignment}%</span>} <span style={{ color: "var(--fg-3)" }}>aligned</span></span>
        <span>{c.agents.length} <span style={{ color: "var(--fg-3)" }}>agents</span></span>
        {showBudget && <span style={{ marginLeft: "auto" }}>${c.burn.today}<span style={{ color: "var(--fg-3)" }}>/day</span></span>}
      </div>

      <div style={{ position: "absolute", top: pad, right: pad, opacity: hover ? 0.5 : 0, transition: "opacity 160ms ease", fontFamily: "var(--f-mono)", fontSize: 14, color: "var(--fg-2)" }}>→</div>
    </div>
  );
}

/** Dashed "found a company" affordance. */
function NewColonyCard({ onClick, minimal }: { onClick: () => void; minimal: boolean }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 14, border: "1.5px dashed var(--line-2)", cursor: "pointer",
        display: "grid", placeItems: "center", minHeight: minimal ? 360 : 220,
        background: hover ? "color-mix(in srgb, var(--honey) 5%, transparent)" : "transparent",
        borderColor: hover ? "color-mix(in srgb, var(--honey) 55%, transparent)" : "var(--line-2)",
        transition: "background 180ms ease, border-color 180ms ease",
      }}
    >
      <div style={{ textAlign: "center", color: hover ? "var(--honey-2)" : "var(--fg-4)", transition: "color 180ms" }}>
        <div style={{ fontSize: 30, fontWeight: 300, lineHeight: 1 }}>+</div>
        <div className="mono-cap" style={{ marginTop: 8 }}>found a company</div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", marginTop: 4 }}>name it, set an Apex goal, staff the crew</div>
      </div>
    </div>
  );
}

export function Portfolio({
  colonies, density, showBudget, onOpen, onCreate, cardStyle, emptyHint,
}: {
  colonies: Colony[]; density: Density; showBudget: boolean;
  onOpen: (id: string) => void; onCreate: () => void; cardStyle: CardStyle;
  emptyHint?: React.ReactNode;
}) {
  const Card = cardStyle === "minimal" ? MinimalColonyCard : ColonyCard;
  const minW = cardStyle === "minimal" ? 320 : 360;
  return (
    <div style={{ padding: "26px 36px 48px" }}>
      {emptyHint}
      <div style={{ display: "grid", gap: cardStyle === "minimal" ? 16 : 18, gridTemplateColumns: `repeat(auto-fill, minmax(${minW}px, 1fr))` }}>
        {colonies.map((c) => <Card key={c.id} colony={c} density={density} showBudget={showBudget} onOpen={onOpen} />)}
        <NewColonyCard onClick={onCreate} minimal={cardStyle === "minimal"} />
      </div>
    </div>
  );
}
