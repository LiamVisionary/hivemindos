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
