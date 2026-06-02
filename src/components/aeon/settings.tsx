"use client";

import * as React from "react";
import { Btn, Card, Pill, SectionHead, StatusRow, TONE, type IconName, type Tone, aeonStyles as styles } from "./parts";
import { DEFAULT_SECRET_KEYS, type AeonAgent, type AeonMemory, type AeonPathEntry, type AeonSecret, type SecretStatus } from "./aeon-data";
import type { RuntimeRepoSyncStatus } from "@/lib/services/runtime-adapters/types";

const SECRET_STATUS: Record<SecretStatus, { tone: Tone; label: string }> = {
  set: { tone: "green", label: "Set in AEON" },
  shared: { tone: "honey", label: "In shared env" },
  local: { tone: "honey", label: "Local only" },
  missing: { tone: "muted", label: "Missing" },
};

function SettingsCard({ eyebrow, title, icon, action, children, danger }: { eyebrow: string; title: string; icon: IconName; action?: React.ReactNode; children: React.ReactNode; danger?: boolean }) {
  return (
    <Card style={danger ? { border: "1px solid rgba(251,113,133,0.22)", background: "linear-gradient(135deg, rgba(127,29,29,0.16), var(--panel-bg))" } : undefined}>
      <SectionHead eyebrow={eyebrow} title={title} icon={icon} action={action} />
      {children}
    </Card>
  );
}

type AeonSettingsStatus = { hasConfig?: boolean; a2aReachable?: boolean };

