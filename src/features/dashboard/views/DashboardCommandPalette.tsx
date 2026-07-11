"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentNotification } from "@/lib/types/agent-notifications";
import type { KanbanTask } from "@/lib/types/kanban";
import type { DashboardRouteTarget, DashboardRouteCatalogItem } from "@/features/dashboard/dashboard-navigation";
import { DASHBOARD_ROUTE_CATALOG, dashboardRouteForView } from "@/features/dashboard/dashboard-navigation";

type CommandAction = {
  id: string;
  group: string;
  label: string;
  detail: string;
  shortcut?: string;
  target: DashboardRouteTarget;
  keywords: Array<string | undefined>;
};

type DashboardCommandPaletteProps = {
  activeView: string;
  displayAgents: AgentProfile[];
  // agentId is read defensively; canonical KanbanTask carries `assignee` instead.
  kanbanTasks: Array<KanbanTask & { agentId?: string }>;
  navItems: Array<{ id: string; label: string; detail: string }>;
  // kanbanTaskId is read defensively; canonical AgentNotification does not define it.
  notifications: Array<AgentNotification & { kanbanTaskId?: string }>;
  open: boolean;
  recents: DashboardRouteTarget[];
  onNavigate: (target: DashboardRouteTarget) => void;
  onOpenChange: (open: boolean) => void;
  onPopout: (target: DashboardRouteTarget) => void;
};

function normalize(value: string) {
  return value.toLowerCase().trim();
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function routeAction(item: DashboardRouteCatalogItem): CommandAction {
  return {
    id: `route:${item.id}`,
    group: item.group,
    label: item.label,
    detail: item.detail,
    shortcut: item.shortcut,
    target: { view: item.id },
    keywords: item.keywords,
  };
}

export function DashboardCommandPalette(props: DashboardCommandPaletteProps) {
  const { activeView, displayAgents, kanbanTasks, navItems, notifications, open, recents, onNavigate, onOpenChange, onPopout } = props;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const actions = useMemo(() => {
    const navDetails = new Map(navItems.map((item) => [item.id, item.detail]));
    const routeActions = DASHBOARD_ROUTE_CATALOG.map((item) => ({
      ...routeAction(item),
      detail: navDetails.get(item.id) ?? item.detail,
    }));
    const recentActions = recents.map((target, index): CommandAction => {
      const route = dashboardRouteForView(target.view);
      return {
        id: `recent:${index}:${target.view}:${target.taskId ?? target.agentId ?? ""}`,
        group: "Recents",
        label: route.label,
        detail: target.taskId ? `Recent task ${target.taskId}` : target.agentId ? `Recent agent ${target.agentId}` : route.detail,
        target,
        keywords: [route.label, route.detail, target.taskId ?? "", target.agentId ?? ""],
      };
    });
    const agentActions = displayAgents.map((agent): CommandAction => ({
      id: `agent:${agent.id}`,
      group: "Agents",
      label: agent.name ?? agent.id,
      detail: agent.machineName ? `Locate in Fleet on ${agent.machineName}` : "Locate in Fleet",
      target: { view: "agents", agentId: agent.id },
      keywords: [agent.id, agent.name, agent.runtime, agent.machineName].filter(Boolean),
    }));
    const taskActions = kanbanTasks.slice(0, 24).map((task): CommandAction => ({
      id: `task:${task.id}`,
      group: "Tasks",
      label: task.title ?? "Untitled task",
      detail: [task.status, task.agentId].filter(Boolean).join(" · ") || "Open task board",
      target: { view: "kanban", taskId: task.id, agentId: task.agentId },
      keywords: [task.id, task.title, task.status, task.agentId].filter(Boolean),
    }));
    const alertActions = notifications.filter((item) => !item.read).slice(0, 12).map((notification): CommandAction => ({
      id: `notification:${notification.id}`,
      group: "Alerts",
      label: notification.title ?? "Agent alert",
      detail: notification.agentName || notification.priority || "Open alerts",
      target: notification.kanbanTaskId
        ? { view: "kanban", taskId: notification.kanbanTaskId, agentId: notification.agentId }
        : notification.agentId
          ? { view: "chat", agentId: notification.agentId }
          : { view: "notifications" },
      keywords: [notification.title, notification.body, notification.agentName, notification.priority, notification.kind].filter(Boolean),
    }));
    return [...recentActions, ...routeActions, ...agentActions, ...taskActions, ...alertActions];
  }, [displayAgents, kanbanTasks, navItems, notifications, recents]);

  const filteredActions = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return actions;
    return actions.filter((action) => normalize([
      action.label,
      action.detail,
      action.group,
      action.shortcut,
      ...action.keywords,
    ].join(" ")).includes(needle));
  }, [actions, query]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      setQuery("");
      setActiveIndex(0);
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(true);
        return;
      }
      if (meta && !event.shiftKey && ["1", "2", "3", "4", "5", "6"].includes(event.key)) {
        event.preventDefault();
        const targetView = (["agents", "kanban", "vault", "chat", "wallet", "more"] as const)[Number(event.key) - 1];
        onNavigate({ view: targetView });
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onNavigate({ view: "kanban" });
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        onNavigate({ view: "chat" });
        return;
      }
      if (meta && event.key === "[") {
        event.preventDefault();
        window.history.back();
        return;
      }
      if (meta && event.key === "]") {
        event.preventDefault();
        window.history.forward();
        return;
      }
      if (!open || isEditableTarget(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onNavigate, onOpenChange]);

  if (!open) return null;

  const activeAction = filteredActions[activeIndex];
  const chooseAction = (action: CommandAction) => {
    onNavigate(action.target);
    onOpenChange(false);
  };

  return (
    <div className="commandPaletteOverlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onOpenChange(false);
    }}>
      <section className="commandPalette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="commandPaletteSearch">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            aria-label="Search routes, agents, tasks, inbox items, and recents"
            placeholder="Search routes, agents, tasks, inbox..."
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onOpenChange(false);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, filteredActions.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter" && activeAction) {
                event.preventDefault();
                chooseAction(activeAction);
              }
            }}
          />
          <kbd>{navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K"}</kbd>
        </div>
        <div className="commandPaletteList" role="listbox" aria-label="Command results">
          {filteredActions.length ? filteredActions.map((action, index) => (
            <button
              key={action.id}
              type="button"
              className={index === activeIndex ? "active" : ""}
              aria-selected={index === activeIndex}
              role="option"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => chooseAction(action)}
            >
              <span className="commandPaletteActionText">
                <small>{action.group}</small>
                <strong>{action.label}</strong>
                <em>{action.detail}</em>
              </span>
              <span className="commandPaletteActions">
                {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
                <i
                  title="Open in a new window"
                  aria-label={`Open ${action.label} in a new window`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onPopout(action.target);
                    onOpenChange(false);
                  }}
                >
                  <ExternalLink aria-hidden="true" />
                </i>
              </span>
            </button>
          )) : (
            <p className="commandPaletteEmpty">No matching route, agent, task, or inbox item.</p>
          )}
        </div>
        <div className="commandPaletteFooter">
          <span>Enter to open</span>
          <span>Esc to close</span>
          <span>{activeView}</span>
        </div>
      </section>
    </div>
  );
}
