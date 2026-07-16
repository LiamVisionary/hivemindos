import { captureObsidianNote } from "@/lib/services/obsidian/note-capture";
import { processBrainDropCapture } from "@/lib/services/brain/brain-drop-intake";
import { discoverQueenBeeFleetSnapshot } from "@/lib/services/queen-bee/fleet-snapshot";
import { submitQueenBeeMessage } from "@/lib/services/queen-bee/control-plane";
import { runQueenBeeAgentTurn } from "@/lib/services/queen-bee/voice-turn";

type BrainCaptureAction = {
  kind: "brain-capture";
  actionId: string;
  text: string;
  createdAt?: string;
  inputMode?: "voice" | "text" | "share";
};

type TaskCaptureAction = {
  kind: "task-capture";
  actionId: string;
  text: string;
  createdAt?: string;
};

type QueenQueryAction = {
  kind: "queen-query";
  actionId: string;
  query: "ask" | "daily-brief";
  text?: string;
};

export type PhoneShortcutAction = BrainCaptureAction | TaskCaptureAction | QueenQueryAction;

const MAX_TEXT_CHARS = 100_000;
const DAILY_BRIEF_PROMPT =
  "Give me a concise spoken daily Hive briefing: the most important active work, blockers, pending approvals, and the single best next action.";

function requiredActionId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 80 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("A valid shortcut action id is required.");
  }
  return id;
}

function requiredText(value: unknown, label = "Shortcut text") {
  const text = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > MAX_TEXT_CHARS) throw new Error(`${label} is too large.`);
  return text;
}

function optionalCreatedAt(value: unknown) {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("Shortcut createdAt must be an ISO date.");
  }
  return new Date(value).toISOString();
}

export function parsePhoneShortcutAction(body: unknown): PhoneShortcutAction {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Shortcut action body is invalid.");
  }
  const input = body as Record<string, unknown>;
  if (input.action !== "shortcut-action") throw new Error("Shortcut action is invalid.");
  const actionId = requiredActionId(input.actionId);
  const createdAt = optionalCreatedAt(input.createdAt);
  if (input.kind === "brain-capture") {
    const inputMode = input.inputMode === "voice" || input.inputMode === "share" ? input.inputMode : "text";
    return {
      kind: "brain-capture",
      actionId,
      text: requiredText(input.text),
      ...(createdAt ? { createdAt } : {}),
      ...(input.inputMode == null ? {} : { inputMode }),
    };
  }
  if (input.kind === "task-capture") {
    return {
      kind: "task-capture",
      actionId,
      text: requiredText(input.text),
      ...(createdAt ? { createdAt } : {}),
    };
  }
  if (input.kind === "queen-query") {
    const query = input.query === "daily-brief" ? "daily-brief" : "ask";
    return {
      kind: "queen-query",
      query,
      actionId,
      ...(query === "ask" ? { text: requiredText(input.text, "A Queen Bee question") } : {}),
    };
  }
  throw new Error("Shortcut action kind is unsupported.");
}

export function shortcutQueenPrompt(action: QueenQueryAction) {
  return action.query === "daily-brief" ? DAILY_BRIEF_PROMPT : requiredText(action.text, "A Queen Bee question");
}

type ShortcutDependencies = {
  captureNote: typeof captureObsidianNote;
  processCapture: typeof processBrainDropCapture;
  discoverFleet: typeof discoverQueenBeeFleetSnapshot;
  submitTask: typeof submitQueenBeeMessage;
  runQueenTurn: typeof runQueenBeeAgentTurn;
};

const defaultDependencies: ShortcutDependencies = {
  captureNote: captureObsidianNote,
  processCapture: processBrainDropCapture,
  discoverFleet: discoverQueenBeeFleetSnapshot,
  submitTask: submitQueenBeeMessage,
  runQueenTurn: runQueenBeeAgentTurn,
};

export async function runPhoneShortcutAction(input: {
  body: unknown;
  origin: string;
  deviceToken?: string | null;
  dependencies?: ShortcutDependencies;
}) {
  const action = parsePhoneShortcutAction(input.body);
  const dependencies = input.dependencies ?? defaultDependencies;
  if (action.kind === "brain-capture") {
    const note = await dependencies.captureNote({
      content: action.text,
      now: action.createdAt ? new Date(action.createdAt) : undefined,
      source: "iphone-shortcut",
      tags: [
        "hivemindos-note",
        "iphone-shortcut",
        action.inputMode === "voice" ? "voice-input" : action.inputMode === "share" ? "shared-input" : "text-input",
      ],
      idempotencyKey: action.actionId,
    });
    try {
      const processing = await dependencies.processCapture({
        vaultPath: note.vaultPath,
        capture: note,
        content: action.text,
        source: "iphone-shortcut",
        inputTags: [
          "iphone-shortcut",
          action.inputMode === "voice" ? "voice-input" : action.inputMode === "share" ? "shared-input" : "text-input",
        ],
      });
      return { kind: action.kind, note, processing };
    } catch (error) {
      return {
        kind: action.kind,
        note,
        processing: {
          status: "pending-retry" as const,
          error: error instanceof Error ? error.message : "Brain Drop processing failed.",
        },
      };
    }
  }
  if (action.kind === "task-capture") {
    const fleetSnapshot = await dependencies.discoverFleet(input.origin, input.deviceToken ?? null);
    const result = await dependencies.submitTask({
      message: action.text,
      taskTitle: action.text.split("\n").find(Boolean)?.slice(0, 120),
      source: `iphone-shortcut:${action.actionId}`,
      mode: "act",
      fleetSnapshot,
    });
    return { kind: action.kind, ...result };
  }
  const result = await dependencies.runQueenTurn(input.origin, shortcutQueenPrompt(action), undefined, {
    preferBuiltInCapability: true,
  });
  return { kind: action.kind, text: result.speech, detail: result.detail };
}
