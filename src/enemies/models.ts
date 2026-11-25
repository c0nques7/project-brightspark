import * as THREE from 'three';

// Low-poly models for every enemy type. Geometry and most materials are shared across instances;
// each enemy gets its own body material so it can flash when hit. HDR colours (>1) on MeshBasic
// materials glow under the bloom pass. Each model stays at a handful of meshes for mobile GPUs.

export interface Model {
  root: THREE.Group;
  /** Per-instance material that flashes on hit. */
  body: THREE.MeshStandardMaterial;
  /** Named sub-parts the AI animates. */
  parts: Record<string, THREE.Object3D>;
}

const hdr = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const glow = (c: THREE.Color, extra: THREE.MeshBasicMaterialParameters = {}) =>
  new THREE.MeshBasicMaterial({ color: c, ...extra });
const additive = (c: THREE.Color, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity });
const metal = (color: number, metalness = 0.6, roughness = 0.45) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, flatShading: true });

function mesh(g: THREE.BufferGeometry, m: THREE.Material, parent?: THREE.Object3D) {
  const o = new THREE.Mesh(g, m);
  parent?.add(o);
  return o;
}

// ---------- Warden: the baseline ringed fighter (already in the game) ----------
const W = {
  body: new THREE.IcosahedronGeometry(1.6, 0),
  ring: new THREE.TorusGeometry(2.1, 0.22, 6, 16),
  eye: new THREE.SphereGeometry(0.55, 12, 8),
  wing: new THREE.BoxGeometry(3.6, 0.15, 1.1),
  thrust: new THREE.IcosahedronGeometry(1, 0),
  ringMat: metal(0x3b3f48, 0.7, 0.4),
  eyeMat: glow(hdr(5, 0.9, 0.5)),
  wingMat: metal(0x272a31),
  thrustMat: additive(hdr(3.5, 1.2, 0.5)),
};
export function wardenModel(): Model {
  const root = new THREE.Group();
  const body = metal(0xa3a9b5, 0.4, 0.45);
  mesh(W.body, body, root);
  const ring = mesh(W.ring, W.ringMat, root);
  mesh(W.eye, W.eyeMat, root).position.z = 1.3;
  mesh(W.wing, W.wingMat, root);
  const t = mesh(W.thrust, W.thrustMat, root);
  t.position.z = -1.5;
  t.scale.set(0.45, 0.45, 0.9);
  root.scale.setScalar(1.25);
  return { root, body, parts: { ring } };
}

// ---------- Gnat: tiny swarming dart ----------
const G = {
  hull: (() => {
    // A flat three-sided dart pointing down +z.
    const g = new THREE.ConeGeometry(0.75, 2.4, 3, 1);
    g.rotateX(Math.PI / 2);
    g.scale(1.3, 0.45, 1);
    return g;
  })(),
  fin: new THREE.BoxGeometry(2.6, 0.06, 0.5),
  tail: new THREE.OctahedronGeometry(0.32, 0),
  tailMat: additive(hdr(3.2, 2.4, 0.4)),
  finMat: metal(0x1d2026),
};
export function gnatModel(): Model {
  const root = new THREE.Group();
  const body = metal(0xc9a44a, 0.55, 0.35);
  mesh(G.hull, body, root);
  const fin = mesh(G.fin, G.finMat, root);
  fin.position.z = -0.45;
  const tail = mesh(G.tail, G.tailMat, root);
  tail.position.z = -1.25;
  tail.scale.set(1, 1, 2);
  return { root, body, parts: { tail } };
}

// ---------- Bulwark: armoured brute, shield plate in front, weak core behind ----------
const B = {
  hull: (() => {
    const g = new THREE.CylinderGeometry(2.6, 3.1, 5.5, 6, 1);
    g.rotateX(Math.PI / 2);
    return g;
  })(),
  plate: (() => {
    const g = new THREE.CylinderGeometry(4.2, 4.6, 0.8, 6, 1);
    g.rotateX(Math.PI / 2);
    return g;
  })(),
  stripe: new THREE.BoxGeometry(6.8, 0.35, 0.2),
  core: new THREE.IcosahedronGeometry(1.25, 1),
  cage: new THREE.TorusGeometry(1.6, 0.18, 4, 6),
  gun: new THREE.BoxGeometry(0.45, 0.45, 2.2),
  plateMat: metal(0x6b5a3a, 0.75, 0.35),
  stripeMat: glow(hdr(3.2, 1.9, 0.3)),
  coreMat: glow(hdr(4.5, 0.6, 2.4)),
  dark: metal(0x22252b, 0.7, 0.5),
};
export function bulwarkModel(): Model {
  const root = new THREE.Group();
  const body = metal(0x5d6470, 0.65, 0.4);
  mesh(B.hull, body, root);
  const plate = mesh(B.plate, B.plateMat, root);
  plate.position.z = 3.1;
  for (const y of [-1.2, 1.2]) {
    const s = mesh(B.stripe, B.stripeMat, root);
    s.position.set(0, y, 3.55);
  }
  const core = mesh(B.core, B.coreMat, root);
  core.position.z = -3.1;
  const cage = mesh(B.cage, B.dark, root);
  cage.position.z = -3.1;
  for (const x of [-3.4, 3.4]) {
    const gun = mesh(B.gun, B.dark, root);
    gun.position.set(x, -0.6, 1.6);
  }
  return { root, body, parts: { core, plate } };
}

