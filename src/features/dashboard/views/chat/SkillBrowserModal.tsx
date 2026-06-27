"use client";

import * as React from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { FusionSkillResult } from "@/lib/services/fusion/fusion-skill";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";
import type { SkillBrowserSkill, SkillBrowserView } from "@/features/dashboard/dashboard-types";
import { BBtn, Badge, BIcon, type BIconName, Toggle } from "./skill-browser/primitives";
import { Fusion } from "./skill-browser/Fusion";
import "./skill-browser/skill-browser.css";

type SkillBrowserModalProps = {
  addWrittenSkillToBrain: () => void | Promise<void>;
  agentSettingsPreferredSkills: string[];
  addAgentPreferredSkill: (slug: string) => void;
  removeAgentPreferredSkill: (slug: string) => void;
  convertSkillToAeon?: (skill: SkillBrowserSkill) => void | Promise<void>;
  importRemoteSkillToBrain: (skill: SkillBrowserSkill) => void | Promise<void>;
  installGithubSkillToBrain: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  openSkillBrowser: () => void | Promise<void>;
  openAgentSkillBrowser: () => void | Promise<void>;
  setSkillBrowserGithubUrl: Dispatch<SetStateAction<string>>;
  setSkillBrowserOpen: Dispatch<SetStateAction<boolean>>;
  setSkillBrowserSearch: Dispatch<SetStateAction<string>>;
  setSkillBrowserView: Dispatch<SetStateAction<SkillBrowserView>>;
  setSkillBrowserWrittenContent: Dispatch<SetStateAction<string>>;
  sharedVaultPath?: string;
  skillBrowserGithubInstalling: boolean;
  skillBrowserGithubUrl: string;
  skillBrowserImporting: string;
  skillBrowserLoading: boolean;
  skillBrowserMode: "brain" | "agent-class";
  skillBrowserOpen: boolean;
  skillBrowserSearch: string;
  skillBrowserSkills: SkillBrowserSkill[];
  skillBrowserStatus: string;
  skillBrowserView: SkillBrowserView;
  skillBrowserWrittenContent: string;
  skillBrowserWriting: boolean;
  hermesUpdateRequired: boolean;
  hermesUpdateRequiredDetail: string;
  skillRequiresHermesUpdate: (skill: SkillBrowserSkill, hermesUpdateRequired: boolean) => boolean;
};

type CapId = "fs" | "net" | "shell" | "secrets" | "mcp";
type Risk = "low" | "med" | "high";

const SB_CAPS: Record<CapId, { label: string; icon: BIconName; risk: Risk }> = {
  fs: { label: "Vault files", icon: "folder", risk: "low" },
  net: { label: "Network", icon: "network", risk: "med" },
  shell: { label: "Shell", icon: "trade", risk: "high" },
  secrets: { label: "Secrets", icon: "key", risk: "high" },
  mcp: { label: "MCP", icon: "plug", risk: "low" },
};

const SB_RISK_TONE: Record<Risk, "live" | "honey" | "danger"> = {
  low: "live",
  med: "honey",
  high: "danger",
};

const SB_TABS: { id: SkillBrowserView; label: string; icon: BIconName }[] = [
  { id: "catalog", label: "Catalog", icon: "sparkles" },
  { id: "installed", label: "Installed", icon: "check" },
  { id: "packs", label: "Packs", icon: "hex" },
  { id: "audit", label: "Audit", icon: "shield" },
  { id: "write", label: "Write", icon: "doc" },
  { id: "fusion", label: "Hive Fusion", icon: "network" },
];

const SB_WRITE_TEMPLATE = `---
name: my-new-skill
description: Use when work should follow a repeatable recipe in the shared brain.
allowed-tools: Read, Write, WebSearch
---

# My New Skill

## When to use
Describe the trigger conditions for this skill.

## Steps
1. Gather context from the shared vault.
2. Do the work.
3. File the result under Synthesis/.
`;

function isPackSkill(skill: SkillBrowserSkill) {
  return skill.category === "Pack" || skill.source === "Skill pack" || Boolean(skill.includedSkills?.length);
}

function isSharedOrImportedSkill(skill: SkillBrowserSkill) {
  return !isPackSkill(skill) && (skill.imported || skill.providerId === "shared");
}

