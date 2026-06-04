// src/features/dashboard/views/fusion-showcase/ChatPanel.tsx
"use client";

import * as React from "react";
import { AgentResponseLoader, ComposerField } from "@/features/chat/chat-composer";
import { CheckCircle2, Send, RefreshCcw, GitBranch, Search, type LucideIcon } from "lucide-react";
import { TONE, type Tone } from "./fusion-data";
import { HexNode } from "./hex-node";
import type { Stage } from "./use-fusion-stage";
import type { FusionSkillResult } from "@/lib/services/fusion/fusion-skill";
import styles from "./fusion.module.css";

function ChatLine({ icon: Icon, tone, text, active, done, spinner }: {
  icon: LucideIcon; tone: Tone; text: string; active?: boolean; done?: boolean; spinner?: boolean;
}) {
  const col = TONE[tone];
  return (
    <div className={styles.chatLine} style={{
      display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 11,
      border: "1px solid " + (active ? `color-mix(in srgb, ${col} 55%, transparent)` : "var(--fz-panel-line)"),
      background: active ? `color-mix(in srgb, ${col} 12%, rgba(8,12,19,0.6))` : "rgba(8,12,19,0.45)",
      color: active ? "var(--fz-fg)" : "var(--fz-fg-3)",
    }}>
      <span style={{ width: 16, height: 16, color: col, flex: "0 0 auto", animation: spinner ? "fz-spin 1.4s linear infinite" : undefined }}>
        <Icon style={{ width: "100%", height: "100%" }} />
      </span>
      <span style={{ fontSize: 12.5, lineHeight: 1.35, fontFamily: "var(--f-mono)" }}>{text}</span>
      {done
        ? <span style={{ marginLeft: "auto", width: 14, height: 14, color: col }}><CheckCircle2 style={{ width: "100%", height: "100%" }} /></span>
        : active ? <span className={`${styles.dot} ${styles.dotLive}`} style={{ color: col, marginLeft: "auto" }} /> : null}
    </div>
  );
}

