/* trade-sound.ts — a short success chime for completed trade-route actions:
   stock buy/sell (including a pending/accepted order), crypto swap, bridge,
   send, and perps order placement. NOT played on cancels. Mirrors the existing
   Queen-voice audio pattern (new Audio().play().catch) — best-effort, since a
   WKWebView/browser autoplay policy may block playback that lands too long after
   the initiating click; failures are swallowed silently. */

const TRADE_SUCCESS_SOUND_SRC = "/audio/sfx/trade-success.mp3";

let cachedAudio: HTMLAudioElement | null = null;

export function playTradeSuccessSound(): void {
  if (typeof window === "undefined" || typeof Audio === "undefined") return;
  try {
    const audio = cachedAudio ?? (cachedAudio = new Audio(TRADE_SUCCESS_SOUND_SRC));
    audio.currentTime = 0;
    audio.volume = 0.5;
    void audio.play().catch(() => undefined);
  } catch {
    /* no audio support / autoplay blocked — a chime is non-essential */
  }
}
