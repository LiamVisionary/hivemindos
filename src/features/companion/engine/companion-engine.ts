"use client";

/* companion-engine.ts — the plain-three.js orchestrator for the hologram
 * companion. Owns the renderer/scene/camera and composes the subsystems
 * ported from ami-ai-companion:
 *
 *   vrm-loader        → Sara Lite VRM (meshopt, WebGL MToon)
 *   animation/        → GLB idle + gesture clips (Mixamo→VRM retargeted)
 *   procedural/       → breathing/sway/micro-motion + head tracking
 *   lip-sync/         → mouth visemes, driven by the Queen's live TTS level
 *   expressions/      → emotional state → face channels (expressions2)
 *   blink-controller  → autonomous blinking
 *   hologram          → the scanline/fresnel hologram material override
 *
 * The Queen link: per-utterance events (`subscribeQueenUtterance` — chunk
 * text + real clip duration, published at true audio start) drive ami-parity
 * phoneme/viseme lip sync; `readQueenVoiceAmplitude()` is the per-frame
 * fallback for paths without utterance events, and speaking on/off edges gate
 * the procedural "conversation" posture + gaze. Reply text arrives through
 * `reactToReply` and turns into an expression tone + one-shot gesture.
 */

import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import {
  readQueenVoiceAmplitude,
  subscribeQueenUtterance,
  subscribeQueenVoiceSpeaking,
} from "@/lib/audio/queen-voice-amplitude";
import {
  COMPANION_IDLE_ASSETS,
  SARA_LITE_MODEL,
  SARA_OUTFIT_ASSETS,
  companionAssetByKey,
} from "../companion-assets";
import {
  applySaraOutfit,
  getSaraOutfitHandle,
  saraOutfitByKey,
  type SaraOutfitSpec,
} from "./outfit-composer";
import { applySaraFreckledSkin } from "./skin-variant";
import { resolveCompanionAssetUrl } from "../companion-install";
import { getQueenVoiceOpen } from "@/lib/native/queen-voice-events";
import { CompanionAnimationLoader } from "./animation/animation-loader";
import { BlinkController } from "./blink-controller";
import { deriveCompanionReaction, type CompanionReaction } from "./companion-reactions";
import { ExpressionSystem, VRMChannelBridge } from "./expressions";
import {
  applyCharacterStyleToObject,
  clearCharacterStyleFromObject,
  updateHologramTime,
} from "./hologram";
import { LipSyncController } from "./lip-sync/lip-sync-controller";
import { estimateDurationFromText, generatePhonemeData } from "./lip-sync/phoneme-generator";
import { logger } from "./logger";
import { ProceduralAnimationController } from "./procedural/procedural-animation-controller";
import { loadCompanionVRM } from "./vrm-loader";

const LOOK_AROUND_MIN_MS = 22_000;
const LOOK_AROUND_MAX_MS = 42_000;

export type CompanionEngineOptions = {
  /** Fully transparent clear color (popover); the tab also runs transparent
   *  so the hive backdrop shows through. */
  transparentBackground?: boolean;
  /** Wardrobe outfit to dress her in at load (SARA_OUTFITS key). */
  outfitKey?: string;
};

export class CompanionEngine {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(27, 1, 0.1, 30);
  private clock = new THREE.Clock();

  private vrm: VRM | null = null;
  private animationLoader: CompanionAnimationLoader | null = null;
  private procedural: ProceduralAnimationController | null = null;
  private lipSync: LipSyncController | null = null;
  private blink: BlinkController | null = null;
  private expressions: ExpressionSystem | null = null;
  private bridge: VRMChannelBridge | null = null;

