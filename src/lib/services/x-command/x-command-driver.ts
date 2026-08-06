import "server-only";

import { runQueenChatTurn } from "@/lib/services/queen-bee/typed-chat-turn";
import { completeXCommandDeviceJob, pollXCommandDevice, responseObject, type XCommandDeviceJob } from "./x-command-client";
import { readXCommandDevice } from "./x-command-device-vault";
import { executeXCommandTrade } from "./x-command-trade-executor";
import { readXCommandWalletPolicy } from "./x-command-wallet-policy";

type DriverState = {
  running: boolean;
  busy: boolean;
  timer: ReturnType<typeof setInterval> | null;
  startedAt: string | null;
  lastPollAt: string | null;
  lastCompletedAt: string | null;
  lastJobId: string | null;
  error: string;
};

const globalKey = "__hivemindosXCommandDriver";
const X_TRADE_JOB_MAX_AGE_MS = 5 * 60_000;
const globals = globalThis as typeof globalThis & { [globalKey]?: DriverState };
const state: DriverState = globals[globalKey] ?? {
  running: false,
  busy: false,
  timer: null,
  startedAt: null,
  lastPollAt: null,
  lastCompletedAt: null,
  lastJobId: null,
  error: "",
};
globals[globalKey] = state;

function status() {
  return {
    running: state.running,
    busy: state.busy,
    startedAt: state.startedAt,
    lastPollAt: state.lastPollAt,
    lastCompletedAt: state.lastCompletedAt,
    lastJobId: state.lastJobId,
    error: state.error,
  };
}

async function runReadOnlyQueen(job: XCommandDeviceJob, origin: string): Promise<string> {
  const intentInstruction = job.intent === "token-analysis"
    ? "This is token due diligence. Separate evidence from promotional claims, name downside risks, do not invent live market or onchain data, and do not present personalized financial advice."
    : job.intent === "post-analysis"
      ? "Assess the post's central claim, evidence, missing context, incentives, and what would change the conclusion. Separate confirmed facts from inference."
      : "Answer the user's question directly.";
  const response = await runQueenChatTurn({
    action: "chat-turn",
    toolChoice: "none",
    suppressWalletIntents: true,
    messages: [
      {
        role: "system",
        content: [
          "This request reached the user's own HivemindOS Queen through their explicitly paired X command channel.",
          "This lane is read-only. Do not call tools, spend, post, message, mutate files, or claim that an external action occurred.",
          intentInstruction,
          "Keep the final answer concise enough to review in a command dashboard.",
        ].join(" "),
      },
      { role: "user", content: job.prompt || "" },
    ],
  }, origin);
  const payload = await response.json().catch(() => null) as { ok?: boolean; content?: string; error?: string } | null;
  const content = payload?.content?.trim() || "";
  if (!response.ok || payload?.ok === false || !content) throw new Error(payload?.error || "The local Queen returned no answer.");
  return content.slice(0, 8_000);
}

export async function pulseXCommandDriver(origin: string): Promise<ReturnType<typeof status>> {
  if (state.busy) return status();
  state.busy = true;
  state.lastPollAt = new Date().toISOString();
  try {
    const credential = await readXCommandDevice();
    if (!credential) {
      state.error = "No local Queen device is paired.";
      stopXCommandDriver();
      return status();
    }
    const tradeExecutionEnabled = await readXCommandWalletPolicy()
      .then((policy) => policy?.enabled === true)
      .catch(() => false);
    const response = await pollXCommandDevice(credential.token, { tradeExecutionEnabled });
    const payload = await responseObject(response);
    if (!response.ok || payload.ok === false) throw new Error(typeof payload.error === "string" ? payload.error : `Queen poll HTTP ${response.status}`);
    const job = payload.job && typeof payload.job === "object" && !Array.isArray(payload.job)
      ? payload.job as XCommandDeviceJob
      : null;
    if (!job) {
      state.error = "";
      return status();
    }
    state.lastJobId = job.id;
    try {
      let resultText: string;
      if (job.kind === "trade.execute") {
        if (!job.tradeRequest) throw new Error("The X trade job is missing its typed trade request.");
        const createdAtMs = Date.parse(job.createdAt);
        if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > X_TRADE_JOB_MAX_AGE_MS) {
          throw new Error("This X trade request expired before local execution. No order was submitted.");
        }
        resultText = await executeXCommandTrade({ jobId: job.id, tradeRequest: job.tradeRequest });
      } else {
        resultText = await runReadOnlyQueen(job, origin);
      }
      const completed = await completeXCommandDeviceJob(credential.token, job.id, { resultText });
      if (!completed.ok) throw new Error(`Queen completion HTTP ${completed.status}`);
    } catch (error) {
      await completeXCommandDeviceJob(credential.token, job.id, {
        error: error instanceof Error ? error.message : "The local Queen could not answer.",
      }).catch(() => undefined);
      throw error;
    }
    state.lastCompletedAt = new Date().toISOString();
    state.error = "";
  } catch (error) {
    state.error = error instanceof Error ? error.message : "The X command Queen bridge failed.";
  } finally {
    state.busy = false;
  }
  return status();
}

export function startXCommandDriver(origin: string) {
  if (state.running) return status();
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.error = "";
  state.timer = setInterval(() => void pulseXCommandDriver(origin), 5_000);
  state.timer.unref?.();
  void pulseXCommandDriver(origin);
  return status();
}

export function stopXCommandDriver() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.running = false;
  state.busy = false;
  return status();
}

export function xCommandDriverStatus() {
  return status();
}
