import { sharedEnvValue } from "@/lib/services/integrations/shared-env";

/**
 * An integration-backed hive action is advertised in capability search ONLY when
 * its integration is connected — i.e. at least one of its `requiresConnection`
 * credential keys is present in the shared env. Core actions (no requiresConnection)
 * are always available. Governance (claims/confirmation) is unaffected; this only
 * gates whether the capability is surfaced. Kept out of context-index.ts to avoid
 * growing that already-oversized file.
 */
export function actionIntegrationConnected(
  action: { requiresConnection?: string[] },
  sharedEnv: Record<string, string>,
): boolean {
  const keys = action.requiresConnection;
  if (!keys || keys.length === 0) return true;
  return keys.some((key) => Boolean(sharedEnvValue(key, sharedEnv)));
}
