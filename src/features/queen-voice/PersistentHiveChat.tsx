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
import { createPortal } from "react-dom";
import { useQueenChat } from "./queen-chat-store";
import { HIVE_CHAT_DOCK_BOTTOM } from "./hive-chat-layout";

export function PersistentHiveChat({
  hidden = false,
  openSpaceRightInset = 0,
  screenContext,
  tone = "hive",
}: {
  hidden?: boolean;
  openSpaceRightInset?: number;
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
  const showExpandTab = queenChat.turns.length > 0 && queenChat.historyMinimized;
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
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <ChatPill
        placeholder="Ask the hive to dispatch a task…"
        tone={tone}
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
