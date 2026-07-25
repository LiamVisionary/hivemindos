"use client";

import {
  ChevronDown,
  ChevronRight,
  Code2,
  Download,
  ExternalLink,
  Eye,
  File,
  Folder,
  LoaderCircle,
  Monitor,
  RefreshCw,
  Rocket,
  Save,
  Send,
  Smartphone,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ChatPreviewTarget } from "@/lib/services/chat/chat-preview-targets";
import { APP_BUILDER_CONFIRMATIONS } from "@/lib/services/app-builder/contract";

import { PreviewFrame } from "./ContextShelf";
import { HexIco } from "./composer-primitives";
import styles from "./app-builder-workspace.module.css";

type AppBuilderRequest = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;

type AppBuilderProject = {
  id?: string;
  name?: string;
  directory?: string;
  templateId?: string;
  status?: string;
};

export type WorkspaceMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

type AppFileEntry = {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
};

type SourceExport = {
  fileName: string;
  contentType: string;
  contentBase64: string;
  bytes: number;
  sha256: string;
};

type DeploymentResult = {
  deploymentUrl: string;
  claimUrl?: string;
  expiresInSeconds?: number;
};

export type AppBuilderWorkspaceProps = {
  target: ChatPreviewTarget;
  project: AppBuilderProject | null;
  threadTitle: string;
  agentName: string;
  machineLabel: string;
  messages: WorkspaceMessage[];
  chatDraft: string;
  chatBusy: boolean;
  onChatDraftChange: (value: string) => void;
  onSendPrompt: (prompt: string) => void | Promise<void>;
  onClose: () => void;
  requestAppBuilder: AppBuilderRequest;
};

function cleanRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function entriesFromPayload(payload: Record<string, unknown>) {
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  return entries.filter((entry): entry is AppFileEntry => {
    const candidate = cleanRecord(entry);
    return typeof candidate.name === "string"
      && typeof candidate.path === "string"
      && (candidate.type === "dir" || candidate.type === "file");
  });
}

