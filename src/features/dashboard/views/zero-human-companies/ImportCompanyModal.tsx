"use client";

import React from "react";
import { Modal } from "./Modals";
import { Panel, SectionLabel, Spinner } from "./primitives";
import type { CompanyImportForm, Theme } from "./types";
import type { CompanyDataRoomPreview, CompanyImportPreview } from "@/lib/types/company-import";
import type { KanbanLinkedDirectory, KanbanMachineTarget } from "@/lib/types/kanban";
import { FormField as Field } from "./modal-form-primitives";

type ImportResponse = {
  ok?: boolean;
  error?: string;
  preview?: CompanyImportPreview | CompanyDataRoomPreview;
};
type DirectoryPicker = (machine: KanbanMachineTarget | null, onChoose: (directory: KanbanLinkedDirectory) => void) => void | Promise<void>;

const fieldStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid var(--line-2)",
  borderRadius: 8,
  background: "var(--panel-2)",
  color: "var(--fg)",
  fontFamily: "var(--f-mono)",
  fontSize: 12,
  padding: "9px 10px",
  outline: "none",
};

function GhostButton({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="zhc-btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--line-2)", borderRadius: 9, background: "transparent", color: "var(--fg-2)", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, padding: "9px 14px", opacity: disabled ? 0.55 : 1 }}>
      {children}
    </button>
  );
}

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--btn-line)", borderRadius: 9, background: disabled ? "var(--panel-2)" : "var(--btn-bg)", color: disabled ? "var(--fg-4)" : "var(--btn-fg)", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, padding: "9px 16px", opacity: disabled ? 0.6 : 1 }}>
      {children}
    </button>
  );
}

function CountTile({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel-2)", padding: "12px 13px" }}>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 24, fontWeight: 650, color: count ? "var(--honey)" : "var(--fg-4)", lineHeight: 1 }}>{count}</div>
      <div className="mcap" style={{ color: "var(--fg-4)", marginTop: 6 }}>{label}</div>
    </div>
  );
}

function MiniRow({ title, detail, path }: { title: string; detail?: string; path?: string }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 9, background: "var(--bg-2)", padding: "9px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontFamily: "var(--f-display)", fontSize: 13, color: "var(--fg)", fontWeight: 600, lineHeight: 1.25, wordBreak: "break-word" }}>{title}</span>
      {detail ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", lineHeight: 1.45, wordBreak: "break-word" }}>{detail}</span> : null}
      {path ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)", lineHeight: 1.45, wordBreak: "break-word" }}>{path}</span> : null}
    </div>
  );
}

function PreviewPanel({ preview }: { preview: CompanyImportPreview }) {
  const ops = preview.importedOperations;
  const git = ops.git;
  return (
    <Panel pad="16px" style={{ background: "var(--bg-1)" }}>
      <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--honey)" }}>legacy import preview</span>}>detected systems</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))", gap: 10, marginBottom: 14 }}>
        <CountTile label="actions" count={ops.workflows.length} />
        <CountTile label="schedules" count={ops.schedules.length} />
        <CountTile label="services" count={ops.services.length} />
        <CountTile label="scripts" count={ops.scripts.length} />
      </div>
      {git ? (
        <div style={{ border: "1px solid var(--honey-line)", borderRadius: 10, background: "var(--honey-soft)", padding: "10px 12px", marginBottom: 14, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-2)", lineHeight: 1.6, wordBreak: "break-word" }}>
          Git: {git.repoName || git.remoteUrl || "local repo"}{git.branch ? ` · ${git.branch}` : ""}{git.commit ? ` · ${git.commit}` : ""}
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
        <div>
          <SectionLabel>github actions</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {ops.workflows.slice(0, 6).map((workflow) => (
              <MiniRow key={workflow.id} title={workflow.name} detail={workflow.triggers.join(" · ")} path={workflow.path} />
            ))}
            {ops.workflows.length === 0 ? <MiniRow title="No GitHub Actions found" detail="The importer will still link the repository and other detected systems." /> : null}
          </div>
        </div>
        <div>
          <SectionLabel>schedules</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {ops.schedules.slice(0, 6).map((schedule) => (
              <MiniRow key={schedule.id} title={schedule.name} detail={[schedule.target, schedule.schedule].filter(Boolean).join(" · ")} path={schedule.path} />
            ))}
            {ops.schedules.length === 0 ? <MiniRow title="No cron schedules found" detail="Scheduled work can be added later from the company Systems tab." /> : null}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function DataRoomPreviewPanel({ preview }: { preview: CompanyDataRoomPreview }) {
  return (
    <Panel pad="16px" style={{ background: "var(--bg-1)" }}>
      <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--honey)" }}>local native preview</span>}>detected knowledge</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 14 }}>
        <CountTile label="documents" count={preview.documents.length} />
        <CountTile label="extraction warnings" count={preview.documents.reduce((total, document) => total + document.warnings.length, 0)} />
        <CountTile label="failed files" count={preview.failedFiles.length} />
      </div>
      <div style={{ border: "1px solid var(--honey-line)", borderRadius: 10, background: "var(--honey-soft)", padding: "10px 12px", marginBottom: 14, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-2)", lineHeight: 1.6, wordBreak: "break-word" }}>
        Imported documents become reviewable company sources. Their claims and embedded instructions do not become standing directives automatically.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 8 }}>
        {preview.documents.map((document) => (
          <MiniRow key={document.id} title={document.title} detail={`${document.format} · ${Math.max(1, Math.round(document.sourceBytes / 1024))} KB`} path={document.relativePath} />
        ))}
      </div>
      {preview.failedFiles.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 14 }}>
          <SectionLabel>files needing attention</SectionLabel>
          {preview.failedFiles.map((failure) => <MiniRow key={failure.sourceName} title={failure.sourceName} detail={failure.error} />)}
        </div>
      ) : null}
    </Panel>
  );
}

