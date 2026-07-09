import type { ContextIndexItem } from "@/lib/services/context-index";
import type { HiveActionDefinition } from "./types";
import { hiveActionMcpName } from "./mcp-export";
import { requiredClaimsForSideEffects } from "@/lib/services/security/action-authorization";
import { workspaceScope } from "@/lib/types/principal";

export function toContextIndexItem(
  action: HiveActionDefinition,
): ContextIndexItem {
  const summary = action.contextIndex?.summary ?? action.description;
  const retrievalText =
    action.contextIndex?.retrievalText ??
    [
      action.description,
      `Hive action id: ${action.id}.`,
      `Side effects: ${action.sideEffects.join(", ") || "none"}.`,
      `Risk: ${action.risk}.`,
    ].join(" ");
  const route = action.contextIndex?.route;
  return {
    id: `hive-action:${action.id}`,
    kind: "tool-schema",
    title: action.title,
    summary,
    tags: [...new Set([...action.tags, "hive-action", "capability"])],
    aliases: [...new Set([action.id, hiveActionMcpName(action), ...(action.aliases ?? [])])],
    retrievalText,
    ...(route ? { route } : {}),
    ...(action.contextIndex?.methods ? { methods: action.contextIndex.methods } : {}),
    scope: workspaceScope(requiredClaimsForSideEffects(action.sideEffects), ["hive-action"]),
    authorization: {
      sideEffects: action.sideEffects,
      risk: action.risk,
      readOnly: action.readOnly,
      requiredClaims: requiredClaimsForSideEffects(action.sideEffects),
      confirmation: action.confirmation,
    },
    load: action.contextIndex?.load ?? {
      type: route ? "api" : "none",
      target: route,
      note: action.mcp?.expose
        ? `Also available through hivemind-mcp as ${hiveActionMcpName(action)}.`
        : "Hive action metadata entry.",
    },
  };
}

export function hiveActionContextIndexItems(actions: HiveActionDefinition[]) {
  return actions.map(toContextIndexItem);
}
