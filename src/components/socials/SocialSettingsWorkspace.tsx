"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { AwakeHoursCard } from "@/components/socials/AwakeHoursCard";
import { ContextSourcesCard } from "@/components/socials/ContextSourcesCard";
import { DraftingAutomationCard } from "@/components/socials/DraftingAutomationCard";
import { EngagementDiscoveryCard } from "@/components/socials/EngagementDiscoveryCard";
import { useSocialsDesk } from "@/components/socials/socials-context";
import { VoiceCard } from "@/components/socials/VoiceCard";
import { XSessionCard } from "@/components/socials/XSessionCard";
import { SOCIAL_CAPABILITIES } from "@/lib/services/socials/socials-types";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";

type SettingsTab = "voice" | "schedule" | "automation" | "connection";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "voice", label: "Voice & context" },
  { id: "schedule", label: "Schedule & mode" },
  { id: "automation", label: "Automation" },
  { id: "connection", label: "Connection" },
];

export function SocialSettingsWorkspace() {
  const desk = useSocialsDesk();
  const account = desk.activeAccount;
  const [tab, setTab] = useState<SettingsTab>("voice");
  if (!account) return <section className="sc-settings-route"><div className="sc-empty">Select an account to edit its settings.</div></section>;

  const toggleMode = async () => {
    if (account.postingMode === "auto") {
      await desk.setPostingMode(account.id, "manual");
      return;
    }
    const confirmed = await confirmUserAction(`Enable auto mode for @${account.handle}? Policy-approved standalone posts may schedule after a visible five-minute cancellation window. Replies and quote posts remain manual.`);
    if (confirmed) await desk.setPostingMode(account.id, "auto");
  };

  return (
    <section className="sc-settings-route">
      <nav aria-label={`Settings for @${account.handle}`}>
        <span>@{account.handle}</span>
        {SETTINGS_TABS.map((candidate) => <button key={candidate.id} type="button" data-active={tab === candidate.id} onClick={() => setTab(candidate.id)}><span>{candidate.label}</span><em>{candidate.id === "voice" ? account.contextSources.length : candidate.id === "schedule" ? account.postingMode : candidate.id === "automation" ? account.drafting.enabled ? "on" : "off" : account.platform}</em></button>)}
      </nav>
      <div className="sc-settings-content">
        {tab === "voice" ? <><VoiceCard account={account} /><ContextSourcesCard account={account} /></> : null}
        {tab === "schedule" ? (
          <>
            <AwakeHoursCard account={account} />
            <section className="sc-card sc-mode-card">
              <div className="sc-card-head"><div><span className="sc-card-title">Posting mode</span><p className="sc-card-hint">Choose whether standalone agent drafts may schedule under an explicit account policy.</p></div></div>
              <div className="sc-mode-options">
                <button type="button" data-active={account.postingMode === "manual"} onClick={() => account.postingMode !== "manual" && void toggleMode()}><span><strong>Manual</strong><i /></span><p>Nothing publishes without your click. Drafts and reply suggestions wait in review.</p></button>
                <button type="button" data-active={account.postingMode === "auto"} onClick={() => account.postingMode !== "auto" && void toggleMode()}><span><strong>Auto (opt in)</strong><i /></span><p>Policy-approved standalone posts get a visible five-minute cancellation window. Replies and quotes always stay manual.</p></button>
              </div>
            </section>
          </>
        ) : null}
        {tab === "automation" ? <><DraftingAutomationCard account={account} /><EngagementDiscoveryCard account={account} /></> : null}
        {tab === "connection" ? (
          <>
            <section className="sc-card sc-connection-summary">
              <div className="sc-card-head"><div><span className="sc-card-title">{account.platform === "x" ? "X account connection" : `${account.platform[0].toUpperCase()}${account.platform.slice(1)} connection`}</span><p className="sc-card-hint">{account.probe.detail}</p></div><span className="sc-mode-badge">{account.method}</span></div>
              <div className="sc-pills">{SOCIAL_CAPABILITIES.map((capability) => <span key={capability} className="sc-pill" data-support={account.capabilities[capability]}>{capability}: {account.capabilities[capability]}</span>)}</div>
            </section>
            <XSessionCard key={`${account.id}:${account.binding?.xSessionMode ?? "machine-default"}`} account={account} />
            <section className="sc-card sc-danger-card">
              <div><strong>Remove this account</strong><p>Credentials in Shared Hive Env are untouched. The Socials account record and its queue history are removed.</p></div>
              <button type="button" className="sc-btn" data-tone="danger" onClick={() => void confirmUserAction(`Remove @${account.handle}? Credentials in Shared Hive Env are untouched.`).then((confirmed) => {
                if (confirmed) void desk.deleteAccount(account.id);
              })}><Trash2 width={14} /> Remove account</button>
            </section>
          </>
        ) : null}
      </div>
    </section>
  );
}