  private hologramEnabled = true;
  private disposed = false;
  private unsubscribeSpeaking: (() => void) | null = null;
  private unsubscribeUtterance: (() => void) | null = null;
  private speaking = false;
  private lookAroundUrl: string | null = null;
  private nextLookAroundAt = 0;
  private gestureBusy = false;
  private headBone: THREE.Object3D | null = null;
  private backstopTimer: number | null = null;
  private lastTickAt = 0;
  // Camera framing: dolly distance + view-center height (camera and lookAt
  // share Y for a level view). User-tunable via the HUD sliders.
  private cameraDistance = 2.4;
  private cameraCenterY = 1.4;

  constructor(canvas: HTMLCanvasElement, private options: CompanionEngineOptions = {}) {
    this.canvas = canvas;
  }

  /** Load the model + clips and start the render loop. */
  async init(): Promise<void> {
    // Mirror ami's R3F Canvas `flat legacy` mode: color management off, no
    // renderer tone mapping (Sara's materials carry in-shader ACES already).
    THREE.ColorManagement.enabled = false;
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
      stencil: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;

    // Upper-body framing: head at ~1.57 world-Y (hair to ~1.69, measured in
    // the runtime harness). A high view center drops her in the frame (~25%
    // headroom) and the close dolly crops around the waist — tune z for zoom,
    // the lookAt/position Y pair for how low she sits.
    // Defaults give ~25% clearance above her hair (top ~1.69 world-Y): at
    // z=2.4 the frame half-height is 0.576, so a 1.40 view center puts the
    // top edge at 1.98.
    this.applyCameraFraming();

    this.scene.add(new THREE.AmbientLight(0xffffff, 1));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(3, 5, 4);
    this.scene.add(key);

    const modelUrl = await resolveCompanionAssetUrl(SARA_LITE_MODEL);
    const result = await loadCompanionVRM(modelUrl);
    if (this.disposed) return;
    const { vrm, baseRotationY } = result;
    this.vrm = vrm;
    this.scene.add(vrm.scene);
    this.headBone = vrm.humanoid?.getNormalizedBoneNode("head") ?? null;

    // Dress her before anything styles or animates: the Sara Lite base is
    // bare; the detective-vest GLB binds onto her skeleton and re-shows the
    // matching body-cut meshes. Must run before applyHologram so the
    // clothing materials get styled with the rest.
    try {
      const spec = saraOutfitByKey(this.options.outfitKey);
      await applySaraOutfit(vrm, spec, () => this.resolveOutfitUrl(spec));
    } catch (error) {
      logger.warn("outfit failed to compose — continuing with base model", error);
    }
    // Freckled face is the default look; the variant albedo ships embedded
    // (unreferenced) inside the VRM itself, so this is a pure texture swap.
    try {
      await applySaraFreckledSkin(vrm, result.gltf);
    } catch (error) {
      logger.warn("freckled skin variant failed — keeping base skin", error);
    }
    if (this.disposed) return;

    // Subsystems — the animation loader must snapshot the rest pose before
    // any clip plays, so construct it immediately after load.
    this.animationLoader = new CompanionAnimationLoader(vrm);
    this.procedural = new ProceduralAnimationController(vrm, undefined, {
      idleAnimationsEnabled: true,
    });
    this.procedural.setCamera(this.camera, baseRotationY);
    this.lipSync = new LipSyncController(vrm);
    this.blink = new BlinkController(vrm);
    this.expressions = new ExpressionSystem();
    this.bridge = new VRMChannelBridge();
    this.bridge.setVRM(vrm);
    this.bridge.setBlinkController(this.blink);
    this.bridge.setLipSyncController(this.lipSync);
    // Sara Lite IS the sara/tomcat rig; blob URLs defeat the URL sniffing, so
    // set the expression profile explicitly.
    this.bridge.setCharacterExpressionProfile("saraTomcat");

    this.applyHologram();

    // Idle clips: the breathing loop is the base; look-around plays
    // occasionally as a self-returning one-shot.
    const [breathingAsset, lookAroundAsset] = COMPANION_IDLE_ASSETS;
    try {
      const idleUrl = await resolveCompanionAssetUrl(breathingAsset);
      await this.animationLoader.playIdle(idleUrl);
    } catch (error) {
      logger.warn("idle clip failed to load — procedural motion only", error);
    }
    if (lookAroundAsset) {
      this.lookAroundUrl = await resolveCompanionAssetUrl(lookAroundAsset).catch(() => null);
    }
    this.scheduleNextLookAround();

    // Queen voice link: speaking edges + per-frame amplitude polling, plus
    // per-utterance audio-start events for ami-parity timed lip sync.
    this.unsubscribeSpeaking = subscribeQueenVoiceSpeaking((speaking) => {
      this.setSpeaking(speaking);
    });
    this.unsubscribeUtterance = subscribeQueenUtterance(({ text, durationSeconds }) => {
      this.onQueenUtterance(text, durationSeconds);
    });
    if (readQueenVoiceAmplitude().speaking) this.setSpeaking(true);

    renderer.setAnimationLoop(() => this.tick());
    // WKWebView can starve rAF on idle/unfocused pages (same failure the
    // queen-voice level pump defends against) — a low-rate timer keeps the
    // hologram/idle alive whenever rAF visibly stalls. No-op while healthy.
    this.lastTickAt = performance.now();
    this.backstopTimer = window.setInterval(() => {
      if (performance.now() - this.lastTickAt > 120) this.tick();
    }, 66);
  }

