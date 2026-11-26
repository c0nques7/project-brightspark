import * as THREE from 'three';
import { additive, box, cannon, glow, gunMetal, hdr, merged, mesh, metal, muzzle, place, tube, type Model } from './models';

// Space faction: pale ceramic hulls with dark panelling and crimson-magenta running lights, so they
// read differently from the rusty, amber-lit mine machines. Every ship shows its weapons.

const hullMat = () => metal(0xc9cdd6, 0.35, 0.4);
const panel = metal(0x2a2d36, 0.7, 0.45);
const accent = glow(hdr(4.5, 0.5, 1.3));
const accentDim = glow(hdr(2.2, 0.25, 0.7));
const engine = additive(hdr(1.6, 0.6, 4));
const muzzleRed = glow(hdr(5, 0.6, 1.2));

/** Engine flame: a stretched glowing octahedron pointing down -z. */
const flame = new THREE.OctahedronGeometry(0.5, 0);
function engineGlow(parent: THREE.Object3D, x: number, y: number, z: number, s: number) {
  const f = place(flame, engine, parent, x, y, z);
  f.scale.set(s, s, s * 2.6);
  return f;
}

// ---------- Lancer: interceptor that flies in threes and makes strafing runs ----------
const LN = {
  hull: merged(
    new THREE.ConeGeometry(0.75, 6, 6, 1).rotateX(Math.PI / 2).scale(1, 0.6, 1),
    box(1.3, 0.7, 2.4, 0, 0, -2.2),
  ),
  canard: merged(box(3.4, 0.1, 0.9, 0, 0, 0.6), box(4.6, 0.12, 1.3, 0, 0, -2.4)),
  prong: cannon(0.3, 1.8, 0.09, 2.6),
  stripe: box(0.12, 0.08, 4.2, 0, 0.34, -0.4),
};
export function lancerModel(): Model {
  const root = new THREE.Group();
  const body = hullMat();
  mesh(LN.hull, body, root);
  place(LN.canard, panel, root, 0, 0, 0);
  place(LN.stripe, accent, root, 0, 0, 0);
  for (const x of [-0.95, 0.95]) {
    place(LN.prong, gunMetal, root, x, -0.25, 0.6);
    place(muzzle, muzzleRed, root, x, -0.25, 4.1);
  }
  const eng = engineGlow(root, 0, 0, -3.8, 0.9);
  return { root, body, parts: { engine: eng } };
}

// ---------- Quiver: missile boat; keeps its distance and launches homing missiles ----------
const QV = {
  hull: merged(box(3.2, 1.2, 6, 0, 0, 0), new THREE.ConeGeometry(1.4, 2.2, 4, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1.4, 0.7, 1).translate(0, 0, 4.1)),
  pod: box(1.5, 1.5, 4.4),
  tubeCap: new THREE.ConeGeometry(0.22, 0.6, 6).rotateX(Math.PI / 2),
  dish: merged(new THREE.CylinderGeometry(1.1, 0.2, 0.4, 10, 1), tube(0.08, 1.2, -1.2).rotateX(Math.PI / 2)),
  fin: box(0.12, 1.8, 1.6),
};
export function quiverModel(): Model {
  const root = new THREE.Group();
  const body = hullMat();
  mesh(QV.hull, body, root);
  const tips: THREE.Object3D[] = [];
  for (const x of [-2.5, 2.5]) {
    place(QV.pod, panel, root, x, 0, 0.2);
    // A 2x2 grid of loaded missile heads poking out of each pod.
    for (const [dx, dy] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) tips.push(place(QV.tubeCap, accent, root, x + dx, dy, 2.6));
  }
  const dish = place(QV.dish, panel, root, 0, 1.3, -1.6);
  place(QV.fin, panel, root, 0, 1.2, -2.6);
  engineGlow(root, -0.9, 0, -3.4, 0.8);
  engineGlow(root, 0.9, 0, -3.4, 0.8);
  return { root, body, parts: { dish, ...Object.fromEntries(tips.map((t, i) => [`missile${i}`, t])) } };
}

// ---------- Aegis: support drone that shields nearby allies; kill it first ----------
const AG = {
  core: new THREE.IcosahedronGeometry(1.3, 1),
  arm: merged(box(0.3, 0.3, 2.4, 0, 0, 1.6), new THREE.OctahedronGeometry(0.45, 0).translate(0, 0, 3)),
  ring: new THREE.TorusGeometry(1.9, 0.16, 4, 24),
  bubble: new THREE.IcosahedronGeometry(7, 2),
  gun: cannon(0.35, 0.8, 0.08, 1.2),
};
export function aegisModel(): Model {
  const root = new THREE.Group();
  const body = hullMat();
  mesh(AG.core, body, root);
  const ring = place(AG.ring, accent, root, 0, 0, 0, Math.PI / 2);
  const arms = new THREE.Group();
  root.add(arms);
  for (let i = 0; i < 3; i++) place(AG.arm, panel, arms, 0, 0, 0, 0, (i / 3) * Math.PI * 2, 0);
  for (let i = 0; i < 3; i++) {
    const tip = place(muzzle, glow(hdr(1.5, 3.2, 5)), arms, 0, 0, 0);
    tip.position.set(Math.sin((i / 3) * Math.PI * 2) * 3, 0, Math.cos((i / 3) * Math.PI * 2) * 3);
    tip.scale.setScalar(2.2);
  }
  place(AG.gun, gunMetal, root, 0, -1.4, 0.4);
  place(muzzle, muzzleRed, root, 0, -1.4, 1.8);
  // The shield it projects (on itself here; in play it wraps nearby allies too).
  const bubbleMat = additive(hdr(0.25, 0.55, 1.1), 0.22);
  bubbleMat.wireframe = true;
  const bubble = mesh(AG.bubble, bubbleMat, root);
  return { root, body, parts: { ring, arms, bubble } };
}

