/**
 * Procedural Web Audio API sound synthesizer — zero external audio assets required.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = true;
  private volume = 0.65;
  private lastAlarmTime = 0;

  public setConfig(enabled: boolean, volume: number): void {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.enabled ? this.volume : 0,
        this.ctx.currentTime,
        0.02
      );
    }
  }

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.enabled ? this.volume : 0;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  private getReady(): { ctx: AudioContext; out: GainNode } | null {
    if (!this.enabled) return null;
    if (!this.ctx || !this.masterGain) {
      this.unlock();
    }
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') return null;
    return { ctx: this.ctx, out: this.masterGain };
  }

  public playLaser(triple = false): void {
    const r = this.getReady();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = triple ? 'sawtooth' : 'triangle';
    const startFreq = triple ? 1020 : 880;
    osc.frequency.setValueAtTime(startFreq + (Math.random() - 0.5) * 60, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.11);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playEnemyShot(): void {
    const r = this.getReady();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(130, now + 0.13);

    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playMissile(): void {
    const r = this.getReady();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    // Noise burst whoosh + pitch sweep
    const bufferSize = Math.floor(ctx.sampleRate * 0.32);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(2400, now + 0.28);
    filter.Q.value = 1.6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    noise.start(now);
  }

  public playHit(shielded: boolean): void {
    const r = this.getReady();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = shielded ? 'sine' : 'square';
    osc.frequency.setValueAtTime(shielded ? 560 : 180, now);
    osc.frequency.exponentialRampToValueAtTime(shielded ? 240 : 55, now + 0.15);

    gain.gain.setValueAtTime(shielded ? 0.2 : 0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playExplosion(large = false): void {
    const r = this.getReady();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    const dur = large ? 0.75 : 0.38;

    // Low boom oscillator
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(large ? 115 : 150, now);
    osc.frequency.exponentialRampToValueAtTime(26, now + dur);
    oscGain.gain.setValueAtTime(large ? 0.42 : 0.26, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(oscGain);
    oscGain.connect(out);
    osc.start(now);
    osc.stop(now + dur + 0.02);

    // Filtered noise crackle
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 1.5);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(large ? 1100 : 1600, now);
    filter.frequency.exponentialRampToValueAtTime(160, now + dur);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(large ? 0.35 : 0.22, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(out);
    noise.start(now);
  }

  public playPickup(rare = false): void {
    const r = this.getReady();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    const notes = rare ? [587.33, 880, 1174.66] : [659.25, 987.77];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + idx * 0.055;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  }

  public playUiClick(confirm = false): void {
    const r = this.getReady();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(confirm ? 720 : 520, now);
    if (confirm) {
      osc.frequency.setValueAtTime(980, now + 0.05);
    }
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (confirm ? 0.14 : 0.06));
    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playAlarmPulse(): void {
    const r = this.getReady();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    if (now - this.lastAlarmTime < 0.85) return;
    this.lastAlarmTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.linearRampToValueAtTime(440, now + 0.32);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.38);
  }

  public playFanfare(): void {
    const r = this.getReady();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    const chord = [440, 554.37, 659.25, 880];
    chord.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.08;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.48);
    });
  }
}
