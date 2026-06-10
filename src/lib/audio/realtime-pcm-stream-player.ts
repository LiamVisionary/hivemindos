"use client";

export type RealtimePcmPlaybackMetrics = {
  firstByteMs: number;
  firstAudioMs: number;
  firstAudioAt: number;
  underruns: number;
  underrunMs: number;
  playbackTailMs: number;
};

export type RealtimePcmStreamPlayerOptions = {
  channels: number;
  sampleRate: number;
  startBufferMs?: number;
  maxBufferMs?: number;
  signal?: AbortSignal;
  onFirstByte?: (elapsedMs: number) => void;
  onFirstAudio?: (elapsedMs: number) => void;
  onUnderrun?: (event: { underruns: number; bufferedMs: number }) => void;
};

type WorkletEvent =
  | { type: "started"; playedFrames: number }
  | { type: "ended"; playedFrames: number; underruns: number; underrunFrames: number }
  | { type: "underrun"; underruns: number; bufferedFrames: number }
  | { type: "stats"; bufferedFrames: number; playedFrames: number; underruns: number; underrunFrames: number };

const WORKLET_PROCESSOR_NAME = "hivemind-realtime-pcm-player";
const DEFAULT_START_BUFFER_MS = 520;

const workletSource = `
class HivemindRealtimePcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = 1;
    this.queue = [];
    this.bufferedFrames = 0;
    this.playedFrames = 0;
    this.underruns = 0;
    this.underrunFrames = 0;
    this.started = false;
    this.ended = false;
    this.endedPosted = false;
    this.wasUnderrunning = false;
    this.lastStatsFrame = 0;
    this.port.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === "configure") {
        this.channels = Math.max(1, Math.floor(message.channels || 1));
      } else if (message.type === "write") {
        const channelData = Array.isArray(message.channelData) ? message.channelData : [];
        const frames = Math.max(0, Math.floor(message.frames || 0));
        if (frames > 0 && channelData.length > 0) {
          this.queue.push({ channelData, frames, offset: 0 });
          this.bufferedFrames += frames;
        }
      } else if (message.type === "start") {
        this.started = true;
        this.port.postMessage({ type: "started", playedFrames: this.playedFrames });
      } else if (message.type === "end") {
        this.ended = true;
      } else if (message.type === "stop") {
        this.queue = [];
        this.bufferedFrames = 0;
        this.ended = true;
        this.endedPosted = true;
        this.port.postMessage({
          type: "ended",
          playedFrames: this.playedFrames,
          underruns: this.underruns,
          underrunFrames: this.underrunFrames,
        });
      }
    };
  }

  fillFromQueue(outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return 0;
    const outputFrames = output[0].length;
    for (let channel = 0; channel < output.length; channel += 1) {
      output[channel].fill(0);
    }
    if (!this.started) return 0;

    let written = 0;
    while (written < outputFrames) {
      const head = this.queue[0];
      if (!head) break;
      if (this.wasUnderrunning) {
        this.wasUnderrunning = false;
      }
      const available = head.frames - head.offset;
      const take = Math.min(outputFrames - written, available);
      for (let channel = 0; channel < output.length; channel += 1) {
        const sourceChannel = head.channelData[Math.min(channel, head.channelData.length - 1)];
        if (sourceChannel) {
          output[channel].set(sourceChannel.subarray(head.offset, head.offset + take), written);
        }
      }
      head.offset += take;
      this.bufferedFrames = Math.max(0, this.bufferedFrames - take);
      this.playedFrames += take;
      written += take;
      if (head.offset >= head.frames) this.queue.shift();
    }

    if (written < outputFrames && !this.ended) {
      this.underrunFrames += outputFrames - written;
      if (!this.wasUnderrunning) {
        this.wasUnderrunning = true;
        this.underruns += 1;
        this.port.postMessage({
          type: "underrun",
          underruns: this.underruns,
          bufferedFrames: this.bufferedFrames,
        });
      }
    }
    return written;
  }

  process(inputs, outputs) {
    this.fillFromQueue(outputs);
    if (this.ended && !this.queue.length && !this.endedPosted) {
      this.endedPosted = true;
      this.port.postMessage({
        type: "ended",
        playedFrames: this.playedFrames,
        underruns: this.underruns,
        underrunFrames: this.underrunFrames,
      });
    }
    if (currentFrame - this.lastStatsFrame >= sampleRate / 5) {
      this.lastStatsFrame = currentFrame;
      this.port.postMessage({
        type: "stats",
        bufferedFrames: this.bufferedFrames,
        playedFrames: this.playedFrames,
        underruns: this.underruns,
        underrunFrames: this.underrunFrames,
      });
    }
    return true;
  }
}
registerProcessor("${WORKLET_PROCESSOR_NAME}", HivemindRealtimePcmPlayer);
`;

