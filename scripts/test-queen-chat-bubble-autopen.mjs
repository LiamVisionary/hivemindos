import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const fail = (message) => {
  throw new Error(message);
};
const includes = (haystack, needle, label) => {
  if (!haystack.includes(needle)) fail(`${label}: expected ${needle}`);
};
const excludes = (haystack, needle, label) => {
  if (haystack.includes(needle)) fail(`${label}: did not expect ${needle}`);
};

const store = read("src/features/queen-voice/queen-chat-store.tsx");
const pill = read("src/components/fleet-hive/ChatPill.tsx");
const persistent = read("src/features/queen-voice/PersistentHiveChat.tsx");
const overlay = read("src/features/queen-voice/QueenBeeVoiceOverlay.tsx");
const css = read("src/components/fleet-hive/fleet-hive.css");

includes(store, "const QUEEN_CHAT_RECENT_MESSAGE_HOLD_MS = 7000;", "recent hold duration");
includes(store, "React.useState(true)", "history starts collapsed for auto-open behavior");
includes(store, "const [composerActive, setComposerActive] = React.useState(false);", "composer activity state");
includes(store, "const [transcriptInteractionActive, setTranscriptInteractionActive] = React.useState(false);", "transcript interaction state");
includes(store, "const [recentMessageOpen, setRecentMessageOpen] = React.useState(false);", "recent activity state");
includes(store, "function isAutoOpenAgentTurn(turn: QueenChatTurn): boolean", "active agent turn helper");
includes(store, "const agentActivityOpen = Boolean(activeAgentTurn && dismissedAutoOpenTurnId !== activeAgentTurn.id);", "agent thinking keeps transcript open unless manually dismissed");
includes(store, "|| transcriptInteractionActive", "transcript interaction keeps bubble open");
includes(store, "|| agentActivityOpen", "active agent work keeps bubble open");
includes(store, "setDismissedAutoOpenTurnId(findAutoOpenDismissalTurnId(turnsRef.current));", "manual collapse suppresses current auto-open turn");
includes(store, "const closeTimer = window.setTimeout(() => {", "seven-second timeout is scheduled");
includes(store, "}, QUEEN_CHAT_RECENT_MESSAGE_HOLD_MS);", "seven-second timeout duration");
includes(store, "clearRecentMessageHold();", "manual close clears recent hold");
excludes(store, "// A fresh typed send always re-opens the history above the input.", "typed send no longer pins transcript open");

includes(pill, "onComposerActiveChange?: (active: boolean) => void;", "pill reports composer activity");
includes(pill, "onPointerEnter={() => setInputHovered(true)}", "hover opens bubble");
includes(pill, "onPointerLeave={() => setInputHovered(false)}", "hover release closes when no other hold exists");
includes(pill, "const blurInput = () => {", "blur handler clears transient input holds");
includes(pill, "setInputHovered(false);", "blur drops hover hold so expired recent messages close immediately");
includes(pill, "onBlur={blurInput}", "input blur uses immediate close handler");
includes(pill, "onComposerActiveChange?.(inputFocused || inputHovered);", "focus keeps bubble open");

includes(persistent, "const showExpandTab = queenChat.turns.length > 0 && !queenChat.transcriptExpanded;", "tab only shows when transcript actually collapsed");
includes(persistent, "onComposerActiveChange={queenChat.setComposerActive}", "persistent pill wires composer activity into store");
includes(overlay, "onInteractionActiveChange: (active: boolean) => void;", "transcript reports interaction hold");
includes(overlay, "const voiceThinking = open && voiceState.phase === \"thinking\";", "voice thinking is a keep-open reason");
includes(overlay, "setVoiceChatActive(open);", "voice overlay publishes active voice-chat routing state");
includes(overlay, "minimized={!(chat.transcriptExpanded || voiceThinking)}", "overlay uses effective expansion plus voice thinking");
includes(overlay, "onInteractionActiveChange={setTranscriptInteractionActive}", "overlay wires interaction hold into store");
includes(overlay, "onPointerDown={handlePointerDown}", "pointer down keeps bubble open while selecting text");
includes(overlay, "window.addEventListener(\"pointerup\", finishSelection);", "selection hold releases after pointerup");
includes(overlay, "const hasSelectionInsideTranscript = React.useCallback(() => {", "transcript detects selected text");
includes(overlay, "document.addEventListener(\"selectionchange\", refreshTextSelection);", "selected text keeps bubble open after drag release");
includes(css, "cubic-bezier(.18, .9, .22, 1.18)", "pill width uses spring-like easing");

console.log("queen chat bubble auto-open contract ok");
