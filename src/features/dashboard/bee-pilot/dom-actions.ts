"use client";

import type { BeeFlightController } from "@/features/dashboard/bee-pilot/bee-flight";

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Polls for a selector so steps can await React renders triggered by state changes. */
export async function waitForElement(selector: string, timeoutMs = 5_000): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) return element;
    await wait(80);
  }
  return null;
}

export async function scrollElementIntoView(element: HTMLElement): Promise<void> {
  // Never scroll for an element the user can already see - jolting the page
  // reads as the bee dragging the screen around.
  const rect = element.getBoundingClientRect();
  const fullyVisible = rect.top >= 70
    && rect.bottom <= window.innerHeight - 40
    && rect.left >= 0
    && rect.right <= window.innerWidth;
  if (fullyVisible) return;
  element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  // scrollIntoView has no completion signal; poll until the rect stops moving.
  let lastTop = Number.NaN;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await wait(90);
    const top = element.getBoundingClientRect().top;
    if (Math.abs(top - lastTop) < 1) return;
    lastTop = top;
  }
}

function pressFeedback(element: HTMLElement): void {
  try {
    element.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(0.94)", offset: 0.4 },
        { transform: "scale(1)" },
      ],
      { duration: 280, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
    );
    element.animate(
      [
        { boxShadow: "0 0 0 0 rgba(250, 204, 21, 0.65)" },
        { boxShadow: "0 0 0 14px rgba(250, 204, 21, 0)" },
      ],
      { duration: 520, easing: "ease-out" },
    );
  } catch {
    // Web Animations may be unavailable in stripped-down webviews; the click still lands.
  }
}

/**
 * The signature Bee Pilot move: fly to the element, play the full springy
 * press animation, and only then deliver the real DOM click so whatever the
 * click opens never appears mid-bounce.
 */
export async function beeClick(bee: BeeFlightController, element: HTMLElement): Promise<void> {
  await scrollElementIntoView(element);
  await bee.flyToElement(element);
  const rect = element.getBoundingClientRect();
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  pressFeedback(element);
  element.dispatchEvent(new PointerEvent("pointerdown", init));
  element.dispatchEvent(new MouseEvent("mousedown", init));
  await bee.bounce();
  element.dispatchEvent(new PointerEvent("pointerup", init));
  element.dispatchEvent(new MouseEvent("mouseup", init));
  element.click();
}

/**
 * Typewriter fill for React-controlled inputs: the caller applies each
 * progressively longer prefix through the owning state setter while the bee
 * hovers over the field.
 */
export async function beeType(
  bee: BeeFlightController,
  element: HTMLElement | null,
  text: string,
  applyValue: (value: string) => void,
): Promise<void> {
  if (element) {
    await scrollElementIntoView(element);
    await bee.flyToElement(element);
    element.focus?.();
  }
  const step = Math.max(2, Math.round(text.length / 28));
  for (let length = step; length < text.length; length += step) {
    applyValue(text.slice(0, length));
    await wait(24);
  }
  applyValue(text);
  await wait(120);
}