export function ChatPanel({
  draft,
  onDraftChange,
  onSendPrompt,
  stage,
  started,
  submittedPrompt,
  fusionResult,
  fusionError,
  capabilityCount,
  machineCount,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSendPrompt: () => void;
  stage: Stage;
  started: boolean;
  submittedPrompt: string;
  fusionResult?: FusionSkillResult | null;
  fusionError?: string;
  capabilityCount: number;
  machineCount: number;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const attachmentMenuRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = React.useState(false);
  const statusText = machineCount > 0 ? `live · ${machineCount} machines connected` : "live · awaiting prompt";
  type L = { key: string; icon: LucideIcon; tone: Tone; text: string; active: boolean; done?: boolean; spinner?: boolean };
  const lines: L[] = [];
  if (stage.at("discover"))
    lines.push({ key: "d", icon: Search, tone: "teal", text: `Discovered ${fusionResult?.discoveredCount ?? capabilityCount} capabilities across ${fusionResult?.machineCount ?? machineCount} machines`, active: stage.is("discover") || stage.is("carry") });
  if (stage.at("fuse")) {
    const fusing = stage.is("fuse");
    lines.push({
      key: "f", icon: fusing ? RefreshCcw : GitBranch, tone: "gold", spinner: fusing,
      text: fusing ? "Fusing selected live results…" : `Fused ${fusionResult?.fusedCount ?? 0} parts → ${fusionResult?.skill.slug ?? "shared brain skill"}`,
      active: fusing || stage.is("fused"), done: stage.at("verify"),
    });
  }
  if (stage.at("verify"))
    lines.push({
      key: "v",
      icon: CheckCircle2,
      tone: "violet",
      text: fusionError ? `Could not save skill: ${fusionError}` : fusionResult ? "Saved SKILL.md, manifest, and shared brain index" : "Saving generated skill to shared brain…",
      active: stage.is("verify") || (!fusionResult && !fusionError),
      done: Boolean(fusionResult) && stage.at("reveal"),
    });
  if (stage.at("reveal"))
    lines.push({ key: "s", icon: Send, tone: "teal", text: fusionResult ? `Ready in shared brain · ${fusionResult.skill.slug}` : "Fusion run finished", active: true });

  React.useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
  }, [stage.idx, lines.length, started, submittedPrompt]);

  function submitPrompt(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    onSendPrompt();
  }

  function clearPickedFile(event: React.ChangeEvent<HTMLInputElement>) {
    event.currentTarget.value = "";
  }

  return (
    <div className={`${styles.shell} ${styles.scrollbar}`} style={{ height: "100%", minHeight: 0, overflow: "hidden", display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto", background: "linear-gradient(180deg, rgba(16, 21, 31, 0.54), rgba(7, 10, 16, 0.34))" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 18px 14px", borderBottom: "1px solid var(--fz-panel-line)" }}>
        <HexNode tone="gold" image="/icons/queen-bee-v2.png" imageScale={0.72} size={34} />
        <div style={{ display: "grid", gap: 1 }}>
          <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 14, color: "var(--fz-fg)" }}>Hive · fusion agent</span>
          <span className={styles.monoCap} style={{ color: "var(--fz-teal-2)", fontSize: 9 }}>{statusText}</span>
        </div>
        <span className={`${styles.dot} ${styles.dotLive}`} style={{ color: "var(--fz-teal)", marginLeft: "auto" }} />
      </div>

      <div ref={scrollRef} className={styles.scrollbar} style={{ minHeight: 0, overflowY: "auto", padding: 18, display: "grid", gap: 13, alignContent: "start" }}>
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <div style={{
            maxWidth: "88%", padding: "11px 14px", borderRadius: "14px 14px 14px 4px",
            background: "rgba(16, 21, 31, 0.74)", border: "1px solid var(--fz-panel-line)",
            color: "var(--fz-fg)", fontSize: 13.5, lineHeight: 1.5,
          }}>
            What skill can I create for you today?
          </div>
        </div>

        {started ? (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div style={{
              maxWidth: "86%", padding: "11px 14px", borderRadius: "14px 14px 4px 14px",
              background: "var(--fz-teal-soft)", border: "1px solid color-mix(in srgb, var(--fz-teal) 40%, transparent)",
              color: "var(--fz-fg)", fontSize: 13.5, lineHeight: 1.5,
            }}>
              {submittedPrompt || stage.typed}
            </div>
          </div>
        ) : null}

        {stage.is("thinking") ? (
          <div className={styles.chatLine} style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{
              maxWidth: "88%", padding: "10px 13px", borderRadius: "14px 14px 14px 4px",
              background: "rgba(16, 21, 31, 0.74)", border: "1px solid var(--fz-panel-line)",
              color: "var(--fz-fg-2)",
            }}>
              <AgentResponseLoader />
            </div>
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 8 }}>
          {lines.map(({ key, ...line }) => <ChatLine key={key} {...line} />)}
        </div>

        {stage.at("reveal") ? (
          <div className={styles.chatLine} style={{
            marginTop: 2, display: "flex", alignItems: "center", gap: 12, padding: 13, borderRadius: 13,
            border: "1px solid color-mix(in srgb, var(--fz-gold) 50%, transparent)",
            background: "linear-gradient(135deg, var(--fz-gold-soft), rgba(8,12,19,0.5))",
          }}>
            <HexNode tone="gold" size={40}><span style={{ color: "var(--fz-gold)", fontFamily: "var(--f-mono)", fontSize: 16 }}>✦</span></HexNode>
            <div style={{ display: "grid", gap: 2 }}>
              <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 14, color: "var(--fz-fg)" }}>{fusionResult?.skill.name ?? "Unified skill ready"}</span>
              <code style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fz-gold-2)" }}>{fusionResult?.skill.slug ?? "shared brain skill"} · reusable</code>
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ padding: "0 15px 15px" }}>
        <form className={styles.composerDock} onSubmit={submitPrompt}>
          <ComposerField
            attachmentError=""
            attachmentMenuOpen={attachmentMenuOpen}
            attachmentMenuRef={attachmentMenuRef}
            attachments={[]}
            busy={stage.running}
            canRecord={false}
            canSend={Boolean(draft.trim())}
            directories={[]}
            disabled={false}
            fileInputRef={fileInputRef}
            floating
            imageInputRef={imageInputRef}
            onChange={onDraftChange}
            onFileChange={clearPickedFile}
            onImageChange={clearPickedFile}
            onRemoveAttachment={() => undefined}
            placeholder="Make a skill that..."
            setAttachmentMenuOpen={setAttachmentMenuOpen}
            submitOnEnter
            value={draft}
            voiceBands={[]}
          />
        </form>
      </div>
    </div>
  );
}
