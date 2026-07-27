// Routes inline channel/reasoning markup that local models leak into
// delta.content into separate content vs thinking streams. Covers:
// - Harmony-format control tokens from gpt-oss style models served raw
//   (<|channel|>analysis<|message|>...<|end|><|start|>assistant<|channel|>final...),
//   including garbled pipe variants observed in the wild (<|channel>thought,
//   <channel|>) when a quantized model degrades its own special tokens.
// - XML-ish <channel>thinking</channel> markers.
// - Bare <think>/<thinking> spans: MiniMax, DeepSeek-R1, and Qwen stream
//   reasoning inline wrapped in those tags instead of a separate reasoning
//   field (observed 2026-06-11: MiniMax-M2.7 leaked a raw <think> block into a
//   BankrAgent02 chat).
//
// Streaming deltas can split a control sequence anywhere — including AFTER the
// closing ">" of a channel tag, because Harmony puts the label after the tag
// ("<|channel|>" then "final"). routeChannelMarkupDelta therefore holds back
// any tail that could still grow into a control sequence and re-parses it with
// the next delta; call flushChannelMarkup once the stream ends to drain it.

export type ChannelMarkupState = {
  channel: "content" | "thinking";
  pending: string;
};

export type RoutedChannelMarkup = { content: string; thinking: string };

const THINKING_LABELS = new Set(["thought", "thinking", "analysis", "reasoning", "commentary"]);
const CONTENT_LABELS = new Set(["final", "message", "content", "assistant", "response"]);
const CHANNEL_LABELS = [...THINKING_LABELS, ...CONTENT_LABELS];
const START_ROLES = ["assistant", "user", "system", "developer", "tool"];
// Words that can appear inside a <...>-style control tag (with or without pipes).
const CONTROL_WORDS = [
  "channel",
  "message",
  "end",
  "return",
  "start",
  "constrain",
  "think",
  "thinking",
  "/channel",
  "/think",
  "/thinking",
];

const LABEL_ALTERNATION = [...CHANNEL_LABELS].join("|");

const channelControlPattern = new RegExp(
  [
    // <channel>label</channel> — label inside the element.
    `<channel>\\s*(?<xmlLabel>${LABEL_ALTERNATION})\\s*</channel>`,
    // Channel tag (any pipe garbling) followed by its label.
    `<\\|?channel\\|?>\\s*(?<tagLabel>${LABEL_ALTERNATION})\\b`,
    // Channel tag with no recognizable label: strip it, keep the current channel.
    `<\\|?channel\\|?>`,
    // Message-begin token: payload of the already-declared channel follows.
    `<\\|?message\\|?>`,
    // Message terminators: the next message defaults back to content.
    `(?<msgEnd><\\|?(?:end|return)\\|?>)`,
    // Start-of-message header including its role word.
    `<\\|?start\\|?>\\s*(?:${START_ROLES.join("|")})?`,
    `<\\|?constrain\\|?>`,
    `</channel>`,
    `<(?<thinkOpen>think|thinking)>`,
    `</(?<thinkClose>think|thinking)>`,
  ].join("|"),
  "gi",
);

// Longest plausible held-back tail: tag + whitespace + label. Anything longer
// is emitted as-is rather than buffered forever.
const MAX_HOLDBACK_CHARS = 48;

export function createChannelMarkupState(): ChannelMarkupState {
  return { channel: "content", pending: "" };
}

// Could `tail` (which starts with "<") still grow into a control sequence if
// more streamed text arrives? Deliberately strict: plain prose like "< 6" or
// "<div" returns false so ordinary text is never withheld from the client.
function couldBecomeControl(tail: string): boolean {
  const match = /^<(\|?)([a-z/]*)(\|?)(>?)([\s\S]*)$/i.exec(tail);
  if (!match) return false;
  const word = match[2].toLowerCase();
  const pipeClosed = Boolean(match[3]);
  const tagClosed = Boolean(match[4]);
  const rest = match[5];
  if (!tagClosed) {
    if (rest) return false;
    if (pipeClosed) return CONTROL_WORDS.includes(word);
    return CONTROL_WORDS.some((candidate) => candidate.startsWith(word));
  }
  // Tag is closed: only channel/start tags wait for a trailing label/role word.
  const followers = word === "channel" ? CHANNEL_LABELS : word === "start" ? START_ROLES : null;
  if (!followers) return false;
  const follow = /^\s*([a-z]*)$/i.exec(rest);
  if (!follow) return false;
  const followWord = follow[1].toLowerCase();
  return followers.some((candidate) => candidate.startsWith(followWord));
}

function consumeChannelMarkup(input: string, state: ChannelMarkupState, final: boolean): RoutedChannelMarkup {
  let content = "";
  let thinking = "";
  const append = (text: string) => {
    if (!text) return;
    if (state.channel === "thinking") thinking += text;
    else content += text;
  };

  let cursor = 0;
  for (const match of input.matchAll(channelControlPattern)) {
    const index = match.index ?? 0;
    append(input.slice(cursor, index));
    const groups = match.groups;
    if (groups?.thinkOpen) {
      state.channel = "thinking";
    } else if (groups?.thinkClose) {
      state.channel = "content";
    } else if (groups?.msgEnd) {
      state.channel = "content";
    } else {
      const label = String(groups?.xmlLabel ?? groups?.tagLabel ?? "").trim().toLowerCase();
      if (THINKING_LABELS.has(label)) state.channel = "thinking";
      else if (CONTENT_LABELS.has(label)) state.channel = "content";
      // Bare channel tags, <|message|>, <|start|>, <|constrain|>, and stray
      // </channel> are stripped without changing the active channel.
    }
    cursor = index + match[0].length;
  }

  let remainder = input.slice(cursor);
  if (final && remainder) {
    // The stream is over: drop a trailing fragment that is still a plausible
    // control-token prefix (e.g. the model died mid "<|chann") instead of
    // leaking it into the visible message.
    const lastOpen = remainder.lastIndexOf("<");
    if (lastOpen >= 0 && couldBecomeControl(remainder.slice(lastOpen))) {
      remainder = remainder.slice(0, lastOpen);
    }
  }
  append(remainder);

  return { content, thinking };
}

export function routeChannelMarkupDelta(value: string, state: ChannelMarkupState): RoutedChannelMarkup {
  let input = `${state.pending}${value}`;
  state.pending = "";
  const lastOpen = input.lastIndexOf("<");
  if (
    lastOpen >= 0 &&
    input.length - lastOpen <= MAX_HOLDBACK_CHARS &&
    couldBecomeControl(input.slice(lastOpen))
  ) {
    state.pending = input.slice(lastOpen);
    input = input.slice(0, lastOpen);
  }
  return consumeChannelMarkup(input, state, false);
}

// Drain any held-back tail once the upstream stream has ended. Always call
// this after the read loop; otherwise a turn ending exactly on a held tail
// (e.g. "<|channel|>final") silently loses it.
export function flushChannelMarkup(state: ChannelMarkupState): RoutedChannelMarkup {
  const tail = state.pending;
  state.pending = "";
  if (!tail) return { content: "", thinking: "" };
  return consumeChannelMarkup(tail, state, true);
}

// Whole-string convenience for non-streaming responses.
export function routeChannelMarkupText(value: string): RoutedChannelMarkup {
  const state = createChannelMarkupState();
  const routed = routeChannelMarkupDelta(value, state);
  const flushed = flushChannelMarkup(state);
  return {
    content: routed.content + flushed.content,
    thinking: routed.thinking + flushed.thinking,
  };
}

export function visibleChannelMarkupText(value: string): string {
  return routeChannelMarkupText(value).content;
}
