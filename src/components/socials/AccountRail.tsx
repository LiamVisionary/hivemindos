"use client";

import { Plus } from "lucide-react";

import { useSocialsDesk } from "@/components/socials/socials-context";
import type { SocialPlatform } from "@/lib/services/socials/socials-types";

const PLATFORM_GLYPH: Record<SocialPlatform, string> = {
  x: "𝕏",
  telegram: "TG",
  farcaster: "FC",
  linkedin: "in",
  reddit: "r/",
  facebook: "fb",
};

export function AccountRail() {
  const desk = useSocialsDesk();
  return (
    <div className="sc-rail">
      {desk.accounts.map((account) => {
        const tone = account.probe.ok ? "live" : account.status === "disconnected" ? "off" : "warn";
        return (
          <button
            key={account.id}
            type="button"
            className="sc-acct"
            data-active={account.id === desk.activeAccountId}
            onClick={() => desk.selectAccount(account.id)}
          >
            <span className="sc-acct-glyph">{PLATFORM_GLYPH[account.platform]}</span>
            <span style={{ minWidth: 0 }}>
              <span className="sc-acct-name">@{account.handle}</span>
              <div className="sc-acct-sub">
                {desk.platforms.find((platform) => platform.platform === account.platform)?.label ?? account.platform}
                {" · "}
                {account.postingMode === "auto" ? "auto" : "manual"}
              </div>
            </span>
            <span className="sc-dot" data-tone={tone} aria-hidden="true" />
          </button>
        );
      })}
      <button type="button" className="sc-connect-btn" onClick={() => desk.setConnectOpen(true)}>
        <Plus aria-hidden="true" width={15} height={15} /> Connect account
      </button>
    </div>
  );
}