export function AeonSettings({
  agent,
  secrets,
  paths,
  memory,
  status,
  repoSync,
  onRepoAction,
}: {
  agent: AeonAgent;
  secrets: AeonSecret[];
  paths: AeonPathEntry[];
  memory: AeonMemory;
  status?: AeonSettingsStatus;
  repoSync?: RuntimeRepoSyncStatus;
  onRepoAction?: (action: "pull" | "push") => void;
}) {
  const [mirror, setMirror] = React.useState(true);
  const [showMap, setShowMap] = React.useState(false);
  const localChanges = repoSync ? `${repoSync.changedFiles.length} changed` : "Unknown";
  const remoteDelta = repoSync ? `${repoSync.behind} behind · ${repoSync.ahead} ahead` : "Unknown";
  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
      <SettingsCard eyebrow="Setup" title="Connection & sync" icon="git" action={<Pill tone="green" dot>Ready</Pill>}>
        <div style={{ display: "grid", gap: 8 }}>
          <StatusRow label="Local config" value={status?.hasConfig ? "aeon.yml found" : "Not found"} ok={status?.hasConfig !== false} mono />
          <StatusRow label="A2A card" value={status?.a2aReachable ? "Reachable" : "Not reachable"} ok={status?.a2aReachable === true} />
          <StatusRow label="GitHub repo" value={agent.repo ?? "Local only"} ok={!!agent.repo} mono />
          <StatusRow label="Local path" value={agent.localPath} ok mono />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <Btn size="sm" variant="secondary" icon="bot">Sync skill library</Btn>
          <Btn size="sm" variant="secondary" icon="upload">Sync keys</Btn>
          <Btn size="sm" variant="ghost" icon="file" onClick={() => setShowMap((v) => !v)}>File map</Btn>
        </div>
        {showMap && (
          <div style={{ display: "grid", gap: 6, marginTop: 12, padding: 12, borderRadius: 10, background: "rgba(2,6,23,0.34)", border: "1px solid var(--line)" }}>
            {paths.map((p) => (
              <div key={p.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{p.label}</span>
                <code style={{ fontSize: 11, fontFamily: "var(--f-mono)", color: "var(--fg-2)", padding: "2px 7px", borderRadius: 6, background: "rgba(2,6,23,0.5)", border: "1px solid var(--line)" }}>{p.value}</code>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      <SettingsCard eyebrow="Save and update" title="AEON files" icon="git">
        <div style={{ display: "grid", gap: 8 }}>
          <StatusRow label="Repo" value={agent.repo ?? "Not configured"} ok={!!agent.repo} mono />
          <StatusRow label="Branch" value={agent.branch} ok mono />
          <StatusRow label="Local changes" value={localChanges} ok={repoSync ? !repoSync.hasChanges : false} />
          <StatusRow label="Remote delta" value={remoteDelta} ok={repoSync ? repoSync.behind === 0 && repoSync.ahead === 0 : false} mono />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Btn size="sm" variant="secondary" icon="download" onClick={() => onRepoAction?.("pull")}>Update from GitHub</Btn>
          <Btn size="sm" variant="primary" icon="upload" onClick={() => onRepoAction?.("push")}>Save to GitHub</Btn>
        </div>
      </SettingsCard>

      <SettingsCard eyebrow="Keys" title="What AEON can access" icon="key">
        <div style={{ display: "grid", gap: 9, gridTemplateColumns: "1fr 1fr" }}>
          {secrets.map((s) => {
            const st = SECRET_STATUS[s.status];
            return (
              <div key={s.key} style={{ display: "grid", gap: 6, padding: 12, borderRadius: 10,
                border: `1px solid ${TONE[st.tone].bd}`, background: s.status === "set" ? "rgba(110,231,183,0.07)" : s.status === "missing" ? "var(--panel-bg-soft)" : "rgba(255,212,90,0.06)" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "var(--f-mono)", color: "var(--fg)", overflowWrap: "anywhere" }}>{s.key}</span>
                <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{s.label}</span>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <Pill tone={st.tone}>{st.label}</Pill>
                  {s.status !== "set" && <Btn size="sm" variant="ghost" icon={s.status === "missing" ? "shield" : "upload"}>{s.status === "missing" ? "Setup" : "Copy"}</Btn>}
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ margin: "12px 0 0", padding: "10px 12px", borderRadius: 9, fontSize: 11.5, lineHeight: 1.55, color: "var(--fg-3)", background: "var(--aeon-soft)", border: "1px solid rgba(94,234,212,0.14)" }}>
          Default sync pushes core keys only: <strong style={{ color: "var(--fg-2)", fontFamily: "var(--f-mono)" }}>{DEFAULT_SECRET_KEYS.join(", ")}</strong>. Use <strong style={{ color: "var(--fg-2)" }}>Sync all shared env</strong> to push every key.
        </p>
      </SettingsCard>

      <SettingsCard eyebrow="Memory" title="What AEON remembers" icon="memory">
        <pre className={styles.scroll} style={{ margin: 0, padding: 12, maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap",
          fontSize: 11, lineHeight: 1.6, fontFamily: "var(--f-mono)", color: "var(--fg-3)", background: "rgba(2,6,23,0.4)", borderRadius: 10, border: "1px solid var(--line)" }}>{memory.index}</pre>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 12 }}>
          {(["topics", "logs", "issues"] as const).map((kind) => (
            <div key={kind} style={{ padding: 11, borderRadius: 10, background: "var(--panel-bg-soft)", border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                <span className={styles.monoCap} style={{ color: "var(--fg-4)" }}>{kind}</span>
                <span style={{ fontSize: 11, color: "var(--cyan-2)", fontFamily: "var(--f-mono)" }}>{memory[kind].length}</span>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {memory[kind].slice(0, 3).map((it) => (
                  <div key={it.title} style={{ padding: "6px 8px", borderRadius: 7, background: "rgba(2,6,23,0.3)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-2)" }}>{it.title}</div>
                    <div style={{ fontSize: 10.5, color: "var(--fg-4)", marginTop: 2, lineHeight: 1.4 }}>{it.excerpt}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <button onClick={() => setMirror((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "7px 12px", borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: "pointer",
            border: `1px solid ${mirror ? "var(--aeon-line)" : "var(--line-2)"}`, background: mirror ? "var(--aeon-soft)" : "var(--panel-bg-soft)", color: mirror ? "var(--cyan-3)" : "var(--fg-3)" }}>
            <span style={{ position: "relative", width: 34, height: 18, borderRadius: 999, background: mirror ? "rgba(94,234,212,0.34)" : "rgba(2,6,23,0.6)", border: "1px solid var(--line-2)", transition: "all 160ms" }}>
              <span style={{ position: "absolute", top: 1.5, left: mirror ? 17 : 2, width: 13, height: 13, borderRadius: 999, background: mirror ? "var(--aeon)" : "var(--fg-4)", transition: "all 160ms" }} />
            </span>
            Obsidian mirror {mirror ? "on" : "off"}
          </button>
          <Btn size="sm" variant="ghost" icon="upload">Sync once</Btn>
        </div>
      </SettingsCard>

      <SettingsCard eyebrow="Danger zone" title="Local workspace cleanup" icon="trash" danger>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, lineHeight: 1.55, color: "var(--fg-3)" }}>
          Remove the local Git link to keep files but detach from GitHub. Delete the local repo when the folder should disappear from this AEON list.
        </p>
        <StatusRow label="Local path" value={agent.localPath} ok mono />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Btn size="sm" variant="secondary" icon="git">Delete Git only</Btn>
          <Btn size="sm" variant="danger" icon="trash">Delete local repo</Btn>
        </div>
      </SettingsCard>
    </div>
  );
}
