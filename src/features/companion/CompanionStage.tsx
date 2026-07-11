"use client";

/* CompanionStage.tsx — React host for the companion 3D engine. This module
 * (and everything it pulls in: three.js, three-vrm, the ported engine) only
 * loads through next/dynamic when a companion surface mounts, keeping the
 * base app free of 3D weight.
 */

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/features/dashboard/views/zero-human-companies/primitives";
import type { CompanionEngine } from "./engine/companion-engine";

export type CompanionStageProps = {
  hologramEnabled: boolean;
  /** Popover mode: fully transparent behind Sara. */
  transparentBackground?: boolean;
  /** Latest completed Queen reply — drives expressions + gestures. */
  latestQueenReply?: { id: string; text: string; live?: boolean } | null;
  /** Camera dolly distance (1.2–4.5); engine default when omitted. */
  cameraDistance?: number;
  /** Camera view-center height (0.8–1.8); higher = Sara lower in frame. */
  cameraCenterY?: number;
  /** Wardrobe outfit key (SARA_OUTFITS); default outfit when omitted. */
  outfitKey?: string;
};

export function CompanionStage({
  hologramEnabled,
  transparentBackground,
  latestQueenReply,
  cameraDistance,
  cameraCenterY,
  outfitKey,
}: CompanionStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<CompanionEngine | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState<string | null>(null);
  const reactedTurnRef = useRef<string | null>(null);
  // Read at engine construction (the mount effect deliberately has no deps).
  // Synced in an effect declared BEFORE the mount effect so it runs first.
  const outfitKeyRef = useRef(outfitKey);
  useEffect(() => {
    outfitKeyRef.current = outfitKey;
  }, [outfitKey]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    let disposed = false;
    let engine: CompanionEngine | null = null;
    let observer: ResizeObserver | null = null;

    void import("./engine/companion-engine").then(async ({ CompanionEngine: Engine }) => {
      if (disposed) return;
      engine = new Engine(canvas, { transparentBackground, outfitKey: outfitKeyRef.current });
      engineRef.current = engine;
      const fit = () => {
        const rect = container.getBoundingClientRect();
        engine?.resize(rect.width, rect.height);
      };
      observer = new ResizeObserver(fit);
      observer.observe(container);
      try {
        await engine.init();
        if (disposed) return;
        fit();
        setPhase("ready");
      } catch (error) {
        if (disposed) return;
        console.error("[companion] engine init failed", error);
        setErrorText(
          error instanceof Error ? error.message : "The companion failed to load.",
        );
        setPhase("error");
      }
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      engine?.dispose();
      engineRef.current = null;
    };
    // The engine is created once per mount; hologram/reply changes flow
    // through the imperative effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setHologramEnabled(hologramEnabled);
  }, [hologramEnabled, phase]);

  useEffect(() => {
    engineRef.current?.setCameraFraming(cameraDistance, cameraCenterY);
  }, [cameraDistance, cameraCenterY, phase]);

  useEffect(() => {
    if (phase !== "ready" || !outfitKey) return;
    void engineRef.current?.setOutfit(outfitKey);
  }, [outfitKey, phase]);

  useEffect(() => {
    if (phase !== "ready") return;
    const reply = latestQueenReply;
    if (!reply || reply.live) return;
    if (reactedTurnRef.current === reply.id) return;
    reactedTurnRef.current = reply.id;
    engineRef.current?.reactToReply(reply.text);
  }, [latestQueenReply, phase]);

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
      {phase === "loading" ? (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--fg-3, rgba(255,255,255,0.6))", fontFamily: "var(--f-mono, ui-monospace, monospace)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            <Spinner size={14} /> projecting sara
          </div>
        </div>
      ) : null}
      {phase === "error" ? (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 380, textAlign: "center", color: "var(--fg-2, rgba(255,255,255,0.75))", fontSize: 13, lineHeight: 1.6 }}>
            {errorText ?? "The companion failed to load."} Re-running setup from
            the Companion button in the left rail re-downloads her files.
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CompanionStage;
