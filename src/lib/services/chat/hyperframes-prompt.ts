export const HYPERFRAMES_PROMPT_BUILDER_ID = "hyperframes-prompt-builder";
export const HYPERFRAMES_RENDER_MARKER = "[HIVEMINDOS_HYPERFRAMES_RENDER_V1]";

export type HyperframesPromptBuilderClarification = {
  id: typeof HYPERFRAMES_PROMPT_BUILDER_ID;
  question: string;
  choices: Array<{ label: string; value: string }>;
  allowFreeText: false;
};

export type HyperframesWorkflowId =
  | "product-launch-video"
  | "website-to-video"
  | "faceless-explainer"
  | "pr-to-video"
  | "embedded-captions"
  | "talking-head-recut"
  | "motion-graphics"
  | "music-to-video"
  | "slideshow"
  | "general-video"
  | "remotion-to-hyperframes";

export type HyperframesAspectRatio = "landscape" | "vertical" | "square" | "custom";
export type HyperframesDecisionSource = "provided" | "inferred" | "missing";
export type HyperframesDecisionId = "route" | "spec" | "beats" | "copy" | "technique" | "negatives";

export type HyperframesWorkflow = {
  id: HyperframesWorkflowId;
  label: string;
  description: string;
  defaultDurationSeconds: number;
  defaultAspectRatio: Exclude<HyperframesAspectRatio, "custom">;
  defaultTechniques: string[];
  defaultNegatives: string[];
  outputLabel: "video" | "presentation";
};

export const HYPERFRAMES_WORKFLOW_MATRIX: HyperframesWorkflow[] = [
  {
    id: "product-launch-video",
    label: "Product launch",
    description: "Market a product from its URL, brief, or script.",
    defaultDurationSeconds: 45,
    defaultAspectRatio: "landscape",
    defaultTechniques: ["Scene-led reveals", "Purposeful transitions"],
    defaultNegatives: ["No invented product claims", "No unrequested logos"],
    outputLabel: "video",
  },
  {
    id: "website-to-video",
    label: "Website showcase",
    description: "Turn a general website into a tour or social clip.",
    defaultDurationSeconds: 30,
    defaultAspectRatio: "landscape",
    defaultTechniques: ["Guided viewport motion", "Interface callouts"],
    defaultNegatives: ["No invented interface states", "No unrelated stock footage"],
    outputLabel: "video",
  },
  {
    id: "faceless-explainer",
    label: "Faceless explainer",
    description: "Explain a topic with designed typography and diagrams.",
    defaultDurationSeconds: 45,
    defaultAspectRatio: "landscape",
    defaultTechniques: ["Diagram reveals", "Kinetic type"],
    defaultNegatives: ["No talking-head footage", "No unsupported claims"],
    outputLabel: "video",
  },
  {
    id: "pr-to-video",
    label: "Pull request",
    description: "Turn a GitHub pull request into a change explainer.",
    defaultDurationSeconds: 45,
    defaultAspectRatio: "landscape",
    defaultTechniques: ["Diff highlights", "Before-and-after reveals"],
    defaultNegatives: ["No invented code changes", "No secrets or credentials"],
    outputLabel: "video",
  },
  {
    id: "embedded-captions",
    label: "Embedded captions",
    description: "Add subtitles to supplied talking-head footage.",
    defaultDurationSeconds: 30,
    defaultAspectRatio: "vertical",
    defaultTechniques: ["Timed caption emphasis", "Subject-aware layering"],
    defaultNegatives: ["No footage retiming", "No rewritten dialogue"],
    outputLabel: "video",
  },
  {
    id: "talking-head-recut",
    label: "Talking-head graphics",
    description: "Package supplied footage with designed overlays.",
    defaultDurationSeconds: 60,
    defaultAspectRatio: "vertical",
    defaultTechniques: ["Kinetic callouts", "Lower-third reveals"],
    defaultNegatives: ["No footage retiming", "No invented quotes"],
    outputLabel: "video",
  },
  {
    id: "motion-graphics",
    label: "Motion graphics",
    description: "Create a short unnarrated, design-led animation.",
    defaultDurationSeconds: 6,
    defaultAspectRatio: "square",
    defaultTechniques: ["Smooth easing", "Soft squash-and-settle"],
    defaultNegatives: ["No narration", "No unintended text"],
    outputLabel: "video",
  },
  {
    id: "music-to-video",
    label: "Music-driven video",
    description: "Build a beat-synced video around supplied audio.",
    defaultDurationSeconds: 30,
    defaultAspectRatio: "vertical",
    defaultTechniques: ["Beat-synced cuts", "Energy-matched pacing"],
    defaultNegatives: ["No narration", "No off-beat cuts"],
    outputLabel: "video",
  },
  {
    id: "slideshow",
    label: "Interactive slideshow",
    description: "Create a navigable deck rather than a rendered MP4.",
    defaultDurationSeconds: 30,
    defaultAspectRatio: "landscape",
    defaultTechniques: ["Fragment reveals", "Slide transitions"],
    defaultNegatives: ["No automatic video render", "No hidden navigation"],
    outputLabel: "presentation",
  },
  {
    id: "general-video",
    label: "Custom video",
    description: "Handle multi-scene, narrated, long, or custom compositions.",
    defaultDurationSeconds: 30,
    defaultAspectRatio: "landscape",
    defaultTechniques: ["Scene-led pacing", "Purposeful transitions"],
    defaultNegatives: ["No unrequested media", "No unintended text"],
    outputLabel: "video",
  },
  {
    id: "remotion-to-hyperframes",
    label: "Remotion conversion",
    description: "Port an existing Remotion composition to HyperFrames.",
    defaultDurationSeconds: 30,
    defaultAspectRatio: "landscape",
    defaultTechniques: ["Timing-preserving translation", "Frame-accurate comparison"],
    defaultNegatives: ["No creative redesign", "No unsupported silent substitutions"],
    outputLabel: "video",
  },
];

