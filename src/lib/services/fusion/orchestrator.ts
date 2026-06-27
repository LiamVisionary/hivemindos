import {
  SYNTHESIZER_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  analysisSummary,
  buildJudgeUserPrompt,
  buildSynthesizerUserPrompt,
  extractQuestion,
  parseJudgeAnalysis,
} from "./prompts";
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

  for (const member of plan.participants) emit({ type: "member.start", id: member.id, label: member.label });
  const settled = await Promise.all(
    plan.participants.map((member) =>
      runMember(call, member, panelMessages, input.signal).then((result) => {
        emit({
          type: "member.done",
          id: result.member.id,
          label: result.member.label,
          ok: result.ok,
          chars: result.text.length,
          latencyMs: result.latencyMs,
          error: result.error,
        });
        return result;
      }),
    ),
  );

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
      const judgeResult = await call(
        plan.judge,
        [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          { role: "user", content: buildJudgeUserPrompt(question, succeeded) },
        ],
        { signal: input.signal, timeoutMs: JUDGE_TIMEOUT_MS, temperature: 0 },
      );
      analysis = parseJudgeAnalysis(judgeResult.text);
      judged = true;
      emit({ type: "judge.done", analysis });
      const summary = analysisSummary(analysis);
      if (summary) emit({ type: "reasoning", delta: `${summary}\n` });
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
