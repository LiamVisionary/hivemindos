"use client";

import * as React from "react";
import {
  QUEEN_CLAP_ANALYSER_FFT_SIZE,
  QUEEN_CLAP_PROCESSOR_BUFFER_SIZE,
  initialQueenClapDetectorState,
  measureFrequencyClapFrame,
  measureFloatTimeDomainClapFrame,
  nextQueenClapDetectorState,
} from "./clap-activation";

type QueenClapActivationStatus =
  | "off"
  | "starting"
  | "listening"
  | "paused"
  | "error";

type QueenClapActivationOptions = {
  enabled: boolean;
  paused: boolean;
  onActivation: () => void;
};

const CLAP_WAKE_AUDIO: MediaTrackConstraints = {
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
};

type AudioContextWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

function createBrowserAudioContext() {
  const browserWindow = window as AudioContextWindow;
  const AudioContextCtor =
    browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
  if (!AudioContextCtor) throw new Error("AudioContext is not available.");
  return new AudioContextCtor();
}

function clapActivationErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone permission is needed for clap wake.";
  }
  return error instanceof Error
    ? error.message
    : "Could not start clap wake.";
}

export function useQueenClapActivation({
  enabled,
  paused,
  onActivation,
}: QueenClapActivationOptions) {
  const [status, setStatus] =
    React.useState<QueenClapActivationStatus>("starting");
  const [error, setError] = React.useState("");
  const onActivationRef = React.useRef(onActivation);

  React.useEffect(() => {
    onActivationRef.current = onActivation;
  }, [onActivation]);

  React.useEffect(() => {
    if (!enabled || paused) return undefined;

    let disposed = false;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let silentGain: GainNode | null = null;
    let detectorState = initialQueenClapDetectorState;
    let previousFrequencyData: Uint8Array | null = null;

    const cleanup = () => {
      if (processor) processor.onaudioprocess = null;
      try {
        processor?.disconnect();
        silentGain?.disconnect();
        source?.disconnect();
      } catch {
        // Audio nodes may already be detached during rapid toggle/permission churn.
      }
      processor = null;
      silentGain = null;
      source = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      void audioContext?.close().catch(() => undefined);
      audioContext = null;
      analyser = null;
    };

    const start = async () => {
      await Promise.resolve();
      if (disposed) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setError("Microphone access is not available for clap wake.");
        return;
      }
      setStatus("starting");
      setError("");
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: CLAP_WAKE_AUDIO,
        });
        if (disposed) {
          cleanup();
          return;
        }

        audioContext = createBrowserAudioContext();
        await audioContext.resume().catch(() => undefined);
        source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = QUEEN_CLAP_ANALYSER_FFT_SIZE;
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser);
        processor = audioContext.createScriptProcessor(
          QUEEN_CLAP_PROCESSOR_BUFFER_SIZE,
          1,
          1,
        );
        silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);

        const frequencyData = new Uint8Array(analyser.frequencyBinCount);
        setStatus("listening");

        processor.onaudioprocess = (event) => {
          if (disposed || !analyser || !audioContext) return;
          analyser.getByteFrequencyData(frequencyData);
          const measured = {
            ...measureFloatTimeDomainClapFrame(
              event.inputBuffer.getChannelData(0),
            ),
            ...measureFrequencyClapFrame(
              frequencyData,
              audioContext.sampleRate,
              previousFrequencyData,
            ),
          };
          if (!previousFrequencyData) {
            previousFrequencyData = new Uint8Array(frequencyData.length);
          }
          previousFrequencyData.set(frequencyData);
          const result = nextQueenClapDetectorState(detectorState, {
            ...measured,
            nowMs: performance.now(),
          });
          detectorState = result.state;
          if (result.activated) onActivationRef.current();
        };
      } catch (startError) {
        cleanup();
        if (!disposed) {
          setStatus("error");
          setError(clapActivationErrorMessage(startError));
        }
      }
    };

    void start();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [enabled, paused]);

  const effectiveStatus: QueenClapActivationStatus = !enabled
    ? "off"
    : paused
      ? "paused"
      : status;

  return {
    status: effectiveStatus,
    error: effectiveStatus === "error" ? error : "",
  };
}