function capabilityIds(skill: SkillBrowserSkill): CapId[] {
  const found = new Set<CapId>();
  for (const capability of skill.capabilities ?? []) {
    const normalized = capability.toLowerCase();
    if (normalized.includes("file")) found.add("fs");
    if (normalized.includes("shell")) found.add("shell");
    if (normalized.includes("mcp")) found.add("mcp");
    if (normalized.includes("http") || normalized.includes("browser") || normalized.includes("network") || normalized.includes("publish") || normalized.includes("deploy") || normalized.includes("wallet")) found.add("net");
  }
  if (skill.envKeys?.length) found.add("secrets");
  if (!found.size) found.add("fs");
  return [...found];
}

function sbRisk(caps: CapId[], auditStatus?: string): Risk {
  if (auditStatus === "blocked" || auditStatus === "restricted") return "high";
  if (auditStatus === "review") return "med";
  const order: Record<Risk, number> = { low: 0, med: 1, high: 2 };
  return caps.reduce<Risk>((maxRisk, cap) => {
    const risk = SB_CAPS[cap].risk;
    return order[risk] > order[maxRisk] ? risk : maxRisk;
  }, "low");
}

function sourceTone(skill: SkillBrowserSkill): "honey" | "live" | undefined {
  if (skill.imported || skill.providerId === "shared") return "live";
  const label = `${skill.source} ${skill.providerId ?? ""}`.toLowerCase();
  return /hivemind|hermes|shared|catalog|codex|claude|aeon/.test(label) ? "honey" : undefined;
}

