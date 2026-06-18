// src/components/swarm/feeds.tsx
"use client";

import * as React from "react";
import { BeeIcon } from "./bee-icon";
import type { SwarmMarket, SwarmSocialPost } from "./swarm-data";
import styles from "./swarm-tokens.module.css";

const panelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", minWidth: 0, borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.16)",
  background: "var(--panel-grad)",
  backdropFilter: "blur(10px) saturate(140%)",
  WebkitBackdropFilter: "blur(10px) saturate(140%)",
  overflow: "hidden",
};

function PanelHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <header className="flex justify-between items-center"
      style={{ gap: 8, padding: "10px 12px", borderBottom: "1px solid rgba(148,163,184,0.16)", flexWrap: "wrap" }}>
      <span className={styles.monoCap} style={{ color: "var(--muted)", minWidth: 0 }}>{title}</span>
      <span className={styles.monoCap} style={{ minWidth: 0 }}>{right}</span>
    </header>
  );
}

export function MarketPanel({ data }: { data: SwarmMarket }) {
  if (!data.ticks.length) {
    return (
      <section style={panelStyle}>
        <PanelHeader title="Market · no price ticks"
          right={<span style={{ color: "var(--muted)" }}>{data.symbol}</span>} />
        <div style={{ padding: "12px", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.5 }}>
          MiroShark did not return market price points for this run.
        </div>
      </section>
    );
  }
  const min = Math.min(...data.ticks);
  const max = Math.max(...data.ticks);
  const w = 280, h = 60;
  const pts = data.ticks.map((v, i) => {
    const x = data.ticks.length === 1 ? w / 2 : (i / (data.ticks.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <section style={panelStyle}>
      <PanelHeader title="Market · live"
        right={<span style={{ color: "var(--hex-active-border)" }}>{data.symbol}</span>} />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 12, padding: "10px 12px 12px" }}>
        <div className="grid" style={{ gap: 8 }}>
          <div style={{ padding: "10px 12px", borderRadius: 7,
            border: "1px solid rgba(148,163,184,0.16)", background: "var(--code-bg)" }}>
            <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
              <polyline points={`0,${h} ${pts} ${w},${h}`} fill="rgba(255,212,90,0.10)" />
              <polyline points={pts} fill="none" stroke="var(--hex-honey-border)" strokeWidth={1.4}
                strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <div className="flex justify-between items-baseline" style={{
              marginTop: 6, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)",
            }}>
              <span>open {data.ticks[0].toFixed(2)}</span>
              <span style={{ color: "var(--hex-honey-border)", fontWeight: 700, fontSize: 14 }}>
                {data.ticks[data.ticks.length - 1].toFixed(2)}
              </span>
              <span>hi {max.toFixed(2)} / lo {min.toFixed(2)}</span>
            </div>
          </div>
        </div>
        <div style={{
          padding: "8px 10px", borderRadius: 7,
          border: "1px solid rgba(148,163,184,0.16)", background: "var(--code-bg)",
          fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--foreground)",
        }}>
          <div className="grid uppercase" style={{
            gridTemplateColumns: "1fr auto 1fr", gap: 8, padding: "0 4px 6px",
            color: "var(--muted)", fontSize: 9, letterSpacing: 0.1,
            borderBottom: "1px solid rgba(148,163,184,0.16)",
          }}>
            <span>bid</span><span>price</span><span style={{ textAlign: "right" }}>ask</span>
          </div>
          {data.ladder.map((r, i) => (
            <div key={i} className="grid items-center" style={{
              gridTemplateColumns: "1fr auto 1fr", gap: 8, padding: "3px 4px",
              background: r.bid && r.bid > 350 ? "rgba(94,234,212,0.06)" : r.ask && r.ask > 350 ? "rgba(251,113,133,0.06)" : "transparent",
            }}>
              <span style={{ color: r.bid ? "var(--hex-active-border)" : "var(--muted)" }}>{r.bid ?? ""}</span>
              <span style={{ color: r.px === 110.20 ? "var(--hex-honey-border)" : "var(--foreground)", fontWeight: 700 }}>
                {r.px.toFixed(2)}
              </span>
              <span style={{ color: r.ask ? "#fecdd3" : "var(--muted)", textAlign: "right" }}>{r.ask ?? ""}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FACTION_COLOR: Record<SwarmSocialPost["faction"], string> = {
  MM:   "var(--hex-honey-border)",
  TKR:  "#fecdd3",
  INFO: "var(--hex-active-border)",
  OPS:  "var(--muted)",
};

export function SocialPanel({ posts }: { posts: SwarmSocialPost[] }) {
  return (
    <section style={panelStyle}>
      <PanelHeader title="Social · live"
        right={<span style={{ color: "var(--muted)" }}>{posts.length} this round</span>} />
      <div className="grid" style={{ gap: 6, padding: "10px 12px 12px" }}>
        {posts.map((p) => (
          <article key={p.id} className="grid items-start" style={{
            gridTemplateColumns: "auto 1fr auto", gap: 10,
            padding: "9px 11px", borderRadius: 8,
            border: "1px solid rgba(148,163,184,0.16)",
            background: "var(--panel-bg-soft)",
          }}>
            <BeeIcon role="worker" size={18} dim={p.faction === "OPS"} />
            <div className="min-w-0">
              <div className="flex items-baseline" style={{ gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                <span style={{
                  fontFamily: "var(--f-display)", fontSize: 11, fontWeight: 700,
                  color: FACTION_COLOR[p.faction],
                }}>{p.who}</span>
                <span className={styles.monoCap} style={{ color: "var(--muted)" }}>{p.faction}</span>
                <span style={{ marginLeft: "auto", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)" }}>
                  {p.t}
                </span>
              </div>
              <div style={{
                fontSize: 12, color: "var(--foreground)", lineHeight: 1.45,
                wordBreak: "break-word", overflowWrap: "anywhere",
              }}>{p.text}</div>
            </div>
            <div className="grid text-right" style={{
              gap: 2, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", minWidth: 28,
            }}>
              <span style={{ color: "var(--hex-active-border)" }}>▲ {p.reacts.up}</span>
              <span style={{ color: "#fecdd3" }}>▼ {p.reacts.down}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function HeadlinesPanel({ headlines }: { headlines: SwarmMarket["headlines"] }) {
  if (!headlines.length) return null;

  return (
    <section style={panelStyle}>
      <PanelHeader title="Headlines · timeline"
        right={<span style={{ color: "var(--muted)" }}>{headlines.length} beats</span>} />
      <div className="grid" style={{ gap: 6, padding: "10px 12px 12px" }}>
        {headlines.map((h, i) => {
          const c = { bear: "#fecdd3", bull: "var(--hex-active-border)", neutral: "var(--hex-honey-border)" }[h.tone];
          return (
            <article key={i} className="grid items-center" style={{
              gridTemplateColumns: "44px 1fr auto", gap: 10,
              padding: "8px 10px", borderRadius: 8,
              border: "1px solid rgba(148,163,184,0.16)",
              background: "var(--panel-bg-soft)",
            }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--muted)" }}>{h.t}</span>
              <span style={{ fontSize: 12, color: "var(--foreground)", lineHeight: 1.4 }}>{h.body}</span>
              <span className={styles.monoCap} style={{ color: c }}>{h.tone}</span>
            </article>
          );
        })}
      </div>
    </section>
  );
}
