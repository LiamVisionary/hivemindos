"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import type { BeeFlightController, BeeFlightRipple } from "@/features/dashboard/bee-pilot/bee-flight";
import { LottiePlayer } from "@/components/ui/lottie-player";
import { HONEY_BEE_LOTTIE_SRC } from "@/components/ui/lottie-asset-cache";

import styles from "./bee-pilot.module.css";

const BEE_SIZE = 56;
const RIPPLE_LIFETIME_MS = 700;

const noopSubscribe = () => () => {};

/**
 * Full-screen pointer-transparent layer that renders the flying honey bee.
 * Frames come from the BeeFlightController outside the React render loop;
 * transforms are written straight to the element style.
 */
export function BeeCursorOverlay({ controller }: { controller: BeeFlightController }) {
  const beeRef = useRef<HTMLDivElement | null>(null);
  // SSR-safe portal gate: false on the server render, true on the client.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [ripples, setRipples] = useState<BeeFlightRipple[]>([]);

  useEffect(() => {
    if (!mounted) return;
    return controller.subscribe(
      (frame) => {
        const bee = beeRef.current;
        if (!bee) return;
        // Anchor the bee slightly above-left of the target so it appears to hover over it.
        const x = frame.x - BEE_SIZE / 2;
        const y = frame.y - BEE_SIZE + 10;
        bee.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${frame.tilt}deg) scale(${frame.scale})`;
        bee.style.opacity = frame.visible ? "1" : "0";
      },
      (ripple) => {
        setRipples((current) => [...current.slice(-4), ripple]);
        window.setTimeout(() => {
          setRipples((current) => current.filter((item) => item.id !== ripple.id));
        }, RIPPLE_LIFETIME_MS);
      },
    );
  }, [controller, mounted]);

  if (!mounted) return null;

  return createPortal(
    <div className={styles.beeLayer} aria-hidden="true">
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className={styles.beeRipple}
          style={{ left: ripple.x, top: ripple.y }}
        />
      ))}
      <div ref={beeRef} className={styles.beeCursor} data-bee-cursor>
        <LottiePlayer src={HONEY_BEE_LOTTIE_SRC} size={BEE_SIZE} loop autoplay />
      </div>
    </div>,
    document.body,
  );
}
