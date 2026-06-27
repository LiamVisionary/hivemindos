"use client";

/* skeletons.tsx — shimmer placeholders shown on first load and on each
   screen / wallet / view switch (respects prefers-reduced-motion via CSS). */

import React from "react";

export function Sk({ w, h, r, style }: { w?: number | string; h?: number | string; r?: number; style?: React.CSSProperties }) {
  return <span className="sk" style={{ width: w, height: h, borderRadius: r != null ? r : 6, ...style }} />;
}

function SkRows({ n, top }: { n: number; top?: boolean }) {
  return (
    <>
      {[...Array(n)].map((_, i) => (
        <div className="sk-row" key={i} style={{ padding: "11px 0", borderTop: i || top ? "1px solid var(--line)" : "none" }}>
          <Sk w={28} h={28} r={9} />
          <div style={{ flex: 1, minWidth: 0 }}><Sk w="55%" h={11} /><Sk w="35%" h={9} style={{ marginTop: 5 }} /></div>
          <Sk w={70} h={12} />
        </div>
      ))}
    </>
  );
}

function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <div className="dk-panel">
      <div className="sk-spread" style={{ marginBottom: 8 }}><Sk w={120} h={15} /><Sk w={58} h={20} r={99} /></div>
      <SkRows n={rows} />
    </div>
  );
}

export function DeskSkeleton() {
  return (
    <>
      <div className="dk-hero" style={{ marginBottom: 16 }}>
        <div className="dk-pf">
          <Sk w={170} h={12} />
          <Sk w={230} h={38} style={{ marginTop: 13 }} />
          <Sk w={150} h={13} style={{ marginTop: 13 }} />
          <Sk w="100%" h={56} style={{ marginTop: 14 }} />
          <Sk w="100%" h={8} r={99} style={{ marginTop: 18 }} />
          <div className="sk-row" style={{ gap: 14, marginTop: 12 }}>{[...Array(5)].map((_, i) => <Sk key={i} w={46} h={10} />)}</div>
        </div>
        <div className="dk-mov">
          <Sk w={120} h={13} /><Sk w={90} h={10} style={{ marginTop: 7 }} />
          <div style={{ marginTop: 8 }}>{[...Array(5)].map((_, i) => (
            <div className="sk-row" key={i} style={{ padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <Sk w={28} h={28} r={99} />
              <div style={{ flex: 1, minWidth: 0 }}><Sk w={56} h={11} /><Sk w={84} h={9} style={{ marginTop: 5 }} /></div>
              <Sk w={70} h={22} r={4} /><Sk w={54} h={12} />
            </div>
          ))}</div>
        </div>
      </div>
      <div className="dk-grid">
        <div className="tk">
          <div className="tk-card">
            <div className="sk-spread" style={{ marginBottom: 14 }}><Sk w={172} h={34} r={99} /><Sk w={56} h={20} r={99} /></div>
            <Sk w="100%" h={94} r={12} />
            <div style={{ display: "flex", justifyContent: "center", margin: "10px 0" }}><Sk w={34} h={34} r={11} /></div>
            <Sk w="100%" h={94} r={12} />
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>{[...Array(4)].map((_, i) => (
              <div className="sk-spread" key={i}><Sk w={92} h={11} /><Sk w={70} h={11} /></div>
            ))}</div>
            <Sk w="100%" h={44} r={99} style={{ marginTop: 16 }} />
          </div>
          <div className="tk-rail">
            <div className="sk-spread" style={{ marginBottom: 14 }}><Sk w={150} h={15} /><Sk w={90} h={20} r={99} /></div>
            <Sk w={70} h={10} style={{ marginBottom: 9 }} />
            <div className="tk-tiles">{[...Array(8)].map((_, i) => <Sk key={i} w="100%" h={84} r={10} />)}</div>
          </div>
        </div>
        <div className="dk-col">
          <PanelSkeleton rows={6} />
          <PanelSkeleton rows={5} />
        </div>
      </div>
    </>
  );
}

export function ActivitySkeleton() {
  return (
    <div className="dk-histwrap">
      <div className="dk-histhead">
        <div className="dk-histtitle"><Sk w={18} h={18} r={5} /><div><Sk w={120} h={20} /><Sk w={160} h={11} style={{ marginTop: 7 }} /></div></div>
        <Sk w={250} h={42} r={99} />
      </div>
      <div className="dk-panel">
        <Sk w={62} h={10} style={{ marginBottom: 6 }} />
        {[...Array(8)].map((_, i) => (
          <div className="sk-row" key={i} style={{ padding: "13px 2px", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <Sk w={34} h={34} r={10} />
            <div style={{ flex: 1, minWidth: 0 }}><Sk w="38%" h={12} /><Sk w="56%" h={9} style={{ marginTop: 6 }} /></div>
            <Sk w={70} h={12} /><Sk w={56} h={20} r={99} />
          </div>
        ))}
      </div>
    </div>
  );
}
