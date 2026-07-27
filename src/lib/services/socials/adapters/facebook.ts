import { hostname } from "node:os";

import { probeBrowserProfileLogin } from "@/lib/services/browser-profile-connect";
import { sameMachineIdentity } from "@/features/fleet/fleet-identity";
import { socialPlatformRow } from "@/lib/services/socials/social-platform-matrix";
import type { SocialAccount } from "@/lib/services/socials/socials-types";
import {
  SocialPostError,
  type SocialConnectProbe,
  type SocialPlatformAdapter,
} from "@/lib/services/socials/adapters/types";

/**
 * Facebook — connection-only on the Socials surface. There is no Graph API
 * for personal profiles/Marketplace, so the "credential" is a signed-in
 * managed browser profile on the machine the user connected from (non-secret
 * binding: { machineKey, machineLabel, profileId }). The Marketplace selling
 * agent rides the same profile; feed posting is intentionally not wired.
 */
export const facebookSocialAdapter: SocialPlatformAdapter = {
  platform: "facebook",

  async connectStatus(account: SocialAccount): Promise<SocialConnectProbe> {
    const profileId = (account.binding?.profileId ?? "").trim();
    const machineKey = (account.binding?.machineKey ?? "").trim();
    const machineLabel = (account.binding?.machineLabel ?? machineKey).trim();
    if (!profileId || !machineKey) {
      return { ok: false, detail: "No managed browser profile is bound to this account — run Connect again." };
    }
    // The session cookie jar only exists on the machine the user signed in on;
    // a probe from any other machine says nothing about it.
    if (!sameMachineIdentity(machineKey, hostname())) {
      return { ok: true, detail: `Signed-in browser session lives on ${machineLabel}. Probe it from that machine.` };
    }
    const spec = socialPlatformRow("facebook").methods.find((method) => method.method === "browser-profile")?.browserProfile;
    if (!spec) return { ok: false, detail: "Facebook browser-profile method is missing from the matrix." };
    const probe = await probeBrowserProfileLogin({
      profileName: profileId,
      probeUrl: spec.probeUrl,
      signedOutDetail: "Signed out of Facebook — run Connect to sign in again.",
    });
    return probe.status === "connected"
      ? { ok: true, detail: `Signed-in browser session on ${machineLabel || "this machine"}.` }
      : { ok: false, detail: probe.detail ?? "Browser session needs attention." };
  },

  async post() {
    throw new SocialPostError("Facebook feed posting is unavailable: the managed browser profile only powers Marketplace account work.");
  },

  async fetchPostMetrics() {
    return [];
  },

  async fetchAccountMetrics() {
    return {};
  },

  capabilities() {
    return { ...socialPlatformRow("facebook").capabilities };
  },
};