export const HYPERFRAMES_DECISION_LABELS: Array<{ id: HyperframesDecisionId; label: string }> = [
  { id: "route", label: "Route" },
  { id: "spec", label: "Format" },
  { id: "beats", label: "Beats" },
  { id: "copy", label: "Copy" },
  { id: "technique", label: "Motion" },
  { id: "negatives", label: "Exclude" },
];

export const HYPERFRAMES_ASPECT_PRESETS: Array<{
  id: Exclude<HyperframesAspectRatio, "custom">;
  label: string;
  width: number;
  height: number;
}> = [
  { id: "landscape", label: "Landscape", width: 1920, height: 1080 },
  { id: "vertical", label: "Vertical", width: 1080, height: 1920 },
  { id: "square", label: "Square", width: 1080, height: 1080 },
];

export const HYPERFRAMES_TECHNIQUE_PRESETS = [
  "Smooth easing",
  "Soft squash-and-settle",
  "Subtle drift",
  "Staggered reveal",
  "Kinetic type",
  "Parallax",
  "Count-up",
  "Shader transition",
  "Soft shadows",
  "Spring motion",
];

export const HYPERFRAMES_NEGATIVE_PRESETS = [
  "No narration",
  "No external media files",
  "No stock footage",
  "No unintended text",
  "No watermark",
  "No camera movement",
];

export type HyperframesBeat = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  description: string;
};

export type HyperframesPromptDraft = {
  sourceRequest: string;
  workflowId: HyperframesWorkflowId;
  durationSeconds: number;
  aspectRatio: HyperframesAspectRatio;
  dimensions: { width: number; height: number };
  beats: HyperframesBeat[];
  copy: string[];
  techniques: string[];
  negatives: string[];
  decisionSources: Record<HyperframesDecisionId, HyperframesDecisionSource>;
};

export type HyperframesPromptValidationError = {
  code:
    | "duration"
    | "dimensions"
    | "beat-empty"
    | "beat-order"
    | "beat-gap"
    | "beat-overlap"
    | "beat-out-of-bounds";
  message: string;
  beatId?: string;
};

