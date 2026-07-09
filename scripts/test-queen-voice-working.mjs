#!/usr/bin/env node
// Hermetic coverage for the Queen voice "working" turn surfaces:
// - per-turn progress store (begin/mark/dedupe/finish/read + id normalization)
// - the flattened runtime voice prompt (history + anti-re-greeting contract)
// - tool-activity labels parsed from runtime SSE payloads
import { register } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const {
  beginVoiceTurnProgress,
  finishVoiceTurnProgress,
  markVoiceTurnStage,
  normalizeVoiceTurnId,
  readVoiceTurnProgress,
  resetVoiceTurnProgressForTests,
} = await import("../src/lib/services/queen-bee/voice-turn-progress.ts");
const {
  buildRuntimeVoiceMessages,
  buildRuntimeVoiceUserText,
  spokenVoicePreferenceFromTranscript,
} = await import("../src/lib/services/queen-bee/voice-turn.ts");
const {
  queenAskedForTaskApproval,
  voiceTranscriptDirectlyRequestsTask,
  voiceTaskApprovalPrompt,
  voiceTaskSubmissionAuthorized,
  voiceTranscriptRequestsImmediateAnswer,
} = await import("../src/lib/services/queen-bee/voice-task-approval.ts");
const { toolActivityLabel } = await import("../src/lib/services/phone/runtime-voice-turn.ts");
const {
  BARGE_IN_TUNING,
  bargeInThreshold,
  createBargeInDetector,
  requestBargeInRecalibration,
  updateBargeInDetector,
} = await import("../src/features/queen-voice/barge-in-detector.ts");

// --- turn id normalization ----------------------------------------------------
{
  assert.equal(normalizeVoiceTurnId("voice-abc123-x9"), "voice-abc123-x9");
  assert.equal(normalizeVoiceTurnId("  voice-1  "), "voice-1");
  assert.equal(normalizeVoiceTurnId("no spaces allowed"), "", "spaces rejected");
  assert.equal(normalizeVoiceTurnId("abc"), "", "too short rejected");
  assert.equal(normalizeVoiceTurnId("x".repeat(81)), "", "too long rejected");
  assert.equal(normalizeVoiceTurnId(42), "", "non-strings rejected");
  console.log("turn id normalization ok");
}

// --- progress store lifecycle --------------------------------------------------
{
  resetVoiceTurnProgressForTests();
  assert.deepEqual(readVoiceTurnProgress("voice-unknown"), {
    known: false,
    finished: false,
    stages: [],
  });

  beginVoiceTurnProgress("voice-t1");
  markVoiceTurnStage("voice-t1", "Thinking with HermesMain");
  markVoiceTurnStage("voice-t1", "Thinking with HermesMain"); // duplicate collapses
  markVoiceTurnStage("voice-t1", "Using run_command");
  let progress = readVoiceTurnProgress("voice-t1");
  assert.equal(progress.known, true);
  assert.equal(progress.finished, false);
  assert.deepEqual(
    progress.stages.map((stage) => stage.label),
    ["Thinking with HermesMain", "Using run_command"],
  );
  assert.equal(progress.stages[0].done, true, "a new stage marks the previous done");
  assert.equal(progress.stages[1].done, false, "latest stage is live");

  finishVoiceTurnProgress("voice-t1");
  progress = readVoiceTurnProgress("voice-t1");
  assert.equal(progress.finished, true);
  assert.ok(progress.stages.every((stage) => stage.done), "finish marks all stages done");

  markVoiceTurnStage("voice-t1", "Late stage after finish");
  assert.equal(
    readVoiceTurnProgress("voice-t1").stages.length,
    2,
    "stages after finish are ignored",
  );
  console.log("progress store lifecycle ok");
}

