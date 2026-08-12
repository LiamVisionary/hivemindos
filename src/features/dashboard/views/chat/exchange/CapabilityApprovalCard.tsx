"use client";

import { useState } from "react";
import { ChevronDown, Download, GitBranch, ShieldCheck, X } from "lucide-react";
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
  const [setupTarget, setSetupTarget] = useState<{ itemId: string; candidate: CapabilityCandidate } | null>(null);
  const pending = plan.status === "pending";
  const locked = disabled || !pending;
  const activeCount = plan.items.filter((item) => item.decision !== "remove" && item.decision !== "reject").length;
  const setupCount = plan.items.filter((item) => selectedCapability(item)?.availability === "setup-required" && item.decision === "approve-setup").length;

  const changeItem = (itemId: string, patch: Partial<CapabilityApprovalItem>) => {
    if (locked) return;
    onChange?.(updateItem(plan, itemId, patch));
  };

  return (
    <section className={styles.card} aria-label="Capability approval plan">
      <header className={styles.header}>
        <span className={styles.headerIcon} aria-hidden="true"><ShieldCheck size={17} /></span>
        <div className={styles.headerCopy}>
          <strong>{pending ? "Ready to continue" : "Plan approved"}</strong>
          <span>{pending
            ? `${activeCount} ${activeCount === 1 ? "tool" : "tools"} selected`
            : "The agent is continuing"}</span>
        </div>
      </header>

      <div className={styles.items}>
        {plan.items.map((item) => {
          const selected = selectedCapability(item);
          if (!selected) return null;
          const removed = item.decision === "remove" || item.decision === "reject";
          const setupRequired = selected.availability === "setup-required";
          return (
            <article className={`${styles.item} ${removed ? styles.removedItem : ""}`} key={item.id}>
              <div className={styles.capabilityName}>
                <span className={removed ? styles.removedDot : setupRequired ? styles.setupDot : styles.readyDot} aria-hidden="true" />
                <span>
                  <strong>{item.label}</strong>
                  <small>{removed ? "Removed" : `${selected.name}${selected.machineName ? ` · ${selected.machineName}` : ""} · ${setupRequired ? "Setup required" : "Ready"}`}</small>
                </span>
              </div>

              {!removed && setupRequired && selected.setupOptions?.length ? (
                <div className={styles.installPrompt}>
                  <span aria-hidden="true"><Download size={15} /></span>
                  <div><strong>Setup needed</strong><small>{selected.setupOptions[0].description}</small></div>
                  <button type="button" disabled={locked} onClick={() => setSetupTarget({ itemId: item.id, candidate: selected })}>Set up now</button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {pending ? (
        <details className={styles.advanced}>
          <summary>
            <span>
              <strong>Advanced</strong>
              <small>Change tools or add instructions</small>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className={styles.advancedContent}>
            {plan.items.map((item) => {
              const selected = selectedCapability(item);
              if (!selected) return null;
              const removed = item.decision === "remove" || item.decision === "reject";
              const setupRequired = selected.availability === "setup-required";
              return (
                <section className={styles.advancedItem} key={item.id} aria-label={`${item.label} advanced options`}>
                  <div className={styles.itemTopline}>
                    <div className={styles.itemHeading}>
                      <strong>{item.label}</strong>
                      <small>{item.reason}</small>
                    </div>
                    {removed ? (
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
                    )}
                  </div>

                  {!removed ? (
                    <>
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
                            <small>{candidate.availability === "ready" ? "Available" : "Needs setup"}{candidate.machineName ? ` · ${candidate.machineName}` : ""}</small>
                          </button>
                        ))}
                      </div>

                      {setupRequired ? (
                        <div className={styles.decisionToggle} aria-label={`${item.label} setup decision`}>
                          <button
                            type="button"
                            aria-pressed={item.decision === "approve-setup"}
                            className={item.decision === "approve-setup" ? styles.activeDecision : ""}
                            disabled={locked}
                            onClick={() => changeItem(item.id, { decision: "approve-setup" })}
                          >
                            Include setup
                          </button>
                          <button
                            type="button"
                            aria-pressed={item.decision === "reject"}
                            className={item.decision === "reject" ? styles.rejectedDecision : ""}
                            disabled={locked}
                            onClick={() => changeItem(item.id, { decision: "reject" })}
                          >
                            Skip
                          </button>
                        </div>
                      ) : null}

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
                          placeholder="Add any special instructions"
                          onChange={(event) => changeItem(item.id, { instructions: event.target.value })}
                        />
                      </label>
                    </>
                  ) : null}
                </section>
              );
            })}
          </div>
        </details>
      ) : null}

      <footer className={styles.footer}>
        <p>{pending
          ? setupCount
            ? `Continue will set up ${setupCount} ${setupCount === 1 ? "tool" : "tools"}.`
            : activeCount
              ? "Everything is ready."
              : "The agent will continue without these tools."
          : "The agent is continuing."}</p>
        {pending ? (
          <button
            type="button"
            className={styles.submitButton}
            aria-label="Approve selected capabilities and continue"
            disabled={disabled || !onSubmit}
            onClick={() => void onSubmit?.(plan)}
          >
            Continue
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
