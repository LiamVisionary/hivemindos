// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { CloseIconButton } from "@/components/ui/close-icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WorkSectionHeader } from "./WorkSectionHeader";

export function SchedulerPanel(props: any) {
  const { AlignLeft, Button, Check, ChevronDown, Clock3, Cpu, FileText, FileUp, FolderOpen, Link, List, LoaderCircle, Paperclip, Pencil, Plus, Puzzle, RUNTIME_LABELS, Repeat2, SCHEDULER_MODEL_OPTIONS, SCHEDULE_PRESETS, SchedulerView, Search, Send, Sparkles, TaskModal, Trash2, activeView, addSchedulePath, addSchedulerStep, addSchedulerStepPath, browseSchedulerFolder, createSchedule, displayAgents, editSchedule, editingScheduleId, filteredSchedulerSkills, findScheduleForJob, fleetClass, importExistingSchedules, isSchedulerFilePath, machineGroups, openSkillBrowser, pickSchedulerFiles, pickSchedulerFolder, refreshSharedSchedulesFromVault, removeSchedule, removeSchedulePath, removeScheduleSkill, removeSchedulerStep, removeSchedulerStepPath, renderAgentKey, resetScheduleDraft, runScheduleNow, saveScheduleFromModal, scheduleDraft, scheduleImportStatus, scheduleImporting, schedulerAttachMenu, schedulerDraftOpen, schedulerJobs, schedulerModalInitial, schedulerPathDraft, schedulerPathKind, schedulerRunStates, schedulerSelectedStep, schedulerSkillSearch, schedules, selectedAgent, setActiveView, setScheduleDraft, setScheduleImportStatus, setSchedulerAttachMenu, setSchedulerDraftOpen, setSchedulerPathDraft, setSchedulerPathKind, setSchedulerSelectedStep, setSchedulerSkillSearch, sharedSkillOptions, aeonSkillOptions, toggleSchedule, toggleScheduleSkill, toggleSchedulerStepMode, toggleSchedulerStepSkill, updateSchedulerStep, updateSchedulerStepModel, vaultClass } = props;
  // AEON automations arm a skill from the AEON runtime inventory, so the modal's skill
  // picker is fed from the runtime skill list in aeon mode (the shared-brain list is the
  // wrong source there and is usually empty).
  const modalSkillOptions = activeView === "aeon" ? (aeonSkillOptions ?? []) : sharedSkillOptions;
  return (<>
      {activeView === "scheduler" ? (
      <section
        className="grid min-h-0 overflow-hidden rounded-[18px] border border-[rgba(148,163,184,0.16)] bg-[rgba(5,8,13,0.72)]"
        style={{ height: "100%", gridTemplateRows: "auto minmax(0, 1fr)" }}
      >
        <WorkSectionHeader
          activeView="scheduler"
          onSelect={setActiveView}
          title="Automations"
          subtitle="Runtime schedules"
          stats={[
            { value: schedulerJobs.filter((job: any) => job.enabled).length, label: "active", tone: "cyan" },
            { value: schedulerJobs.filter((job: any) => !job.enabled).length, label: "paused", tone: "honey" },
            { value: schedulerJobs.filter((job: any) => job.lastRun?.status === "failed").length, label: "failed", tone: "danger" },
            { value: schedulerJobs.length, label: "total" },
          ]}
        />
        <div className="min-h-0 overflow-hidden">
        <SchedulerView
          jobs={schedulerJobs}
          runStates={schedulerRunStates}
          toolbar={
            <div className="flex w-full flex-wrap items-center justify-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Sync vault schedules"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[rgba(148,163,184,0.20)] bg-[rgba(15,23,42,0.60)] text-[var(--muted)] transition hover:border-[rgba(94,234,212,0.38)] hover:bg-[rgba(20,184,166,0.10)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(94,234,212,0.34)] disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:h-4 [&_svg]:w-4"
                    onClick={() => void refreshSharedSchedulesFromVault()}
                  >
                    <Repeat2 aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Sync vault schedules</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={scheduleImporting ? "Importing existing runtime schedules" : "Import existing runtime schedules"}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[rgba(148,163,184,0.20)] bg-[rgba(15,23,42,0.60)] text-[var(--muted)] transition hover:border-[rgba(94,234,212,0.38)] hover:bg-[rgba(20,184,166,0.10)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(94,234,212,0.34)] disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:h-4 [&_svg]:w-4"
                    onClick={() => void importExistingSchedules()}
                    disabled={scheduleImporting}
                  >
                    {scheduleImporting ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <FileUp aria-hidden="true" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{scheduleImporting ? "Importing existing schedules" : "Import existing schedules"}</TooltipContent>
              </Tooltip>
            </div>
          }
          onToggleJob={(job) => void toggleSchedule(job.id)}
          onRunNow={(job) => {
            const schedule = findScheduleForJob(job);
            if (schedule) void runScheduleNow(schedule);
          }}
          onEditJob={(job) => {
            const schedule = findScheduleForJob(job);
            if (!schedule) return;
            editSchedule(schedule);
            setScheduleImportStatus(`Loaded ${schedule.name} into the scheduler draft.`);
          }}
          onNewJob={() => {
            resetScheduleDraft(selectedAgent?.id ?? displayAgents[0]?.id ?? "");
            setSchedulerDraftOpen(true);
            setScheduleImportStatus("");
          }}
        />
        </div>
      </section>
      ) : null}

      {(activeView === "scheduler" || activeView === "aeon") && schedulerDraftOpen ? (
        <TaskModal
          key={editingScheduleId || "new-scheduler-task"}
          open
          aeon={activeView === "aeon"}
          initial={schedulerModalInitial}
          skillOptions={modalSkillOptions.map((skill) => ({
            slug: skill.slug,
            name: skill.name,
            description: skill.description,
          }))}
          machineOptions={Array.from(new Set([
            ...machineGroups.map((machine) => machine.name),
            "dashboard",
          ]))}
          beeOptions={Array.from(new Set(displayAgents.map((agent) => agent.name)))}
          onBrowseFolder={browseSchedulerFolder}
          onClose={() => {
            setSchedulerDraftOpen(false);
            if (editingScheduleId) resetScheduleDraft(selectedAgent?.id ?? displayAgents[0]?.id ?? "");
          }}
          onSave={saveScheduleFromModal}
        />
      ) : null}

      {activeView === "scheduler" && false ? (
      <section className={fleetClass("schedulerPanel", "tabPanel")}>
        <div className={fleetClass("schedulerStudioHeader")}>
          <div>
            <p className="eyebrow">Automation studio</p>
            <h2>Scheduler</h2>
            <p>Build small repeatable loops for any agent. Pick the agent, cadence, skills, and whether the run is freeform or step-by-step.</p>
          </div>
          <div className={fleetClass("schedulerMiniStats")}>
            <span><Repeat2 aria-hidden="true" /> {schedules.filter((schedule) => schedule.enabled).length} active</span>
            <span><Puzzle aria-hidden="true" /> {sharedSkillOptions.length} skills</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => void importExistingSchedules()} disabled={scheduleImporting}>
              {scheduleImporting ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <FileUp aria-hidden="true" />}
              Import existing
            </Button>
          </div>
        </div>
        {scheduleImportStatus ? <p className={fleetClass("schedulerImportStatus")}>{scheduleImportStatus}</p> : null}

        <div className={fleetClass("schedulerLayout")}>
          <form className={fleetClass("schedulerComposer")} onSubmit={createSchedule}>
            <div className={fleetClass("schedulerComposerTop")}>
              <div>
                <strong>{editingScheduleId ? "Edit automation" : "New automation"}</strong>
                <span>{scheduleDraft.mode === "steps" ? "Step-by-step runbook" : "Freeform prompt"}</span>
              </div>
              <div className={fleetClass("schedulerSegment")}>
                <button type="button" className={scheduleDraft.mode === "prompt" ? fleetClass("activeSegment") : ""} onClick={() => toggleSchedulerStepMode("prompt")}>
                  <AlignLeft aria-hidden="true" />
                  Prompt
                </button>
                <button type="button" className={scheduleDraft.mode === "steps" ? fleetClass("activeSegment") : ""} onClick={() => toggleSchedulerStepMode("steps")}>
                  <List aria-hidden="true" />
                  Steps
                </button>
              </div>
            </div>

            <div className={fleetClass("schedulerSection")}>
              <label className={fleetClass("schedulerField")}>
                <span>Name</span>
                <input value={scheduleDraft.name} onChange={(event) => setScheduleDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Weekly SEO report" />
              </label>
              <label className={fleetClass("schedulerField")}>
                <span>Agent</span>
                <select value={scheduleDraft.agentId} onChange={(event) => setScheduleDraft((current) => ({ ...current, agentId: event.target.value }))}>
                  {displayAgents.map((agent, agentIndex) => <option value={agent.id} key={renderAgentKey(agent, agentIndex)}>{agent.name} · {RUNTIME_LABELS[agent.runtime]}</option>)}
                </select>
              </label>
            </div>

            <div className={fleetClass("schedulerSection")}>
              <span className={fleetClass("schedulerTinyLabel")}>Cadence</span>
              <div className={fleetClass("schedulerPresetRow")}>
                {SCHEDULE_PRESETS.map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={scheduleDraft.every === value ? fleetClass("selectedSkillChip") : ""}
                    onClick={() => setScheduleDraft((current) => ({ ...current, every: value }))}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <div className={fleetClass("schedulerSection")}>
              <div className={fleetClass("schedulerInstructionHeader")}>
                <span className={fleetClass("schedulerTinyLabel")}>{scheduleDraft.mode === "steps" ? "Runbook" : "Instructions"}</span>
                <small>{scheduleDraft.mode === "steps" ? "each step can carry its own context" : "single recurring prompt"}</small>
              </div>
              {scheduleDraft.mode === "steps" ? (
                <div className={fleetClass("schedulerStepEditor")}>
                  {scheduleDraft.steps.map((step, index) => (
                    <div
                      className={fleetClass("schedulerStepItem", schedulerSelectedStep === index && "selected")}
                      key={step.id}
                      onClick={() => {
                        setSchedulerSelectedStep(index);
                        setSchedulerAttachMenu(null);
                      }}
                    >
                      <div className={fleetClass("schedulerStepInputRow")}>
                        <span>{index + 1}</span>
                        <input
                          value={step.text}
                          onChange={(event) => updateSchedulerStep(index, { text: event.target.value })}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSchedulerSelectedStep(index);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addSchedulerStep();
                            }
                            if (event.key === "Backspace" && !step.text && scheduleDraft.steps.length > 1) {
                              event.preventDefault();
                              removeSchedulerStep(index);
                            }
                          }}
                          placeholder={index === 0 ? "First step" : "Next step"}
                        />
                        <CloseIconButton size="sm" onClick={(event) => { event.stopPropagation(); removeSchedulerStep(index); }} aria-label={`Remove step ${index + 1}`} />
                      </div>
                      {step.paths.length || step.skills.length ? (
                        <div className={fleetClass("schedulerStepBadges")}>
                          {[...new Set(step.paths)].map((path) => (
                            <span className={fleetClass("schedulerAttachmentBadge", isSchedulerFilePath(path) ? "file" : "path")} key={path} title={path}>
                              {isSchedulerFilePath(path) ? <FileText aria-hidden="true" /> : <FolderOpen aria-hidden="true" />}
                              {path.split("/").filter(Boolean).pop() || path}
                              {schedulerSelectedStep === index ? (
                                <CloseIconButton size="sm" onClick={(event) => { event.stopPropagation(); removeSchedulerStepPath(index, path); }} aria-label={`Remove ${path}`} />
                              ) : null}
                            </span>
                          ))}
                          {[...new Set(step.skills)].map((slug) => {
                            const skill = sharedSkillOptions.find((item) => item.slug === slug);
                            return (
                              <span className={fleetClass("schedulerAttachmentBadge", "skill")} key={slug}>
                                <Puzzle aria-hidden="true" />
                                {skill?.name ?? slug}
                                {schedulerSelectedStep === index ? (
                                  <CloseIconButton size="sm" onClick={(event) => { event.stopPropagation(); toggleSchedulerStepSkill(index, slug); }} aria-label={`Remove ${skill?.name ?? slug}`} />
                                ) : null}
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                      {schedulerSelectedStep === index ? (
                        <div className={fleetClass("schedulerStepActionBar")}>
                          <div className={fleetClass("schedulerAttachCluster")}>
                            <button
                              type="button"
                              className={fleetClass("schedulerAttachButton", schedulerAttachMenu && "active")}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSchedulerAttachMenu((current) => current === "menu" ? null : "menu");
                              }}
                              aria-label="Attach to selected step"
                              title="Attach"
                            >
                              <Plus aria-hidden="true" />
                            </button>
                            {schedulerAttachMenu === "menu" ? (
                              <div className={fleetClass("schedulerAttachPopover")} role="menu" onClick={(event) => event.stopPropagation()}>
                                <button type="button" onClick={() => { setSchedulerAttachMenu("skill"); setSchedulerSkillSearch(""); }}>
                                  <Puzzle aria-hidden="true" />
                                  Attach skill
                                </button>
                                <button type="button" onClick={() => void pickSchedulerFolder(index)}>
                                  <FolderOpen aria-hidden="true" />
                                  Link folder
                                </button>
                                <button type="button" onClick={() => void pickSchedulerFiles(index)}>
                                  <FileText aria-hidden="true" />
                                  Link file
                                </button>
                                <button type="button" onClick={() => { setSchedulerPathKind("path"); setSchedulerPathDraft(""); setSchedulerAttachMenu("path"); }}>
                                  <Link aria-hidden="true" />
                                  Link path
                                </button>
                              </div>
                            ) : null}
                            {schedulerAttachMenu === "skill" ? (
                              <div className={fleetClass("schedulerAttachPopover", "wide")} role="dialog" aria-label="Attach skill" onClick={(event) => event.stopPropagation()}>
                                <div className={fleetClass("schedulerAttachSearch")}>
                                  <Search aria-hidden="true" />
                                  <input value={schedulerSkillSearch} onChange={(event) => setSchedulerSkillSearch(event.target.value)} placeholder="Search skills" autoFocus />
                        <CloseIconButton size="sm" onClick={() => setSchedulerAttachMenu(null)} aria-label="Close skill picker" />
                                </div>
                                <div className={fleetClass("schedulerAttachChoices")}>
                                  {filteredSchedulerSkills.length ? filteredSchedulerSkills.map((skill) => {
                                    const selected = step.skills.includes(skill.slug);
                                    return (
                                      <button
                                        type="button"
                                        key={skill.slug}
                                        className={selected ? fleetClass("selectedSkillChip") : ""}
                                        onClick={() => {
                                          toggleSchedulerStepSkill(index, skill.slug);
                                          if (!selected) setSchedulerAttachMenu(null);
                                        }}
                                      >
                                        <Puzzle aria-hidden="true" />
                                        {skill.name}
                                      </button>
                                    );
                                  }) : (
                                    <button type="button" onClick={() => { setSchedulerAttachMenu(null); void openSkillBrowser(); }}>
                                      <Sparkles aria-hidden="true" />
                                      Open skill browser
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : null}
                            {schedulerAttachMenu === "path" ? (
                              <div className={fleetClass("schedulerAttachPopover", "wide")} role="dialog" aria-label={`Link ${schedulerPathKind}`} onClick={(event) => event.stopPropagation()}>
                                <div className={fleetClass("schedulerAttachSearch")}>
                                  <Link aria-hidden="true" />
                                  <input
                                    value={schedulerPathDraft}
                                    onChange={(event) => setSchedulerPathDraft(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        addSchedulerStepPath(index, schedulerPathDraft);
                                        setSchedulerPathDraft("");
                                        setSchedulerAttachMenu(null);
                                      }
                                      if (event.key === "Escape") setSchedulerAttachMenu(null);
                                    }}
                                    placeholder={schedulerPathKind === "folder" ? "/path/to/folder" : schedulerPathKind === "file" ? "/path/to/file.md" : "/path/to/file-or-folder"}
                                    autoFocus
                                  />
                        <CloseIconButton size="sm" onClick={() => setSchedulerAttachMenu(null)} aria-label="Close path linker" />
                                </div>
                                <div className={fleetClass("schedulerAttachFooter")}>
                                  <span>{schedulerPathKind === "path" ? "File or folder" : schedulerPathKind}</span>
                                  <button
                                    type="button"
                                    disabled={!schedulerPathDraft.trim()}
                                    onClick={() => {
                                      addSchedulerStepPath(index, schedulerPathDraft);
                                      setSchedulerPathDraft("");
                                      setSchedulerAttachMenu(null);
                                    }}
                                  >
                                    Add
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                          <div className={fleetClass("schedulerModelCluster")}>
                            <button type="button" onClick={(event) => { event.stopPropagation(); setSchedulerAttachMenu((current) => current === "model" ? null : "model"); }}>
                              <Cpu aria-hidden="true" />
                              <span>{SCHEDULER_MODEL_OPTIONS.find((option) => option.value === step.model)?.label ?? "Default"}</span>
                              <ChevronDown aria-hidden="true" />
                            </button>
                            {schedulerAttachMenu === "model" ? (
                              <div className={fleetClass("schedulerAttachPopover", "modelMenu")} role="menu" onClick={(event) => event.stopPropagation()}>
                                {SCHEDULER_MODEL_OPTIONS.map((option) => (
                                  <button
                                    type="button"
                                    key={option.value}
                                    className={step.model === option.value ? fleetClass("selectedSkillChip") : ""}
                                    onClick={() => {
                                      updateSchedulerStepModel(index, option.value);
                                      setSchedulerAttachMenu(null);
                                    }}
                                  >
                                    {step.model === option.value ? <Check aria-hidden="true" /> : <span aria-hidden="true" />}
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          {step.paths.length || step.skills.length ? (
                            <div className={fleetClass("schedulerStepCounts")}>
                              {step.paths.length ? <span><FolderOpen aria-hidden="true" />{step.paths.length}</span> : null}
                              {step.skills.length ? <span><Puzzle aria-hidden="true" />{step.skills.length}</span> : null}
                            </div>
                          ) : null}
                        </div>
                      ) : step.paths.length || step.skills.length || step.model ? (
                        <div className={fleetClass("schedulerStepSummary")}>
                          {step.model ? <span><Cpu aria-hidden="true" />{SCHEDULER_MODEL_OPTIONS.find((option) => option.value === step.model)?.label ?? "Default"}</span> : null}
                          {step.paths.length ? <span><FolderOpen aria-hidden="true" />{step.paths.length}</span> : null}
                          {step.skills.length ? <span><Puzzle aria-hidden="true" />{step.skills.length}</span> : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  <button type="button" className={fleetClass("schedulerAddStepButton")} onClick={addSchedulerStep}>
                    <Plus aria-hidden="true" />
                    Add step
                  </button>
                </div>
              ) : (
                <textarea
                  value={scheduleDraft.prompt}
                  onChange={(event) => setScheduleDraft((current) => ({ ...current, prompt: event.target.value }))}
                  placeholder="Tell the agent exactly what to do when this schedule fires."
                  required
                />
              )}
              {scheduleDraft.mode === "prompt" && (scheduleDraft.skills.length || scheduleDraft.paths.length) ? (
                <div className={fleetClass("schedulerAttachmentBadges")} aria-label="Scheduler attachments">
                  {[...new Set(scheduleDraft.skills)].map((slug) => {
                    const skill = sharedSkillOptions.find((item) => item.slug === slug);
                    return (
                      <span className={fleetClass("schedulerAttachmentBadge", "skill")} key={slug}>
                        <Puzzle aria-hidden="true" />
                        {skill?.name ?? slug}
                        <CloseIconButton size="sm" onClick={() => removeScheduleSkill(slug)} aria-label={`Remove ${skill?.name ?? slug}`} />
                      </span>
                    );
                  })}
                  {[...new Set(scheduleDraft.paths)].map((path) => (
                    <span className={fleetClass("schedulerAttachmentBadge", "path")} key={path}>
                      {path.includes(".") ? <FileText aria-hidden="true" /> : <FolderOpen aria-hidden="true" />}
                      {path.split("/").filter(Boolean).pop() || path}
                      <CloseIconButton size="sm" onClick={() => removeSchedulePath(path)} aria-label={`Remove ${path}`} />
                    </span>
                  ))}
                </div>
              ) : null}
              <div className={fleetClass("schedulerActionBar")}>
                {scheduleDraft.mode === "prompt" ? (
                <>
                <div className={fleetClass("schedulerAttachCluster")}>
                  <button
                    type="button"
                    className={fleetClass("schedulerAttachButton", schedulerAttachMenu && "active")}
                    onClick={() => setSchedulerAttachMenu((current) => current === "menu" ? null : "menu")}
                    aria-label="Attach skill, file, folder, or path"
                    title="Attach"
                  >
                    <Plus aria-hidden="true" />
                  </button>
                  {schedulerAttachMenu === "menu" ? (
                    <div className={fleetClass("schedulerAttachPopover")} role="menu">
                      <button type="button" onClick={() => { setSchedulerAttachMenu("skill"); setSchedulerSkillSearch(""); }}>
                        <Puzzle aria-hidden="true" />
                        Attach skill
                      </button>
                      <button type="button" onClick={() => void pickSchedulerFolder()}>
                        <FolderOpen aria-hidden="true" />
                        Link folder
                      </button>
                      <button type="button" onClick={() => void pickSchedulerFiles()}>
                        <FileText aria-hidden="true" />
                        Link file
                      </button>
                      <button type="button" onClick={() => { setSchedulerPathKind("path"); setSchedulerAttachMenu("path"); setSchedulerPathDraft(""); }}>
                        <Link aria-hidden="true" />
                        Link path
                      </button>
                      <button type="button" onClick={() => { setSchedulerAttachMenu(null); void openSkillBrowser(); }}>
                        <Sparkles aria-hidden="true" />
                        Browse library
                      </button>
                    </div>
                  ) : null}
                  {schedulerAttachMenu === "skill" ? (
                    <div className={fleetClass("schedulerAttachPopover", "wide")} role="dialog" aria-label="Attach skill">
                      <div className={fleetClass("schedulerAttachSearch")}>
                        <Search aria-hidden="true" />
                        <input
                          value={schedulerSkillSearch}
                          onChange={(event) => setSchedulerSkillSearch(event.target.value)}
                          placeholder="Search skills"
                          autoFocus
                        />
                        <CloseIconButton size="sm" onClick={() => setSchedulerAttachMenu(null)} aria-label="Close skill picker" />
                      </div>
                      <div className={fleetClass("schedulerAttachChoices")}>
                        {filteredSchedulerSkills.length ? filteredSchedulerSkills.map((skill) => {
                          const selected = scheduleDraft.skills.includes(skill.slug);
                          return (
                            <button
                              type="button"
                              key={skill.slug}
                              className={selected ? fleetClass("selectedSkillChip") : ""}
                              onClick={() => {
                                toggleScheduleSkill(skill.slug);
                                if (!selected) setSchedulerAttachMenu(null);
                              }}
                            >
                              <Puzzle aria-hidden="true" />
                              {skill.name}
                            </button>
                          );
                        }) : (
                          <button type="button" onClick={() => { setSchedulerAttachMenu(null); void openSkillBrowser(); }}>
                            <Sparkles aria-hidden="true" />
                            Open skill browser
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
                  {schedulerAttachMenu === "path" ? (
                    <div className={fleetClass("schedulerAttachPopover", "wide")} role="dialog" aria-label={`Link ${schedulerPathKind}`}>
                      <div className={fleetClass("schedulerAttachSearch")}>
                        <Link aria-hidden="true" />
                        <input
                          value={schedulerPathDraft}
                          onChange={(event) => setSchedulerPathDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addSchedulePath(schedulerPathDraft);
                              setSchedulerPathDraft("");
                              setSchedulerAttachMenu(null);
                            }
                            if (event.key === "Escape") setSchedulerAttachMenu(null);
                          }}
                          placeholder={schedulerPathKind === "folder" ? "/path/to/folder" : schedulerPathKind === "file" ? "/path/to/file.md" : "/path/to/file-or-folder"}
                          autoFocus
                        />
                        <CloseIconButton size="sm" onClick={() => setSchedulerAttachMenu(null)} aria-label="Close path linker" />
                      </div>
                      <div className={fleetClass("schedulerAttachFooter")}>
                        <span>{schedulerPathKind === "path" ? "File or folder" : schedulerPathKind}</span>
                        <button
                          type="button"
                          disabled={!schedulerPathDraft.trim()}
                          onClick={() => {
                            addSchedulePath(schedulerPathDraft);
                            setSchedulerPathDraft("");
                            setSchedulerAttachMenu(null);
                          }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className={fleetClass("schedulerModelCluster")}>
                  <button type="button" onClick={() => setSchedulerAttachMenu((current) => current === "model" ? null : "model")}>
                    <Cpu aria-hidden="true" />
                    <span>{SCHEDULER_MODEL_OPTIONS.find((option) => option.value === scheduleDraft.model)?.label ?? "Default"}</span>
                    <ChevronDown aria-hidden="true" />
                  </button>
                  {schedulerAttachMenu === "model" ? (
                    <div className={fleetClass("schedulerAttachPopover", "modelMenu")} role="menu">
                      {SCHEDULER_MODEL_OPTIONS.map((option) => (
                        <button
                          type="button"
                          key={option.value}
                          className={scheduleDraft.model === option.value ? fleetClass("selectedSkillChip") : ""}
                          onClick={() => {
                            setScheduleDraft((current) => ({ ...current, model: option.value }));
                            setSchedulerAttachMenu(null);
                          }}
                        >
                          {scheduleDraft.model === option.value ? <Check aria-hidden="true" /> : <span aria-hidden="true" />}
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                </>
                ) : <span />}
                <Button
                  type="submit"
                  size="sm"
                  disabled={!scheduleDraft.agentId || (scheduleDraft.mode === "steps" ? !scheduleDraft.steps.some((step) => step.text.trim()) : !scheduleDraft.prompt.trim())}
                >
                <Repeat2 aria-hidden="true" />
                  {editingScheduleId ? "Save" : "Create"}
                </Button>
                {editingScheduleId ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => { resetScheduleDraft(selectedAgent?.id ?? displayAgents[0]?.id ?? ""); setSchedulerDraftOpen(false); }}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          </form>

          <div className={fleetClass("scheduleList")}>
            {schedules.length ? schedules.map((schedule) => {
              const agent = displayAgents.find((item) => item.id === schedule.agentId);
              const agentLabel = agent
                ? `${agent.name} · ${RUNTIME_LABELS[agent.runtime]}`
                : schedule.externalSource
                  ? `${RUNTIME_LABELS[schedule.externalSource as AgentRuntime] ?? schedule.externalSource} runtime`
                  : "Missing agent";
              return (
                <article key={schedule.id} className={fleetClass("scheduleCard", schedule.enabled ? "enabled" : "paused")}>
                  <div className={fleetClass("scheduleCardTop")}>
                    <span>{schedule.enabled ? "Active" : "Paused"}{schedule.externalSource ? ` · ${RUNTIME_LABELS[schedule.externalSource as AgentRuntime] ?? schedule.externalSource}` : ""}</span>
                    <small><Clock3 aria-hidden="true" /> {schedule.every}</small>
                  </div>
                  <div>
                    <h3>{schedule.name}</h3>
                    <p>{agentLabel}</p>
                  </div>
                  <p>{schedule.lastSummary || (schedule.mode === "steps" ? `${schedule.steps.length} step runbook` : schedule.prompt)}</p>
                  {schedule.skills.length || schedule.paths.length ? (
                    <div className={fleetClass("scheduleSkillRow")}>
                      {[...new Set(schedule.skills)].slice(0, 4).map((skill) => <span key={skill}><Puzzle aria-hidden="true" /> {skill}</span>)}
                      {[...new Set(schedule.paths)].slice(0, 3).map((path) => <span key={path}><Paperclip aria-hidden="true" /> {path.split("/").filter(Boolean).pop() || path}</span>)}
                    </div>
                  ) : null}
                  {schedule.usePastRuns || schedule.sharedRunFolder ? (
                    <div className={fleetClass("scheduleSkillRow")}>
                      {schedule.usePastRuns ? <span><Clock3 aria-hidden="true" /> past {schedule.pastRunLimit ?? 3} runs injected</span> : null}
                      {schedule.sharedRunFolder ? <span><Paperclip aria-hidden="true" /> {schedule.sharedRunFolder}</span> : null}
                    </div>
                  ) : null}
                  <div className={fleetClass("scheduleActions")}>
                    <Button type="button" size="sm" variant="secondary" onClick={() => runScheduleNow(schedule)}><Send aria-hidden="true" /> Run now</Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => editSchedule(schedule)}><Pencil aria-hidden="true" /> Edit</Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => toggleSchedule(schedule.id)}>{schedule.enabled ? "Pause" : "Resume"}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeSchedule(schedule.id)}><Trash2 aria-hidden="true" /> Remove</Button>
                  </div>
                </article>
              );
            }) : (
              <div className={fleetClass("scheduleEmpty")}>
                <Clock3 aria-hidden="true" />
                <strong>No schedules yet</strong>
                <p>Create one reusable workflow and it will appear here with its agent, skills, and run mode.</p>
              </div>
            )}
          </div>
        </div>
      </section>
      ) : null}

  </>);
}