  /** ami's per-chunk lip-sync flow: each spoken chunk publishes its text (and
   *  the decoded clip's REAL duration on the buffered path) at true audio
   *  start. A fresh phoneme/viseme track (aa/ih/ou/ee/oh) is anchored right
   *  here — startLipSync's replace path resets timing and stops any amplitude
   *  fallback, so every chunk seam re-syncs the mouth to the actual audio. */
  private onQueenUtterance(text: string, durationSeconds?: number) {
    if (!this.lipSync) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const duration =
      durationSeconds && durationSeconds > 0
        ? durationSeconds
        : estimateDurationFromText(trimmed);
    const phonemes = generatePhonemeData(trimmed, duration);
    if (!phonemes.length) return;
    this.lipSync.startLipSync(phonemes);
    this.lipSync.onAudioStart();
    // Her audio just started: release any reaction held for speech onset so
    // the face/gesture lands WITH the voice, not seconds ahead of it.
    this.applyPendingReaction();
  }

  private setSpeaking(speaking: boolean) {
    if (speaking === this.speaking) return;
    this.speaking = speaking;
    this.procedural?.setSpeaking(speaking);
    this.expressions?.getGazeController().setSpeaking(speaking);
    if (!this.lipSync) return;
    if (!speaking) {
      this.lipSync.stopLipSync();
      this.lipSync.stopExternalAmplitude();
      return;
    }
    // The speaking flag flips at turn start — often seconds before first
    // audio — so it must NOT start a phoneme track (that's what made the
    // mouth lead the voice). It only arms the amplitude-driven fallback,
    // which stays closed while the level is 0; the first utterance event
    // upgrades to the timed phoneme track at real audio onset. Paths that
    // never publish utterances (OpenAI Realtime) stay amplitude-driven.
    this.lipSync.startExternalAmplitude();
  }

  private scheduleNextLookAround() {
    this.nextLookAroundAt =
      performance.now() +
      LOOK_AROUND_MIN_MS +
      Math.random() * (LOOK_AROUND_MAX_MS - LOOK_AROUND_MIN_MS);
  }

  private maybeLookAround() {
    if (!this.lookAroundUrl || this.gestureBusy || this.speaking) return;
    if (performance.now() < this.nextLookAroundAt) return;
    this.playGestureUrl(this.lookAroundUrl);
    this.scheduleNextLookAround();
  }

  private playGestureUrl(url: string) {
    const animationLoader = this.animationLoader;
    if (!animationLoader) return;
    this.gestureBusy = true;
    void animationLoader
      .playGesture(url)
      .catch((error) => logger.warn("gesture failed", error))
      .finally(() => {
        this.gestureBusy = false;
      });
  }

