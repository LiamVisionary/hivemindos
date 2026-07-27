import { runBrowserUse } from "@/lib/services/browser-use-runner";
import { createComputerInteractionObservation } from "./policy";
import type {
  ComputerInteractionAction,
  ComputerInteractionActionResult,
  ComputerInteractionAdapter,
  ComputerInteractionAdapterId,
  ComputerInteractionRun,
} from "./types";

function integerParam(action: ComputerInteractionAction, key: string) {
  const value = action.params[key];
  if (!Number.isInteger(value)) throw new Error(`${key} is required for ${action.kind}.`);
  return Number(value);
}

function stringParam(action: ComputerInteractionAction, key: string) {
  const value = action.params[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required for ${action.kind}.`);
  return value.trim();
}

function browserSession(run: ComputerInteractionRun) {
  return run.adapterContext?.browserSession;
}

function browserUseInput(
  action: ComputerInteractionAction,
  run: ComputerInteractionRun,
): Parameters<typeof runBrowserUse>[0] | null {
  const session = browserSession(run);
  switch (action.kind) {
    case "open":
    case "navigate":
      return { action: "open", url: stringParam(action, "url"), session };
    case "click":
      return { action: "click", index: integerParam(action, "index"), session };
    case "input":
      return { action: "input", index: integerParam(action, "index"), text: stringParam(action, "text"), session };
    case "type":
      return { action: "type", text: stringParam(action, "text"), session };
    case "select":
      return { action: "select", index: integerParam(action, "index"), text: stringParam(action, "text"), session };
    case "scroll":
      return {
        action: "scroll",
        direction: action.params.direction === "up" ? "up" : "down",
        amount: Number.isInteger(action.params.amount) ? Number(action.params.amount) : undefined,
        session,
      };
    case "upload":
      return { action: "upload", index: integerParam(action, "index"), path: stringParam(action, "path"), session };
    case "screenshot":
      return { action: "screenshot", path: typeof action.params.path === "string" ? action.params.path : undefined, session };
    case "eval":
      return { action: "eval", script: stringParam(action, "script"), session };
    case "complete":
      return null;
    default:
      throw new Error(`Browser Use does not implement ${action.kind}; select a semantic, DOM, or reported adapter.`);
  }
}

async function browserObservation(
  adapter: "browser-use" | "screenshot",
  run: ComputerInteractionRun,
  sequence: number,
) {
  const session = browserSession(run);
  const urlResult = await runBrowserUse({ action: "current-url", session });
  const stateResult = await runBrowserUse({ action: "state", session });
  return createComputerInteractionObservation({
    adapter,
    sequence,
    capturedAt: Date.parse(stateResult.finishedAt) || Date.now(),
    url: urlResult.stdout.replace(/^result:\s*/i, "").trim(),
    content: stateResult.stdout,
    evidence: [stateResult.logPath],
  });
}

export function createBrowserUseComputerInteractionAdapter(): ComputerInteractionAdapter {
  let sequence = 0;
  return {
    id: "browser-use",
    async observe({ run }) {
      sequence = Math.max(sequence + 1, (run.latestObservation?.sequence ?? 0) + 1);
      return browserObservation("browser-use", run, sequence);
    },
    async act({ run, action }): Promise<ComputerInteractionActionResult> {
      const input = browserUseInput(action, run);
      if (!input) return { ok: true, summary: "The browser interaction run reached its requested completion point." };
      const result = await runBrowserUse(input);
      return {
        ok: true,
        summary: `Browser Use ${result.action} completed.`,
        evidence: [result.logPath],
      };
    },
  };
}

export function createScreenshotComputerInteractionAdapter(): ComputerInteractionAdapter {
  let sequence = 0;
  return {
    id: "screenshot",
    async observe({ run }) {
      sequence = Math.max(sequence + 1, (run.latestObservation?.sequence ?? 0) + 1);
      return browserObservation("screenshot", run, sequence);
    },
    async act({ run, action }) {
      if (action.kind === "complete") return { ok: true, summary: "The screenshot-assisted interaction reached its requested completion point." };
      if (action.kind !== "screenshot") throw new Error("The screenshot fallback only accepts screenshot or complete actions.");
      const result = await runBrowserUse({
        action: "screenshot",
        path: typeof action.params.path === "string" ? action.params.path : undefined,
        session: browserSession(run),
      });
      return { ok: true, summary: "A fresh browser screenshot was captured.", evidence: [result.logPath] };
    },
  };
}

export function createReportedComputerInteractionAdapter(id: Exclude<ComputerInteractionAdapterId, "browser-use" | "screenshot">): ComputerInteractionAdapter {
  return {
    id,
    async observe() {
      throw new Error(`${id} observations must be reported by the client surface that owns that interaction.`);
    },
    async act() {
      throw new Error(`${id} actions must include a client-reported result after the owning surface executes them.`);
    },
  };
}