// ---------- Corsair: gunship with two twin turrets ----------
const CS = {
  hull: merged(
    box(3.4, 2, 11, 0, 0, 0),
    new THREE.ConeGeometry(1.9, 3.5, 4, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1.25, 0.75, 1).translate(0, 0, 7.2),
    box(1.8, 1.6, 3, 0, 1.6, -2.2),
  ),
  wing: box(10, 0.3, 3, 0, 0, -2.2),
  nacelle: tube(0.85, 4.4, -2.2, 8),
  turret: merged(new THREE.CylinderGeometry(0.9, 1.1, 0.6, 8, 1), box(1.3, 0.7, 1.5, 0, 0.55, 0.1), tube(0.13, 3, 0.7).translate(-0.3, 0.55, 0), tube(0.13, 3, 0.7).translate(0.3, 0.55, 0)),
  stripe: box(3.5, 0.1, 0.3),
};
export function corsairModel(): Model {
  const root = new THREE.Group();
  const body = hullMat();
  mesh(CS.hull, body, root);
  place(CS.wing, panel, root, 0, -0.3, 0);
  for (const x of [-4.8, 4.8]) {
    place(CS.nacelle, panel, root, x, -0.3, -2.4);
    engineGlow(root, x, -0.3, -5.6, 1.4);
  }
  for (const z of [-0.6, 2.4, 5.0]) place(CS.stripe, accentDim, root, 0, 1.03, z);
  const top = place(CS.turret, gunMetal, root, 0, 1.0, 3.2);
  const bottom = place(CS.turret, gunMetal, root, 0, -1.0, 1.2, Math.PI, 0, 0);
  place(muzzle, muzzleRed, root, 0, 1.55, 7.3);
  return { root, body, parts: { turretTop: top, turretBottom: bottom } };
}

// ---------- Sower: minelayer; drops proximity mines behind it while it runs ----------
const SW = {
  hull: merged(
    new THREE.IcosahedronGeometry(1, 1).scale(1.6, 1.3, 2.2).toNonIndexed(),
  ),
  nose: box(1.2, 0.8, 1.6, 0, -0.3, 2.4),
  drum: tube(1.1, 2.4, -0.2, 8),
  mine: merged(new THREE.IcosahedronGeometry(0.42, 0).toNonIndexed()),
  spike: new THREE.ConeGeometry(0.08, 0.5, 4).translate(0, 0.55, 0),
  gun: cannon(0.3, 0.7, 0.08, 1.1),
};
export function sowerModel(): Model {
  const root = new THREE.Group();
  const body = hullMat();
  mesh(SW.hull, body, root);
  place(SW.nose, panel, root, 0, 0, 0);
  // Rotating drum at the tail, loaded with mines.
  const drum = new THREE.Group();
  drum.position.z = -2.4;
  root.add(drum);
  mesh(SW.drum, panel, drum).position.z = -1.2;
  const mineMat = glow(hdr(1.5, 0.45, 0.12));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = place(SW.mine, mineMat, drum, Math.cos(a) * 1.15, Math.sin(a) * 1.15, -0.6);
    for (const r of [0, Math.PI / 2, Math.PI]) place(SW.spike, gunMetal, m, 0, 0, 0, 0, 0, r);
  }
  place(SW.gun, gunMetal, root, 0, -1.2, 1.4);
  place(muzzle, muzzleRed, root, 0, -1.2, 2.7);
  for (const x of [-1.3, 1.3]) engineGlow(root, x, 0.6, -2.4, 0.7);
  return { root, body, parts: { drum } };
}

