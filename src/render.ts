import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Rendering pipeline: HDR scene -> bloom -> grade/vignette/chromatic fringe -> tone map.
// Quality adapts to the measured frame time, so slow phones drop bloom and resolution
// instead of stuttering, and fast machines climb back up.

export interface Tier {
  name: string;
  pixelRatio: number;
  bloom: boolean;
  bloomScale: number;
  msaa: number;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uHurt: { value: 0 },
    uBoost: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uHurt, uBoost, uAspect;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c * vec2(uAspect, 1.0));
      // Chromatic fringe toward the edges, stronger when boosting or hit.
      float ca = (0.0012 + uBoost * 0.003 + uHurt * 0.006) * r;
      vec2 dir = normalize(c + 1e-5);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dir * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - dir * ca).b;
      // Vignette.
      col *= mix(1.0, smoothstep(1.15, 0.35, r), 0.55);
      // Damage tint.
      col = mix(col, col * vec3(1.6, 0.45, 0.35), uHurt * 0.5 * smoothstep(0.2, 0.9, r));
      // Fine film grain (helps hide banding in the dark mine and nebula gradients).
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.012;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private tiers: Tier[];
  private tierIndex: number;
  private maxTier: number;
  private frameTimes: number[] = [];
  private sampleTimer = 0;
  private goodStreak = 0;
  private locked = false;
  private w = 1;
  private h = 1;
  onTierChange?: (t: Tier) => void;

  constructor(
    canvas: HTMLCanvasElement,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    isTouch: boolean,
  ) {
    const dpr = window.devicePixelRatio || 1;
    this.tiers = [
      { name: 'LOW', pixelRatio: Math.min(dpr, 1), bloom: false, bloomScale: 0.25, msaa: 0 },
      { name: 'MEDIUM', pixelRatio: Math.min(dpr, 1.25), bloom: true, bloomScale: 0.25, msaa: 0 },
      { name: 'HIGH', pixelRatio: Math.min(dpr, isTouch ? 1.75 : 1.5), bloom: true, bloomScale: 0.5, msaa: isTouch ? 0 : 4 },
      { name: 'ULTRA', pixelRatio: Math.min(dpr, 2), bloom: true, bloomScale: 0.5, msaa: 4 },
    ];
    this.maxTier = this.tiers.length - 1;
    // ?q=0..3 in the URL locks a tier (handy for testing on a phone); otherwise start from the
    // last manual choice or a device default, and adapt from there.
    const forced = new URLSearchParams(location.search).get('q');
    const saved = forced ?? safeGet('bs-quality');
    const n = saved === null ? NaN : Number(saved);
    this.tierIndex = Number.isInteger(n) && n >= 0 && n < this.tiers.length ? n : isTouch ? 1 : 2;
    if (forced !== null) this.locked = true;

    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.tier.msaa });
    this.composer = new EffectComposer(this.gl, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    // Threshold is in linear HDR units; lit terrain stays under it, emissive bolts/engines/sun go over.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 1.0);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.applyTier();
  }

  get tier() {
    return this.tiers[this.tierIndex];
  }

  /** Cycle quality manually (and stop auto-raising past it). */
  cycleQuality() {
    this.tierIndex = (this.tierIndex + 1) % this.tiers.length;
    this.maxTier = this.tierIndex;
    safeSet('bs-quality', String(this.tierIndex));
    this.applyTier();
    return this.tier;
  }

  setSize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.gl.setSize(w, h, false);
    this.applyTier(false);
  }

  private applyTier(notify = true) {
    const t = this.tier;
    this.gl.setPixelRatio(t.pixelRatio);
    this.composer.setPixelRatio(t.pixelRatio);
    this.composer.setSize(this.w, this.h);
    this.composer.renderTarget1.samples = t.msaa;
    this.composer.renderTarget2.samples = t.msaa;
    this.bloom.enabled = t.bloom;
    const bw = Math.max(1, Math.round(this.w * t.pixelRatio * t.bloomScale));
    const bh = Math.max(1, Math.round(this.h * t.pixelRatio * t.bloomScale));
    // UnrealBloomPass halves internally, so give it twice the target size.
    this.bloom.setSize(bw * 2, bh * 2);
    this.grade.uniforms.uAspect.value = this.w / Math.max(1, this.h);
    if (notify) this.onTierChange?.(t);
  }

  setEffects(time: number, hurt: number, boost: number) {
    const u = this.grade.uniforms;
    u.uTime.value = time % 100;
    u.uHurt.value = hurt;
    u.uBoost.value = boost;
  }

  /** Bloom strength per zone: punchy in space, softer in daylight so the sky doesn't wash out. */
  setBloom(strength: number) {
    this.bloom.strength = strength;
  }

  render(dt: number) {
    this.composer.render(dt);
    this.adapt(dt);
  }

  private adapt(dt: number) {
    if (dt <= 0 || this.locked) return;
    this.frameTimes.push(dt);
    this.sampleTimer += dt;
    if (this.sampleTimer < 2) return;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    // 75th percentile frame time, robust to the odd hitch.
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    this.frameTimes.length = 0;
    this.sampleTimer = 0;
    if (p75 > 1 / 42 && this.tierIndex > 0) {
      this.tierIndex--;
      this.goodStreak = 0;
      this.applyTier();
    } else if (p75 < 1 / 58 && this.tierIndex < this.maxTier) {
      // Only climb after a sustained run of headroom (vsync caps at 60, so this means "solid 60").
      if (++this.goodStreak >= 4) {
        this.tierIndex++;
        this.goodStreak = 0;
        this.applyTier();
      }
    } else this.goodStreak = 0;
  }
}

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