export type HyperframesPromptValidation = {
  ready: boolean;
  errors: HyperframesPromptValidationError[];
  explicitDecisionCount: number;
  inferredDecisionCount: number;
};

function workflow(workflowId: HyperframesWorkflowId) {
  return HYPERFRAMES_WORKFLOW_MATRIX.find((entry) => entry.id === workflowId) ?? HYPERFRAMES_WORKFLOW_MATRIX[9];
}

function cleanRequest(value: string) {
  return value
    .replace(HYPERFRAMES_RENDER_MARKER, "")
    .replace(/^Use HyperFrames HTML-based video rendering for this request:\s*/i, "")
    .trim();
}

function explicitWorkflow(value: string): HyperframesWorkflowId | null {
  const match = value.match(/(?:^|\s)\/([a-z][a-z0-9-]*)\b/i)?.[1]?.toLowerCase();
  return HYPERFRAMES_WORKFLOW_MATRIX.some((entry) => entry.id === match)
    ? match as HyperframesWorkflowId
    : null;
}

function inferredWorkflow(value: string): HyperframesWorkflowId {
  if (/\bremotion\b[\s\S]*\b(?:port|convert|migrat)/i.test(value)) return "remotion-to-hyperframes";
  if (/\b(?:pull request|github pr|pr\s*#\d+)\b/i.test(value)) return "pr-to-video";
  if (/\b(?:captions?|subtitles?)\b/i.test(value) && /\b(?:footage|talking[-\s]?head|video|clip)\b/i.test(value)) return "embedded-captions";
  if (/\b(?:lower[-\s]?third|graphic overlays?|callouts?)\b/i.test(value) && /\b(?:talking[-\s]?head|interview|podcast|footage)\b/i.test(value)) return "talking-head-recut";
  if (/\b(?:music|song|audio|beat[-\s]?synced|lyric video|visualizer)\b/i.test(value)) return "music-to-video";
  if (/\b(?:slide deck|slideshow|presentation|pitch deck|presenter mode)\b/i.test(value)) return "slideshow";
  if (/\b(?:product launch|launch video|product promo|saas promo)\b/i.test(value)) return "product-launch-video";
  if (/\b(?:website|webpage|homepage|landing page|site tour)\b/i.test(value) && /\b(?:showcase|tour|turn|video|clip)\b/i.test(value)) return "website-to-video";
  if (/\b(?:explain|explainer|how .* works|concept)\b/i.test(value)) return "faceless-explainer";
  if (/\b(?:motion graphics?|animation|animate|logo sting|kinetic|lower[-\s]?third|folder opening|count[-\s]?up)\b/i.test(value)) return "motion-graphics";
  return "general-video";
}

function explicitDuration(value: string) {
  const match = value.match(/\b(\d+(?:\.\d+)?)\s*(?:-|–)?\s*(?:seconds?|secs?|s)\b/i);
  const duration = Number(match?.[1]);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function dimensionsFromAspect(aspectRatio: Exclude<HyperframesAspectRatio, "custom">) {
  const preset = HYPERFRAMES_ASPECT_PRESETS.find((entry) => entry.id === aspectRatio) ?? HYPERFRAMES_ASPECT_PRESETS[0];
  return { width: preset.width, height: preset.height };
}

function aspectFromDimensions(width: number, height: number): HyperframesAspectRatio {
  if (width === height) return "square";
  if (width < height) return "vertical";
  return "landscape";
}

function explicitDimensions(value: string) {
  const match = value.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/i);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 240 || height < 240) return null;
  return { width, height };
}

function inferredAspect(value: string, workflowId: HyperframesWorkflowId) {
  if (/\b(?:tiktok|reels?|shorts?|vertical|portrait|9\s*:\s*16)\b/i.test(value)) return "vertical" as const;
  if (/\b(?:square|1\s*:\s*1)\b/i.test(value)) return "square" as const;
  if (/\b(?:youtube|landscape|widescreen|16\s*:\s*9)\b/i.test(value)) return "landscape" as const;
  return workflow(workflowId).defaultAspectRatio;
}

function trimSentence(value: string) {
  return value.replace(/\s+/g, " ").replace(/^[\s,;:.–—-]+|[\s,;:]+$/g, "").trim();
}

function parsedBeats(value: string): HyperframesBeat[] {
  const beatPattern = /\bBeat\s+(\d+)\s*\(\s*(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)\s*s?\s*\)\s*:\s*([\s\S]*?)(?=\bBeat\s+\d+\s*\(|\b(?:Label|Copy|On-screen text)\b[^:]*:|\b(?:No|Without|Avoid)\s+|$)/gi;
  return [...value.matchAll(beatPattern)].flatMap((match, index) => {
    const startSeconds = Number(match[2]);
    const endSeconds = Number(match[3]);
    const description = trimSentence(match[4] ?? "");
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return [];
    return [{
      id: `beat-${match[1] || index + 1}`,
      startSeconds,
      endSeconds,
      description,
    }];
  });
}

function starterBeat(value: string, durationSeconds: number): HyperframesBeat {
  const description = trimSentence(value
    .replace(/(?:^|\s)\/[a-z][a-z0-9-]*\b/i, "")
    .replace(/\b(?:no|without|avoid)\s+[^.;]+[.;]?/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:-|–)?\s*(?:seconds?|secs?|s)\b/gi, "")
    .replace(/\b\d{3,4}\s*[x×]\s*\d{3,4}\b/gi, "")
    .replace(/\b(?:make|create|render|produce)\b/gi, "")
    .replace(/\b(?:a|an|the)\s+(?:video|animation|clip)\b/gi, ""));
  return {
    id: "beat-1",
    startSeconds: 0,
    endSeconds: durationSeconds,
    description: description || "Introduce the subject, complete the main motion, and settle the final frame",
  };
}

function quotedCopy(value: string) {
  const copy = new Set<string>();
  for (const match of value.matchAll(/[“"]([^”"\n]+)[”"]/g)) {
    const text = trimSentence(match[1] ?? "");
    if (text) copy.add(text);
  }
  return [...copy];
}

const TECHNIQUE_MATCHERS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Cursor glide", pattern: /\b(?:cursor|pointer)\b[\s\S]{0,50}\b(?:glide|move|sweep)/i },
  { label: "Soft squash-and-settle", pattern: /\bsquash(?:-and-settle)?\b/i },
  { label: "Subtle drift", pattern: /\b(?:subtle|slow)[-\s,]+drift\b|\bdrift\b/i },
  { label: "Soft shadows", pattern: /\bsoft shadow/i },
  { label: "Staggered reveal", pattern: /\b(?:stagger|fan out|cascade)/i },
  { label: "Kinetic type", pattern: /\bkinetic (?:type|typography)/i },
  { label: "Parallax", pattern: /\bparallax\b/i },
  { label: "Count-up", pattern: /\bcount[-\s]?up\b/i },
  { label: "Shader transition", pattern: /\bshader\b/i },
  { label: "Spring motion", pattern: /\b(?:spring|bounce)\b/i },
  { label: "Fade", pattern: /\bfade(?:s|d|ing)?\b/i },
  { label: "Zoom", pattern: /\bzoom(?:s|ed|ing)?\b/i },
];

function parsedTechniques(value: string) {
  return TECHNIQUE_MATCHERS.filter((entry) => entry.pattern.test(value)).map((entry) => entry.label);
}

function normalizeNegative(value: string) {
  const clean = trimSentence(value).replace(/^no\s+/i, "");
  return clean ? `No ${clean.charAt(0).toLowerCase()}${clean.slice(1)}` : "";
}

function parsedNegatives(value: string) {
  const negatives = new Set<string>();
  for (const match of value.matchAll(/\bno\s+([^.;]+(?:,\s*no\s+[^.;]+)*)/gi)) {
    for (const item of (match[1] ?? "").split(/,\s*no\s+/i)) {
      const negative = normalizeNegative(item);
      if (negative) negatives.add(negative);
    }
  }
  for (const match of value.matchAll(/\b(?:without|avoid)\s+([^.;]+)/gi)) {
    const negative = normalizeNegative(match[1] ?? "");
    if (negative) negatives.add(negative);
  }
  return [...negatives];
}

function hasExplicitNoCopy(value: string) {
  return /\b(?:no|without)\s+(?:on[-\s]?screen\s+)?(?:copy|text|labels?)\b/i.test(value);
}

export function parseHyperframesPrompt(input: string): HyperframesPromptDraft {
  const sourceRequest = cleanRequest(input);
  const providedWorkflow = explicitWorkflow(sourceRequest);
  const workflowId = providedWorkflow ?? inferredWorkflow(sourceRequest);
  const workflowPreset = workflow(workflowId);
  const providedDuration = explicitDuration(sourceRequest);
  const durationSeconds = providedDuration ?? workflowPreset.defaultDurationSeconds;
  const providedDimensions = explicitDimensions(sourceRequest);
  const aspectRatio = providedDimensions
    ? aspectFromDimensions(providedDimensions.width, providedDimensions.height)
    : inferredAspect(sourceRequest, workflowId);
  const dimensions = providedDimensions ?? dimensionsFromAspect(aspectRatio === "custom" ? workflowPreset.defaultAspectRatio : aspectRatio);
  const explicitBeats = parsedBeats(sourceRequest);
  const beats = explicitBeats.length ? explicitBeats : [starterBeat(sourceRequest, durationSeconds)];
  const copy = quotedCopy(sourceRequest);
  const techniques = parsedTechniques(sourceRequest);
  const negatives = parsedNegatives(sourceRequest);

  return {
    sourceRequest,
    workflowId,
    durationSeconds,
    aspectRatio,
    dimensions,
    beats,
    copy,
    techniques: techniques.length ? techniques : [...workflowPreset.defaultTechniques],
    negatives: negatives.length ? negatives : [...workflowPreset.defaultNegatives],
    decisionSources: {
      route: providedWorkflow ? "provided" : "inferred",
      spec: providedDuration || providedDimensions || /\b(?:tiktok|reels?|shorts?|youtube|square|vertical|landscape|portrait|widescreen|9\s*:\s*16|16\s*:\s*9|1\s*:\s*1)\b/i.test(sourceRequest)
        ? "provided"
        : "inferred",
      beats: explicitBeats.length ? "provided" : "inferred",
      copy: copy.length || hasExplicitNoCopy(sourceRequest) ? "provided" : "inferred",
      technique: techniques.length ? "provided" : "inferred",
      negatives: negatives.length ? "provided" : "inferred",
    },
  };
}

function displayNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function sentence(value: string) {
  const clean = trimSentence(value);
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function quoted(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function serializeHyperframesPrompt(draft: HyperframesPromptDraft) {
  const selectedWorkflow = workflow(draft.workflowId);
  const route = `/${draft.workflowId}`;
  const spec = `Make a ${displayNumber(draft.durationSeconds)}-second ${draft.dimensions.width}×${draft.dimensions.height} ${selectedWorkflow.outputLabel}.`;
  const beats = draft.beats
    .slice()
    .sort((left, right) => left.startSeconds - right.startSeconds)
    .map((beat, index) => `Beat ${index + 1} (${displayNumber(beat.startSeconds)}–${displayNumber(beat.endSeconds)}s): ${sentence(beat.description)}`)
    .join(" ");
  const copy = draft.copy.length
    ? `On-screen copy: ${draft.copy.map(quoted).join(", ")}.`
    : "No on-screen copy.";
  const technique = draft.techniques.length ? `Motion: ${draft.techniques.join(", ")}.` : "";
  const negatives = draft.negatives.map(normalizeNegative).filter(Boolean).map(sentence).join(" ");
  return [route, spec, beats, copy, technique, negatives].filter(Boolean).join(" ");
}

export function validateHyperframesPrompt(draft: HyperframesPromptDraft): HyperframesPromptValidation {
  const errors: HyperframesPromptValidationError[] = [];
  if (!Number.isFinite(draft.durationSeconds) || draft.durationSeconds <= 0) {
    errors.push({ code: "duration", message: "Choose a duration greater than zero." });
  }
  if (!Number.isInteger(draft.dimensions.width) || !Number.isInteger(draft.dimensions.height) || draft.dimensions.width < 240 || draft.dimensions.height < 240) {
    errors.push({ code: "dimensions", message: "Choose valid video dimensions of at least 240×240." });
  }

  const beats = draft.beats.slice().sort((left, right) => left.startSeconds - right.startSeconds);
  beats.forEach((beat, index) => {
    if (!beat.description.trim()) errors.push({ code: "beat-empty", message: `Beat ${index + 1} needs an on-screen action.`, beatId: beat.id });
    if (!Number.isFinite(beat.startSeconds) || !Number.isFinite(beat.endSeconds) || beat.startSeconds < 0 || beat.endSeconds <= beat.startSeconds) {
      errors.push({ code: "beat-order", message: `Beat ${index + 1} must end after it starts.`, beatId: beat.id });
    }
    if (beat.endSeconds > draft.durationSeconds) {
      errors.push({ code: "beat-out-of-bounds", message: `Beat ${index + 1} runs past ${displayNumber(draft.durationSeconds)} seconds.`, beatId: beat.id });
    }
    const previous = beats[index - 1];
    if (!previous) {
      if (beat.startSeconds > 0) errors.push({ code: "beat-gap", message: `The timeline is empty from 0 to ${displayNumber(beat.startSeconds)} seconds.`, beatId: beat.id });
      return;
    }
    if (beat.startSeconds > previous.endSeconds) {
      errors.push({ code: "beat-gap", message: `There is a gap between beats ${index} and ${index + 1}.`, beatId: beat.id });
    }
    if (beat.startSeconds < previous.endSeconds) {
      errors.push({ code: "beat-overlap", message: `Beats ${index} and ${index + 1} overlap.`, beatId: beat.id });
    }
  });
  const finalBeat = beats.at(-1);
  if (finalBeat && finalBeat.endSeconds < draft.durationSeconds) {
    errors.push({ code: "beat-gap", message: `The timeline is empty after ${displayNumber(finalBeat.endSeconds)} seconds.`, beatId: finalBeat.id });
  }

  const sources = Object.values(draft.decisionSources);
  return {
    ready: errors.length === 0,
    errors,
    explicitDecisionCount: sources.filter((source) => source === "provided").length,
    inferredDecisionCount: sources.filter((source) => source === "inferred").length,
  };
}

export function hyperframesRenderRequest(prompt: string) {
  return `${HYPERFRAMES_RENDER_MARKER}\n${prompt.trim()}`;
}

export function isHyperframesRenderRequest(value: string) {
  return value.includes(HYPERFRAMES_RENDER_MARKER);
}

export function isConcreteHyperframesVideoRequest(value: string) {
  if (isHyperframesRenderRequest(value)) return true;
  const selectedMethod = /\b(?:hyperframes?|hypergen)\b/i.test(value)
    || /\b(?:html|browser)[-\s]?(?:based|rendered|rendering)\b/i.test(value);
  const creationAction = /\b(?:animate|build|create|generate|make|produce|render|turn)\b/i.test(value);
  const videoArtifact = /\b(?:animation|clip|motion[-\s]?graphics?|movie|reel|slideshow|video)\b/i.test(value);
  return selectedMethod && creationAction && videoArtifact;
}

export function visibleHyperframesPrompt(value: string) {
  return value.replace(HYPERFRAMES_RENDER_MARKER, "").trim();
}

export function hyperframesPromptBuilderClarification(request: string): HyperframesPromptBuilderClarification {
  const starterPrompt = serializeHyperframesPrompt(parseHyperframesPrompt(request));
  return {
    id: HYPERFRAMES_PROMPT_BUILDER_ID,
    question: "Shape this HyperFrames video before rendering.",
    choices: [{
      label: "Use guided prompt",
      value: hyperframesRenderRequest(starterPrompt),
    }],
    allowFreeText: false,
  };
}
