import * as THREE from 'three';

export interface Rock {
  mesh: THREE.Mesh;
  radius: number;
  spin: THREE.Vector3;
}

/** Radius of the asteroid field where the space fights happen, centred on the origin. */
export const ARENA_RADIUS = 420;

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function randomOnSphere(out: THREE.Vector3, r: number) {
  const u = Math.random() * 2 - 1;
  const th = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(th), u, s * Math.sin(th)).multiplyScalar(r);
}

function glowTexture(inner: string, outer: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, outer);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Bake a procedural nebula + galaxy band into an equirectangular texture once at startup,
 * so the per-frame cost is a single textured sphere (cheap on phones).
 */
function bakeNebula(renderer: THREE.WebGLRenderer, sunDir: THREE.Vector3, w: number) {
  const h = w / 2;
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir.clone() } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform vec3 uSun;
      vec3 hash3(vec3 p){ p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yxz + 19.19); return fract((p.xxy + p.yxx) * p.zyx); }
      float noise(vec3 p){
        vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        float n = mix(mix(mix(hash3(i).x, hash3(i+vec3(1,0,0)).x, f.x), mix(hash3(i+vec3(0,1,0)).x, hash3(i+vec3(1,1,0)).x, f.x), f.y),
                      mix(mix(hash3(i+vec3(0,0,1)).x, hash3(i+vec3(1,0,1)).x, f.x), mix(hash3(i+vec3(0,1,1)).x, hash3(i+vec3(1,1,1)).x, f.x), f.y), f.z);
        return n;
      }
      float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++){ s += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
      void main(){
        float lon = (vUv.x - 0.5) * 6.2831853;
        float lat = (vUv.y - 0.5) * 3.1415926;
        vec3 d = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
        // Galactic band along a tilted great circle.
        vec3 bandN = normalize(vec3(0.25, 1.0, -0.35));
        float band = exp(-pow(dot(d, bandN) * 3.2, 2.0));
        float warp = fbm(d * 2.0);
        float n1 = fbm(d * 3.0 + warp * 1.5);
        float n2 = fbm(d * 6.0 - warp);
        // Two coloured gas clouds, with dark dust lanes cutting through the band.
        vec3 col = vec3(0.0);
        float cloudA = smoothstep(0.45, 0.85, n1) * (0.35 + band);
        float cloudB = smoothstep(0.5, 0.9, fbm(d * 2.5 + 11.0)) * 0.8;
        col += vec3(0.20, 0.07, 0.30) * cloudA;
        col += vec3(0.04, 0.16, 0.26) * cloudB;
        col += vec3(0.30, 0.26, 0.22) * band * (0.25 + 0.75 * n2) * 0.55;
        float dust = smoothstep(0.5, 0.7, fbm(d * 9.0 + 3.0)) * band;
        col *= 1.0 - dust * 0.85;
        // Faint dense starfield baked in (the bright stars are separate points that twinkle).
        vec3 cell = floor(d * 380.0);
        vec3 hs = hash3(cell);
        float star = step(0.985, hs.x) * hs.y * (0.4 + band);
        col += vec3(0.8, 0.85, 1.0) * star * 0.6;
        // Warm scatter around the sun direction.
        float sd = max(dot(d, uSun), 0.0);
        col += vec3(0.35, 0.22, 0.10) * pow(sd, 12.0) * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const sc = new THREE.Scene();
  sc.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(sc, cam);
  renderer.setRenderTarget(prev);
  mat.dispose();
  quad.geometry.dispose();
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  return rt.texture;
}

/** Sun disc with a steep falloff, so the HDR multiplier doesn't turn the sprite's square visible. */
function sunTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const r = Math.hypot(x - 127.5, y - 127.5) / 128;
      const disc = r < 0.08 ? 1 : 0;
      const glow = Math.exp(-r * 9) * 0.6 + Math.exp(-r * 22) * 0.4;
      const a = Math.min(1, disc + glow) * Math.max(0, 1 - r);
      const i = (y * 256 + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 240 - (1 - a) * 40;
      img.data[i + 2] = 220 - (1 - a) * 90;
      img.data[i + 3] = Math.round(a * 255);
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Background objects that stay at "infinite" distance by following the camera. */
export class Sky {
  readonly group = new THREE.Group();
  private starMat: THREE.ShaderMaterial;
  private nebulaMat: THREE.MeshBasicMaterial;
  private sun: THREE.Sprite;
  private halo: THREE.Sprite;
  /** The baked nebula (equirectangular, linear HDR), reusable as a reflection source. */
  readonly nebula: THREE.Texture;

  constructor(scene: THREE.Scene, sunDir: THREE.Vector3, renderer: THREE.WebGLRenderer, lowSpec = false) {
    // Nebula sphere (baked once).
    this.nebula = bakeNebula(renderer, sunDir, lowSpec ? 1024 : 2048);
    this.nebula.mapping = THREE.EquirectangularReflectionMapping;
    this.nebulaMat = new THREE.MeshBasicMaterial({
      map: this.nebula,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      transparent: true,
    });
    const neb = new THREE.Mesh(new THREE.SphereGeometry(24000, 48, 24), this.nebulaMat);
    // Equirect UVs on SphereGeometry start at -X; rotate so the baked longitudes line up with +Z.
    neb.rotation.y = -Math.PI / 2;
    neb.renderOrder = -3;
    neb.frustumCulled = false;
    this.group.add(neb);

    // Bright stars: sized by magnitude, HDR so the brightest bloom, with a slow twinkle.
    const n = 3000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      randomOnSphere(v, 20000).toArray(pos, i * 3);
      const mag = Math.pow(Math.random(), 6); // mostly faint, a few bright
      const hue = Math.random() < 0.25 ? rand(0.04, 0.12) : rand(0.55, 0.66);
      c.setHSL(hue, rand(0.2, 0.7), 0.75).multiplyScalar(0.5 + mag * 5).toArray(col, i * 3);
      size[i] = 1.2 + mag * 3.5;
      phase[i] = Math.random() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uPx: { value: window.devicePixelRatio || 1 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float phase; attribute vec3 color;
        uniform float uTime, uPx;
        varying vec3 vCol;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float tw = 0.75 + 0.25 * sin(uTime * (1.5 + fract(phase) * 3.0) + phase);
          vCol = color * tw;
          gl_PointSize = size * uPx;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vCol;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main(){
          #include <logdepthbuf_fragment>
          vec2 p = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(p));
          gl_FragColor = vec4(vCol * a * uOpacity, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      fog: false,
    });
    const stars = new THREE.Points(g, this.starMat);
    stars.frustumCulled = false;
    stars.renderOrder = -2;
    this.group.add(stars);

    // Sun: bright HDR core (blooms) plus a wide soft halo.
    const core = sunTexture();
    const sun = (this.sun = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: core, color: new THREE.Color(6, 5.2, 4.2), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    ));
    sun.position.copy(sunDir).multiplyScalar(18000);
    sun.scale.setScalar(1600);
    const halo = (this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture('rgba(255,230,190,0.6)', 'rgba(255,160,90,0.18)'),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    ));
    halo.position.copy(sun.position);
    halo.scale.setScalar(9000);
    this.group.add(halo, sun);

    this.group.renderOrder = -1;
    scene.add(this.group);
  }

  /** Fade stars out in daylight and everything out underground. */
  setDaylight(atmo: number, under: number) {
    const night = Math.max(0, 1 - atmo * 1.6) * (1 - under);
    this.starMat.uniforms.uOpacity.value = night;
    this.nebulaMat.opacity = Math.max(0, 1 - atmo * 2.2) * (1 - under);
    this.nebulaMat.visible = this.nebulaMat.opacity > 0.01;
    this.sun.material.opacity = 1 - under;
    this.halo.material.opacity = (1 - under) * (1 - atmo * 0.5);
  }

  setPixelRatio(pr: number) {
    this.starMat.uniforms.uPx.value = pr;
  }

  follow(cam: THREE.Camera, time = 0) {
    this.group.position.copy(cam.position);
    this.starMat.uniforms.uTime.value = time;
  }
}

