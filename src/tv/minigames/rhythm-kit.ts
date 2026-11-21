// The rhythm kit on the TV, shared by the Lo-Fi Session games:
//  - LofiBeat: a mellow beat synthesised with Web Audio (soft kick, brushed snare, hats, warm keys through a gentle
//    low-pass, a little bass and vinyl crackle), scheduled from the game clock so ?speed and pauses stay in sync.
//  - RhythmRound: the beat clock. Pulses every phone on the beat, judges each phone's moves (half its round trip
//    taken off), sends Perfect / Good / Miss back, sweeps up missed notes and plays the computer seats.
//  - NoteLane: a lane of markers sliding toward a hit ring, so everyone can read the rhythm before it arrives.
//
// A game makes a chart (game/minigames/rhythm.ts), builds its view with a NoteLane per seat, then:
//   const round = new RhythmRound(ctx, { chart, motion: 'nod', groove: GROOVES.couch, note: '…', onJudge });
//   await round.play((dt, time) => { /* captions, live scores */ });   // stops music, input and timer itself
//   return { scores: round.tracks.map((t) => t.score), details: round.tracks.map(summary) };
//
// Pad charts (motion 'pads'): moves carry the pad, pulses name the pad of the coming note, and a NoteLane per pad
// (`only`) shows each pad's notes. Held notes (motion 'hold'): letting go is judged too (`j.release`), the lane
// draws each note's length as a tail, and `music.whistle()` gives a sound to hold.
import * as THREE from 'three';
import {
  type Chart,
  type CpuMove,
  type Grade,
  type Judgement,
  type Note,
  type Track,
  barAt,
  barLabel,
  cpuMoves,
  hasHolds,
  judgeHit,
  judgeRelease,
  newTrack,
  padCount,
  sweepHolds,
  sweepMisses,
  upcomingNote,
} from '../../game/minigames/rhythm';
import type { Layout, RhythmMotion } from '../../shared/protocol';
import { PALETTE as P, ball, canvasTexture, cyl, material, mix, part, popSprite, rbox, torus } from '../render/toon';
import type { Ui } from '../ui';
import type { MinigameContext } from './types';

// ------------------------------------------------------------------ the music

/** A groove: chords and drums for one game. Steps are sixteenths in a bar (0-15); chords and bass are MIDI notes. */
export interface Groove {
  /** Keys voicings, one chord per bar, cycling. */
  chords: readonly (readonly number[])[];
  /** The bass root under each chord. */
  bass: readonly number[];
  kick: readonly number[];
  snare: readonly number[];
  hats: readonly number[];
  /** Where the keys play: the first hit rings through, later ones are softer. */
  keys: readonly number[];
  /** Where the bass plays (root, root, fifth, octave in turn). */
  bassSteps: readonly number[];
  /** How late the odd sixteenths fall, as a fraction of a sixteenth (the off-beat eighths stay straight). */
  swing: number;
  /** The keys' low-pass in Hz: lower is warmer and sleepier. */
  cutoff: number;
  /**
   * A soft lead melody (a mellow vibraphone), one list per bar, cycling: [sixteenth step, MIDI note, length in
   * sixteenths]. Plays in the chart's bars only.
   */
  lead?: readonly (readonly (readonly [number, number, number])[])[];
}

