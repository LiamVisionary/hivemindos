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
  createHostedAppAccessToken,
  createHostedAppSite,
  deployHostedAppVersion,
  getAppHostingCatalog,
  getHostedAppAccess,
  getHostedAppBindings,
  getHostedAppEnvironment,
  getHostedAppUsage,
  getHostedApp,
  listHostedAppDeployments,
  listHostedAppVersions,
  listHostedApps,
  publishHostedApp,
  renewHostedApp,
  rollbackHostedAppVersion,
  saveHostedAppVersion,
  setHostedAppAccess,
  setHostedAppBindings,
  setHostedAppEnvironment,
  unpublishHostedApp,
  type HostedAppBindings,
  type HostedAppDeployment,
  type HostedAppSite,
  type HostedAppVersion,
  type SiteAccessMode,
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
import {
  APP_BUILDER_COLLECTOR_UPDATE_REQUIRED,
  collectorSupportsAppBuilderContract,
} from "@/lib/services/app-builder/collector-recovery";
import { readLocalAppSourceCommit, readLocalHostingManifest, runLocalAppBuilderAction, writeLocalHostingManifest, type LocalAppProject } from "../../../../scripts/lib/app-builder.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AppBuilderBody = Record<string, unknown> & {
  action?: string;
  backend?: AppBuilderBackend;
  projectId?: string;
  directory?: string;
  name?: string;
  templateId?: string;
  workspaceDirectory?: string;
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
  releaseId?: string;
  sourceCommitSha?: string;
  accessMode?: SiteAccessMode;
  bindings?: HostedAppBindings;
  environmentValues?: Record<string, string>;
  unsetEnvironment?: string[];
  accessPurpose?: "preview" | "workspace";
  ttlSeconds?: number;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

