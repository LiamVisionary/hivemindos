import type { FusionMode } from "@/lib/types/agent-runtime";

export type { FusionMemberSpec, FusionMode } from "@/lib/types/agent-runtime";

/** OpenAI-compatible chat message, as posted by the dashboard chat send path. */
export type FusionMessage = {
  role: string;
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        image_url?: { url?: string };
        file?: { filename?: string; file_data?: string };
      }>;
};

/** A panel member resolved to a concrete, callable OpenAI-compatible endpoint. */
export type ResolvedFusionMember = {
  /** Stable id, e.g. "openrouter:deepseek/deepseek-chat". */
  id: string;
  /** Human label shown in the UI, e.g. "DeepSeek V4 (OpenRouter)". */
  label: string;
  /** Fusion catalog provider slug. */
  provider: string;
  model: string;
  /** Base URL WITHOUT trailing slash; "/chat/completions" is appended at call time. */
  baseUrl: string;
  /** Bearer token; "" for keyless local endpoints. */
  apiKey: string;
  headers?: Record<string, string>;
};

/** The fully resolved plan for one Fusion run. */
export type FusionPlan = {
  mode: FusionMode;
  participants: ResolvedFusionMember[];
  judge: ResolvedFusionMember | null;
  synthesizer: ResolvedFusionMember;
  /** Operator-facing notes, e.g. reduced diversity when few providers are configured. */
  notes: string[];
};

/** One panel member's response (or failure). */
export type FusionParticipantResult = {
  member: ResolvedFusionMember;
  ok: boolean;
  text: string;
  reasoning?: string;
  error?: string;
  latencyMs: number;
};

/** Structured analysis the judge extracts across the panel's responses. */
export type FusionAnalysis = {
  consensus: string[];
  contradictions: string[];
  partialCoverage: string[];
  uniqueInsights: string[];
  blindSpots: string[];
  recommendedFocus?: string;
  /** Set when the judge replied with prose we could not parse as JSON. */
  raw?: string;
};

export type FusionRunMeta = {
  mode: FusionMode;
  panel: Array<{ id: string; label: string; ok: boolean; latencyMs: number }>;
  judge: string | null;
  synthesizer: string;
  participantsSucceeded: number;
  participantsTotal: number;
  judged: boolean;
  notes: string[];
};

/** High-level events emitted by the orchestrator; the route maps these to SSE. */
export type FusionEvent =
  | { type: "plan"; plan: FusionRunMeta }
  | { type: "member.start"; id: string; label: string }
  | { type: "member.done"; id: string; label: string; ok: boolean; chars: number; latencyMs: number; error?: string }
  | { type: "judge.start"; label: string }
  | { type: "judge.done"; analysis: FusionAnalysis }
  | { type: "judge.skipped"; reason: string }
  | { type: "synth.start"; label: string }
  | { type: "synth.delta"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "done"; meta: FusionRunMeta; finalText: string }
  | { type: "error"; error: string };

/** Result of one chat completion call. */
export type FusionCompletionResult = {
  text: string;
  reasoning?: string;
  finishReason?: string;
};

export type FusionCompletionOptions = {
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /** Total wall-clock deadline for non-streaming calls. */
  timeoutMs?: number;
  /** Idle (no-token) deadline for streaming calls; resets on each chunk. */
  idleTimeoutMs?: number;
  /** Extra top-level body fields (e.g. OpenRouter Fusion custom-panel params). */
  extraBody?: Record<string, unknown>;
};

export type FusionStreamOptions = FusionCompletionOptions & {
  onDelta: (delta: string) => void;
  onReasoning?: (delta: string) => void;
};

/** Dependency-injectable model callers so the orchestrator is testable offline. */
export type FusionCaller = (
  member: ResolvedFusionMember,
  messages: FusionMessage[],
  options?: FusionCompletionOptions,
) => Promise<FusionCompletionResult>;

export type FusionStreamer = (
  member: ResolvedFusionMember,
  messages: FusionMessage[],
  options: FusionStreamOptions,
) => Promise<FusionCompletionResult>;

export type ResolvePlanInput = {
  config?: import("@/lib/types/agent-runtime").FusionAgentConfig;
  model?: string;
  messages: FusionMessage[];
};

export type PlanResolver = (input: ResolvePlanInput) => Promise<FusionPlan>;
