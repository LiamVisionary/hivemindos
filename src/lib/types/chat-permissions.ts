export const CHAT_PERMISSION_MODES = ["manual", "accept-edits", "plan", "auto", "bypass"] as const;

export type ChatPermissionMode = typeof CHAT_PERMISSION_MODES[number];

export type ChatPermissionModeOption = {
  mode: ChatPermissionMode;
  label: string;
  detail: string;
  shortcut: string;
};

export const CHAT_PERMISSION_MODE_OPTIONS: ChatPermissionModeOption[] = [
  {
    mode: "manual",
    label: "Manual permissions",
    detail: "Ask before commands outside the local allowlist.",
    shortcut: "1",
  },
  {
    mode: "accept-edits",
    label: "Accept edits",
    detail: "Let ordinary edit-style work continue, but ask for unusual commands.",
    shortcut: "2",
  },
  {
    mode: "plan",
    label: "Plan mode",
    detail: "Think and propose steps without executing local command actions.",
    shortcut: "3",
  },
  {
    mode: "auto",
    label: "Auto mode",
    detail: "Run allowlisted local tools without extra prompts.",
    shortcut: "4",
  },
  {
    mode: "bypass",
    label: "Bypass permissions",
    detail: "Run local command tools without the executable allowlist prompt.",
    shortcut: "5",
  },
];

const CHAT_PERMISSION_MODE_SET = new Set<string>(CHAT_PERMISSION_MODES);

export function normalizeChatPermissionMode(value: unknown): ChatPermissionMode {
  const mode = String(value ?? "").trim();
  return CHAT_PERMISSION_MODE_SET.has(mode) ? mode as ChatPermissionMode : "manual";
}

export function chatPermissionModeAllowsUnlistedCommands(mode: ChatPermissionMode) {
  return mode === "bypass";
}

export function chatPermissionModeLabel(mode: ChatPermissionMode) {
  return CHAT_PERMISSION_MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? "Manual permissions";
}