class RemoteAppBuilderUpdateRequiredError extends Error {
  constructor(readonly reportedVersion?: string) {
    super("The linked machine needs a compatible App Builder before Preview can continue.");
    this.name = "RemoteAppBuilderUpdateRequiredError";
  }
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
      templateId: project.templateId,
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
  const healthResponse = await fetch(`${base}/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (healthResponse?.ok) {
    const health = await healthResponse.json().catch(() => null) as {
      capabilities?: { appBuilderContractVersion?: string };
    } | null;
    const reportedVersion = clean(health?.capabilities?.appBuilderContractVersion);
    if (!collectorSupportsAppBuilderContract(reportedVersion, APP_BUILDER_CONTRACT.version)) {
      throw new RemoteAppBuilderUpdateRequiredError(reportedVersion || undefined);
    }
  }
  const response = await fetch(`${base}/app-builder`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(600_000),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || payload?.ok === false) {
    const upstreamMessage = clean(payload?.error);
    if (clean(body.action) === "adopt" && upstreamMessage === "Unsupported local app-builder action.") {
      throw new Error("This linked machine is running an older HivemindOS collector that does not support Chat-bound Preview. Update HivemindOS on that machine, then press Preview again.");
    }
    throw new Error(upstreamMessage || `Fleet app-builder returned HTTP ${response.status}.`);
  }
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

async function registerHostedSite(body: AppBuilderBody, site: HostedAppSite, version?: HostedAppVersion, deployment?: HostedAppDeployment) {
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
      hostingVersionId: version?.id || project.appBuilder.hostingVersionId,
      hostingDeploymentId: deployment?.id || project.appBuilder.hostingDeploymentId,
      hostingAccessMode: site.accessMode,
    },
  });
}

async function persistLocalHostingManifest(body: AppBuilderBody, siteId: string, bindings: HostedAppBindings = { d1: [], r2: [] }) {
  if (body.backend === "managed") return;
  const collectorUrl = clean(body.collectorUrl);
  if (collectorUrl && !isLocalCollectorUrl(collectorUrl)) return;
  const directory = await localProjectDirectory(body);
  if (!directory) return;
  await writeLocalHostingManifest(directory, { projectId: siteId, bindings });
}

async function resolveHostingSiteId(body: AppBuilderBody) {
  const explicit = clean(body.siteId);
  if (explicit) return explicit;
  const projectId = clean(body.projectId);
  const registry = await readProjectRegistry();
  const registered = registry.projects.find((project) => (
    project.id === projectId
    || project.appBuilder?.localProjectId === projectId
    || project.appBuilder?.managedProjectId === projectId
  ))?.appBuilder?.hostingSiteId;
  if (registered) return registered;
  if (body.backend === "managed") return "";
  const collectorUrl = clean(body.collectorUrl);
  if (collectorUrl && !isLocalCollectorUrl(collectorUrl)) return "";
  const directory = await localProjectDirectory(body);
  if (!directory) return "";
  return (await readLocalHostingManifest(directory))?.project_id || "";
}

async function resolveHostingSourceCommit(body: AppBuilderBody) {
  const explicit = clean(body.sourceCommitSha);
  if (explicit) return explicit;
  if (body.backend === "managed") return undefined;
  const collectorUrl = clean(body.collectorUrl);
  if (collectorUrl && !isLocalCollectorUrl(collectorUrl)) return undefined;
  const directory = await localProjectDirectory(body);
  return directory ? await readLocalAppSourceCommit(directory) || undefined : undefined;
}

async function runHosting(body: AppBuilderBody) {
  const action = clean(body.action);
  const projectId = clean(body.projectId);
  const legacyAccountIds = projectId ? [projectId] : [];
  if (action === "hosting_catalog") return { plans: await getAppHostingCatalog() };
  if (action === "hosting_list") return { sites: await listHostedApps(legacyAccountIds) };
  if (action === "hosting_get") {
    const siteId = await resolveHostingSiteId(body);
    if (!siteId) throw new Error("siteId is required.");
    return { site: await getHostedApp(siteId, legacyAccountIds) };
  }
  if (action === "hosting_create") {
    if (body.confirmation !== APP_BUILDER_CONFIRMATIONS.createHostingSite) {
      throw new Error(`This app-builder operation requires ${APP_BUILDER_CONFIRMATIONS.createHostingSite}.`);
    }
    if (!projectId) throw new Error("projectId is required.");
    const name = clean(body.name);
    const slug = clean(body.slug);
    const planId = clean(body.planId);
    if (!name || !slug || !planId) throw new Error("name, slug, and planId are required.");
    const site = await createHostedAppSite({ name, slug, planId, accessMode: body.accessMode, legacyAccountIds });
    await registerHostedSite(body, site);
    await persistLocalHostingManifest(body, site.id);
    return { site };
  }
  if (action === "hosting_versions") {
    const siteId = await resolveHostingSiteId(body);
    if (!siteId) throw new Error("siteId is required.");
    return { versions: await listHostedAppVersions(siteId, legacyAccountIds) };
  }
  if (action === "hosting_save_version") {
    if (body.confirmation !== APP_BUILDER_CONFIRMATIONS.saveHostingVersion) {
      throw new Error(`This app-builder operation requires ${APP_BUILDER_CONFIRMATIONS.saveHostingVersion}.`);
    }
    if (!projectId) throw new Error("projectId is required.");
    const siteId = await resolveHostingSiteId(body);
    const slug = clean(body.slug);
    const planId = clean(body.planId);
    const idempotencyKey = clean(body.idempotencyKey);
    if (!siteId || !slug || !planId || !idempotencyKey) throw new Error("siteId, slug, planId, and idempotencyKey are required.");
    const plan = (await getAppHostingCatalog()).find((candidate) => candidate.id === planId);
    if (!plan) throw new Error("Unsupported app-hosting plan.");
    if (body.backend === "managed" && plan.runtime === "dynamic") throw new Error("Dynamic Worker artifacts currently save from a local or linked-machine project.");
    const artifact = body.backend === "managed"
      ? await prepareManagedCloudAppArtifact(clean(body.managedAgentId), projectId)
      : (await runLocal({ ...body, action: "artifact_prepare", runtime: plan.runtime }) as { artifact?: Record<string, unknown> }).artifact;
    if (!artifact) throw new Error("The app-builder did not produce a hosting artifact.");
    const result = await saveHostedAppVersion({
      siteId,
      slug,
      planId,
      artifact,
      idempotencyKey,
      sourceCommitSha: await resolveHostingSourceCommit(body),
      bindings: body.bindings,
      legacyAccountIds,
    });
    await registerHostedSite(body, result.site, result.version);
    await persistLocalHostingManifest(body, result.site.id, body.bindings || { d1: [], r2: [] });
    return result;
  }
  if (action === "hosting_deployments") {
    const siteId = await resolveHostingSiteId(body);
    if (!siteId) throw new Error("siteId is required.");
    return { deployments: await listHostedAppDeployments(siteId, legacyAccountIds) };
  }
  if (action === "hosting_deploy_version" || action === "hosting_rollback") {
    const requiredConfirmation = action === "hosting_rollback"
      ? APP_BUILDER_CONFIRMATIONS.rollbackHosting
      : APP_BUILDER_CONFIRMATIONS.deployHostingVersion;
    if (body.confirmation !== requiredConfirmation) throw new Error(`This app-builder operation requires ${requiredConfirmation}.`);
    const siteId = await resolveHostingSiteId(body);
    const releaseId = clean(body.releaseId);
    const idempotencyKey = clean(body.idempotencyKey);
    if (!siteId || !releaseId || !idempotencyKey) throw new Error("siteId, releaseId, and idempotencyKey are required.");
    const input = { siteId, releaseId, planId: clean(body.planId) || undefined, autoRenew: body.autoRenew, accessMode: body.accessMode, idempotencyKey, legacyAccountIds };
    const result = action === "hosting_rollback" ? await rollbackHostedAppVersion(input) : await deployHostedAppVersion(input);
    await registerHostedSite(body, result.site, undefined, result.deployment);
    return result;
  }
  if (action === "hosting_access_get") {
    const siteId = await resolveHostingSiteId(body);
    if (!siteId) throw new Error("siteId is required.");
    return { access: await getHostedAppAccess(siteId, legacyAccountIds) };
  }
  if (action === "hosting_access_set") {
    if (body.confirmation !== APP_BUILDER_CONFIRMATIONS.changeHostingAccess) throw new Error(`This app-builder operation requires ${APP_BUILDER_CONFIRMATIONS.changeHostingAccess}.`);
    const siteId = await resolveHostingSiteId(body);
    if (!siteId || !body.accessMode) throw new Error("siteId and accessMode are required.");
    return { access: await setHostedAppAccess({ siteId, mode: body.accessMode, legacyAccountIds }) };
  }
  if (action === "hosting_access_token") {
    if (body.confirmation !== APP_BUILDER_CONFIRMATIONS.changeHostingAccess) throw new Error(`This app-builder operation requires ${APP_BUILDER_CONFIRMATIONS.changeHostingAccess}.`);
    const siteId = await resolveHostingSiteId(body);
    if (!siteId) throw new Error("siteId is required.");
    return { access: await createHostedAppAccessToken({ siteId, purpose: body.accessPurpose, ttlSeconds: body.ttlSeconds, legacyAccountIds }) };
  }
  if (action === "hosting_bindings_get") {
    const siteId = await resolveHostingSiteId(body);
    if (!siteId) throw new Error("siteId is required.");
    return { bindings: await getHostedAppBindings(siteId, legacyAccountIds) };
  }
  if (action === "hosting_bindings_set") {
    if (body.confirmation !== APP_BUILDER_CONFIRMATIONS.changeHostingBindings) throw new Error(`This app-builder operation requires ${APP_BUILDER_CONFIRMATIONS.changeHostingBindings}.`);
    const siteId = await resolveHostingSiteId(body);
    if (!siteId || !body.bindings) throw new Error("siteId and bindings are required.");
    const bindings = await setHostedAppBindings({ siteId, bindings: body.bindings, legacyAccountIds });
    await persistLocalHostingManifest(body, siteId, bindings);
    return { bindings };
  }
  if (action === "hosting_environment_get") {
    const siteId = await resolveHostingSiteId(body);
    if (!siteId) throw new Error("siteId is required.");
    return { environment: await getHostedAppEnvironment(siteId, legacyAccountIds) };
  }
  if (action === "hosting_environment_set") {
    if (body.confirmation !== APP_BUILDER_CONFIRMATIONS.changeHostingEnvironment) throw new Error(`This app-builder operation requires ${APP_BUILDER_CONFIRMATIONS.changeHostingEnvironment}.`);
    const siteId = await resolveHostingSiteId(body);
    if (!siteId) throw new Error("siteId is required.");
    return { environment: await setHostedAppEnvironment({ siteId, values: body.environmentValues, unset: body.unsetEnvironment, legacyAccountIds }) };
  }
  if (action === "hosting_usage") {
    const siteId = await resolveHostingSiteId(body);
    if (!siteId) throw new Error("siteId is required.");
    return { usage: await getHostedAppUsage(siteId, legacyAccountIds) };
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
      siteId: await resolveHostingSiteId(body) || undefined,
      autoRenew: body.autoRenew === true,
      accessMode: body.accessMode,
      bindings: body.bindings,
      sourceCommitSha: await resolveHostingSourceCommit(body),
      legacyAccountIds,
    });
    await registerHostedSite(body, site);
    await persistLocalHostingManifest(body, site.id, body.bindings || { d1: [], r2: [] });
    return { site };
  }
  if (action === "hosting_renew") {
    if (body.confirmation !== APP_BUILDER_CONFIRMATIONS.renewHosting) {
      throw new Error(`This app-builder operation requires ${APP_BUILDER_CONFIRMATIONS.renewHosting}.`);
    }
    const siteId = await resolveHostingSiteId(body);
    const idempotencyKey = clean(body.idempotencyKey);
    if (!siteId || !idempotencyKey) throw new Error("siteId and idempotencyKey are required.");
    return { site: await renewHostedApp({ siteId, idempotencyKey, legacyAccountIds }) };
  }
  if (action === "hosting_unpublish") {
    if (body.confirmation !== APP_BUILDER_CONFIRMATIONS.unpublishHosting) {
      throw new Error(`This app-builder operation requires ${APP_BUILDER_CONFIRMATIONS.unpublishHosting}.`);
    }
    const siteId = await resolveHostingSiteId(body);
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
    if (error instanceof RemoteAppBuilderUpdateRequiredError) {
      return errorJson(error.message, 409, {
        code: APP_BUILDER_COLLECTOR_UPDATE_REQUIRED,
        requiredContractVersion: APP_BUILDER_CONTRACT.version,
        reportedContractVersion: error.reportedVersion,
      });
    }
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
