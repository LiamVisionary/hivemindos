import {
  SYNTHESIZER_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  analysisSummary,
  buildJudgeUserPrompt,
  buildSynthesizerUserPrompt,
  extractQuestion,
  parseJudgeAnalysis,
} from "./prompts";
import { numberEnv } from "@/lib/config/env";
import type { FusionAgentConfig } from "@/lib/types/agent-runtime";
import type {
  FusionAnalysis,
  FusionCaller,
  FusionEvent,
  FusionMessage,
  FusionParticipantResult,
  FusionPlan,
  FusionRunMeta,
  FusionStreamer,
  PlanResolver,
  ResolvedFusionMember,
} from "./types";

export type RunFusionInput = {
  messages: FusionMessage[];
  config?: FusionAgentConfig;
  model?: string;
  /** System prompt to prepend (agent persona). */
  systemPrompt?: string;
  signal?: AbortSignal;
  emit: (event: FusionEvent) => void;
  /** Injection points (default to the real implementations); used by tests. */
  resolvePlan?: PlanResolver;
  call?: FusionCaller;
  stream?: FusionStreamer;
};

export type RunFusionResult = {
  finalText: string;
  analysis: FusionAnalysis | null;
  results: FusionParticipantResult[];
  meta: FusionRunMeta;
};

const JUDGE_TIMEOUT_MS = 60_000;
const MEMBER_TIMEOUT_MS = 90_000;
/** Successful panel responses that count as quorum (the judge accepts >=2). */
const PANEL_QUORUM_SUCCESSES = 2;
/** How long stragglers get after quorum before the panel releases without them. */
const PANEL_STRAGGLER_GRACE_MS = 15_000;

function withSystem(systemPrompt: string | undefined, messages: FusionMessage[]): FusionMessage[] {
  const trimmed = systemPrompt?.trim();
  if (!trimmed) return messages;
  // Merge the persona into a leading string system message rather than dropping
  // it; for any other shape, prepend the persona as its own system message.
  if (messages[0]?.role === "system" && typeof messages[0].content === "string") {
    const existing = messages[0].content;
    const merged = existing ? `${trimmed}\n\n${existing}` : trimmed;
    return [{ role: "system", content: merged }, ...messages.slice(1)];
  }
  return [{ role: "system", content: trimmed }, ...messages];
}

function planMeta(plan: FusionPlan, results: FusionParticipantResult[], judged: boolean): FusionRunMeta {
  return {
    mode: plan.mode,
    panel: results.length
      ? results.map((result) => ({ id: result.member.id, label: result.member.label, ok: result.ok, latencyMs: result.latencyMs }))
      : plan.participants.map((member) => ({ id: member.id, label: member.label, ok: false, latencyMs: 0 })),
    judge: plan.judge?.label ?? null,
    synthesizer: plan.synthesizer.label,
    participantsSucceeded: results.filter((result) => result.ok).length,
    participantsTotal: plan.participants.length,
    judged,
    notes: plan.notes,
  };
}

/** Run a single panel member, capturing timing and errors. */
async function runMember(
  call: FusionCaller,
  member: ResolvedFusionMember,
  messages: FusionMessage[],
  signal: AbortSignal | undefined,
): Promise<FusionParticipantResult> {
  const startedAt = Date.now();
  try {
    const result = await call(member, messages, { signal, timeoutMs: MEMBER_TIMEOUT_MS });
    const text = result.text.trim();
    return {
      member,
      ok: Boolean(text),
      text,
      reasoning: result.reasoning,
      error: text ? undefined : "Model returned an empty response.",
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      member,
      ok: false,
      text: "",
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
    };
  }
}

/**
 * Fan out to the panel, releasing the barrier at quorum: once >=2 members
 * succeed (or all-but-one settled with at least one success — requiring one
 * success keeps a slow sole survivor from being cut into a guaranteed
 * all-fail), stragglers get a bounded grace window instead of holding the
 * user-facing answer for the full member timeout + retry (~181s). Unfinished
 * members are marked timed-out (ok:false) in both their member.done event and
 * the returned results, so participantsSucceeded/participantsTotal stay
 * honest. A straggler that resolves after release is swallowed — its
 * member.done was already emitted as timed-out, so emitting again would break
 * the one-member.done-per-member contract.
 */
