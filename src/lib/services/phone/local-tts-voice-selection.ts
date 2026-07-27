/**
 * Validation of STORED local-TTS voice/model ids against what the selected
 * server actually serves, shared by every call-config resolution path in
 * local-tts.ts.
 *
 * Stored ids can be foreign or orphaned: an ElevenLabs voice id carried over
 * from a previous voice runtime, or a registered clone the TTS server no
 * longer knows. The upstream server used to silently render a DEFAULT speaker
 * for an unknown voice (HTTP 200, no error), so an unvalidated id shipped the
 * wrong voice while every gate reported success (2026-07-24: the Queen spoke
 * a stranger's voice on a stale ElevenLabs id). Only trust a stored id the
 * candidate actually advertises; when the candidate's advertised list is
 * non-empty and excludes it, fall back to the candidate's own voice/model
 * (mirrors the Calls panel's display-side resolver — but persisted behavior,
 * not cosmetic). An empty advertised list (voices probe failed) trusts the
 * stored id: never clobber a possibly-valid selection on a transient probe
 * miss.
 */

type ServedCandidate = {
  model: string;
  voice: string;
  availableModels: string[];
  availableVoices: string[];
};

export function servedLocalTtsModel(candidate: ServedCandidate | undefined, requested: string) {
  if (!candidate) return requested;
  if (!requested) return candidate.model;
  if (candidate.model === requested || candidate.availableModels.includes(requested)) return requested;
  return candidate.availableModels.length ? candidate.model : requested;
}

export function servedLocalTtsVoice(candidate: ServedCandidate | undefined, requested: string) {
  if (!candidate) return requested;
  if (!requested) return candidate.voice;
  if (candidate.voice === requested || candidate.availableVoices.includes(requested)) return requested;
  return candidate.availableVoices.length ? candidate.voice : requested;
}
