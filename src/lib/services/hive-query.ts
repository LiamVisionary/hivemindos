import "server-only";

import {
  CONNECTOR_MANIFESTS,
  connectorManifest,
  type ConnectorManifest,
  type ConnectorOperationManifest,
} from "@/lib/services/integrations/connector-manifests";
import { readSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";
import { createVisualArtifact } from "@/lib/services/visual-artifacts";
import { authorizeOperation, decisionAllowed } from "@/lib/services/security/action-authorization";
import { recordAuditEvent } from "@/lib/services/security/audit-events";
import type { PrincipalContext } from "@/lib/types/principal";
import { workspaceScope } from "@/lib/types/principal";

export type HiveQueryInput = {
  connectorKey?: unknown;
  operationId?: unknown;
  query?: unknown;
  createArtifact?: unknown;
  title?: unknown;
  vaultPath?: unknown;
};

export type HiveQueryReceipt = {
  id: string;
  connectorKey: string;
  operationId: string;
  executedAt: string;
  readOnly: true;
  credentialKeys: string[];
  credentialStatus: Record<string, "set" | "missing">;
};

export async function executeHiveQuery(input: HiveQueryInput, principal: PrincipalContext) {
  const connectorKey = cleanString(input.connectorKey);
  const operationId = cleanString(input.operationId) || "connection-status";
  const manifests = connectorKey
    ? [connectorManifest(connectorKey)].filter((manifest): manifest is ConnectorManifest => Boolean(manifest))
    : CONNECTOR_MANIFESTS;
  if (!manifests.length) throw new Error(`Unknown connector: ${connectorKey}`);

  const sharedEnv = await readSharedAgentEnv();
  const rows = [];
  const receipts: HiveQueryReceipt[] = [];
  for (const manifest of manifests) {
    const operation = manifest.operations.find((candidate) => candidate.id === operationId)
      ?? manifest.operations.find((candidate) => candidate.id === "connection-status");
    if (!operation) throw new Error(`Connector ${manifest.key} does not declare operation ${operationId}.`);
    if (!operation.readOnly || operation.sideEffects.some((effect) => effect !== "read" && effect !== "network")) {
      throw new Error("Hive Query v1 only executes read-only manifest operations.");
    }
    const decision = authorizeOperation(operationForAuthorization(manifest, operation), {
      principal,
      caller: "hive-query",
    });
    await recordAuditEvent({
      type: "hive-query.execute",
      principal,
      decision,
      target: `${manifest.key}:${operation.id}`,
      payload: { connectorKey: manifest.key, operationId: operation.id },
    });
    if (!decisionAllowed(decision)) {
      throw new Error(decision.reason);
    }
    const credentialKeys = credentialKeyNames(manifest);
    const credentialStatus = Object.fromEntries(
      credentialKeys.map((key) => [key, sharedEnvValue(key, sharedEnv) ? "set" : "missing"]),
    ) as Record<string, "set" | "missing">;
    receipts.push({
      id: `hive_query_${Date.now().toString(36)}_${manifest.key}_${operation.id}`,
      connectorKey: manifest.key,
      operationId: operation.id,
      executedAt: new Date().toISOString(),
      readOnly: true,
      credentialKeys,
      credentialStatus,
    });
    rows.push({
      connector: manifest.key,
      label: manifest.label,
      operation: operation.id,
      authMode: manifest.auth.mode,
      connected: credentialKeys.some((key) => credentialStatus[key] === "set"),
      credentialKeys: credentialKeys.join(", "),
      declaredOperations: manifest.operations.map((item) => item.id).join(", "),
    });
  }

  const artifact = input.createArtifact === true
    ? await createVisualArtifact({
      kind: "query-result",
      title: cleanString(input.title) || "Hive Query result",
      vaultPath: input.vaultPath,
      createdByPrincipalId: principal.principalId,
      scope: workspaceScope(["artifacts:read"], ["hive-query", "query-result"]),
      blocks: [
        {
          type: "summary",
          markdown: `Read-only Hive Query returned ${rows.length} connector row${rows.length === 1 ? "" : "s"}.`,
        },
        {
          type: "table",
          columns: ["connector", "label", "operation", "authMode", "connected", "credentialKeys", "declaredOperations"],
          rows,
          caption: "Connector status and manifest metadata. Credential values are never included.",
        },
        {
          type: "source-receipt",
          markdown: receipts.map((receipt) => [
            `- ${receipt.connectorKey}:${receipt.operationId}`,
            `  - executedAt: ${receipt.executedAt}`,
            `  - credentialKeys: ${receipt.credentialKeys.join(", ") || "none"}`,
          ].join("\n")).join("\n"),
        },
      ],
    })
    : undefined;

  return {
    receipts,
    columns: ["connector", "label", "operation", "authMode", "connected", "credentialKeys", "declaredOperations"],
    rows,
    artifact,
    query: cleanString(input.query),
  };
}

function operationForAuthorization(
  manifest: ConnectorManifest,
  operation: ConnectorOperationManifest,
) {
  return {
    id: `connector:${manifest.key}:${operation.id}`,
    title: `${manifest.label}: ${operation.label}`,
    sideEffects: operation.sideEffects,
    risk: operation.risk,
    readOnly: operation.readOnly,
    requiredClaims: operation.requiredClaims,
  };
}

function credentialKeyNames(manifest: ConnectorManifest) {
  return [
    manifest.auth.tokenEnvKey,
    ...(manifest.auth.tokenEnvAliases ?? []),
    ...(manifest.auth.oauthClientEnvKeys ?? []),
  ];
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