async function runPanelWithQuorumRelease(
  call: FusionCaller,
  participants: ResolvedFusionMember[],
  messages: FusionMessage[],
  signal: AbortSignal | undefined,
  emit: (event: FusionEvent) => void,
): Promise<FusionParticipantResult[]> {
  const graceMs = Math.max(0, numberEnv("HIVEMINDOS_FUSION_STRAGGLER_GRACE_MS", PANEL_STRAGGLER_GRACE_MS));
  const startedAt = Date.now();
  const settled: Array<FusionParticipantResult | undefined> = participants.map(() => undefined);
  let released = false;

  for (const member of participants) emit({ type: "member.start", id: member.id, label: member.label });

  const pending = participants.map((member, index) =>
    runMember(call, member, messages, signal).then((result) => {
      if (released) return;
      settled[index] = result;
      emit({
        type: "member.done",
        id: result.member.id,
        label: result.member.label,
        ok: result.ok,
        chars: result.text.length,
        latencyMs: result.latencyMs,
        error: result.error,
      });
    }),
  );

  await new Promise<void>((resolve) => {
    let settledCount = 0;
    let successCount = 0;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      resolve();
    };
    const onSettled = (ok: boolean) => {
      settledCount += 1;
      if (ok) successCount += 1;
      if (settledCount >= participants.length) {
        release();
        return;
      }
      const quorum =
        successCount >= PANEL_QUORUM_SUCCESSES ||
        (settledCount >= participants.length - 1 && successCount >= 1);
      if (quorum && graceTimer === undefined) graceTimer = setTimeout(release, graceMs);
    };
    for (let i = 0; i < pending.length; i += 1) {
      // The assignment handler above runs first on the same chain, so
      // settled[i] is populated by the time this counts it. Count rejections
      // too: emit can throw (the SSE controller throws on enqueue once the
      // client disconnects mid-panel), which rejects the chain AFTER
      // settled[i] was assigned — without the rejection arm the barrier
      // never resolves, runFusion hangs forever, and route-stream's finally
      // never finalizes the runtime chat session.
      const countSettled = () => onSettled(Boolean(settled[i]?.ok));
      void pending[i].then(countSettled, countSettled);
    }
  });
  released = true;

  return participants.map((member, index) => {
    const result = settled[index];
    if (result) return result;
    const timedOut: FusionParticipantResult = {
      member,
      ok: false,
      text: "",
      error: `Panel released at quorum; no response within the ${graceMs}ms straggler grace.`,
      latencyMs: Date.now() - startedAt,
    };
    emit({
      type: "member.done",
      id: member.id,
      label: member.label,
      ok: false,
      chars: 0,
      latencyMs: timedOut.latencyMs,
      error: timedOut.error,
    });
    return timedOut;
  });
}

/**
 * Orchestrate a Hive Fusion run: fan out to the panel, judge the responses,
 * then stream a synthesized answer. Returns the final text plus metadata.
 * Emits high-level FusionEvents the caller maps to its transport.
 */
