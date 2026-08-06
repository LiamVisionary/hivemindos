"use client";

/* Publish.tsx — the approve-and-publish-to-X flow for x-thread runs. MiroShark
   publishes the simulation's generated thread as-is (the publish API takes the
   simulation id, not a custom draft), so this is a read-only review + confirm:
   no in-place editing or scheduling, which the backend doesn't support. */

import React from "react";
import { Badge, Button } from "./primitives";
import { Icon } from "./icons";
import { SlideOver } from "./SlideOver";
import { type Run } from "./sim-data";
import { useSimData } from "./sim-context";
import { simulationPublishBlocker, type SimulationPublishResult } from "./publish-readiness";

export function Publish({ run, onClose, onPublished }: { run: Run; onClose: () => void; onPublished?: () => Promise<SimulationPublishResult> }) {
  const thread = useSimData().threadFor(run);
  const tweets = thread ? thread.tweets : [];
  const [done, setDone] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [error, setError] = React.useState("");
  const blocker = simulationPublishBlocker(run, thread, typeof onPublished === "function");
  const confirm = async () => {
    if (!onPublished || blocker || publishing) return;
    setPublishing(true);
    setError("");
    try {
      const result = await onPublished();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Publishing failed.");
    } finally {
      setPublishing(false);
    }
  };
  return (
    <SlideOver open onClose={onClose} wide title={done ? "Thread published" : "Approve & publish"}
      sub={done ? undefined : "Review the thread the social bee generated, then publish it to @hivemindos."}
      footer={done
        ? <><span /><Button variant="primary" sm onClick={onClose}>Done</Button></>
        : <>
            <span className="sv-mono" style={{ fontSize: 11, color: "var(--fg-4)" }}>{tweets.length} tweet{tweets.length === 1 ? "" : "s"} · published as generated</span>
            <Button variant="primary" sm disabled={Boolean(blocker) || publishing} onClick={() => void confirm()}>{publishing ? <span className="fr-dot live sv-livedot" style={{ color: "currentColor", width: 6, height: 6 }} /> : <Icon name="check" size={13} sw={2.2} />} {publishing ? "Publishing…" : "Publish now"}</Button>
          </>}>
      {done ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "30px 10px", textAlign: "center" }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, display: "grid", placeItems: "center", background: "var(--live-soft)", border: "1px solid color-mix(in srgb, var(--live) 35%, transparent)" }}><Icon name="check" size={26} sw={2.2} color="var(--live)" /></div>
          <div>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 600 }}>Posted to @hivemindos</div>
            <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.5, maxWidth: "40ch" }}>MiroShark has the thread. You can track replies from the run once it&apos;s live.</p>
          </div>
          <span className="sv-chip"><Icon name="eye" size={12} /> x.com/hivemindos</span>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Badge tone="honey"><Icon name="alert" size={11} /> Awaiting approval</Badge>
            <span className="sv-mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>drafted by the social bee · {run.posts} tweets</span>
          </div>
          {tweets.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tweets.map((t, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, padding: "11px 13px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--panel-2)" }}>
                  <span className="sv-mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>{i + 1}</span>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--fg)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{t.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.5 }}>No thread was generated for this run yet.</p>
          )}
          {blocker ? <p role="status" style={{ margin: 0, color: "var(--danger)", fontSize: 12.5, lineHeight: 1.5 }}>{blocker}</p> : null}
          {error ? <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: 12.5, lineHeight: 1.5 }}>{error}</p> : null}
        </>
      )}
    </SlideOver>
  );
}
