/**
 * Companion animation loader/player — ported from ami-ai-companion.
 *
 * Sources:
 *  - src/components/3d/AnimationLoader.ts (loadGLBAnimation path only —
 *    the idle/gesture conversation GLBs are Mixamo-rig GLBs; FBX/VMD/VRMA/
 *    BVH/plain-GLB branches dropped, Dexie IndexedDB cache replaced with an
 *    in-memory Map).
 *  - src/components/r3f/VRMCharacter.tsx idle-playback effect (:1185) and
 *    one-shot gesture effect (:1281) — crossfade timings, action ordering,
 *    hard-stop timers, and return-to-idle semantics preserved exactly.
 *
 * The host passes final absolute clip URLs (no gender mapping, no CDN
 * rewriting) and drives update(delta) from its render loop.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import { logger } from "../logger";
import {
  dampenAnimationTracks,
  retargetMixamoAnimationToVRM,
  retargetVRMBoneGLBToVRM,
  type RetargetContext,
} from "./vrm-retargeting";

/** Crossfade duration for idle swaps AND gesture in/out (ami VRMCharacter.tsx CROSSFADE_S). */
const CROSSFADE_S = 0.8;
/**
 * Grace period after a crossfade before hard-stopping the faded-out action.
 * three.js crossFadeTo/fadeOut only schedule a weight interpolant; once it
 * clears, effective weight pops back to 1 and the action keeps contributing —
 * so ami always stops the losing action at fade-end + 50ms.
 */
const FADE_STOP_GRACE_MS = 50;

type Timer = ReturnType<typeof setTimeout>;

export class CompanionAnimationLoader {
  private vrm: VRM;
  private readonly mixer: THREE.AnimationMixer;
  /** Normalized hips local position captured at construction (pre-animation). */
  private readonly initialHipsPosition: THREE.Vector3 | null;

  /** Retargeted clips keyed by URL (replaces ami's Dexie animationCacheDb). */
  private readonly clipCache = new Map<string, THREE.AnimationClip>();
  /** Deduplicates concurrent loads for the same URL (ami inFlightLoads). */
  private readonly inFlightLoads = new Map<string, Promise<THREE.AnimationClip>>();

  private idleAction: THREE.AnimationAction | null = null;
  private idleSeq = 0;
  private idlePrevStopTimer: Timer | null = null;

  private activeGesture: THREE.AnimationAction | null = null;
  private gestureSeq = 0;
  private gestureStopTimer: Timer | null = null;
  private returnToIdleTimer: Timer | null = null;
  private postCrossfadeStopTimer: Timer | null = null;
  /** Resolver for the in-flight playGesture promise (resolved on completion or supersession). */
  private gestureResolve: (() => void) | null = null;

  private disposed = false;