// ---------- Arc: sniper with a long rail barrel; telegraphs with a visible aim line ----------
const AR = {
  body: merged(box(1.6, 1.2, 3.2, 0, 0, -1.2), new THREE.ConeGeometry(0.9, 1.6, 4, 1).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4).translate(0, 0, -3.6)),
  barrel: merged(box(0.35, 0.35, 11, 0, 0.25, 5.4), box(0.35, 0.35, 11, 0, -0.25, 5.4), box(0.9, 0.9, 1.2, 0, 0, 0.4)),
  focus: new THREE.TorusGeometry(0.55, 0.09, 4, 12),
  fin: box(0.1, 2.6, 1.4),
};
export function arcModel(): Model {
  const root = new THREE.Group();
  const body = hullMat();
  mesh(AR.body, body, root);
  place(AR.barrel, gunMetal, root, 0, 0, 0);
  const rings: THREE.Object3D[] = [];
  for (const z of [3, 5.5, 8, 10.5]) rings.push(place(AR.focus, accent, root, 0, 0, z));
  place(AR.fin, panel, root, 0, 0.8, -2.2);
  place(AR.fin, panel, root, 1.1, -0.4, -2.2, 0, 0, 2.1);
  place(AR.fin, panel, root, -1.1, -0.4, -2.2, 0, 0, -2.1);
  const tip = place(muzzle, muzzleRed, root, 0, 0, 11.2);
  tip.scale.setScalar(2);
  engineGlow(root, 0, 0, -4.4, 0.9);
  return { root, body, parts: { tip, ...Object.fromEntries(rings.map((r, i) => [`ring${i}`, r])) } };
}

// ---------- Matriarch: carrier boss; launches Lancers, point-defence turrets, destructible engines ----------
const MT = {
  hull: merged(
    box(12, 6, 44, 0, 0, 0),
    new THREE.ConeGeometry(6.5, 12, 4, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1.3, 0.65, 1).translate(0, 0, 28),
    box(18, 2.5, 20, 0, -1.5, -8),
  ),
  tower: merged(box(4, 7, 8, 0, 3.5, 0), box(6, 1.6, 3, 0, 7.5, 1.5)),
  hangar: box(7.5, 3.4, 0.3),
  engine: tube(3.2, 6, -3, 10),
  pd: merged(new THREE.CylinderGeometry(2, 2.5, 1.4, 8, 1), box(2.4, 1.6, 2.4, 0, 1.3, 0), tube(0.24, 4.5, 1).translate(-0.6, 1.3, 0), tube(0.24, 4.5, 1).translate(0.6, 1.3, 0)),
  // Side hangar pods that launch Lancers.
  pod: merged(box(6, 5, 22, 0, 0, 0), new THREE.ConeGeometry(3.6, 5, 4, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1.15, 0.97, 1).translate(0, 0, 13.4)),
  mouth: box(4.4, 3.4, 0.3),
  spine: merged(box(0.6, 4, 0.6, 0, 2, 0), box(3, 0.3, 0.3, 0, 3.4, 0), box(2, 0.3, 0.3, 0, 2.6, 0)),
  stripe: box(0.4, 0.2, 30),
  light: box(0.5, 0.3, 0.5),
};
export function matriarchModel(): Model {
  const root = new THREE.Group();
  const body = hullMat();
  mesh(MT.hull, body, root);
  place(MT.tower, panel, root, 0, 3, -10);
  for (const x of [-6.1, 6.1]) place(MT.stripe, accentDim, root, x, 1.5, 2);
  // Hangar mouth under the nose, glowing, plus a hangar pod on each flank.
  const bayMat = glow(hdr(4, 1.4, 2.2));
  const hangar = place(MT.hangar, bayMat, root, 0, -1.2, 22.05);
  for (const x of [-11.5, 11.5]) {
    place(MT.pod, panel, root, x, -1, 2);
    place(MT.mouth, bayMat, root, x, -1, 13.2);
    place(MT.stripe, accentDim, root, x, 1.6, 2).scale.z = 0.6;
  }
  place(MT.spine, gunMetal, root, 0, 11, -12);
  // Engines: the weak points.
  const engines: THREE.Object3D[] = [];
  const engineCoreMat = glow(hdr(1.8, 0.8, 5));
  for (const x of [-6.5, 6.5]) {
    place(MT.engine, panel, root, x, -1.5, -19);
    const core = place(new THREE.CircleGeometry(2.7, 16), engineCoreMat, root, x, -1.5, -22.1, 0, Math.PI, 0);
    engines.push(core);
    engineGlow(root, x, -1.5, -24, 4.5);
  }
  // Point-defence turrets.
  const pds: THREE.Object3D[] = [];
  for (const [x, y, z, flip] of [[-4, 3, 14, 0], [4, 3, 14, 0], [-4, -3, 8, 1], [4, -3, 8, 1], [0, 3, 2, 0]] as const) {
    pds.push(place(MT.pd, gunMetal, root, x, y, z, flip ? Math.PI : 0, 0, 0));
  }
  for (let i = 0; i < 10; i++) place(MT.light, accent, root, (i % 2 ? 1 : -1) * 6.1, -3.05, 18 - i * 4.4);
  return { root, body, parts: { hangar, engineL: engines[0], engineR: engines[1], ...Object.fromEntries(pds.map((p, i) => [`pd${i}`, p])) } };
}

export const SPACE_MODELS = {
  lancer: lancerModel,
  quiver: quiverModel,
  aegis: aegisModel,
  corsair: corsairModel,
  sower: sowerModel,
  arc: arcModel,
  matriarch: matriarchModel,
} as const;