function itemSearchText(skill: SkillBrowserSkill) {
  return [
    skill.name,
    skill.slug,
    skill.description,
    skill.source,
    skill.category,
    skill.auditStatus,
    skill.sourceRef,
    skill.safety,
    skill.audience,
    ...(skill.capabilities ?? []),
    ...(skill.envKeys ?? []),
    ...(skill.includedSkills?.flatMap((item) => [item.slug, item.name, item.description]) ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function skillMatches(skill: SkillBrowserSkill, query: string) {
  return !query || itemSearchText(skill).includes(query);
}

function skillRecordPriority(skill: SkillBrowserSkill) {
  if (skill.providerId === "shared") return 50;
  if (skill.imported) return 40;
  if (skill.providerId) return 30;
  if (skill.packagedPath || skill.skillMdUrl || skill.githubUrl) return 20;
  return 10;
}

function dedupeSkillRecords(skills: SkillBrowserSkill[]) {
  const bySlug = new Map<string, SkillBrowserSkill>();
  for (const skill of skills) {
    const key = isPackSkill(skill) ? `pack:${skill.slug}` : skill.slug;
    const existing = bySlug.get(key);
    if (!existing || skillRecordPriority(skill) > skillRecordPriority(existing)) bySlug.set(key, skill);
  }
  return [...bySlug.values()];
}

function nameFromSkillSlug(slug: string) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ") || slug;
}

function skillFromAttachedSlug(slug: string): SkillBrowserSkill {
  return {
    id: `attached-${slug}`,
    slug,
    name: nameFromSkillSlug(slug),
    description: "Attached to this agent class. Shared-brain metadata is not loaded yet.",
    source: "Agent class",
    category: "Attached",
    providerId: "shared",
    imported: true,
    capabilities: [],
    envKeys: [],
  };
}

function skillFromFusionResult(result: FusionSkillResult): SkillBrowserSkill {
  return {
    id: `shared-${result.skill.slug}`,
    slug: result.skill.slug,
    name: result.skill.name,
    description: result.skill.description,
    source: "Shared brain",
    category: "Ready",
    providerId: "shared",
    imported: true,
    sourceRef: result.skill.path,
    capabilities: [...new Set(result.capabilities.map((capability) => capability.kind))],
    envKeys: [],
  };
}

function CapRow({ skill }: { skill: SkillBrowserSkill }) {
  const caps = capabilityIds(skill);
  return (
    <div className="sb-caps">
      {caps.map((cap) => {
        const meta = SB_CAPS[cap];
        return (
          <span key={cap} className="sb-cap" data-risk={meta.risk}>
            <BIcon name={meta.icon} size={10} />{meta.label}
          </span>
        );
      })}
    </div>
  );
}

function CatalogCard({
  importing,
  onInstall,
  skill,
  agentMode,
  attached,
  onToggleAttach,
}: {
  importing: string;
  onInstall: (skill: SkillBrowserSkill) => void;
  skill: SkillBrowserSkill;
  agentMode?: boolean;
  attached?: boolean;
  onToggleAttach?: (skill: SkillBrowserSkill) => void;
}) {
  const busy = importing === skill.id;
  const needsHermes = Boolean(skill.requiresHermesUpdate);
  // In agent-class mode a card that's already in the shared brain offers an
  // Attach toggle (bind it to this agent class) instead of Install/Re-sync.
  const showAttach = Boolean(agentMode && (skill.imported || skill.providerId === "shared"));
  // Cards default to a fixed height (the description is clamped). When the copy
  // overflows that clamp we reveal an expand caret; expanding grows only this
  // card (the grid is align-items: start, so row-mates are unaffected).
  const descRef = React.useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [clamped, setClamped] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = descRef.current;
    if (!el || expanded) return;
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [skill.description, expanded]);
  return (
    <div className="sb-card">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <span className="fb-tile" style={{ width: 34, height: 34, color: needsHermes ? "var(--honey)" : "var(--fg-2)" }}>
          <BIcon name="sparkles" size={16} />
        </span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {needsHermes ? <Badge tone="honey"><BIcon name="refresh" size={10} />Hermes</Badge> : null}
          {showAttach && attached ? <Badge tone="honey"><BIcon name="check" size={10} />Attached</Badge>
            : skill.imported ? <Badge tone="live"><BIcon name="check" size={10} />Installed</Badge>
              : <Badge tone={sourceTone(skill)}>{skill.source || "Catalog"}</Badge>}
        </div>
      </div>
      <div className="body">
        <div className="sb-row-name">{skill.name}</div>
        <div className="sb-slug">{skill.slug}</div>
        <p ref={descRef} className={`sb-card-desc${expanded ? " sb-card-desc-expanded" : ""}`} style={{ marginTop: 9 }}>{skill.description || "No description provided yet."}</p>
        {clamped || expanded ? (
          <button type="button" className="sb-card-more" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            <BIcon name="chevron" size={12} />{expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
      </div>
      <CapRow skill={skill} />
      <div className="sb-cardfoot" style={{ borderTop: "1px solid var(--line)", paddingTop: 11 }}>
        <span className="sb-tag">{skill.category || skill.providerId || "Skill"}</span>
        {showAttach ? (
          <BBtn variant={attached ? "primary" : "ghost"} sm onClick={() => onToggleAttach?.(skill)}>
            <BIcon name={attached ? "check" : "plus"} size={13} />{attached ? "Attached" : "Attach"}
          </BBtn>
        ) : skill.imported ? (
          <BBtn sm onClick={() => onInstall(skill)}><BIcon name="refresh" size={13} />Re-sync</BBtn>
        ) : (
          <BBtn variant="primary" sm disabled={busy} onClick={() => onInstall(skill)}>
            <BIcon name={busy ? "sync" : "download"} size={13} />{busy ? "Installing..." : "Install"}
          </BBtn>
        )}
      </div>
    </div>
  );
}

function AttachList({
  attached,
  onToggle,
  skills,
}: {
  attached: Set<string>;
  onToggle: (skill: SkillBrowserSkill) => void;
  skills: SkillBrowserSkill[];
}) {
  if (!skills.length) return <div className="sb-empty">No matching shared skills.</div>;
  return (
    <div>
      {skills.map((skill) => {
        const on = attached.has(skill.slug);
        return (
          <div key={skill.id} className="sb-row">
            <span className="fb-tile" style={{ width: 34, height: 34, color: on ? "var(--honey)" : "var(--fg-3)" }}><BIcon name="sparkles" size={16} /></span>
            <div className="grow">
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="sb-row-name">{skill.name}</span>
                {skill.requiresHermesUpdate ? <Badge tone="honey">Needs Hermes</Badge> : null}
              </div>
              <p className="sb-card-desc">{skill.description || "No description provided yet."}</p>
            </div>
            <Toggle on={on} onChange={() => onToggle(skill)} />
          </div>
        );
      })}
    </div>
  );
}

function InstalledList({
  importing,
  removing,
  onConvert,
  onFlash,
  onRemove,
  onResync,
  search,
  skills,
}: {
  importing: string;
  removing: string;
  onConvert: (skill: SkillBrowserSkill) => void;
  onFlash: (message: string) => void;
  onRemove: (skill: SkillBrowserSkill) => void;
  onResync: (skill: SkillBrowserSkill) => void;
  search: string;
  skills: SkillBrowserSkill[];
}) {
  if (!skills.length) return <div className="sb-empty">{search ? `No installed skills match "${search}".` : "No skills installed yet."}</div>;
  return (
    <div>
      {skills.map((skill) => {
        const busy = importing === skill.id || removing === skill.id;
        return (
          <div key={skill.id} className="sb-row">
            <span className="fb-tile" style={{ width: 34, height: 34, color: skill.requiresHermesUpdate ? "var(--honey)" : "var(--live)" }}><BIcon name="sparkles" size={16} /></span>
            <div className="grow">
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="sb-row-name">{skill.name}</span>
                <span className="sb-slug" style={{ marginTop: 0 }}>{skill.slug}</span>
                {skill.requiresHermesUpdate ? <Badge tone="honey">Needs Hermes</Badge> : null}
              </div>
              <p className="sb-card-desc">{skill.description || "No description provided yet."}</p>
            </div>
            <div className="sb-actions">
              {skill.requiresHermesUpdate ? (
                <BBtn variant="primary" sm disabled={busy} onClick={() => onResync(skill)}><BIcon name={busy ? "sync" : "repeat"} size={13} />Update</BBtn>
              ) : (
                <BBtn sm disabled={busy} onClick={() => onConvert(skill)}><BIcon name={busy ? "sync" : "bot"} size={13} />To Aeon</BBtn>
              )}
              <button type="button" className="fb-iconbtn" title="Re-sync" onClick={() => onResync(skill)}><BIcon name="refresh" size={14} /></button>
              {skill.githubUrl || skill.skillMdUrl ? (
                <button
                  type="button"
                  className="fb-iconbtn"
                  title="Copy source"
                  onClick={() => {
                    void navigator.clipboard?.writeText(skill.githubUrl || skill.skillMdUrl || "");
                    onFlash(`Copied source for ${skill.name}.`);
                  }}
                >
                  <BIcon name="copy" size={14} />
                </button>
              ) : null}
              <button type="button" className="fb-iconbtn danger" title="Remove" onClick={() => onRemove(skill)}><BIcon name="trash" size={14} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Audit({ skills }: { skills: SkillBrowserSkill[] }) {
  return (
    <>
      <p style={{ fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.55, margin: 0, maxWidth: "64ch" }}>
        Every installed skill declares the tools it may touch. Review the surface before trusting a recipe across the hive.
      </p>
      <div className="sb-audit">
        <div className="sb-audit-row">
          <span className="fb-eyebrow">Skill</span>
          <span className="fb-eyebrow">Declared capabilities</span>
          <span className="fb-eyebrow" style={{ textAlign: "right" }}>Risk</span>
        </div>
        {skills.map((skill) => {
          const caps = capabilityIds(skill);
          const risk = sbRisk(caps, skill.auditStatus);
          return (
            <div key={skill.id} className="sb-audit-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{skill.name}</div>
                <div className="sb-slug" style={{ marginTop: 2 }}>{skill.sourceRef || skill.source}</div>
              </div>
              <CapRow skill={skill} />
              <div style={{ textAlign: "right" }}>
                <Badge tone={SB_RISK_TONE[risk]}>{risk === "high" ? "Elevated" : risk === "med" ? "Moderate" : "Low"}</Badge>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function SkillBrowserModal(props: SkillBrowserModalProps) {
  const {
    addAgentPreferredSkill,
    addWrittenSkillToBrain,
    agentSettingsPreferredSkills,
    convertSkillToAeon,
    hermesUpdateRequired,
    hermesUpdateRequiredDetail,
    importRemoteSkillToBrain,
    installGithubSkillToBrain,
    openAgentSkillBrowser,
    openSkillBrowser,
    removeAgentPreferredSkill,
    setSkillBrowserGithubUrl,
    setSkillBrowserOpen,
    setSkillBrowserSearch,
    setSkillBrowserView,
    setSkillBrowserWrittenContent,
    sharedVaultPath,
    skillBrowserGithubInstalling,
    skillBrowserGithubUrl,
    skillBrowserImporting,
    skillBrowserLoading,
    skillBrowserMode,
    skillBrowserOpen,
    skillBrowserSearch,
    skillBrowserSkills,
    skillBrowserStatus,
    skillBrowserView,
    skillBrowserWrittenContent,
    skillBrowserWriting,
    skillRequiresHermesUpdate,
  } = props;
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const [localStatus, setLocalStatus] = React.useState("");
  const [removingSkillId, setRemovingSkillId] = React.useState("");
  const agentMode = skillBrowserMode === "agent-class";
  const query = skillBrowserSearch.trim().toLowerCase();
  const browserRecords = React.useMemo(() => {
    const safeSkills = Array.isArray(skillBrowserSkills) ? skillBrowserSkills : [];
    return dedupeSkillRecords(safeSkills.map((skill) => ({
      ...skill,
      requiresHermesUpdate: skill.requiresHermesUpdate || skillRequiresHermesUpdate(skill, hermesUpdateRequired),
    })));
  }, [hermesUpdateRequired, skillBrowserSkills, skillRequiresHermesUpdate]);
  const sharedSlugSet = React.useMemo(() => new Set(browserRecords.filter(isSharedOrImportedSkill).map((skill) => skill.slug)), [browserRecords]);
  const sharedAttachableSkills = React.useMemo(() => browserRecords.filter(isSharedOrImportedSkill), [browserRecords]);
  const catalogSkills = browserRecords.filter((skill) => !isPackSkill(skill) && skillMatches(skill, query));
  const installedSkills = sharedAttachableSkills.filter((skill) => skillMatches(skill, query));
  const packSkills = browserRecords.filter(isPackSkill);
  const importableCount = browserRecords.filter((skill) => !isPackSkill(skill) && !skill.imported).length;
  const attached = React.useMemo(() => new Set(agentSettingsPreferredSkills), [agentSettingsPreferredSkills]);
  const refreshBrowser = agentMode ? openAgentSkillBrowser : openSkillBrowser;
  const status = localStatus || skillBrowserStatus;

  const close = React.useCallback(() => {
    setLocalStatus("");
    setRemovingSkillId("");
    setSkillBrowserOpen(false);
  }, [setSkillBrowserOpen]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const installSkill = React.useCallback((skill: SkillBrowserSkill) => {
    setLocalStatus("");
    void importRemoteSkillToBrain(skill);
  }, [importRemoteSkillToBrain]);

  const toggleAttach = React.useCallback((skill: SkillBrowserSkill) => {
    if (attached.has(skill.slug)) {
      removeAgentPreferredSkill(skill.slug);
      setLocalStatus(`Removed ${skill.name} from this agent class.`);
      return;
    }
    addAgentPreferredSkill(skill.slug);
    setLocalStatus(`Attached ${skill.name} to this agent class.`);
  }, [addAgentPreferredSkill, attached, removeAgentPreferredSkill]);

  const resyncSkill = React.useCallback((skill: SkillBrowserSkill) => {
    setLocalStatus("");
    if (skill.providerId && skill.providerId !== "shared") {
      void importRemoteSkillToBrain(skill);
      return;
    }
    void refreshBrowser();
    setLocalStatus(`Re-synced ${skill.name}.`);
  }, [importRemoteSkillToBrain, refreshBrowser]);

  const convertSkill = React.useCallback((skill: SkillBrowserSkill) => {
    if (!convertSkillToAeon) {
      setLocalStatus("Aeon conversion is not available for this runtime.");
      return;
    }
    setLocalStatus("");
    void convertSkillToAeon(skill);
  }, [convertSkillToAeon]);

  const removeSkill = React.useCallback(async (skill: SkillBrowserSkill) => {
    if (!sharedVaultPath?.trim()) {
      setLocalStatus("Turn on the shared brain before removing skills.");
      return;
    }
    const confirmed = await confirmUserAction(`Remove "${skill.name}" from the shared brain? HivemindOS archives the skill before deleting the active copy.`);
    if (!confirmed) return;
    setRemovingSkillId(skill.id);
    setLocalStatus("");
    const response = await fetch("/api/obsidian/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "remove-skill",
        vaultPath: sharedVaultPath.trim(),
        skillSlug: skill.slug,
        confirm: true,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    setRemovingSkillId("");
    if (!response?.ok || !data?.ok) {
      setLocalStatus(data?.error ?? "Could not remove that skill from the shared brain.");
      return;
    }
    setLocalStatus(`Removed ${skill.name} from the shared brain and archived the previous copy.`);
    void openSkillBrowser();
  }, [openSkillBrowser, sharedVaultPath]);

  const installGithub = React.useCallback((event: FormEvent<HTMLFormElement>) => {
    setLocalStatus("");
    void installGithubSkillToBrain(event);
  }, [installGithubSkillToBrain]);

  const writeSkill = React.useCallback(() => {
    setLocalStatus("");
    void addWrittenSkillToBrain();
  }, [addWrittenSkillToBrain]);

  const fusionCreated = React.useCallback((result: FusionSkillResult) => {
    setLocalStatus(`Created ${result.skill.slug} in the shared brain.`);
    void openSkillBrowser();
  }, [openSkillBrowser]);

  const fusionConvert = React.useCallback((result: FusionSkillResult) => {
    convertSkill(skillFromFusionResult(result));
  }, [convertSkill]);

  if (!portalTarget || !skillBrowserOpen) return null;

  return createPortal(
    <div className="sb-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="sb-modal" role="dialog" aria-modal="true" aria-labelledby="skill-browser-title">
        <div className="sb-head">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 13 }}>
            <span className="fb-tile" style={{ width: 40, height: 40, color: "var(--honey)" }}><BIcon name="sparkles" size={19} /></span>
            <div>
              <div className="fb-eyebrow">{agentMode ? "Skills · Agent class" : "Add to shared brain"}</div>
              <h3 id="skill-browser-title">{agentMode ? "Attach skills" : "Skill browser"}</h3>
              <p>{agentMode
                ? "Choose which shared-brain recipes this agent class may use. Attached skills load into every agent of this class."
                : "Browse, import, audit, author, and fuse operational recipes available to every agent in the hive."}</p>
            </div>
          </div>
          <button type="button" className="sb-x" onClick={close} aria-label="Close" style={{ transform: "rotate(45deg)" }}><BIcon name="plus" size={16} sw={2} /></button>
        </div>

        <div className="sb-tabbar">
          <div className="fb-seg sub" role="tablist" aria-label="Skill browser sections">
            {SB_TABS.map((tab) => (
              <button key={tab.id} type="button" role="tab" aria-selected={skillBrowserView === tab.id} data-active={skillBrowserView === tab.id ? "" : undefined} onClick={() => setSkillBrowserView(tab.id)}>
                <BIcon name={tab.icon} size={13} />{tab.label}
              </button>
            ))}
          </div>
          {(skillBrowserView === "catalog" || skillBrowserView === "installed") ? (
            <div className="sb-search">
              <span><BIcon name="search" size={14} /></span>
              <input value={skillBrowserSearch} onChange={(event) => setSkillBrowserSearch(event.target.value)} placeholder="Search skills" spellCheck={false} />
              {skillBrowserSearch ? <button type="button" className="sb-clear" aria-label="Clear" onClick={() => setSkillBrowserSearch("")}>x</button> : null}
            </div>
          ) : (
            <span />
          )}
        </div>

        <div className="sb-body fr-scroll fb-fade" key={skillBrowserView}>
          {skillBrowserView === "catalog" ? (
            <>
              <form className="sb-github" onSubmit={installGithub}>
                <span className="fb-tile" style={{ width: 32, height: 32 }}><BIcon name="branch" size={15} /></span>
                <input
                  value={skillBrowserGithubUrl}
                  onChange={(event) => setSkillBrowserGithubUrl(event.target.value)}
                  placeholder="github.com/owner/skill-repo · install from a repository"
                  aria-label="GitHub skill URL"
                />
                <BBtn type="submit" variant="primary" sm disabled={skillBrowserGithubInstalling || !skillBrowserGithubUrl.trim()}>
                  <BIcon name={skillBrowserGithubInstalling ? "sync" : "download"} size={13} />{skillBrowserGithubInstalling ? "Installing..." : "Install"}
                </BBtn>
              </form>
              {skillBrowserLoading ? <div className="sb-empty">Checking installed skills and catalogs...</div> : catalogSkills.length ? (
                <div className="sb-grid">
                  {catalogSkills.map((skill) => <CatalogCard key={skill.id} skill={skill} importing={skillBrowserImporting} onInstall={installSkill} agentMode={agentMode} attached={attached.has(skill.slug)} onToggleAttach={toggleAttach} />)}
                </div>
              ) : <div className="sb-empty">No skills match "{skillBrowserSearch}".</div>}
            </>
          ) : skillBrowserView === "installed" ? (
            <InstalledList
              skills={installedSkills}
              importing={skillBrowserImporting}
              removing={removingSkillId}
              onConvert={convertSkill}
              onFlash={setLocalStatus}
              onRemove={(skill) => void removeSkill(skill)}
              onResync={resyncSkill}
              search={skillBrowserSearch}
            />
          ) : skillBrowserView === "packs" ? (
            <div className="sb-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", alignItems: "stretch" }}>
              {packSkills.length ? packSkills.map((pack) => {
                const included = pack.includedSkills ?? [];
                const have = included.filter((skill) => sharedSlugSet.has(skill.slug)).length;
                const full = Boolean(included.length) && have === included.length;
                const busy = skillBrowserImporting === pack.id;
                return (
                  <div key={pack.id} className="sb-pack">
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <span className="fb-tile" style={{ width: 38, height: 38, color: full ? "var(--live)" : "var(--honey)" }}><BIcon name="hex" size={18} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 15.5 }}>{pack.name}</span>
                          <Badge tone={full ? "live" : undefined}>{have}/{included.length || "?"}</Badge>
                        </div>
                        <p style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5, margin: "7px 0 0" }}>{pack.description}</p>
                      </div>
                    </div>
                    {pack.audience ? <p className="sb-card-desc">{pack.audience}</p> : null}
                    <div className="chips">
                      {included.map((skill) => <span key={skill.slug} className="sb-chip" data-on={sharedSlugSet.has(skill.slug) ? "" : undefined}>{skill.name}</span>)}
                    </div>
                    {pack.safety ? <p className="sb-card-desc" style={{ color: "var(--honey)" }}>{pack.safety}</p> : null}
                    <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: "auto" }}>
                      <BBtn variant={full ? "ghost" : "primary"} sm disabled={full || busy} onClick={() => installSkill(pack)}>
                        <BIcon name={full ? "check" : busy ? "sync" : "download"} size={13} />{full ? "Installed" : busy ? "Installing..." : `Install ${Math.max((included.length || 1) - have, 1)}`}
                      </BBtn>
                    </div>
                  </div>
                );
              }) : <div className="sb-empty">No skill packs are available on this machine.</div>}
            </div>
          ) : skillBrowserView === "audit" ? (
            <Audit skills={installedSkills} />
          ) : skillBrowserView === "fusion" ? (
            <Fusion vaultPath={sharedVaultPath} onFlash={setLocalStatus} onCreated={fusionCreated} onConvertToAeon={fusionConvert} />
          ) : (
            <>
              <p style={{ fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.55, margin: 0, maxWidth: "64ch" }}>
                Author a skill in markdown with YAML frontmatter. It is written to the shared brain Skills folder and synced to every trusted machine.
              </p>
              <textarea
                className="sb-editor"
                value={skillBrowserWrittenContent}
                onChange={(event) => setSkillBrowserWrittenContent(event.target.value)}
                placeholder={SB_WRITE_TEMPLATE}
                spellCheck={false}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <BBtn sm onClick={() => setSkillBrowserWrittenContent(SB_WRITE_TEMPLATE)}><BIcon name="refresh" size={13} />Reset template</BBtn>
                <span style={{ fontSize: 11, color: "var(--fg-4)", fontFamily: "var(--f-mono)" }}>{skillBrowserWrittenContent.split(/\n/).filter(Boolean).length} lines</span>
                <BBtn variant="primary" sm style={{ marginLeft: "auto" }} disabled={skillBrowserWriting || !skillBrowserWrittenContent.trim()} onClick={writeSkill}>
                  <BIcon name={skillBrowserWriting ? "sync" : "check"} size={13} />{skillBrowserWriting ? "Writing..." : "Write to brain"}
                </BBtn>
              </div>
            </>
          )}
        </div>

        <div className="sb-foot">
          <span className="sb-status">
            {status ? <><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--live)", flex: "0 0 auto" }} />{status}</>
              : hermesUpdateRequired ? `Hermes update available: ${hermesUpdateRequiredDetail || "update-gated skills are marked."}`
                : agentMode ? `${attached.size} attached · ${sharedAttachableSkills.length} available in brain`
                  : `${installedSkills.length} installed · ${importableCount} importable`}
          </span>
          <BBtn variant="primary" sm onClick={close}><BIcon name="check" size={14} />Done</BBtn>
        </div>
      </section>
    </div>,
    portalTarget,
  );
}
