"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type ModalFocusTrapOptions = {
  onEscape?: () => void;
  portalRootRef?: RefObject<HTMLElement | null>;
};

/**
 * Keeps keyboard and screen-reader focus inside a portal modal, restores focus
 * on close, and makes the mounted app behind the portal inert while it is open.
 */
export function useModalFocusTrap(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  options: ModalFocusTrapOptions = {},
) {
  const { onEscape, portalRootRef } = options;

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const portalRoot = portalRootRef?.current ?? dialog.parentElement;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(document.body.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement && child !== portalRoot)
      .map((child) => ({
        child,
        inert: child.inert,
        ariaHidden: child.getAttribute("aria-hidden"),
      }));

    document.body.style.overflow = "hidden";
    for (const item of background) {
      item.child.inert = true;
      item.child.setAttribute("aria-hidden", "true");
    }

    const focusInitial = () => {
      const preferred = dialog.querySelector<HTMLElement>("[data-modal-autofocus]");
      const first = preferred ?? dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? dialog).focus();
    };
    const frame = window.requestAnimationFrame(focusInitial);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((node) => !node.hasAttribute("hidden") && node.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      for (const item of background) {
        item.child.inert = item.inert;
        if (item.ariaHidden === null) item.child.removeAttribute("aria-hidden");
        else item.child.setAttribute("aria-hidden", item.ariaHidden);
      }
      previousFocus?.focus();
    };
  }, [dialogRef, onEscape, open, portalRootRef]);
}
