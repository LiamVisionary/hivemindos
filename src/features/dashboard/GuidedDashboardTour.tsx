"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import { GUIDED_TOUR_EVENT } from "@/lib/native/guided-tour";
import { DEFAULT_FIRST_TASK_PROMPT, FIRST_TASK_EVENT, type FirstTaskEventDetail } from "@/lib/native/first-task";
import { useModalFocusTrap } from "@/lib/ui/use-modal-focus-trap";

type TourStop = {
  id: "fleet" | "brain" | "work" | "wallets" | "more" | "chat";
  anchor: DashboardView;
  view?: DashboardView;
  title: string;
  body: string;
};

const TOUR_STOPS: TourStop[] = [
  {
    id: "fleet",
    anchor: "agents",
    view: "agents",
    title: "This is your hive",
    body: "Every computer and AI helper in your hive shows up here. Your agents appear on this screen as setup finishes — and so will any other computers you add.",
  },
  {
    id: "brain",
    anchor: "vault",
    view: "vault",
    title: "One brain, shared by all",
    body: "Anything one agent learns or can do — skills, knowledge, memory — lives here, where every other agent can use it too.",
  },
  {
    id: "work",
    anchor: "kanban",
    view: "kanban",
    title: "Give the hive a job",
    body: "Write down something you want done and drop it on this board. The hive picks it up and gets to work.",
  },
  {
    id: "wallets",
    anchor: "wallet",
    view: "wallet",
    title: "Agents with their own wallets",
    body: "Each agent can hold its own money. Give one a budget and it pays for the models and tools it uses — you always stay in control.",
  },
  {
    id: "more",
    anchor: "more",
    view: "more",
    title: "Everything else",
    body: "Extra tools, capability search, phone, messaging, and deeper settings live in here. Nothing you need today.",
  },
  {
    id: "chat",
    anchor: "chat",
    title: "Say hello",
    body: "This is where you talk to your agents — we picked one to get you started. Send it a message and watch the hive come alive.",
  },
];

const CHAT_BODY_NO_AGENT =
  "This is where you talk to your agents. When they appear, pick one, say hello, and watch the hive come alive.";

const SPOT_PADDING = 6;
const CARD_WIDTH = 340;
const CARD_MARGIN = 12;

type AnchorRect = { top: number; left: number; width: number; height: number };

export function GuidedDashboardTour({ selectView, openFirstAgentSetup, openFirstChat }: {
  selectView: (view: DashboardView) => void;
  /** Open the simplest available setup path when there is no chat-capable agent. */
  openFirstAgentSetup: () => void;
  /** Open the chat view with the first chat-capable agent selected. Returns false when no agent was available. */
  openFirstChat: (prompt?: string) => boolean;
}) {
  const [stopIndex, setStopIndex] = useState<number | null>(null);
  const [chatReady, setChatReady] = useState(true);
  const [rect, setRect] = useState<AnchorRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const close = useCallback(() => setStopIndex(null), []);

  useModalFocusTrap(stopIndex !== null, cardRef, { onEscape: close, portalRootRef: rootRef });

  const openStop = useCallback((index: number) => {
    const stop = TOUR_STOPS[index];
    if (stop.id === "chat") setChatReady(openFirstChat());
    else if (stop.view) selectView(stop.view);
    setStopIndex(index);
  }, [openFirstChat, selectView]);

  useEffect(() => {
    const start = () => openStop(0);
    window.addEventListener(GUIDED_TOUR_EVENT, start);
    return () => window.removeEventListener(GUIDED_TOUR_EVENT, start);
  }, [openStop]);

  useEffect(() => {
    const startFirstTask = (event: Event) => {
      const detail = (event as CustomEvent<FirstTaskEventDetail>).detail;
      const opened = openFirstChat(detail?.prompt?.trim() || DEFAULT_FIRST_TASK_PROMPT);
      if (!opened) openFirstAgentSetup();
      setStopIndex(null);
    };
    window.addEventListener(FIRST_TASK_EVENT, startFirstTask);
    return () => window.removeEventListener(FIRST_TASK_EVENT, startFirstTask);
  }, [openFirstAgentSetup, openFirstChat]);

  useLayoutEffect(() => {
    if (stopIndex === null) return;
    const anchor = TOUR_STOPS[stopIndex].anchor;
    const measure = () => {
      const node = document.querySelector(`[data-bee-nav="${anchor}"]`);
      if (!node) {
        setRect(null);
        return;
      }
      const box = node.getBoundingClientRect();
      setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
    };
    // Measure on the next frame so the view switch has applied its layout.
    const frame = window.requestAnimationFrame(measure);
    const settle = window.setTimeout(measure, 280);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      window.removeEventListener("resize", measure);
    };
  }, [stopIndex]);

  if (stopIndex === null || typeof document === "undefined") return null;

  const stop = TOUR_STOPS[stopIndex];
  const body = stop.id === "chat" && !chatReady ? CHAT_BODY_NO_AGENT : stop.body;
  const isLast = stopIndex === TOUR_STOPS.length - 1;
  const cardStyle = rect
    ? {
        top: rect.top + rect.height + SPOT_PADDING + CARD_MARGIN,
        left: Math.min(
          Math.max(CARD_MARGIN, rect.left + rect.width / 2 - CARD_WIDTH / 2),
          window.innerWidth - CARD_WIDTH - CARD_MARGIN,
        ),
      }
    : { top: "50%" as const, left: "50%" as const, transform: "translate(-50%, -50%)" };

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[70]" role="presentation">
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-lg border border-[rgba(45,212,191,0.55)] transition-all duration-300"
          style={{
            top: rect.top - SPOT_PADDING,
            left: rect.left - SPOT_PADDING,
            width: rect.width + SPOT_PADDING * 2,
            height: rect.height + SPOT_PADDING * 2,
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.1)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-[rgba(2,6,23,0.1)]" />
      )}
      <section
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Guided tour"
        tabIndex={-1}
        className="fixed w-[340px] max-w-[calc(100vw-24px)] rounded-lg border border-[rgba(148,163,184,0.24)] bg-[rgba(8,13,22,0.97)] p-4 text-[var(--foreground)] shadow-2xl"
        style={cardStyle}
      >
        <p className="text-xs font-medium text-[var(--accent-strong)]">{stopIndex + 1} of {TOUR_STOPS.length}</p>
        <h3 className="mt-1 text-base font-semibold">{stop.title}</h3>
        <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">{body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Skip tour
          </Button>
          <Button type="button" data-modal-autofocus onClick={() => (isLast ? close() : openStop(stopIndex + 1))}>
            {isLast ? "Start chatting" : "Next"}
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
