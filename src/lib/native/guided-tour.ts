export const GUIDED_TOUR_EVENT = "hivemindos:start-guided-tour";

/** Ask the dashboard to start the post-setup guided tour (fired by the setup wizard's "Show me around"). */
export function requestGuidedTour() {
  window.dispatchEvent(new Event(GUIDED_TOUR_EVENT));
}
