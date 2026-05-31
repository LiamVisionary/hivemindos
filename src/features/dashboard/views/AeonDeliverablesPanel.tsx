"use client";

import { Download, ExternalLink, FileJson, FileText, FolderOpen, HardDriveDownload, LoaderCircle, MessageSquare, MonitorDown, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { KanbanMachineTarget } from "@/lib/types/kanban";
import type { AeonDeliverable } from "@/app/api/runtimes/aeon/deliverables/route";

type AeonDeliverablesPanelProps = {
  deliverables: AeonDeliverable[];
  loading: boolean;
  actionBusy: string;
  machines: KanbanMachineTarget[];
  status?: string;
  selectedTransfer: AeonDeliverable | null;
  onRefresh: () => void;
  onOpen: (deliverable: AeonDeliverable) => void;
  onReveal: (deliverable: AeonDeliverable) => void;
  onDownload: (deliverable: AeonDeliverable) => void;
  onChat?: (deliverable: AeonDeliverable) => void;
  onOpenTransfer: (deliverable: AeonDeliverable) => void;
  onCloseTransfer: () => void;
  onSendToMachine: (deliverable: AeonDeliverable, machine: KanbanMachineTarget) => void;
};

function deliverableIcon(deliverable: AeonDeliverable) {
  if (deliverable.kind === "json") return <FileJson aria-hidden="true" className="h-5 w-5" />;
  if (deliverable.availableOnMachine) return <FileText aria-hidden="true" className="h-5 w-5" />;
  return <HardDriveDownload aria-hidden="true" className="h-5 w-5" />;
}

function deliverableTone(deliverable: AeonDeliverable) {
  if (deliverable.kind === "verdict") return "border-[rgba(94,234,212,0.30)] bg-[linear-gradient(135deg,rgba(20,184,166,0.13),rgba(15,23,42,0.48))] text-[var(--accent-strong)]";
  if (deliverable.kind === "miroshark-run" || deliverable.kind === "posts") return "border-sky-300/24 bg-sky-400/10 text-sky-100";
  return "border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.52)] text-[var(--muted)]";
}

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "No timestamp";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sizeLabel(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function fileNameFromTarget(value?: string) {
  const target = String(value || "").split(/[?#]/)[0].replace(/\/+$/, "");
  if (!target) return "";
  try {
    return decodeURIComponent(target.split("/").pop() || target);
  } catch {
    return target.split("/").pop() || target;
  }
}

function deliverableFileName(deliverable: AeonDeliverable) {
  return fileNameFromTarget(deliverable.relativePath || deliverable.path || deliverable.url) || deliverable.title;
}

function artifactTitle(deliverable: AeonDeliverable) {
  const fileName = deliverableFileName(deliverable).toLowerCase();
  if (deliverable.kind === "verdict") return "AEON verdict";
  if (deliverable.kind === "miroshark-run") return "MiroShark run summary";
  if (deliverable.kind === "posts") return "Captured MiroShark posts";
  if (fileName === "aeon-rehearsal.json") return "Workflow dispatch data";
  if (fileName === "posts.json") return "Posts data export";
  if (fileName === "run.json") return "Simulation run data";
  return deliverable.title.replace(/\s+·\s+sim_[\w-]+$/i, "");
}

function artifactPurpose(deliverable: AeonDeliverable) {
  const fileName = deliverableFileName(deliverable).toLowerCase();
  if (deliverable.kind === "verdict") return "AEON's decision, outcome, and next action for this MiroShark rehearsal.";
  if (deliverable.kind === "miroshark-run") return "A readable recap of the simulation scenario, captured activity, and final state.";
  if (deliverable.kind === "posts") return "The human-readable post captures from the simulation, ready for review or handoff.";
  if (fileName === "aeon-rehearsal.json") return "Structured workflow context for audit trails and future agent replay.";
  if (fileName === "posts.json") return "Structured post data for automation, analysis, or attaching to another agent run.";
  if (fileName === "run.json") return "Structured run metadata and raw simulation state for deeper debugging.";
  if (deliverable.source === "remote") return "A remote artifact that can be pulled onto this machine before opening.";
  return "A saved AEON artifact from this workspace.";
}

function readablePreview(deliverable: AeonDeliverable) {
  const summary = String(deliverable.summary || "").trim();
  if (!summary || deliverable.kind === "json" || deliverable.kind === "verdict") return "";
  if (/^\s*[{[]/.test(summary)) return "";
  if (/^[\w\s-]+:\s*[{[]/.test(summary)) return "";
  const cleaned = summary
    .replace(/^Posts\s+-\s+\S+\s+User\s+Text\s+-+\s+-+\s+\d+\s+/i, "")
    .replace(/\s*\|\s*[-:\w\s]+\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^Posts\s+-\s+/i.test(cleaned)) return "";
  return cleaned;
}

function sourceLabel(source: AeonDeliverable["source"]) {
  if (source === "vault") return "Vault synced";
  if (source === "aeon-output") return "AEON output";
  return "Remote";
}

function factItems(deliverable: AeonDeliverable) {
  return [
    deliverable.simulationId ? ["Run", deliverable.simulationId] : null,
    ["Updated", timeLabel(deliverable.updatedAt)],
    sizeLabel(deliverable.size) ? ["Size", sizeLabel(deliverable.size)] : null,
    ["File", deliverableFileName(deliverable)],
    deliverable.repository ? ["Repo", deliverable.repository] : null,
  ].filter((item): item is [string, string] => Boolean(item));
}

export function AeonDeliverablesPanel({
  deliverables,
  loading,
  actionBusy,
  machines,
  status,
  selectedTransfer,
  onRefresh,
  onOpen,
  onReveal,
  onDownload,
  onChat,
  onOpenTransfer,
  onCloseTransfer,
  onSendToMachine,
}: AeonDeliverablesPanelProps) {
  const localCount = deliverables.filter((deliverable) => deliverable.availableOnMachine).length;
  const remoteCount = deliverables.length - localCount;

  return (
    <div className="grid gap-4">
      <section className="relative overflow-hidden rounded-lg border border-[rgba(94,234,212,0.22)] bg-[radial-gradient(circle_at_12%_18%,rgba(94,234,212,0.16),transparent_34%),linear-gradient(135deg,rgba(8,13,22,0.92),rgba(15,23,42,0.78))] p-5">
        <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(94,234,212,0.68),transparent)]" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-2">
            <p className="eyebrow">Deliverables</p>
            <h3 className="m-0 text-xl font-bold text-[var(--foreground)]">AEON artifact inbox</h3>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-md border border-[rgba(94,234,212,0.24)] bg-[rgba(20,184,166,0.10)] px-2 py-1 text-[var(--accent-strong)]">{deliverables.length} deliverable{deliverables.length === 1 ? "" : "s"}</span>
              <span className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(10,14,21,0.52)] px-2 py-1 text-[var(--muted)]">{localCount} on this machine</span>
              {remoteCount ? <span className="rounded-md border border-amber-300/24 bg-amber-400/10 px-2 py-1 text-amber-100">{remoteCount} remote</span> : null}
            </div>
          </div>
          <Button type="button" variant="secondary" onClick={onRefresh} disabled={loading}>
            {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
            Refresh
          </Button>
        </div>
        {status ? <p className="m-0 mt-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.30)] px-3 py-2 text-sm text-[var(--foreground)]">{status}</p> : null}
      </section>

      {deliverables.length ? (
        <section className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {deliverables.map((deliverable) => {
            const preview = readablePreview(deliverable);
            return (
              <article key={deliverable.id} className="grid min-h-[280px] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 rounded-lg border border-[rgba(148,163,184,0.16)] bg-[linear-gradient(145deg,rgba(10,14,21,0.82),rgba(13,20,31,0.66))] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
                <div className="flex items-start gap-3">
                  <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md border ${deliverableTone(deliverable)}`}>
                    {deliverableIcon(deliverable)}
                  </span>
                  <div className="grid min-w-0 gap-2">
                    <h4 className="m-0 break-words text-lg font-bold leading-tight text-[var(--foreground)]">{artifactTitle(deliverable)}</h4>
                    <div className="flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em]">
                      <span className="rounded border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.32)] px-2 py-1 text-[var(--muted)]">{sourceLabel(deliverable.source)}</span>
                      <span className="rounded border border-[rgba(94,234,212,0.20)] bg-[rgba(20,184,166,0.08)] px-2 py-1 text-[var(--accent-strong)]">{deliverable.kind}</span>
                      {deliverable.status ? <span className="rounded border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-emerald-100">{deliverable.status}</span> : null}
                    </div>
                  </div>
                </div>

                <div className="grid content-start gap-3">
                  <div className="rounded-lg border border-[rgba(94,234,212,0.14)] bg-[rgba(20,184,166,0.06)] p-3">
                    <p className="m-0 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--accent-strong)]">What this is</p>
                    <p className="m-0 mt-2 text-sm leading-6 text-[var(--foreground)]">{artifactPurpose(deliverable)}</p>
                    {preview ? <p className="m-0 mt-3 border-l-2 border-[rgba(94,234,212,0.38)] pl-3 text-xs leading-5 text-[var(--muted)]">{preview}</p> : null}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {factItems(deliverable).map(([label, value]) => (
                      <div key={`${label}:${value}`} className="rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(2,6,23,0.26)] p-2">
                        <p className="m-0 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--muted)]">{label}</p>
                        <p className="m-0 mt-1 break-words text-xs leading-5 text-[var(--foreground)]">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => onOpen(deliverable)} disabled={!deliverable.availableOnMachine && !deliverable.url}>
                    <ExternalLink aria-hidden="true" />
                    Open
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => onReveal(deliverable)} disabled={!deliverable.availableOnMachine || !deliverable.path}>
                    <FolderOpen aria-hidden="true" />
                    Finder
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => onChat?.(deliverable)}
                    title={onChat ? `Chat about ${deliverable.title}` : "Chat handoff preview; wiring comes after testing."}
                  >
                    <MessageSquare aria-hidden="true" />
                    Chat
                  </Button>
                  {!deliverable.availableOnMachine ? (
                    <Button type="button" size="sm" variant="secondary" onClick={() => onDownload(deliverable)} disabled={actionBusy === `download:${deliverable.id}`}>
                      {actionBusy === `download:${deliverable.id}` ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <MonitorDown aria-hidden="true" />}
                      Download
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="ghost" onClick={() => onOpenTransfer(deliverable)} disabled={!deliverable.availableOnMachine || !deliverable.path}>
                    <Send aria-hidden="true" />
                    Download to Machine
                  </Button>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="grid min-h-[260px] place-items-center rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(10,14,21,0.60)] p-6 text-center">
          <div className="grid max-w-sm justify-items-center gap-3">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-md border border-[rgba(94,234,212,0.24)] bg-[rgba(20,184,166,0.08)] text-[var(--accent-strong)]">
              <FileText aria-hidden="true" className="h-6 w-6" />
            </span>
            <h4 className="m-0 text-base font-bold text-[var(--foreground)]">No deliverables found</h4>
          </div>
        </section>
      )}

      {selectedTransfer ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(2,6,23,0.72)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Download deliverable to machine">
          <div className="grid max-h-[calc(100vh-2rem)] w-full max-w-3xl gap-4 overflow-auto rounded-lg border border-[rgba(94,234,212,0.24)] bg-[rgba(10,14,21,0.96)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">Target machine</p>
                <h3 className="m-0 break-words text-lg font-bold text-[var(--foreground)]">{selectedTransfer.title}</h3>
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label="Close machine selector" onClick={onCloseTransfer}>
                <X aria-hidden="true" />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {machines.map((machine) => (
                <button
                  key={`${machine.key}:${machine.collectorUrl || ""}`}
                  type="button"
                  className="grid gap-3 rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(15,23,42,0.48)] p-4 text-left transition hover:border-[rgba(94,234,212,0.36)] hover:bg-[rgba(20,184,166,0.08)]"
                  onClick={() => onSendToMachine(selectedTransfer, machine)}
                  disabled={Boolean(actionBusy)}
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[rgba(94,234,212,0.22)] bg-[rgba(20,184,166,0.08)] text-[var(--accent-strong)]">
                    {actionBusy === `send:${selectedTransfer.id}:${machine.key}` ? <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" /> : <MonitorDown aria-hidden="true" className="h-5 w-5" />}
                  </span>
                  <span className="grid gap-1">
                    <strong className="text-sm text-[var(--foreground)]">{machine.name}</strong>
                    <span className="break-words text-xs leading-5 text-[var(--muted)]">{machine.collectorUrl || machine.key}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
