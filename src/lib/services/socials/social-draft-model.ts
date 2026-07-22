import "server-only";

import { optionalEnv } from "@/lib/config/env";

export const SOCIAL_DRAFT_FALLBACK_MODEL = "gpt-5.6-luna";

export function resolveSocialDraftModel(): string {
  return optionalEnv("HIVEMINDOS_SOCIAL_DRAFT_MODEL")
    || optionalEnv("OPENAI_VOICE_CHAT_MODEL")
    || SOCIAL_DRAFT_FALLBACK_MODEL;
}
