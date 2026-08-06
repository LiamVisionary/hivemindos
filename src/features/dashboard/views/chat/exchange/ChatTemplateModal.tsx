"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Blocks,
  ChartNoAxesCombined,
  ExternalLink,
  Globe2,
  LayoutTemplate,
  LoaderCircle,
  ShieldCheck,
  Workflow,
  X,
} from "lucide-react";

import {
  APP_TEMPLATE_GROUPS,
  WEB_TEMPLATE_CATALOG,
  type AppTemplateGroupId,
  type WebTemplateId,
} from "@/lib/services/app-builder/web-template-catalog";

import styles from "./ChatTemplateModal.module.css";

type TemplateView = "groups" | "websites";

const GROUP_ICONS = {
  websites: Globe2,
  apps: AppWindow,
  dashboards: ChartNoAxesCombined,
  automations: Workflow,
} satisfies Record<AppTemplateGroupId, typeof Globe2>;

export function ChatTemplateModal(props: {
  onClose: () => void;
  onAttachWebTemplate: (templateId: WebTemplateId) => Promise<void>;
}) {
  const { onClose, onAttachWebTemplate } = props;
  const [view, setView] = useState<TemplateView>("groups");
  const [busyTemplateId, setBusyTemplateId] = useState<WebTemplateId | "">("");
  const [error, setError] = useState("");
  const busy = Boolean(busyTemplateId);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const portalTarget = typeof document === "undefined" ? null : document.body;
  if (!portalTarget) return null;

  async function initializeTemplate(templateId: WebTemplateId) {
    setBusyTemplateId(templateId);
    setError("");
    try {
      await onAttachWebTemplate(templateId);
      onClose();
    } catch (templateError) {
      setError(templateError instanceof Error ? templateError.message : "Could not initialize this template.");
    } finally {
      setBusyTemplateId("");
    }
  }

  return createPortal((
    <div
      className={`fr-root ${styles.overlay}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-template-title"
        aria-busy={busy}
      >
        <header className={styles.header}>
          <span className={styles.mark} aria-hidden="true"><LayoutTemplate size={19} /></span>
          <div className={styles.headerCopy}>
            <span className={styles.eyebrow}>{view === "groups" ? "Start from a template" : "Website templates"}</span>
            <h2 id="chat-template-title">{view === "groups" ? "What would you like to build?" : "Choose a website foundation"}</h2>
            <p>{view === "groups"
              ? "Pick a group, then attach a reviewed starter directly to this chat."
              : "Each starter becomes a real App Builder project in this chat’s working directory."}</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} disabled={busy} aria-label="Close templates">
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.body}>
          {view === "groups" ? (
            <div className={styles.grid} aria-label="Template groups">
              {APP_TEMPLATE_GROUPS.map((group) => {
                const Icon = GROUP_ICONS[group.id];
                const ready = group.readyCount > 0;
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={styles.groupCard}
                    data-ready={ready}
                    disabled={!ready}
                    onClick={() => {
                      if (group.id === "websites") setView("websites");
                    }}
                  >
                    <span className={styles.cardIcon}><Icon size={20} /></span>
                    <span className={styles.cardCopy}>
                      <strong>{group.name}</strong>
                      <span>{group.description}</span>
                    </span>
                    <span className={styles.cardMeta}>{ready ? `${group.readyCount} ready` : "Coming soon"}</span>
                    {ready ? <ArrowRight className={styles.cardArrow} size={16} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <button type="button" className={styles.back} onClick={() => setView("groups")} disabled={busy}>
                <ArrowLeft size={14} aria-hidden="true" /> All template groups
              </button>
              <div className={styles.grid} aria-label="Website templates">
                {WEB_TEMPLATE_CATALOG.map((template) => {
                  const isBusy = busyTemplateId === template.id;
                  return (
                    <article key={template.id} className={`${styles.webCard} ${styles.scrollWorldCard}`}>
                      <div className={styles.previewArt} aria-hidden="true">
                        <span className={styles.previewOrbOne} />
                        <span className={styles.previewOrbTwo} />
                        <span className={styles.previewPath} />
                        <span className={styles.previewLabel}>scroll to explore</span>
                      </div>
                      <div className={styles.webCardBody}>
                        <div className={styles.webCardTitle}>
                          <span className={styles.cardIcon}><Blocks size={19} /></span>
                          <div>
                            <strong>{template.name}</strong>
                            <span>Immersive landing page</span>
                          </div>
                        </div>
                        <p>{template.description}</p>
                        <div className={styles.auditRow}>
                          <span><ShieldCheck size={13} /> {template.auditLabel}</span>
                          <span>{template.license}</span>
                        </div>
                      </div>
                      <footer className={styles.webCardFooter}>
                        <a href={template.sourceRepository} target="_blank" rel="noreferrer">
                          View source <ExternalLink size={12} aria-hidden="true" />
                        </a>
                        <button type="button" onClick={() => void initializeTemplate(template.id)} disabled={busy}>
                          {isBusy ? <LoaderCircle className={styles.spinner} size={15} aria-hidden="true" /> : <LayoutTemplate size={15} aria-hidden="true" />}
                          {isBusy ? "Initializing in App Builder…" : "Use template"}
                        </button>
                      </footer>
                    </article>
                  );
                })}
              </div>
            </>
          )}

          {busy ? (
            <div className={styles.loadingState} role="status" aria-live="polite">
              <span className={styles.loadingTrack}><span /></span>
              Preparing the reviewed files and creating this chat’s App Builder project.
            </div>
          ) : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>
      </section>
    </div>
  ), portalTarget);
}
