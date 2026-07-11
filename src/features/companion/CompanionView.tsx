"use client";

/* CompanionView.tsx — the "companion" tab inside the Fleet hive view.
 *
 * Shows Sara as a hologram over the hive backdrop. Chat and voice ride the
 * app-wide "Message the hive" pill (it has its own voice toggle), so this
 * view adds no talk affordance of its own. The 3D engine (three.js + VRM,
 * ~large) loads only inside this tab via next/dynamic, so the fleet route
 * pays nothing for it until the tab is opened.
 *
 * Chrome: one HUD cluster top-left — queen status (speaking dot, live voice
 * level, answering brain) with a compact control footer (hologram toggle /
 * queen settings / hide ui). The bottom of the view stays clear for the
 * chat pill. "Hide UI" flips the fleet view into immersive mode —
 * FleetHiveView also drops its TopBar + mode toggles — leaving just Sara
 * and a ghost restore button bottom-right.
 */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { getQueenVoiceOpen, listenForQueenVoiceState } from "@/lib/native/queen-voice-events";
import { useQueenVoicePulse } from "@/lib/audio/queen-voice-amplitude";
import { useQueenChat } from "@/features/queen-voice/queen-chat-store";
import { Spinner } from "@/features/dashboard/views/zero-human-companies/primitives";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import {
  COMPANION_CAMERA_CENTER_Y_DEFAULT,
  COMPANION_CAMERA_CENTER_Y_KEY,
  COMPANION_CAMERA_DISTANCE_DEFAULT,
  COMPANION_CAMERA_DISTANCE_KEY,
  COMPANION_OUTFIT_KEY,
} from "./companion-install";
import { SARA_OUTFIT_ASSETS } from "./companion-assets";
import { CompanionBackdrop } from "./CompanionBackdrop";
import { useCompanionSettings } from "./use-companion-settings";

// Slider ↔ camera mappings. Zoom: right = closer (smaller dolly distance).
// Position: right = Sara higher in frame (lower view-center Y).
const DIST_MAX = 4.2;
const DIST_MIN = 1.4;
const CENTER_MAX = 1.75;
const CENTER_MIN = 0.9;
const zoomToDistance = (v: number) => DIST_MAX - (v / 100) * (DIST_MAX - DIST_MIN);
const distanceToZoom = (d: number) => ((DIST_MAX - d) / (DIST_MAX - DIST_MIN)) * 100;
const posToCenterY = (v: number) => CENTER_MAX - (v / 100) * (CENTER_MAX - CENTER_MIN);
const centerYToPos = (y: number) => ((CENTER_MAX - y) / (CENTER_MAX - CENTER_MIN)) * 100;

function parseOr(value: string, fallback: number): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

// The companion tab wears the fleet graph's classic-blue accent (matching the
// CompanionBackdrop grid + particles) instead of the hive honey.
const GRAPH_BLUE = "rgb(150, 200, 255)";
const GRAPH_BLUE_TEXT = "#cfe4ff";
const GRAPH_BLUE_SOFT = "rgba(90, 140, 220, 0.18)";

const CompanionStage = dynamic(
  () => import("./CompanionStage").then((mod) => mod.CompanionStage),
  {
    ssr: false,
    loading: () => (
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--fg-3)", fontFamily: "var(--f-mono, ui-monospace, monospace)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          <Spinner size={14} /> warming the emitter
        </div>
      </div>
    ),
  },
);

const HUD_BTN_STYLE: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
  borderRadius: 8, border: "1px solid var(--line)", padding: "5px 9px",
  background: "transparent", color: "var(--fg-3)",
  fontFamily: "var(--f-mono, ui-monospace, monospace)", fontSize: 10,
  fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
};