export async function runFusion(input: RunFusionInput): Promise<RunFusionResult> {
  // Catalog/client are imported lazily so the orchestrator's control flow can be
  // unit-tested with injected fakes without loading server-only modules.
  const resolvePlan = input.resolvePlan ?? (await import("./catalog")).resolveFusionPlan;
  const call = input.call ?? (await import("./client")).callFusionCompletion;
  const stream = input.stream ?? (await import("./client")).streamFusionCompletion;
  const emit = input.emit;

  const plan = await resolvePlan({ config: input.config, model: input.model, messages: input.messages });
  const question = extractQuestion(input.messages);

  // Hosted OpenRouter Fusion: proxy the single compound-model call straight through.
  if (plan.mode === "openrouter") {
    const member = plan.synthesizer;
    const meta = planMeta(plan, [], false);
    emit({ type: "plan", plan: meta });
    emit({ type: "synth.start", label: member.label });
    let finalText = "";
    try {
      const result = await stream(member, withSystem(input.systemPrompt, input.messages), {
        signal: input.signal,
        onDelta: (delta) => {
          finalText += delta;
          emit({ type: "synth.delta", delta });
        },
        onReasoning: (delta) => emit({ type: "reasoning", delta }),
        // OpenRouter's hosted Fusion is configured via the `plugins` array, not a
        // top-level `fusion` object: `analysis_models` overrides the panel and
        // `model` is the judge/final-answer model (it does double duty).
        extraBody: input.config?.participants?.length || input.config?.synthesizer
          ? {
              plugins: [
                {
                  id: "fusion",
                  ...(input.config?.participants?.length ? { analysis_models: input.config.participants.map((p) => p.model) } : {}),
                  ...(input.config?.synthesizer ? { model: input.config.synthesizer.model } : {}),
                },
              ],
            }
          : undefined,
      });
      finalText = result.text || finalText;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: "error", error: message });
      throw error instanceof Error ? error : new Error(message);
    }
    emit({ type: "done", meta, finalText });
    return { finalText, analysis: null, results: [], meta };
  }

  // Native panel.
  emit({ type: "plan", plan: planMeta(plan, [], false) });
  const panelMessages = withSystem(input.systemPrompt, input.messages);

  const settled = await runPanelWithQuorumRelease(call, plan.participants, panelMessages, input.signal, emit);

  const succeeded = settled.filter((result) => result.ok);
  if (!succeeded.length) {
    const reasons = settled.map((result) => `${result.member.label}: ${result.error ?? "no output"}`).join("; ");
    const message = `Every Fusion panel model failed. ${reasons}`;
    emit({ type: "error", error: message });
    throw new Error(message);
  }

  // Judge: structure the panel only when there is something to compare.
  let analysis: FusionAnalysis | null = null;
  let judged = false;
  if (plan.judge && succeeded.length >= 2) {
    emit({ type: "judge.start", label: plan.judge.label });
    try {
      const judgeMessages: FusionMessage[] = [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: buildJudgeUserPrompt(question, succeeded) },
      ];
      const judgeOptions = { signal: input.signal, timeoutMs: JUDGE_TIMEOUT_MS, temperature: 0 };
      let judgeText = (await call(plan.judge, judgeMessages, judgeOptions)).text;
      let parsed = parseJudgeAnalysis(judgeText);
      // `raw` is only set when the reply fell back to unparseable prose (an
      // empty reply falls back too, with raw undefined — hence the trim check).
      // Retry exactly once with a corrective nudge before giving up.
      if (parsed.raw !== undefined || !judgeText.trim()) {
        judgeText = (
          await call(
            plan.judge,
            [
              ...judgeMessages,
              { role: "assistant", content: judgeText },
              { role: "user", content: "Return ONLY the JSON object described above — no prose, no markdown fences." },
            ],
            judgeOptions,
          )
        ).text;
        parsed = parseJudgeAnalysis(judgeText);
      }
      if (parsed.raw !== undefined || !judgeText.trim()) {
        // The judging stage did not actually happen; leave judged=false so
        // meta and telemetry stay honest instead of reporting prose as analysis.
        emit({ type: "judge.skipped", reason: "Judge did not return parseable JSON after a retry; synthesizing without cross-response analysis." });
      } else {
        analysis = parsed;
        judged = true;
        emit({ type: "judge.done", analysis });
        const summary = analysisSummary(analysis);
        if (summary) emit({ type: "reasoning", delta: `${summary}\n` });
      }
    } catch (error) {
      emit({ type: "judge.skipped", reason: error instanceof Error ? error.message : String(error) });
    }
  } else if (succeeded.length < 2) {
    emit({ type: "judge.skipped", reason: "Only one panel response succeeded; skipping cross-response analysis." });
  }

  // Synthesize the final answer (streamed).
  emit({ type: "synth.start", label: plan.synthesizer.label });
  let finalText = "";
  let synthStreamed = false;
  try {
    const result = await stream(
      plan.synthesizer,
      [
        { role: "system", content: SYNTHESIZER_SYSTEM_PROMPT },
        { role: "user", content: buildSynthesizerUserPrompt(question, succeeded, analysis) },
      ],
      {
        signal: input.signal,
        onDelta: (delta) => {
          synthStreamed = true;
          finalText += delta;
          emit({ type: "synth.delta", delta });
        },
      },
    );
    finalText = result.text || finalText;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (synthStreamed) {
      // Partial synthesis already streamed to the client. Appending another full
      // answer would concatenate onto it, so keep the partial and note the break.
      emit({ type: "reasoning", delta: `\n_Synthesis was interrupted (${reason}); showing the partial answer._\n` });
    } else {
      // Nothing streamed yet: fall back to the strongest panel answer if any.
      const best = [...succeeded].sort((a, b) => b.text.length - a.text.length)[0];
      if (best) {
        finalText = best.text;
        emit({ type: "synth.delta", delta: finalText });
        emit({ type: "reasoning", delta: `\n_Synthesizer unavailable (${reason}); returned the strongest panel answer._\n` });
      } else {
        emit({ type: "error", error: reason });
        throw error instanceof Error ? error : new Error(reason);
      }
    }
  }

  const meta = planMeta(plan, settled, judged);
  emit({ type: "done", meta, finalText });
  return { finalText, analysis, results: settled, meta };
}