/** Our own simple progressions, one per game. */
export const GROOVES = {
  /** Head Nod: a slow nod in D major (IVmaj9, iii9, ii9, V9sus). */
  couch: {
    chords: [
      [59, 62, 66, 69],
      [57, 61, 64, 68],
      [55, 59, 62, 66],
      [55, 59, 62, 64],
    ],
    bass: [43, 42, 40, 45],
    kick: [0, 7, 10],
    snare: [4, 12],
    hats: [0, 2, 4, 6, 8, 10, 12, 14, 15],
    keys: [0, 10],
    bassSteps: [0, 7, 10],
    swing: 0.22,
    cutoff: 1500,
  },
  /** Snack Stack: a bouncier kitchen groove in F (IVmaj9, iii7, vi9, V9sus). */
  kitchen: {
    chords: [
      [57, 60, 62, 65],
      [55, 60, 64, 67],
      [57, 60, 64, 65],
      [58, 62, 65, 67],
    ],
    bass: [46, 45, 38, 48],
    kick: [0, 8, 11],
    snare: [4, 12],
    hats: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14],
    keys: [0, 6, 10],
    bassSteps: [0, 6, 8, 11],
    swing: 0.16,
    cutoff: 1900,
  },
  /** Mellow Strum: a slow porch walk down in C (IVmaj7, iii7, ii7, Imaj9), keys left soft for the ukuleles. */
  porch: {
    chords: [
      [57, 60, 64, 65],
      [55, 59, 62, 64],
      [57, 60, 62, 65],
      [52, 55, 59, 62],
    ],
    bass: [41, 40, 38, 36],
    kick: [0, 9],
    snare: [4, 12],
    hats: [0, 2, 4, 6, 8, 10, 12, 14, 3, 7, 11, 15],
    keys: [0],
    bassSteps: [0, 8],
    swing: 0.12,
    cutoff: 1250,
  },
  /** Couch Bongos: a late-night jam in A dorian (Am9, D9, Fmaj9, Em7) with a soft vibraphone line on top. */
  jam: {
    chords: [
      [60, 64, 67, 71],
      [57, 60, 64, 66],
      [57, 60, 64, 67],
      [55, 59, 62, 64],
    ],
    bass: [45, 38, 41, 40],
    kick: [0, 6, 10],
    snare: [4, 12],
    hats: [0, 2, 4, 6, 8, 10, 12, 14],
    keys: [0, 7],
    bassSteps: [0, 6, 10],
    swing: 0.2,
    cutoff: 1600,
    lead: [
      [
        [0, 76, 6],
        [8, 79, 2],
        [10, 76, 2],
        [12, 74, 4],
      ],
      [
        [2, 78, 4],
        [6, 76, 2],
        [8, 74, 4],
        [14, 69, 2],
      ],
      [
        [0, 72, 6],
        [6, 76, 2],
        [8, 79, 6],
      ],
      [
        [2, 71, 4],
        [8, 74, 2],
        [10, 76, 6],
      ],
    ],
  },
  /** Kettle Choir: a half-time kitchen hush in B flat (Ebmaj9, Dm7, Cm9, F9sus); the kettles sing the tune. */
  kettle: {
    chords: [
      [55, 58, 62, 65],
      [57, 60, 62, 65],
      [58, 62, 63, 67],
      [58, 60, 63, 67],
    ],
    bass: [39, 38, 36, 41],
    kick: [0, 10],
    snare: [8],
    hats: [0, 2, 4, 6, 8, 10, 12, 14],
    keys: [0, 10],
    bassSteps: [0, 10],
    swing: 0.18,
    cutoff: 1300,
  },
} satisfies Record<string, Groove>;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A sound that lasts until it is stopped (a held note's whistle). */
export interface Voice {
  /** Fades it out, `delay` seconds from now (safe to call more than once). */
  stop(delay?: number): void;
}

/**
 * The music: scheduled a moment ahead of the game clock. `pump(time, speed)` every frame keeps it in step; game
 * sounds (strum, chime, tock, plop, drum, whistle) play right away in the same mix. `stop()` fades it out and lets
 * go of it.
 */
export class LofiBeat {
  private readonly ac: AudioContext;
  private readonly out: GainNode;
  private readonly keysFilter: BiquadFilterNode;
  private readonly keysBus: GainNode;
  private readonly drums: GainNode;
  private readonly low: GainNode;
  private readonly fx: GainNode;
  private readonly noise: AudioBuffer;
  private readonly wow: OscillatorNode;
  private readonly crackle: AudioBufferSourceNode;
  private readonly leadBus: GainNode | null = null;
  private readonly tremolo: OscillatorNode | null = null;
  private readonly voices = new Set<Voice>();
  private step = -1;
  private offset = NaN;
  private speed = 1;
  private time = 0;
  private stopped = false;

  constructor(
    audio: { ctx: AudioContext; out: AudioNode },
    readonly groove: Groove,
    readonly chart: Chart,
  ) {
    const ac = audio.ctx;
    this.ac = ac;
    this.out = ac.createGain();
    this.out.gain.value = 0.55;
    // A gentle tape-like roll-off over everything.
    const tape = ac.createBiquadFilter();
    tape.type = 'lowpass';
    tape.frequency.value = 8500;
    tape.Q.value = 0.5;
    tape.connect(this.out);
    this.out.connect(audio.out);

    this.keysFilter = ac.createBiquadFilter();
    this.keysFilter.type = 'lowpass';
    this.keysFilter.frequency.value = groove.cutoff;
    this.keysFilter.Q.value = 0.6;
    this.keysBus = ac.createGain();
    this.keysBus.gain.value = 1;
    const keysLevel = ac.createGain();
    keysLevel.gain.value = 0.55;
    // A slow wobble on the keys' pitch, like a well-loved tape: a short delay whose length drifts.
    const wobble = ac.createDelay(0.05);
    wobble.delayTime.value = 0.006;
    this.wow = ac.createOscillator();
    this.wow.frequency.value = 0.4;
    const depth = ac.createGain();
    depth.gain.value = 0.0012;
    this.wow.connect(depth).connect(wobble.delayTime);
    this.wow.start();
    this.keysFilter.connect(this.keysBus).connect(wobble).connect(keysLevel).connect(tape);
    this.drums = ac.createGain();
    this.drums.gain.value = 0.7;
    this.drums.connect(tape);
    const bassFilter = ac.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.value = 700;
    this.low = ac.createGain();
    this.low.gain.value = 0.6;
    this.low.connect(bassFilter).connect(tape);
    this.fx = ac.createGain();
    this.fx.gain.value = 0.7;
    this.fx.connect(tape);

    this.noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;

    // Vinyl crackle: soft hiss with sparse little pops, looped.
    const len = ac.sampleRate * 4;
    const vinyl = ac.createBuffer(1, len, ac.sampleRate);
    const v = vinyl.getChannelData(0);
    let pop = 0;
    for (let i = 0; i < len; i++) {
      if (Math.random() < 0.0003) pop = (0.2 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1);
      v[i] = pop + (Math.random() * 2 - 1) * 0.008;
      pop *= 0.8;
    }
    this.crackle = ac.createBufferSource();
    this.crackle.buffer = vinyl;
    this.crackle.loop = true;
    const hiss = ac.createBiquadFilter();
    hiss.type = 'bandpass';
    hiss.frequency.value = 3200;
    hiss.Q.value = 0.4;
    const vinylLevel = ac.createGain();
    vinylLevel.gain.value = 0.16;
    this.crackle.connect(hiss).connect(vinylLevel).connect(this.out);
    this.crackle.start();

    if (groove.lead) {
      // The lead: a soft vibraphone with a slow shimmer (its motor), behind a gentle low-pass.
      this.leadBus = ac.createGain();
      this.leadBus.gain.value = 0.85;
      this.tremolo = ac.createOscillator();
      this.tremolo.frequency.value = 4.6;
      const shimmer = ac.createGain();
      shimmer.gain.value = 0.18;
      this.tremolo.connect(shimmer).connect(this.leadBus.gain);
      this.tremolo.start();
      const leadFilter = ac.createBiquadFilter();
      leadFilter.type = 'lowpass';
      leadFilter.frequency.value = 2800;
      this.leadBus.connect(leadFilter).connect(tape);
    }
  }

  /** Schedules what falls in the next moment. Call every frame with the song time now and the clock's speed. */
  pump(time: number, speed: number): void {
    if (this.stopped) return;
    const ac = this.ac;
    this.time = time;
    // Map song time to audio time, played early by the output latency so the sound reaches the room on the beat.
    const latency = Math.min(0.25, Math.max(0, (ac.outputLatency || 0) + (ac.baseLatency || 0)));
    const target = ac.currentTime - time / speed - latency;
    if (!Number.isFinite(this.offset) || speed !== this.speed || Math.abs(target - this.offset) > 0.05) this.offset = target;
    else this.offset += (target - this.offset) * 0.05;
    this.speed = speed;
    const sixteenth = this.chart.beat / 4;
    // Start with whatever is due now (the first frame comes a moment after the song starts).
    if (this.step < 0) this.step = Math.max(0, Math.ceil((time - 0.05 * speed) / sixteenth));
    const horizon = time + 0.15 * speed;
    const last = Math.round(this.chart.end / sixteenth);
    while (this.step * sixteenth < horizon && this.step <= last) {
      const swing = this.step % 2 === 1 ? this.groove.swing * sixteenth : 0;
      const at = this.offset + (this.step * sixteenth + swing) / speed;
      // Something just due plays now; after a hiccup, what is well past is skipped rather than played in a heap.
      if (at >= ac.currentTime - latency - 0.06) this.playStep(this.step, Math.max(at, ac.currentTime));
      this.step += 1;
    }
  }

  /** The chord under song time `time` (the first one in the count-in and the tail). */
  chordAt(time = this.time): readonly number[] {
    const bar = barAt(this.chart, time);
    const i = bar < 0 || bar >= this.chart.bars.length ? 0 : bar % this.groove.chords.length;
    return this.groove.chords[i] ?? [60, 64, 67];
  }

  private playStep(step: number, at: number): void {
    const g = this.groove;
    const beatReal = this.chart.beat / this.speed;
    const rel = step - this.chart.countIn * 4;
    const bar = Math.floor(rel / 16);
    const s = ((rel % 16) + 16) % 16;
    const bars = this.chart.bars.length;
    if (bar < 0) {
      // Count-in: a soft click on each beat, quiet hats, and the first chord muffled, opening up into bar one.
      if (s % 4 === 0) this.rim(at, rel === -this.chart.countIn * 4 ? 1 : 0.7);
      if (s % 2 === 0) this.hat(at, 0.45);
      if (rel === -this.chart.countIn * 4) {
        const into = this.offset + this.chart.start / this.speed;
        this.keysFilter.frequency.cancelScheduledValues(at);
        this.keysFilter.frequency.setValueAtTime(380, at);
        this.keysFilter.frequency.exponentialRampToValueAtTime(g.cutoff, Math.max(at + 0.1, into));
        this.keys(at, this.groove.chords[0] ?? [], this.chart.countIn * beatReal, 0.7);
      }
      return;
    }
    if (bar >= bars) {
      // The tail: the first chord again, left to ring out.
      if (rel === bars * 16) {
        this.kick(at, 0.8);
        this.keys(at, this.groove.chords[0] ?? [], 2.5 * beatReal, 1);
        this.bassNote(at, g.bass[0] ?? 43, 2 * beatReal);
      }
      return;
    }
    const chord = g.chords[bar % g.chords.length] ?? [];
    const root = g.bass[bar % g.bass.length] ?? 43;
    const fill = bar % 4 === 3;
    if (g.kick.includes(s) || (fill && s === 14)) {
      this.kick(at, s === 0 ? 1 : 0.8);
      // Keys duck a little under the kick.
      this.keysBus.gain.setValueAtTime(0.6, at);
      this.keysBus.gain.linearRampToValueAtTime(1, at + 0.22);
    }
    if (g.snare.includes(s)) this.snare(at, 1);
    else if (fill && (s === 13 || s === 15)) this.snare(at, 0.35);
    if (g.hats.includes(s)) this.hat(at, s % 4 === 0 ? 0.85 : s % 2 === 0 ? 0.6 : 0.35);
    const k = g.keys.indexOf(s);
    if (k >= 0) {
      const next = g.keys[k + 1] ?? 16;
      this.keys(at, chord, (k === 0 ? Math.max(next - s, 12) : next - s) * (beatReal / 4), k === 0 ? 1 : 0.6);
    }
    const b = g.bassSteps.indexOf(s);
    if (b >= 0) {
      const next = g.bassSteps[b + 1] ?? 16;
      this.bassNote(at, root + ([0, 0, 7, 12][b % 4] ?? 0), (next - s) * (beatReal / 4) * 0.85);
    }
    const lead = g.lead?.[bar % g.lead.length];
    if (lead) for (const [st, m, len] of lead) if (st === s) this.vibes(at, m, len * (beatReal / 4));
  }

  // -------------------------------------------------------------- instruments

  private env(at: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    return g;
  }

  private osc(type: OscillatorType, freq: number, at: number, until: number): OscillatorNode {
    const o = this.ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    o.start(at);
    o.stop(until);
    return o;
  }

  private noiseBurst(at: number, until: number): AudioBufferSourceNode {
    const src = this.ac.createBufferSource();
    src.buffer = this.noise;
    src.start(at, Math.random() * 0.5);
    src.stop(until);
    return src;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private kick(at: number, vel: number): void {
    const o = this.osc('sine', 112, at, at + 0.45);
    o.frequency.exponentialRampToValueAtTime(46, at + 0.12);
    o.connect(this.env(at, 0.75 * vel, 0.006, 0.4)).connect(this.drums);
  }

  /** A brushed snare: noise with a slow-ish swish in, and a little body. */
  private snare(at: number, vel: number): void {
    this.noiseBurst(at, at + 0.32)
      .connect(this.filter('bandpass', 2300, 0.6))
      .connect(this.filter('highpass', 600))
      .connect(this.env(at, 0.3 * vel, 0.014, 0.25))
      .connect(this.drums);
    this.osc('triangle', 190, at, at + 0.14).connect(this.env(at, 0.08 * vel, 0.004, 0.1)).connect(this.drums);
  }

  private hat(at: number, vel: number): void {
    this.noiseBurst(at, at + 0.06).connect(this.filter('highpass', 5600)).connect(this.env(at, 0.065 * vel, 0.002, 0.04)).connect(this.drums);
  }

  private rim(at: number, vel: number): void {
    this.osc('triangle', 1650, at, at + 0.06).connect(this.env(at, 0.12 * vel, 0.002, 0.035)).connect(this.drums);
    this.noiseBurst(at, at + 0.04).connect(this.filter('bandpass', 3200, 3)).connect(this.env(at, 0.12 * vel, 0.001, 0.025)).connect(this.drums);
  }

  /** Warm electric-piano keys: a sine with a quiet octave on top and a slightly detuned twin. */
  private keys(at: number, notes: readonly number[], dur: number, vel: number): void {
    const end = at + dur;
    for (const m of notes) {
      const f = hz(m);
      const g = this.ac.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.06 * vel, at + 0.02);
      g.gain.setTargetAtTime(0.032 * vel, at + 0.02, 0.4);
      g.gain.setTargetAtTime(0.0001, end, 0.2);
      g.connect(this.keysFilter);
      const c = this.osc('sine', f, at, end + 1.4);
      c.detune.value = 6;
      const bell = this.ac.createGain();
      bell.gain.value = 0.12;
      this.osc('sine', f, at, end + 1.4).connect(g);
      c.connect(g);
      this.osc('triangle', f * 2, at, end + 1.4).connect(bell).connect(g);
    }
  }

  private bassNote(at: number, midi: number, dur: number): void {
    const f = hz(midi);
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.34, at + 0.012);
    g.gain.setTargetAtTime(0.2, at + 0.012, 0.2);
    g.gain.setTargetAtTime(0.0001, at + Math.max(0.05, dur), 0.05);
    g.connect(this.low);
    this.osc('sine', f, at, at + dur + 0.4).connect(g);
    const over = this.ac.createGain();
    over.gain.value = 0.25;
    this.osc('triangle', f * 2, at, at + dur + 0.4).connect(over).connect(g);
  }

  /** A vibraphone note: a round sine bar with a brief bright strike, ringing a little past its length. */
  private vibes(at: number, midi: number, dur: number): void {
    if (!this.leadBus) return;
    const f = hz(midi);
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.075, at + 0.006);
    g.gain.setTargetAtTime(0.035, at + 0.006, 0.3);
    g.gain.setTargetAtTime(0.0001, at + dur, 0.22);
    g.connect(this.leadBus);
    this.osc('sine', f, at, at + dur + 1.2).connect(g);
    this.osc('sine', f * 4, at, at + 0.2).connect(this.env(at, 0.018, 0.002, 0.12)).connect(this.leadBus);
  }

  // -------------------------------------------------------------- game sounds, right away

  /** A ukulele strum of the chord playing now, low string to high. */
  strum(vel = 1): void {
    if (this.stopped) return;
    const now = this.ac.currentTime;
    this.chordAt().forEach((m, i) => {
      const at = now + i * 0.014;
      const o = this.osc('sawtooth', hz(m + 12), at, at + 1);
      o.detune.value = (Math.random() - 0.5) * 8;
      const f = this.filter('lowpass', 3200, 1.2);
      f.frequency.setValueAtTime(3200, at);
      f.frequency.exponentialRampToValueAtTime(800, at + 0.3);
      o.connect(f).connect(this.env(at, 0.045 * vel, 0.004, 0.85)).connect(this.fx);
    });
  }

  /** A soft mallet note from the chord playing now; `n` climbs through its tones. */
  chime(n: number, vel = 1): void {
    if (this.stopped) return;
    const now = this.ac.currentTime;
    const chord = this.chordAt();
    const m = (chord[n % chord.length] ?? 60) + 12 + (Math.floor(n / chord.length) % 2) * 12;
    this.osc('sine', hz(m), now, now + 0.5).connect(this.env(now, 0.09 * vel, 0.003, 0.4)).connect(this.fx);
    this.osc('sine', hz(m) * 4, now, now + 0.15).connect(this.env(now, 0.02 * vel, 0.002, 0.08)).connect(this.fx);
  }

  /** A little wooden tock. */
  tock(vel = 1): void {
    if (this.stopped) return;
    const now = this.ac.currentTime;
    this.osc('sine', 1180, now, now + 0.1).connect(this.env(now, 0.07 * vel, 0.002, 0.05)).connect(this.fx);
    this.osc('sine', 1770, now, now + 0.06).connect(this.env(now, 0.03 * vel, 0.001, 0.03)).connect(this.fx);
  }

  /** Something soft landing on the floor. */
  plop(vel = 1): void {
    if (this.stopped) return;
    const now = this.ac.currentTime;
    const o = this.osc('sine', 420, now, now + 0.3);
    o.frequency.exponentialRampToValueAtTime(110, now + 0.16);
    o.connect(this.env(now, 0.16 * vel, 0.005, 0.2)).connect(this.fx);
    this.noiseBurst(now, now + 0.1).connect(this.filter('lowpass', 600)).connect(this.env(now, 0.1 * vel, 0.003, 0.07)).connect(this.fx);
  }

  /** A hand drum (a bongo) struck with the fingers: pad 0 is the low drum, then higher ones. */
  drum(pad = 0, vel = 1): void {
    if (this.stopped) return;
    const now = this.ac.currentTime;
    const base = [196, 277, 156, 349][pad % 4] ?? 196;
    const o = this.osc('sine', base * 1.45, now, now + 0.4);
    o.frequency.exponentialRampToValueAtTime(base, now + 0.035);
    o.connect(this.env(now, 0.2 * vel, 0.003, 0.24)).connect(this.fx);
    this.osc('triangle', base * 2.4, now, now + 0.12).connect(this.env(now, 0.035 * vel, 0.002, 0.07)).connect(this.fx);
    this.noiseBurst(now, now + 0.06)
      .connect(this.filter('bandpass', base * 7, 1.4))
      .connect(this.env(now, 0.08 * vel, 0.001, 0.035))
      .connect(this.fx);
  }

  /**
   * A kettle's whistle on a tone of the chord playing now (`n` picks the tone, like `chime`): a breathy sine that
   * slides up into pitch and wavers a little. It lasts until stopped, or until the music stops.
   */
  whistle(n: number, vel = 1): Voice {
    if (this.stopped) return { stop: () => {} };
    const ac = this.ac;
    const now = ac.currentTime;
    const chord = this.chordAt();
    const f = hz((chord[n % chord.length] ?? 67) + 12 + (Math.floor(n / Math.max(1, chord.length)) % 2) * 12);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.045 * vel, now + 0.09);
    g.connect(this.fx);
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 0.93, now);
    o.frequency.exponentialRampToValueAtTime(f, now + 0.14);
    const vib = ac.createOscillator();
    vib.frequency.value = 5.3;
    const depth = ac.createGain();
    depth.gain.value = f * 0.007;
    vib.connect(depth).connect(o.frequency);
    o.connect(g);
    // Steam: a breath of noise around the pitch.
    const air = ac.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const airLevel = ac.createGain();
    airLevel.gain.value = 0.7;
    air.connect(this.filter('bandpass', f, 5)).connect(airLevel).connect(g);
    o.start(now);
    vib.start(now);
    air.start(now, Math.random() * 0.5);
    let done = false;
    const voice: Voice = {
      stop: (delay = 0) => {
        if (done) return;
        done = true;
        this.voices.delete(voice);
        const at = ac.currentTime + Math.max(0, delay);
        const hold = (g.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => void }).cancelAndHoldAtTime;
        if (hold) hold.call(g.gain, at);
        else g.gain.cancelScheduledValues(at);
        g.gain.setTargetAtTime(0.0001, at, 0.05);
        o.frequency.setTargetAtTime(f * 0.97, at, 0.12);
        for (const src of [o, vib, air]) src.stop(at + 0.5);
      },
    };
    this.voices.add(voice);
    return voice;
  }

  /** Fades out (the last chord rings a moment) and lets go of the audio graph. */
  stop(): void {
    if (this.stopped) return;
    for (const v of [...this.voices]) v.stop();
    this.stopped = true;
    const now = this.ac.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.setTargetAtTime(0, now, 0.35);
    this.crackle.stop(now + 2);
    this.wow.stop(now + 2);
    this.tremolo?.stop(now + 2);
    setTimeout(() => this.out.disconnect(), 2200);
  }
}