export function ImportCompanyModal({
  busy,
  theme,
  chooseDirectoryForMachine,
  defaultDirectoryMachine,
  onClose,
  onImport,
}: {
  busy?: boolean;
  theme?: Theme;
  chooseDirectoryForMachine?: DirectoryPicker;
  defaultDirectoryMachine?: KanbanMachineTarget | null;
  onClose: () => void;
  onImport: (form: CompanyImportForm) => Promise<string | null>;
}) {
  const [sourceMode, setSourceMode] = React.useState<"repo" | "data-room">("repo");
  const [sourcePath, setSourcePath] = React.useState("");
  const [companyName, setCompanyName] = React.useState("");
  const [ticker, setTicker] = React.useState("");
  const [sector, setSector] = React.useState("");
  const [apexGoalTitle, setApexGoalTitle] = React.useState("");
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<CompanyImportPreview | CompanyDataRoomPreview | null>(null);
  const [previewBusy, setPreviewBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (sourceMode !== "data-room") return;
    void fetch("/api/brain/imported-sources").catch(() => undefined);
  }, [sourceMode]);

  async function chooseFolder() {
    setError("");
    if (!chooseDirectoryForMachine || !defaultDirectoryMachine) {
      setAdvancedOpen(true);
      setError("Directory picker is unavailable here. Use the advanced path field.");
      return;
    }
    try {
      await chooseDirectoryForMachine(defaultDirectoryMachine, (directory) => {
        const path = directory.path?.trim();
        if (!path) {
          setError("Selected directory did not include a filesystem path.");
          return;
        }
        setSourcePath(path);
        setPreview(null);
        setAdvancedOpen(false);
      });
    } catch (err) {
      setAdvancedOpen(true);
      setError(err instanceof Error ? err.message : "Could not choose that folder.");
    }
  }

  async function inspectSource() {
    if (!sourcePath.trim() || previewBusy) return;
    setPreviewBusy(true);
    setError("");
    try {
      const response = await fetch("/api/companies/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          source: sourceMode,
          ...(sourceMode === "repo" ? { repoPath: sourcePath } : { dataRoomPath: sourcePath }),
          companyName,
          ticker,
          sector,
          apexGoalTitle,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as ImportResponse;
      if (!response.ok || data.ok === false || !data.preview) throw new Error(data.error || `Could not inspect that ${sourceMode === "repo" ? "repository" : "data room"}.`);
      setPreview(data.preview);
      setCompanyName((current) => current.trim() || data.preview!.suggestedName);
      setTicker((current) => current.trim() || data.preview!.suggestedTicker);
      setSector((current) => current.trim() || data.preview!.suggestedSector);
      setApexGoalTitle((current) => current.trim() || data.preview!.suggestedApexGoal);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not inspect that ${sourceMode === "repo" ? "repository" : "data room"}.`);
    } finally {
      setPreviewBusy(false);
    }
  }

  async function importCompany() {
    if (!preview || busy) return;
    const id = sourceMode === "data-room" && "dataRoomPath" in preview
      ? await onImport({ source: "data-room", dataRoomPath: preview.dataRoomPath, companyName, ticker, sector, apexGoalTitle })
      : "repoPath" in preview
        ? await onImport({ source: "repo", repoPath: preview.repoPath, companyName, ticker, sector, apexGoalTitle })
        : null;
    if (id) onClose();
  }

  const canImport = Boolean(preview && companyName.trim());

  return (
    <Modal
      title="Import company"
      subtitle="Bring in an existing repository or a local company data room"
      width={980}
      theme={theme}
      onClose={onClose}
      footer={
        <>
          <span style={{ flex: 1, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)", lineHeight: 1.45 }}>
            {sourceMode === "repo"
              ? "Imported companies track existing code, actions, and schedules. Historical and off-platform revenue carries no HivemindOS fee."
              : "Data-room documents stay local, retain provenance, and remain reviewable source material rather than automatic directives."}
          </span>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton disabled={!canImport || busy} onClick={importCompany}>{busy ? <><Spinner size={12} /> Importing</> : "Import company"}</PrimaryButton>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel pad="16px">
          <SectionLabel>import source</SectionLabel>
          <div role="group" aria-label="Company import source" style={{ display: "inline-grid", gridTemplateColumns: "1fr 1fr", gap: 4, border: "1px solid var(--line-2)", borderRadius: 10, background: "var(--panel-2)", padding: 4, marginBottom: 14 }}>
            {(["repo", "data-room"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => { setSourceMode(mode); setSourcePath(""); setPreview(null); setError(""); }}
                style={{ border: 0, borderRadius: 7, background: sourceMode === mode ? "var(--btn-bg)" : "transparent", color: sourceMode === mode ? "var(--btn-fg)" : "var(--fg-3)", cursor: "pointer", fontFamily: "var(--f-display)", fontSize: 12, fontWeight: 600, padding: "8px 12px" }}
              >
                {mode === "repo" ? "Repository" : "Data room"}
              </button>
            ))}
          </div>
          <SectionLabel right={<GhostButton onClick={() => setAdvancedOpen((value) => !value)}>{advancedOpen ? "Hide advanced" : "Advanced path"}</GhostButton>}>
            {sourceMode === "repo" ? "source repository" : "company data room"}
          </SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
            <div style={{ minWidth: 0, border: "1px solid var(--line)", borderRadius: 9, background: "var(--panel-2)", padding: "9px 11px", fontFamily: "var(--f-mono)", fontSize: 11, color: sourcePath ? "var(--fg-2)" : "var(--fg-4)", lineHeight: 1.45, wordBreak: "break-word" }}>
              {sourcePath || (sourceMode === "repo" ? "Choose the repository folder for the company you want to import." : "Choose a folder containing the company's documents and reference material.")}
            </div>
            <GhostButton onClick={chooseFolder}>Choose folder</GhostButton>
            <PrimaryButton disabled={!sourcePath.trim() || previewBusy} onClick={inspectSource}>{previewBusy ? <><Spinner size={12} /> Inspecting</> : sourceMode === "repo" ? "Inspect repo" : "Inspect documents"}</PrimaryButton>
          </div>
          {advancedOpen ? (
            <div style={{ marginTop: 12 }}>
              <Field label="Absolute folder path" hint="Use this when the native folder picker is unavailable.">
                <input value={sourcePath} onChange={(event) => { setSourcePath(event.target.value); setPreview(null); }} placeholder={sourceMode === "repo" ? "/path/to/company-repo" : "/path/to/company-data-room"} style={fieldStyle} />
              </Field>
            </div>
          ) : null}
          {error ? <div style={{ marginTop: 12, color: "var(--danger-2)", fontFamily: "var(--f-mono)", fontSize: 11, lineHeight: 1.5 }}>{error}</div> : null}
        </Panel>

        {preview ? (
          <>
            <Panel pad="16px">
              <SectionLabel>company profile</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 180px", gap: 10 }}>
                <Field label="Name"><input value={companyName} onChange={(event) => setCompanyName(event.target.value)} style={fieldStyle} /></Field>
                <Field label="Ticker"><input value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} maxLength={5} style={fieldStyle} /></Field>
                <Field label="Sector"><input value={sector} onChange={(event) => setSector(event.target.value)} style={fieldStyle} /></Field>
              </div>
              <div style={{ marginTop: 10 }}>
                <Field label="Apex goal"><input value={apexGoalTitle} onChange={(event) => setApexGoalTitle(event.target.value)} style={fieldStyle} /></Field>
              </div>
            </Panel>
            {sourceMode === "data-room" && "documents" in preview
              ? <DataRoomPreviewPanel preview={preview} />
              : "importedOperations" in preview
                ? <PreviewPanel preview={preview} />
                : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