  /**
   * Construct immediately after the VRM finishes loading, before any animation
   * plays — the constructor snapshots the rest-pose hips position exactly like
   * ami's VRMLoader does at load time (VRMLoader.ts:2377).
   */
  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    const hipsNode = vrm.humanoid?.getNormalizedBoneNode("hips") ?? null;
    this.initialHipsPosition = hipsNode ? hipsNode.position.clone() : null;
  }

  /** The mixer driving playback (exposed for hosts that need direct access). */
  getMixer(): THREE.AnimationMixer {
    return this.mixer;
  }

  private isVRM0(): boolean {
    return this.vrm.meta?.metaVersion !== "1";
  }

  private getVRMHipsHeight(): number {
    const vec3 = new THREE.Vector3();
    const hipsNode = this.vrm.humanoid?.getNormalizedBoneNode("hips");
    const hipsY = hipsNode?.getWorldPosition(vec3).y ?? 0;
    const rootY = this.vrm.scene.getWorldPosition(vec3).y;
    return Math.abs(hipsY - rootY);
  }

  private createRetargetContext(): RetargetContext {
    return {
      vrm: this.vrm,
      initialHipsPosition: this.initialHipsPosition,
      isVRM0: this.isVRM0(),
      vrmHipsHeight: this.getVRMHipsHeight(),
    };
  }

  /**
   * Load a GLB animation and retarget it onto this player's VRM.
   * Mixamo-rig GLBs (the ami conversation/gesture library — "mixamorig:Hips"
   * bone naming) go through the Mixamo→VRM retargeter; GLBs whose tracks
   * already use VRM bone names go through the VRM-bone retargeter. Results are
   * cached in-memory by URL.
   */
  async loadClip(url: string): Promise<THREE.AnimationClip> {
    const cached = this.clipCache.get(url);
    if (cached) return cached;

    const existing = this.inFlightLoads.get(url);
    if (existing) {
      logger.debug(`[anim] deduping in-flight load: ${url}`);
      return existing;
    }

    const loadPromise = this.fetchAndRetarget(url);
    this.inFlightLoads.set(url, loadPromise);
    loadPromise
      .catch(() => {})
      .finally(() => {
        this.inFlightLoads.delete(url);
      });
    return loadPromise;
  }

  private async fetchAndRetarget(url: string): Promise<THREE.AnimationClip> {
    logger.debug(`[anim] loading GLB animation: ${url}`);
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);

    if (!gltf.animations.length) {
      throw new Error(`No animations in GLB: ${url}`);
    }
    const clip = THREE.AnimationClip.findByName(gltf.animations, "mixamo.com") ?? gltf.animations[0];
    if (!clip) {
      throw new Error(`No animation clip found in: ${url}`);
    }

    // Rig detection — matches ami AnimationLoader.ts:481.
    const isMixamoRig =
      !!gltf.scene.getObjectByName("mixamorigHips") || !!gltf.scene.getObjectByName("mixamorig:Hips");

    const ctx = this.createRetargetContext();
    const retargeted = isMixamoRig
      ? retargetMixamoAnimationToVRM(gltf.scene, clip, ctx)
      : retargetVRMBoneGLBToVRM(gltf.scene, clip, ctx);

    if (!retargeted || retargeted.tracks.length < 3) {
      throw new Error(`Failed to retarget animation: ${url}`);
    }

    dampenAnimationTracks(retargeted, url);

    // Give clips distinct names so mixer bookkeeping stays legible.
    retargeted.name = url;
    this.clipCache.set(url, retargeted);
    logger.debug(`[anim] ready (${isMixamoRig ? "mixamo" : "vrm-bone"} rig, ${retargeted.tracks.length} tracks): ${url}`);
    return retargeted;
  }

  /**
   * Load + loop an idle clip, crossfading from the previous idle if one is
   * playing. Port of ami VRMCharacter.tsx:1185 (idle effect): reset →
   * setEffectiveTimeScale(1) → setEffectiveWeight(1) → play → crossFadeTo(0.8s),
   * then hard-stop the previous idle at fade-end + 50ms.
   */
  async playIdle(url: string): Promise<void> {
    const seq = ++this.idleSeq;
    const prevIdle = this.idleAction;

    const clip = await this.loadClip(url);
    if (this.disposed || seq !== this.idleSeq) return; // superseded while loading

    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);

    if (action === prevIdle) {
      if (!action.isRunning()) action.play();
      this.idleAction = action;
      return;
    }

    this.idleAction = action;

    // Match ami's switchAnimation order: reset → timeScale → weight → play → crossFadeTo.
    action.reset();
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.play();

    if (prevIdle) {
      prevIdle.crossFadeTo(action, CROSSFADE_S, false);
      if (this.idlePrevStopTimer !== null) clearTimeout(this.idlePrevStopTimer);
      this.idlePrevStopTimer = setTimeout(() => {
        this.idlePrevStopTimer = null;
        prevIdle.stopFading();
        prevIdle.setEffectiveWeight(0);
        prevIdle.stop();
      }, CROSSFADE_S * 1000 + FADE_STOP_GRACE_MS);
    }
  }

  /**
   * Play a one-shot gesture: crossfades from idle (or from a still-running
   * previous gesture) over 0.8s, plays once clamped, then crossfades back to
   * idle at clip-duration and hard-stops itself at fade-end + 50ms. Resolves
   * when the gesture has fully returned to idle, or immediately if superseded
   * by a newer gesture. Port of ami VRMCharacter.tsx:1281 (gesture effect),
   * including the setTimeout-based return-to-idle (deliberately NOT the mixer
   * "finished" event — ami found the timer path more robust).
   */
  async playGesture(url: string): Promise<void> {
    const idle = this.idleAction;
    if (!idle) {
      logger.warn(`[anim] playGesture before idle is running — ignoring: ${url}`);
      return;
    }

    const seq = ++this.gestureSeq;
    const clip = await this.loadClip(url);
    if (this.disposed || seq !== this.gestureSeq) return; // superseded while loading

    const action = this.mixer.clipAction(clip);

    const prev = this.activeGesture;
    if (prev === action) {
      // Same gesture re-fired mid-playback: let the existing playback continue
      // (a fresh fade-in would pull effective weight back through 0→1).
      return;
    }
    const hasPrev = !!prev && prev !== idle;
    const from = hasPrev ? prev : idle;

    // If the prev gesture was mid-return-to-idle, idle is fading IN and would
    // keep contributing alongside the new gesture — fade it out in step.
    if (from !== idle && idle.getEffectiveWeight() > 0.001) {
      idle.fadeOut(CROSSFADE_S);
    }

    // Cancel the previous gesture invocation's pending timers and resolve its
    // promise (mirrors ami's effect cleanup on re-run).
    this.clearGestureTimers();
    this.gestureResolve?.();
    this.gestureResolve = null;

    this.activeGesture = action;
    // Match ami's switchAnimation order exactly.
    action.reset();
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    from.crossFadeTo(action, CROSSFADE_S, false);

    if (hasPrev) {
      const prevToStop = prev;
      this.gestureStopTimer = setTimeout(() => {
        this.gestureStopTimer = null;
        prevToStop.stopFading();
        prevToStop.setEffectiveWeight(0);
        prevToStop.stop();
      }, CROSSFADE_S * 1000 + FADE_STOP_GRACE_MS);
    }

    return new Promise<void>((resolve) => {
      this.gestureResolve = resolve;
      const clipDurationMs = clip.duration * 1000;

      this.returnToIdleTimer = setTimeout(() => {
        this.returnToIdleTimer = null;
        // Only return to idle if THIS gesture is still the active one.
        if (this.activeGesture !== action) return;

        // Skip reset() when idle still has visible weight (a cancelled prior
        // fade) — resetting snaps its clip time to 0 mid-pose.
        if (idle.getEffectiveWeight() < 0.001) idle.reset();
        idle.setEffectiveTimeScale(1);
        idle.setEffectiveWeight(1);
        idle.play();
        action.crossFadeTo(idle, CROSSFADE_S, false);

        this.postCrossfadeStopTimer = setTimeout(() => {
          this.postCrossfadeStopTimer = null;
          action.stopFading();
          action.setEffectiveWeight(0);
          action.stop();
          if (this.activeGesture === action) {
            this.activeGesture = null;
          }
          if (this.gestureResolve === resolve) this.gestureResolve = null;
          resolve();
        }, CROSSFADE_S * 1000 + FADE_STOP_GRACE_MS);
      }, clipDurationMs);
    });
  }

  /**
   * Fade out a gesture cancelled externally mid-playback (port of ami
   * VRMCharacter.tsx:1430). Fade only — the pose baseline is whoever else is
   * running; idle is not forced back in.
   */
  cancelGesture(): void {
    const active = this.activeGesture;
    if (!active) return;
    this.activeGesture = null;
    this.clearGestureTimers();
    this.gestureResolve?.();
    this.gestureResolve = null;
    active.fadeOut(0.3);
    this.gestureStopTimer = setTimeout(() => {
      this.gestureStopTimer = null;
      active.stopFading();
      active.setEffectiveWeight(0);
      active.stop();
    }, 350);
  }

  /** Advance the mixer — call once per frame from the host render loop. */
  update(delta: number): void {
    this.mixer.update(delta);
  }

  private clearGestureTimers(): void {
    if (this.gestureStopTimer !== null) {
      clearTimeout(this.gestureStopTimer);
      this.gestureStopTimer = null;
    }
    if (this.returnToIdleTimer !== null) {
      clearTimeout(this.returnToIdleTimer);
      this.returnToIdleTimer = null;
    }
    if (this.postCrossfadeStopTimer !== null) {
      clearTimeout(this.postCrossfadeStopTimer);
      this.postCrossfadeStopTimer = null;
    }
  }

  /** Stop playback, cancel timers, and release mixer + clip caches. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.idleSeq++;
    this.gestureSeq++;
    if (this.idlePrevStopTimer !== null) {
      clearTimeout(this.idlePrevStopTimer);
      this.idlePrevStopTimer = null;
    }
    this.clearGestureTimers();
    this.gestureResolve?.();
    this.gestureResolve = null;
    this.idleAction = null;
    this.activeGesture = null;
    this.mixer.stopAllAction();
    for (const clip of this.clipCache.values()) {
      this.mixer.uncacheClip(clip);
    }
    this.mixer.uncacheRoot(this.vrm.scene);
    this.clipCache.clear();
    this.inFlightLoads.clear();
  }
}
