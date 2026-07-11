// Minimal logger for the companion 3D engine (ported from ami-ai-companion,
// where these modules imported a richer app logger). Quiet by default; flip
// COMPANION_DEBUG in the console to trace engine internals.

declare global {
  interface Window {
    __hiveCompanionDebug?: boolean;
  }
}

const debugEnabled = (): boolean =>
  typeof window !== "undefined" && window.__hiveCompanionDebug === true;

export const logger = {
  debug: (...args: unknown[]): void => {
    if (debugEnabled()) console.debug("[companion]", ...args);
  },
  info: (...args: unknown[]): void => {
    if (debugEnabled()) console.info("[companion]", ...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn("[companion]", ...args);
  },
  error: (...args: unknown[]): void => {
    console.error("[companion]", ...args);
  },
};

export default logger;