// ------------------------------------------------------------------ the beat clock and judging

export interface RoundOptions {
  chart: Chart;
  motion: RhythmMotion;
  groove: Groove;
  /** The line on the phones under the beat ring. */
  note: string;
  /**
   * Every judged move and every missed note, for people and computer seats alike. On a pad chart `j.wrong` marks a
   * move on the other pad; with held notes `j.release` marks letting go (and `j.broken` letting go far too early).
   */
  onJudge?: (seat: number, j: Judgement) => void;
  /** Motion 'pads': the pads' labels on the phones (their number follows the chart, at least two). */
  padLabels?: readonly string[];
  /** Motion 'pads': the pads' colours, for everyone or per seat. */
  padColors?: readonly string[] | ((seat: number) => readonly string[]);
}

const FEEDBACK: Record<Grade, string> = { perfect: 'Perfect!', good: 'Good', miss: 'Miss' };

/** What the phone says for a judgement. */
function feedbackText(j: Judgement): string {
  if (j.wrong) return 'Wrong pad';
  if (j.release && j.grade === 'miss') return j.broken ? 'Let go too soon' : (j.offset ?? 0) < 0 ? 'A bit soon' : 'Held too long';
  return FEEDBACK[j.grade];
}

/**
 * One song played by every seat. Song time is the game clock since `play()` started, so ?speed and pauses carry
 * over to the music, the pulses and the judging alike.
 */
