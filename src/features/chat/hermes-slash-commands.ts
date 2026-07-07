import { DASHBOARD_SLASH_COMMANDS } from "@/features/chat/dashboard-slash-commands";

export type HermesSlashCommand = {
  name: string;
  category: string;
  description: string;
  argsHint?: string;
  aliases?: string[];
  cliOnly?: boolean;
  gatewayOnly?: boolean;
};

export const HERMES_SLASH_COMMANDS: HermesSlashCommand[] = [
  { name: "new", category: "Session", description: "Start a fresh session", argsHint: "[name]", aliases: ["reset"] },
  { name: "topic", category: "Session", description: "Enable or inspect Telegram DM topic sessions", argsHint: "[off|help|session-id]", gatewayOnly: true },
  { name: "clear", category: "Session", description: "Clear screen and start a new session", cliOnly: true },
  { name: "redraw", category: "Session", description: "Force a full UI repaint", cliOnly: true },
  { name: "history", category: "Session", description: "Show conversation history", cliOnly: true },
  { name: "save", category: "Session", description: "Save the current conversation", cliOnly: true },
  { name: "retry", category: "Session", description: "Retry the last message" },
  { name: "undo", category: "Session", description: "Remove the last user/assistant exchange" },
  { name: "title", category: "Session", description: "Set a title for the current session", argsHint: "[name]" },
  { name: "handoff", category: "Session", description: "Hand off this session to a messaging platform", argsHint: "<platform>", cliOnly: true },
  { name: "branch", category: "Session", description: "Branch the current session", argsHint: "[name]", aliases: ["fork"] },
  { name: "compress", category: "Session", description: "Manually compress conversation context", argsHint: "[focus topic]" },
  { name: "rollback", category: "Session", description: "List or restore filesystem checkpoints", argsHint: "[number]" },
  { name: "snapshot", category: "Session", description: "Create or restore Hermes config/state snapshots", argsHint: "[create|restore <id>|prune]", aliases: ["snap"], cliOnly: true },
  { name: "stop", category: "Session", description: "Kill running background processes" },
  { name: "approve", category: "Session", description: "Approve a pending dangerous command", argsHint: "[session|always]", gatewayOnly: true },
  { name: "deny", category: "Session", description: "Deny a pending dangerous command", gatewayOnly: true },
  { name: "background", category: "Session", description: "Run a prompt in the background", argsHint: "<prompt>", aliases: ["bg", "btw"] },
  { name: "agents", category: "Session", description: "Show active agents and running tasks", aliases: ["tasks"] },
  { name: "queue", category: "Session", description: "Queue a prompt for the next turn", argsHint: "<prompt>", aliases: ["q"] },
  { name: "steer", category: "Session", description: "Inject a note after the next tool call", argsHint: "<prompt>" },
  { name: "goal", category: "Session", description: "Set or manage a persistent goal", argsHint: "[text|pause|resume|clear|status]" },
  { name: "subgoal", category: "Session", description: "Add or manage criteria on the active goal", argsHint: "[text|remove N|clear]" },
  { name: "status", category: "Session", description: "Show session info" },
  { name: "whoami", category: "Info", description: "Show slash command access" },
  { name: "profile", category: "Info", description: "Show active profile and home directory" },
  { name: "sethome", category: "Session", description: "Set this chat as the home channel", aliases: ["set-home"], gatewayOnly: true },
  { name: "resume", category: "Session", description: "Resume a named session", argsHint: "[name]" },
  { name: "sessions", category: "Session", description: "Browse and resume previous sessions" },
  { name: "config", category: "Configuration", description: "Show current configuration", cliOnly: true },
  { name: "model", category: "Configuration", description: "Switch model for this session", argsHint: "[model] [--provider name] [--global]", aliases: ["provider"] },
  { name: "codex-runtime", category: "Configuration", description: "Toggle Codex app-server runtime", argsHint: "[auto|codex_app_server]", aliases: ["codex_runtime"] },
  { name: "gquota", category: "Info", description: "Show Google Gemini Code Assist quota usage", cliOnly: true },
  { name: "personality", category: "Configuration", description: "Set a predefined personality", argsHint: "[name]" },
  { name: "statusbar", category: "Configuration", description: "Toggle the context/model status bar", aliases: ["sb"], cliOnly: true },
  { name: "verbose", category: "Configuration", description: "Cycle tool progress display", cliOnly: true },
  { name: "footer", category: "Configuration", description: "Toggle gateway runtime metadata footer", argsHint: "[on|off|status]" },
  { name: "yolo", category: "Configuration", description: "Toggle approval-free YOLO mode" },
  { name: "reasoning", category: "Configuration", description: "Manage reasoning effort and display", argsHint: "[level|show|hide]" },
  { name: "fast", category: "Configuration", description: "Toggle provider fast mode", argsHint: "[normal|fast|status]" },
  { name: "skin", category: "Configuration", description: "Show or change the display skin/theme", argsHint: "[name]", cliOnly: true },
  { name: "indicator", category: "Configuration", description: "Pick the TUI busy indicator style", argsHint: "[kaomoji|emoji|unicode|ascii]", cliOnly: true },
  { name: "voice", category: "Configuration", description: "Toggle voice mode", argsHint: "[on|off|tts|status]" },
  { name: "busy", category: "Configuration", description: "Control Enter behavior while Hermes is working", argsHint: "[queue|steer|interrupt|status]", cliOnly: true },
  { name: "tools", category: "Tools & Skills", description: "Manage tools", argsHint: "[list|disable|enable] [name...]", cliOnly: true },
  { name: "toolsets", category: "Tools & Skills", description: "List available toolsets", cliOnly: true },
  { name: "skills", category: "Tools & Skills", description: "Search, install, inspect, or manage skills", cliOnly: true },
  { name: "bundles", category: "Tools & Skills", description: "List skill bundles and aliases" },
  { name: "cron", category: "Tools & Skills", description: "Manage scheduled tasks", argsHint: "[subcommand]", cliOnly: true },
  { name: "curator", category: "Tools & Skills", description: "Background skill maintenance", argsHint: "[status|run|pin|archive]" },
  { name: "kanban", category: "Tools & Skills", description: "Use the collaboration board", argsHint: "[subcommand]" },
  { name: "reload", category: "Tools & Skills", description: "Reload env variables", cliOnly: true },
  { name: "reload-mcp", category: "Tools & Skills", description: "Reload MCP servers from config", aliases: ["reload_mcp"] },
  { name: "reload-skills", category: "Tools & Skills", description: "Re-scan installed skills", aliases: ["reload_skills"] },
  { name: "browser", category: "Tools & Skills", description: "Connect browser tools through CDP", argsHint: "[connect|disconnect|status]", cliOnly: true },
  { name: "plugins", category: "Tools & Skills", description: "List installed plugins and status", cliOnly: true },
  { name: "commands", category: "Info", description: "Browse all commands and skills", argsHint: "[page]", gatewayOnly: true },
  { name: "help", category: "Info", description: "Show available commands" },
  { name: "restart", category: "Session", description: "Gracefully restart the gateway", gatewayOnly: true },
  { name: "usage", category: "Info", description: "Show token usage and rate limits" },
  { name: "insights", category: "Info", description: "Show usage analytics", argsHint: "[days]" },
  { name: "platforms", category: "Info", description: "Show gateway platform status", aliases: ["gateway"], cliOnly: true },
  { name: "platform", category: "Info", description: "Pause, resume, or list a gateway platform", argsHint: "<pause|resume|list> [name]", gatewayOnly: true },
  { name: "copy", category: "Info", description: "Copy the last assistant response", argsHint: "[number]", cliOnly: true },
  { name: "paste", category: "Info", description: "Attach a clipboard image", cliOnly: true },
  { name: "image", category: "Info", description: "Attach a local image file", argsHint: "<path>", cliOnly: true },
  { name: "update", category: "Info", description: "Update Hermes Agent" },
  { name: "debug", category: "Info", description: "Upload a debug report" },
  { name: "quit", category: "Exit", description: "Exit the CLI", argsHint: "[--delete]", aliases: ["exit"], cliOnly: true },
  { name: "<skill-name>", category: "Dynamic", description: "Invoke any installed Hermes skill by name" },
];

export const CHAT_SLASH_COMMANDS: HermesSlashCommand[] = [
  ...DASHBOARD_SLASH_COMMANDS,
  ...HERMES_SLASH_COMMANDS,
];

export function filterChatSlashCommands(
  commands: readonly HermesSlashCommand[],
  query: string,
): readonly HermesSlashCommand[] {
  if (!commands.length) return [];
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return commands;
  const directMatches = commands.filter((command) => (
    command.name.toLowerCase().startsWith(cleanQuery)
    || command.aliases?.some((alias) => alias.toLowerCase().startsWith(cleanQuery))
  ));
  if (directMatches.length) return directMatches;
  const fuzzyMatches = commands.filter((command) => {
    const haystack = [
      command.name,
      command.description,
      command.category,
      command.argsHint ?? "",
      ...(command.aliases ?? []),
    ].join(" ").toLowerCase();
    return haystack.includes(cleanQuery);
  });
  return fuzzyMatches.length ? fuzzyMatches : commands;
}
