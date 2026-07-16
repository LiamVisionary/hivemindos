"use client";

import { useState } from "react";
import { Check, ChevronDown, Download, GitBranch, Search, ShieldCheck, X } from "lucide-react";
import {
  selectedCapability,
  type CapabilityApprovalItem,
  type CapabilityApprovalPlan,
} from "@/lib/types/capability-approval";
import type { CapabilityCandidate } from "@/lib/types/capability-approval";
import { CapabilitySetupModal } from "./CapabilitySetupModal";
import styles from "./capability-approval-card.module.css";

function updateItem(plan: CapabilityApprovalPlan, itemId: string, patch: Partial<CapabilityApprovalItem>): CapabilityApprovalPlan {
  return {
    ...plan,
    items: plan.items.map((item) => item.id === itemId ? { ...item, ...patch } : item),
  };
}

export function CapabilityApprovalCard({
  plan,
  disabled = false,
  onChange,
  onSubmit,
}: {
  plan: CapabilityApprovalPlan;
  disabled?: boolean;
  onChange?: (plan: CapabilityApprovalPlan) => void;
  onSubmit?: (plan: CapabilityApprovalPlan) => void | Promise<void>;
}) {
  const [browseItemId, setBrowseItemId] = useState("");
  const [setupTarget, setSetupTarget] = useState<{ itemId: string; candidate: CapabilityCandidate } | null>(null);
  const pending = plan.status === "pending";
  const locked = disabled || !pending;
  const setupCount = plan.items.filter((item) => selectedCapability(item)?.availability === "setup-required" && item.decision === "approve-setup").length;

  const changeItem = (itemId: string, patch: Partial<CapabilityApprovalItem>) => {
    if (locked) return;
    onChange?.(updateItem(plan, itemId, patch));
  };

  return (
    <section className={styles.card} aria-label="Capability approval plan">
      <header className={styles.header}>
        <span className={styles.headerIcon} aria-hidden="true"><ShieldCheck size={18} /></span>
        <div className={styles.headerCopy}>
          <strong>Capability plan</strong>
          <span>{pending ? "Review before the agent starts building" : "Approved and returned to the agent"}</span>
        </div>
        <span className={pending ? styles.pendingBadge : styles.approvedBadge}>
          {pending ? "Approval needed" : <><Check size={12} aria-hidden="true" /> Approved</>}
        </span>
      </header>

      <div className={styles.items}>
        {plan.items.map((item) => {
          const selected = selectedCapability(item);
          if (!selected) return null;
          const removed = item.decision === "remove";
          const setupRequired = selected.availability === "setup-required";
          const browseOpen = browseItemId === item.id;
          return (
            <article className={`${styles.item} ${removed ? styles.removedItem : ""}`} key={item.id}>
              <div className={styles.itemTopline}>
                <div className={styles.itemHeading}>
                  <span>{item.label}</span>
                  <small>{item.reason}</small>
                </div>
                {pending ? (
                  removed ? (
                    <button type="button" className={styles.restoreButton} onClick={() => changeItem(item.id, { decision: setupRequired ? "approve-setup" : "use" })}>Restore</button>
                  ) : (
                    <button
                      type="button"
                      className={styles.removeButton}
                      aria-label={`Remove ${item.label} from the task`}
                      title={`Remove ${item.label} from the task`}
                      onClick={() => changeItem(item.id, { decision: "remove" })}
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  )
                ) : null}
              </div>

              {removed ? (
                <p className={styles.removedCopy}>This step will be removed. The agent must redesign the rest of the task so it still makes sense without it.</p>
              ) : (
                <>
                  <div className={styles.selectionRow}>
                    <div className={styles.capabilityName}>
                      <span className={setupRequired ? styles.setupDot : styles.readyDot} aria-hidden="true" />
                      <span>
                        <strong>{selected.name}</strong>
                        <small>{setupRequired ? "Setup required" : "Available now"}</small>
                      </span>
                    </div>
                    {pending ? (
                      <button
                        type="button"
                        className={styles.browseButton}
                        aria-expanded={browseOpen}
                        onClick={() => setBrowseItemId((current) => current === item.id ? "" : item.id)}
                      >
                        <Search size={14} aria-hidden="true" /> Browse
                        <ChevronDown size={13} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  <p className={styles.summary}>{selected.summary}</p>

                  {setupRequired && selected.setupOptions?.length ? (
                    <div className={styles.installPrompt}>
                      <span aria-hidden="true"><Download size={16} /></span>
                      <div><strong>Set up {selected.name}?</strong><small>{selected.setupOptions[0].description}</small></div>
                      <button type="button" disabled={locked} onClick={() => setSetupTarget({ itemId: item.id, candidate: selected })}>Set up now</button>
                    </div>
                  ) : null}

                  {setupRequired ? (
                    <div className={styles.decisionToggle} aria-label={`${item.label} setup decision`}>
                      <button
                        type="button"
                        aria-pressed={item.decision === "approve-setup"}
                        className={item.decision === "approve-setup" ? styles.activeDecision : ""}
                        disabled={locked}
                        onClick={() => changeItem(item.id, { decision: "approve-setup" })}
                      >
                        Approve setup
                      </button>
                      <button
                        type="button"
                        aria-pressed={item.decision === "reject"}
                        className={item.decision === "reject" ? styles.rejectedDecision : ""}
                        disabled={locked}
                        onClick={() => changeItem(item.id, { decision: "reject" })}
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}

                  {browseOpen && pending ? (
                    <div className={styles.browserPanel}>
                      <span className={styles.browserLabel}>Choose an alternative</span>
                      <div className={styles.candidates}>
                        {item.candidates.map((candidate) => (
                          <button
                            type="button"
                            key={candidate.id}
                            className={candidate.id === selected.id ? styles.selectedCandidate : ""}
                            onClick={() => changeItem(item.id, {
                              selectedCapabilityId: candidate.id,
                              decision: candidate.availability === "setup-required" ? "approve-setup" : "use",
                            })}
                          >
                            <span>{candidate.name}</span>
                            <small>{candidate.availability === "ready" ? "Available" : "Needs setup"}</small>
                          </button>
                        ))}
                      </div>
                      <label className={styles.field}>
                        <span><GitBranch size={13} aria-hidden="true" /> Use another GitHub repository</span>
                        <input
                          type="url"
                          inputMode="url"
                          value={item.githubUrl ?? ""}
                          placeholder="https://github.com/owner/repository"
                          onChange={(event) => changeItem(item.id, { githubUrl: event.target.value })}
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Instructions for this capability</span>
                        <textarea
                          value={item.instructions ?? ""}
                          placeholder="For example: Please look through GitHub for a better capability."
                          onChange={(event) => changeItem(item.id, { instructions: event.target.value })}
                        />
                      </label>
                    </div>
                  ) : null}
                </>
              )}
            </article>
          );
        })}
      </div>

      <footer className={styles.footer}>
        <p>{pending ? "I’ve drafted the capability list. Submit when ready." : "The agent is continuing with the submitted capability map."}</p>
        {pending ? (
          <button type="button" className={styles.submitButton} disabled={disabled || !onSubmit} onClick={() => void onSubmit?.(plan)}>
            <ShieldCheck size={15} aria-hidden="true" />
            Approve capability plan{setupCount ? ` · ${setupCount} setup` : ""}
          </button>
        ) : null}
      </footer>
      {setupTarget ? (
        <CapabilitySetupModal
          candidate={setupTarget.candidate}
          onClose={() => setSetupTarget(null)}
          onReady={() => {
            const item = plan.items.find((entry) => entry.id === setupTarget.itemId);
            if (item) changeItem(item.id, {
              candidates: item.candidates.map((candidate) => candidate.id === setupTarget.candidate.id ? { ...candidate, availability: "ready" } : candidate),
              decision: "use",
            });
            setSetupTarget(null);
          }}
        />
      ) : null}
    </section>
  );
}
