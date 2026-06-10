"use client";

import { AppWindow, Bot, ExternalLink, MessageSquare, PlugZap, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AGENT_APP_CATALOG, BUILT_IN_AGENT_TOOLS } from "@/features/dashboard/agent-capability-catalog";
import { runtimeCapabilities } from "@/features/dashboard/dashboard-storage";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import { RUNTIME_LABELS, type AgentProfile, type RuntimeCapabilities } from "@/lib/types/agent-runtime";

type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;

type AgentToolsPanelProps = {
  activeView: DashboardView;
  displayAgents: AgentProfile[];
  fleetClass: ClassNameBuilder;
  setActiveView: (view: DashboardView) => void;
  startAgentChat: (agentId: string, options?: { fresh?: boolean; runtimeSessionId?: string }) => void | Promise<void>;
};

const TOOL_CAPABILITY_LABELS: Array<[keyof RuntimeCapabilities, string]> = [
  ["skills", "Skills"],
  ["sessionSearch", "Sessions"],
  ["backgroundTasks", "Background"],
  ["xSearch", "X search"],
  ["imageGeneration", "Images"],
  ["ttsGeneration", "TTS"],
  ["musicGeneration", "Music"],
  ["sfxGeneration", "SFX"],
  ["model3dGeneration", "3D"],
  ["videoGeneration", "Media"],
  ["codexRuntime", "Codex"],
  ["kanbanDecompose", "Kanban"],
  ["walletTools", "Wallet"],
  ["modelSelection", "Models"],
  ["skillActions", "Actions"],
];

export function AgentToolsPanel({ activeView, displayAgents, fleetClass, setActiveView, startAgentChat }: AgentToolsPanelProps) {
  if (activeView !== "tools") return null;

  const appHandleCount = AGENT_APP_CATALOG.reduce((sum, app) => sum + app.handles.length, 0);

  return (
    <section className={fleetClass("taskPanel", "tabPanel")}>
      <div className={fleetClass("taskPanelHeader")}>
        <div>
          <p className="eyebrow">Tools</p>
          <h2>Callable handles for agents</h2>
          <p>Apps are providers; tools are the handles agents receive from built-ins, runtimes, and installed services.</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => setActiveView("my-apps")}>
          <AppWindow aria-hidden="true" />
          Apps & Services
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <MetricCard label="Built-ins" value={BUILT_IN_AGENT_TOOLS.length} detail="Native handles available without installing an app." />
        <MetricCard label="Runtime exposure" value={displayAgents.length} detail="Configured agents that can receive runtime-specific tools." />
        <MetricCard label="App handles" value={appHandleCount} detail="Installable provider handles from the Apps catalog." />
      </div>

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Built-in handles</p>
            <h3 className="m-0 text-base font-bold text-[var(--foreground)]">Native agent tools</h3>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {BUILT_IN_AGENT_TOOLS.map((tool) => (
            <article key={tool.id} className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[rgba(94,234,212,0.24)] bg-[rgba(20,184,166,0.10)] text-[var(--accent-strong)]">
                  <Wrench aria-hidden="true" className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <strong className="block text-sm text-[var(--foreground)]">{tool.name}</strong>
                  <span className="font-mono text-[11px] text-[var(--muted)]">{tool.handle}</span>
                </div>
              </div>
              <p className="m-0 text-xs leading-5 text-[var(--muted)]">{tool.description}</p>
              <BadgeRow labels={[tool.scope, ...tool.badges]} />
            </article>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3">
          <p className="eyebrow">Runtime exposure</p>
          <h3 className="m-0 text-base font-bold text-[var(--foreground)]">What configured agents can receive now</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {displayAgents.map((agent) => {
            const capabilities = runtimeCapabilities(agent);
            const labels = TOOL_CAPABILITY_LABELS
              .filter(([key]) => Boolean(capabilities[key]))
              .map(([, label]) => label);
            return (
              <article key={agent.id} className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[rgba(251,191,36,0.22)] bg-[rgba(251,191,36,0.08)] text-amber-200">
                    <Bot aria-hidden="true" className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <strong className="block text-sm text-[var(--foreground)]">{agent.name}</strong>
                    <span className="text-xs text-[var(--muted)]">{RUNTIME_LABELS[agent.runtime as keyof typeof RUNTIME_LABELS] ?? agent.runtime}</span>
                  </div>
                </div>
                <BadgeRow labels={labels.length ? labels : ["Chat"]} />
                <Button type="button" size="sm" variant="secondary" className="w-fit" onClick={() => void startAgentChat(agent.id, { fresh: true })}>
                  <MessageSquare aria-hidden="true" />
                  Open chat
                </Button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">App-provided handles</p>
            <h3 className="m-0 text-base font-bold text-[var(--foreground)]">Installable providers from Apps & Services</h3>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => setActiveView("my-apps")}>
            <PlugZap aria-hidden="true" />
            Manage apps
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {AGENT_APP_CATALOG.slice(0, 8).map((app) => (
            <article key={app.id} className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
              <div>
                <strong className="block text-sm text-[var(--foreground)]">{app.name}</strong>
                <span className="text-xs text-[var(--muted)]">{app.category}</span>
              </div>
              <BadgeRow labels={app.handles} />
              <a className="inline-flex w-fit items-center gap-2 text-xs font-bold text-[var(--accent-strong)] hover:text-[var(--foreground)]" href={app.sourceUrl} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                Source
              </a>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <article className="rounded-md border border-[rgba(94,234,212,0.16)] bg-[rgba(20,184,166,0.07)] p-4">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</span>
      <strong className="mt-2 block text-2xl text-[var(--foreground)]">{value}</strong>
      <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">{detail}</p>
    </article>
  );
}

function BadgeRow({ labels }: { labels: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span key={label} className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(15,23,42,0.58)] px-2 py-1 text-[11px] font-bold text-[var(--muted)]">
          {label}
        </span>
      ))}
    </div>
  );
}