  // A reaction waiting for its reply's AUDIO to start. Reply text finalizes
  // seconds before TTS (converse stream + TTFB), and expression tones move
  // the mouth (mouthCorners) — applied at text time they read as Sara
  // "talking" before her voice arrives. ami applies expression/animation tags
  // as the spoken delivery plays, so we hold the reaction for the reply's
  // first utterance event (real audio onset).
  private pendingReaction: CompanionReaction | null = null;
  private pendingReactionTimer: number | null = null;

  /** Feed a completed Queen reply: expression lean + tone + gesture — applied
   *  at speech onset when the voice overlay is open, immediately otherwise. */
  reactToReply(text: string) {
    if (!this.expressions) return;
    const reaction = deriveCompanionReaction(text);
    if (!getQueenVoiceOpen()) {
      this.applyReaction(reaction);
      return;
    }
    this.pendingReaction = reaction;
    if (this.pendingReactionTimer !== null) window.clearTimeout(this.pendingReactionTimer);
    // Fallback so a reply whose audio never starts (TTS outage, muted reply)
    // still reacts; measured stream-open ~1s, so this only fires on misses.
    this.pendingReactionTimer = window.setTimeout(() => this.applyPendingReaction(), 4000);
  }

  private applyPendingReaction() {
    const reaction = this.pendingReaction;
    if (!reaction) return;
    this.pendingReaction = null;
    if (this.pendingReactionTimer !== null) {
      window.clearTimeout(this.pendingReactionTimer);
      this.pendingReactionTimer = null;
    }
    this.applyReaction(reaction);
  }

  private applyReaction(reaction: CompanionReaction) {
    if (!this.expressions) return;
    this.expressions.setEmotionalStateTarget(reaction.emotion);
    this.expressions.triggerTone(reaction.tone, { intensity: 0.75 });
    this.procedural?.setEmotionFromString(reaction.tone);
    if (reaction.gestureKey && !this.gestureBusy) {
      const asset = companionAssetByKey(reaction.gestureKey);
      if (asset) {
        void resolveCompanionAssetUrl(asset).then((url) => {
          if (!this.disposed) this.playGestureUrl(url);
        });
      }
    }
  }

  private resolveOutfitUrl(spec: SaraOutfitSpec): Promise<string> {
    const asset = SARA_OUTFIT_ASSETS.find((entry) => entry.key === spec.key)
      ?? { path: spec.glbPath, approxBytes: 1_000_000, kind: "model" as const, key: spec.key };
    return resolveCompanionAssetUrl(asset);
  }

  private outfitSwapBusy = false;

  /**
   * Change her outfit (SARA_OUTFITS key). Downloads-and-caches the GLB on
   * first wear, restyles the new meshes, and keeps the bust morph in sync
   * (applySaraOutfit re-applies the default reduction on compose).
   */
  async setOutfit(outfitKey: string): Promise<void> {
    const vrm = this.vrm;
    if (!vrm || this.outfitSwapBusy) return;
    const spec = saraOutfitByKey(outfitKey);
    const current = getSaraOutfitHandle(vrm);
    if (current?.outfitKey === spec.key) return;
    this.outfitSwapBusy = true;
    try {
      current?.dispose();
      await applySaraOutfit(vrm, spec, () => this.resolveOutfitUrl(spec));
      // New meshes joined vrm.scene — restyle so the hologram covers them.
      this.applyHologram();
    } catch (error) {
      logger.warn(`outfit swap to ${outfitKey} failed`, error);
    } finally {
      this.outfitSwapBusy = false;
    }
  }

