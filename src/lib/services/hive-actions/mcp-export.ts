import { z } from "zod";
import type {
  HiveActionDefinition,
  HiveActionSideEffect,
  HiveMcpToolDescriptor,
} from "./types";

const DESTRUCTIVE_SIDE_EFFECTS = new Set<HiveActionSideEffect>([
  "write",
  "remote-machine",
  "wallet",
  "payment",
  "credential",
  "public-message",
]);

export function hiveActionMcpName(action: HiveActionDefinition) {
  return action.mcp?.toolName ?? action.id.replace(/[^A-Za-z0-9]+/g, "_");
}

export function hiveActionInputSchema(action: HiveActionDefinition) {
  const schema = z.toJSONSchema(action.schema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export function toMcpTool(action: HiveActionDefinition): HiveMcpToolDescriptor {
  const annotations: HiveMcpToolDescriptor["annotations"] = {
    readOnlyHint: action.readOnly === true,
    destructiveHint:
      action.risk === "high" ||
      action.risk === "critical" ||
      action.sideEffects.some((effect) => DESTRUCTIVE_SIDE_EFFECTS.has(effect)),
    openWorldHint: action.sideEffects.includes("network"),
    "hivemindos/risk": action.risk,
    "hivemindos/sideEffects": [...action.sideEffects],
  };
  if (action.confirmation) {
    annotations["hivemindos/confirmation"] = action.confirmation;
  }
  annotations["hivemindos/authorization"] = {
    sideEffects: [...action.sideEffects],
    risk: action.risk,
    readOnly: action.readOnly === true,
    confirmation: action.confirmation,
  };
  return {
    name: hiveActionMcpName(action),
    title: action.title,
    description: action.description,
    inputSchema: hiveActionInputSchema(action),
    annotations,
  };
}

export function listMcpHiveActions(actions: HiveActionDefinition[]) {
  return actions
    .filter((action) => action.mcp?.expose)
    .map(toMcpTool)
    .sort((left, right) => left.name.localeCompare(right.name));
}
