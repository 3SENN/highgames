// Sound effects synthesised with Web Audio: no audio files. Browsers only allow sound after a click
// or key press on the page, so the TV asks for one click and unlocks here.

type Wave = OscillatorType;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** The audio context and the main output, for music made in the page (null until sound is unlocked). */
  get audio(): { ctx: AudioContext; out: AudioNode } | null {
    return this.ctx && this.master ? { ctx: this.ctx, out: this.master } : null;
  }

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  private tone(freq: number, dur: number, opts: { type?: Wave; gain?: number; at?: number; slide?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.at ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, opts: { gain?: number; at?: number; freq?: number; q?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.at ?? 0);
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = opts.freq ?? 1200;
    filter.Q.value = opts.q ?? 0.7;
    const g = ctx.createGain();
    g.gain.value = opts.gain ?? 0.4;
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
  }

  hop(): void {
    this.tone(520, 0.09, { type: 'sine', gain: 0.2, slide: 780 });
  }
  coin(up: boolean): void {
    if (up) {
      this.tone(988, 0.08, { type: 'square', gain: 0.12 });
      this.tone(1319, 0.18, { type: 'square', gain: 0.12, at: 0.07 });
    } else {
      this.tone(330, 0.12, { type: 'sawtooth', gain: 0.12 });
      this.tone(247, 0.22, { type: 'sawtooth', gain: 0.12, at: 0.1 });
    }
  }
  roll(): void {
    for (let i = 0; i < 8; i++) this.tone(300 + Math.random() * 500, 0.04, { type: 'square', gain: 0.08, at: i * 0.09 });
  }
  fanfare(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i === 3 ? 0.5 : 0.14, { type: 'triangle', gain: 0.25, at: i * 0.11 }));
  }
  thunder(): void {
    this.noise(1.6, { gain: 0.9, freq: 500 });
    this.noise(0.25, { gain: 0.6, freq: 4000 });
  }
  rumble(): void {
    this.noise(1.2, { gain: 0.25, freq: 180 });
  }
  pump(): void {
    this.noise(0.12, { gain: 0.25, freq: 2200, q: 2 });
  }
  pop(): void {
    this.noise(0.3, { gain: 0.8, freq: 3000 });
    this.tone(160, 0.2, { type: 'sine', gain: 0.4, slide: 60 });
  }
  ring(gold: boolean): void {
    this.tone(gold ? 1568 : 1175, 0.25, { type: 'sine', gain: 0.25 });
    if (gold) this.tone(2093, 0.3, { type: 'sine', gain: 0.2, at: 0.08 });
  }
  tick(): void {
    this.tone(880, 0.05, { type: 'sine', gain: 0.12 });
  }
  go(): void {
    this.tone(660, 0.12, { gain: 0.3 });
    this.tone(990, 0.3, { gain: 0.3, at: 0.12 });
  }
  good(): void {
    this.tone(784, 0.1, { type: 'sine', gain: 0.25 });
    this.tone(1175, 0.2, { type: 'sine', gain: 0.25, at: 0.08 });
  }
  bad(): void {
    this.tone(220, 0.25, { type: 'square', gain: 0.12, slide: 160 });
  }
  whoosh(): void {
    this.noise(0.6, { gain: 0.35, freq: 900, q: 3 });
  }
  join(): void {
    this.tone(660, 0.1, { type: 'sine', gain: 0.2 });
    this.tone(880, 0.16, { type: 'sine', gain: 0.2, at: 0.09 });
  }
  win(): void {
    [523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', gain: 0.25, at: i * 0.16 }));
  }
}
