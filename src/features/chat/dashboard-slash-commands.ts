import type { DashboardView } from "@/features/dashboard/dashboard-types";

export type DashboardSlashCommandAction = {
  name: string;
  category: string;
  description: string;
  argsHint?: string;
  aliases?: string[];
  view: DashboardView;
  reply: string;
  refresh?: "diagnostics" | "sessions" | "usage" | "notifications";
};

export const DASHBOARD_SLASH_COMMANDS: DashboardSlashCommandAction[] = [
  { name: "doctor", aliases: ["diagnostics"], category: "HivemindOS", description: "Open fleet diagnostics and run checks", view: "maintenance", reply: "Opened Diagnostics and started a fresh check.", refresh: "diagnostics" },
  { name: "sessions", aliases: ["history"], category: "HivemindOS", description: "Search recent runtime sessions", view: "sessions", reply: "Opened runtime session search.", refresh: "sessions" },
  { name: "fleet", category: "HivemindOS", description: "Open the fleet dashboard", view: "agents", reply: "Opened Fleet." },
  { name: "models", aliases: ["providers"], category: "HivemindOS", description: "Open agent model/provider settings", view: "chat", reply: "Open an agent's settings to adjust provider and model routing." },
  { name: "usage", category: "HivemindOS", description: "Refresh runtime token usage", view: "wallet", reply: "Opened Wallets and refreshed runtime usage.", refresh: "usage" },
  { name: "alerts", aliases: ["notifications"], category: "HivemindOS", description: "Open the shared alert inbox", view: "notifications", reply: "Opened Alerts.", refresh: "notifications" },
  { name: "brain", aliases: ["vault"], category: "HivemindOS", description: "Open the shared brain", view: "vault", reply: "Opened Brain." },
  { name: "note", category: "HivemindOS", description: "Save a note to the shared brain", argsHint: "<note>", view: "chat", reply: "Saving note." },
  { name: "work", aliases: ["kanban"], category: "HivemindOS", description: "Open the work board", view: "kanban", reply: "Opened Work." },
  { name: "handoff-task", category: "HivemindOS", description: "Send a task to the best agent on a target machine", argsHint: "<machine> <task>", view: "chat", reply: "Preparing handoff." },
  { name: "swarm", category: "HivemindOS", description: "Spawn the best-suited agent team for a task", argsHint: "[number] <task>", view: "chat", reply: "Preparing agent swarm." },
  { name: "swarm-goal", category: "HivemindOS", description: "Rewrite a build prompt as a parallel agent goal and send it to Queen Bee", argsHint: "<build request>", view: "chat", reply: "Preparing swarm goal." },
  { name: "swarm-sim", category: "HivemindOS", description: "Launch a MiroShark simulation from chat", argsHint: "<scenario>", view: "chat", reply: "Preparing MiroShark simulation." },
  { name: "image-gen", aliases: ["imagine", "txt2img"], category: "HivemindOS", description: "Generate an image through a connected Image Studio, ComfyUI, or Z-Image app", argsHint: "<prompt>", view: "chat", reply: "Preparing image generation." },
];

export function resolveDashboardSlashCommand(input: string): DashboardSlashCommandAction | null {
  const match = input.trim().match(/^\/([a-z0-9_-]+)(?:\s|$)/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  return DASHBOARD_SLASH_COMMANDS.find((command) => (
    command.name === name || command.aliases?.some((alias) => alias.toLowerCase() === name)
  )) ?? null;
}
