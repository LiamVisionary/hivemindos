"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { TaskTemplatePicker } from "./TaskTemplatePicker";
import type { TaskTemplateDefinition } from "./task-templates";
import styles from "./task-modal.module.css";

export function TaskTemplateSelectModal({
  onClose,
  onSelect,
  open,
  selectedId,
  title = "Select task template",
}: {
  onClose: () => void;
  onSelect: (template: TaskTemplateDefinition) => void;
  open: boolean;
  selectedId?: string | null;
  title?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={styles.root}
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-template-picker-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 110,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "rgba(3,7,18,0.62)",
        backdropFilter: "blur(10px) saturate(120%)",
        WebkitBackdropFilter: "blur(10px) saturate(120%)",
      }}
    >
      <section
        onClick={(event) => event.stopPropagation()}
        style={{
          display: "grid",
          gridTemplateRows: "auto 1fr",
          width: "min(820px, 100%)",
          maxHeight: "min(760px, calc(100vh - 48px))",
          overflow: "hidden",
          border: "1px solid var(--tm-honey-border)",
          borderRadius: 14,
          background: "var(--tm-panel)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
        }}
      >
        <header
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 14,
            alignItems: "center",
            borderBottom: "1px solid var(--tm-line)",
            padding: "14px 18px",
          }}
        >
          <div>
            <div className={styles.monoCap} style={{ color: "var(--tm-honey-2)" }}>Task templates</div>
            <h2 id="task-template-picker-title" style={{ margin: "2px 0 0", color: "var(--tm-fg)", fontFamily: "var(--tm-f-display)", fontSize: 18, lineHeight: 1.15 }}>
              {title}
            </h2>
          </div>
          <CloseIconButton onClick={onClose} aria-label="Close template picker" />
        </header>
        <div style={{ minHeight: 0, overflow: "auto", padding: 18 }}>
          <TaskTemplatePicker
            selectedId={selectedId}
            onSelect={(template) => {
              onSelect(template);
              onClose();
            }}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}
