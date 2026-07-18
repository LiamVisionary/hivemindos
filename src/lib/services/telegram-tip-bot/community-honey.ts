import "server-only";

import type { CommunityMissionCreateInput } from "./community-honey-logic";

export type CommunityHoneyConfig = {
  enabled: boolean;
  apiUrl: string;
  botToken: string;
};

export type CommunityMission = {
  id: string;
  seasonId: string;
  title: string;
  description: string;
  category: string;
  rewardHoney: number;
  evidenceType: "github_pr" | "url" | "note";
  githubRepo: string | null;
  dueAt: string | null;
  requiredApprovals: number;
  status: string;
  createdAt: string;
};

export type CommunityReview = {
  id: string;
  missionId: string;
  missionTitle: string;
  publicLabel: string;
  evidence: string;
  githubVerified: boolean;
  status: string;
  approvalCount: number;
  requiredApprovals: number;
  rewardHoney: number;
  createdAt: string;
};

const TIMEOUT_MS = 8_000;

export class CommunityHoneyClient {
  constructor(private readonly config: CommunityHoneyConfig) {}

  get enabled() {
    return this.config.enabled && Boolean(this.config.apiUrl && this.config.botToken);
  }

  createLinkCode(telegramUserId: string, publicLabel: string) {
    return this.request<{ code: string; expiresAt: string }>("/community/link-codes", {
      method: "POST",
      body: JSON.stringify({ telegramUserId, publicLabel }),
    });
  }

  profile(telegramUserId: string) {
    return this.request<{
      linked: boolean;
      // HONEY banked to the Telegram identity before any HivemindOS link;
      // it transfers to the workspace automatically when the member links.
      pendingHoney?: {
        total: number;
        sources: { peerRecognition: number; historicalTipSeed: number };
      };
      publicLabel?: string;
      honey?: {
        total: number;
        sources: {
          verifiedWork: number;
          peerRecognition: number;
          historicalTipSeed: number;
        };
      };
      recognitionAllowance?: {
        eligible: boolean;
        eligibleAt: string | null;
        qualification: string;
        honeyPerRecognition: number;
        dailyLimit: number;
        usedToday: number;
        remainingToday: number;
        recipientDailyHoneyCap: number;
      };
      recent?: Array<{ eventId: string; seasonId: string; honey: number; title: string; createdAt: string }>;
    }>(`/community/profile?telegramUserId=${encodeURIComponent(telegramUserId)}`);
  }

  // Tap-to-link: the app minted this intent and Telegram delivered it via the
  // /start deep link, so the user id we pass is Telegram-attested.
  redeemLinkIntent(intent: string, telegramUserId: string, publicLabel: string) {
    return this.request<{ linked: boolean; publicLabel: string; claimedHoney: number }>(
      "/community/link-intents/redeem",
      { method: "POST", body: JSON.stringify({ intent, telegramUserId, publicLabel }) },
    );
  }

  givePeerHoney(input: {
    giverTelegramUserId: string;
    recipientTelegramUserId: string;
    telegramUpdateId: string;
    reason: string;
  }) {
    return this.request<{
      duplicate: boolean;
      honeyGiven: number;
      recipientPublicLabel: string;
      // Absent on gateways that predate link-free recognition; only an
      // explicit false should trigger the "link to claim" nudge.
      recipientLinked?: boolean;
      dailyRecognitionLimit: number;
      recognitionsUsedToday: number;
      recognitionsRemainingToday: number;
    }>("/community/peer-honey", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listMissions() {
    return this.request<{ seasonId: string; missions: CommunityMission[] }>("/community/missions");
  }

  createMission(input: CommunityMissionCreateInput) {
    return this.request<{ mission: CommunityMission }>("/community/missions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  submit(telegramUserId: string, missionId: string, evidence: string) {
    return this.request<{ submission: { id: string; missionId: string; status: string; evidence: string; githubVerified: boolean; createdAt: string } }>(
      "/community/submissions",
      { method: "POST", body: JSON.stringify({ telegramUserId, missionId, evidence }) },
    );
  }

  listReviews() {
    return this.request<{ submissions: CommunityReview[] }>("/community/reviews");
  }

  review(telegramUserId: string, submissionId: string, decision: "approve" | "reject") {
    return this.request<{
      submissionId: string;
      status: string;
      approvalCount?: number;
      requiredApprovals?: number;
      honeyAwarded?: number;
      duplicate?: boolean;
    }>(`/community/submissions/${encodeURIComponent(submissionId)}/${decision}`, {
      method: "POST",
      body: JSON.stringify({ reviewerUserId: telegramUserId }),
    });
  }

  leaderboard() {
    return this.request<{
      seasonId: string;
      leaderboard: Array<{
        rank: number;
        publicLabel: string;
        honey: number;
        missionHoney: number;
        recognitionHoney: number;
        historicalHoney: number;
        awards: number;
        peerTips: number;
      }>;
      policy: {
        allHoneyCountsTowardBenefits: true;
        legacyHivePerHoney: number;
      };
    }>("/community/leaderboard");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.enabled) throw new Error("Telegram HONEY contributions are not configured.");
    const response = await fetch(`${this.config.apiUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.botToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await response.json().catch(() => null) as ({ ok?: boolean; error?: string } & T) | null;
    if (!response.ok || !data?.ok) throw new Error(data?.error || `Community HONEY request failed (${response.status}).`);
    return data;
  }
}