// --- flattened runtime prompt ---------------------------------------------------
{
  const history = [
    { who: "queen", text: "Hey Liam, I'm here. What should we work on first?" },
    { who: "you", text: "What do you think?" },
  ];
  const prompt = buildRuntimeVoiceUserText("Sure", history, "Call the user boss.");
  assert.ok(prompt.includes("Queen Bee"), "persona present");
  assert.ok(prompt.includes("sharp wit"), "default Queen personality present");
  assert.ok(prompt.includes('"speech"'), "JSON contract present");
  assert.ok(/never greet again/i.test(prompt), "anti-re-greeting instruction present");
  assert.ok(/open-ended prompt/i.test(prompt), "voice prompt carries the task approval boundary");
  assert.ok(prompt.includes("Call the user boss."), "preference preamble spliced in");
  assert.ok(prompt.includes("Queen Bee: Hey Liam, I'm here."), "queen history line present");
  assert.ok(prompt.includes("User: What do you think?"), "user history line present");
  assert.ok(prompt.includes("User's latest spoken message: Sure"), "latest message last");
  assert.ok(
    prompt.indexOf("Conversation so far") < prompt.indexOf("User's latest spoken message"),
    "history precedes the latest message",
  );

  const noHistory = buildRuntimeVoiceUserText("Hello", [], "");
  assert.ok(!noHistory.includes("Conversation so far"), "no empty history block");
  const customPersonality = buildRuntimeVoiceUserText("Hello", [], "", "Custom Queen personality.");
  assert.ok(customPersonality.includes("Custom Queen personality."), "custom Queen personality present");
  assert.ok(!customPersonality.includes("sharp wit"), "custom Queen personality replaces the default");

  const long = Array.from({ length: 20 }, (_, index) => ({
    who: index % 2 ? "queen" : "you",
    text: `turn ${index}`,
  }));
  const capped = buildRuntimeVoiceUserText("latest", long, "");
  assert.ok(!capped.includes("turn 11"), "history capped to the recent window");
  assert.ok(capped.includes("turn 19"), "most recent history retained");
  const messages = buildRuntimeVoiceMessages("Sure", history, "Call the user boss.");
  assert.equal(messages[0].role, "system", "runtime voice turn sends a real system message");
  assert.match(messages[0].content, /Queen Bee live voice override/i, "system message overrides runtime profile identity");
  assert.doesNotMatch(messages[0].content, /Call the user boss/i, "volatile preferences stay after the reusable prefix");
  assert.equal(messages[1].role, "user", "runtime voice turn has a stable cache bootstrap");
  assert.equal(messages[2].role, "assistant", "runtime voice turn acknowledges the stable bootstrap");
  assert.equal(messages[3].role, "user", "runtime voice turn keeps the dynamic request last");
  assert.match(messages[3].content, /Call the user boss/i, "dynamic prompt carries stored preferences");
  assert.match(messages[3].content, /User's latest spoken message: Sure/, "user message keeps the unwrap marker");
  const changedMessages = buildRuntimeVoiceMessages("Different turn", [], "Different preference.");
  assert.deepEqual(
    changedMessages.slice(0, 3),
    messages.slice(0, 3),
    "the reusable voice prefix is identical across turns",
  );
  console.log("flattened runtime prompt ok");
}

// --- spoken preference capture -------------------------------------------------
{
  assert.equal(
    spokenVoicePreferenceFromTranscript("call me boss"),
    'Address the user as "boss".',
    "direct address preference is captured",
  );
  assert.equal(
    spokenVoicePreferenceFromTranscript("Please remember to call me Boss from now on."),
    'Address the user as "Boss".',
    "remember/address phrasing is captured",
  );
  assert.equal(
    spokenVoicePreferenceFromTranscript("why didn't you call me boss?"),
    "",
    "questions are not captured as new preferences",
  );
  assert.equal(
    spokenVoicePreferenceFromTranscript("call me when the build is done"),
    "",
    "task requests are not captured as address preferences",
  );
  console.log("spoken preference capture ok");
}

// --- voice task approval boundary ----------------------------------------------
{
  const openingHistory = [
    { who: "queen", text: "Hey Liam, I'm here. What should we work on first?" },
  ];
  assert.equal(
    voiceTaskSubmissionAuthorized("You tell me.", openingHistory),
    false,
    "open-ended delegation is not consent to mutate the Work Board",
  );
  assert.equal(
    voiceTaskSubmissionAuthorized("yes do it", openingHistory),
    false,
    "a bare yes only counts after Queen Bee has proposed a task",
  );

  const prompt = voiceTaskApprovalPrompt({
    title: "Analyze WEBS Performance",
    message: "Review recent outreach and email threads.",
  });
  assert.match(prompt, /Say yes to queue it/);
  const proposalHistory = [{ who: "queen", text: prompt }];
  assert.equal(
    queenAskedForTaskApproval(proposalHistory),
    true,
    "the generated approval prompt is detectable on the next turn",
  );
  assert.equal(
    voiceTaskSubmissionAuthorized("yes do it", proposalHistory),
    true,
    "confirmation after an explicit proposal authorizes queueing",
  );
  assert.equal(
    voiceTaskSubmissionAuthorized("Review recent email threads for revenue gaps.", []),
    true,
    "a direct work request still authorizes the voice task path",
  );
  assert.equal(
    voiceTranscriptRequestsImmediateAnswer("grab my latest x post"),
    true,
    "latest X post retrieval is an immediate answer request",
  );
  assert.equal(
    voiceTranscriptDirectlyRequestsTask("grab my latest x post"),
    false,
    "latest X post retrieval is not a Work Board task request",
  );
  assert.equal(
    voiceTaskSubmissionAuthorized("check my latest post on X", []),
    false,
    "read-only X post retrieval is not authorized as queued work",
  );
  const voiceTurnSource = readFileSync(
    new URL("../src/lib/services/queen-bee/voice-turn.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    voiceTurnSource.includes("Read-only retrieval requests like"),
    "voice prompt tells the model not to queue read-only X post retrieval",
  );
  assert.ok(
    voiceTurnSource.includes("The latest user message is a read-only X/Twitter retrieval request."),
    "voice runtime preamble reinforces immediate answer handling for X post retrieval",
  );
  assert.ok(
    voiceTurnSource.includes("if (voiceTranscriptRequestsImmediateAnswer(options.transcript))"),
    "voice wrapper guards against Work Board prompts for read-only X post retrieval",
  );
  console.log("voice task approval boundary ok");
}

// --- rails unwrap contract ---------------------------------------------------------
// The agent-runtime money rails and tool offers key on the user's bare request.
// The flattened voice prompt contains rail trigger words in its own scaffolding
// ("automation" in the persona sentence hijacked every spoken turn with a real
// Bankr call), so the REAL builder must round-trip through the REAL unwrapper.
{
  const { bareUserRequestText, extractChunk, unwrapLatestUserRequest } = await import(
    "../src/app/api/chat/agent-runtime/messages.ts"
  );
  const prompt = buildRuntimeVoiceUserText("Uh nothing much", [
    { who: "you", text: "What's new?" },
    { who: "queen", text: "Just waiting on your signal, Liam." },
  ], "");
  assert.match(prompt, /automation/i, "persona scaffolding contains rail trigger words (why unwrapping matters)");
  assert.equal(bareUserRequestText(prompt), "Uh nothing much", "flattened prompt unwraps to the utterance");
  const unwrapped = unwrapLatestUserRequest([{ role: "user", content: prompt }]);
  assert.equal(unwrapped[0].content, "Uh nothing much", "rails see only the spoken utterance");
  assert.equal(
    bareUserRequestText("<screen context briefing>\n\nUser request: swap 1 usdc to eth"),
    "swap 1 usdc to eth",
    "FAB screen-context wrapper still unwraps",
  );
  assert.equal(bareUserRequestText("swap 1 usdc to eth"), "", "plain messages have nothing to unwrap");
  const plain = [{ role: "user", content: "hello" }];
  assert.equal(unwrapLatestUserRequest(plain), plain, "no marker returns the original list");
  assert.equal(
    extractChunk({ event: { delta: "Hermes says hi." } }),
    "Hermes says hi.",
    "agent-runtime route treats Hermes event.delta frames as assistant text",
  );
  console.log("rails unwrap contract ok");
}

// --- low-latency voice runtime session boundary -----------------------------------
// The agent-runtime voice fast path returns the stream before the normal chat
// route reaches its shared session-start block. It must create the session
// first, or assistant chunks can merge into an old assistant row because no new
// user boundary was recorded for the long-lived queen-bee-voice session.
{
  const routeSource = readFileSync(
    new URL("../src/app/api/chat/agent-runtime/route.ts", import.meta.url),
    "utf8",
  );
  const fastPathStart = routeSource.indexOf('const lowLatencyVoiceTurn = latencyMode === "voice";');
  assert.ok(fastPathStart > 0, "agent-runtime route still has a low-latency voice fast path");
  const fastPathReturn = routeSource.indexOf("return streamHttpRuntime(", fastPathStart);
  const sessionStart = routeSource.indexOf("await startRuntimeChatSession({", fastPathStart);
  assert.ok(sessionStart > fastPathStart, "voice fast path starts a runtime chat session");
  assert.ok(
    sessionStart < fastPathReturn,
    "voice fast path records the user boundary before returning the stream",
  );
  assert.ok(
    routeSource.includes("userContent: bareUserRequestText(promptCheck.text) || promptCheck.text"),
    "voice fast path stores the unwrapped spoken request as the session user message",
  );
  assert.ok(
    routeSource.includes('"agent_runtime.voice.session.started"'),
    "voice fast path emits session-start telemetry",
  );
  console.log("low-latency voice session boundary ok");
}

// --- streaming speech extraction + sentence chunking -------------------------------
// The fused converse+speak turn extracts the "speech" JSON field while the
// model is still streaming and cuts it into TTS-sized chunks (first sentence
// ships alone so first audio never waits for the full reply).
{
  const { createSpeechDeltaExtractor, createSentenceChunker } = await import(
    "../src/lib/services/queen-bee/voice-speech-stream.ts"
  );

  // Speech deltas emerge as the JSON streams, unescaped, stopping at the quote.
  {
    const extractor = createSpeechDeltaExtractor();
    let out = "";
    out += extractor.push('{"spee');
    assert.equal(out, "", "no emission before the key completes");
    out += extractor.push('ch": "Hey the');
    out += extractor.push('re! I\\u2019m on it.\\nDone.", "task": null}');
    assert.equal(out, "Hey there! I’m on it.\nDone.");
    assert.equal(extractor.finished, true);
    assert.equal(extractor.push('{"speech": "again"}'), "", "extractor stays finished");
  }

  // Escapes split across chunk boundaries survive.
  {
    const extractor = createSpeechDeltaExtractor();
    let out = "";
    out += extractor.push('{"speech": "a\\');
    out += extractor.push('"b\\u00e');
    out += extractor.push('9c"}');
    assert.equal(out, 'a"béc');
  }

  // Markdown fences / prose before the JSON are tolerated; plain prose never
  // emits (the caller speaks the fully-parsed reply instead).
  {
    const fenced = createSpeechDeltaExtractor();
    const out = fenced.push('```json\n{"speech": "Hello."}');
    assert.equal(out, "Hello.");
    const prose = createSpeechDeltaExtractor();
    assert.equal(prose.push("Sure, here you go."), "");
    assert.equal(prose.started, false);
  }

  // The 600-char spoken cap holds.
  {
    const extractor = createSpeechDeltaExtractor();
    const out = extractor.push(`{"speech": "${"x".repeat(700)}"}`);
    assert.equal(out.length, 600);
    assert.equal(extractor.finished, true);
  }

  // First sentence ships alone; later text accumulates into larger chunks.
  {
    const chunker = createSentenceChunker();
    const first = chunker.push("On it. I will check the fleet and report back with everything I find. ");
    assert.deepEqual(first, ["On it."], "first sentence emits immediately");
    const second = chunker.push("The collectors look healthy so far. ");
    assert.deepEqual(second, [], "later text accumulates until the next-chunk minimum");
    const third = chunker.push("Two agents are mid-task right now and nothing is blocked anywhere. ");
    assert.equal(third.length, 1, "accumulated sentences emit as one larger chunk");
    assert.ok(third[0].startsWith("I will check"), "chunk 2 starts after chunk 1");
    assert.ok(third[0].endsWith("blocked anywhere."), "chunk 2 ends at a sentence boundary");
    const rest = chunker.flush();
    assert.deepEqual(rest, [], "nothing left after clean sentence cuts");
  }

  // Decimals do not split; flush returns the unpunctuated remainder.
  {
    const chunker = createSentenceChunker();
    assert.deepEqual(chunker.push("It costs $5.50 in total"), []);
    assert.deepEqual(chunker.flush(), ["It costs $5.50 in total"]);
  }

  // A very long unpunctuated run still cuts at a word boundary.
  {
    const chunker = createSentenceChunker({ maxChunkChars: 40 });
    const chunks = chunker.push("word ".repeat(20));
    assert.ok(chunks.length >= 1, "cap forces a cut");
    assert.ok(chunks.every((chunk) => !chunk.includes("  ") && chunk.length <= 40));
  }
  console.log("speech stream extractor + chunker ok");
}

// --- fused-turn speech emitter ----------------------------------------------------
// The streaming converse action guarantees: the concatenation of emitted
// speech (since the last reset) equals what the buffered turn would have
// spoken — never more, at worst a divergent tail less.
{
  const { createVoiceSpeechEmitter } = await import(
    "../src/lib/services/queen-bee/voice-speech-stream.ts"
  );

  // Streaming JSON: deltas emit live; finalize with the same speech re-speaks nothing.
  {
    const events = [];
    const emitter = createVoiceSpeechEmitter((text) => events.push(text));
    emitter.onTextDelta('{"speech": "On it. ');
    emitter.onTextDelta('Checking now.", "task": null}');
    assert.equal(events.join(""), "On it. Checking now.");
    emitter.finalize("On it. Checking now.");
    assert.equal(events.join(""), "On it. Checking now.", "no re-speak on finalize");
  }

  // Task turns: the delegation receipt is emitted as a late speech suffix.
  {
    const events = [];
    const emitter = createVoiceSpeechEmitter((text) => events.push(text));
    emitter.onTextDelta(
      '{"speech": "Kicking that off.", "task": {"title": "t", "message": "m"}}',
    );
    assert.equal(events.join(""), "Kicking that off.");
    emitter.finalize("Kicking that off. It was delegated to the NYC agent.");
    assert.equal(
      events.join(""),
      "Kicking that off. It was delegated to the NYC agent.",
    );
  }

  // Non-JSON replies: silent during the stream, spoken whole at finalize.
  {
    const events = [];
    const emitter = createVoiceSpeechEmitter((text) => events.push(text));
    emitter.onTextDelta("Sure, here you go.");
    assert.deepEqual(events, [], "prose emits nothing mid-stream");
    emitter.finalize("Sure, here you go.");
    assert.deepEqual(events, ["Sure, here you go."]);
  }

  // Attempt fallback: emitted speech forces a reset; the retry starts clean.
  {
    const events = [];
    const emitter = createVoiceSpeechEmitter((text) => events.push(text));
    assert.equal(emitter.attemptReset(), false, "first attempt needs no reset");
    emitter.onTextDelta('{"speech": "Half a rep');
    assert.equal(events.join(""), "Half a rep");
    assert.equal(emitter.attemptReset(), true, "emitted speech must be discarded");
    assert.equal(
      emitter.attemptReset(),
      false,
      "nothing new emitted, no second reset",
    );
    emitter.onTextDelta('{"speech": "Fresh reply."}');
    emitter.finalize("Fresh reply.");
    assert.equal(emitter.emitted, "Fresh reply.");
    assert.equal(events.slice(1).join(""), "Fresh reply.");
  }

  // Divergent finalize never re-speaks (the screen text stays authoritative).
  {
    const events = [];
    const emitter = createVoiceSpeechEmitter((text) => events.push(text));
    emitter.onTextDelta('{"speech": "Alpha."}');
    emitter.finalize("Completely different reply.");
    assert.deepEqual(events, ["Alpha."], "no garbled overlap on divergence");
  }
  console.log("voice speech emitter ok");
}

// --- converse-stream NDJSON reader -------------------------------------------------
// The overlay races pump() against the barge-in signal; the shared in-flight
// promise must make an abandoned race unable to drop bytes or events.
{
  const { createNdjsonEventReader } = await import(
    "../src/features/queen-voice/converse-stream.ts"
  );
  const encoder = new TextEncoder();
  const streamOf = (chunks) =>
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });

  // Events split across network chunks parse whole; malformed lines skip.
  {
    const reader = createNdjsonEventReader(
      streamOf([
        '{"type":"speech","text":"He',
        'y."}\n{"type":"done"',
        ',"ok":true}\nnot-json\n',
      ]),
    );
    const events = [];
    while (await reader.pump()) events.push(...reader.take());
    events.push(...reader.take());
    assert.deepEqual(events, [
      { type: "speech", text: "Hey." },
      { type: "done", ok: true },
    ]);
  }

  // A final line without a trailing newline still lands at stream end.
  {
    const reader = createNdjsonEventReader(
      streamOf(['{"type":"done","ok":true}']),
    );
    while (await reader.pump()) {
      // Drain to the end; events are taken below.
    }
    assert.deepEqual(reader.take(), [{ type: "done", ok: true }]);
  }

  // Racing pump() never drops events (the barge-in shape): callers share the
  // in-flight promise, and an abandoned race still parses into the buffer.
  {
    const reader = createNdjsonEventReader(streamOf(['{"n":1}\n', '{"n":2}\n']));
    const inFlight = reader.pump();
    assert.equal(reader.pump(), inFlight, "pump is shared while in flight");
    const raced = await Promise.race([inFlight, Promise.resolve("abandoned")]);
    assert.equal(raced, "abandoned", "the race is abandoned before bytes settle");
    while (await reader.pump()) {
      // Drain to the end; events are taken below.
    }
    assert.deepEqual(reader.take(), [{ n: 1 }, { n: 2 }], "no event lost to the race");
  }
  console.log("converse-stream ndjson reader ok");
}

