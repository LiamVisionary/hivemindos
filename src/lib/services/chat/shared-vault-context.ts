import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";

export function activeSharedVault(profile: AgentProfile, sharedVault?: SharedVaultConfig): SharedVaultConfig | null {
  if (!sharedVault?.enabled || profile.useSharedVault === false) return null;
  if (!sharedVault.vaultPath.trim()) return null;
  return sharedVault;
}

export function buildVaultContext(sharedVault: SharedVaultConfig | null): string {
  if (!sharedVault) return "";
  const lines = [
    "Shared Obsidian vault context:",
    `- Vault path: ${sharedVault.vaultPath}`,
    "- Shared skills folder: Skills/. Read Skills/README.md for the index, then read the relevant Skills/<slug>/SKILL.md before using a shared skill.",
    "- Context retrieval: call /api/context-index with a task query to find relevant skills, tool schemas, API routes, connected Tailnet apps, app endpoints, docs, runtime capabilities, and workspace files before loading full context. Connected app records include capability aliases for intent queries such as image generation, simulation, graph, exports, monitoring, settings, and API docs; POST with syncConnectedAppsToGbrain only when the task needs those app records embedded into GBrain retrieval.",
    "- Persistent memory: use /api/brain/memory for shared-brain remember, recall, answer, and rebuild-index primitives. Raw/non-managed agents should run hive-brain answer \"<query>\" before relying on prior context; the CLI tries the running API first and falls back to local vault/index search. Default recall/answer is tiered: check typed Agent Memory first, return it when the distilled hit is strong, and otherwise augment with relevant markdown from the full shared vault. Pass scope: \"agent-memory\" or --scope agent-memory for typed/proven memory only; pass scope: \"full-vault\" or --scope full-vault to force broad vault recall. Recall before depending on prior user preferences, decisions, instructions, goals, commitments, artifacts, lessons, or project context; remember only durable reviewed facts, decisions, preferences, goals, instructions, commitments, artifacts, errors, learnings, or reusable context. Memory writes are typed as instruction, fact, decision, goal, commitment, preference, relationship, context, event, learning, observation, artifact, or error, and are stored under Memory/Distillations/Agent Memory with a private append-only search index in Operations/Brain Services. Operations/Secure reference/status notes are searchable during full-vault recall so agents can know which credential names exist or are set, but plaintext secret values still belong only in shared env or encrypted artifacts and must not be printed, copied, or summarized. When saving a memory, include agentId, agentName, runtime, machineName, machineId, tailnetId, tailnetName, tailnetDnsName, and collectorUrl when known so future agents can identify the writer and machine. Use proof: true for an explicit GitLawb memory receipt or proof: \"auto\" for durable memories; receipts store hashes/provenance, not memory bodies. Use action: \"rebuild-index\" after importing or manually editing memory notes.",
    "- AI-ready vault contract: read Operations/AI-Ready Vault Contract.md before durable vault edits; use Templates/HivemindOS/ for durable notes when practical.",
    `- Agent inbox folder: ${sharedVault.inboxFolder || "(not set)"}`,
    `- Shared note: ${sharedVault.sharedNotePath || "(not set)"}`,
    `- Shared Kanban folder: ${sharedVault.kanbanFolder || "Operations/Work Board"}`,
    `- Agent notifications folder: ${sharedVault.notificationsFolder || "Operations/Agent Notifications"}`,
    "- Queen Bee default control-plane folder: Operations/Brain Services/Queen Bee.",
    `- Queen Bee control plane: ${(sharedVault.brainServicesFolder || "Operations/Brain Services")}/Queen Bee. Use it for identity, routing/safety policy, dedupe, leases, and receipts; use the Work Board for tasks and /api/brain/memory for durable memory.`,
    `- Hivemind Sync brain owner: ${sharedVault.syncProvider === "syncthing" ? "HivemindOS Syncthing over Tailscale" : sharedVault.syncProvider === "manual" ? "manual Tailscale SSH repair only" : "external provider such as Obsidian Sync, iCloud, Dropbox, Git, or another folder sync tool"}.`,
    "- Kanban workflow: Ideas are inert; Ready for Queen is the pickup lane; Working is claimed work; Needs Human is only for decisions/access/approval; Done is completed work.",
    "- Queen Bee behavior: if you are the Queen Bee, watch Ready for Queen, choose yourself or a worker class, move claimed cards to Working, comment with the routing reason, and move straight to Done when no human intervention is needed.",
    "- Kanban API: use the dashboard's /api/kanban endpoint for task creation, status moves, comments, and board reads when available. Use /api/orchestrator for the MCP-ready tool/agent/task surface when the dashboard provides agent role metadata.",
    "- Kanban storage: boards are stored as kanban.json files under the shared Kanban folder. Collaboration can use any Hivemind Sync brain owner, including Obsidian Sync, iCloud Drive, Dropbox, Syncthing, Git, or the built-in Syncthing-over-Tailscale pairing.",
    "- Notifications: when you need the user's attention outside chat, write a markdown notification under the notifications folder using priority low, normal, high, or urgent. High-priority messaging escalation is only a preference flag; a configured messaging agent should handle Telegram, iMessage, Discord, or similar delivery when configured.",
    "- Knowledge flow: keep raw captures in Intake, generated drafts and connection reports in Synthesis, durable reviewed knowledge in Memory or Projects, and tag generated outputs with ai-generated.",
    "- Brain access tracking: when you inspect a vault note through the dashboard, call /api/obsidian/access with vaultPath, notePath, agentName, agentId, runtime, machineName, and action so the shared brain records who accessed what and when.",
    `- HivemindOS folder path: ${sharedVault.controlRoomPath || "(not set)"}`,
    `- Instructions: ${sharedVault.instructions || "Read AGENTS.md before durable vault edits."}`,
  ];
  return lines.join("\n");
}
