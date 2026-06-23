"use client";

/* Publish.tsx — the approve-and-publish-to-X flow for x-thread runs. Review the
   draft, pick now vs scheduled, confirm. Wire the confirm to your autoposter. */

import React from "react";
import { Badge, Button } from "./primitives";
import { Icon } from "./icons";
import { SlideOver, FLbl, FInput, XEditor } from "./SlideOver";
import { type Run } from "./sim-data";
import { useSimData } from "./sim-context";

export function Publish({ run, onClose, onPublished }: { run: Run; onClose: () => void; onPublished?: () => void }) {
  const thread = useSimData().threadFor(run);
  const initial = thread ? thread.tweets.map((t) => t.text) : undefined;
  const [when, setWhen] = React.useState<"now" | "schedule">("now");
  const [done, setDone] = React.useState(false);
  const confirm = () => { onPublished?.(); setDone(true); };
  return (
    <SlideOver open onClose={onClose} wide title={done ? "Thread published" : "Approve & publish"}
      sub={done ? undefined : "Review the draft, choose when it goes out, then publish to @hivemindos."}
      footer={done
        ? <><span /><Button variant="primary" sm onClick={onClose}>Done</Button></>
        : <>
            <div className="so-seg">{([["now", "Post now"], ["schedule", "Schedule"]] as const).map(([k, l]) => <button key={k} type="button" data-on={when === k ? "" : undefined} onClick={() => setWhen(k)}>{l}</button>)}</div>
            <Button variant="primary" sm onClick={confirm}><Icon name="check" size={13} sw={2.2} /> {when === "now" ? "Publish now" : "Schedule thread"}</Button>
          </>}>
      {done ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "30px 10px", textAlign: "center" }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, display: "grid", placeItems: "center", background: "var(--live-soft)", border: "1px solid color-mix(in srgb, var(--live) 35%, transparent)" }}><Icon name="check" size={26} sw={2.2} color="var(--live)" /></div>
          <div>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 600 }}>{when === "now" ? "Posted to @hivemindos" : "Scheduled for 13:30 ET"}</div>
            <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.5, maxWidth: "40ch" }}>The autoposter has the thread. You can track replies from the run once it's live.</p>
          </div>
          <span className="sv-chip"><Icon name="eye" size={12} /> x.com/hivemindos</span>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Badge tone="honey"><Icon name="alert" size={11} /> Awaiting approval</Badge>
            <span className="sv-mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>drafted by the social bee · {run.posts} tweets</span>
          </div>
          <XEditor initial={initial} />
          {when === "schedule" && (
            <div className="so-row"><FLbl>Schedule</FLbl>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <FInput value="2026-05-21 13:30 ET" mono />
                <span className="sv-mono" style={{ fontSize: 10, color: "var(--fg-4)", whiteSpace: "nowrap" }}>auto-post slot</span>
              </div>
            </div>
          )}
        </>
      )}
    </SlideOver>
  );
}
