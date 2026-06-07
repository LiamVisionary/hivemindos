// src/components/poly-modal/modal-chart.tsx
// Compact survival curve for the modal: crowd price (dashed) vs MiroShark fair
// (solid), gap shaded, best-edge band highlighted.
"use client";

import type { EnrichedRung } from "./poly-data";

export function ModalChart({ rows }: { rows: EnrichedRung[] }) {
  const W = 720, H = 150, padL = 28, padR = 10, padT = 12, padB = 22;
  const asc = [...rows].sort((a, b) => a.t - b.t);
  const x = (t: number) => padL + ((t - 1) / 3) * (W - padL - padR);
  const y = (p: number) => padT + ((100 - p) / 100) * (H - padT - padB);
  const line = (k: "pct" | "sim") =>
    asc.map((r, i) => `${i ? "L" : "M"}${x(r.t).toFixed(1)} ${y(r[k]).toFixed(1)}`).join(" ");
  const band = `${line("pct")} ${[...asc].reverse().map((r) => `L${x(r.t).toFixed(1)} ${y(r.sim).toFixed(1)}`).join(" ")} Z`;
  return (
    <svg className="mm-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Crowd price vs MiroShark fair value across thresholds">
      <rect x={x(1.8)} y={padT} width={x(2.4) - x(1.8)} height={H - padT - padB} fill="rgba(251,113,133,0.07)" />
      {[100, 50, 0].map((g) => (
        <g key={g}>
          <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="rgba(148,163,184,0.1)" strokeWidth="1" />
          <text x={padL - 5} y={y(g) + 3} textAnchor="end" fontFamily="var(--f-mono)" fontSize="8" fill="var(--fg-4)">{g}%</text>
        </g>
      ))}
      {[1, 2, 3, 4].map((g) => (
        <text key={g} x={x(g)} y={H - padB + 14} textAnchor="middle" fontFamily="var(--f-mono)" fontSize="8" fill="var(--fg-4)">${g}T</text>
      ))}
      <path d={band} fill="rgba(251,113,133,0.1)" />
      <path d={line("pct")} fill="none" stroke="var(--pm-mkt)" strokeWidth="1.8" strokeDasharray="4 3" strokeLinejoin="round" />
      <path d={line("sim")} fill="none" stroke="var(--cyan)" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}
