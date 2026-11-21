// Frame-driven tweens and timers. Everything runs on the render clock, scaled by the game speed,
// so `?speed=4` playtests run the whole game faster and a backgrounded tab simply pauses.

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
};

interface Tween {
  elapsed: number;
  duration: number;
  update: (k: number) => void;
  ease: Ease;
  resolve: () => void;
}

export class Clock {
  time = 0;
  private tweens = new Set<Tween>();

  constructor(public speed: number) {}

  /** Advances by real seconds; returns the scaled step the game should use. */
  tick(realDt: number): number {
    const dt = Math.min(realDt, 0.1) * this.speed;
    this.time += dt;
    for (const tw of [...this.tweens]) {
      tw.elapsed += dt;
      const k = Math.min(1, tw.elapsed / tw.duration);
      tw.update(tw.ease(k));
      if (k >= 1) {
        this.tweens.delete(tw);
        tw.resolve();
      }
    }
    return dt;
  }

  tween(duration: number, update: (k: number) => void, easing: Ease = ease.inOutSine): Promise<void> {
    return new Promise((resolve) => {
      if (duration <= 0) {
        update(1);
        resolve();
        return;
      }
      this.tweens.add({ elapsed: 0, duration, update, ease: easing, resolve });
    });
  }

  wait(seconds: number): Promise<void> {
    return this.tween(seconds, () => {}, ease.linear);
  }
}
