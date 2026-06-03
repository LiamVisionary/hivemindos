"use client";

import type { Dispatch, ElementType, FormEvent, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { Btn } from "@/components/aeon/parts";
import { AeonSkillBrowserSection, type UnifiedSkillBrowserItem, type UnifiedSkillBrowserSource } from "@/components/aeon/skill-browser-section";
import type { SkillBrowserSkill, SkillBrowserView } from "@/features/dashboard/dashboard-types";

type SkillBrowserModalProps = {
  Button: ElementType;
  Copy: ElementType;
  Download: ElementType;
  GitBranch: ElementType;
  Image: ElementType;
  LoaderCircle: ElementType;
  Minus: ElementType;
  Plus: ElementType;
  RefreshCcw: ElementType;
  Sparkles: ElementType;
  addWrittenSkillToBrain: () => void | Promise<void>;
  skillBrowserSkills: SkillBrowserSkill[];
  fleetClass: (...names: string[]) => string;
  hermesUpdateRequired: boolean;
  hermesUpdateRequiredDetail: string;
  importRemoteSkillToBrain: (skill: SkillBrowserSkill) => void | Promise<void>;
  convertSkillToAeon?: (skill: SkillBrowserSkill) => void | Promise<void>;
  installGithubSkillToBrain: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  openSkillBrowser: () => void | Promise<void>;
  openAgentSkillBrowser: () => void | Promise<void>;
  addAgentPreferredSkill: (slug: string) => void;
  removeAgentPreferredSkill: (slug: string) => void;
  setSkillBrowserGithubOpen: Dispatch<SetStateAction<boolean>>;
  setSkillBrowserGithubUrl: Dispatch<SetStateAction<string>>;
  setSkillBrowserOpen: Dispatch<SetStateAction<boolean>>;
  setSkillBrowserSearch: Dispatch<SetStateAction<string>>;
  skillBrowserGithubInstalling: boolean;
  skillBrowserGithubOpen: boolean;
  skillBrowserGithubUrl: string;
  skillBrowserImporting: string;
  skillBrowserLoading: boolean;
  skillBrowserMode: "brain" | "agent-class";
  skillBrowserOpen: boolean;
  skillBrowserSearch: string;
  skillBrowserStatus: string;
  skillBrowserView: SkillBrowserView;
  skillBrowserWrittenContent: string;
  skillBrowserWriting: boolean;
  skillRequiresHermesUpdate: (skill: SkillBrowserSkill, hermesUpdateRequired: boolean) => boolean;
  agentSettingsPreferredSkills: string[];
  setSkillBrowserView: Dispatch<SetStateAction<SkillBrowserView>>;
  setSkillBrowserWrittenContent: Dispatch<SetStateAction<string>>;
  vaultClass: (...names: string[]) => string;
};

export function SkillBrowserModal(props: SkillBrowserModalProps) {
  const { Button, Copy, Download, GitBranch, Image, LoaderCircle, RefreshCcw, addAgentPreferredSkill, addWrittenSkillToBrain, agentSettingsPreferredSkills, convertSkillToAeon, fleetClass, hermesUpdateRequired, hermesUpdateRequiredDetail, importRemoteSkillToBrain, installGithubSkillToBrain, openAgentSkillBrowser, openSkillBrowser, removeAgentPreferredSkill, setSkillBrowserGithubOpen, setSkillBrowserGithubUrl, setSkillBrowserOpen, setSkillBrowserSearch, setSkillBrowserView, setSkillBrowserWrittenContent, skillBrowserGithubInstalling, skillBrowserGithubOpen, skillBrowserGithubUrl, skillBrowserImporting, skillBrowserLoading, skillBrowserMode, skillBrowserOpen, skillBrowserSearch, skillBrowserStatus, skillBrowserView, skillBrowserWrittenContent, skillBrowserWriting, skillRequiresHermesUpdate, skillBrowserSkills, vaultClass } = props;
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const safeSkillBrowserSkills = Array.isArray(skillBrowserSkills) ? skillBrowserSkills : [];
  const browserSkillRecords = skillBrowserMode === "agent-class"
    ? safeSkillBrowserSkills.filter((skill) => skill.providerId === "shared")
    : safeSkillBrowserSkills;
  const skillById = new Map(browserSkillRecords.map((skill) => [skill.id, skill]));
  const browserItems: UnifiedSkillBrowserItem[] = browserSkillRecords.map((skill) => {
    const isPack = skill.category === "Pack" || skill.source === "Skill pack";
    const normalizedCategory = skill.category?.trim();
    const browserCategory = normalizedCategory && normalizedCategory.toLowerCase() !== "ready"
      ? normalizedCategory
      : isPack
        ? "Pack"
        : "Skill";
    const needsHermesUpdate = skill.requiresHermesUpdate || skillRequiresHermesUpdate(skill, hermesUpdateRequired);
    const addedToAgent = agentSettingsPreferredSkills.includes(skill.slug);
    const stateLabel = skillBrowserMode === "agent-class"
      ? addedToAgent ? "Added" : needsHermesUpdate ? "Needs Hermes" : "Shared Brain"
      : skill.imported ? "In brain" : needsHermesUpdate ? "Needs Hermes" : isPack ? "Pack" : "Catalog";
    return {
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      source: skill.source,
      sourceId: skill.providerId ?? skill.source,
      sourceKind: skill.source,
      providerId: skill.providerId,
      category: browserCategory,
      categoryId: browserCategory,
      stateLabel,
      stateTone: addedToAgent || skill.imported ? "green" : needsHermesUpdate ? "honey" : isPack ? "sky" : "muted",
      stateIcon: addedToAgent || skill.imported ? "check" : needsHermesUpdate ? "refresh" : isPack ? "layers" : undefined,
      stateActive: addedToAgent || skill.imported,
      capabilities: skill.capabilities,
      envKeys: skill.envKeys,
      audience: skill.audience,
      safety: skill.safety,
      auditStatus: skill.auditStatus,
      sourceRef: skill.sourceRef,
      includedSkills: skill.includedSkills,
      imported: skill.imported,
      requiresHermesUpdate: needsHermesUpdate,
      selected: addedToAgent,
      scheduleLabel: skill.source,
    };
  });
  const browserSources: UnifiedSkillBrowserSource[] = skillBrowserMode === "brain" ? [
    { id: "catalog", label: "Catalog", predicate: (item) => item.categoryId !== "Pack" && item.sourceKind !== "Skill pack" },
    { id: "installed", label: "Installed", predicate: (item) => Boolean(item.providerId || item.imported) },
    { id: "packs", label: "Packs", predicate: (item) => item.categoryId === "Pack" || item.sourceKind === "Skill pack" },
    { id: "audit", label: "Audit", predicate: (item) => Boolean(item.auditStatus || item.capabilities?.length || item.envKeys?.length || item.sourceRef) },
  ] : [
    { id: "shared", label: "Shared Brain", predicate: (item) => item.providerId === "shared" || item.sourceId === "shared" },
  ];
  const refreshBrowser = skillBrowserMode === "agent-class" ? openAgentSkillBrowser : openSkillBrowser;
  const addedSkillCount = browserItems.filter((item) => item.selected).length;
  const importedSkillCount = browserItems.filter((item) => item.imported).length;
  const browserSectionTitle = skillBrowserMode === "agent-class"
    ? `${browserItems.length} available · ${addedSkillCount} added`
    : `${browserItems.length} available · ${importedSkillCount} in brain`;
  const browserSectionActions = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
      {skillBrowserMode === "brain" ? (
        <Btn
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setSkillBrowserGithubOpen((open) => !open)}
          disabled={skillBrowserGithubInstalling}
        >
          <GitBranch aria-hidden="true" />
          Install From Github
        </Btn>
      ) : null}
      {skillBrowserMode === "brain" ? (
        <Btn
          type="button"
          variant="secondary"
          size="sm"
          icon="sparkles"
          onClick={() => {
            setSkillBrowserGithubOpen(false);
            setSkillBrowserView("write");
          }}
        >
          Write Skill
        </Btn>
      ) : null}
      <Btn type="button" variant="secondary" size="sm" onClick={() => void refreshBrowser()} disabled={skillBrowserLoading}>
        {skillBrowserLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
        Refresh
      </Btn>
    </div>
  );

  const renderSkillActions = (item: UnifiedSkillBrowserItem) => {
    const skill = skillById.get(item.id);
    if (!skill) return null;
    const addedToAgent = agentSettingsPreferredSkills.includes(skill.slug);
    const isPack = skill.category === "Pack" || skill.source === "Skill pack";
    return (
      <>
        {skillBrowserMode === "agent-class" ? (
          <Btn
            type="button"
            size="sm"
            variant={addedToAgent ? "danger" : "primary"}
            icon={addedToAgent ? "x" : "plus"}
            onClick={() => addedToAgent ? removeAgentPreferredSkill(skill.slug) : addAgentPreferredSkill(skill.slug)}
          >
            {addedToAgent ? "Remove" : "Add Skill"}
          </Btn>
        ) : (
          <Btn type="button" size="sm" variant="primary" onClick={() => void importRemoteSkillToBrain(skill)} disabled={skill.imported || skillBrowserImporting === skill.id}>
            {skillBrowserImporting === skill.id ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />}
            {skill.imported ? "In brain" : isPack ? "Install pack" : "Add to brain"}
          </Btn>
        )}
        {skillBrowserMode === "brain" && skill.imported && convertSkillToAeon ? (
          <Btn type="button" size="sm" variant="secondary" icon="sparkles" onClick={() => void convertSkillToAeon(skill)}>
            Convert to Aeon
          </Btn>
        ) : null}
        {skill.githubUrl || skill.skillMdUrl ? (
          <Btn type="button" size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(skill.githubUrl || skill.skillMdUrl || "")}>
            <Copy aria-hidden="true" />
            Copy source
          </Btn>
        ) : null}
      </>
    );
  };

  if (!portalTarget) return null;

  return createPortal((<>
      {skillBrowserOpen ? (
        <div
          className={fleetClass("setupModalBackdrop")}
          style={{ zIndex: 120 }}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSkillBrowserOpen(false);
          }}
        >
          <section className={fleetClass("setupModal", "skillBrowserModal")} role="dialog" aria-modal="true" aria-labelledby="skill-browser-title">
            <div className={fleetClass("setupModalHeader")}>
              <div className={fleetClass("skillBrowserTitle")}>
                <Image src="/icons/queen-bee-v2.png" alt="" width={46} height={46} unoptimized />
                <div>
                  <p className="eyebrow">Shared brain</p>
                  <h2 id="skill-browser-title">Skill Browser</h2>
                  <p>{skillBrowserMode === "agent-class" ? "Add shared-brain skills to this agent class." : "Add reusable operational skills to the shared Obsidian brain."}</p>
                </div>
              </div>
              <CloseIconButton aria-label="Close skill browser" onClick={() => setSkillBrowserOpen(false)} />
            </div>
            {skillBrowserMode === "brain" && skillBrowserView === "catalog" && skillBrowserGithubOpen ? (
              <form className={fleetClass("skillBrowserGithubForm")} onSubmit={(event) => void installGithubSkillToBrain(event)}>
                <input
                  value={skillBrowserGithubUrl}
                  onChange={(event) => setSkillBrowserGithubUrl(event.target.value)}
                  placeholder="https://github.com/owner/repo/tree/main/skills/example"
                  aria-label="GitHub skill URL"
                />
                <Button type="submit" disabled={skillBrowserGithubInstalling || !skillBrowserGithubUrl.trim()}>
                  {skillBrowserGithubInstalling ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />}
                  {skillBrowserGithubInstalling ? "Installing" : "Install"}
                </Button>
              </form>
            ) : null}
            {skillBrowserStatus || hermesUpdateRequired ? (
              <div className={fleetClass("skillBrowserNotices")}>
                {skillBrowserStatus ? <p className={fleetClass("skillBrowserStatus")}>{skillBrowserStatus}</p> : null}
                {hermesUpdateRequired ? (
                  <p className={fleetClass("skillBrowserStatus", "skillBrowserWarning")}>Hermes update available: {hermesUpdateRequiredDetail}. Update-gated skills are marked before you add them to the brain.</p>
                ) : null}
              </div>
            ) : null}
            {skillBrowserView === "write" ? (
              <div className={fleetClass("skillWriterPanel")}>
                <textarea
                  value={skillBrowserWrittenContent}
                  onChange={(event) => setSkillBrowserWrittenContent(event.target.value)}
                  placeholder={[
                    "---",
                    "name: My Skill",
                    "description: Use when...",
                    "---",
                    "",
                    "# My Skill",
                    "",
                    "## When to use",
                    "",
                    "## Steps",
                    "",
                    "## Notes",
                  ].join("\n")}
                  autoFocus
                />
                <div className={fleetClass("setupModalActions", "skillWriterActions")}>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setSkillBrowserWrittenContent("");
                      setSkillBrowserView("catalog");
                    }}
                    disabled={skillBrowserWriting}
                  >
                    Cancel
                  </Button>
                  <Button type="button" onClick={() => void addWrittenSkillToBrain()} disabled={skillBrowserWriting || !skillBrowserWrittenContent.trim()}>
                    {skillBrowserWriting ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />}
                    Add Skill
                  </Button>
                </div>
              </div>
            ) : (
              <AeonSkillBrowserSection
                title={browserSectionTitle}
                action={browserSectionActions}
                items={browserItems}
                sources={browserSources}
                controlledSourceId={skillBrowserMode === "brain" ? skillBrowserView : "shared"}
                onSourceChange={(view) => setSkillBrowserView(view as SkillBrowserView)}
                query={skillBrowserSearch}
                onQueryChange={setSkillBrowserSearch}
                searchPlaceholder="Search skills"
                loading={skillBrowserLoading}
                loadingLabel="Checking installed skills and community catalogs"
                emptyTitle="No skills found"
                emptyDescription={skillBrowserMode === "agent-class" ? "Try a different search, or add shared skills to the brain first." : "Try another tab, refresh the catalog, or import from provider installs below the shared skills shelf."}
                renderActions={renderSkillActions}
              />
            )}
          </section>
        </div>
      ) : null}
  </>), portalTarget);
}
