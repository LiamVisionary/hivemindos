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
    "- Skills: treat Skills/ as the primary shared skill shelf. Read Skills/README.md, then Skills/<slug>/SKILL.md before using a shared skill. Runtime-local skills are supplemental overlays.",
    "- Retrieval: use already-injected capability-search results first. Tool-capable runtimes may call /api/context-index for skills, tool schemas, API routes, connected apps, docs, runtime capabilities, and workspace files before loading full files.",
    "- Memory: use already-injected memory first. Tool-capable runtimes may call /api/brain/memory or hive-brain for recall/answer/remember. Recall before relying on durable preferences, decisions, instructions, goals, commitments, artifacts, lessons, or project context. Remember only reviewed durable facts and never store secrets.",
    "- Compiled wiki: for synthesized entity/concept/summary knowledge under Synthesis/Compiled Knowledge/<domain>/, load Skills/hive-brain-compiled-wiki/SKILL.md and prefer /api/brain/knowledge action search or the brain_search_knowledge MCP tool before broad full-vault recall.",
    "- Durable vault edits: read Operations/AI-Ready Vault Contract.md first and prefer Templates/HivemindOS/.",
    `- Agent inbox folder: ${sharedVault.inboxFolder || "(not set)"}`,
    `- Shared note: ${sharedVault.sharedNotePath || "(not set)"}`,
    `- Shared Kanban folder: ${sharedVault.kanbanFolder || "Operations/Work Board"}`,
    `- Agent notifications folder: ${sharedVault.notificationsFolder || "Operations/Agent Notifications"}`,
    `- Queen Bee control plane: ${(sharedVault.brainServicesFolder || "Operations/Brain Services")}/Queen Bee. Use it for routing/safety policy, dedupe, leases, and receipts; use the Work Board for tasks and /api/brain/memory for durable memory.`,
    `- Hivemind Sync brain owner: ${sharedVault.syncProvider === "syncthing" ? "HivemindOS Syncthing over Tailscale" : sharedVault.syncProvider === "manual" ? "manual Tailscale SSH repair only" : "external provider such as Obsidian Sync, iCloud, Dropbox, Git, or another folder sync tool"}.`,
    "- Kanban: Ideas are inert; Ready for Queen is pickup; Working is claimed; Needs Human is decisions/access/approval; Done is complete. Tool-capable runtimes may use /api/kanban for board reads, task creation, moves, and comments.",
    "- Notifications: write markdown notifications under the notifications folder with priority low, normal, high, or urgent when user attention is needed outside chat.",
    "- Knowledge flow: Intake for raw captures, Synthesis for drafts/reports, Memory or Projects for reviewed durable knowledge; tag generated outputs with ai-generated.",
    "- Access tracking: when inspecting vault notes through a tool-capable dashboard bridge, call /api/obsidian/access with agent and note metadata.",
    `- HivemindOS folder path: ${sharedVault.controlRoomPath || "(not set)"}`,
    `- Instructions: ${sharedVault.instructions || "Read AGENTS.md before durable vault edits."}`,
  ];
  return lines.join("\n");
}
