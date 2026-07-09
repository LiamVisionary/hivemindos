"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import styles from "./image-attachment-preview.module.css";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type ImageAttachmentVariant = "composer" | "message";

/**
 * A clickable image-attachment thumbnail that expands into a full-screen
 * lightbox. The expand/collapse uses a FLIP transition so the preview grows
 * out of — and shrinks back into — the thumbnail's exact size and position.
 * Pass `onRemove` to render a corner remove button (composer tray).
 */
export function ImageAttachmentThumbnail({
  src,
  alt,
  variant = "message",
  onRemove,
  removeDisabled,
  removeLabel,
}: {
  src: string;
  alt: string;
  variant?: ImageAttachmentVariant;
  onRemove?: () => void;
  removeDisabled?: boolean;
  removeLabel?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const getOriginRect = useCallback(() => buttonRef.current?.getBoundingClientRect() ?? null, []);
  const handleClose = useCallback(() => {
    setOpen(false);
    // Return focus to the thumbnail so keyboard users aren't dropped at the top.
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);
  const thumbButton = (
    <button
      ref={buttonRef}
      type="button"
      className={`${styles.thumb} ${variant === "composer" ? styles.thumbComposer : styles.thumbMessage}`}
      onClick={() => setOpen(true)}
      aria-label={`Expand image ${alt}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- attachment previews are in-memory data URLs. */}
      <img src={src} alt={alt} draggable={false} />
    </button>
  );
  return (
    <>
      {onRemove ? (
        <span className={styles.tile}>
          {thumbButton}
          <button
            type="button"
            className={styles.remove}
            onClick={onRemove}
            disabled={removeDisabled}
            aria-label={removeLabel ?? `Remove ${alt}`}
          >
            <X aria-hidden="true" />
          </button>
        </span>
      ) : thumbButton}
      {open ? <ImageAttachmentLightbox src={src} alt={alt} getOriginRect={getOriginRect} onClose={handleClose} /> : null}
    </>
  );
}

function ImageAttachmentLightbox({
  src,
  alt,
  getOriginRect,
  onClose,
}: {
  src: string;
  alt: string;
  getOriginRect: () => DOMRect | null;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const enteredRef = useRef(false);
  const closingRef = useRef(false);

  // Set a transform that maps the (centered) preview back onto the origin
  // thumbnail rect. Returns false if either rect isn't measurable yet.
  const invertToOrigin = useCallback(
    (image: HTMLImageElement) => {
      const origin = getOriginRect();
      const target = image.getBoundingClientRect();
      if (!origin || !target.width || !target.height) return false;
      const dx = origin.left - target.left;
      const dy = origin.top - target.top;
      const sx = origin.width / target.width;
      const sy = origin.height / target.height;
      image.style.transformOrigin = "top left";
      image.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      return true;
    },
    [getOriginRect],
  );

  const runEntrance = useCallback(() => {
    const image = imageRef.current;
    if (!image || enteredRef.current) return;
    if (prefersReducedMotion()) {
      enteredRef.current = true;
      image.style.opacity = "1";
      overlayRef.current?.classList.add(styles.overlayVisible);
      return;
    }
    // Start at the thumbnail's position before the browser paints the full
    // size, then release to the natural (identity) transform next frame.
    image.style.transition = "none";
    if (!invertToOrigin(image)) return; // dimensions not ready — retry on load
    enteredRef.current = true;
    image.style.opacity = "1";
    void image.getBoundingClientRect(); // commit the inverted start state
    window.requestAnimationFrame(() => {
      image.style.transition = "";
      image.style.transform = "";
      overlayRef.current?.classList.add(styles.overlayVisible);
    });
  }, [invertToOrigin]);

  useLayoutEffect(() => {
    runEntrance();
  }, [runEntrance]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const beginClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const image = imageRef.current;
    overlayRef.current?.classList.remove(styles.overlayVisible);
    if (!image || prefersReducedMotion() || !invertToOrigin(image)) {
      onClose();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onClose();
    };
    image.addEventListener("transitionend", finish, { once: true });
    // Fallback in case transitionend never fires (interrupted transition).
    window.setTimeout(finish, 420);
  }, [invertToOrigin, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        beginClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [beginClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={overlayRef}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={beginClose}
    >
      <button ref={closeButtonRef} type="button" className={styles.close} onClick={beginClose} aria-label="Close preview">
        <X aria-hidden="true" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- attachment previews are in-memory data URLs. */}
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        className={styles.image}
        draggable={false}
        onLoad={runEntrance}
        onClick={(event) => event.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
