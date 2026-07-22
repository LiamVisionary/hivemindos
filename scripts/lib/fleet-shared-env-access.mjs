import {
  effectiveFleetAccess,
  fleetMachinePolicyPrompt,
  fleetPolicyRuntimeFlags,
} from "./fleet-machine-policy.mjs";

function sharedEnvDecision(policy) {
  return !policy?.authority ? "allow" : effectiveFleetAccess(policy).sharedEnv;
}

export function fleetPolicyChatContext(policy, dashboardContext) {
  return [
    typeof dashboardContext === "string" ? dashboardContext.trim() : "",
    fleetMachinePolicyPrompt(policy),
  ].filter(Boolean).join("\n\n");
}

export function hermesContextEnv(agentEnv, context) {
  const dashboardContext = typeof context === "string" ? context.trim() : "";
  if (!dashboardContext) return agentEnv;
  const existingPrompt = typeof agentEnv.HERMES_EPHEMERAL_SYSTEM_PROMPT === "string"
    ? agentEnv.HERMES_EPHEMERAL_SYSTEM_PROMPT.trim()
    : "";
  return {
    ...agentEnv,
    HERMES_EPHEMERAL_SYSTEM_PROMPT: [existingPrompt, dashboardContext].filter(Boolean).join("\n\n"),
  };
}

export function fleetPolicySpawnEnv(policy, sharedHiveEnv, extra = {}) {
  const sharedEnvAllowed = sharedEnvDecision(policy) === "allow";
  const excludedKeys = sharedEnvAllowed ? [] : Object.keys(sharedHiveEnv);
  const filteredExtra = { ...extra };
  for (const key of excludedKeys) delete filteredExtra[key];
  return {
    extra: {
      ...(sharedEnvAllowed ? sharedHiveEnv : {}),
      ...filteredExtra,
      ...fleetPolicyRuntimeFlags(policy),
    },
    excludedKeys,
  };
}

export function fleetSharedEnvBlockResponse(policy, sharedHiveEnv, requestedEnv) {
  const decision = sharedEnvDecision(policy);
  if (decision === "allow") return null;
  const blockedKeys = Object.keys(requestedEnv)
    .filter((key) => Object.prototype.hasOwnProperty.call(sharedHiveEnv, key))
    .sort();
  if (!blockedKeys.length) return null;

  const keySummary = blockedKeys.join(", ");
  const error = decision === "ask"
    ? [
        `Shared hive environment access is set to Ask on this machine, so Hermes was not started. Stored credentials remain present and unchanged. Requested key${blockedKeys.length === 1 ? "" : "s"}: ${keySummary}.`,
        "ACTION NEEDED: Approve or deny this machine access before I continue.",
        "FLEET ACCESS REQUEST: sharedEnv",
        "OPTIONS: Allow 15 min | Always allow | Deny",
      ].join("\n")
    : `Shared hive environment access is denied by this machine's fleet policy, so Hermes was not started. Stored credentials remain present and unchanged. Requested key${blockedKeys.length === 1 ? "" : "s"}: ${keySummary}.`;
  return {
    ok: false,
    code: "fleet_shared_env_access_blocked",
    capability: "sharedEnv",
    decision,
    blockedKeys,
    error,
  };
}

export function prepareFleetSharedEnvChat(policy, sharedHiveEnv, requestedAgentEnv, dashboardContext) {
  return {
    agentEnv: hermesContextEnv(
      requestedAgentEnv,
      fleetPolicyChatContext(policy, dashboardContext),
    ),
    sharedEnvBlock: fleetSharedEnvBlockResponse(policy, sharedHiveEnv, requestedAgentEnv),
  };
}
