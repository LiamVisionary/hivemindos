"use client";

import * as React from "react";
import { Bot, Clock3, Laptop, MessageSquare, Search, Settings2, X } from "lucide-react";
import type { FleetSearchItem } from "@/components/fleet/fleet-search";

type FinderSection = {
  id: string;
  label: string;
  items: FleetSearchItem[];
};

type FleetFinderProps = {
  index: FleetSearchItem[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  open: boolean;
  query: string;
  recentItems: FleetSearchItem[];
  results: FleetSearchItem[];
  onLocate: (item: FleetSearchItem) => void;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onChat?: (item: FleetSearchItem) => void;
  onSettings?: (item: FleetSearchItem) => void;
};

function stateColor(item: FleetSearchItem) {
  if (item.state === "working") return "var(--live)";
  if (item.state === "failed") return "var(--danger)";
  if (item.state === "setup" || item.state === "scheduled") return "var(--honey)";
  return "var(--fg-4)";
}

function dedupeItems(items: FleetSearchItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

export function FleetFinder({
  index,
  inputRef,
  open,
  query,
  recentItems,
  results,
  onLocate,
  onOpenChange,
  onQueryChange,
  onChat,
  onSettings,
}: FleetFinderProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const listId = React.useId();
  const [activeIndex, setActiveIndex] = React.useState(0);
  const hasQuery = Boolean(query.trim());

  const sections = React.useMemo<FinderSection[]>(() => {
    if (hasQuery) {
      return [
        { id: "machines", label: "Machines", items: results.filter((item) => item.kind === "machine") },
        { id: "agents", label: "Agents", items: results.filter((item) => item.kind === "agent") },
      ].filter((section) => section.items.length > 0);
    }

    const recentKeys = new Set(recentItems.map((item) => item.key));
    const machineIndex = index.filter((item) => item.kind === "machine" && !recentKeys.has(item.key));
    return [
      { id: "recent", label: "Recent", items: recentItems },
      { id: "machines", label: "Machines", items: machineIndex },
    ].filter((section) => section.items.length > 0);
  }, [hasQuery, index, recentItems, results]);

  const selectableItems = React.useMemo(
    () => dedupeItems(sections.flatMap((section) => section.items)),
    [sections],
  );
  const boundedActiveIndex = Math.min(activeIndex, Math.max(0, selectableItems.length - 1));
  const activeItem = selectableItems[boundedActiveIndex];

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      onOpenChange(false);
      inputRef.current?.blur();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [inputRef, onOpenChange, open]);

  return (
    <div className="fr-finder" ref={rootRef}>
      <Search aria-hidden="true" className="fr-finder-search-icon" size={15} />
      <input
        ref={inputRef}
        type="search"
        value={query}
        role="combobox"
        aria-label="Find a machine or agent"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeItem ? `${listId}-option-${boundedActiveIndex}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Find a machine or agent…"
        onFocus={() => onOpenChange(true)}
        onClick={() => onOpenChange(true)}
        onChange={(event) => {
          onQueryChange(event.target.value);
          setActiveIndex(0);
          onOpenChange(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((indexValue) => Math.min(indexValue + 1, selectableItems.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((indexValue) => Math.max(indexValue - 1, 0));
          } else if (event.key === "Enter" && activeItem) {
            event.preventDefault();
            onLocate(activeItem);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onOpenChange(false);
            inputRef.current?.blur();
          }
        }}
      />
      {query ? (
        <button
          type="button"
          className="fr-finder-clear"
          aria-label="Clear Fleet search"
          title="Clear Fleet search"
          onClick={() => {
            onQueryChange("");
            setActiveIndex(0);
            inputRef.current?.focus();
          }}
        >
          <X aria-hidden="true" size={13} />
        </button>
      ) : (
        <kbd className="fr-finder-key">/</kbd>
      )}

      {open ? (
        <div className="fr-finder-menu" id={listId} role="listbox" aria-label="Fleet search results">
          {sections.length ? sections.map((section) => (
            <section className="fr-finder-section" key={section.id} aria-label={section.label}>
              <div className="fr-finder-section-label">
                {section.id === "recent" ? <Clock3 aria-hidden="true" size={12} /> : null}
                <span>{section.label}</span>
                <span>{section.items.length}</span>
              </div>
              {section.items.map((item) => {
                const itemIndex = selectableItems.findIndex((candidate) => candidate.key === item.key);
                const active = itemIndex === boundedActiveIndex;
                const Icon = item.kind === "machine" ? Laptop : Bot;
                return (
                  <div
                    key={item.key}
                    id={`${listId}-option-${itemIndex}`}
                    role="option"
                    aria-selected={active}
                    className="fr-finder-result"
                    data-active={active ? "true" : undefined}
                    onMouseEnter={() => setActiveIndex(itemIndex)}
                  >
                    <button type="button" className="fr-finder-result-main" onClick={() => onLocate(item)}>
                      <span className="fr-finder-result-icon"><Icon aria-hidden="true" size={16} /></span>
                      <span className="fr-finder-result-copy">
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </span>
                      <span className="fr-finder-state" style={{ color: stateColor(item) }} aria-label={item.state} />
                    </button>
                    {item.kind === "agent" && (onChat || onSettings) ? (
                      <span className="fr-finder-result-actions">
                        {onChat ? (
                          <button type="button" title={`Chat with ${item.label}`} aria-label={`Chat with ${item.label}`} onClick={() => { onOpenChange(false); onChat(item); }}>
                            <MessageSquare aria-hidden="true" size={14} />
                          </button>
                        ) : null}
                        {onSettings ? (
                          <button type="button" title={`Open ${item.label} settings`} aria-label={`Open ${item.label} settings`} onClick={() => { onOpenChange(false); onSettings(item); }}>
                            <Settings2 aria-hidden="true" size={14} />
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </section>
          )) : (
            <div className="fr-finder-empty">
              <Search aria-hidden="true" size={20} />
              <strong>No match in this hive</strong>
              <span>Try a machine name, agent, runtime, role, model, location, or current task.</span>
            </div>
          )}
          <footer className="fr-finder-footer">
            <span>↑↓ choose</span>
            <span>Enter locate</span>
            <span>Esc close</span>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