export class RhythmRound {
  readonly chart: Chart;
  readonly tracks: Track[];
  /** The music, once the TV has sound (null before the first click: the round then keeps time silently). */
  music: LofiBeat | null = null;
  private t0: number | null = null;
  /** The game clock at its last tick and when that was, to time moves that arrive between frames. */
  private anchor = { perf: 0, time: 0 };
  private readonly plans: CpuMove[][];
  private readonly planned: number[];
  private readonly pulses: number[];
  private readonly pads: number;
  private readonly holds: boolean;
  private off: (() => void) | null = null;
  private timerShown = -1;
  private done = false;

  constructor(
    private readonly ctx: MinigameContext,
    private readonly opts: RoundOptions,
  ) {
    this.chart = opts.chart;
    this.tracks = ctx.seats.map(() => newTrack(opts.chart));
    this.plans = ctx.seats.map(() => cpuMoves(opts.chart, ctx.rng, ctx.skill()));
    this.planned = ctx.seats.map(() => 0);
    this.pulses = ctx.seats.map(() => 0);
    this.pads = padCount(opts.chart);
    this.holds = hasHolds(opts.chart);
  }

  /** The phone layout for a seat: the motion and note, and for pads their number, labels and colours. */
  private layout(seat: number): Layout {
    const o = this.opts;
    const base = { kind: 'rhythm' as const, motion: o.motion, note: o.note };
    if (o.motion !== 'pads') return base;
    const colors = typeof o.padColors === 'function' ? o.padColors(seat) : o.padColors;
    return {
      ...base,
      pads: Math.min(4, Math.max(2, this.pads, o.padLabels?.length ?? 0)),
      ...(o.padLabels ? { padLabels: [...o.padLabels] } : {}),
      ...(colors ? { padColors: [...colors] } : {}),
    };
  }

  /** Song time now: 0 on the first count-in beat. Read straight from the game clock, so views can use it too. */
  now(): number {
    return this.t0 === null ? 0 : this.ctx.clock.time - this.t0;
  }

