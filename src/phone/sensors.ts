// Motion sensors. iOS asks for permission, and only from a tap, so `enable()` must be called from
// a click handler. Android gives the events on any https page.

type Unsub = () => void;

interface PermissionCapable {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export class Sensors {
  /** True once real motion data has arrived. */
  live = false;
  private asked = false;

  get supported(): boolean {
    return typeof window.DeviceMotionEvent !== 'undefined';
  }

  /** Call from a tap. Resolves false if the user said no or the device has no sensors. */
  async enable(): Promise<boolean> {
    if (!this.supported) return false;
    const motion = window.DeviceMotionEvent as unknown as PermissionCapable;
    const orientation = window.DeviceOrientationEvent as unknown as PermissionCapable;
    try {
      if (typeof motion.requestPermission === 'function') {
        if ((await motion.requestPermission()) !== 'granted') return false;
        if (typeof orientation.requestPermission === 'function') await orientation.requestPermission();
      }
    } catch {
      return false;
    }
    if (!this.asked) {
      this.asked = true;
      addEventListener(
        'devicemotion',
        (e) => {
          if (e.accelerationIncludingGravity?.x != null) this.live = true;
        },
        { passive: true },
      );
    }
    return true;
  }

  onMotion(fn: (e: DeviceMotionEvent) => void): Unsub {
    addEventListener('devicemotion', fn, { passive: true });
    return () => removeEventListener('devicemotion', fn);
  }

  onOrientation(fn: (e: DeviceOrientationEvent) => void): Unsub {
    addEventListener('deviceorientation', fn, { passive: true });
    return () => removeEventListener('deviceorientation', fn);
  }
}

/** Calls `fn` on a firm shake. */
export function detectShake(sensors: Sensors, fn: () => void): Unsub {
  let last = 0;
  return sensors.onMotion((e) => {
    const a = e.acceleration;
    const g = e.accelerationIncludingGravity;
    let strength = 0;
    if (a?.x != null && a.y != null && a.z != null) strength = Math.hypot(a.x, a.y, a.z);
    else if (g?.x != null && g.y != null && g.z != null) strength = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
    const now = performance.now();
    if (strength > 15 && now - last > 900) {
      last = now;
      fn();
    }
  });
}

/**
 * Pumping: up-and-down strokes, measured along gravity so it works however the phone is held.
 * Calls `fn(power)` once per stroke, power 0.3 to 1.
 */
export function detectPump(sensors: Sensors, fn: (power: number) => void): Unsub {
  const grav = { x: 0, y: 0, z: 9.81 };
  let primed = false;
  let peak = 0;
  let last = 0;
  return sensors.onMotion((e) => {
    const g = e.accelerationIncludingGravity;
    if (g?.x == null || g.y == null || g.z == null) return;
    const k = 0.08;
    grav.x += (g.x - grav.x) * k;
    grav.y += (g.y - grav.y) * k;
    grav.z += (g.z - grav.z) * k;
    const len = Math.hypot(grav.x, grav.y, grav.z) || 1;
    const vertical = ((g.x - grav.x) * grav.x + (g.y - grav.y) * grav.y + (g.z - grav.z) * grav.z) / len;
    if (vertical < -6) {
      primed = true;
      peak = Math.max(peak, -vertical);
    } else if (primed && vertical > 6) {
      const now = performance.now();
      if (now - last > 110) {
        last = now;
        fn(Math.min(1, Math.max(0.3, Math.max(peak, vertical) / 22)));
      }
      primed = false;
      peak = 0;
    }
  });
}

/** How much the phone is moving, 0 (perfectly still) to 1 (waving about), smoothed. */
export function trackWobble(sensors: Sensors, fn: (wobble: number) => void): Unsub {
  let level = 0;
  return sensors.onMotion((e) => {
    const r = e.rotationRate;
    const a = e.acceleration;
    const turn = r ? Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0) / 90 : 0;
    const shove = a?.x != null && a.y != null && a.z != null ? Math.hypot(a.x, a.y, a.z) / 3 : 0;
    const now = Math.min(1, Math.max(turn, shove));
    level = Math.max(now, level * 0.85);
    fn(level);
  });
}

/** A nod: the top of the phone tips forward and back quickly. */
export function detectNod(sensors: Sensors, fn: () => void): Unsub {
  let last = 0;
  return sensors.onMotion((e) => {
    const beta = e.rotationRate?.beta ?? 0;
    const now = performance.now();
    if (Math.abs(beta) > 140 && now - last > 260) {
      last = now;
      fn();
    }
  });
}

/** A strum: a quick sideways flick, like brushing guitar strings. */
export function detectStrum(sensors: Sensors, fn: () => void): Unsub {
  let last = 0;
  return sensors.onMotion((e) => {
    const sideways = Math.abs(e.acceleration?.x ?? 0);
    const twist = Math.abs(e.rotationRate?.gamma ?? 0);
    const now = performance.now();
    if ((sideways > 9 || twist > 220) && now - last > 220) {
      last = now;
      fn();
    }
  });
}

