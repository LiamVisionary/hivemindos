"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Webcam capture for advanced voice mode. Opens a video-only getUserMedia
 * stream (audio stays owned by the realtime voice session), exposes a ref to
 * bind to a preview <video>, and samples downscaled JPEG frames on an interval,
 * handing each frame's base64 payload to onFrame. The consumer forwards those
 * frames into the live realtime session (OpenAI Realtime image input / Gemini
 * Live native video), so the model can "see" what the camera points at while
 * the user talks. Video only — never audio — so it composes with the existing
 * echo-cancelled mic capture.
 */
export function useQueenCamera(onFrame: (base64Jpeg: string) => void, intervalMs = 1500) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onFrameRef = useRef(onFrame);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    setError("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Camera not available on this device.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setActive(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the camera.");
      setActive(false);
    }
  }, []);

  const toggle = useCallback(() => {
    if (active) stop();
    else void start();
  }, [active, start, stop]);

  useEffect(() => {
    if (!active) return undefined;
    let stopped = false;
    const canvas = canvasRef.current ?? (canvasRef.current = document.createElement("canvas"));
    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      if (!video || !video.videoWidth) return;
      const width = 640;
      const height = Math.round((video.videoHeight / video.videoWidth) * width) || 480;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, width, height);
      const base64 = canvas.toDataURL("image/jpeg", 0.6).split(",")[1] ?? "";
      if (base64) onFrameRef.current(base64);
    };
    const timer = window.setInterval(tick, Math.max(400, intervalMs));
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [active, intervalMs]);

  useEffect(() => () => stop(), [stop]);

  return { active, error, videoRef, start, stop, toggle };
}
