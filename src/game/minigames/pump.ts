// Balloon Pump: pump your phone up and down to fill your balloon and lift your basket to the top.
// Keep an eye on the gauge on your phone: past the red line the balloon bursts.

export const PUMP = {
  goal: 100, // height of the finish banner
  duration: 25, // seconds
  leak: 10, // air lost per second
  perPump: 11, // air per full-strength pump
  burstAt: 100,
  stun: 1.6, // seconds without a balloon after a burst
  climb: 12, // climb speed at full air: steady pumping reaches the banner in about 10-13 s
  sink: 5, // sink speed with no air
  danger: 0.85, // gauge fraction where the phone warns
} as const;

export interface Balloon {
  air: number;
  height: number;
  stun: number;
  finishedAt: number | null;
  bursts: number;
}

export function newBalloon(): Balloon {
  return { air: 30, height: 0, stun: 0, finishedAt: null, bursts: 0 };
}

export type PumpResult = 'ok' | 'burst' | 'ignored';

export function pumpBalloon(b: Balloon, power: number): PumpResult {
  if (b.stun > 0 || b.finishedAt !== null) return 'ignored';
  b.air += PUMP.perPump * Math.min(1, Math.max(0.25, power));
  if (b.air > PUMP.burstAt) {
    b.air = 0;
    b.stun = PUMP.stun;
    b.bursts += 1;
    return 'burst';
  }
  return 'ok';
}

export function stepBalloon(b: Balloon, dt: number, time: number): void {
  if (b.finishedAt !== null) return;
  if (b.stun > 0) b.stun = Math.max(0, b.stun - dt);
  b.air = Math.max(0, b.air - PUMP.leak * dt);
  const speed = (b.air / PUMP.burstAt) * (PUMP.climb + PUMP.sink) - PUMP.sink;
  b.height = Math.min(PUMP.goal, Math.max(0, b.height + speed * dt));
  if (b.height >= PUMP.goal) b.finishedAt = time;
}

/** Finished balloons rank by time; the rest by height. */
export function pumpScores(balloons: readonly Balloon[]): number[] {
  return balloons.map((b) => (b.finishedAt !== null ? 10_000 - b.finishedAt * 100 : b.height));
}
