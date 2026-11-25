import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

// ---------- Weapon and tool parts shared by several models ----------
/** Merge several transformed primitives into one geometry (one draw call per material). */
function merged(...parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('mergeGeometries failed: mismatched attributes');
  for (const p of parts) p.dispose();
  return g;
}
/** Cylinder along +z, from z0 to z0 + len. */
function tube(r: number, len: number, z0 = 0, seg = 6, r2 = r) {
  return new THREE.CylinderGeometry(r2, r, len, seg, 1).rotateX(Math.PI / 2).translate(0, 0, z0 + len / 2);
}
function box(w: number, h: number, d: number, x = 0, y = 0, z = 0) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}
/** A gun pod with a barrel: housing centred at the origin, barrel pointing down +z. Muzzle at z = podLen / 2 + barrelLen. */
function cannon(podW: number, podLen: number, barrelR: number, barrelLen: number) {
  return merged(box(podW, podW, podLen), tube(barrelR * 1.6, 0.25, podLen / 2 - 0.05), tube(barrelR, barrelLen, podLen / 2));
}
const gunMetal = metal(0x1c1e23, 0.8, 0.35);
const muzzle = new THREE.OctahedronGeometry(0.16, 0);

/** Add a mesh at a position (and optional euler) to a parent. */
function place(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const o = mesh(g, m, parent);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  return o;
}

// ---------- Warden: the baseline ringed fighter, now with wing cannons ----------
const W = {
  body: new THREE.IcosahedronGeometry(1.6, 0),
  ring: new THREE.TorusGeometry(2.1, 0.22, 6, 16),
  eye: new THREE.SphereGeometry(0.55, 12, 8),
  wing: new THREE.BoxGeometry(3.6, 0.15, 1.1),
  thrust: new THREE.IcosahedronGeometry(1, 0),
  gun: cannon(0.42, 1.3, 0.1, 1.1),
  ringMat: metal(0x3b3f48, 0.7, 0.4),
  eyeMat: glow(hdr(5, 0.9, 0.5)),
  wingMat: metal(0x272a31),
  thrustMat: additive(hdr(3.5, 1.2, 0.5)),
  muzzleMat: glow(hdr(4, 0.8, 0.4)),
};
export function wardenModel(): Model {
  const root = new THREE.Group();
  const body = metal(0xa3a9b5, 0.4, 0.45);
  mesh(W.body, body, root);
  const ring = mesh(W.ring, W.ringMat, root);
  mesh(W.eye, W.eyeMat, root).position.z = 1.3;
  mesh(W.wing, W.wingMat, root);
  for (const x of [-1.75, 1.75]) {
    place(W.gun, gunMetal, root, x, -0.32, 0.2);
    place(muzzle, W.muzzleMat, root, x, -0.32, 2.05);
  }
  const t = mesh(W.thrust, W.thrustMat, root);
  t.position.z = -1.5;
  t.scale.set(0.45, 0.45, 0.9);
  root.scale.setScalar(1.25);
  return { root, body, parts: { ring } };
}

// ---------- Gnat: swarming fighter, chunky enough to hit, with wingtip needle guns ----------
const G = {
  hull: merged(
    // Wedge fuselage pointing down +z, with a raised spine so it reads from every angle.
    new THREE.ConeGeometry(1.25, 4.2, 4, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1.25, 0.8, 1),
    box(0.9, 0.7, 2.2, 0, 0.55, -0.5),
  ),
  wing: merged(
    box(5.2, 0.14, 1.3, 0, 0, -0.7),
    box(0.14, 1.2, 1.1, 2.6, 0.45, -0.9),
    box(0.14, 1.2, 1.1, -2.6, 0.45, -0.9),
  ),
  canopy: new THREE.OctahedronGeometry(0.45, 0).scale(1, 0.6, 1.6),
  gun: cannon(0.3, 0.9, 0.08, 1.4),
  tail: new THREE.OctahedronGeometry(0.5, 0),
  tailMat: additive(hdr(3.2, 2.4, 0.4)),
  canopyMat: glow(hdr(3.4, 2.6, 0.5)),
  finMat: metal(0x1d2026),
  muzzleMat: glow(hdr(3.6, 2.8, 0.6)),
};
export function gnatModel(): Model {
  const root = new THREE.Group();
  const body = metal(0xc9a44a, 0.55, 0.35);
  mesh(G.hull, body, root);
  place(G.wing, G.finMat, root, 0, 0, 0);
  place(G.canopy, G.canopyMat, root, 0, 0.75, 0.4);
  for (const x of [-2.6, 2.6]) {
    place(G.gun, gunMetal, root, x, -0.12, -0.4);
    place(muzzle, G.muzzleMat, root, x, -0.12, 1.5);
  }
  const tail = place(G.tail, G.tailMat, root, 0, 0, -2.2);
  tail.scale.set(1, 1, 2);
  return { root, body, parts: { tail } };
}