export function CompanionView({
  onOpenQueenSettings,
  immersive = false,
  onImmersiveChange,
}: {
  /** Opens the agent-settings modal focused on the Queen (AgentsPanel). */
  onOpenQueenSettings?: () => void;
  /** Immersive mode: all chrome hidden (FleetHiveView drops its bar too). */
  immersive?: boolean;
  onImmersiveChange?: (immersive: boolean) => void;
}) {
  const { settings, hydrated, setHologramEnabled } = useCompanionSettings();
  const [voiceOpen, setVoiceOpen] = useState(false);
  // The Queen's replies (text + voice turns share the store) drive Sara's
  // expressions and gestures inside the stage; the HUD reads the same turn.
  const { turns } = useQueenChat();
  let latestQueenReply: { id: string; text: string; live: boolean; brain?: string } | null = null;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.who === "queen" && turn.text) {
      latestQueenReply = { id: turn.id, text: turn.text, live: Boolean(turn.live), brain: turn.brain };
      break;
    }
  }

  // Live speech level, written imperatively as --queen-amp + data-voice on
  // the HUD node (no React re-render per frame).
  const voiceHudRef = useRef<HTMLDivElement | null>(null);
  useQueenVoicePulse(voiceHudRef);

  // Camera framing sliders. Live values drive the engine while dragging;
  // the dashboard-state write happens on release (the store re-serialises
  // whole on every write, so no per-tick persistence).
  const [savedDistance, rememberDistance] = useRememberedDashboardValue(COMPANION_CAMERA_DISTANCE_KEY, "");
  const [savedCenterY, rememberCenterY] = useRememberedDashboardValue(COMPANION_CAMERA_CENTER_Y_KEY, "");
  const [liveDistance, setLiveDistance] = useState<number | null>(null);
  const [liveCenterY, setLiveCenterY] = useState<number | null>(null);
  const cameraDistance = liveDistance ?? parseOr(savedDistance, COMPANION_CAMERA_DISTANCE_DEFAULT);
  const cameraCenterY = liveCenterY ?? parseOr(savedCenterY, COMPANION_CAMERA_CENTER_Y_DEFAULT);

  // Wardrobe: persisted outfit key; empty = the default outfit.
  const [savedOutfit, rememberOutfit] = useRememberedDashboardValue(COMPANION_OUTFIT_KEY, "");
  const outfitKey = savedOutfit || SARA_OUTFIT_ASSETS[0].key;

  useEffect(() => {
    // Deferred initial read — no synchronous setState inside the effect.
    const t = window.setTimeout(() => setVoiceOpen(getQueenVoiceOpen()), 0);
    const unlisten = listenForQueenVoiceState(setVoiceOpen);
    return () => {
      window.clearTimeout(t);
      unlisten();
    };
  }, []);

  const showChrome = !immersive && hydrated && settings.installed;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* graph-view atmosphere: faint grid + drifting particle field */}
      <CompanionBackdrop />

      {hydrated && !settings.installed ? (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: "center", color: "var(--fg-2)", fontSize: 14, lineHeight: 1.6 }}>
            The companion module isn&apos;t installed on this machine. Open{" "}
            <b>Companion</b> in the left rail to download Sara (~50&nbsp;MB) and
            set her up.
          </div>
        </div>
      ) : hydrated ? (
        <CompanionStage
          hologramEnabled={settings.hologramEnabled}
          latestQueenReply={latestQueenReply}
          cameraDistance={cameraDistance}
          cameraCenterY={cameraCenterY}
          outfitKey={outfitKey}
        />
      ) : null}

      {/* queen HUD cluster — top-left, below the fleet layout toggle; the
          bottom of the view belongs to the app-wide chat pill */}
      {showChrome ? (
        <div
          ref={voiceHudRef}
          style={{
            position: "absolute", top: 64, left: 16, zIndex: 20, minWidth: 216, maxWidth: 280,
            borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg-2)",
            boxShadow: "0 6px 20px rgba(0,0,0,.25)", padding: "10px 12px",
            display: "grid", gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              aria-hidden
              style={{
                width: 8, height: 8, borderRadius: 4,
                background: GRAPH_BLUE,
                opacity: "calc(0.35 + var(--queen-amp, 0) * 0.65)" as unknown as number,
                transform: "scale(calc(1 + var(--queen-amp, 0) * 0.6))",
              }}
            />
            <span style={{ fontFamily: "var(--f-mono, ui-monospace, monospace)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: GRAPH_BLUE_TEXT }}>
              Queen Bee
            </span>
            <span style={{ marginLeft: "auto", fontFamily: "var(--f-mono, ui-monospace, monospace)", fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {voiceOpen ? "voice live" : "standing by"}
            </span>
          </div>
          {/* live speech level */}
          <div style={{ height: 3, borderRadius: 2, background: "var(--line)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 2, background: GRAPH_BLUE, width: "calc(var(--queen-amp, 0) * 100%)" }} />
          </div>
          <div style={{ fontFamily: "var(--f-mono, ui-monospace, monospace)", fontSize: 10, color: "var(--fg-3)", overflowWrap: "anywhere" }}>
            {latestQueenReply?.brain ? `brain · ${latestQueenReply.brain}` : "no replies yet — use the chat pill"}
          </div>
          {/* wardrobe */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 2, borderTop: "1px solid var(--line)" }}>
            <span style={{ width: 42, fontFamily: "var(--f-mono, ui-monospace, monospace)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>
              outfit
            </span>
            <select
              value={outfitKey}
              onChange={(event) => rememberOutfit(event.target.value)}
              aria-label="Companion outfit"
              style={{
                flex: 1, borderRadius: 8, border: "1px solid var(--line)", padding: "4px 6px",
                background: "var(--bg-2)", color: "var(--fg-1)",
                fontFamily: "var(--f-mono, ui-monospace, monospace)", fontSize: 10.5,
              }}
            >
              {SARA_OUTFIT_ASSETS.map((outfit) => (
                <option value={outfit.key} key={outfit.key}>
                  {outfit.label ?? outfit.key}
                </option>
              ))}
            </select>
          </label>
          {/* camera framing */}
          <div style={{ display: "grid", gap: 5, paddingTop: 2, borderTop: "1px solid var(--line)" }}>
            {([
              {
                label: "zoom",
                value: distanceToZoom(cameraDistance),
                onLive: (v: number) => setLiveDistance(zoomToDistance(v)),
                onCommit: () => {
                  rememberDistance(String(+cameraDistance.toFixed(3)));
                  setLiveDistance(null);
                },
              },
              {
                label: "height",
                value: centerYToPos(cameraCenterY),
                onLive: (v: number) => setLiveCenterY(posToCenterY(v)),
                onCommit: () => {
                  rememberCenterY(String(+cameraCenterY.toFixed(3)));
                  setLiveCenterY(null);
                },
              },
            ] as const).map((slider) => (
              <label key={slider.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 42, fontFamily: "var(--f-mono, ui-monospace, monospace)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>
                  {slider.label}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(slider.value)}
                  onChange={(event) => slider.onLive(Number(event.target.value))}
                  onPointerUp={slider.onCommit}
                  onBlur={slider.onCommit}
                  style={{ flex: 1, accentColor: GRAPH_BLUE, height: 14 }}
                  aria-label={`Companion camera ${slider.label}`}
                />
              </label>
            ))}
          </div>
          {/* control footer */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", paddingTop: 2, borderTop: "1px solid var(--line)" }}>
            <button
              type="button"
              onClick={() => { void setHologramEnabled(!settings.hologramEnabled); }}
              aria-pressed={settings.hologramEnabled}
              title="Toggle the hologram render style"
              style={{
                ...HUD_BTN_STYLE,
                background: settings.hologramEnabled ? GRAPH_BLUE_SOFT : "transparent",
                color: settings.hologramEnabled ? GRAPH_BLUE_TEXT : "var(--fg-3)",
              }}
            >
              hologram
            </button>
            {onOpenQueenSettings ? (
              <button type="button" onClick={onOpenQueenSettings} title="Queen Bee settings" style={HUD_BTN_STYLE}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
                </svg>
                settings
              </button>
            ) : null}
            <button type="button" onClick={() => onImmersiveChange?.(true)} title="Hide the interface" style={HUD_BTN_STYLE}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61" />
                <path d="M2 2l20 20" />
              </svg>
              hide ui
            </button>
          </div>
        </div>
      ) : null}

      {/* immersive: a single ghost restore control (clear of the chat pill) */}
      {immersive && hydrated && settings.installed ? (
        <button
          type="button"
          onClick={() => onImmersiveChange?.(false)}
          title="Show the interface"
          style={{
            position: "absolute", bottom: 14, right: 14, zIndex: 20, cursor: "pointer",
            width: 30, height: 30, borderRadius: 15, border: "1px solid var(--line)",
            background: "var(--bg-2)", color: "var(--fg-3)", opacity: 0.4,
            display: "grid", placeItems: "center",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

export default CompanionView;
