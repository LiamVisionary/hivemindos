type PcmPreviewPlayerOptions = {
  channels?: number;
  sampleRate: number;
  signal?: AbortSignal;
};

const PREVIEW_PRIME_AUDIO_SRC = "/audio/sfx/scifi-ping.wav";

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function pcm16Wav(encoded: ArrayBuffer, channels: number, sampleRate: number) {
  const blockAlign = channels * 2;
  const dataLength = encoded.byteLength - (encoded.byteLength % blockAlign);
  if (dataLength <= 0) throw new Error("Voice preview returned no audio.");
  const wav = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wav);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);
  new Uint8Array(wav, 44).set(new Uint8Array(encoded, 0, dataLength));
  return new Blob([wav], { type: "audio/wav" });
}

/**
 * Short previews use one media element that starts silently inside the click
 * gesture and stays active while the provider synthesizes. Replacing its
 * source afterward keeps WebKit's playback grant without involving the live
 * voice streaming pipeline.
 */
export function createPcmPreviewPlayer() {
  const audio = new Audio(PREVIEW_PRIME_AUDIO_SRC);
  audio.preload = "auto";
  audio.loop = true;
  audio.volume = 0;
  const unlockPromise = audio.play();
  void unlockPromise.catch(() => undefined);
  let previewUrl = "";

  return {
    async play(response: Response, options: PcmPreviewPlayerOptions) {
      const channels = Math.max(1, Math.floor(options.channels ?? 1));
      const sampleRate = Math.max(1, Math.floor(options.sampleRate));
      const encoded = await response.arrayBuffer();
      if (options.signal?.aborted) throw new DOMException("Voice preview cancelled.", "AbortError");
      try {
        await unlockPromise;
      } catch {
        throw new Error("Voice preview audio was blocked by the browser. Click Preview again to allow playback.");
      }

      audio.pause();
      audio.loop = false;
      previewUrl = URL.createObjectURL(pcm16Wav(encoded, channels, sampleRate));
      audio.src = previewUrl;
      audio.volume = 1;
      audio.currentTime = 0;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          options.signal?.removeEventListener("abort", stop);
          audio.onended = null;
          audio.onerror = null;
          if (error) reject(error);
          else resolve();
        };
        const stop = () => {
          audio.pause();
          finish(new DOMException("Voice preview cancelled.", "AbortError"));
        };
        options.signal?.addEventListener("abort", stop, { once: true });
        audio.onended = () => finish();
        audio.onerror = () => finish(new Error("The browser could not decode the voice preview."));
        void audio.play().catch(() => {
          finish(new Error("Voice preview audio was blocked by the browser. Click Preview again to allow playback."));
        });
      });
    },
    async close() {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
  };
}
