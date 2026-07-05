/**
 * Window event names for the ClawBank guided setup, in `src/lib` so both
 * feature surfaces (dashboard modal, first-run wizard, Connections panel) and
 * shared components (wallets drop-in status card) can use them without a
 * components → features import.
 */

// ClawBank setup is BUTTON-ONLY: the modal never auto-pops. Open it on demand:
//   window.dispatchEvent(new Event(CLAWBANK_OPEN_EVENT))
export const CLAWBANK_OPEN_EVENT = "hivemindos.clawbank.open";

// Fired by the modal after a successful key mint so status surfaces
// (Connections card, wallet status card) re-read GET /api/clawbank.
export const CLAWBANK_UPDATED_EVENT = "hivemindos.clawbank.updated";
