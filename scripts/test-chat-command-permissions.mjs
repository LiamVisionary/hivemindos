#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

async function source(path) {
  return readFile(join(root, path), "utf8");
}

function includes(text, needle, label) {
  assert.ok(text.includes(needle), `${label} should include ${needle}`);
}

const files = {
  commandTool: await source("src/lib/services/agent-shell/command-tool.ts"),
  permissionTypes: await source("src/lib/types/chat-permissions.ts"),
  route: await source("src/app/api/chat/agent-runtime/route.ts"),
  streamHttp: await source("src/app/api/chat/agent-runtime/stream-http-runtime.ts"),
  streamOpenai: await source("src/app/api/chat/agent-runtime/stream-openai-compatible.ts"),
  runtimeEvents: await source("src/lib/services/runtime-stream-events.ts"),
  statusHelpers: await source("src/features/dashboard/hooks/status-chat-input-helpers.ts"),
  chatPanelHelpers: await source("src/features/dashboard/views/chat/chat-panel-helpers.ts"),
  dashboardTypes: await source("src/features/dashboard/dashboard-types.ts"),
  messageThread: await source("src/features/dashboard/views/chat/exchange/MessageThread.tsx"),
  chatExchange: await source("src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx"),
  statusController: await source("src/features/dashboard/hooks/use-status-chat-input-controller.tsx"),
  composer: await source("src/features/chat/chat-composer.tsx"),
  chatCss: await source("src/app/chat.module.css"),
};

includes(files.permissionTypes, '"bypass"', "permission modes");
includes(files.permissionTypes, "Bypass permissions", "permission mode labels");
includes(files.permissionTypes, "chatPermissionModeAllowsUnlistedCommands", "permission helpers");

includes(files.commandTool, "blockedByPolicy?: boolean", "command tool result");
includes(files.commandTool, "permissionMode?: unknown", "command tool input");
includes(files.commandTool, "chatPermissionModeAllowsUnlistedCommands(permissionMode)", "command tool bypass gate");
includes(files.commandTool, "blockedByPolicy: true", "command tool policy block");
includes(files.commandTool, "Switch the chat composer to Bypass permissions or approve this command", "command tool user hint");
includes(files.commandTool, "execFileAsync(command, args", "command tool still avoids shell execution");

includes(files.runtimeEvents, 'APPROVAL: "chat.approval"', "runtime stream events");
includes(files.route, "permissionMode = normalizeChatPermissionMode(body.permissionMode)", "route request parsing");
includes(files.route, "permissionMode,", "route telemetry");
includes(files.route, "vaultPromptContext, permissionMode)", "route dispatch");
includes(files.streamHttp, "const normalizedPermissionMode = normalizeChatPermissionMode(permissionMode)", "HTTP runtime permission normalization");
includes(files.streamHttp, "normalizedPermissionMode", "HTTP runtime dispatch");

includes(files.streamOpenai, 'permissionMode: ChatPermissionMode = "manual"', "OpenAI-compatible permission input");
includes(files.streamOpenai, 'normalizedPermissionMode !== "plan"', "plan mode disables local command tools");
includes(files.streamOpenai, "commandApprovalEvent", "approval event builder");
includes(files.streamOpenai, "RUNTIME_STREAM_EVENT_TYPES.APPROVAL", "approval event emission");
includes(files.streamOpenai, 'approvalKind: "local_command"', "approval event kind");
includes(files.streamOpenai, 'label: "Approve once"', "approve once option");
includes(files.streamOpenai, 'permissionMode: "bypass"', "approve option bypasses once");
includes(files.streamOpenai, 'label: "Reject"', "reject option");
includes(files.streamOpenai, "if (toolRun.prompted)", "non-stream approval short-circuit");
includes(files.streamOpenai, "if (outcome.prompted)", "stream approval short-circuit");
includes(files.streamOpenai, '"agent_runtime.command_tool.permission_required"', "permission telemetry");

includes(files.statusHelpers, "permissionMode = String(choice.permissionMode", "runtime prompt keeps permission mode");
includes(files.statusHelpers, "/approval/i.test(type)", "approval prompt detection");
includes(files.chatPanelHelpers, "permissionMode: normalizeChatPermissionMode(record.permissionMode)", "stored prompt keeps permission mode");
includes(files.dashboardTypes, "permissionMode?: ChatPermissionMode", "chat message prompt type");
includes(files.messageThread, "sendPromptMessage(prompt, option.permissionMode", "prompt buttons send permission mode");
includes(files.statusController, "permissionMode: submittedPermissionMode", "composer form permission mode");
includes(files.statusController, "permissionMode,", "agent-runtime request permission mode");
includes(files.chatExchange, "choosePermissionMode", "chat exchange permission mode state");
includes(files.chatExchange, 'setAgentMode(normalized === "plan" ? "plan" : "act")', "permission plan syncs agent mode");

includes(files.composer, "CHAT_PERMISSION_MODE_OPTIONS.map", "composer permission menu");
includes(files.composer, 'name="permissionMode"', "composer hidden permission input");
includes(files.composer, "composerPermissionButton", "composer permission chip");
includes(files.composer, "ShieldCheck", "composer permission icon");
includes(files.chatCss, ".composerPermissionButton", "permission chip CSS");
includes(files.chatCss, ".permissionModeTooltip", "permission menu CSS");
includes(files.chatCss, ".permissionModeList kbd", "permission shortcuts CSS");

console.log("chat command permission checks passed");