function getAudioContextClass() {
  const audioWindow = window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  return audioWindow.AudioContext || audioWindow.webkitAudioContext;
}

function postToWorklet(node: AudioWorkletNode, message: Record<string, unknown>, transfer?: Transferable[]) {
  if (transfer?.length) {
    node.port.postMessage(message, transfer);
    return;
  }
  node.port.postMessage(message);
}

function splitPcm16Channels(pcm: Int16Array, channels: number) {
  const frameCount = Math.floor(pcm.length / channels);
  const channelData = Array.from({ length: channels }, () => new Float32Array(frameCount));
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      channelData[channel][frame] = Math.max(-1, Math.min(1, (pcm[frame * channels + channel] ?? 0) / 32768));
    }
  }
  return channelData;
}

function resampleChannel(input: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate) return input;
  const outputLength = Math.max(1, Math.round(input.length * outputRate / inputRate));
  const output = new Float32Array(outputLength);
  const ratio = inputRate / outputRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const mix = position - left;
    output[index] = (input[left] ?? 0) * (1 - mix) + (input[right] ?? 0) * mix;
  }
  return output;
}

function hasAudiblePcm(pcm: Int16Array) {
  for (let index = 0; index < pcm.length; index += 1) {
    if (Math.abs(pcm[index] ?? 0) > 512) return true;
  }
  return false;
}

async function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeout = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
}

export class RealtimePcmStreamPlayer {
  private readonly inputChannels: number;
  private readonly inputSampleRate: number;
  private readonly startBufferMs: number;
  private readonly signal?: AbortSignal;
  private readonly onUnderrun?: (event: { underruns: number; bufferedMs: number }) => void;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private node: AudioWorkletNode | null = null;
  private workletUrl = "";
  private outputSampleRate = 0;
  private bufferedFrames = 0;
  private writtenFrames = 0;
  private started = false;
  private firstAudioMs = 0;
  private firstAudioAt = 0;
  private underruns = 0;
  private underrunFrames = 0;
  private ended = false;
  private endResolver: (() => void) | null = null;

  constructor(options: RealtimePcmStreamPlayerOptions) {
    this.inputChannels = Math.max(1, Math.floor(options.channels || 1));
    this.inputSampleRate = Math.max(1, Math.floor(options.sampleRate || 24_000));
    this.startBufferMs = Math.max(40, options.startBufferMs ?? DEFAULT_START_BUFFER_MS);
    this.signal = options.signal;
    this.onUnderrun = options.onUnderrun;
  }

