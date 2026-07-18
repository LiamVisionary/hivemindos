import type { SocialPlatform } from "@/lib/services/socials/socials-types";
import type { SocialPlatformAdapter } from "@/lib/services/socials/adapters/types";
import { farcasterAdapter } from "@/lib/services/socials/adapters/farcaster";
import { linkedinAdapter } from "@/lib/services/socials/adapters/linkedin";
import { redditAdapter } from "@/lib/services/socials/adapters/reddit";
import { telegramSocialAdapter } from "@/lib/services/socials/adapters/telegram";
import { xAdapter } from "@/lib/services/socials/adapters/x";

/** Platform → adapter registry. Completeness is asserted by scripts/test-socials-matrix.mjs. */
export const SOCIAL_ADAPTERS: Record<SocialPlatform, SocialPlatformAdapter> = {
  x: xAdapter,
  telegram: telegramSocialAdapter,
  farcaster: farcasterAdapter,
  linkedin: linkedinAdapter,
  reddit: redditAdapter,
};

export function socialAdapter(platform: SocialPlatform): SocialPlatformAdapter {
  return SOCIAL_ADAPTERS[platform];
}

export type { SocialAdapterContext, SocialConnectProbe, SocialPlatformAdapter } from "@/lib/services/socials/adapters/types";
