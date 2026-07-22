"use client";

import { useEffect, useState } from "react";
import { Check, Globe2, MapPin, RefreshCcw } from "lucide-react";

import type { MarketplaceResearchJob } from "@/lib/services/marketplace/marketplace-types";

import { LoadingBar, Spinner, ghostButtonStyle } from "./primitives";

/**
 * The "Queen is researching prices" surface: an indeterminate bar, an elapsed
 * timer, and a vertical stage ticker fed by OBSERVED job stages (dispatch →
 * agent claimed → researching → parsing). Announced politely to screen
 * readers; every animation collapses under prefers-reduced-motion (theme.css).
 */

function ElapsedTimer({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const minutes = Math.floor(seconds / 60);
  return (
    <span style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-3)", fontVariantNumeric: "tabular-nums" }}>
      {minutes}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

export function PriceResearchPanel({
  job,
  onRetry,
  onUseManualPrice,
}: {
  job: MarketplaceResearchJob;
  onRetry: () => void;
  onUseManualPrice: () => void;
}) {
  const live = job.status === "dispatching" || job.status === "running";
  const failed = job.status === "failed";
  return (
    <div
      role="status"
      aria-label="Researching comparable prices"
      aria-live="polite"
      style={{ border: "1px solid var(--honey-line)", background: "var(--honey-soft)", borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 13 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: "var(--honey)", display: "inline-flex" }}>
          {job.globalComparison ? <Globe2 aria-hidden width={15} height={15} /> : <MapPin aria-hidden width={15} height={15} />}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {live
            ? job.globalComparison
              ? "The Queen is researching global prices"
              : "The Queen is researching prices near you"
            : failed
              ? "Research did not finish"
              : "Research complete"}
        </span>
        <span style={{ flex: 1 }} />
        {live ? <ElapsedTimer since={job.createdAt} /> : null}
      </div>

      {live ? (
        <>
          <LoadingBar />
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {job.stages.map((stage, index) => {
              const current = !stage.done && index === job.stages.length - 1;
              return (
                <div key={`${stage.label}-${index}`} className="mkt-stage-enter" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 }}>
                  <span style={{ width: 16, display: "inline-grid", placeItems: "center", color: current ? "var(--honey)" : "var(--fg-4)" }}>
                    {current ? <Spinner size={11} /> : <Check aria-hidden width={13} height={13} />}
                  </span>
                  <span className={current ? "mkt-stage-active" : undefined} style={current ? undefined : { color: "var(--fg-3)" }}>
                    {stage.label}
                  </span>
                </div>
              );
            })}
          </div>
          <p style={{ margin: 0, fontSize: 11.5, color: "var(--fg-4)" }}>Usually takes about a minute. You can keep editing the draft.</p>
        </>
      ) : null}

      {failed ? (
        <>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--danger)" }}>{job.failure ?? "Something went wrong during research."}</p>
          <div style={{ display: "flex", gap: 9 }}>
            <button type="button" style={ghostButtonStyle()} onClick={onRetry}>
              <RefreshCcw aria-hidden width={13} height={13} />
              Try again
            </button>
            <button type="button" style={ghostButtonStyle()} onClick={onUseManualPrice}>
              Set the price manually
            </button>
          </div>
        </>
      ) : null}

      {job.status === "succeeded" && job.result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--fg-2)" }}>
            Based on {job.result.comps.length} comparable listing{job.result.comps.length === 1 ? "" : "s"}: {job.result.rationale}
          </p>
        </div>
      ) : null}
    </div>
  );
}
