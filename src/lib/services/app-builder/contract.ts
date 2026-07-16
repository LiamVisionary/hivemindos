import contractJson from "../../../../contracts/app-builder/v1.json";

export type AppBuilderBackend = "local" | "managed";
export type AppBuilderCapabilityId =
  | "projects.list"
  | "projects.get"
  | "projects.create"
  | "projects.adopt"
  | "files.tree"
  | "files.read"
  | "files.write"
  | "files.rename"
  | "files.delete"
  | "dependencies.install"
  | "runtime.start"
  | "runtime.stop"
  | "runtime.preview"
  | "artifact.prepare"
  | "deploy.temporary"
  | "hosting.catalog"
  | "hosting.list"
  | "hosting.get"
  | "hosting.site.create"
  | "hosting.versions.list"
  | "hosting.version.save"
  | "hosting.deployments.list"
  | "hosting.version.deploy"
  | "hosting.version.rollback"
  | "hosting.access.get"
  | "hosting.access.set"
  | "hosting.access.token"
  | "hosting.bindings.get"
  | "hosting.bindings.set"
  | "hosting.environment.get"
  | "hosting.environment.set"
  | "hosting.usage"
  | "hosting.publish"
  | "hosting.renew"
  | "hosting.unpublish";

type AppBuilderContract = {
  protocol: "hivemindos.app-builder/v1";
  version: string;
  provenance: {
    donors: {
      december: {
        repository: string;
        commit: string;
        archiveSha256: string;
        license: "MIT";
      };
    };
  };
  confirmations: {
    createProject: string;
    installDependencies: string;
    startRuntime: string;
    stopRuntime: string;
    temporaryDeploy: string;
    publishHosting: string;
    createHostingSite: string;
    saveHostingVersion: string;
    deployHostingVersion: string;
    rollbackHosting: string;
    changeHostingAccess: string;
    changeHostingBindings: string;
    changeHostingEnvironment: string;
    renewHosting: string;
    unpublishHosting: string;
    writeFile: string;
    renameFile: string;
    deleteFile: string;
  };
  capabilities: Array<{
    id: AppBuilderCapabilityId;
    sideEffect: "read" | "write" | "destructive";
    backends: AppBuilderBackend[];
  }>;
  artifacts: {
    static: { protocol: string; outputDirectory: string; clientLimits: { files: number; totalBytes: number; fileBytes: number } };
    dynamic: { protocol: string; entrypoint: string; clientLimits: { bytes: number } };
  };
  temporaryDeploy: { provider: string; minimumWranglerVersion: string; claimWindowSeconds: number; publicDomain: string };
  hostingManifest: { path: string; fields: string[]; serverOnly: string[] };
  templates: Record<string, { label: string; files: Record<string, string> }>;
};

export const APP_BUILDER_CONTRACT = contractJson as AppBuilderContract;
export const APP_BUILDER_CONFIRMATIONS = APP_BUILDER_CONTRACT.confirmations;

export function appBuilderCapabilities(backend: AppBuilderBackend) {
  return APP_BUILDER_CONTRACT.capabilities.filter((capability) => capability.backends.includes(backend));
}

export function appBuilderSupports(backend: AppBuilderBackend, capability: AppBuilderCapabilityId) {
  return appBuilderCapabilities(backend).some((candidate) => candidate.id === capability);
}
