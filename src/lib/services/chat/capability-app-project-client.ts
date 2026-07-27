import { APP_BUILDER_CONFIRMATIONS } from "@/lib/services/app-builder/contract";
import { requestAppBuilderWithCollectorRecovery } from "@/lib/services/app-builder/collector-recovery";
import {
  chatAppArtifactFromProject,
  chatAppProjectDirectory,
  chatAppProjectName,
  chatAppTemplateForTask,
  type ChatAppArtifact,
} from "@/lib/services/chat/chat-app-artifact";
import { selectedCapability, type CapabilityApprovalPlan } from "@/lib/types/capability-approval";

type AppBuilderProject = Parameters<typeof chatAppArtifactFromProject>[0];

type AppBuilderCreateBody = {
  action: "create";
  backend: "local";
  directory: string;
  workspaceDirectory: string;
  name: string;
  templateId: "nextjs" | "static";
  machineKey?: string;
  collectorUrl?: string;
  confirmation: string;
};

type AppBuilderCreateResponse = {
  ok?: boolean;
  error?: string;
  project?: AppBuilderProject;
  data?: { project?: AppBuilderProject };
};

type PrepareCapabilityAppProjectMachine = {
  key?: string;
  name?: string;
  collectorUrl?: string;
  dnsName?: string;
  ip?: string;
  appDir?: string;
  updateCommand?: string;
};

type PrepareCapabilityAppProjectOptions = {
  plan: CapabilityApprovalPlan;
  baseDirectory: string;
  machine: PrepareCapabilityAppProjectMachine;
  request?: (body: AppBuilderCreateBody) => Promise<AppBuilderCreateResponse>;
  onRecoveryStatus?: (status: "updating" | "retrying") => void;
};

function planUsesAppBuilder(plan: CapabilityApprovalPlan) {
  return plan.items.some((item) => {
    if (item.decision === "remove" || item.decision === "reject") return false;
    const candidate = selectedCapability(item);
    return candidate?.id === "hive-action:apps.build" || candidate?.locator === "/api/app-builder";
  });
}

async function requestAppBuilderProject(body: AppBuilderCreateBody): Promise<AppBuilderCreateResponse> {
  const response = await fetch("/api/app-builder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as AppBuilderCreateResponse | null;
  if (!response.ok || !data?.ok) throw new Error(data?.error || "App Builder request failed.");
  return data;
}

/** Remote machines go through collector recovery so a collector that is behind
 * the app-builder contract self-updates instead of failing the automatic
 * capability path (which previously surfaced as a pointless approval card). */
function recoveringRequester(
  machine: PrepareCapabilityAppProjectMachine,
  onRecoveryStatus?: (status: "updating" | "retrying") => void,
) {
  return async (body: AppBuilderCreateBody): Promise<AppBuilderCreateResponse> => {
    if (!body.collectorUrl) return requestAppBuilderProject(body);
    return await requestAppBuilderWithCollectorRecovery({
      appBuilderBody: body,
      machine: {
        collectorUrl: machine.collectorUrl,
        dnsName: machine.dnsName,
        name: machine.name,
        ip: machine.ip,
        appDir: machine.appDir,
        updateCommand: machine.updateCommand,
      },
      onRecoveryStatus,
    }) as AppBuilderCreateResponse;
  };
}

export async function prepareCapabilityAppProject({
  plan,
  baseDirectory,
  machine,
  request,
  onRecoveryStatus,
}: PrepareCapabilityAppProjectOptions) {
  const send = request ?? recoveringRequester(machine, onRecoveryStatus);
  if (!planUsesAppBuilder(plan)) return undefined;
  const directory = chatAppProjectDirectory(baseDirectory, plan.task, plan.id);
  const response = await send({
    action: "create",
    backend: "local",
    directory,
    workspaceDirectory: baseDirectory,
    name: chatAppProjectName(plan.task),
    templateId: chatAppTemplateForTask(plan.task),
    machineKey: machine.key,
    collectorUrl: machine.collectorUrl,
    confirmation: APP_BUILDER_CONFIRMATIONS.createProject,
  });
  if (!response.ok) throw new Error(response.error || "App Builder request failed.");
  const project = response.project ?? response.data?.project;
  if (!project) throw new Error("App Builder did not return the created project.");
  return {
    project,
    artifact: chatAppArtifactFromProject(project, machine),
  };
}

export function capabilityAppProjectContext(appArtifact?: ChatAppArtifact) {
  if (!appArtifact) return "";
  const lines = [
    "",
    "Assigned App Builder project:",
    `- Project id: ${appArtifact.projectId}`,
    `- Directory: ${appArtifact.directory}`,
    `- Template: ${appArtifact.templateId}`,
    'Use invoke_hive_capability with surface="hive_action", operation="invoke", capabilityId="apps.build", method="POST", and put every App Builder request field inside arguments.',
    "Implement the app in that exact directory. Do not create a second project or use an untracked background preview server. Chat Preview owns installation and the durable runtime after the build finishes.",
  ];
  if (appArtifact.templateId === "static") {
    lines.push(
      "This static template already contains index.html, styles.css, and script.js at the project root.",
      `Edit those root files with action="files_write", backend="local", projectId="${appArtifact.projectId}", path, content, and confirmation="${APP_BUILDER_CONFIRMATIONS.writeFile}" inside arguments. The capability and route permission gates still apply. Do not create a static/ directory. Do not run pnpm or npm; static projects have no package build step.`,
    );
  }
  return lines.join("\n");
}
