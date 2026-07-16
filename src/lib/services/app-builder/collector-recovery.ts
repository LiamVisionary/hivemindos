import { APP_BUILDER_CONTRACT } from "@/lib/services/app-builder/contract";

export const APP_BUILDER_COLLECTOR_UPDATE_REQUIRED = "app_builder_collector_update_required";

type AppBuilderPayload = Record<string, unknown> & {
  ok?: boolean;
  code?: string;
  error?: string;
  verified?: boolean;
};

export type AppBuilderRecoveryMachine = {
  collectorUrl?: string;
  dnsName?: string;
  name?: string;
  ip?: string;
  appDir?: string;
  updateCommand?: string;
};

type RecoveryStatus = "updating" | "retrying";

type AppBuilderRecoveryRequest = {
  appBuilderBody: Record<string, unknown>;
  machine: AppBuilderRecoveryMachine;
  fetchImpl?: typeof fetch;
  onRecoveryStatus?: (status: RecoveryStatus) => void;
};

function numericVersion(version: string | undefined) {
  const match = version?.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
}

export function collectorSupportsAppBuilderContract(
  collectorVersion: string | undefined,
  requiredVersion = APP_BUILDER_CONTRACT.version,
) {
  const collector = numericVersion(collectorVersion);
  const required = numericVersion(requiredVersion);
  if (!collector || !required) return false;
  for (let index = 0; index < required.length; index += 1) {
    if (collector[index] > required[index]) return true;
    if (collector[index] < required[index]) return false;
  }
  return true;
}

async function responsePayload(response: Response | undefined): Promise<AppBuilderPayload> {
  if (!response) return { ok: false, error: "The request did not reach HivemindOS." };
  return response.json().catch(() => ({
    ok: false,
    error: `HivemindOS returned HTTP ${response.status}.`,
  })) as Promise<AppBuilderPayload>;
}

function payloadError(payload: AppBuilderPayload, fallback: string) {
  return new Error(typeof payload.error === "string" && payload.error.trim() ? payload.error : fallback);
}

async function appBuilderRequest(
  fetchImpl: typeof fetch,
  body: Record<string, unknown>,
) {
  const response = await fetchImpl("/api/app-builder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
  return { response, payload: await responsePayload(response) };
}

export async function requestAppBuilderWithCollectorRecovery({
  appBuilderBody,
  machine,
  fetchImpl = fetch,
  onRecoveryStatus,
}: AppBuilderRecoveryRequest): Promise<AppBuilderPayload> {
  const first = await appBuilderRequest(fetchImpl, appBuilderBody);
  if (first.response?.ok && first.payload.ok) return first.payload;
  if (first.payload.code !== APP_BUILDER_COLLECTOR_UPDATE_REQUIRED) {
    throw payloadError(first.payload, "App Builder request failed.");
  }

  const collectorUrl = machine.collectorUrl?.trim();
  if (!collectorUrl) {
    throw new Error("Preview cannot update this machine because the linked collector URL is unavailable.");
  }

  onRecoveryStatus?.("updating");
  const updateResponse = await fetchImpl("/api/fleet/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      collectorUrl,
      dnsName: machine.dnsName,
      name: machine.name,
      ip: machine.ip,
      appDir: machine.appDir,
      updateCommand: machine.updateCommand,
      source: "chat-preview",
      requiredCapabilities: {
        appBuilderContractVersion: APP_BUILDER_CONTRACT.version,
      },
    }),
  }).catch(() => undefined);
  const updatePayload = await responsePayload(updateResponse);
  if (!updateResponse?.ok || !updatePayload.ok || updatePayload.verified !== true) {
    throw payloadError(
      updatePayload,
      "Preview could not finish updating the linked machine's App Builder.",
    );
  }

  onRecoveryStatus?.("retrying");
  const retry = await appBuilderRequest(fetchImpl, appBuilderBody);
  if (!retry.response?.ok || !retry.payload.ok) {
    throw payloadError(retry.payload, "App Builder did not recover after the collector update.");
  }
  return retry.payload;
}