  async connect() {
    if (this.context && this.node) return;
    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) throw new Error("Web Audio is not available in this browser.");
    const context = new AudioContextClass({ latencyHint: "interactive" });
    await waitWithTimeout(context.resume().catch(() => undefined), 2_000, "AudioContext resume");
    this.outputSampleRate = context.sampleRate;
    this.workletUrl = URL.createObjectURL(new Blob([workletSource], { type: "application/javascript" }));
    if (!context.audioWorklet || !window.AudioWorkletNode) {
      throw new Error("AudioWorklet is not available in this browser.");
    }
    await waitWithTimeout(context.audioWorklet.addModule(this.workletUrl), 5_000, "AudioWorklet module load");
    const node = new AudioWorkletNode(context, WORKLET_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [this.inputChannels],
    });
    const gain = context.createGain();
    gain.gain.value = 1;
    node.connect(gain);
    gain.connect(context.destination);
    node.port.onmessage = (event: MessageEvent<WorkletEvent>) => this.handleWorkletEvent(event.data);
    postToWorklet(node, { type: "configure", channels: this.inputChannels });
    this.context = context;
    this.node = node;
    this.gain = gain;
  }

  feedPcm16(bytes: Uint8Array) {
    if (!this.node || !this.context || !bytes.byteLength) return false;
    if (this.signal?.aborted) return false;
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const channelData = splitPcm16Channels(pcm, this.inputChannels)
      .map((channel) => resampleChannel(channel, this.inputSampleRate, this.outputSampleRate));
    const frames = channelData[0]?.length ?? 0;
    if (frames <= 0) return false;
    this.writtenFrames += frames;
    this.bufferedFrames += frames;
    postToWorklet(
      this.node,
      { type: "write", channelData, frames },
      channelData.map((channel) => channel.buffer as ArrayBuffer),
    );
    if (!this.started && this.bufferedFrames >= this.startFrames) {
      this.started = true;
      postToWorklet(this.node, { type: "start" });
    }
    return hasAudiblePcm(pcm);
  }

  end() {
    if (!this.started && this.bufferedFrames > 0 && this.node) {
      this.started = true;
      postToWorklet(this.node, { type: "start" });
    }
    if (this.node) postToWorklet(this.node, { type: "end" });
  }

  async waitForEnd() {
    if (this.ended) return;
    const timeoutMs = Math.max(1_000, (this.bufferedFrames / Math.max(1, this.outputSampleRate)) * 1000 + 1_500);
    await Promise.race([
      new Promise<void>((resolve) => {
        this.endResolver = resolve;
      }),
      new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
    ]);
  }

  async stop() {
    if (this.node) postToWorklet(this.node, { type: "stop" });
    try {
      this.node?.disconnect();
      this.gain?.disconnect();
    } catch {
      // Nodes may already be disconnected during interruption.
    }
    this.node = null;
    this.gain = null;
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
    this.workletUrl = "";
    await this.context?.close().catch(() => undefined);
    this.context = null;
    this.endResolver?.();
    this.endResolver = null;
  }

  metrics(): RealtimePcmPlaybackMetrics {
    return {
      firstByteMs: 0,
      firstAudioMs: this.firstAudioMs,
      firstAudioAt: this.firstAudioAt,
      underruns: this.underruns,
      underrunMs: Math.round(this.underrunFrames / Math.max(1, this.outputSampleRate) * 1000),
      playbackTailMs: Math.round(this.bufferedFrames / Math.max(1, this.outputSampleRate) * 1000),
    };
  }

  private get startFrames() {
    return Math.max(128, Math.floor(this.outputSampleRate * this.startBufferMs / 1000));
  }

  private handleWorkletEvent(event: WorkletEvent) {
    if (event.type === "started") {
      const now = Date.now();
      this.firstAudioAt = now;
      return;
    }
    if (event.type === "stats") {
      this.bufferedFrames = event.bufferedFrames;
      this.underruns = event.underruns;
      this.underrunFrames = event.underrunFrames;
      return;
    }
    if (event.type === "underrun") {
      this.underruns = event.underruns;
      this.onUnderrun?.({
        underruns: event.underruns,
        bufferedMs: Math.round(event.bufferedFrames / Math.max(1, this.outputSampleRate) * 1000),
      });
      return;
    }
    if (event.type === "ended") {
      this.ended = true;
      this.underruns = event.underruns;
      this.underrunFrames = event.underrunFrames;
      this.bufferedFrames = 0;
      this.endResolver?.();
      this.endResolver = null;
    }
  }
}

export async function playRealtimePcmStream(response: Response, options: RealtimePcmStreamPlayerOptions & { startedAt: number }) {
  if (!response.body) throw new Error("Local TTS returned an empty audio stream.");
  const sampleRate = Number(response.headers.get("x-audio-sample-rate")) || options.sampleRate || 24_000;
  const channels = Math.max(1, Number(response.headers.get("x-audio-channels")) || options.channels || 1);
  const player = new RealtimePcmStreamPlayer({ ...options, channels, sampleRate });
  await player.connect();
  const reader = response.body.getReader();
  const bytesPerFrame = channels * 2;
  let carry = new Uint8Array(0);
  let firstByteMs = 0;
  let firstAudioMs = 0;

  const feed = (chunk: Uint8Array) => {
    const bytes = carry.byteLength ? new Uint8Array(carry.byteLength + chunk.byteLength) : chunk;
    if (carry.byteLength) {
      bytes.set(carry, 0);
      bytes.set(chunk, carry.byteLength);
    }
    const usableLength = bytes.byteLength - (bytes.byteLength % bytesPerFrame);
    carry = usableLength === bytes.byteLength ? new Uint8Array(0) : bytes.slice(usableLength);
    if (usableLength <= 0) return;
    const audible = player.feedPcm16(bytes.slice(0, usableLength));
    if (audible && !firstAudioMs) {
      firstAudioMs = Date.now() - options.startedAt;
    }
  };

  try {
    for (;;) {
      if (options.signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (!firstByteMs) {
        firstByteMs = Date.now() - options.startedAt;
        options.onFirstByte?.(firstByteMs);
      }
      feed(value);
    }
    if (carry.byteLength >= bytesPerFrame) {
      player.feedPcm16(carry.slice(0, carry.byteLength - (carry.byteLength % bytesPerFrame)));
    }
    player.end();
    await player.waitForEnd();
  } finally {
    await reader.cancel().catch(() => undefined);
    await player.stop();
  }

  const metrics = player.metrics();
  const playbackFirstAudioMs = metrics.firstAudioAt ? metrics.firstAudioAt - options.startedAt : firstAudioMs;
  if (playbackFirstAudioMs) options.onFirstAudio?.(playbackFirstAudioMs);
  return {
    ...metrics,
    firstByteMs,
    firstAudioMs: playbackFirstAudioMs || firstAudioMs,
    firstAudioAt: metrics.firstAudioAt || (firstAudioMs ? options.startedAt + firstAudioMs : 0),
  };
}
