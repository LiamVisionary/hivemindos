"use client";

/* The "your app exists" card pinned to the assistant message that created a
 * chat app project. Shows the real ChatAppArtifact identity (name, template,
 * machine, live status) and opens the App workspace. Never fabricates status:
 * the dot reflects the artifact's last-known manifest state. */

import type { ChatAppArtifact } from "@/lib/services/chat/chat-app-artifact";

import { Ico } from "./composer-primitives";

const APP_GLYPH = ["M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M3 9h18", "M7 6h.01", "M10 6h.01"];

function statusTone(status: ChatAppArtifact["status"]) {
  if (status === "running") return { color: "var(--live)", label: "Running" };
  if (status === "error") return { color: "var(--danger)", label: "Error" };
  if (status === "creating") return { color: "var(--honey)", label: "Creating" };
  return { color: "var(--fg-4)", label: "Stopped" };
}

function directoryTail(directory: string) {
  return directory.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
}

export function AppArtifactCard({ artifact, onOpen }: { artifact: ChatAppArtifact; onOpen?: () => void }) {
  const tone = statusTone(artifact.status);
  return (
    <section
      aria-label={`App project ${artifact.name}`}
      style={{ display: "flex", alignItems: "center", gap: 13, border: "1px solid var(--line)", borderRadius: 14, background: "var(--bg-soft)", padding: "13px 16px" }}
    >
      <span aria-hidden style={{ display: "grid", placeItems: "center", width: 38, height: 38, border: "1px solid var(--honey-line)", borderRadius: 11, background: "color-mix(in srgb, var(--honey) 8%, var(--bg))", color: "var(--honey)", flex: "0 0 auto" }}>
        <Ico d={APP_GLYPH} size={19} sw={1.6} />
      </span>
      <span style={{ display: "grid", gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: "var(--f-body)", fontSize: 13.5, fontWeight: 600, color: "var(--fg)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{artifact.name}</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)", border: "1px solid var(--line-2)", borderRadius: 5, padding: "1px 6px", flex: "0 0 auto" }}>{artifact.templateId}</span>
        </span>
        <span title={artifact.directory} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--f-body)", fontSize: 11.5, color: "var(--fg-4)", minWidth: 0 }}>
          <span aria-hidden className={artifact.status === "running" ? "cx-dot-live" : undefined} style={{ width: 6, height: 6, borderRadius: 99, background: tone.color, flex: "0 0 auto" }} />
          <span style={{ color: tone.color }}>{tone.label}</span>
          <span aria-hidden>·</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {[artifact.machineName, directoryTail(artifact.directory)].filter(Boolean).join(" · ")}
          </span>
        </span>
      </span>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${artifact.name} in the app workspace`}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--honey-line)", borderRadius: 999, background: "color-mix(in srgb, var(--honey) 12%, var(--bg))", color: "var(--honey-2)", fontFamily: "var(--f-body)", fontSize: 12, fontWeight: 500, padding: "7px 14px", cursor: "pointer", flex: "0 0 auto" }}
        >
          <Ico d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" size={13} sw={1.7}><circle cx="12" cy="12" r="3" /></Ico>
          <span>Open app</span>
        </button>
      ) : null}
    </section>
  );
}
