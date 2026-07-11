import type { NextRequest } from "next/server";

import { APP_BUILDER_CONFIRMATIONS, APP_BUILDER_CONTRACT, appBuilderCapabilities, type AppBuilderBackend } from "@/lib/services/app-builder/contract";
import {
  createManagedCloudAppProject,
  getManagedCloudAppProject,
  listManagedCloudAppProjects,
  ManagedCloudApiError,
  prepareManagedCloudAppArtifact,
} from "@/lib/services/managed-cloud-agents";
import {
  getAppHostingCatalog,
  getHostedApp,
  listHostedApps,
  publishHostedApp,
  renewHostedApp,
  unpublishHostedApp,
  type HostedAppSite,
} from "@/lib/services/app-hosting";
import { readProjectRegistry, upsertProject } from "@/lib/services/projects/project-registry";
import {
  isFleetCollectorUrl,
  isLocalCollectorUrl,
  normalizeCollectorUrl,
  remoteCollectorLocalServiceUrl,
} from "@/lib/services/local-collector-url";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";
import { runLocalAppBuilderAction, type LocalAppProject } from "../../../../scripts/lib/app-builder.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AppBuilderBody = Record<string, unknown> & {
  action?: string;
  backend?: AppBuilderBackend;
  projectId?: string;
  directory?: string;
  name?: string;
  templateId?: string;
  confirmation?: string;
  machineKey?: string;
  collectorUrl?: string;
  managedAgentId?: string;
  idempotencyKey?: string;
  siteId?: string;
  slug?: string;
  planId?: string;
  autoRenew?: boolean;
  runtime?: "static" | "dynamic";
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function publicLocalProject(project: LocalAppProject, collectorUrl?: string) {
  const previewUrl = project.previewUrl && collectorUrl && !isLocalCollectorUrl(collectorUrl)
    ? remoteCollectorLocalServiceUrl({ telemetryUrl: collectorUrl }, project.previewUrl)
    : project.previewUrl;
  return { ...project, previewUrl };
}

async function localProjectDirectory(body: AppBuilderBody) {
  const direct = clean(body.directory);
  if (direct) return direct;
  const projectId = clean(body.projectId);
  if (!projectId) return "";
  const registry = await readProjectRegistry();
  return registry.projects.find((project) => project.id === projectId)?.localPath || "";
}

async function registerLocalProject(project: LocalAppProject, body: AppBuilderBody) {
  return upsertProject({
    id: project.id,
    name: project.name,
    localPath: project.directory,
    preferredMachineKey: clean(body.machineKey) || undefined,
    appBuilder: {
      backend: "local",
      contractVersion: project.contractVersion,
      templateId: "nextjs",
      status: project.status,
      localProjectId: project.id,
    },
  });
}

async function registerManagedProject(project: Awaited<ReturnType<typeof createManagedCloudAppProject>>) {
  return upsertProject({
    id: `managed_${project.id}`,
    name: project.name,
    appBuilder: {
      backend: "managed",
      contractVersion: APP_BUILDER_CONTRACT.version,
      templateId: "nextjs",
      status: project.status,
      managedAgentId: project.managedAgentId,
      managedProjectId: project.id,
    },
  });
}

async function remoteLocalAction(collectorUrl: string, body: AppBuilderBody) {
  const base = normalizeCollectorUrl(collectorUrl);
  if (!isFleetCollectorUrl(base)) throw new Error("Refusing to send an app-builder operation outside the fleet collector set.");
  const response = await fetch(`${base}/app-builder`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(600_000),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || payload?.ok === false) throw new Error(clean(payload?.error) || `Fleet app-builder returned HTTP ${response.status}.`);
  return payload || {};
}

async function runLocal(body: AppBuilderBody) {
  const action = clean(body.action);
  if (action === "list") {
    const registry = await readProjectRegistry();
    const machineKey = clean(body.machineKey);
    return {
      projects: registry.projects.filter((project) => (
        project.appBuilder?.backend === "local"
        && (!machineKey || project.preferredMachineKey === machineKey)
      )),
    };
  }
  const directory = await localProjectDirectory(body);
  const input = { ...body, directory };
  const collectorUrl = clean(body.collectorUrl);
  const result = collectorUrl && !isLocalCollectorUrl(collectorUrl)
    ? await remoteLocalAction(collectorUrl, input)
    : await runLocalAppBuilderAction(input);
  const project = result.project as LocalAppProject | undefined;
  if (project) await registerLocalProject(project, body);
  return { ...result, ...(project ? { project: publicLocalProject(project, collectorUrl) } : {}) };
}

async function runManaged(body: AppBuilderBody) {
  const managedAgentId = clean(body.managedAgentId);
  if (!managedAgentId) throw new Error("managedAgentId is required for the managed app-builder backend.");
  const action = clean(body.action);
  if (action === "list") return { projects: await listManagedCloudAppProjects(managedAgentId) };
  if (action === "get" || action === "status") {
    const projectId = clean(body.projectId);
    if (!projectId) throw new Error("projectId is required.");
    return { project: await getManagedCloudAppProject(managedAgentId, projectId) };
  }
  if (action === "create") {
    if (body.confirmation !== APP_BUILDER_CONFIRMATIONS.createProject) {
      throw new Error(`This app-builder operation requires ${APP_BUILDER_CONFIRMATIONS.createProject}.`);
    }
    const name = clean(body.name);
    if (!name) throw new Error("App project name is required.");
    const project = await createManagedCloudAppProject({
      instanceId: managedAgentId,
      name,
      templateId: "nextjs",
      idempotencyKey: clean(body.idempotencyKey) || undefined,
    });
    await registerManagedProject(project);
    return { project };
  }
  throw new Error(`The managed backend does not support ${action || "this operation"} yet.`);
}

