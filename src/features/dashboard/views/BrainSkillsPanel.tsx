// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./BrainSkillsPanel.module.css";

const skillsClass = (...classes) => classes.map((className) => styles[className]).filter(Boolean).join(" ");

export function BrainSkillsPanel(props: any) {
  const {
    Button,
    Check,
    Download,
    LoaderCircle,
    RefreshCcw,
    Repeat2,
    Search,
    Sparkles,
    brainSkillAeonSyncing,
    brainSkillImportAllDescription,
    brainSkillImportAllLabel,
    brainSkillImportProvider,
    brainSkillImportSuccess,
    brainSkillImportableCount,
    brainSkills,
    brainSkillsLoading,
    brainSkillsStatus,
    hermesUpdateRequired,
    hermesUpdateRequiredDetail,
    importBrainSkills,
    openSkillBrowser,
    providerSkillInventories,
    providerSkillSummary,
    refreshBrainSkills,
    setSkillBrowserSearch,
    sharedBrainSkills,
    sharedVault,
    skillBrowserSearch,
    skillRequiresHermesUpdate,
    syncBrainSkillsToAeon,
    updateAllSkillAutoSync,
    updateSkillAutoSync,
    vaultClass,
  } = props;
  const autoRefreshRef = useRef(false);
  const localSharedLoadingRef = useRef(false);
  const [localSharedInventory, setLocalSharedInventory] = useState<any | null>(null);
  const [localSharedLoading, setLocalSharedLoading] = useState(false);
  const skillSearchQuery = (skillBrowserSearch ?? "").trim().toLowerCase();
  const hasSkillInventory = useMemo(() => {
    const sharedCount = brainSkills?.shared?.length ?? 0;
    const providerCount = (brainSkills?.providers ?? []).reduce((total, provider) => total + (provider.skills?.length ?? 0), 0);
    return Boolean(sharedCount || providerCount || (brainSkills?.totals?.shared ?? 0) || (brainSkills?.totals?.importable ?? 0));
  }, [brainSkills]);
  const hasSharedSkillInventory = Boolean((brainSkills?.shared?.length ?? 0) || (brainSkills?.totals?.shared ?? 0) || (localSharedInventory?.shared?.length ?? 0) || (localSharedInventory?.totals?.shared ?? 0));
  const canReadSharedSkills = sharedVault.enabled || Boolean(sharedVault.vaultPath?.trim());
  useEffect(() => {
    if (autoRefreshRef.current || brainSkillsLoading || hasSkillInventory) return;
    autoRefreshRef.current = true;
    void refreshBrainSkills();
  }, [brainSkillsLoading, hasSkillInventory, refreshBrainSkills]);
  useEffect(() => {
    if (hasSharedSkillInventory || localSharedLoadingRef.current || !canReadSharedSkills) return;
    localSharedLoadingRef.current = true;
    setLocalSharedLoading(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    const params = new URLSearchParams();
    if (sharedVault.vaultPath?.trim()) params.set("vaultPath", sharedVault.vaultPath.trim());
    params.set("shared", "1");
    fetch(`/api/obsidian/skills?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data?.ok) setLocalSharedInventory(data);
      })
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(timeout);
        localSharedLoadingRef.current = false;
        setLocalSharedLoading(false);
      });
    return () => {
      window.clearTimeout(timeout);
      localSharedLoadingRef.current = false;
      setLocalSharedLoading(false);
      controller.abort();
    };
  }, [canReadSharedSkills, hasSharedSkillInventory, sharedVault.vaultPath]);
  const localSharedCount = localSharedInventory?.totals?.shared ?? localSharedInventory?.shared?.length ?? 0;
  const effectiveBrainSkills = {
    ...(brainSkills ?? localSharedInventory ?? {}),
    shared: (brainSkills?.shared?.length ?? 0) ? brainSkills.shared : (localSharedInventory?.shared ?? brainSkills?.shared ?? []),
    totals: {
      ...(brainSkills?.totals ?? localSharedInventory?.totals ?? {}),
      shared: Math.max(brainSkills?.totals?.shared ?? 0, brainSkills?.shared?.length ?? 0, localSharedCount),
      importable: brainSkills?.totals?.importable ?? localSharedInventory?.totals?.importable ?? 0,
      providerSkills: brainSkills?.totals?.providerSkills ?? localSharedInventory?.totals?.providerSkills ?? 0,
    },
  };
  const effectiveSharedBrainSkills = effectiveBrainSkills.shared ?? sharedBrainSkills ?? [];
  const sharedFiltered = effectiveSharedBrainSkills.filter((skill) => {
    if (!skillSearchQuery) return true;
    return [skill.name, skill.slug, skill.description, skill.providerLabel, skill.relativePath]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(skillSearchQuery);
  });
  const importableTotal = effectiveBrainSkills?.totals.importable ?? 0;
  const availableTotal = skillSearchQuery
    ? sharedFiltered.length
    : Math.max(sharedFiltered.length, effectiveBrainSkills?.totals.shared ?? 0);
  const sharedInventoryPending = canReadSharedSkills
    && !hasSharedSkillInventory
    && (brainSkillsLoading || localSharedLoading || !brainSkills);
  const catalogMeta = sharedInventoryPending && !skillSearchQuery
    ? `Scanning available skills${importableTotal ? ` - ${importableTotal} importable` : ""}`
    : `${availableTotal} available - ${importableTotal} importable`;

  return (
    <section className={skillsClass("fade")} aria-label="Shared brain skills">
      <div className={skillsClass("header")}>
        <div>
          <p className={skillsClass("eyebrow")}>Shared skills</p>
          <h3>Operational recipes in the brain</h3>
          <p>The shared brain is the main skills shelf. Provider installs are scanned below and can be mirrored into Obsidian.</p>
        </div>
        <div className={skillsClass("actions")}>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={skillsClass("actionButton")}
            onClick={() => void syncBrainSkillsToAeon()}
            disabled={brainSkillAeonSyncing || !sharedVault.enabled || !(effectiveBrainSkills?.shared?.length ?? 0)}
          >
            {brainSkillAeonSyncing ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Repeat2 aria-hidden="true" />}
            {brainSkillAeonSyncing ? "Syncing Aeon" : "Sync to Aeon"}
          </Button>
          <Button type="button" size="sm" variant="secondary" className={skillsClass("actionButton")} onClick={refreshBrainSkills} disabled={brainSkillsLoading || Boolean(brainSkillImportProvider)}>
            {brainSkillsLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
            {brainSkillsLoading ? "Scanning" : "Refresh skills"}
          </Button>
        </div>
      </div>

      {hermesUpdateRequired ? (
        <p className={skillsClass("notice")}>Hermes update available: {hermesUpdateRequiredDetail}. Skills using the newest Hermes features are marked below.</p>
      ) : null}

      {brainSkillsLoading ? (
        <p className={skillsClass("loadingNotice")} aria-live="polite">
          <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} />
          {brainSkillsStatus || "Reading shared brain skills and provider installs."}
        </p>
      ) : null}

      <div className={skillsClass("card", "catalog")}>
        <div className={skillsClass("catalogTop")}>
          <div className={skillsClass("catalogTitle")}>
            <span className={skillsClass("tile")}><Sparkles aria-hidden="true" /></span>
            <div>
              <p className={skillsClass("eyebrow")}>Skills</p>
              <div className={skillsClass("catalogMeta")}>{catalogMeta}</div>
            </div>
          </div>
          <div className={skillsClass("actions")}>
            <label className={skillsClass("searchWrap")}>
              <Search aria-hidden="true" />
              <input
                value={skillBrowserSearch}
                onChange={(event) => setSkillBrowserSearch(event.target.value)}
                placeholder="Search skills"
                aria-label="Search skills"
              />
            </label>
            <Button type="button" size="sm" variant="secondary" className={skillsClass("actionButton", "actionButtonSmall")} onClick={openSkillBrowser}>
              <Sparkles aria-hidden="true" />
              Add skill
            </Button>
          </div>
        </div>
        <div className={skillsClass("skillGrid")}>
          {(brainSkillsLoading || sharedInventoryPending) && !sharedFiltered.length ? Array.from({ length: 6 }).map((_, index) => (
            <article key={`loading-${index}`} className={skillsClass("skillCard", "skillSkeleton")} aria-hidden="true">
              <div className={skillsClass("skillTop")}>
                <span className={skillsClass("tile")} />
                <span className={skillsClass("badge")} />
              </div>
              <div className={skillsClass("skeletonLine", "skeletonTitle")} />
              <div className={skillsClass("skeletonLine", "skeletonMeta")} />
              <div className={skillsClass("skeletonLine")} />
              <div className={skillsClass("skeletonLine", "skeletonShort")} />
            </article>
          )) : null}
          {sharedFiltered.map((skill) => {
            const needsHermesUpdate = skillRequiresHermesUpdate(skill, hermesUpdateRequired);
            return (
              <article key={skill.id ?? skill.slug} className={skillsClass("skillCard")}>
                <div className={skillsClass("skillTop")}>
                  <span className={skillsClass("tile")}><Sparkles aria-hidden="true" /></span>
                  <span className={skillsClass("badge", needsHermesUpdate && "badgeHoney")}>
                    {needsHermesUpdate ? "Needs Hermes" : <><Check aria-hidden="true" />Shared</>}
                  </span>
                </div>
                <div>
                  <div className={skillsClass("skillName")}>{skill.name}</div>
                  <div className={skillsClass("skillSlug")}>{skill.slug}</div>
                </div>
                <p>{skill.description || "No description yet."}</p>
                <Button type="button" size="sm" variant="secondary" onClick={needsHermesUpdate ? () => void syncBrainSkillsToAeon() : refreshBrainSkills}>
                  {needsHermesUpdate ? <Repeat2 aria-hidden="true" /> : <RefreshCcw aria-hidden="true" />}
                  {needsHermesUpdate ? "Update via Hermes" : "Re-sync"}
                </Button>
              </article>
            );
          })}
          {!sharedFiltered.length && !brainSkillsLoading && !sharedInventoryPending ? <p className={skillsClass("empty")}>{skillSearchQuery ? "No matching shared skills." : "No shared skills yet."}</p> : null}
        </div>
      </div>

      <div className={skillsClass("card", "providerRow")}>
        <div className={skillsClass("providerIntro")}>
          <strong>Provider installs</strong>
          <span>{providerSkillSummary}</span>
        </div>
        <label className={skillsClass("autoAll")}>
          <input
            type="checkbox"
            checked={sharedVault.skillAutoSyncAll}
            onChange={(event) => void updateAllSkillAutoSync(event.target.checked)}
          />
          <span>Auto-import all provider skills</span>
        </label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void importBrainSkills("all")}
          disabled={Boolean(brainSkillImportProvider) || !brainSkillImportableCount}
          title={brainSkillImportAllDescription}
          aria-label={brainSkillImportAllDescription}
        >
          {brainSkillImportProvider === "all" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : brainSkillImportSuccess === "all" ? <Check aria-hidden="true" /> : <Download aria-hidden="true" />}
          {brainSkillImportProvider === "all" ? "Importing missing skills" : brainSkillImportSuccess === "all" ? "Missing skills imported" : brainSkillImportAllLabel}
        </Button>
      </div>

      <div className={skillsClass("providerGrid")}>
        {providerSkillInventories.map((provider) => {
          const importable = provider.skills.filter((skill) => !skill.imported).length;
          const imported = provider.skills.length - importable;
          const updateRequiredCount = provider.skills.filter((skill) => skillRequiresHermesUpdate({ ...skill, providerId: provider.id, source: provider.label }, hermesUpdateRequired)).length;
          const autoSyncPolicy = sharedVault.skillAutoSyncAll
            ? { autoImport: true, autoUpdate: true, trackRemovals: true, allowDelete: false }
            : sharedVault.skillAutoSync?.[provider.id] ?? { autoImport: false, autoUpdate: false, trackRemovals: false, allowDelete: false };
          const providerStatus = !provider.installed
            ? `No ${provider.home} install found`
            : importable > 0 && imported > 0
              ? `${importable} ready - ${imported} shared`
              : importable > 0
                ? `${importable} ready to import`
                : imported > 0
                  ? `${imported} in shared brain`
                  : "No skills found";
          const pending = brainSkillImportProvider === provider.id;
          const success = brainSkillImportSuccess === provider.id;
          return (
            <article key={provider.id} className={skillsClass("card", "providerCard")}>
              <div className={skillsClass("providerTop")}>
                <span>{provider.label}</span>
                <strong>{provider.skills.length}</strong>
              </div>
              <div className={skillsClass("providerStatus")}>{providerStatus}</div>
              {updateRequiredCount ? <div className={skillsClass("providerWarn")}>{updateRequiredCount} need Hermes update</div> : null}
              <div className={skillsClass("providerToggles")}>
                <label>
                  <input
                    type="checkbox"
                    checked={autoSyncPolicy.autoImport}
                    disabled={sharedVault.skillAutoSyncAll}
                    onChange={(event) => void updateSkillAutoSync(provider.id, {
                      autoImport: event.target.checked,
                      autoUpdate: event.target.checked ? autoSyncPolicy.autoUpdate : false,
                      trackRemovals: event.target.checked ? autoSyncPolicy.trackRemovals : false,
                      allowDelete: false,
                    })}
                  />
                  auto import
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={autoSyncPolicy.autoUpdate}
                    disabled={sharedVault.skillAutoSyncAll || !autoSyncPolicy.autoImport}
                    onChange={(event) => void updateSkillAutoSync(provider.id, { autoUpdate: event.target.checked })}
                  />
                  updates
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={autoSyncPolicy.trackRemovals}
                    disabled={sharedVault.skillAutoSyncAll || !autoSyncPolicy.autoImport}
                    onChange={(event) => void updateSkillAutoSync(provider.id, { trackRemovals: event.target.checked, allowDelete: false })}
                  />
                  safe removals
                </label>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!importable || Boolean(brainSkillImportProvider)}
                onClick={() => void importBrainSkills(provider.id)}
              >
                {pending ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : success ? <Check aria-hidden="true" /> : <Download aria-hidden="true" />}
                {pending ? "Importing" : success ? "Synced" : importable ? "Import" : "Current"}
              </Button>
            </article>
          );
        })}
      </div>
      <p className={skillsClass("muted")} style={{ margin: "12px 0 0" }}>{brainSkillsStatus || "Skills scan waits for the shared vault."}</p>
    </section>
  );
}
