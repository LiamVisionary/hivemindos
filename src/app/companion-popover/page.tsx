"use client";

/* /companion-popover — the floating hologram-companion window (desktop).
 *
 * Loaded into the transparent, borderless, always-on-top webview created by
 * the `set_companion_popover` Tauri command. Everything here must stay
 * see-through except the hologram itself: no page background, a drag strip
 * along the top edge so the frameless window can be moved, and a close
 * affordance that only shows on hover.
 *
 * Note: the Queen's TTS audio plays in the MAIN window's page, so this
 * window can't hear it — the popover companion idles (procedural motion,
 * blinking, hologram shimmer) rather than lip-syncing. Voice-reactive lip
 * sync lives in the fleet route's companion tab.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useCompanionSettings } from "@/features/companion/use-companion-settings";
import { setCompanionPopoverOpen } from "@/features/companion/companion-popover";
import {
  saveCompanionFlag,
  COMPANION_POPOVER_KEY,
  COMPANION_CAMERA_CENTER_Y_DEFAULT,
  COMPANION_CAMERA_CENTER_Y_KEY,
  COMPANION_CAMERA_DISTANCE_DEFAULT,
  COMPANION_CAMERA_DISTANCE_KEY,
  COMPANION_OUTFIT_KEY,
} from "@/features/companion/companion-install";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";

const CompanionStage = dynamic(
  () => import("@/features/companion/CompanionStage").then((mod) => mod.CompanionStage),
  { ssr: false, loading: () => null },
);

export default function CompanionPopoverPage() {
  const { settings, hydrated } = useCompanionSettings();
  const [hovering, setHovering] = useState(false);
  // Same persisted framing the fleet tab's sliders write.
  const [savedDistance] = useRememberedDashboardValue(COMPANION_CAMERA_DISTANCE_KEY, "");
  const [savedCenterY] = useRememberedDashboardValue(COMPANION_CAMERA_CENTER_Y_KEY, "");
  const [savedOutfit] = useRememberedDashboardValue(COMPANION_OUTFIT_KEY, "");
  const parsedDistance = parseFloat(savedDistance);
  const parsedCenterY = parseFloat(savedCenterY);

  // The root layout paints html/body with the dashboard theme background
  // (an inline <style> plus the globals.css hex-grid gradients), which fills
  // the otherwise-transparent Tauri window with a solid black sheet. Inline
  // element styles outrank both, so force them clear while this page lives.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlBg: html.style.background,
      bodyBg: body.style.background,
      htmlColor: html.style.backgroundColor,
      bodyColor: body.style.backgroundColor,
    };
    html.style.background = "transparent";
    html.style.backgroundColor = "transparent";
    body.style.background = "transparent";
    body.style.backgroundColor = "transparent";
    return () => {
      html.style.background = prev.htmlBg;
      html.style.backgroundColor = prev.htmlColor;
      body.style.background = prev.bodyBg;
      body.style.backgroundColor = prev.bodyColor;
    };
  }, []);

  const close = useCallback(() => {
    // Closing the popover also turns the mode off so it doesn't reopen on the
    // next launch — the setup modal is where it gets re-enabled.
    void saveCompanionFlag(COMPANION_POPOVER_KEY, false).then(() =>
      setCompanionPopoverOpen(false),
    );
  }, []);

  return (
    <div
      // The whole window is the drag region: Tauri's drag handler fires on
      // mousedown when the TARGET element carries the attribute, so the 3D
      // stage below is pointer-events:none — every press lands here and the
      // frameless window moves. The close button opts back in.
      data-tauri-drag-region=""
      style={{ position: "fixed", inset: 0, background: "transparent", overflow: "hidden" }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {hydrated && settings.installed ? (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <CompanionStage
            hologramEnabled={settings.hologramEnabled}
            transparentBackground
            cameraDistance={Number.isFinite(parsedDistance) ? parsedDistance : COMPANION_CAMERA_DISTANCE_DEFAULT}
            cameraCenterY={Number.isFinite(parsedCenterY) ? parsedCenterY : COMPANION_CAMERA_CENTER_Y_DEFAULT}
            outfitKey={savedOutfit || undefined}
          />
        </div>
      ) : null}
      {hovering ? (
        <button
          type="button"
          onClick={close}
          aria-label="Close companion popover"
          style={{
            position: "absolute", top: 8, right: 8, zIndex: 20, cursor: "pointer",
            width: 26, height: 26, borderRadius: 13, border: "1px solid rgba(255,255,255,0.25)",
            background: "rgba(10,12,16,0.55)", color: "rgba(255,255,255,0.85)",
            display: "grid", placeItems: "center", fontSize: 13, lineHeight: 1,
            pointerEvents: "auto",
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
