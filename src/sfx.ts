// Tiny synthesized sound effects. No audio files needed.

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Must be called from a user gesture (click / tap). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number) {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, cutoff: number) {
    const c = this.ctx;
    if (!c || !this.master || !this.noise) return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  laser() {
    this.tone('square', 1400, 300, 0.09, 0.08);
  }
  enemyShot() {
    this.tone('sawtooth', 500, 160, 0.18, 0.05);
  }
  hit() {
    this.tone('triangle', 900, 1600, 0.05, 0.12);
  }
  hurt() {
    this.burst(0.25, 0.5, 1800);
    this.tone('sawtooth', 160, 60, 0.25, 0.15);
  }
  explode(big = false) {
    this.burst(big ? 1.4 : 0.7, big ? 0.9 : 0.6, big ? 2500 : 4000);
    this.tone('sine', 140, 30, big ? 1 : 0.5, 0.4);
  }
  chime() {
    this.tone('sine', 660, 660, 0.15, 0.15);
    setTimeout(() => this.tone('sine', 990, 990, 0.25, 0.15), 120);
  }
}
