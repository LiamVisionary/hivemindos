"use client";

import * as React from "react";
import { Btn, Card, Eyebrow, Icon, Pill, TONE, type IconName, type Tone, aeonStyles as styles } from "./parts";
import type { AeonDeliverable, DeliverableKind } from "./aeon-data";

const KIND: Record<DeliverableKind, { tone: Tone; icon: IconName }> = {
  verdict: { tone: "cyan", icon: "sparkles" },
  "miroshark-run": { tone: "sky", icon: "layers" },
  posts: { tone: "sky", icon: "msg" },
  json: { tone: "muted", icon: "json" },
};

function sizeLabel(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function DeliverableCard({ d, onSend }: { d: AeonDeliverable; onSend: (d: AeonDeliverable) => void }) {
  const k = KIND[d.kind];
  const facts: [string, string][] = [
    ...(d.sim ? [["Run", d.sim] as [string, string]] : []),
    ["Updated", d.when],
    ...(sizeLabel(d.size) ? [["Size", sizeLabel(d.size)] as [string, string]] : []),
    ["File", d.file],
  ];
  return (
    <article style={{ display: "grid", gridTemplateRows: "auto 1fr auto", gap: 14, padding: 16, borderRadius: 12,
      border: "1px solid var(--line)", background: "linear-gradient(150deg, rgba(10,14,21,0.8), rgba(13,20,31,0.6))", boxShadow: "0 14px 40px rgba(0,0,0,0.18)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span style={{ display: "grid", placeItems: "center", width: 46, height: 46, borderRadius: 11, color: TONE[k.tone].fg, background: TONE[k.tone].bg, border: `1px solid ${TONE[k.tone].bd}` }}>
          <Icon name={k.icon} size={20} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h4 style={{ margin: 0, fontFamily: "var(--f-display)", fontSize: 16, fontWeight: 700, color: "var(--fg)", lineHeight: 1.2 }}>{d.title}</h4>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
            <Pill tone="muted">{d.source === "vault" ? "Vault synced" : d.source === "aeon-output" ? "AEON output" : "Remote"}</Pill>
            <Pill tone="cyan">{d.kind}</Pill>
            {d.status && <Pill tone="green">{d.status}</Pill>}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 11, alignContent: "start" }}>
        <div style={{ padding: 12, borderRadius: 10, background: "var(--aeon-soft)", border: "1px solid rgba(94,234,212,0.14)" }}>
          <div className={styles.monoCap} style={{ color: "var(--cyan-2)" }}>What this is</div>
          <p style={{ margin: "7px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--fg-2)" }}>{d.purpose}</p>
          {d.preview && <p style={{ margin: "10px 0 0", paddingLeft: 11, borderLeft: "2px solid rgba(94,234,212,0.4)", fontSize: 12, lineHeight: 1.5, color: "var(--fg-3)" }}>{d.preview}</p>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {facts.map(([l, v]) => (
            <div key={l} style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(2,6,23,0.3)", border: "1px solid var(--line)" }}>
              <div className={styles.monoCap} style={{ color: "var(--fg-4)" }}>{l}</div>
              <div style={{ fontSize: 11.5, color: "var(--fg-2)", fontFamily: "var(--f-mono)", marginTop: 3, overflowWrap: "anywhere" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <Btn size="sm" variant="primary" icon="external">Open</Btn>
        <Btn size="sm" variant="secondary" icon="folder">Finder</Btn>
        <Btn size="sm" variant="secondary" icon="msg">Chat</Btn>
        {!d.local && <Btn size="sm" variant="secondary" icon="drive">Download</Btn>}
        {d.local && <Btn size="sm" variant="ghost" icon="send" onClick={() => onSend(d)}>To machine</Btn>}
      </div>
    </article>
  );
}

export function AeonDeliverables({ deliverables, onSend }: { deliverables: AeonDeliverable[]; onSend: (d: AeonDeliverable) => void }) {
  const local = deliverables.filter((d) => d.local).length;
  const remote = deliverables.length - local;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card glow style={{ background: "radial-gradient(circle at 10% 16%, var(--aeon-soft), transparent 36%), var(--panel-grad)" }}>
        <div aria-hidden style={{ position: "absolute", insetInline: 0, top: 0, height: 1, background: "linear-gradient(90deg, transparent, rgba(94,234,212,0.6), transparent)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <Eyebrow color="var(--cyan-2)">Deliverables</Eyebrow>
            <h3 style={{ margin: "5px 0 9px", fontFamily: "var(--f-display)", fontSize: 21, fontWeight: 700, color: "var(--fg)" }}>AEON artifact inbox</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Pill tone="cyan">{deliverables.length} deliverables</Pill>
              <Pill tone="muted">{local} on this machine</Pill>
              {remote > 0 && <Pill tone="honey">{remote} remote</Pill>}
            </div>
          </div>
          <Btn variant="secondary" icon="refresh">Refresh</Btn>
        </div>
      </Card>

      <div style={{ display: "grid", gap: 13, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
        {deliverables.map((d) => <DeliverableCard key={d.id} d={d} onSend={onSend} />)}
      </div>
    </div>
  );
}
