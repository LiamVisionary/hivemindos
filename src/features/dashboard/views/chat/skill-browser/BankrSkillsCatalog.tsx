"use client";

import * as React from "react";
import type { BankrSkillCatalogItem, BankrSkillsSnapshot } from "@/lib/types/bankr-skills";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";
import { BBtn, Badge, BIcon } from "./primitives";

type BankrSkillsResponse = Partial<BankrSkillsSnapshot> & { ok?: boolean; error?: string };

export function BankrSkillsCatalog({
  onStatus,
  search,
}: {
  onStatus: (status: string) => void;
  search: string;
}) {
  const [snapshot, setSnapshot] = React.useState<BankrSkillsSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [installingSlug, setInstallingSlug] = React.useState("");
  const [selectedSlug, setSelectedSlug] = React.useState("");
  const [error, setError] = React.useState("");

  const load = React.useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    const result = await requestBankrSkills();
    if (refresh) setRefreshing(false);
    else setLoading(false);
    if (!result.snapshot) {
      setError(result.error);
      return;
    }
    setError("");
    setSnapshot(result.snapshot);
  }, []);

  React.useEffect(() => {
    let active = true;
    void requestBankrSkills().then((result) => {
      if (!active) return;
      setLoading(false);
      if (!result.snapshot) {
        setError(result.error);
        return;
      }
      setSnapshot(result.snapshot);
    });
    return () => { active = false; };
  }, []);

  const selected = snapshot?.skills.find((skill) => skill.catalogSlug === selectedSlug) ?? null;
  const query = normalizeSearchText(search);
  const visibleSkills = (snapshot?.skills ?? []).filter((skill) => !query || normalizeSearchText([
    skill.name,
    skill.displaySlug,
    skill.provider,
    skill.description,
  ].join(" ")).includes(query));

  const install = React.useCallback(async (skill: BankrSkillCatalogItem) => {
    if (skill.installed) return;
    if (!snapshot?.configured) {
      onStatus("Connect Bankr with BANKR_API_KEY, BANKR_LLM_KEY, or BANKR_MANAGEMENT_KEY before installing skills.");
      return;
    }
    const confirmed = await confirmUserAction([
      `Install "${skill.name}" to your Bankr agent?`,
      "This adds third-party instructions to the remote Bankr account. Installation does not trade or move funds, but the skill may propose or use Bankr tools when you later invoke it.",
    ].join("\n\n"));
    if (!confirmed) return;
    setInstallingSlug(skill.catalogSlug);
    onStatus("");
    const response = await fetch("/api/bankr/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogSlug: skill.catalogSlug, confirm: true }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string; skill?: BankrSkillCatalogItem } | null;
    setInstallingSlug("");
    if (!response?.ok || !data?.ok || !data.skill) {
      onStatus(data?.error ?? `Could not install ${skill.name}.`);
      return;
    }
    setSnapshot((current) => current ? {
      ...current,
      installedCount: Math.min(current.installedLimit, current.installedCount + 1),
      skills: current.skills.map((candidate) => candidate.catalogSlug === skill.catalogSlug ? data.skill! : candidate),
    } : current);
    onStatus(`Installed ${skill.name} to your Bankr agent.`);
  }, [onStatus, snapshot?.configured]);

  if (loading) return <BankrSkillsSkeleton />;
  if (error && !snapshot) {
    return (
      <div className="sb-bankr-empty">
        <BIcon name="alert" size={18} />
        <p>{error}</p>
        <BBtn sm onClick={() => void load()}><BIcon name="refresh" size={13} />Try again</BBtn>
      </div>
    );
  }

  if (selected) {
    const busy = installingSlug === selected.catalogSlug;
    return (
      <div className="sb-bankr-detail">
        <button type="button" className="sb-bankr-back" onClick={() => setSelectedSlug("")}>
          <span aria-hidden>←</span> Back to catalogue
        </button>
        <div className="sb-bankr-detail-card">
          <div className="sb-bankr-detail-head">
            <span className="sb-bankr-avatar">{providerInitial(selected.provider)}</span>
            <div className="grow">
              <div className="sb-row-name">{selected.name}</div>
              <div className="sb-slug">{selected.displaySlug} · by {selected.provider}</div>
            </div>
            {selected.installed ? <Badge tone="live"><BIcon name="check" size={10} />Installed</Badge> : selected.featured ? <Badge tone="honey">Featured</Badge> : null}
          </div>
          <p className="sb-bankr-detail-copy">{selected.description || "No description is available for this skill."}</p>
          <div className="sb-bankr-detail-meta">
            <span><BIcon name="network" size={13} />{selected.installType === "agent-skill" ? "Bankr community skill" : "GitHub-backed skill"}</span>
            {selected.installCount !== null ? <span><BIcon name="download" size={13} />{selected.installCount} installs</span> : null}
          </div>
          <div className="sb-bankr-safety">
            <BIcon name="shield" size={15} />
            <span>Review the skill before invoking actions. HivemindOS still requires the normal confirmation gates for trades, transfers, deployments, publishing, and other external mutations.</span>
          </div>
          <div className="sb-bankr-detail-actions">
            {selected.sourceUrl ? <a className="fb-btn ghost sm" href={selected.sourceUrl} target="_blank" rel="noreferrer"><BIcon name="eye" size={13} />View source</a> : null}
            <BBtn variant="primary" sm disabled={selected.installed || busy || !snapshot?.configured} onClick={() => void install(selected)}>
              {busy ? <span className="sb-spin"><BIcon name="sync" size={13} /></span> : <BIcon name={selected.installed ? "check" : "download"} size={13} />}
              {selected.installed ? "Installed" : busy ? "Installing" : snapshot?.configured ? "Install to Bankr" : "Connect Bankr first"}
            </BBtn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="sb-bankr-toolbar">
        <div>
          <div className="sb-section">Bankr agent catalogue</div>
          <p>Browse Bankr’s live public catalogue. Installs stay in your Bankr account and work across Bankr chat, Telegram, and automations.</p>
        </div>
        <div className="sb-bankr-toolbar-actions">
          <Badge tone={snapshot?.configured ? "live" : "honey"}>{snapshot?.configured ? "Bankr connected" : "Setup required"}</Badge>
          <Badge>{snapshot?.installedCount ?? 0}/{snapshot?.installedLimit ?? 50} installed</Badge>
          <button type="button" className="fb-iconbtn" title="Refresh Bankr skills" disabled={refreshing} onClick={() => void load(true)}>
            <span className={refreshing ? "sb-spin" : undefined}><BIcon name="refresh" size={14} /></span>
          </button>
        </div>
      </div>
      {snapshot?.accountError ? <div className="sb-error"><BIcon name="alert" size={14} />{snapshot.accountError}</div> : null}
      {!snapshot?.configured ? (
        <div className="sb-bankr-notice"><BIcon name="key" size={15} />The catalogue is available now. Add a Bankr API or LLM key to install skills to your Bankr agent.</div>
      ) : null}
      {visibleSkills.length ? (
        <div className="sb-grid">
          {visibleSkills.map((skill) => {
            const busy = installingSlug === skill.catalogSlug;
            return (
              <article key={skill.catalogSlug} className="sb-card sb-bankr-card">
                <div className="sb-bankr-card-head">
                  <span className="sb-bankr-avatar">{providerInitial(skill.provider)}</span>
                  <div className="grow">
                    <div className="sb-row-name">{skill.name}</div>
                    <div className="sb-slug">by {skill.provider}</div>
                  </div>
                  {skill.installed ? <Badge tone="live"><BIcon name="check" size={10} />Installed</Badge> : skill.featured ? <Badge tone="honey">Featured</Badge> : null}
                </div>
                <div className="body">
                  <p className="sb-card-desc">{skill.description || "No description provided yet."}</p>
                </div>
                <div className="sb-cardfoot">
                  <span className="sb-tag">{skill.installCount !== null ? `${skill.installCount} installs` : skill.installType}</span>
                  <div className="sb-bankr-card-actions">
                    <BBtn sm onClick={() => setSelectedSlug(skill.catalogSlug)}><BIcon name="eye" size={13} />Details</BBtn>
                    <BBtn variant="primary" sm disabled={skill.installed || busy || !snapshot?.configured} onClick={() => void install(skill)}>
                      {busy ? <span className="sb-spin"><BIcon name="sync" size={13} /></span> : <BIcon name={skill.installed ? "check" : "download"} size={13} />}
                      {skill.installed ? "Installed" : busy ? "Installing" : "Install"}
                    </BBtn>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : <div className="sb-empty">No Bankr skills match "{search}".</div>}
    </>
  );
}

function BankrSkillsSkeleton() {
  return (
    <div className="sb-grid" role="status" aria-label="Loading Bankr skills" aria-busy="true">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div key={index} className="sb-card sb-bankr-card" aria-hidden="true">
          <div className="sb-bankr-card-head">
            <span className="sb-skel" style={{ width: 38, height: 38, borderRadius: 10 }} />
            <div className="grow"><span className="sb-skel" style={{ height: 13, width: "58%" }} /><span className="sb-skel" style={{ height: 10, width: "34%", marginTop: 7 }} /></div>
          </div>
          <span className="sb-skel" style={{ height: 11, width: "94%" }} />
          <span className="sb-skel" style={{ height: 11, width: "82%" }} />
          <span className="sb-skel" style={{ height: 28, width: 112, marginLeft: "auto", borderRadius: 999 }} />
        </div>
      ))}
    </div>
  );
}

function providerInitial(provider: string) {
  return provider.trim().charAt(0).toUpperCase() || "B";
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function requestBankrSkills(): Promise<{ snapshot: BankrSkillsSnapshot | null; error: string }> {
  const response = await fetch("/api/bankr/skills", { cache: "no-store" }).catch(() => null);
  const data = await response?.json().catch(() => null) as BankrSkillsResponse | null;
  if (!response?.ok || !data?.ok || !Array.isArray(data.skills)) {
    return { snapshot: null, error: data?.error ?? "Could not load the Bankr skills catalogue." };
  }
  return {
    snapshot: {
      configured: data.configured === true,
      skills: data.skills,
      installedCount: Number(data.installedCount) || 0,
      installedLimit: Number(data.installedLimit) || 50,
      accountError: typeof data.accountError === "string" ? data.accountError : "",
    },
    error: "",
  };
}
