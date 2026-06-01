"use client";

import type { Dispatch, ElementType, FormEvent, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { cssClass } from "@/features/dashboard/style-classes";
import type { SkillBrowserSkill, SkillBrowserView } from "@/features/dashboard/dashboard-types";
import browserStyles from "./SkillBrowserModal.module.css";

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
  filteredSkillBrowserSkills: SkillBrowserSkill[];
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
  const { Button, Copy, Download, GitBranch, Image, LoaderCircle, Minus, Plus, RefreshCcw, Sparkles, addAgentPreferredSkill, addWrittenSkillToBrain, agentSettingsPreferredSkills, convertSkillToAeon, filteredSkillBrowserSkills, fleetClass, hermesUpdateRequired, hermesUpdateRequiredDetail, importRemoteSkillToBrain, installGithubSkillToBrain, openAgentSkillBrowser, openSkillBrowser, removeAgentPreferredSkill, setSkillBrowserGithubOpen, setSkillBrowserGithubUrl, setSkillBrowserOpen, setSkillBrowserSearch, setSkillBrowserView, setSkillBrowserWrittenContent, skillBrowserGithubInstalling, skillBrowserGithubOpen, skillBrowserGithubUrl, skillBrowserImporting, skillBrowserLoading, skillBrowserMode, skillBrowserOpen, skillBrowserSearch, skillBrowserStatus, skillBrowserView, skillBrowserWrittenContent, skillBrowserWriting, skillRequiresHermesUpdate, vaultClass } = props;
  const browserClass = (...names: Array<string | false | null | undefined>) => cssClass(browserStyles, ...names);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const viewFilteredSkills = filteredSkillBrowserSkills.filter((skill) => {
    if (skillBrowserView === "packs") return skill.category === "Pack" || skill.source === "Skill pack";
    if (skillBrowserView === "installed") return Boolean(skill.providerId || skill.imported);
    if (skillBrowserView === "audit") return Boolean(skill.auditStatus || skill.capabilities?.length || skill.envKeys?.length || skill.sourceRef);
    return skill.category !== "Pack" && skill.source !== "Skill pack";
  });
  const browserSkills = skillBrowserMode === "agent-class"
    ? filteredSkillBrowserSkills.filter((skill) => skill.providerId === "shared")
    : viewFilteredSkills;

  if (!portalTarget) return null;

  return createPortal((<>
      {skillBrowserOpen ? (
        <div
          className={fleetClass("setupModalBackdrop")}
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
            {skillBrowserView !== "write" ? <div className={fleetClass("skillBrowserSearch")}>
              <input
                value={skillBrowserSearch}
                onChange={(event) => setSkillBrowserSearch(event.target.value)}
                placeholder="Search skills, tools, runtimes, workflows..."
                autoFocus
              />
              {skillBrowserMode === "brain" ? (["catalog", "installed", "packs", "audit"] as const).map((view) => (
                <Button
                  key={view}
                  type="button"
                  variant={skillBrowserView === view ? "default" : "secondary"}
                  size="sm"
                  onClick={() => setSkillBrowserView(view)}
                >
                  {view === "catalog" ? "Catalog" : view === "installed" ? "Installed" : view === "packs" ? "Packs" : "Audit"}
                </Button>
              )) : null}
              {skillBrowserMode === "brain" ? <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setSkillBrowserGithubOpen((open) => !open)}
                disabled={skillBrowserGithubInstalling}
              >
                <GitBranch aria-hidden="true" />
                Install From Github
              </Button> : null}
              {skillBrowserMode === "brain" ? <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSkillBrowserGithubOpen(false);
                  setSkillBrowserView("write");
                }}
              >
                <Sparkles aria-hidden="true" />
                Write Skill
              </Button> : null}
              <Button type="button" variant="secondary" size="sm" onClick={skillBrowserMode === "agent-class" ? openAgentSkillBrowser : openSkillBrowser} disabled={skillBrowserLoading}>
                {skillBrowserLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
                Refresh
              </Button>
            </div> : null}
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
            <div className={fleetClass("skillBrowserGrid")}>
              {skillBrowserLoading ? (
                <div className={fleetClass("scheduleEmpty")}><LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /><strong>Loading skills</strong><p>Checking installed skills and community catalogs.</p></div>
              ) : browserSkills.length ? browserSkills.map((skill) => {
                const needsHermesUpdate = skill.requiresHermesUpdate || skillRequiresHermesUpdate(skill, hermesUpdateRequired);
                const addedToAgent = agentSettingsPreferredSkills.includes(skill.slug);
                const isPack = skill.category === "Pack" || skill.source === "Skill pack";
                const includedSkills = skill.includedSkills ?? [];
                return (
                  <article key={`${skill.source}-${skill.id}`} className={fleetClass("skillBrowserCard", isPack ? browserClass("skillBrowserPackCard") : "")}>
                    <div className={fleetClass("skillBrowserMetaRow")}>
                      <Image src="/icons/worker-bee-general-v2.png" alt="" width={24} height={24} unoptimized />
                      <span>{skill.source}{skill.category ? ` · ${skill.category}` : ""}</span>
                      {isPack && includedSkills.length ? <small className={browserClass("skillPackCountBadge")}>{includedSkills.length} skills</small> : null}
                      {needsHermesUpdate ? <small className={fleetClass("skillUpdateBadge")}>Needs Hermes update</small> : null}
                    </div>
                    <strong>{skill.name}</strong>
                    <p>{skill.description || "No description provided yet."}</p>
                    {skill.audience ? <p className={browserClass("skillBrowserAudience")}>{skill.audience}</p> : null}
                    {skill.capabilities?.length ? (
                      <div className={browserClass("skillCapabilityRow")} aria-label="Skill capabilities">
                        {skill.capabilities.slice(0, 8).map((capability) => <small key={capability}>{capability}</small>)}
                      </div>
                    ) : null}
                    {includedSkills.length ? (
                      <div className={browserClass("skillPackPreview")}>
                        {includedSkills.slice(0, 6).map((includedSkill) => (
                          <div key={includedSkill.slug}>
                            <strong>{includedSkill.name}</strong>
                            <p>{includedSkill.description}</p>
                          </div>
                        ))}
                        {includedSkills.length > 6 ? <small>+{includedSkills.length - 6} more in this directory</small> : null}
                      </div>
                    ) : null}
                    {skill.safety ? <p className={browserClass("skillSafetyNote")}>{skill.safety}</p> : null}
                    {skill.auditStatus || (!isPack && skill.capabilities?.length) || skill.envKeys?.length || skill.sourceRef ? (
                      <p>
                        {skill.auditStatus ? `Audit: ${skill.auditStatus}. ` : ""}
                        {!isPack && skill.capabilities?.length ? `Capabilities: ${skill.capabilities.slice(0, 5).join(", ")}. ` : ""}
                        {skill.envKeys?.length ? `Env: ${skill.envKeys.slice(0, 4).join(", ")}. ` : ""}
                        {skill.sourceRef ? `Source: ${skill.sourceRef}.` : ""}
                      </p>
                    ) : null}
                    <div className={fleetClass("scheduleActions")}>
                      {skillBrowserMode === "agent-class" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant={addedToAgent ? "danger" : "default"}
                          className={addedToAgent ? fleetClass("skillBrowserRemoveSkillButton") : ""}
                          onClick={() => addedToAgent ? removeAgentPreferredSkill(skill.slug) : addAgentPreferredSkill(skill.slug)}
                        >
                          {addedToAgent ? <Minus aria-hidden="true" /> : <Plus aria-hidden="true" />}
                          {addedToAgent ? "Remove" : "Add Skill"}
                        </Button>
                      ) : (
                        <Button type="button" size="sm" onClick={() => void importRemoteSkillToBrain(skill)} disabled={skill.imported || skillBrowserImporting === skill.id}>
                          {skillBrowserImporting === skill.id ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />}
                          {skill.imported ? "In brain" : isPack ? "Install pack" : "Add to brain"}
                        </Button>
                      )}
                      {skillBrowserMode === "brain" && skill.imported && convertSkillToAeon ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => void convertSkillToAeon(skill)}>
                          <Sparkles aria-hidden="true" />
                          Convert to Aeon
                        </Button>
                      ) : null}
                      {skill.githubUrl || skill.skillMdUrl ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(skill.githubUrl || skill.skillMdUrl || "")}>
                          <Copy aria-hidden="true" />
                          Copy source
                        </Button>
                      ) : null}
                    </div>
                  </article>
                );
              }) : (
                <div className={fleetClass("scheduleEmpty")}><Sparkles aria-hidden="true" /><strong>No skills found</strong><p>{skillBrowserMode === "agent-class" ? "Try a different search, or add shared skills to the brain first." : "Try another tab, refresh the catalog, or import from provider installs below the shared skills shelf."}</p></div>
              )}
            </div>
            )}
          </section>
        </div>
      ) : null}
  </>), portalTarget);
}