// --- OpenAI fallback SSE reader ----------------------------------------------------
// The streamed OpenAI conversation fallback must surface every token delta —
// including ones a runtime-frame filter would drop ("First,") — and tolerate
// frames split across network chunks plus the [DONE] sentinel.
{
  const { readOpenAiSseText } = await import(
    "../src/lib/services/queen-bee/voice-turn.ts"
  );
  const encoder = new TextEncoder();
  const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
  const frames =
    sse({ choices: [{ delta: { content: "First," } }] }) +
    sse({ choices: [{ delta: { content: " check" } }] }).slice(0, 20);
  const tail =
    sse({ choices: [{ delta: { content: " check" } }] }).slice(20) +
    sse({ choices: [{ delta: { content: " the fleet." } }] }) +
    "data: [DONE]\n\n";
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(frames));
      controller.enqueue(encoder.encode(tail));
      controller.close();
    },
  });
  const deltas = [];
  const text = await readOpenAiSseText(new Response(body), (delta) =>
    deltas.push(delta),
  );
  assert.equal(text, "First, check the fleet.");
  assert.equal(deltas.join(""), "First, check the fleet.");
  assert.ok(deltas.length >= 3, "deltas stream individually");
  console.log("openai fallback sse reader ok");
}

// --- runtime stream error frames fail the attempt ----------------------------------
// A mid-stream runtime error used to be swallowed (sseTextFromPayload's error
// throw is self-caught), silently truncating the reply — with streamed TTS the
// truncation would be spoken. readRuntimeResponseText must reject instead so
// the attempt falls back (cooldown → OpenAI) and the client gets a reset.
{
  const { readRuntimeResponseText } = await import(
    "../src/lib/services/phone/runtime-voice-turn.ts"
  );
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"choices":[{"delta":{"content":"Half a "}}]}\n\n'),
      );
      controller.enqueue(
        encoder.encode('data: {"type":"chat.error","error":"provider rejected the key"}\n\n'),
      );
      controller.close();
    },
  });
  const deltas = [];
  await assert.rejects(
    () => readRuntimeResponseText(new Response(body), undefined, (d) => deltas.push(d)),
    /provider rejected the key/,
    "error frames reject the attempt instead of truncating",
  );
  assert.deepEqual(deltas, ["Half a "], "deltas before the error still streamed");
  console.log("runtime stream error propagation ok");
}

