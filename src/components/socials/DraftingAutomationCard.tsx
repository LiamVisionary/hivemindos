"use client";

import { Pause, Play, Sparkles } from "lucide-react";

import { useSocialsDesk, type SocialsAccountView } from "@/components/socials/socials-context";
import { SocialsSpinner } from "@/components/socials/skeletons";
import {
  socialAccountHasStandaloneGroundingSource,
  socialStandaloneDraftingSetupMessage,
} from "@/lib/services/socials/social-drafting-readiness";
import { SOCIAL_DRAFT_CADENCE_HOURS, SOCIAL_DRAFTS_PER_RUN } from "@/lib/services/socials/socials-types";

function formatDate(value?: string): string {
  if (!value) return "Not yet";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "Unknown";
}

function cadenceLabel(hours: number): string {
  if (hours === 24) return "Every day";
  if (hours === 48) return "Every 2 days";
  if (hours === 168) return "Every week";
  return `Every ${hours} hours`;
}

export function DraftingAutomationCard({ account }: { account: SocialsAccountView }) {
  const desk = useSocialsDesk();
  const runtime = desk.draftingRuntime;
  const supported = account.capabilities.post !== "unsupported";
  const standaloneReady = socialAccountHasStandaloneGroundingSource(account);
  const generating = desk.queueBusy === "generate-drafts" || Boolean(runtime?.inFlightSince);
  const save = (drafting: Parameters<typeof desk.setDraftingPolicy>[1]) => desk.setDraftingPolicy(account.id, drafting);

  return (
    <section className="sc-card" data-testid="social-drafting-automation">
      <div className="sc-card-head">
        <div>
          <span className="sc-card-title">Agent drafting</span>
          <div className="sc-card-hint" style={{ marginTop: 3 }}>
            {supported
              ? account.drafting.enabled
                ? standaloneReady
                  ? `${account.drafting.draftsPerRun} standalone posts · ${cadenceLabel(account.drafting.cadenceHours).toLowerCase()}`
                  : "Waiting for account-specific context"
                : account.drafting.engagementEnabled
                  ? "Standalone posts paused · comment finder still follows this cadence"
                  : "Paused · manual full-pack generation is still available"
              : "Unavailable for this connection method"}
          </div>
        </div>
        {supported ? (
          <button
            type="button"
            className="sc-btn"
            disabled={Boolean(desk.queueBusy)}
            onClick={() => void save({ enabled: !account.drafting.enabled })}
          >
            {account.drafting.enabled ? <Pause aria-hidden="true" width={13} /> : <Play aria-hidden="true" width={13} />}
            {account.drafting.enabled ? "Pause drafts" : "Enable drafts"}
          </button>
        ) : null}
      </div>

      {supported ? (
        <>
          <div className="sc-drafting-grid">
            <label className="sc-field">
              <span className="sc-label">Cadence</span>
              <select
                className="sc-select"
                value={account.drafting.cadenceHours}
                disabled={Boolean(desk.queueBusy)}
                onChange={(event) => void save({ cadenceHours: Number(event.target.value) as typeof account.drafting.cadenceHours })}
              >
                {SOCIAL_DRAFT_CADENCE_HOURS.map((hours) => <option key={hours} value={hours}>{cadenceLabel(hours)}</option>)}
              </select>
            </label>
            <label className="sc-field">
              <span className="sc-label">Drafts per pack</span>
              <select
                className="sc-select"
                value={account.drafting.draftsPerRun}
                disabled={Boolean(desk.queueBusy)}
                onChange={(event) => void save({ draftsPerRun: Number(event.target.value) as typeof account.drafting.draftsPerRun })}
              >
                {SOCIAL_DRAFTS_PER_RUN.map((count) => <option key={count} value={count}>{count} draft{count === 1 ? "" : "s"}</option>)}
              </select>
            </label>
            <div className="sc-drafting-status">
              <span><strong>Last posts</strong>{runtime?.lastPostGeneratedAt ? `${formatDate(runtime.lastPostGeneratedAt)} · ${runtime.lastPostGeneratedCount ?? 0} drafts` : "Not generated yet"}</span>
              <span><strong>Next pack</strong>{account.drafting.enabled && !standaloneReady ? "Add context first" : account.drafting.enabled || account.drafting.engagementEnabled ? formatDate(runtime?.nextRunAt) : "Paused"}</span>
            </div>
          </div>

          {account.drafting.enabled && !standaloneReady ? (
            <div className="sc-note">{socialStandaloneDraftingSetupMessage(account.handle)}</div>
          ) : null}
          {runtime?.lastError && standaloneReady
            ? <div className="sc-error">Drafting failed: {runtime.lastError} {runtime.nextRunAt ? `Retry scheduled for ${formatDate(runtime.nextRunAt)}.` : ""}</div>
            : null}
          <div className="sc-drafting-footer">
            <div className="sc-note">
              {account.postingMode === "manual"
                ? "Standalone posts and enabled comment suggestions enter the queue for review. Nothing publishes automatically."
                : "Standalone posts enter the auto-mode cancellation window. Replies and quotes always remain suggestions until you approve each one."}
            </div>
            <button
              type="button"
              className="sc-btn"
              data-tone="primary"
              disabled={Boolean(desk.queueBusy) || generating || !standaloneReady}
              onClick={() => void desk.queueAction({ action: "generate-drafts", accountId: account.id })}
            >
              {generating ? <SocialsSpinner /> : <Sparkles aria-hidden="true" width={13} />}
              {generating ? "Drafting" : "Generate full pack"}
            </button>
          </div>
        </>
      ) : (
        <div className="sc-note">Connect a dashboard posting rail to enable autonomous drafting and the durable review queue.</div>
      )}
    </section>
  );
}