// ---------- Shade: cloaking ambusher, blade-like, translucent when phased ----------
const S = {
  hull: (() => {
    const g = new THREE.OctahedronGeometry(1, 0);
    g.scale(0.9, 0.45, 2.6);
    return g;
  })(),
  blade: (() => {
    // Swept-back crescent blade made from a partial torus.
    const g = new THREE.TorusGeometry(2.6, 0.16, 3, 10, Math.PI * 0.75);
    g.rotateZ(Math.PI * 0.125 + Math.PI);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 1.2);
    return g;
  })(),
  slit: new THREE.BoxGeometry(1.1, 0.12, 0.12),
  edgeMat: glow(hdr(1.8, 0.6, 4.5)),
  slitMat: glow(hdr(4, 1.6, 5)),
};
export function shadeModel(): Model {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x4a3d66, metalness: 0.85, roughness: 0.25, flatShading: true, transparent: true });
  mesh(S.hull, body, root);
  const blade = mesh(S.blade, S.edgeMat, root);
  const slit = mesh(S.slit, S.slitMat, root);
  slit.position.set(0, 0.32, 1.4);
  root.scale.setScalar(1.2);
  return { root, body, parts: { blade, slit } };
}

// ---------- Ember: kamikaze pod, molten core inside a spiked cage ----------
const E = {
  cage: new THREE.IcosahedronGeometry(1.5, 0),
  core: new THREE.IcosahedronGeometry(0.95, 1),
  spike: (() => {
    const g = new THREE.ConeGeometry(0.22, 1.1, 4);
    g.translate(0, 1.9, 0);
    return g;
  })(),
  coreMat: glow(hdr(3, 0.9, 0.15)),
  spikeMat: metal(0x2b2420, 0.7, 0.5),
};
export function emberModel(): Model {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x3a2f2a, metalness: 0.6, roughness: 0.5, flatShading: true, wireframe: true });
  mesh(E.cage, body, root);
  const core = mesh(E.core, E.coreMat, root);
  const spikes = new THREE.Group();
  root.add(spikes);
  const dirs = [[0, 0, 0], [Math.PI / 2, 0, 0], [-Math.PI / 2, 0, 0], [Math.PI, 0, 0], [0, 0, Math.PI / 2], [0, 0, -Math.PI / 2]];
  for (const [x, y, z] of dirs) mesh(E.spike, E.spikeMat, spikes).rotation.set(x, y, z);
  return { root, body, parts: { core, spikes } };
}

// ---------- Tick: wall-clinging crawler for the mines ----------
const T = {
  body: (() => {
    const g = new THREE.IcosahedronGeometry(1.2, 0);
    g.scale(1.25, 0.6, 1.5);
    return g;
  })(),
  leg: (() => {
    // A bent leg: two thin boxes merged into one geometry by hand.
    const a = new THREE.BoxGeometry(1.6, 0.16, 0.16).translate(0.8, 0.35, 0).rotateZ(0.35);
    const b = new THREE.BoxGeometry(0.16, 1.4, 0.16).translate(1.65, -0.2, 0);
    const pos = [...a.attributes.position.array, ...b.attributes.position.array];
    const nor = [...a.attributes.normal.array, ...b.attributes.normal.array];
    const idx = [...a.index!.array, ...[...b.index!.array].map((i) => i + a.attributes.position.count)];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
  })(),
  eye: new THREE.SphereGeometry(0.22, 8, 6),
  mandible: new THREE.ConeGeometry(0.16, 0.9, 4),
  legMat: metal(0x2a221c, 0.5, 0.6),
  eyeMat: glow(hdr(0.8, 4.5, 0.9)),
};
export function tickModel(): Model {
  const root = new THREE.Group();
  const body = metal(0x7a4a2c, 0.45, 0.55);
  mesh(T.body, body, root);
  const legs = new THREE.Group();
  root.add(legs);
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? 1 : -1;
    const k = (i % 3) - 1;
    const leg = mesh(T.leg, T.legMat, legs);
    leg.rotation.y = (side > 0 ? 0 : Math.PI) + k * 0.6 * side;
  }
  for (const x of [-0.42, 0.42]) {
    mesh(T.eye, T.eyeMat, root).position.set(x, 0.25, 1.55);
    const m = mesh(T.mandible, T.legMat, root);
    m.position.set(x * 0.8, -0.2, 1.9);
    m.rotation.x = Math.PI / 2;
  }
  return { root, body, parts: { legs } };
}