function base64Bytes(contentBase64: string) {
  const binary = window.atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function fileLanguage(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase() || "text";
  const labels: Record<string, string> = {
    css: "CSS",
    html: "HTML",
    js: "JavaScript",
    json: "JSON",
    jsx: "JSX",
    md: "Markdown",
    mjs: "JavaScript",
    ts: "TypeScript",
    tsx: "TSX",
  };
  return labels[extension] || extension.toUpperCase();
}

function projectTypeLabel(templateId: string | undefined) {
  return templateId === "nextjs" ? "Next.js project" : "HTML, CSS & JavaScript";
}

function formatBytes(value: number | undefined) {
  if (!Number.isFinite(value)) return "";
  if ((value ?? 0) < 1_024) return `${value} B`;
  return `${((value ?? 0) / 1_024).toFixed(1)} KB`;
}

function FileTreeBranch({
  directory,
  directoryEntries,
  expandedDirectories,
  selectedPath,
  onToggleDirectory,
  onSelectFile,
}: {
  directory: string;
  directoryEntries: Record<string, AppFileEntry[]>;
  expandedDirectories: Set<string>;
  selectedPath: string;
  onToggleDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
}) {
  return (
    <div className={styles.fileTreeBranch} role="group">
      {(directoryEntries[directory] ?? []).map((entry) => entry.type === "dir" ? (
        <div key={entry.path}>
          <button
            type="button"
            className={styles.fileTreeRow}
            onClick={() => onToggleDirectory(entry.path)}
            aria-expanded={expandedDirectories.has(entry.path)}
          >
            {expandedDirectories.has(entry.path) ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            <Folder aria-hidden />
            <span>{entry.name}</span>
          </button>
          {expandedDirectories.has(entry.path) ? (
            <FileTreeBranch
              directory={entry.path}
              directoryEntries={directoryEntries}
              expandedDirectories={expandedDirectories}
              selectedPath={selectedPath}
              onToggleDirectory={onToggleDirectory}
              onSelectFile={onSelectFile}
            />
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          key={entry.path}
          className={styles.fileTreeRow}
          data-active={selectedPath === entry.path ? "true" : undefined}
          onClick={() => onSelectFile(entry.path)}
          title={entry.path}
        >
          <span className={styles.fileSpacer} aria-hidden />
          <File aria-hidden />
          <span>{entry.name}</span>
          <small>{formatBytes(entry.size)}</small>
        </button>
      ))}
    </div>
  );
}

export function AppBuilderWorkspace({
  target,
  project,
  threadTitle,
  agentName,
  machineLabel,
  messages,
  chatDraft,
  chatBusy,
  onChatDraftChange,
  onSendPrompt,
  onClose,
  requestAppBuilder,
}: AppBuilderWorkspaceProps) {
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [directoryEntries, setDirectoryEntries] = useState<Record<string, AppFileEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState(() => new Set<string>());
  const [treeBusy, setTreeBusy] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployment, setDeployment] = useState<DeploymentResult | null>(null);

  const projectName = project?.name || target.name || "Generated app";
  const hasProject = Boolean(project?.id && project?.directory);
  const dirty = selectedPath !== "" && draftContent !== savedContent;

  const requestProjectAction = useCallback((body: Record<string, unknown>) => {
    if (!project?.id || !project.directory) throw new Error("This preview is not linked to an editable App Builder project.");
    return requestAppBuilder({
      backend: "local",
      projectId: project.id,
      directory: project.directory,
      machineKey: target.machineKey,
      collectorUrl: target.collectorUrl,
      ...body,
    });
  }, [project, requestAppBuilder, target.collectorUrl, target.machineKey]);

  const loadDirectory = useCallback(async (path: string) => {
    if (!hasProject) return;
    setTreeBusy(true);
    setWorkspaceError("");
    try {
      const payload = await requestProjectAction({ action: "files_tree", ...(path ? { path } : {}) });
      setDirectoryEntries((current) => ({ ...current, [path]: entriesFromPayload(payload) }));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Could not load the project files.");
    } finally {
      setTreeBusy(false);
    }
  }, [hasProject, requestProjectAction]);

  const selectFile = useCallback(async (path: string, allowDiscard = false) => {
    if (!path || path === selectedPath) return;
    if (dirty && !allowDiscard && !window.confirm("Discard the unsaved edits in this file?")) return;
    setFileBusy(true);
    setWorkspaceError("");
    try {
      const payload = await requestProjectAction({ action: "files_read", path });
      const content = typeof payload.content === "string" ? payload.content : "";
      setSelectedPath(path);
      setSavedContent(content);
      setDraftContent(content);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Could not read the selected file.");
    } finally {
      setFileBusy(false);
    }
  }, [dirty, requestProjectAction, selectedPath]);

  useEffect(() => {
    if (mode !== "code" || !hasProject || selectedPath) return;
    const candidates = project?.templateId === "nextjs"
      ? ["src/app/page.tsx", "src/app/globals.css", "package.json"]
      : ["index.html", "styles.css", "script.js"];
    let cancelled = false;
    void (async () => {
      for (const path of candidates) {
        try {
          const payload = await requestProjectAction({ action: "files_read", path });
          if (cancelled) return;
          const content = typeof payload.content === "string" ? payload.content : "";
          setSelectedPath(path);
          setSavedContent(content);
          setDraftContent(content);
          return;
        } catch {
          // Adopted projects can have any layout. The visible tree remains the fallback.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [hasProject, mode, project?.templateId, requestProjectAction, selectedPath]);

  const toggleDirectory = useCallback((path: string) => {
    const opening = !expandedDirectories.has(path);
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (opening && !directoryEntries[path]) void loadDirectory(path);
  }, [directoryEntries, expandedDirectories, loadDirectory]);

  async function saveFile() {
    if (!selectedPath || !dirty) return;
    setFileBusy(true);
    setWorkspaceError("");
    try {
      const payload = await requestProjectAction({
        action: "files_write",
        path: selectedPath,
        content: draftContent,
        confirmation: APP_BUILDER_CONFIRMATIONS.writeFile,
      });
      const content = typeof payload.content === "string" ? payload.content : draftContent;
      setSavedContent(content);
      setDraftContent(content);
      setPreviewRefreshKey((key) => key + 1);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Could not save the selected file.");
    } finally {
      setFileBusy(false);
    }
  }

  async function exportProject() {
    setExportBusy(true);
    setWorkspaceError("");
    try {
      const payload = await requestProjectAction({ action: "export_source" });
      const sourceExport = cleanRecord(payload.export) as Partial<SourceExport>;
      if (!sourceExport.contentBase64 || !sourceExport.fileName) throw new Error("App Builder did not return a source archive.");
      const blob = new Blob([base64Bytes(sourceExport.contentBase64)], { type: sourceExport.contentType || "application/gzip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = sourceExport.fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Could not export the project source.");
    } finally {
      setExportBusy(false);
    }
  }

  async function deployProject() {
    setDeployBusy(true);
    setDeployment(null);
    setWorkspaceError("");
    try {
      const payload = await requestProjectAction({
        action: "test_deploy",
        name: projectName,
        runtime: "static",
        confirmation: APP_BUILDER_CONFIRMATIONS.temporaryDeploy,
      });
      const result = cleanRecord(payload) as Partial<DeploymentResult>;
      if (!result.deploymentUrl) throw new Error("The deployment completed without a public URL.");
      setDeployment({
        deploymentUrl: result.deploymentUrl,
        claimUrl: result.claimUrl,
        expiresInSeconds: result.expiresInSeconds,
      });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Could not deploy this app.");
    } finally {
      setDeployBusy(false);
    }
  }

  function closeWorkspace() {
    if (dirty && !window.confirm("Close the workspace and discard the unsaved edits in this file?")) return;
    onClose();
  }

  function showCode() {
    setMode("code");
    if (hasProject && !directoryEntries[""]) void loadDirectory("");
  }

  function sendWorkspacePrompt() {
    const prompt = chatDraft.trim();
    if (!prompt) return;
    void onSendPrompt(prompt);
    onChatDraftChange("");
  }

  const editorLabel = selectedPath ? `${fileLanguage(selectedPath)} editor for ${selectedPath}` : "Project code editor";
  const recentMessages = useMemo(() => messages.slice(-8), [messages]);

  return (
    <section className={styles.workspace} aria-label={`${projectName} app workspace`}>
      <header className={styles.topbar}>
        <div className={styles.identity}>
          <button type="button" className={styles.iconButton} onClick={closeWorkspace} aria-label="Back to chat" title="Back to chat">
            <X aria-hidden />
          </button>
          <div className={styles.projectMark} aria-hidden><HexIco size={19} /></div>
          <div className={styles.projectCopy}>
            <strong>{projectName}</strong>
            <span>{projectTypeLabel(project?.templateId)}</span>
          </div>
        </div>

        <div className={styles.breadcrumb} aria-label="Project breadcrumb">
          <span>Projects</span><b>/</b><strong>{projectName}</strong>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.segmented} aria-label="Workspace view">
            <button type="button" data-active={mode === "preview" ? "true" : undefined} onClick={() => setMode("preview")}>
              <Eye aria-hidden /> Preview
            </button>
            <button type="button" data-active={mode === "code" ? "true" : undefined} onClick={showCode} disabled={!hasProject} title={hasProject ? "Edit project source" : "This preview is not linked to an editable project"}>
              <Code2 aria-hidden /> Code
            </button>
          </div>
          <button type="button" className={styles.iconButton} onClick={() => setDevice((current) => current === "desktop" ? "mobile" : "desktop")} aria-label={`Use ${device === "desktop" ? "mobile" : "desktop"} preview`} title={`Switch to ${device === "desktop" ? "mobile" : "desktop"} preview`}>
            {device === "desktop" ? <Monitor aria-hidden /> : <Smartphone aria-hidden />}
          </button>
          <button type="button" className={styles.iconButton} onClick={() => setPreviewRefreshKey((key) => key + 1)} aria-label="Refresh preview" title="Refresh preview">
            <RefreshCw aria-hidden />
          </button>
          <button type="button" className={styles.iconButton} onClick={() => window.open(target.url, "_blank", "noopener,noreferrer")} aria-label="Open preview in a new tab" title="Open preview in a new tab">
            <ExternalLink aria-hidden />
          </button>
          <span className={styles.toolbarDivider} aria-hidden />
          <button type="button" className={styles.secondaryButton} onClick={() => void exportProject()} disabled={!hasProject || exportBusy}>
            {exportBusy ? <LoaderCircle className={styles.spin} aria-hidden /> : <Download aria-hidden />} Export
          </button>
          <button type="button" className={styles.deployButton} onClick={() => void deployProject()} disabled={!hasProject || deployBusy} title="Create a temporary public Cloudflare deployment">
            {deployBusy ? <LoaderCircle className={styles.spin} aria-hidden /> : <Rocket aria-hidden />} {deployBusy ? "Deploying…" : "Deploy"}
          </button>
        </div>
      </header>

      <div className={styles.workspaceBody}>
        <aside className={styles.assistantRail} aria-label="AI assistant">
          <div className={styles.assistantHeading}>
            <span><Code2 aria-hidden /> AI Assistant</span>
            <small>{machineLabel}</small>
          </div>
          <div className={styles.assistantMessages}>
            <div className={styles.assistantIntro}>
              <div className={styles.assistantAvatar} aria-hidden><HexIco size={16} /></div>
              <div>
                <strong>{agentName || "Assistant"}</strong>
                <p>Keep building while Preview and Code stay open. Changes saved in Code refresh this project.</p>
              </div>
            </div>
            {recentMessages.map((message) => (
              <article key={message.id} className={styles.assistantMessage} data-role={message.role}>
                <small>{message.role === "user" ? "You" : agentName || "Assistant"}</small>
                <p>{message.text}</p>
              </article>
            ))}
          </div>
          <div className={styles.assistantComposer}>
            <textarea
              value={chatDraft}
              onChange={(event) => onChatDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  sendWorkspacePrompt();
                }
              }}
              placeholder={`Ask ${agentName || "your assistant"} to change this app…`}
              aria-label="Ask the assistant about this project"
            />
            <div>
              <span>{threadTitle}</span>
              <button type="button" onClick={sendWorkspacePrompt} disabled={!chatDraft.trim()} aria-label={chatBusy ? "Queue message" : "Send message"} title={chatBusy ? "Queue message" : "Send message"}>
                <Send aria-hidden />
              </button>
            </div>
          </div>
        </aside>

        <main className={styles.projectStage}>
          {workspaceError ? (
            <div className={styles.notice} role="alert">
              <span>{workspaceError}</span>
              <button type="button" onClick={() => setWorkspaceError("")} aria-label="Dismiss error"><X aria-hidden /></button>
            </div>
          ) : null}
          {deployment ? (
            <div className={styles.deploymentNotice} role="status">
              <div>
                <strong>Deployment is live</strong>
                <span>{deployment.expiresInSeconds ? `Temporary URL · ${Math.round(deployment.expiresInSeconds / 60)} minutes` : "Temporary public URL"}</span>
              </div>
              <a href={deployment.deploymentUrl} target="_blank" rel="noreferrer">Open app <ExternalLink aria-hidden /></a>
              {deployment.claimUrl ? <a href={deployment.claimUrl} target="_blank" rel="noreferrer">Claim <ExternalLink aria-hidden /></a> : null}
              <button type="button" onClick={() => setDeployment(null)} aria-label="Dismiss deployment result"><X aria-hidden /></button>
            </div>
          ) : null}

          {mode === "preview" ? (
            <div className={styles.previewViewport} data-device={device}>
              <div className={styles.browserFrame}>
                <div className={styles.browserBar}>
                  <div className={styles.trafficLights} aria-hidden><i /><i /><i /></div>
                  <div className={styles.address}>{target.url}</div>
                  <div className={styles.liveState}><i /> Live</div>
                </div>
                <div className={styles.browserContent}>
                  <PreviewFrame target={target} refreshKey={previewRefreshKey} workspace />
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.codeWorkspace}>
              <aside className={styles.fileTree} aria-label="Project files">
                <div className={styles.fileTreeHeader}>
                  <span>Files</span>
                  {treeBusy ? <LoaderCircle className={styles.spin} aria-label="Loading files" /> : null}
                </div>
                <div className={styles.fileTreeScroll}>
                  <FileTreeBranch
                    directory=""
                    directoryEntries={directoryEntries}
                    expandedDirectories={expandedDirectories}
                    selectedPath={selectedPath}
                    onToggleDirectory={toggleDirectory}
                    onSelectFile={(path) => void selectFile(path)}
                  />
                </div>
              </aside>
              <section className={styles.editor} aria-label={editorLabel}>
                <header>
                  <div>
                    <strong>{selectedPath || "Select a file"}</strong>
                    {selectedPath ? <span>{fileLanguage(selectedPath)}{dirty ? " · Unsaved changes" : ""}</span> : null}
                  </div>
                  <button type="button" className={styles.secondaryButton} disabled={!dirty || fileBusy} onClick={() => void saveFile()}>
                    {fileBusy ? <LoaderCircle className={styles.spin} aria-hidden /> : <Save aria-hidden />} Save
                  </button>
                </header>
                {selectedPath ? (
                  <textarea
                    className={styles.codeEditor}
                    value={draftContent}
                    onChange={(event) => setDraftContent(event.target.value)}
                    spellCheck={false}
                    aria-label={editorLabel}
                  />
                ) : (
                  <div className={styles.editorEmpty}>{fileBusy ? "Opening file…" : "Choose a source file from the project tree."}</div>
                )}
              </section>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
