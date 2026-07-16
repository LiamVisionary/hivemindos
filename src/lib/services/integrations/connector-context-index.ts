import type { ContextIndexItem } from "@/lib/services/context-index";
import { CONNECTOR_MANIFESTS } from "@/lib/services/integrations/connector-manifests";
import { sharedEnvValue } from "@/lib/services/integrations/shared-env";
import { workspaceScope } from "@/lib/types/principal";

/**
 * Surface a connector (and its operations) in the capability index ONLY when it
 * is actually connected — i.e. its token/credential is present in the shared hive
 * env (or process env). Capability search must reflect real, usable capabilities,
 * not every connector that could theoretically be set up; a freshly-connected
 * integration appears automatically and a disconnected one drops out. Connection
 * is the same signal `providerStatus` uses (`connected = token present`).
 */
export function connectorManifestContextIndexItems(sharedEnv: Record<string, string>): ContextIndexItem[] {
  const connectedManifests = CONNECTOR_MANIFESTS.filter((manifest) =>
    [manifest.auth.tokenEnvKey, ...(manifest.auth.tokenEnvAliases ?? [])].some((key) =>
      Boolean(sharedEnvValue(key, sharedEnv)),
    ),
  );
  return connectedManifests.flatMap((manifest) => {
    const credentialKeys = [
      manifest.auth.tokenEnvKey,
      ...(manifest.auth.tokenEnvAliases ?? []),
      ...(manifest.auth.oauthClientEnvKeys ?? []),
      ...(manifest.auth.setupFields ?? []).map((field) => field.envKey),
    ];
    const connectorItem: ContextIndexItem = {
      id: `connector:${manifest.key}`,
      kind: "connector",
      title: manifest.label,
      summary: `${manifest.detail} Auth mode: ${manifest.auth.mode}. Credential keys: ${credentialKeys.join(", ") || "none"}.`,
      tags: [...new Set(["connector", manifest.key, manifest.auth.mode, ...manifest.tags])],
      aliases: [...new Set([manifest.key, manifest.label, ...manifest.tags])],
      retrievalText: [
        `Connector: ${manifest.label}`,
        manifest.detail,
        `Auth mode: ${manifest.auth.mode}.`,
        `Credential keys by name only: ${credentialKeys.join(", ") || "none"}.`,
        `Operations: ${manifest.operations.map((operation) => `${operation.id} (${operation.sideEffects.join(", ")}, ${operation.risk})`).join("; ")}.`,
        "Never expose token values to models; resolve credentials server-side.",
      ].join(" "),
      route: "/api/hive-query",
      methods: ["POST"],
      load: {
        type: "api",
        target: "/api/hive-query",
        note: "Use read-only Hive Query operations for deterministic connector metadata/status. Mutating provider calls require action authorization.",
      },
      scope: workspaceScope(["connectors:read"], ["connector"]),
      authorization: {
        sideEffects: ["read"],
        risk: "low",
        readOnly: true,
        requiredClaims: ["connectors:read"],
      },
    };
    const operationItems: ContextIndexItem[] = manifest.operations.map((operation) => ({
      id: `connector-operation:${manifest.key}:${operation.id}`,
      kind: "connector",
      title: `${manifest.label}: ${operation.label}`,
      summary: operation.description,
      tags: [...new Set(["connector", "connector-operation", manifest.key, operation.id, ...manifest.tags, ...operation.sideEffects])],
      aliases: [...new Set([manifest.key, manifest.label, operation.id, operation.label, ...manifest.tags])],
      retrievalText: [
        `Connector operation: ${manifest.label} ${operation.id}`,
        operation.description,
        `Methods: ${operation.methods.join(", ")}.`,
        `Side effects: ${operation.sideEffects.join(", ")}.`,
        `Risk: ${operation.risk}.`,
        `Required claims: ${(operation.requiredClaims ?? []).join(", ") || "none"}.`,
      ].join(" "),
      route: "/api/hive-query",
      methods: ["POST"],
      load: {
        type: "api",
        target: "/api/hive-query",
        note: "Server-side connector manifest operation. Credentials stay in shared env and are reported only as set/missing status.",
      },
      scope: workspaceScope(operation.requiredClaims ?? ["connectors:read"], ["connector-operation"]),
      authorization: {
        sideEffects: operation.sideEffects,
        risk: operation.risk,
        readOnly: operation.readOnly,
        requiredClaims: operation.requiredClaims,
      },
    }));
    return [connectorItem, ...operationItems];
  });
}