/** Space dust around the player, so speed is visible even with nothing nearby. */
export class Dust {
  private points: THREE.Points;
  private base: Float32Array;
  private readonly size = 80;

  constructor(scene: THREE.Scene) {
    const n = 450;
    this.base = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) this.base[i] = Math.random() * this.size;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0x8fa6c8, size: 0.18, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(center: THREE.Vector3) {
    const arr = (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const s = this.size;
    const h = s / 2;
    for (let i = 0; i < arr.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const c = k === 0 ? center.x : k === 1 ? center.y : center.z;
        // Wrap each mote into a cube centred on the player.
        const local = ((((this.base[i + k] - c) % s) + s) % s) - h;
        arr[i + k] = c + local;
      }
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
  }
}

export function makeRocks(scene: THREE.Scene, count: number): Rock[] {
  const rocks: Rock[] = [];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.08, flatShading: true });
  const tints = [new THREE.Color(0x77706a), new THREE.Color(0x5d5650), new THREE.Color(0x8a7a68), new THREE.Color(0x4a4e55)];
  const ore = new THREE.Color(0x3fb8c8);
  const tmp = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const radius = Math.random() < 0.15 ? rand(14, 26) : rand(3, 10);
    const geo = new THREE.IcosahedronGeometry(1, radius > 12 ? 2 : 1);
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    // Displace vertices consistently (shared positions get the same offset).
    const seen = new Map<string, number>();
    for (let j = 0; j < p.count; j++) {
      v.fromBufferAttribute(p, j);
      const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
      let d = seen.get(key);
      if (d === undefined) {
        d = rand(0.75, 1.15);
        seen.set(key, d);
      }
      v.multiplyScalar(d);
      p.setXYZ(j, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    // Per-rock tint with per-vertex mottling; some rocks carry glowing ore veins.
    const base = tints[i % tints.length];
    const veined = Math.random() < 0.18;
    const colors = new Float32Array(p.count * 3);
    for (let j = 0; j < p.count; j += 3) {
      const shade = rand(0.75, 1.15);
      tmp.copy(base).multiplyScalar(shade);
      if (veined && Math.random() < 0.12) tmp.copy(ore).multiplyScalar(2.2);
      for (let k = 0; k < 3; k++) tmp.toArray(colors, (j + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(radius * rand(0.85, 1.15), radius * rand(0.7, 1), radius * rand(0.85, 1.15));
    // Keep the spawn point clear.
    do randomOnSphere(v, rand(40, ARENA_RADIUS)); while (v.length() < 45);
    mesh.position.copy(v);
    mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    scene.add(mesh);
    rocks.push({
      mesh,
      radius: radius * 0.9,
      spin: new THREE.Vector3(rand(-0.15, 0.15), rand(-0.15, 0.15), rand(-0.15, 0.15)),
    });
  }
  return rocks;
}

export { rand, randomOnSphere };