// --- reasoning filter never eats streamed delta fragments ---------------------------
// The reasoning-preamble filter is tuned for whole-message runtime frames. On
// streaming runtimes sseTextFromPayload runs per token delta, so it must pass
// innocent mid-sentence fragments like "First," through untouched — a dropped
// delta vanishes from BOTH the collected reply and the spoken TTS stream.
{
  const { readRuntimeResponseText, sseTextFromPayload } = await import(
    "../src/lib/services/phone/runtime-voice-turn.ts"
  );

  // Delta shapes survive, whatever the fragment looks like.
  assert.equal(
    sseTextFromPayload(JSON.stringify({ choices: [{ delta: { content: "First," } }] })),
    "First,",
    "OpenAI-style delta fragment survives the filter",
  );
  assert.equal(
    sseTextFromPayload(JSON.stringify({ event: { delta: "Let's" } })),
    "Let's",
    "event.delta fragment survives",
  );
  assert.equal(
    sseTextFromPayload(JSON.stringify({ delta: "we need" })),
    "we need",
    "top-level delta fragment survives",
  );

  // Whole-message reasoning preambles are still dropped; real replies pass.
  assert.equal(
    sseTextFromPayload(
      JSON.stringify({ choices: [{ message: { content: "We need to check the fleet first." } }] }),
    ),
    "",
    "whole-message reasoning frame still filtered",
  );
  assert.equal(
    sseTextFromPayload(JSON.stringify({ content: "Let's see what the user asked." })),
    "",
    "bare content reasoning frame still filtered",
  );
  assert.equal(
    sseTextFromPayload(
      JSON.stringify({ choices: [{ message: { content: "The fleet is healthy." } }] }),
    ),
    "The fleet is healthy.",
    "ordinary whole-message reply passes",
  );

  // End to end: a streamed reply that opens with "First," reaches both the
  // collected text and the sentence-streaming TTS sink intact.
  const encoder = new TextEncoder();
  const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sse({ choices: [{ delta: { content: "First," } }] })));
      controller.enqueue(encoder.encode(sse({ choices: [{ delta: { content: " check the fleet." } }] })));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const deltas = [];
  const text = await readRuntimeResponseText(new Response(body), undefined, (delta) =>
    deltas.push(delta),
  );
  assert.equal(text, "First, check the fleet.", "reply text keeps the leading delta");
  assert.equal(deltas.join(""), "First, check the fleet.", "TTS deltas keep the leading delta");
  console.log("reasoning filter delta passthrough ok");
}