  /** Plays the song to its end, calling `frame` every frame; stops music, input and the timer when done. */
  async play(frame?: (dt: number, time: number) => void): Promise<void> {
    const { session, clock } = this.ctx;
    session.setLayoutAll((seat) => this.layout(seat.index));
    this.t0 = clock.time;
    this.anchor = { perf: performance.now(), time: clock.time };
    // A tween's update runs inside the clock's tick, so it sees the new time the moment it is set.
    void clock.tween(this.chart.end + 5, () => {
      if (!this.done) this.anchor = { perf: performance.now(), time: clock.time };
    });
    this.off = session.onInput((seat, msg) => {
      if (msg.t === 'beat' && seat < this.tracks.length && !session.isCpu(seat)) this.phoneMove(seat, msg.pad, msg.up === true);
    });
    try {
      await new Promise<void>((resolve) => {
        let last = clock.time;
        const step = () => {
          if (this.done) return resolve();
          const dt = clock.time - last;
          last = clock.time;
          const t = this.now();
          this.tick(t);
          frame?.(dt, t);
          if (t >= this.chart.end) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    } finally {
      this.stop();
    }
  }

  /** Stops the music, input and timer (safe to call more than once). */
  stop(): void {
    this.done = true;
    this.off?.();
    this.off = null;
    this.music?.stop();
    this.music = null;
    this.ctx.ui.timer(null);
  }

  private tick(t: number): void {
    const { session, sfx, clock, ui } = this.ctx;
    const chart = this.chart;
    const audio = sfx.audio;
    if (!this.music && audio && t < chart.end - 0.5) this.music = new LofiBeat(audio, this.opts.groove, chart);
    this.music?.pump(t, clock.speed);

    // Pulses, sent early by half the phone's round trip so they arrive on the beat. None in the tail. On a pad
    // chart each one names the pad of the note coming up, so the phone can light it.
    const lastBeat = chart.countIn + chart.bars.length * 4;
    this.pulses.forEach((next, i) => {
      if (session.isCpu(i) || next >= lastBeat) return;
      const ahead = t + ((session.seats[i]?.rtt ?? 0) / 2000) * clock.speed;
      if (next * chart.beat <= ahead) {
        const pad = this.pads > 0 ? chart.notes[upcomingNote(chart, next * chart.beat)]?.pad : undefined;
        session.send(i, pad === undefined ? { t: 'pulse' } : { t: 'pulse', pad });
        this.pulses[i] = Math.floor(ahead / chart.beat) + 1;
      }
    });

    // Computer seats move as planned (a phone that drops out is played by the computer from then on).
    this.plans.forEach((plan, i) => {
      let k = this.planned[i] ?? 0;
      for (; k < plan.length && (plan[k] as CpuMove).time <= t; k++) {
        const m = plan[k] as CpuMove;
        if (session.isCpu(i)) this.move(i, m.time, m.pad, m.up === true);
      }
      this.planned[i] = k;
    });

    // Notes that slid past unplayed, and holds kept down well past their end. Phones get a little longer: their
    // moves are still on the way.
    this.tracks.forEach((track, i) => {
      const lag = session.isCpu(i) ? 0 : ((session.seats[i]?.rtt ?? 0) / 2000 + 0.1) * clock.speed;
      for (const note of sweepMisses(track, chart, t - lag)) this.report(i, { grade: 'miss', note, offset: null, combo: 0, points: 0 });
      const over = this.holds ? sweepHolds(track, chart, t - lag) : null;
      if (over) this.report(i, over);
    });

    const left = Math.ceil(Math.max(0, chart.end - t));
    if (left !== this.timerShown) {
      this.timerShown = left;
      ui.timer(left);
    }
  }

  /** A phone's move: when it happened is when it arrived, less half the phone's round trip. */
  private phoneMove(seat: number, pad?: number, up = false): void {
    if (this.t0 === null || this.done) return;
    const rtt = this.ctx.session.seats[seat]?.rtt ?? 0;
    const sinceFrame = Math.max(-1000, Math.min(250, performance.now() - rtt / 2 - this.anchor.perf));
    this.move(seat, this.anchor.time + (sinceFrame / 1000) * this.ctx.clock.speed - this.t0, pad, up);
  }

  private move(seat: number, time: number, pad?: number, up = false): void {
    const track = this.tracks[seat];
    if (!track) return;
    if (up) {
      // Letting go only means something on a chart with held notes.
      const r = this.holds ? judgeRelease(track, this.chart, time) : null;
      if (r) this.report(seat, r);
      return;
    }
    if (track.holding >= 0) {
      // Pressed again without letting go (a second finger): the hold ends here.
      const r = judgeRelease(track, this.chart, time);
      if (r) this.report(seat, r);
    }
    const j = judgeHit(track, this.chart, time, this.pads > 0 ? pad : undefined);
    if (j) this.report(seat, j);
  }

  private report(seat: number, j: Judgement): void {
    this.ctx.session.send(seat, { t: 'feedback', good: j.grade !== 'miss', text: feedbackText(j) });
    this.opts.onJudge?.(seat, j);
  }
}

/** 1 right on each beat, falling off quickly: for things that bob to the music. */
export function beatPulse(time: number, beat: number, sharpness = 6): number {
  if (time < 0) return 0;
  return Math.exp(-((time / beat) % 1) * sharpness);
}

/**
 * Puts each phrase's pattern in the caption a beat before it starts ("Nod  ●· ●· ●· ●●"), so the rhythm can be
 * read ahead. Call `update(time)` every frame. On a pad chart, `pads` gives each pad's glyph ("Tap  L· R· L· RR").
 */
export class PhraseCaption {
  private shown = Number.NaN;

  constructor(
    private readonly ui: Ui,
    private readonly chart: Chart,
    private readonly phrase: number,
    private readonly verb: string,
    private readonly outro = 'Let it ring…',
    private readonly pads?: readonly string[],
  ) {}

  update(time: number): void {
    const bar = barAt(this.chart, time + this.chart.beat);
    if (bar < 0) return;
    const p = Math.floor(bar / this.phrase);
    if (p === this.shown) return;
    this.shown = p;
    const bars = this.chart.bars.slice(p * this.phrase, (p + 1) * this.phrase);
    if (bars.length === 0) {
      this.ui.caption(this.outro);
      return;
    }
    const parts = bars.filter((b, i) => i === 0 || b !== bars[i - 1]).map((b) => barLabel(b, this.pads));
    this.ui.caption(`${this.verb}   ${parts.join('   |   ')}`);
  }
}

// ------------------------------------------------------------------ the lane of upcoming notes

export interface LaneOptions {
  color: string;
  /** Direction from the hit point to the far end, where notes appear (lane space). */
  dir: THREE.Vector3;
  /** Distance from the hit point to the far end, in world units. */
  length: number;
  /** Seconds of music the lane shows ahead. */
  ahead: number;
  /** Builds a note's marker. Default: a disc on the beat, a smaller ball on the "and". */
  marker?: (note: Note, index: number) => THREE.Object3D;
  /** The hit target at the lane's origin. Default: a glowing ring facing the camera (+z). */
  target?: THREE.Object3D;
  /** Radius of the flash around the target on a good move (default 0.36). */
  flash?: number;
  /** Draws a thin rail along the lane (default true). */
  rail?: boolean;
  /** Width of the beat lines across the lane (0 for none). Bar lines are bolder. */
  ticks?: number;
  /** Which way the beat lines lie (lane space). Default: across the lane, upright to the camera. */
  across?: THREE.Vector3;
  /** A marker on every beat with nothing to play, so rests read as rests. */
  rest?: () => THREE.Object3D;
  /** How far past the hit point a note still shows (late, or missed and greyed out). Default 0.9. */
  past?: number;
  /** Where Perfect / Good / Miss appear, relative to the hit point, and how tall. */
  labelAt?: THREE.Vector3;
  labelSize?: number;
  /** The notes this lane shows (default all): e.g. one pad's notes, for a lane per pad. */
  only?: (note: Note, index: number) => boolean;
  /**
   * Held notes: builds the tail drawn along the note's length, one unit long from its origin along +y (the lane
   * stretches it). Default: a soft bar in the lane's colour.
   */
  tail?: (note: Note, index: number) => THREE.Object3D;
}

const GREY = '#8d879c';
/** Every this many good moves in a row, the lane shows the streak ("×5", "×10"…). */
const STREAK_STEP = 5;
const SPARKS = 10;

let glowMap: THREE.Texture | null = null;
/** A soft round glow (white, fading out), shared by every lane's aura and sparks. */
function glowTexture(): THREE.Texture {
  glowMap ??= canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  return glowMap;
}

/** How a seat is doing with its held notes, as a Track has it. */
export interface HoldState {
  released: readonly (Grade | null)[];
  holding: number;
}

/**
 * Markers sliding toward a hit target, one lane per player. Call `update(time, track.judged, dt)` every frame with
 * song time and `hit(grade)` when a move is judged. With held notes, pass the track as the fourth argument
 * (`update(time, track.judged, dt, track)`): a note's tail then runs down into the target while it is held.
 *
 * The lane also shows how a seat is doing: a good move flashes the target and throws a few sparks, the word pops
 * in, and a run of good moves warms the target's glow and shows the streak every few moves. `hit(grade, combo)`
 * takes the track's combo where the game has it; without it the lane counts its own good moves in a row.
 */
export class NoteLane {
  readonly group = new THREE.Group();
  readonly target: THREE.Object3D;
  private readonly dir: THREE.Vector3;
  private readonly markers: (THREE.Object3D | null)[];
  private readonly tails: (THREE.Object3D | null)[];
  private readonly tailGreyed: boolean[];
  /** Song time a held note broke off (its tail turns grey from there), NaN while whole. */
  private readonly brokeAt: number[];
  private readonly greyed: boolean[];
  private readonly ticks: THREE.Mesh[] = [];
  private readonly rests: { time: number; obj: THREE.Object3D }[] = [];
  private readonly flash: THREE.Mesh;
  private readonly flashMat: THREE.MeshBasicMaterial;
  private readonly labels: Record<Grade, THREE.Sprite>;
  private readonly labelAt: THREE.Vector3;
  private shown: THREE.Sprite | null = null;
  private labelT = 0;
  private flashT = 0;
  private kick = 0;
  private readonly tickBeat: THREE.Material;
  private readonly tickBar: THREE.Material;
  /** A soft glow behind the target: breathes on the beat, warms with the streak, flares on a good move. */
  private readonly aura: THREE.Sprite;
  private readonly auraMat: THREE.SpriteMaterial;
  private readonly auraR: number;
  /** A second, finer ring for a Perfect. */
  private readonly ripple: THREE.Mesh;
  private readonly rippleMat: THREE.MeshBasicMaterial;
  private rippleT = 0;
  private readonly sparks: THREE.Points;
  private readonly sparkMat: THREE.PointsMaterial;
  /** Per spark: its angle round the ring and how far it flies. */
  private readonly sparkDir: number[] = [];
  private readonly flashR: number;
  private sparkT = 0;
  private streak = 0;
  private heat = 0;
  private readonly labelScale = new Map<THREE.Sprite, THREE.Vector3>();
  private readonly streakSprites = new Map<number, THREE.Sprite>();
  private streakShown: THREE.Sprite | null = null;
  private streakT = 0;
  private readonly labelSize: number;

  constructor(
    private readonly chart: Chart,
    private readonly o: LaneOptions,
  ) {
    this.dir = o.dir.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const along = new THREE.Quaternion().setFromUnitVectors(up, this.dir);
    if (o.rail !== false) {
      // A slim dark channel with a fine line of the seat's colour down its middle.
      const bed = part(this.group, rbox(0.15, o.length, 0.03, 0.012), mix(o.color, P.aubergine, 0.8), 0, 0, 0, { outline: false, shadow: false, opacity: 0.5 });
      const line = part(this.group, rbox(0.026, o.length, 0.036, 0.01), mix(o.color, P.cream, 0.2), 0, 0, 0, { outline: false, shadow: false, glow: 0.75 });
      for (const rail of [bed, line]) {
        rail.quaternion.copy(along);
        rail.position.copy(this.dir).multiplyScalar(o.length / 2);
      }
    }
    const width = o.ticks ?? 0.5;
    // Beat lines: fine and pale, so the notes stay the loudest thing in the lane; bar lines in the seat's colour.
    this.tickBeat = material(P.cream, { basic: true, opacity: 0.38 });
    this.tickBar = material(mix(o.color, P.cream, 0.35), { glow: 0.6 });
    if (width > 0) {
      let perp = o.across?.clone() ?? new THREE.Vector3().crossVectors(this.dir, new THREE.Vector3(0, 0, 1));
      if (perp.lengthSq() < 0.01) perp = new THREE.Vector3().crossVectors(this.dir, new THREE.Vector3(1, 0, 0));
      const across = new THREE.Quaternion().setFromUnitVectors(up, perp.normalize());
      const count = Math.ceil(o.ahead / chart.beat) + 2;
      for (let i = 0; i < count; i++) {
        const tick = part(this.group, rbox(0.03, width, 0.03, 0.012), '#ffffff', 0, 0, 0, { outline: false, shadow: false, material: this.tickBeat });
        tick.quaternion.copy(across);
        tick.visible = false;
        this.ticks.push(tick);
      }
    }

    this.target = o.target ?? defaultTarget(o.color);
    const r = o.flash ?? 0.36;
    this.flashR = r;
    this.auraR = r * 5.2;
    this.auraMat = new THREE.SpriteMaterial({ map: glowTexture(), color: mix(o.color, P.lamp, 0.25), transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.aura = new THREE.Sprite(this.auraMat);
    this.aura.position.copy(this.target.position);
    this.aura.scale.set(this.auraR, this.auraR, 1);
    this.aura.renderOrder = 3;
    this.group.add(this.aura);
    this.group.add(this.target);
    this.flashMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.flash = new THREE.Mesh(torus(r, r / 7), this.flashMat);
    this.flash.renderOrder = 4;
    this.flash.position.copy(this.target.position);
    this.flash.visible = false;
    this.group.add(this.flash);
    this.rippleMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.ripple = new THREE.Mesh(torus(r, r / 16), this.rippleMat);
    this.ripple.renderOrder = 4;
    this.ripple.position.copy(this.target.position);
    this.ripple.visible = false;
    this.group.add(this.ripple);
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    this.sparkMat = new THREE.PointsMaterial({ map: glowTexture(), color: '#ffffff', size: r * 0.5, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.sparks = new THREE.Points(sparkGeo, this.sparkMat);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 5;
    this.sparks.visible = false;
    this.group.add(this.sparks);
    for (let i = 0; i < SPARKS; i++) this.sparkDir.push(0, 1);

    const shows = (n: Note, i: number) => !o.only || o.only(n, i);
    this.tails = chart.notes.map((n, i) => {
      if (n.hold === undefined || !shows(n, i)) return null;
      // A holder for the tail, so the lane can lay it along the lane and stretch it to the note's length.
      const t = new THREE.Group();
      t.add(o.tail ? o.tail(n, i) : defaultTail(o.color));
      t.quaternion.copy(along);
      t.visible = false;
      this.group.add(t);
      return t;
    });
    this.tailGreyed = chart.notes.map(() => false);
    this.brokeAt = chart.notes.map(() => Number.NaN);
    this.markers = chart.notes.map((n, i) => {
      if (!shows(n, i)) return null;
      const m = o.marker ? o.marker(n, i) : defaultMarker(n, o.color);
      m.visible = false;
      this.group.add(m);
      return m;
    });
    this.greyed = chart.notes.map(() => false);

    if (o.rest) {
      chart.bars.forEach((bar, b) => {
        for (let k = 0; k < 4; k++) {
          if (bar[k * 2] !== '.' || bar[k * 2 + 1] !== '.') continue;
          const obj = (o.rest as () => THREE.Object3D)();
          obj.visible = false;
          this.group.add(obj);
          this.rests.push({ time: chart.start + (b * 4 + k) * chart.beat, obj });
        }
      });
    }

    const size = o.labelSize ?? 0.42;
    this.labelSize = size;
    this.labels = {
      perfect: popSprite('Perfect!', '#FFE7A0', size),
      good: popSprite('Good', mix(o.color, P.cream, 0.55), size * 0.92),
      miss: popSprite('Miss', '#A9A1B8', size * 0.8),
    };
    this.labelAt = o.labelAt ?? new THREE.Vector3(0, 0.75, 0);
    for (const l of Object.values(this.labels)) {
      l.visible = false;
      this.labelScale.set(l, l.scale.clone());
      this.group.add(l);
    }
  }

  /**
   * Lights the target up for a good move and shows the word for any move. `combo` is the seat's combo after the
   * move, where the game knows it (a lane per pad shares one combo); without it the lane counts its own.
   */
  hit(grade: Grade, combo?: number): void {
    const before = this.streak;
    this.streak = combo ?? (grade === 'miss' ? 0 : this.streak + 1);
    if (grade !== 'miss') {
      const perfect = grade === 'perfect';
      this.flashT = 1;
      this.flashMat.color.set(perfect ? '#ffe9a8' : mix(this.o.color, '#ffffff', 0.45));
      this.kick = 1;
      if (perfect) {
        this.rippleT = 1;
        this.rippleMat.color.set(mix(this.o.color, '#ffffff', 0.6));
      }
      // Sparks fly out of the ring: a full burst for a Perfect, a few for a Good.
      const n = perfect ? SPARKS : 5;
      this.sparks.geometry.setDrawRange(0, n);
      this.sparkMat.color.set(perfect ? '#ffe9a8' : mix(this.o.color, '#ffffff', 0.5));
      const turn = Math.random() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        this.sparkDir[i * 2] = turn + ((i + Math.random() * 0.6) / n) * Math.PI * 2;
        this.sparkDir[i * 2 + 1] = 0.7 + Math.random() * 0.9;
      }
      this.sparkT = 1;
      if (this.streak >= STREAK_STEP && this.streak % STREAK_STEP === 0 && this.streak !== before) this.showStreak(this.streak);
    }
    if (this.shown) this.shown.visible = false;
    this.shown = this.labels[grade];
    this.shown.visible = true;
    this.labelT = 0;
  }

  /** Hides the word now showing (lanes sharing one spot, e.g. a lane per pad, clear each other's). */
  clearLabel(): void {
    if (this.shown) this.shown.visible = false;
    this.shown = null;
    if (this.streakShown) this.streakShown.visible = false;
    this.streakShown = null;
  }

  /** The streak under the word: "×5", "×10"… */
  private showStreak(n: number): void {
    if (this.streakShown) this.streakShown.visible = false;
    let s = this.streakSprites.get(n);
    if (!s) {
      s = popSprite(`×${n}`, mix(this.o.color, P.cream, 0.3), this.labelSize * 0.72);
      this.labelScale.set(s, s.scale.clone());
      this.streakSprites.set(n, s);
      this.group.add(s);
    }
    s.visible = true;
    this.streakShown = s;
    this.streakT = 0;
  }

  /** Lays a held note's tail from lane distance `from` to `to`, cut to what the lane shows. */
  private placeTail(tail: THREE.Object3D, from: number, to: number, past: number): void {
    const lo = Math.max(from, -past);
    const hi = Math.min(to, this.o.length);
    tail.visible = hi - lo > 0.02;
    if (!tail.visible) return;
    tail.position.copy(this.dir).multiplyScalar(lo);
    tail.scale.set(1, hi - lo, 1);
  }

  private greyTail(i: number, tail: THREE.Object3D): void {
    if (this.tailGreyed[i]) return;
    this.tailGreyed[i] = true;
    greyOut(tail);
  }

  update(time: number, judged: readonly (Grade | null)[], dt: number, hold?: HoldState): void {
    const { length, ahead } = this.o;
    const at = (t: number) => ((t - time) / ahead) * length;
    const past = this.o.past ?? 0.9;

    this.chart.notes.forEach((n, i) => {
      const m = this.markers[i];
      if (!m) return;
      const g = judged[i] ?? null;
      const tail = this.tails[i] ?? null;
      const d = at(n.time);
      if (g === 'perfect' || g === 'good') {
        m.visible = false;
        if (!tail) return;
        // A held note played well: its head waits in the target while the rest of it runs in, until let go.
        const end = at(n.release ?? n.time);
        const rel = hold?.released[i] ?? null;
        if (rel === 'perfect' || rel === 'good' || (rel === null && end <= 0)) {
          tail.visible = false;
          return;
        }
        if (rel === 'miss') {
          // It broke off (or ran over): what was left slides on, grey.
          if (Number.isNaN(this.brokeAt[i])) this.brokeAt[i] = time;
          this.greyTail(i, tail);
          this.placeTail(tail, at(this.brokeAt[i] as number), end, past);
          return;
        }
        m.visible = true;
        m.position.set(0, 0, 0);
        m.scale.setScalar(1);
        this.placeTail(tail, Math.max(0, d), end, past);
        return;
      }
      if (g === 'miss' && !this.greyed[i]) {
        this.greyed[i] = true;
        greyOut(m);
      }
      if (tail) {
        if (g === 'miss') this.greyTail(i, tail);
        this.placeTail(tail, d, at(n.release ?? n.time), past);
      }
      m.visible = d <= length && d >= -past;
      if (!m.visible) return;
      m.position.copy(this.dir).multiplyScalar(d);
      const grow = Math.min(1, Math.max(0, (length - d) / (0.15 * length)));
      const fade = g === 'miss' ? 0.75 * Math.min(1, Math.max(0.05, 1 + d / past)) : 1;
      m.scale.setScalar(Math.max(0.001, grow * fade));
    });

    for (const r of this.rests) {
      const d = at(r.time);
      r.obj.visible = d <= length && d > -0.3;
      if (!r.obj.visible) continue;
      r.obj.position.copy(this.dir).multiplyScalar(d);
      const grow = Math.min(1, Math.max(0, (length - d) / (0.15 * length)));
      r.obj.scale.setScalar(Math.max(0.001, grow * (d < 0 ? 1 + d / 0.3 : 1)));
    }

    if (this.ticks.length) {
      const beat = this.chart.beat;
      const lastBeat = this.chart.countIn + this.chart.bars.length * 4;
      let b = Math.max(0, Math.ceil((time - (0.15 / length) * ahead) / beat));
      for (const tick of this.ticks) {
        const d = at(b * beat);
        tick.visible = b <= lastBeat && d <= length;
        if (tick.visible) {
          tick.position.copy(this.dir).multiplyScalar(d);
          const bar = (b - this.chart.countIn) % 4 === 0;
          tick.material = bar ? this.tickBar : this.tickBeat;
          const grow = Math.min(1, Math.max(0, (length - d) / (0.15 * length)));
          tick.scale.set(bar ? 1.6 : 1, grow * (bar ? 1.25 : 1), bar ? 1.6 : 1);
        }
        b += 1;
      }
    }

    // The target breathes on the beat and jumps on a good move, dipping back past its size before it settles.
    this.kick = Math.max(0, this.kick - dt * 4.5);
    const breathe = time < this.chart.end - this.chart.beat * 3 ? beatPulse(time, this.chart.beat) : 0;
    const k = this.kick;
    const jump = k > 0 ? k * k * 0.34 - Math.sin((1 - k) * Math.PI) * 0.07 * k : 0;
    this.target.scale.setScalar(1 + breathe * 0.1 + jump);

    // The flash: a bright ring that opens quickly and fades, and for a Perfect a finer one that travels further.
    this.flashT = Math.max(0, this.flashT - dt * 3.2);
    this.flashMat.opacity = this.flashT ** 1.5 * 0.95;
    this.flash.visible = this.flashT > 0;
    this.flash.scale.setScalar(1 + (1 - this.flashT ** 3) * 0.75);
    this.rippleT = Math.max(0, this.rippleT - dt * 2.1);
    this.ripple.visible = this.rippleT > 0;
    this.rippleMat.opacity = this.rippleT ** 2 * 0.7;
    this.ripple.scale.setScalar(1.1 + (1 - this.rippleT ** 2) * 1.5);

    if (this.sparkT > 0) {
      this.sparkT = Math.max(0, this.sparkT - dt * 2.3);
      const out = 1 - this.sparkT ** 3;
      const pos = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
      const c = this.target.position;
      for (let i = 0; i < SPARKS; i++) {
        const a = this.sparkDir[i * 2] ?? 0;
        const d = this.flashR * (1 + out * 2.1 * (this.sparkDir[i * 2 + 1] ?? 1));
        pos.setXYZ(i, c.x + Math.cos(a) * d, c.y + Math.sin(a) * d - out * out * this.flashR * 0.5, c.z);
      }
      pos.needsUpdate = true;
      this.sparkMat.opacity = Math.min(1, this.sparkT * 1.6);
      this.sparkMat.size = this.flashR * (0.28 + 0.3 * this.sparkT);
    }
    this.sparks.visible = this.sparkT > 0;

    // The glow behind the target: a run of good moves warms it up, a miss lets it cool again.
    this.heat += (Math.min(1, this.streak / 12) - this.heat) * Math.min(1, dt * 3.5);
    this.auraMat.opacity = Math.min(0.85, 0.1 + breathe * 0.07 + this.heat * 0.2 + this.flashT ** 2 * 0.3);
    const ar = this.auraR * (1 + this.heat * 0.3 + this.flashT * 0.25);
    this.aura.scale.set(ar, ar, 1);

    if (this.shown) {
      this.labelT += dt;
      this.placeWord(this.shown, this.labelT, 0);
      if (this.labelT > 0.75) {
        this.shown.visible = false;
        this.shown = null;
      }
    }
    if (this.streakShown) {
      this.streakT += dt;
      this.placeWord(this.streakShown, this.streakT, -this.labelSize * 0.82);
      if (this.streakT > 0.75) {
        this.streakShown.visible = false;
        this.streakShown = null;
      }
    }
  }

  /** A word pops in a little too big, settles, drifts up and fades. */
  private placeWord(word: THREE.Sprite, t: number, dy: number): void {
    word.position.set(this.labelAt.x, this.labelAt.y + dy + 0.3 * (1 - Math.exp(-t * 4)), this.labelAt.z);
    const p = Math.min(1, t / 0.16);
    const pop = 0.6 + 0.4 * p + Math.sin(p * Math.PI) * 0.2;
    const base = this.labelScale.get(word);
    if (base) word.scale.set(base.x * pop, base.y * pop, 1);
    word.material.opacity = Math.min(1, t / 0.05) * (1 - Math.max(0, t - 0.45) / 0.3);
  }

  dispose(): void {
    this.flashMat.dispose();
    this.rippleMat.dispose();
    this.auraMat.dispose();
    this.sparkMat.dispose();
    this.sparks.geometry.dispose();
    for (const l of [...Object.values(this.labels), ...this.streakSprites.values()]) {
      l.material.map?.dispose();
      l.material.dispose();
    }
    this.group.removeFromParent();
  }
}

/**
 * A lane's hit target: a glowing ring in the seat's colour with a fine pale ring inside it and a dark glass disc
 * behind, facing the camera (+z). `r` is the ring's radius.
 */
export function laneTarget(color: string, r = 0.3): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(r * 0.98, r * 0.98, 0.012, 32), mix(color, P.aubergine, 0.82), 0, 0, -0.03, { rx: Math.PI / 2, opacity: 0.42, outline: false, shadow: false });
  part(g, torus(r, r * 0.15), color, 0, 0, 0, { glow: 0.8, shadow: false, outline: false });
  part(g, torus(r * 0.7, r * 0.035), mix(color, P.cream, 0.7), 0, 0, 0, { glow: 0.6, shadow: false, outline: false });
  return g;
}

function defaultTarget(color: string): THREE.Group {
  return laneTarget(color, 0.3);
}

/** A held note's tail: a soft bar one unit long, up from the origin, with a paler core. */
function defaultTail(color: string): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(0.075, 0.075, 1, 14), mix(color, '#ffffff', 0.25), 0, 0.5, 0, { glow: 0.35, shadow: false });
  part(g, cyl(0.03, 0.03, 1.002, 8), mix(color, '#ffffff', 0.7), 0, 0.5, 0.06, { glow: 0.8, shadow: false, outline: false });
  return g;
}

function defaultMarker(note: Note, color: string): THREE.Group {
  const g = new THREE.Group();
  if (note.onBeat) {
    // A bevelled puck: a dark rim, the seat's colour, and a pale dot in the middle.
    part(g, cyl(0.2, 0.2, 0.07, 24), mix(color, P.ink, 0.45), 0, 0, 0, { rx: Math.PI / 2, shadow: false });
    part(g, cyl(0.16, 0.16, 0.085, 24), color, 0, 0, 0, { rx: Math.PI / 2, glow: 0.4, shadow: false, outline: false });
    part(g, cyl(0.06, 0.06, 0.095, 16), mix(color, '#ffffff', 0.65), 0, 0, 0, { rx: Math.PI / 2, glow: 0.6, shadow: false, outline: false });
  } else {
    part(g, ball(0.11), mix(color, '#ffffff', 0.3), 0, 0, 0, { glow: 0.4, shadow: false });
  }
  return g;
}

/** A missed note's marker turns grey (its outline stays). */
function greyOut(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.name !== 'outline') mesh.material = material(GREY);
  });
}
