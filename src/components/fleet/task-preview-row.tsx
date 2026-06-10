"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils/cn";

import styles from "./fleet-tokens.module.css";

type FleetTaskPreviewRowProps = {
  id: string;
  title: string;
  since?: string;
  expanded: boolean;
  subjectName: string;
  className?: string;
  textClassName?: string;
  children?: React.ReactNode;
  onToggle: (id: string) => void;
};

export function FleetTaskPreviewRow({
  id,
  title,
  since,
  expanded,
  subjectName,
  className,
  textClassName,
  children,
  onToggle,
}: FleetTaskPreviewRowProps) {
  const textRef = React.useRef<HTMLSpanElement | null>(null);
  const [expandable, setExpandable] = React.useState(false);

  const measure = React.useCallback(() => {
    if (expanded) return;
    const element = textRef.current;
    if (!element) return;
    const nextExpandable = element.scrollHeight > element.clientHeight + 1
      || element.scrollWidth > element.clientWidth + 1;
    setExpandable((current) => current === nextExpandable ? current : nextExpandable);
  }, [expanded]);

  React.useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [measure, title]);

  const toggle = () => {
    if (expandable) onToggle(id);
  };

  return (
    <div
      role={expandable ? "button" : undefined}
      tabIndex={expandable ? 0 : undefined}
      onClick={(event) => {
        event.stopPropagation();
        toggle();
      }}
      onKeyDown={(event) => {
        if (!expandable || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        event.stopPropagation();
        toggle();
      }}
      className={cn(
        styles.rosterTaskPreview,
        className,
        expanded && styles.rosterTaskPreviewExpanded,
        !expandable && styles.rosterTaskPreviewNoExpand,
      )}
      aria-expanded={expandable ? expanded : undefined}
      aria-label={expandable ? `${expanded ? "Collapse" : "Expand"} recent chat for ${subjectName}` : undefined}
    >
      <span
        ref={textRef}
        className={cn(
          styles.rosterTaskPreviewText,
          textClassName,
          expanded ? "" : styles.rosterTaskPreviewTextCollapsed,
        )}
      >
        {title}
      </span>
      {children}
      {since ? (
        <span
          aria-hidden="true"
          style={{
            color: "var(--muted)",
            fontFamily: "var(--f-mono)",
            fontSize: 9,
            whiteSpace: "nowrap",
          }}
        >
          {since}
        </span>
      ) : null}
      {expandable ? <ChevronDown className={styles.rosterTaskPreviewChevron} size={13} aria-hidden="true" /> : null}
    </div>
  );
}