// --- tool activity labels --------------------------------------------------------
{
  assert.equal(
    toolActivityLabel(JSON.stringify({ type: "chat.tool.start", name: "run_command" })),
    "Using run_command",
  );
  assert.equal(
    toolActivityLabel(JSON.stringify({ type: "chat.tool.progress", tool: "web_search" })),
    "Using web_search",
  );
  assert.equal(
    toolActivityLabel(JSON.stringify({ type: "chat.tool.start" })),
    "Using a tool",
    "unnamed tools still surface",
  );
  assert.equal(
    toolActivityLabel(JSON.stringify({ type: "chat.tool.done", name: "run_command" })),
    "",
    "completions do not create a new stage",
  );
  assert.equal(toolActivityLabel(JSON.stringify({ type: "chat.text", delta: "hi" })), "");
  assert.equal(toolActivityLabel("not json"), "");
  console.log("tool activity labels ok");
}

// --- barge-in echo-floor detector ------------------------------------------------
{
  const FRAME_MS = 16;
  const run = (detector, rms, fromMs, toMs) => {
    for (let at = fromMs; at <= toMs; at += FRAME_MS) {
      updateBargeInDetector(detector, typeof rms === "function" ? rms(at) : rms, at);
      if (detector.triggered) return at;
    }
    return 0;
  };

  // Steady speaker bleed (echo) louder than the absolute floor must calibrate
  // in, raise the threshold, and never self-interrupt.
  {
    const detector = createBargeInDetector(0);
    const triggeredAt = run(detector, 0.06, 0, 5_000);
    assert.equal(triggeredAt, 0, "steady playback echo never triggers barge-in");
    assert.ok(
      bargeInThreshold(detector) > 0.12,
      `echo floor raised the threshold (got ${bargeInThreshold(detector).toFixed(3)})`,
    );
  }

  // The user talking over quiet echo triggers after the sustain window.
  {
    const detector = createBargeInDetector(0);
    run(detector, 0.015, 0, 1_000); // calibrate on faint echo
    const triggeredAt = run(detector, 0.18, 1_016, 4_000);
    assert.ok(triggeredAt > 0, "sustained loud speech triggers");
    assert.ok(
      triggeredAt - 1_016 >= BARGE_IN_TUNING.sustainMs - FRAME_MS,
      "trigger respects the sustain window",
    );
  }

  // The user talking over LOUD echo still triggers (well above the floor).
  {
    const detector = createBargeInDetector(0);
    run(detector, 0.06, 0, 1_500);
    const triggeredAt = run(detector, 0.4, 1_516, 5_000);
    assert.ok(triggeredAt > 0, "speech well above loud echo triggers");
  }

  // A brief transient (door slam) shorter than the sustain window is ignored.
  {
    const detector = createBargeInDetector(0);
    run(detector, 0.015, 0, 1_000);
    run(detector, 0.3, 1_016, 1_216); // ~200ms spike
    assert.equal(detector.triggered, false, "short transients do not trigger");
    const after = run(detector, 0.015, 1_232, 2_500);
    assert.equal(after, 0, "returns to quiet without triggering");
  }

  // Nothing can trigger during the calibration grace window.
  {
    const detector = createBargeInDetector(0);
    const triggeredAt = run(detector, 0.4, 0, BARGE_IN_TUNING.graceMs - FRAME_MS);
    assert.equal(triggeredAt, 0, "grace window never triggers");
  }

  // A muted mic (zero frames) never triggers.
  {
    const detector = createBargeInDetector(0);
    const triggeredAt = run(detector, 0, 0, 3_000);
    assert.equal(triggeredAt, 0, "muted mic never triggers");
  }

  // The stutter regression (2026-07-02): a gappy stream calibrates the floor
  // on SILENCE; when her voice resumes, the bleed would read as sustained
  // speech and self-interrupt. Underrun-driven recalibration prevents it.
  {
    // Grace window full of underrun silence -> floor near zero.
    const detector = createBargeInDetector(0);
    run(detector, 0, 0, BARGE_IN_TUNING.graceMs + 200);
    // Playback resumes; the watcher reports the gap -> recalibrate.
    requestBargeInRecalibration(detector, BARGE_IN_TUNING.graceMs + 216);
    const triggeredAt = run(detector, 0.06, BARGE_IN_TUNING.graceMs + 216, 6_000);
    assert.equal(triggeredAt, 0, "resumed playback bleed never triggers after recalibration");
    assert.ok(
      bargeInThreshold(detector) > 0.12,
      "recalibration re-learned the echo floor",
    );
    // The user interrupting AFTER the recalibration window still works.
    const speechAt = run(detector, 0.4, 6_016, 9_000);
    assert.ok(speechAt > 0, "real speech still triggers after gap recovery");
  }

  // Same scenario WITHOUT recalibration self-triggers (documents why the
  // watcher must report gaps; if this stops failing, the guard is redundant).
  {
    const detector = createBargeInDetector(0);
    run(detector, 0, 0, BARGE_IN_TUNING.graceMs + 200);
    const triggeredAt = run(detector, 0.06, BARGE_IN_TUNING.graceMs + 216, 6_000);
    assert.ok(triggeredAt > 0, "silence-calibrated floor self-triggers without recalibration");
  }

  // 2026-07-04 regression guard: recalibration is anchored at the audio RESUME
  // and kept short (recalibrateMs), so a user speaking mid-reply — between the
  // resume onsets — still breaks in. The bug this replaces fired a 1000ms
  // window at EVERY chunk seam, which blanketed the reply and made her
  // un-interruptible (barge-in trigger rate 0%).
  {
    const detector = createBargeInDetector(0);
    // Session start + her bleed established, then a chunk resumes -> a short
    // recalibration window absorbs the bleed onset.
    run(detector, 0.03, 0, 1_000);
    requestBargeInRecalibration(detector, 1_000);
    const windowEnd = 1_000 + BARGE_IN_TUNING.recalibrateMs;
    run(detector, 0.03, 1_000, windowEnd + 200);
    // Once the window closes the user talks over her continuing bleed and MUST
    // break in within the sustain window — not be absorbed into the floor.
    const start = windowEnd + 208;
    const triggeredAt = run(detector, 0.18, start, start + 2_000);
    assert.ok(triggeredAt > 0, "user interrupts after a resume-recalibration window");
    assert.ok(
      triggeredAt - start <= BARGE_IN_TUNING.sustainMs + 3 * FRAME_MS,
      `barge-in fires within the sustain window (took ${triggeredAt - start}ms)`,
    );
    // The window must be short enough to leave most of a typical ~2.5s chunk
    // interruptible; a full-second window would recreate the blanket bug.
    assert.ok(
      BARGE_IN_TUNING.recalibrateMs <= 700,
      "resume-recalibration window stays short",
    );
  }

  // 2026-07-04 onset-coincidence guard: once her bleed is ESTABLISHED, a
  // resume-recalibration window still absorbs her own continuing bleed (no
  // self-trigger), but a user talking over it — louder than any bleed she has
  // produced — breaks in mid-window instead of being latched into the floor.
  // This is the residual "onset latch": before the peak-keyed guard, starting
  // to talk exactly as a new sentence resumed stayed deaf for a few pauses.
  {
    // Establish her bleed, then open a resume window: her own bleed is absorbed.
    const quiet = createBargeInDetector(0);
    run(quiet, 0.03, 0, 1_500);
    assert.ok(quiet.peakFloor > BARGE_IN_TUNING.initialFloor, "her bleed is established");
    requestBargeInRecalibration(quiet, 1_500);
    assert.equal(quiet.guardActiveWindow, true, "guard arms once bleed is established");
    const noTrigger = run(quiet, 0.03, 1_516, 1_516 + BARGE_IN_TUNING.recalibrateMs);
    assert.equal(noTrigger, 0, "her own resumed bleed is absorbed, not read as barge-in");

    // Same established window, but the user talks over her from the instant it
    // opens; a conversational level (well above her bleed ceiling) must break in.
    const loud = createBargeInDetector(0);
    run(loud, 0.03, 0, 1_500);
    requestBargeInRecalibration(loud, 1_500);
    const start = 1_516;
    const onsetAt = run(loud, 0.3, start, start + 1_500);
    assert.ok(onsetAt > 0, "user breaks in during an established-bleed resume window");
    assert.ok(
      onsetAt - start <= BARGE_IN_TUNING.sustainMs + 4 * FRAME_MS,
      `onset-coincidence fires within the sustain window (took ${onsetAt - start}ms)`,
    );
  }

  // The gate that keeps the guard safe: an UNESTABLISHED resume window (silent
  // grace / synth TTFB > grace, so no bleed reference yet) falls back to
  // unconditional absorb. Her first resumed bleed — louder than the near-zero
  // floor but the only bleed sample there is — must NOT self-trigger. This is
  // the trap an ungated peak-keyed guard reopens (it lets that first bleed pass
  // its own amplitude discriminator); the establishment gate closes it.
  {
    const detector = createBargeInDetector(0);
    run(detector, 0, 0, BARGE_IN_TUNING.graceMs + 200); // slow synth: grace is silent
    requestBargeInRecalibration(detector, BARGE_IN_TUNING.graceMs + 216);
    assert.equal(
      detector.guardActiveWindow,
      false,
      "guard stays disarmed with no established bleed reference",
    );
    const triggeredAt = run(detector, 0.06, BARGE_IN_TUNING.graceMs + 216, 6_000);
    assert.equal(triggeredAt, 0, "first resumed bleed after a slow synth never self-triggers");
  }
  console.log("barge-in echo-floor detector ok");
}

console.log("test-queen-voice-working: all assertions passed");
