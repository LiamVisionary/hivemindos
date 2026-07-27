import "server-only";

import { spawn } from "node:child_process";
import { optionalEnv } from "@/lib/config/env";
import type {
  BeelineLocalCredential,
  BeelineLocalCredentialUseInput,
} from "@/lib/types/beeline";

const MAX_OUTPUT_BYTES = 1_048_576;
const BROKER_TIMEOUT_MS = 45_000;

type BrokerEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export class NativeBeelineCredentialBrokerUnavailableError extends Error {
  constructor() {
    super("Local credential use requires the packaged HivemindOS desktop app on this device.");
    this.name = "NativeBeelineCredentialBrokerUnavailableError";
  }
}

function nativeExecutable() {
  const executable = optionalEnv("HIVEMINDOS_NATIVE_EXECUTABLE");
  if (!executable) throw new NativeBeelineCredentialBrokerUnavailableError();
  return executable;
}

export async function callLocalCredentialBroker<T>(request: unknown): Promise<T> {
  const executable = nativeExecutable();
  return new Promise<T>((resolve, reject) => {
    const child = spawn(executable, ["--beeline-credential-broker"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("The native credential broker timed out.")));
    }, BROKER_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) child.kill();
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) child.kill();
    });
    child.once("error", (error) => finish(() => reject(new Error(`Could not start the native credential broker: ${error.message}`))));
    child.once("close", () => finish(() => {
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES || Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
        reject(new Error("The native credential broker returned too much data."));
        return;
      }
      let payload: BrokerEnvelope<T>;
      try {
        payload = JSON.parse(stdout) as BrokerEnvelope<T>;
      } catch {
        reject(new Error(stderr.trim() || "The native credential broker returned an invalid response."));
        return;
      }
      if (!payload.ok) {
        reject(new Error(payload.error || "The native credential broker rejected the request."));
        return;
      }
      resolve(payload.data);
    }));
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

export function listLocalBeelineCredentials(profileId: string) {
  return callLocalCredentialBroker<BeelineLocalCredential[]>({ action: "list", profileId });
}

export function executeLocalBeelineCredential(request: BeelineLocalCredentialUseInput) {
  return callLocalCredentialBroker<unknown>({ action: "use", request });
}

export function deleteLocalBeelineProfileCredentials(profileId: string) {
  return callLocalCredentialBroker<{ profileId: string; deleted: number }>({ action: "delete-profile", profileId });
}
