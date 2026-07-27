"use client";

/* PersistentHiveChat.tsx — the app-wide "Message the hive" pill.
   It lives at the dashboard root (not inside any one view) so the Queen input is
   always reachable, on every screen, paired with the always-mounted transcript
   overlay (QueenBeeVoiceOverlay). Typed messages route straight to the shared
   Queen conversation via queenChat.sendText — never navigating away.

   Wrapped in .fr-root so the honey-theme CSS tokens resolve even though it
   renders outside the Fleet hive view; fleet-hive.css is always loaded by the
   app nav shelf, so the pill is styled on every screen. */

import { ChatPill } from "@/components/fleet-hive/ChatPill";
import { useFrTheme } from "@/components/fleet-hive/use-fr-theme";
import { CHAT_SLASH_COMMANDS } from "@/features/chat/hermes-slash-commands";
import {
  mergeDashboardScreenContext,
  readOpenDialogContextFromDom,
  type DashboardScreenContext,
} from "@/features/dashboard/screen-context";
import { DEFAULT_QUEEN_BEE_NAME } from "@/lib/config/queen-bee-personality";
import { createPortal } from "react-dom";
import { useQueenChat } from "./queen-chat-store";
import { HIVE_CHAT_DOCK_BOTTOM } from "./hive-chat-layout";

export function PersistentHiveChat({
  hidden = false,
  openSpaceRightInset = 0,
  queenName = DEFAULT_QUEEN_BEE_NAME,
  screenContext,
  tone = "hive",
}: {
  hidden?: boolean;
  openSpaceRightInset?: number;
  queenName?: string;
  screenContext?: DashboardScreenContext;
  tone?: "hive" | "legacy";
}) {
  const queenChat = useQueenChat();
  const frTheme = useFrTheme();

  if (hidden || typeof document === "undefined") return null;

  // A compact triangle peak on the pill's top-centre reveals the chat history.
  // Only while there IS history AND it's hidden — once expanded, the bubble's
  // own down-tail is the collapse control (see TranscriptTurns), so the input
  // edge stays clean.
  const showExpandTab = queenChat.turns.length > 0 && !queenChat.transcriptExpanded;
  const isBrainRoute = screenContext?.view === "vault";
  const historyTab = showExpandTab ? (
    <button
      type="button"
      className="fr-chat-tab"
      aria-expanded={false}
      aria-label="Show chat history"
      title="Show chat history"
      onClick={() => queenChat.setHistoryMinimized(false)}
    >
      <svg
        className="fr-chat-tab-svg"
        width="30"
        height="13"
        viewBox="0 0 30 13"
        fill="none"
        aria-hidden="true"
      >
        <path d="M2.5 11.5 L15 2.5 L27.5 11.5" />
      </svg>
    </button>
  ) : null;

  // Company-CEO scope chip: while set, typed turns go to this company's CEO.
  // Sits just above the pill; the ✕ clears the scope back to the hive-wide Queen.
  const ceoScope = queenChat.companyCeoScope;
  const ceoScopeChip = ceoScope ? (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        pointerEvents: "auto",
        padding: "4px 5px 4px 12px",
        borderRadius: 999,
        border: "1px solid var(--honey-line)",
        background: "color-mix(in srgb, var(--panel) 92%, transparent)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        color: "var(--honey-2)",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.3,
      }}
    >
      <span>CEO · {ceoScope.companyName}</span>
      <button
        type="button"
        aria-label={`Leave ${ceoScope.companyName} CEO chat`}
        title="Back to the hive-wide Queen"
        onClick={() => queenChat.setCompanyCeoScope(null)}
        style={{
          width: 18,
          height: 18,
          display: "inline-grid",
          placeItems: "center",
          cursor: "pointer",
          border: "1px solid var(--line-2)",
          borderRadius: 999,
          background: "transparent",
          color: "var(--fg-3)",
          fontSize: 10,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  ) : null;

  return createPortal(
    <div
      className="fr-root"
      data-fr-theme={frTheme}
      style={{
        position: "fixed",
        left: 0,
        right: openSpaceRightInset,
        bottom: HIVE_CHAT_DOCK_BOTTOM,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {ceoScopeChip}
      <ChatPill
        placeholder={isBrainRoute ? `Ask ${queenName} about this brain...` : "Ask the hive to dispatch a task..."}
        tone={tone}
        onComposerActiveChange={queenChat.setComposerActive}
        // The full-width fixed dock owns centering; the pill itself opts back
        // into pointer events and stays out of any dashboard layout math.
        wrapStyle={{
          position: "relative",
          left: "auto",
          bottom: "auto",
          transform: "none",
          zIndex: 50,
          pointerEvents: "auto",
        }}
        topSlot={historyTab}
        slashCommands={CHAT_SLASH_COMMANDS}
        onSend={(text) => {
          const liveScreenContext = mergeDashboardScreenContext(screenContext, {
            openModals: readOpenDialogContextFromDom(),
          });
          void queenChat.sendText(text, { screenContext: liveScreenContext });
        }}
      />
    </div>,
    document.body,
  );
}

export default PersistentHiveChat;
