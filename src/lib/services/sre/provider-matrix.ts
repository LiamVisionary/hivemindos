import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "@/lib/home-dir";
import { booleanEnv, numberEnv, optionalEnv } from "@/lib/config/env";
import type { SreProviderId, SreProviderStatus } from "./types";

export const OPENSRE_PINNED_COMMIT = "d3a770c365644bb369b9490588333b0e0309c11c";
export const OPENSRE_DEFAULT_BASE_URL = "http://127.0.0.1:8111";

type OpenSreInstallManifest = {
  commit?: string;
  installedAt?: string;
};

export const SRE_PROVIDER_MATRIX: Record<SreProviderId, Omit<SreProviderStatus, "enabled" | "ready" | "reason">> = {
  opensre: {
    id: "opensre",
    name: "OpenSRE",
    mode: "structured-rca",
    pinnedCommit: OPENSRE_PINNED_COMMIT,
    capabilities: {
      structuredDiagnosis: true,
      evidenceCollection: true,
      recommendations: true,
      autonomousRemediation: false,
    },
  },
  native: {
    id: "native",
    name: "HivemindOS incident capture",
    mode: "capture-only",
    capabilities: {
      structuredDiagnosis: false,
      evidenceCollection: false,
      recommendations: false,
      autonomousRemediation: false,
    },
  },
};

function installManifestPath() {
  return join(homedir(), ".hivemindos", "opensre", "install.json");
}

function gatewayTokenPath() {
  return join(homedir(), ".hivemindos", "opensre", "gateway-token");
}

function readGatewayToken() {
  try {
    return readFileSync(gatewayTokenPath(), "utf8").trim();
  } catch {
    return "";
  }
}

export function readOpenSreInstallManifest(): OpenSreInstallManifest | null {
  try {
    const value = JSON.parse(readFileSync(installManifestPath(), "utf8")) as OpenSreInstallManifest;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function loopbackBaseUrl(raw: string) {
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:") throw new Error("OpenSRE sidecar URL must use http on loopback.");
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) {
    throw new Error("OpenSRE sidecar URL must resolve to loopback; remote RCA endpoints are not accepted.");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function getOpenSreConfig() {
  const manifest = readOpenSreInstallManifest();
  const enabledSetting = optionalEnv("HIVEMINDOS_OPENSRE_ENABLED");
  const enabled = enabledSetting
    ? booleanEnv("HIVEMINDOS_OPENSRE_ENABLED")
    : Boolean(manifest);
  let baseUrl = OPENSRE_DEFAULT_BASE_URL;
  let configError = "";
  try {
    baseUrl = loopbackBaseUrl(optionalEnv("HIVEMINDOS_OPENSRE_BASE_URL") || OPENSRE_DEFAULT_BASE_URL);
  } catch (error) {
    configError = error instanceof Error ? error.message : "Invalid OpenSRE sidecar URL.";
  }
  return {
    enabled,
    baseUrl,
    configError,
    installedCommit: manifest?.commit,
    pinMatches: !manifest?.commit || manifest.commit === OPENSRE_PINNED_COMMIT,
    healthTimeoutMs: Math.max(250, Math.min(numberEnv("HIVEMINDOS_OPENSRE_HEALTH_TIMEOUT_MS", 2_500), 10_000)),
    investigationTimeoutMs: Math.max(10_000, Math.min(numberEnv("HIVEMINDOS_OPENSRE_INVESTIGATION_TIMEOUT_MS", 600_000), 900_000)),
    gatewayToken: readGatewayToken(),
  };
}