async function registerHostedSite(body: AppBuilderBody, site: HostedAppSite) {
  const registry = await readProjectRegistry();
  const projectId = clean(body.projectId);
  const project = registry.projects.find((candidate) => (
    candidate.id === projectId
    || candidate.appBuilder?.localProjectId === projectId
    || candidate.appBuilder?.managedProjectId === projectId
  ));
  if (!project?.appBuilder) return;
  await upsertProject({
    ...project,
    appBuilder: {
      ...project.appBuilder,
      hostingSiteId: site.id,
      hostingUrl: site.url,
    },
  });
}

async function runHosting(body: AppBuilderBody) {
  const action = clean(body.action);
  const projectId = clean(body.projectId);
  const legacyAccountIds = projectId ? [projectId] : [];
  if (action === "hosting_catalog") return { plans: await getAppHostingCatalog() };
  if (action === "hosting_list") return { sites: await listHostedApps(legacyAccountIds) };
  if (action === "hosting_get") {
    const siteId = clean(body.siteId);
    if (!siteId) throw new Error("siteId is required.");
    return { site: await getHostedApp(siteId, legacyAccountIds) };
  }
  if (action === "hosting_publish") {
    if (body.confirmation !== APP_BUILDER_CONFIRMATIONS.publishHosting) {
      throw new Error(`This app-builder operation requires ${APP_BUILDER_CONFIRMATIONS.publishHosting}.`);
    }
    if (!projectId) throw new Error("projectId is required.");
    const slug = clean(body.slug);
    const planId = clean(body.planId);
    const idempotencyKey = clean(body.idempotencyKey);
    if (!slug || !planId || !idempotencyKey) throw new Error("slug, planId, and idempotencyKey are required.");
    const plan = (await getAppHostingCatalog()).find((candidate) => candidate.id === planId);
    if (!plan) throw new Error("Unsupported app-hosting plan.");
    if (body.backend === "managed" && plan.runtime === "dynamic") {
      throw new Error("Dynamic Worker artifacts currently publish from a local or linked-machine project.");
    }
    const artifact = body.backend === "managed"
      ? await prepareManagedCloudAppArtifact(clean(body.managedAgentId), projectId)
      : (await runLocal({ ...body, action: "artifact_prepare", runtime: plan.runtime }) as { artifact?: Record<string, unknown> }).artifact;
    if (!artifact) throw new Error("The app-builder did not produce a hosting artifact.");
    const site = await publishHostedApp({
      artifact,
      slug,
      planId,
      idempotencyKey,
      siteId: clean(body.siteId) || undefined,
      autoRenew: body.autoRenew === true,
      legacyAccountIds,
    });
    await registerHostedSite(body, site);
    return { site };
  }
  if (action === "hosting_renew") {
    if (body.confirmation !== APP_BUILDER_CONFIRMATIONS.renewHosting) {
      throw new Error(`This app-builder operation requires ${APP_BUILDER_CONFIRMATIONS.renewHosting}.`);
    }
    const siteId = clean(body.siteId);
    const idempotencyKey = clean(body.idempotencyKey);
    if (!siteId || !idempotencyKey) throw new Error("siteId and idempotencyKey are required.");
    return { site: await renewHostedApp({ siteId, idempotencyKey, legacyAccountIds }) };
  }
  if (action === "hosting_unpublish") {
    if (body.confirmation !== APP_BUILDER_CONFIRMATIONS.unpublishHosting) {
      throw new Error(`This app-builder operation requires ${APP_BUILDER_CONFIRMATIONS.unpublishHosting}.`);
    }
    const siteId = clean(body.siteId);
    if (!siteId) throw new Error("siteId is required.");
    return { site: await unpublishHostedApp({ siteId, legacyAccountIds }) };
  }
  throw new Error("Unsupported app-hosting action.");
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const registry = await readProjectRegistry();
  return okJson({
    contract: APP_BUILDER_CONTRACT,
    backends: {
      local: appBuilderCapabilities("local"),
      managed: appBuilderCapabilities("managed"),
    },
    projects: registry.projects.filter((project) => Boolean(project.appBuilder)),
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as AppBuilderBody | null;
  if (!body || !clean(body.action)) return errorJson("An app-builder action is required.", 400);
  try {
    const result = clean(body.action).startsWith("hosting_")
      ? await runHosting(body)
      : body.backend === "managed" ? await runManaged(body) : await runLocal(body);
    return okJson(result);
  } catch (error) {
    if (error instanceof ManagedCloudApiError) return errorJson(error.message, error.status, { code: error.code, ...error.details });
    const message = error instanceof Error ? error.message : "App-builder operation failed.";
    if (/requires CONFIRM_APP_/.test(message)) return errorJson(message, 409, { code: "confirmation_required" });
    if (/requires CONFIRM_CLOUDFLARE_/.test(message)) return errorJson(message, 409, { code: "confirmation_required" });
    if (/Fleet app-builder returned|outside the fleet/.test(message)) return upstreamErrorJson("Remote app-builder failed", error);
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
    if (Number.isInteger(status) && status >= 400 && status <= 599) return errorJson(message, status);
    return errorJson(message, 400);
  }
}