  /**
   * Adjust the camera framing. `distance` dollies in/out (clamped 1.2–4.5);
   * `centerY` slides the view center up/down (clamped 0.8–1.8) — a HIGHER
   * center puts Sara LOWER in the frame.
   */
  setCameraFraming(distance?: number, centerY?: number) {
    if (Number.isFinite(distance)) {
      this.cameraDistance = Math.min(4.5, Math.max(1.2, distance as number));
    }
    if (Number.isFinite(centerY)) {
      this.cameraCenterY = Math.min(1.8, Math.max(0.8, centerY as number));
    }
    this.applyCameraFraming();
  }

  private applyCameraFraming() {
    this.camera.position.set(0, this.cameraCenterY, this.cameraDistance);
    this.camera.lookAt(0, this.cameraCenterY, 0);
  }

  setHologramEnabled(enabled: boolean) {
    if (enabled === this.hologramEnabled) return;
    this.hologramEnabled = enabled;
    this.applyHologram();
  }

  private applyHologram() {
    if (!this.vrm) return;
    if (this.hologramEnabled) {
      applyCharacterStyleToObject(this.vrm.scene, "hologram");
    } else {
      clearCharacterStyleFromObject(this.vrm.scene);
    }
  }

  resize(width: number, height: number) {
    if (!this.renderer || width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Always refresh the projection — a stale/degenerate aspect leaves the
    // canvas painting only the clear color (learned the hard way in ami).
    this.camera.updateProjectionMatrix();
  }

  private tick() {
    if (this.disposed || !this.renderer) return;
    this.lastTickAt = performance.now();
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const vrm = this.vrm;
    if (!vrm) return;

    this.maybeLookAround();

    // Clip mixer → procedural layers → mouth/blink → VRM core update.
    this.animationLoader?.update(delta);
    this.procedural?.updateFrame(delta);
    if (this.speaking && this.lipSync) {
      // Amplitude fallback guard: covers the window before a turn's first
      // utterance event and voice paths that never publish one (Realtime).
      // Once a phoneme track starts it owns the mouth for the whole turn —
      // past its end the visemes read zero (mouth closed, ami behavior)
      // until the next chunk's utterance re-anchors a fresh track.
      if (!this.lipSync.isLipSyncActive()) this.lipSync.startExternalAmplitude();
      if (this.lipSync.isExternalAmplitudeActive()) {
        this.lipSync.setExternalAmplitude(readQueenVoiceAmplitude().level);
      }
    }
    this.lipSync?.updateFrame(delta);
    this.blink?.updateFrame(delta);
    vrm.update(delta);

    // Expression channels apply after vrm.update (the bridge premultiplies
    // eye bones and runs expressionManager.update itself), then the head-pose
    // offset — the bridge deliberately leaves the head bone to the host.
    if (this.expressions && this.bridge) {
      const channels = this.expressions.update(delta * 1000);
      this.bridge.apply(channels);
      const head = this.headBone;
      const pose = channels.headPose;
      if (head && pose) {
        head.rotation.x += THREE.MathUtils.degToRad(pose.pitch ?? 0);
        head.rotation.y += THREE.MathUtils.degToRad(pose.yaw ?? 0);
        head.rotation.z += THREE.MathUtils.degToRad(pose.roll ?? 0);
      }
    }

    updateHologramTime(this.clock.elapsedTime);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.unsubscribeSpeaking?.();
    this.unsubscribeSpeaking = null;
    this.unsubscribeUtterance?.();
    this.unsubscribeUtterance = null;
    this.pendingReaction = null;
    if (this.pendingReactionTimer !== null) {
      window.clearTimeout(this.pendingReactionTimer);
      this.pendingReactionTimer = null;
    }
    if (this.backstopTimer !== null) {
      window.clearInterval(this.backstopTimer);
      this.backstopTimer = null;
    }
    this.renderer?.setAnimationLoop(null);
    this.animationLoader?.dispose();
    if (this.vrm) {
      clearCharacterStyleFromObject(this.vrm.scene);
      this.scene.remove(this.vrm.scene);
    }
    this.renderer?.dispose();
    this.renderer = null;
    this.vrm = null;
  }
}