/** Tilt like a paper plane, relative to how the phone was held at the start. x right, y up (-1 to 1). */
export function trackTilt(sensors: Sensors, fn: (x: number, y: number) => void): { stop: Unsub; recenter: () => void } {
  let base: { lr: number; fb: number } | null = null;
  let current = { lr: 0, fb: 0 };
  const stop = sensors.onOrientation((e) => {
    if (e.beta == null || e.gamma == null) return;
    const angle = (screen.orientation?.angle ?? 0) as number;
    let lr = e.gamma;
    let fb = e.beta;
    if (angle === 90) [lr, fb] = [e.beta, -e.gamma];
    else if (angle === 270 || angle === -90) [lr, fb] = [-e.beta, e.gamma];
    else if (angle === 180) [lr, fb] = [-e.gamma, -e.beta];
    current = { lr, fb };
    base ??= current;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    fn(clamp((lr - base.lr) / 28), clamp((fb - base.fb) / 28));
  });
  return { stop, recenter: () => (base = current) };
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * Point the phone like a TV remote: turning it left/right and tipping its top up/down move a pointer, relative to
 * where it pointed when this started (or at the last `recenter`). x right, y up, -1 to 1 (about 30° and 24° each way).
 */
export function trackAim(sensors: Sensors, fn: (x: number, y: number) => void): { stop: Unsub; recenter: () => void } {
  let base: { yaw: number; pitch: number } | null = null;
  let current = { yaw: 0, pitch: 0 };
  // Light smoothing takes the jitter out of a hand-held pointer without making it feel slow.
  let sx = 0;
  let sy = 0;
  const stop = sensors.onOrientation((e) => {
    if (e.alpha == null || e.beta == null) return;
    current = { yaw: e.alpha, pitch: e.beta };
    base ??= current;
    // alpha grows when the phone turns left (anticlockwise seen from above), so right is minus.
    const x = clamp1(-wrapDeg(current.yaw - base.yaw) / 30);
    const y = clamp1((current.pitch - base.pitch) / 24);
    sx += (x - sx) * 0.45;
    sy += (y - sy) * 0.45;
    fn(sx, sy);
  });
  return {
    stop,
    recenter: () => {
      base = current;
      sx = 0;
      sy = 0;
    },
  };
}

/**
 * Circling the phone (stirring, rolling, winding up): the direction of its sideways push turns round once per
 * circle. Calls `fn(speed)` on every motion event with 0 (not circling) to 1 (about three circles a second).
 * Shaking back and forth doesn't count: the direction flips instead of turning.
 */
export function trackSpin(sensors: Sensors, fn: (speed: number) => void): Unsub {
  let last: number | null = null;
  let plane = '';
  let rate = 0;
  let lastT = performance.now();
  return sensors.onMotion((e) => {
    const a = e.acceleration;
    if (a?.x == null || a.y == null || a.z == null) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - lastT) / 1000));
    lastT = now;
    // The phone may be held flat (circles in x/y) or upright (circles in x/z): follow the plane with more push.
    const xy = Math.hypot(a.x, a.y);
    const xz = Math.hypot(a.x, a.z);
    const usePlane = xy >= xz ? 'xy' : 'xz';
    const mag = Math.max(xy, xz);
    if (mag < 1.5 || usePlane !== plane) {
      plane = usePlane;
      last = null;
      rate *= Math.exp(-dt * 3);
    } else {
      const angle = Math.atan2(plane === 'xy' ? a.y : a.z, a.x);
      if (last !== null) {
        let d = angle - last;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        // A shake flips the direction by ~180° in one step: ignore jumps that big.
        if (Math.abs(d) < 2.2) rate += (d / dt - rate) * Math.min(1, dt * 6);
      }
      last = angle;
    }
    fn(Math.min(1, Math.abs(rate) / (Math.PI * 2 * 3)));
  });
}

/** A wave: the phone swings sideways; each new direction is one wave. */
export function detectWave(sensors: Sensors, fn: () => void): Unsub {
  let last = 0;
  let side = 0;
  return sensors.onMotion((e) => {
    const x = e.acceleration?.x ?? 0;
    const now = performance.now();
    if (Math.abs(x) > 7 && (Math.sign(x) !== side || now - last > 420) && now - last > 150) {
      side = Math.sign(x);
      last = now;
      fn();
    }
  });
}

/** A short, sharp shake (a shaker egg): quicker to repeat than detectShake. */
export function detectQuickShake(sensors: Sensors, fn: () => void): Unsub {
  let last = 0;
  return sensors.onMotion((e) => {
    const a = e.acceleration;
    if (a?.x == null || a.y == null || a.z == null) return;
    const now = performance.now();
    if (Math.hypot(a.x, a.y, a.z) > 12 && now - last > 170) {
      last = now;
      fn();
    }
  });
}

/** A sway: tipping the phone over to one side, then the other. Each new side is one sway. */
export function detectSway(sensors: Sensors, fn: () => void): Unsub {
  let base: number | null = null;
  let side = 0;
  return sensors.onOrientation((e) => {
    if (e.gamma == null) return;
    base ??= e.gamma;
    const d = e.gamma - base;
    const now = d > 14 ? 1 : d < -14 ? -1 : 0;
    if (now !== 0 && now !== side) {
      side = now;
      fn();
    }
  });
}
