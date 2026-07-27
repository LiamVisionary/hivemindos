"use client";

import type { BeeFlightController } from "@/features/dashboard/bee-pilot/bee-flight";
import { scrollElementIntoView, wait, waitForElement } from "@/features/dashboard/bee-pilot/dom-actions";

/**
 * Deep-link landing for a Work Board task: wait for its card to render
 * (covers the view switch + board fetch), scroll the board across to its
 * column and down to the card, fly the bee cursor onto it, and open its
 * conversation. `openConversation` is invoked by the caller's own handler
 * (the fly→bounce→invoke pattern the other bee-pilot steps use) instead of a
 * center click, because a Needs-You card's center is interactive and swallows
 * clicks. Returns false when the card never rendered AND the conversation
 * could not be opened, so callers can report an honest miss.
 */
export async function revealKanbanTaskWithBee(options: {
  bee: BeeFlightController;
  taskId: string;
  /** Opens the task's conversation modal; returns false when the task is unknown. */
  openConversation: () => boolean;
}): Promise<boolean> {
  const { bee, taskId, openConversation } = options;
  const card = await waitForElement(`[data-bee-task="${taskId}"]`, 10_000);
  if (!card) {
    // Board rendered without the card (filtered out, other board, still
    // loading): opening the modal directly still honors the deep link.
    return openConversation();
  }
  await scrollElementIntoView(card);
  await bee.flyToElement(card);
  await bee.bounce();
  const opened = openConversation();
  await wait(650);
  bee.hide();
  return opened;
}
