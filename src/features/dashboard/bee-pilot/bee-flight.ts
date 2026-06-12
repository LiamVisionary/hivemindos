"use client";

export type BeeFlightFrame = {
  x: number;
  y: number;
  scale: number;
  tilt: number;
  visible: boolean;
};

export type BeeFlightRipple = { x: number; y: number; id: number };

type FrameListener = (frame: BeeFlightFrame) => void;
type RippleListener = (ripple: BeeFlightRipple) => void;

const POSITION_STIFFNESS = 36;
const POSITION_DAMPING = 11;
const SCALE_STIFFNESS = 240;
const SCALE_DAMPING = 12;
const SETTLE_DISTANCE = 6;
const SETTLE_SPEED = 24;
const MAX_TILT_DEG = 22;
const FLY_TIMEOUT_MS = 4_500;

/**
 * Spring-driven flight model for the Bee Pilot cursor. The overlay component
 * subscribes for per-frame transforms; the executor awaits flyTo/bounce so UI
 * actions stay in lockstep with the animation. No animation library exists in
 * this repo, so the spring is integrated by hand on requestAnimationFrame.
 */
export class BeeFlightController {
  private frameListeners = new Set<FrameListener>();
  private rippleListeners = new Set<RippleListener>();
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private targetX = 0;
  private targetY = 0;
  private scale = 1;
  private scaleVelocity = 0;
  private visible = false;
  private rafId: number | null = null;
  private lastTick = 0;
  private settleResolvers: Array<() => void> = [];
  private rippleId = 0;

  subscribe(onFrame: FrameListener, onRipple?: RippleListener): () => void {
    this.frameListeners.add(onFrame);
    if (onRipple) this.rippleListeners.add(onRipple);
    onFrame(this.frame());
    return () => {
      this.frameListeners.delete(onFrame);
      if (onRipple) this.rippleListeners.delete(onRipple);
    };
  }

  showAt(x: number, y: number): void {
    this.x = this.targetX = x;
    this.y = this.targetY = y;
    this.vx = this.vy = 0;
    this.visible = true;
    this.startLoop();
  }

  hide(): void {
    this.visible = false;
    this.flushSettled();
    this.emit();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Glides the bee to a point; resolves when the spring settles there. */
  flyTo(x: number, y: number): Promise<void> {
    if (!this.visible) {
      this.showAt(typeof window === "undefined" ? x : window.innerWidth / 2, -60);
    }
    this.targetX = x;
    this.targetY = y;
    this.startLoop();
    return new Promise((resolve) => {
      this.settleResolvers.push(resolve);
      window.setTimeout(resolve, FLY_TIMEOUT_MS);
    });
  }

  flyToElement(element: Element): Promise<void> {
    const rect = element.getBoundingClientRect();
    return this.flyTo(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  /** Springy press: a quick squash that overshoots back, plus a click ripple. */
  async bounce(): Promise<void> {
    this.scaleVelocity -= 7.5;
    this.startLoop();
    this.rippleId += 1;
    const ripple: BeeFlightRipple = { x: this.targetX, y: this.targetY, id: this.rippleId };
    for (const listener of this.rippleListeners) listener(ripple);
    await new Promise((resolve) => window.setTimeout(resolve, 520));
  }

  private frame(): BeeFlightFrame {
    const tilt = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, this.vx * 0.06));
    return { x: this.x, y: this.y, scale: this.scale, tilt, visible: this.visible };
  }

  private emit(): void {
    const frame = this.frame();
    for (const listener of this.frameListeners) listener(frame);
  }

  private startLoop(): void {
    if (this.rafId !== null || typeof window === "undefined") return;
    this.lastTick = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.048, (now - this.lastTick) / 1000);
      this.lastTick = now;

      this.vx += (POSITION_STIFFNESS * (this.targetX - this.x) - POSITION_DAMPING * this.vx) * dt;
      this.vy += (POSITION_STIFFNESS * (this.targetY - this.y) - POSITION_DAMPING * this.vy) * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      this.scaleVelocity += (SCALE_STIFFNESS * (1 - this.scale) - SCALE_DAMPING * this.scaleVelocity) * dt;
      this.scale += this.scaleVelocity * dt;

      const distance = Math.hypot(this.targetX - this.x, this.targetY - this.y);
      const speed = Math.hypot(this.vx, this.vy);
      if (distance < SETTLE_DISTANCE && speed < SETTLE_SPEED) this.flushSettled();

      this.emit();

      const scaleSettled = Math.abs(1 - this.scale) < 0.004 && Math.abs(this.scaleVelocity) < 0.02;
      if (distance < 0.5 && speed < 2 && scaleSettled) {
        this.rafId = null;
        return;
      }
      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  private flushSettled(): void {
    const resolvers = this.settleResolvers;
    this.settleResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}
