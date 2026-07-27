import { z } from "zod";
import { sanitizeIncidentValue } from "./incident-bundle";
import { getOpenSreConfig, SRE_PROVIDER_MATRIX } from "./provider-matrix";
import type { IncidentBundle, SreDiagnosis, SreProviderStatus } from "./types";

const healthSchema = z.object({
  ok: z.boolean().optional(),
  version: z.string().optional(),
  llm_configured: z.boolean().optional(),
  env: z.string().optional(),
}).passthrough();

const investigationResponseSchema = z.object({
  report: z.string(),
  problem_md: z.string(),
  root_cause: z.string(),
  is_noise: z.boolean().default(false),
  validity_score: z.number().default(0),
  tool_calls: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
}).passthrough();

type ClientOptions = {
  fetch?: typeof fetch;
  config?: typeof getOpenSreConfig;
};

function recommendationLines(report: string) {
  const section = report.match(/(?:^|\n)#{1,4}\s+(?:remediation|recommendations?|next steps)\b[^\n]*\n([\s\S]*?)(?=\n#{1,4}\s|$)/i)?.[1] ?? "";
  return section
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length >= 4)
    .slice(0, 12);
}

function abortAfter(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

export function createOpenSreClient(options: ClientOptions = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const configProvider = options.config ?? getOpenSreConfig;

  async function status(): Promise<SreProviderStatus> {
    const config = configProvider();
    const base = SRE_PROVIDER_MATRIX.opensre;
    if (!config.enabled) return { ...base, enabled: false, ready: false, reason: "OpenSRE sidecar is not enabled." };
    if (config.configError) return { ...base, enabled: true, ready: false, reason: config.configError };
    if (!config.pinMatches) {
      return {
        ...base,
        enabled: true,
        ready: false,
        baseUrl: config.baseUrl,
        installedCommit: config.installedCommit,
        reason: "Installed OpenSRE commit does not match the HivemindOS-reviewed pin.",
      };
    }
    const timer = abortAfter(config.healthTimeoutMs);
    try {
      const response = await fetchImpl(`${config.baseUrl}/health`, { signal: timer.signal, cache: "no-store" });
      const parsed = healthSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        return { ...base, enabled: true, ready: false, baseUrl: config.baseUrl, installedCommit: config.installedCommit, reason: "OpenSRE health response was invalid." };
      }
      const ready = response.ok && parsed.data.llm_configured === true;
      return {
        ...base,
        enabled: true,
        ready,
        baseUrl: config.baseUrl,
        version: parsed.data.version,
        installedCommit: config.installedCommit,
        ...(!ready ? { reason: parsed.data.llm_configured === false ? "OpenSRE is running but its LLM is not configured." : `OpenSRE health returned HTTP ${response.status}.` } : {}),
      };
    } catch (error) {
      const reason = error instanceof Error && error.name === "AbortError"
        ? "OpenSRE health check timed out."
        : "OpenSRE sidecar is not reachable on loopback.";
      return { ...base, enabled: true, ready: false, baseUrl: config.baseUrl, installedCommit: config.installedCommit, reason };
    } finally {
      timer.clear();
    }
  }

  async function investigate(bundle: IncidentBundle): Promise<SreDiagnosis> {
    const config = configProvider();
    if (!config.enabled || config.configError || !config.pinMatches) {
      throw new Error(config.configError || "OpenSRE is not ready under the pinned sidecar policy.");
    }
    const timer = abortAfter(config.investigationTimeoutMs);
    try {
      const response = await fetchImpl(`${config.baseUrl}/investigate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.gatewayToken ? { authorization: `Bearer ${config.gatewayToken}` } : {}),
        },
        body: JSON.stringify({ raw_alert: bundle, alert_name: bundle.summary, severity: bundle.severity }),
        signal: timer.signal,
      });
      if (!response.ok) throw new Error(`OpenSRE investigation failed with HTTP ${response.status}.`);
      const parsed = investigationResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new Error("OpenSRE investigation response did not match the reviewed contract.");
      const report = String(sanitizeIncidentValue(parsed.data.report));
      return {
        report,
        problem: String(sanitizeIncidentValue(parsed.data.problem_md)),
        rootCause: String(sanitizeIncidentValue(parsed.data.root_cause)),
        isNoise: parsed.data.is_noise,
        validityScore: Math.max(0, Math.min(parsed.data.validity_score, 1)),
        toolCalls: sanitizeIncidentValue(parsed.data.tool_calls ?? []) as Array<Record<string, unknown>>,
        recommendations: recommendationLines(report),
        recommendationsRequireApproval: true,
        executionAuthority: "hivemindos",
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("OpenSRE investigation timed out.");
      throw error;
    } finally {
      timer.clear();
    }
  }

  return { status, investigate };
}

export type OpenSreClient = ReturnType<typeof createOpenSreClient>;