/** Searchlight cone: additive, fades along its length and toward its edges. uColor is set per lantern. */
function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1, 0.9, 0.55) }, uLen: { value: 45 }, uStrength: { value: 0.045 } },
    vertexShader: /* glsl */ `
      varying float vZ;
      varying vec3 vN, vV;
      void main() {
        vZ = position.z;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uLen, uStrength;
      varying float vZ;
      varying vec3 vN, vV;
      void main() {
        float along = pow(clamp(1.0 - vZ / uLen, 0.0, 1.0), 2.0);
        float rim = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
        gl_FragColor = vec4(uColor * uStrength * along * (0.35 + rim), 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---------- Lantern: floating sentry with a sweeping searchlight ----------
const L = {
  body: new THREE.CylinderGeometry(1.1, 1.5, 2.2, 8, 1),
  cap: new THREE.ConeGeometry(1.2, 0.9, 8),
  ring: new THREE.TorusGeometry(1.9, 0.14, 4, 20),
  lens: new THREE.CircleGeometry(0.7, 16),
  beam: (() => {
    // Open cone from the lens out to 45 m, pointing down +z.
    const len = 45;
    const g = new THREE.ConeGeometry(11, len, 20, 6, true);
    g.translate(0, -len / 2, 0);
    g.rotateX(-Math.PI / 2);
    return g;
  })(),
  ringMat: metal(0x3a3530, 0.8, 0.3),
};
export function lanternModel(): Model {
  const root = new THREE.Group();
  const body = metal(0x9a7b46, 0.8, 0.3);
  mesh(L.body, body, root);
  mesh(L.cap, L.ringMat, root).position.y = 1.55;
  const ring = mesh(L.ring, L.ringMat, root);
  ring.rotation.x = Math.PI / 2;
  // The head turns to sweep; lens and beam hang off it.
  const head = new THREE.Group();
  head.position.y = -0.2;
  root.add(head);
  const lensMat = glow(hdr(4.5, 4, 2.6));
  const lens = mesh(L.lens, lensMat, head);
  lens.position.z = 1.45;
  const beamMat = beamMaterial();
  const beam = mesh(L.beam, beamMat, head);
  beam.position.z = 1.45;
  return { root, body, parts: { head, lens, beam, ring } };
}

// ---------- Heartforge: mine boss, armoured core with three vents that open in turns ----------
const H = {
  shell: new THREE.DodecahedronGeometry(7, 0),
  inner: new THREE.IcosahedronGeometry(5.6, 1),
  band: new THREE.TorusGeometry(8.2, 0.7, 6, 24),
  vent: new THREE.CylinderGeometry(1.8, 2.2, 1.6, 8, 1),
  shutter: new THREE.BoxGeometry(2.2, 4.4, 0.5),
  spire: new THREE.ConeGeometry(1.2, 5, 5),
  innerMat: glow(hdr(3.2, 0.9, 0.15)),
  ventMat: glow(hdr(5, 1.8, 0.3)),
  bandMat: metal(0x2c2a2a, 0.8, 0.35),
  shutterMat: metal(0x4c4642, 0.85, 0.3),
};
export function heartforgeModel(): Model {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x55504c, metalness: 0.75, roughness: 0.4, flatShading: true, wireframe: false });
  mesh(H.inner, H.innerMat, root);
  const shell = mesh(H.shell, body, root);
  shell.scale.set(1, 0.92, 1);
  const spin = new THREE.Group();
  root.add(spin);
  const band = mesh(H.band, H.bandMat, spin);
  band.rotation.x = Math.PI / 2;
  const vents: THREE.Object3D[] = [];
  const shutters: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const mount = new THREE.Group();
    mount.rotation.y = a;
    spin.add(mount);
    const v = mesh(H.vent, H.ventMat, mount);
    v.rotation.x = Math.PI / 2;
    v.position.z = 7.4;
    vents.push(v);
    for (const side of [-1, 1]) {
      const s = mesh(H.shutter, H.shutterMat, mount);
      s.position.set(side * 1.1, 0, 8.3);
      s.userData.side = side;
      shutters.push(s);
    }
  }
  for (const y of [1, -1]) {
    const sp = mesh(H.spire, H.bandMat, root);
    sp.position.y = y * 8.2;
    if (y < 0) sp.rotation.x = Math.PI;
  }
  return { root, body, parts: { spin, vent0: vents[0], vent1: vents[1], vent2: vents[2], ...Object.fromEntries(shutters.map((s, i) => [`shutter${i}`, s])) } };
}

export const MODELS = {
  warden: wardenModel,
  gnat: gnatModel,
  bulwark: bulwarkModel,
  shade: shadeModel,
  ember: emberModel,
  tick: tickModel,
  lantern: lanternModel,
  heartforge: heartforgeModel,
} as const;
export type ModelKind = keyof typeof MODELS;
