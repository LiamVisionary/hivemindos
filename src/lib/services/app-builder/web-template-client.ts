import { APP_BUILDER_CONFIRMATIONS } from "@/lib/services/app-builder/contract";
import {
  requestAppBuilderWithCollectorRecovery,
  type AppBuilderRecoveryMachine,
} from "@/lib/services/app-builder/collector-recovery";
import { webTemplateById, type WebTemplateId } from "@/lib/services/app-builder/web-template-catalog";
import { chatAppProjectDirectory } from "@/lib/services/chat/chat-app-artifact";

type AppBuilderProject = Record<string, unknown>;

type InitializeWebTemplateOptions = {
  templateId: WebTemplateId;
  chatStorageKey: string;
  baseDirectory: string;
  machine: AppBuilderRecoveryMachine & { key?: string };
  fetchImpl?: typeof fetch;
  onRecoveryStatus?: (status: "updating" | "retrying") => void;
};

const MAX_TEMPLATE_FILE_BYTES = 1_000_000;

function stableTemplateSuffix(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function projectFromPayload(payload: Record<string, unknown>) {
  const direct = payload.project;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct as AppBuilderProject;
  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const nested = (data as Record<string, unknown>).project;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as AppBuilderProject
    : undefined;
}

async function loadTemplateFiles(
  template: NonNullable<ReturnType<typeof webTemplateById>>,
  fetchImpl: typeof fetch,
) {
  return Promise.all(template.files.map(async (file) => {
    const response = await fetchImpl(file.source, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${template.name}'s ${file.path}.`);
    const content = await response.text();
    if (new TextEncoder().encode(content).byteLength > MAX_TEMPLATE_FILE_BYTES) {
      throw new Error(`${template.name}'s ${file.path} exceeds the reviewed template size limit.`);
    }
    return { path: file.path, content };
  }));
}

export async function initializeWebTemplateProject({
  templateId,
  chatStorageKey,
  baseDirectory,
  machine,
  fetchImpl = fetch,
  onRecoveryStatus,
}: InitializeWebTemplateOptions) {
  const template = webTemplateById(templateId);
  if (!template) throw new Error("That web template is not available.");
  if (!chatStorageKey.trim()) throw new Error("Start or select a chat before using a template.");
  if (!baseDirectory.trim()) throw new Error("Choose a working directory before using a web template.");

  // Fetch every reviewed source asset before mutating App Builder. If an app
  // bundle is incomplete, selection fails without leaving a partial project.
  const files = await loadTemplateFiles(template, fetchImpl);
  const directory = chatAppProjectDirectory(
    baseDirectory,
    template.name,
    stableTemplateSuffix(`${chatStorageKey}:${template.id}`),
  );
  const request = (body: Record<string, unknown>) => requestAppBuilderWithCollectorRecovery({
    appBuilderBody: body,
    machine,
    fetchImpl,
    onRecoveryStatus,
  });
  const shared = {
    backend: "local",
    directory,
    machineKey: machine.key,
    collectorUrl: machine.collectorUrl,
  } as const;

  const created = await request({
    ...shared,
    action: "create",
    workspaceDirectory: baseDirectory,
    name: template.name,
    templateId: "static",
    confirmation: APP_BUILDER_CONFIRMATIONS.createProject,
  });
  const project = projectFromPayload(created);
  const projectId = typeof project?.id === "string" ? project.id : "";
  if (!project || !projectId) throw new Error("App Builder did not return the template project.");

  for (const file of files) {
    await request({
      ...shared,
      action: "files_write",
      projectId,
      path: file.path,
      content: file.content,
      confirmation: APP_BUILDER_CONFIRMATIONS.writeFile,
    });
  }

  const status = await request({ ...shared, action: "status", projectId });
  return {
    template,
    project: projectFromPayload(status) ?? project,
  };
}