// ---------- Bulwark: armoured brute, shield plate in front, weak core behind ----------
const B = {
  hull: new THREE.CylinderGeometry(2.6, 3.1, 5.5, 6, 1).rotateX(Math.PI / 2),
  plate: new THREE.CylinderGeometry(4.2, 4.6, 0.8, 6, 1).rotateX(Math.PI / 2),
  stripe: new THREE.BoxGeometry(6.8, 0.35, 0.2),
  core: new THREE.IcosahedronGeometry(1.25, 1),
  cage: new THREE.TorusGeometry(1.6, 0.18, 4, 6),
  // Heavy side cannons on pylons that reach past the shield plate.
  sideGun: merged(box(1.9, 0.5, 0.9, 0.95, 0, 0), cannon(1.0, 3.4, 0.24, 3.2).translate(2.2, 0, 0.6)),
  // Dorsal twin turret.
  turret: merged(
    new THREE.CylinderGeometry(1.2, 1.5, 0.8, 8, 1),
    box(1.6, 0.9, 1.8, 0, 0.75, 0.2),
    tube(0.15, 4.2, 0.9).translate(-0.4, 0.8, 0),
    tube(0.15, 4.2, 0.9).translate(0.4, 0.8, 0),
  ),
  plateMat: metal(0x6b5a3a, 0.75, 0.35),
  stripeMat: glow(hdr(3.2, 1.9, 0.3)),
  coreMat: glow(hdr(4.5, 0.6, 2.4)),
  muzzleMat: glow(hdr(4, 2.2, 0.4)),
  dark: metal(0x22252b, 0.7, 0.5),
};
export function bulwarkModel(): Model {
  const root = new THREE.Group();
  const body = metal(0x5d6470, 0.65, 0.4);
  mesh(B.hull, body, root);
  const plate = mesh(B.plate, B.plateMat, root);
  plate.position.z = 3.1;
  for (const y of [-1.2, 1.2]) place(B.stripe, B.stripeMat, root, 0, y, 3.55);
  const core = place(B.core, B.coreMat, root, 0, 0, -3.1);
  place(B.cage, B.dark, root, 0, 0, -3.1);
  for (const side of [-1, 1]) {
    const g = place(B.sideGun, B.dark, root, side * 2.6, -0.8, 0);
    g.scale.x = side;
    place(muzzle, B.muzzleMat, root, side * 4.8, -0.8, 5.95).scale.setScalar(1.6);
  }
  const turret = place(B.turret, B.dark, root, 0, 2.9, 0.2);
  return { root, body, parts: { core, plate, turret } };
}

// ---------- Shade: cloaking ambusher with an underslung rail lance ----------
const S = {
  hull: new THREE.OctahedronGeometry(1, 0).scale(0.9, 0.45, 2.6),
  blade: new THREE.TorusGeometry(2.6, 0.16, 3, 10, Math.PI * 0.75)
    .rotateZ(Math.PI * 0.125 + Math.PI)
    .rotateX(Math.PI / 2)
    .translate(0, 0, 1.2),
  slit: new THREE.BoxGeometry(1.1, 0.12, 0.12),
  // Twin rails with a housing; the shot charges between them.
  lance: merged(
    box(0.7, 0.45, 1.6, 0, 0, -0.2),
    box(0.12, 0.16, 4.4, -0.24, 0, 2.2),
    box(0.12, 0.16, 4.4, 0.24, 0, 2.2),
  ),
  coil: new THREE.TorusGeometry(0.42, 0.07, 4, 12),
  edgeMat: glow(hdr(1.8, 0.6, 4.5)),
  slitMat: glow(hdr(4, 1.6, 5)),
};
export function shadeModel(): Model {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x4a3d66, metalness: 0.85, roughness: 0.25, flatShading: true, transparent: true });
  mesh(S.hull, body, root);
  const blade = mesh(S.blade, S.edgeMat, root);
  const slit = place(S.slit, S.slitMat, root, 0, 0.32, 1.4);
  place(S.lance, gunMetal, root, 0, -0.62, 0.2);
  for (const z of [1.4, 2.6, 3.8]) place(S.coil, S.edgeMat, root, 0, -0.62, z);
  const charge = place(muzzle, S.slitMat, root, 0, -0.62, 4.6);
  charge.scale.setScalar(1.8);
  root.scale.setScalar(1.2);
  return { root, body, parts: { blade, slit, charge } };
}

