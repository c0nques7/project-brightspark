import * as THREE from 'three';

// Procedural sound design on Web Audio. No audio files.
//
// Graph:  one-shots ─┬─> dry ───────────────┐
//                    └─> send -> reverb ────┤
//         engine, ambience ────────────────>├─> master -> compressor -> out
//
// The reverb tail grows in the mine and nearly vanishes in open space, positional one-shots are
// panned and attenuated relative to the camera, and the engine/ambience layers follow the ship's
// state every frame.

export interface AudioState {
  playing: boolean;
  /** Forward thrust input, -1..1. */
  thrust: number;
  /** Any translation input magnitude, 0..1. */
  move: number;
  speed: number;
  boosting: boolean;
  cruising: boolean;
  /** 0 in space .. 1 at ground level. */
  atmo: number;
  /** 0 above ground .. 1 deep in the mine. */
  under: number;
  /** 0..1 */
  hull: number;
}

const _v = new THREE.Vector3();

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private send: GainNode | null = null;
  private reverbOut: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private listener: THREE.Camera | null = null;

  // Continuous layers
  private engine?: { o1: OscillatorNode; o2: OscillatorNode; sub: OscillatorNode; filt: BiquadFilterNode; gain: GainNode; hiss: BiquadFilterNode; hissGain: GainNode };
  private cruiseLayer?: { o: OscillatorNode; gain: GainNode; filt: BiquadFilterNode };
  private wind?: { filt: BiquadFilterNode; gain: GainNode };
  private drone?: { gain: GainNode; filt: BiquadFilterNode };
  private rumble?: { gain: GainNode };
  private alarmTimer = 0;
  private creakTimer = 4;
  private volume = 0.5;

  /** Must be called from a user gesture (click / tap). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const c = (this.ctx = new AC());
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      comp.connect(c.destination);
      this.master = c.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(comp);

      this.dry = c.createGain();
      this.dry.connect(this.master);
      this.send = c.createGain();
      this.send.gain.value = 0.1;
      const verb = c.createConvolver();
      verb.buffer = this.impulse(2.8, 2.6);
      this.reverbOut = c.createGain();
      this.reverbOut.gain.value = 1;
      this.send.connect(verb).connect(this.reverbOut).connect(this.master);

      const len = c.sampleRate * 2;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      this.buildLayers();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Master volume 0..1 (0.5 is the original mix level at 0.7). */
  setVolume(v: number) {
    this.volume = Math.max(0, v) * 0.72;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  setListener(cam: THREE.Camera) {
    this.listener = cam;
  }

  /** Pause/resume all audio (e.g. on the pause screen). */
  setSuspended(s: boolean) {
    if (!this.ctx) return;
    if (s && this.ctx.state === 'running') void this.ctx.suspend();
    if (!s && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // ---------- Building blocks ----------
  private impulse(seconds: number, decay: number) {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Sparse early reflections then a dense decaying tail.
        const early = i < c.sampleRate * 0.08 && Math.random() < 0.02 ? 1 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + early * (1 - t)) * 0.6;
      }
    }
    return buf;
  }

  private noiseSource(loop = false) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  /** Output chain for a one-shot: optional pan + distance gain, into dry and reverb send. */
  private out(pos?: THREE.Vector3, maxDist = 600): AudioNode | null {
    const c = this.ctx;
    if (!c || !this.dry || !this.send) return null;
    const g = c.createGain();
    let gain = 1;
    let pan = 0;
    if (pos && this.listener) {
      _v.copy(pos).applyMatrix4(this.listener.matrixWorldInverse);
      const dist = _v.length();
      if (dist > maxDist) return null;
      gain = 1 / (1 + dist / 40);
      pan = THREE.MathUtils.clamp(_v.x / (Math.abs(_v.z) + Math.abs(_v.x) + 1), -0.9, 0.9);
    }
    g.gain.value = gain;
    let head: AudioNode = g;
    if (pan !== 0 && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      p.connect(g);
      head = p;
    }
    g.connect(this.dry);
    g.connect(this.send);
    return head;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, dest: AudioNode | null, delay = 0, attack = 0.002) {
    const c = this.ctx;
    if (!c || !dest) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, vol: number, f0: number, f1: number, dest: AudioNode | null, type: BiquadFilterType = 'lowpass', q = 0.7, delay = 0) {
    const c = this.ctx;
    if (!c || !dest || !this.noise) return;
    const t = c.currentTime + delay;
    const s = this.noiseSource();
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  private buildLayers() {
    const c = this.ctx!;
    const m = this.master!;

    // Engine: two detuned saws + sub through a lowpass, and a filtered hiss for thrust.
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 300;
    filt.Q.value = 2;
    const gain = c.createGain();
    gain.gain.value = 0;
    const o1 = c.createOscillator();
    const o2 = c.createOscillator();
    const sub = c.createOscillator();
    o1.type = o2.type = 'sawtooth';
    sub.type = 'sine';
    o1.frequency.value = 55;
    o2.frequency.value = 55.7;
    sub.frequency.value = 27.5;
    const subGain = c.createGain();
    subGain.gain.value = 0.9;
    o1.connect(filt);
    o2.connect(filt);
    sub.connect(subGain).connect(filt);
    filt.connect(gain).connect(m);
    const hiss = c.createBiquadFilter();
    hiss.type = 'bandpass';
    hiss.frequency.value = 900;
    hiss.Q.value = 0.8;
    const hissGain = c.createGain();
    hissGain.gain.value = 0;
    const hn = this.noiseSource(true);
    hn.connect(hiss).connect(hissGain).connect(m);
    o1.start();
    o2.start();
    sub.start();
    hn.start();
    this.engine = { o1, o2, sub, filt, gain, hiss, hissGain };

    // Cruise: a rising tonal whine.
    const co = c.createOscillator();
    co.type = 'triangle';
    co.frequency.value = 220;
    const cf = c.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 1200;
    cf.Q.value = 4;
    const cg = c.createGain();
    cg.gain.value = 0;
    co.connect(cf).connect(cg).connect(m);
    co.start();
    this.cruiseLayer = { o: co, gain: cg, filt: cf };

    // Wind in the atmosphere: noise through a swept bandpass.
    const wn = this.noiseSource(true);
    const wf = c.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 500;
    wf.Q.value = 0.6;
    const wg = c.createGain();
    wg.gain.value = 0;
    wn.connect(wf).connect(wg).connect(m);
    wn.start();
    this.wind = { filt: wf, gain: wg };

    // Space drone: a slow, detuned minor pad with a breathing filter.
    const dg = c.createGain();
    dg.gain.value = 0;
    const df = c.createBiquadFilter();
    df.type = 'lowpass';
    df.frequency.value = 600;
    df.connect(dg).connect(m);
    dg.connect(this.send!);
    for (const [f, v] of [[55, 0.5], [82.4, 0.35], [130.8, 0.2], [164.8, 0.12], [110.3, 0.25]] as const) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = c.createGain();
      og.gain.value = v;
      // Each partial drifts in level on its own slow LFO.
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.03 + Math.random() * 0.08;
      const lg = c.createGain();
      lg.gain.value = v * 0.6;
      lfo.connect(lg).connect(og.gain);
      o.connect(og).connect(df);
      o.start();
      lfo.start();
    }
    const flfo = c.createOscillator();
    flfo.frequency.value = 0.05;
    const flg = c.createGain();
    flg.gain.value = 250;
    flfo.connect(flg).connect(df.frequency);
    flfo.start();
    this.drone = { gain: dg, filt: df };

    // Mine rumble: deep filtered noise.
    const rn = this.noiseSource(true);
    const rf = c.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 110;
    const rg = c.createGain();
    rg.gain.value = 0;
    rn.connect(rf).connect(rg).connect(m);
    rn.start();
    this.rumble = { gain: rg };
  }

  /** Drive the continuous layers. Call every frame. */
  update(dt: number, s: AudioState) {
    const c = this.ctx;
    if (!c || !this.engine || c.state !== 'running') return;
    const t = c.currentTime;
    const k = 0.08; // smoothing time constant
    const on = s.playing ? 1 : 0;
    const e = this.engine;
    const spd = Math.min(1, s.speed / 120);
    const push = Math.max(0, s.move) + (s.boosting ? 0.8 : 0);
    // Thin air carries sound; vacuum is "felt" through the hull, so keep it lower and duller.
    const air = Math.max(s.atmo, s.under);
    const pitch = 1 + spd * 0.6 + (s.boosting ? 0.35 : 0) + (s.cruising ? 0.5 : 0);
    e.o1.frequency.setTargetAtTime(55 * pitch, t, 0.15);
    e.o2.frequency.setTargetAtTime(55.7 * pitch * (s.boosting ? 1.01 : 1), t, 0.15);
    e.sub.frequency.setTargetAtTime(27.5 * pitch, t, 0.15);
    e.filt.frequency.setTargetAtTime(180 + push * 500 + spd * 300 + air * 300, t, k);
    e.gain.gain.setTargetAtTime(on * (0.05 + push * 0.07 + spd * 0.04), t, k);
    e.hiss.frequency.setTargetAtTime(600 + push * 1200 + (s.boosting ? 1500 : 0), t, k);
    e.hissGain.gain.setTargetAtTime(on * (push * 0.035 + (s.boosting ? 0.05 : 0)), t, k);

    const cl = this.cruiseLayer!;
    const cr = s.cruising ? Math.min(1, s.speed / 480) : 0;
    cl.o.frequency.setTargetAtTime(160 + cr * 260, t, 0.4);
    cl.filt.frequency.setTargetAtTime(700 + cr * 1500, t, 0.4);
    cl.gain.gain.setTargetAtTime(on * cr * 0.05, t, 0.3);

    const w = this.wind!;
    const windAmt = s.atmo * (1 - s.under) * Math.min(1, s.speed / 200);
    w.filt.frequency.setTargetAtTime(300 + windAmt * 1800, t, 0.3);
    w.gain.gain.setTargetAtTime(on * (windAmt * 0.22 + s.atmo * (1 - s.under) * 0.02), t, 0.3);

    this.drone!.gain.gain.setTargetAtTime(0.07 * (1 - s.atmo * 0.8) * (1 - s.under * 0.6), t, 1.2);
    this.rumble!.gain.gain.setTargetAtTime(on * s.under * 0.3, t, 0.8);

    // Reverb: big and wet in the tunnels, a hint in the open.
    this.send!.gain.setTargetAtTime(0.06 + s.under * 0.5 + s.atmo * 0.05, t, 0.5);

    // Low hull alarm.
    if (s.playing && s.hull < 0.3 && s.hull > 0) {
      this.alarmTimer -= dt;
      if (this.alarmTimer <= 0) {
        this.alarmTimer = 0.9;
        const d = this.dry;
        this.tone('square', 880, 880, 0.12, 0.05, d);
        this.tone('square', 660, 660, 0.12, 0.05, d, 0.15);
      }
    } else this.alarmTimer = 0;

    // Occasional metal creaks and drips in the mine.
    if (s.playing && s.under > 0.5) {
      this.creakTimer -= dt;
      if (this.creakTimer <= 0) {
        this.creakTimer = 3 + Math.random() * 6;
        const dest = this.send!;
        if (Math.random() < 0.5) {
          const f = 80 + Math.random() * 60;
          this.tone('sawtooth', f, f * 0.7, 1.2, 0.03, dest, 0, 0.3);
        } else {
          const f = 1800 + Math.random() * 1600;
          this.tone('sine', f, f * 0.5, 0.08, 0.06, dest);
        }
      }
    }
  }

  // ---------- One-shots (names kept stable for the rest of the game) ----------

  /** Player cannon. side: -1 left gun, 1 right gun. */
  laser(side = 0) {
    const c = this.ctx;
    if (!c || !this.dry) return;
    let dest: AudioNode = this.out()!;
    if (side && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = side * 0.35;
      p.connect(dest);
      dest = p;
    }
    const det = 1 + (Math.random() - 0.5) * 0.06;
    this.tone('square', 1700 * det, 260, 0.11, 0.05, dest);
    this.tone('sawtooth', 900 * det, 120, 0.09, 0.035, dest);
    this.tone('sine', 140, 45, 0.08, 0.12, dest);
    this.burst(0.04, 0.12, 6000, 1500, dest, 'highpass');
  }

  enemyShot(pos?: THREE.Vector3) {
    const d = this.out(pos, 400);
    this.tone('sawtooth', 620, 150, 0.22, 0.06, d);
    this.tone('square', 310, 90, 0.18, 0.03, d);
  }

  /** Our bolt hitting an enemy. */
  hit(pos?: THREE.Vector3) {
    const d = this.out(pos);
    this.tone('triangle', 1300, 2400, 0.05, 0.08, d);
    this.tone('sine', 3100, 2800, 0.12, 0.03, d);
    this.burst(0.05, 0.1, 5000, 2000, d, 'bandpass', 2);
  }

  /** Bolt hitting rock or a wall. */
  impact(pos?: THREE.Vector3) {
    const d = this.out(pos, 300);
    this.burst(0.08, 0.15, 3000, 400, d, 'bandpass', 1.5);
  }

  /** We took damage. shieldOnly: the shield absorbed it all. */
  hurt(shieldOnly = false) {
    const d = this.out();
    if (shieldOnly) {
      // Electric fizz.
      this.burst(0.25, 0.25, 4000, 900, d, 'bandpass', 3);
      this.tone('sine', 520, 380, 0.25, 0.08, d);
    } else {
      // Metal impact on the hull.
      this.burst(0.35, 0.55, 1600, 80, d);
      this.tone('sawtooth', 150, 50, 0.3, 0.15, d);
      this.tone('square', 2200, 1800, 0.08, 0.03, d);
    }
  }

  explode(big = false, pos?: THREE.Vector3) {
    const d = this.out(pos, 2000);
    const s = big ? 1.6 : 1;
    this.burst(0.9 * s, 0.75, big ? 2200 : 3500, 50, d);
    this.burst(0.35 * s, 0.3, 8000, 1200, d, 'highpass', 0.7);
    this.tone('sine', 110, 25, 0.9 * s, 0.45, d);
    // Crackling debris tail.
    for (let i = 0; i < (big ? 8 : 4); i++) this.burst(0.06, 0.12, 2500 + Math.random() * 3000, 800, d, 'bandpass', 2, 0.15 + Math.random() * 0.6 * s);
  }

  // ---------- Enemy cues ----------
  /** A shot glancing off armour. */
  deflect(pos?: THREE.Vector3) {
    const d = this.out(pos);
    this.tone('square', 2200, 900, 0.09, 0.04, d);
    this.tone('sine', 4200, 3600, 0.15, 0.025, d);
  }
  /** Lantern spotted the player: two-tone siren. */
  alarm(pos?: THREE.Vector3) {
    const d = this.out(pos, 900);
    for (let i = 0; i < 3; i++) {
      this.tone('sawtooth', 880, 880, 0.16, 0.05, d, i * 0.34, 0.01);
      this.tone('sawtooth', 660, 660, 0.16, 0.05, d, i * 0.34 + 0.17, 0.01);
    }
  }
  /** Ember lock-on beep; pitch rises with urgency 0..1. */
  lockOn(pos: THREE.Vector3 | undefined, urgency: number) {
    const f = 900 + urgency * 900;
    this.tone('square', f, f, 0.06, 0.035, this.out(pos));
  }
  /** Shade phasing in or out. */
  cloak(pos: THREE.Vector3 | undefined, on: boolean) {
    const d = this.out(pos);
    if (on) this.tone('sine', 900, 140, 0.5, 0.05, d, 0, 0.05);
    else this.tone('sine', 160, 1100, 0.45, 0.05, d, 0, 0.05);
    this.burst(0.4, 0.05, on ? 4000 : 600, on ? 500 : 5000, d, 'bandpass', 3);
  }
  /** Shade rail lance charging up. */
  charge(pos?: THREE.Vector3) {
    this.tone('sawtooth', 200, 1800, 0.55, 0.04, this.out(pos), 0, 0.3);
  }
  /** Tick bite / drill grind. */
  bite(pos?: THREE.Vector3) {
    const d = this.out(pos);
    this.burst(0.12, 0.12, 3000, 800, d, 'bandpass', 4);
    this.tone('square', 140, 90, 0.1, 0.05, d);
  }
  /** Big low roar for the boss waking or changing phase. */
  roar(pos?: THREE.Vector3) {
    const d = this.out(pos, 2000);
    this.tone('sawtooth', 70, 38, 1.6, 0.12, d, 0, 0.15);
    this.tone('square', 105, 52, 1.4, 0.05, d, 0.05, 0.2);
    this.burst(1.5, 0.12, 400, 60, d);
  }

  chime() {
    const d = this.out();
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone('sine', f, f, 0.35, 0.07, d, i * 0.08, 0.01));
  }

  /** Cruise engage / disengage. */
  cruise(on: boolean) {
    const d = this.out();
    if (on) {
      this.tone('sine', 200, 900, 0.8, 0.08, d, 0, 0.3);
      this.burst(0.9, 0.15, 400, 4000, d, 'bandpass', 1.2);
    } else {
      this.tone('sine', 700, 150, 0.5, 0.08, d);
      this.burst(0.5, 0.12, 3000, 300, d, 'bandpass', 1.2);
    }
  }

  /** Short UI blip. */
  blip(high = true) {
    this.tone('sine', high ? 1400 : 900, high ? 1400 : 900, 0.06, 0.05, this.out());
  }
}