// ---------- Ember: kamikaze pod, molten core inside a spiked cage, ram drill in front ----------
const E = {
  cage: new THREE.IcosahedronGeometry(1.5, 0),
  core: new THREE.IcosahedronGeometry(0.95, 1),
  spike: new THREE.ConeGeometry(0.22, 1.1, 4).translate(0, 1.9, 0),
  drill: merged(
    new THREE.ConeGeometry(0.85, 2.6, 6, 3).rotateX(Math.PI / 2).translate(0, 0, 2.6),
    tube(0.95, 0.35, 1.0, 8),
  ),
  collar: new THREE.TorusGeometry(1.0, 0.16, 4, 8),
  coreMat: glow(hdr(3, 0.9, 0.15)),
  spikeMat: metal(0x2b2420, 0.7, 0.5),
  drillMat: metal(0x8c8f96, 0.9, 0.25),
};
export function emberModel(): Model {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x3a2f2a, metalness: 0.6, roughness: 0.5, flatShading: true, wireframe: true });
  mesh(E.cage, body, root);
  const core = mesh(E.core, E.coreMat, root);
  const spikes = new THREE.Group();
  root.add(spikes);
  // Five spikes; the front one is replaced by the drill.
  const dirs = [[0, 0, 0], [-Math.PI / 2, 0, 0], [Math.PI, 0, 0], [0, 0, Math.PI / 2], [0, 0, -Math.PI / 2]];
  for (const [x, y, z] of dirs) mesh(E.spike, E.spikeMat, spikes).rotation.set(x, y, z);
  const drill = mesh(E.drill, E.drillMat, root);
  place(E.collar, E.spikeMat, root, 0, 0, 1.25);
  return { root, body, parts: { core, spikes, drill } };
}

// ---------- Tick: wall-clinging crawler for the mines, with twin rock drills and a cutter ----------
const T = {
  body: new THREE.IcosahedronGeometry(1.2, 0).scale(1.25, 0.6, 1.5),
  // Spider leg: upper segment rises outward to a knee, lower segment angles down to the foot.
  leg: (() => {
    const up = 0.65;
    const upper = box(1.5, 0.2, 0.2, 0.75, 0, 0).rotateZ(up);
    const kx = 1.5 * Math.cos(up);
    const ky = 1.5 * Math.sin(up);
    const lo = -1.25;
    const lower = new THREE.ConeGeometry(0.13, 2.0, 4, 1).translate(0, -1.0, 0).rotateZ(Math.PI / 2 + lo).translate(kx, ky, 0);
    // ConeGeometry has no index-free mismatch issues with BoxGeometry, but needs matching attributes.
    return merged(upper, lower);
  })(),
  eye: new THREE.SphereGeometry(0.22, 8, 6),
  drill: merged(new THREE.ConeGeometry(0.32, 1.5, 6, 2).rotateX(Math.PI / 2).translate(0, 0, 0.75), tube(0.36, 0.3, -0.2, 6)),
  cutter: merged(new THREE.CylinderGeometry(0.75, 0.75, 0.1, 10, 1).rotateZ(Math.PI / 2), box(0.18, 0.18, 1.0, 0, 0, -0.5)),
  legMat: metal(0x2a221c, 0.5, 0.6),
  eyeMat: glow(hdr(0.8, 4.5, 0.9)),
  toolMat: metal(0x9aa0a8, 0.9, 0.25),
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
    leg.position.set(side * 0.9, 0, k * 0.8);
    leg.rotation.y = (side > 0 ? 0 : Math.PI) - k * 0.55 * side;
  }
  for (const x of [-0.42, 0.42]) place(T.eye, T.eyeMat, root, x, 0.28, 1.55);
  const drills: THREE.Object3D[] = [];
  for (const x of [-0.55, 0.55]) drills.push(place(T.drill, T.toolMat, root, x, -0.25, 1.7));
  const cutter = place(T.cutter, T.toolMat, root, 0, -0.65, 2.1);
  return { root, body, parts: { legs, drillL: drills[0], drillR: drills[1], cutter } };
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
  // Twin guns slung under the lens, so they aim wherever the beam looks.
  guns: merged(box(1.5, 0.35, 0.9, 0, 0, 0), tube(0.09, 1.3, 0.4).translate(-0.45, 0, 0), tube(0.09, 1.3, 0.4).translate(0.45, 0, 0)),
  // Ore grabber: a jointed claw arm hanging below the body.
  claw: merged(
    box(0.18, 1.4, 0.18, 0, -0.7, 0),
    box(0.16, 0.9, 0.16, 0, -0.45, 0).rotateX(0.7).translate(0, -1.3, 0),
    new THREE.ConeGeometry(0.12, 0.5, 4).rotateX(Math.PI).translate(0, -2.25, 0.55),
  ),
  muzzleMat: glow(hdr(4.5, 3.6, 1.4)),
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
  place(L.guns, gunMetal, head, 0, -0.85, 1.0);
  for (const x of [-0.45, 0.45]) place(muzzle, L.muzzleMat, head, x, -0.85, 2.7);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    place(L.claw, gunMetal, root, Math.sin(a) * 0.9, -1.05, Math.cos(a) * 0.9, 0, a, 0);
  }
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
