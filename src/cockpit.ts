import * as THREE from 'three';
import { GUN_OFFSET, PLAYER, type Game } from './game';
import type { NavInfo } from './hud';

// A 3D cockpit attached to the camera, laid out like a classic mine-runner cockpit but built in a
// clean modern style: curved canopy arches framing the view, glowing energy/shield strips across
// the dash with numeric readouts between them, a primary-weapon screen on the left, a round
// ship-status + radar display in the centre pod, a secondary-weapon/nav screen on the right,
// a target LOCK lamp and a column of status lamps.
// Built from primitives (a few dozen draw calls); screens redraw at ~15 Hz.

// Layout reference: 16:9 at 75° vertical FOV (visible half-size at 1 m: 1.36 x 0.77).
const REF_HALF_W = 1.364;
const REF_HALF_H = 0.767;
const RADAR_RANGE = 450;

const CYAN = '#7fe8ff';
const CYAN_DIM = 'rgba(127,232,255,0.45)';
const AMBER = '#ffb347';
const RED = '#ff4a30';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';

const _v = new THREE.Vector3();
const shotPulse = (r: number[]) => Math.max(r[0], r[1]) * 0.8;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

class Screen {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshBasicMaterial;

  constructor(geo: THREE.BufferGeometry, px: number, py: number, readonly glow = 1.35) {
    this.canvas.width = px;
    this.canvas.height = py;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, color: new THREE.Color(glow, glow, glow), fog: false });
    this.mesh = new THREE.Mesh(geo, this.mat);
  }
}

/**
 * A disc bulged outward like a CRT face: planar UVs (so the canvas maps straight on) with the
 * surface pushed forward by a sphere of the given radius.
 */
function domeGeometry(r: number, sphereR: number, offset = 0) {
  const geo = new THREE.RingGeometry(0, r, 64, 16);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const edge = Math.sqrt(sphereR * sphereR - r * r);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, Math.sqrt(Math.max(0, sphereR * sphereR - x * x - y * y)) - edge + offset);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Static glass glare for the radar: a soft highlight arc near the top-left and a rim sheen. */
function glareTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(95, 80, 4, 95, 80, 120);
  grd.addColorStop(0, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.25, 'rgba(220,245,255,0.18)');
  grd.addColorStop(1, 'rgba(220,245,255,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.ellipse(100, 82, 92, 50, -0.6, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(200,240,255,0.22)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(128, 128, 120, Math.PI * 0.9, Math.PI * 1.55);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Rounded-rectangle shape for bezels and the centre pod. */
function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function bezel(w: number, h: number, r: number, depth: number, mat: THREE.Material) {
  const geo = new THREE.ExtrudeGeometry(roundedRect(w, h, r), { depth, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 6 });
  return new THREE.Mesh(geo, mat);
}

export class Cockpit {
  readonly root = new THREE.Group();
  private sway = new THREE.Group();
  /** Wings and guns: follows the cockpit sway but is not stretched by fit(). */
  private exterior = new THREE.Group();
  private frame = new THREE.Group();
  private metal: THREE.MeshStandardMaterial;
  private dark: THREE.MeshStandardMaterial;
  private accent: THREE.MeshBasicMaterial;
  private muzzles: THREE.Mesh[] = [];
  private slides: THREE.Group[] = [];
  private recoil = [0, 0];
  private gunMetal!: THREE.MeshStandardMaterial;
  private coil!: THREE.MeshBasicMaterial;
  private screens: Screen[] = [];
  private primary: Screen;
  private secondary: Screen;
  private status: Screen;
  private energyBar: Screen;
  private shieldBar: Screen;
  private readout: Screen;
  private lock: Screen;
  private lamps: { mat: THREE.MeshBasicMaterial; on: THREE.Color; off: THREE.Color }[] = [];
  private redraw = 0;
  private flash = 0;
  private hurt = 0;
  private flicker = 0;
  private heat = 0;
  private lastQuat = new THREE.Quaternion();
  private lastVel = new THREE.Vector3();
  private swayPos = new THREE.Vector3();
  private swayRot = new THREE.Vector3();
  private time = 0;
  enabled = true;

  constructor(private camera: THREE.PerspectiveCamera) {
    this.metal = new THREE.MeshStandardMaterial({ color: 0x3a404a, metalness: 0.8, roughness: 0.32, emissive: 0x06080c, envMapIntensity: 1.6, fog: false });
    this.dark = new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.4, roughness: 0.7, emissive: 0x040507, fog: false });
    this.accent = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.8, 1.0), fog: false });

    const g = this.sway;
    this.root.add(g);
    camera.add(this.root);

    // ---- Dashboard: a slab tilted back toward the pilot.
    const panel = new THREE.Group();
    panel.position.set(0, -0.545, -0.87);
    panel.rotation.x = -0.6;
    g.add(panel);
    panel.add(new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.42, 0.05), this.dark));
    // Coaming along the top edge of the dash, with a thin light line.
    const coaming = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.035, 0.1), this.metal);
    coaming.position.set(0, 0.215, 0.02);
    panel.add(coaming);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.005, 0.005), this.accent);
    lip.position.set(0, 0.234, 0.07);
    panel.add(lip);

    // Energy (left) and shield (right) strips under the coaming, readouts between them.
    const stripGeo = new THREE.PlaneGeometry(0.56, 0.045);
    // Kept just under the bloom threshold so they read as lit, not blown out.
    this.energyBar = this.addScreen(panel, stripGeo, 512, 40, -0.42, 0.16, 0.85);
    this.shieldBar = this.addScreen(panel, stripGeo, 512, 40, 0.42, 0.16, 0.85);
    this.readout = this.addScreen(panel, new THREE.PlaneGeometry(0.15, 0.08), 160, 85, 0, 0.16, 1.0);
    for (const x of [-0.42, 0.42]) this.addBezel(panel, 0.59, 0.07, 0.01, x, 0.16);
    this.addBezel(panel, 0.18, 0.11, 0.02, 0, 0.16);

    // Left: primary weapon. Right: secondary weapon + nav. Centre: ship status / radar.
    // (Canvases keep a 320x186 drawing space; the slight vertical squash onto the screen is intended.)
    const sideGeo = new THREE.PlaneGeometry(0.38, 0.19);
    this.primary = this.addScreen(panel, sideGeo, 320, 186, -0.5, -0.005);
    this.secondary = this.addScreen(panel, sideGeo, 320, 186, 0.5, -0.005);
    this.addBezel(panel, 0.42, 0.23, 0.03, -0.5, -0.005);
    this.addBezel(panel, 0.42, 0.23, 0.03, 0.5, -0.005);
    // Centre pod: a rounded housing standing proud of the dash, holding a convex radar display
    // under curved glass, inside a deep bezel ring.
    const pod = bezel(0.3, 0.26, 0.09, 0.04, this.metal);
    pod.position.set(0, -0.005, 0.0);
    panel.add(pod);
    const RAD = 0.112;
    const DOME = 0.2; // sphere radius of the screen curve (smaller = more curved)
    this.status = this.addScreen(panel, domeGeometry(RAD, DOME), 512, 512, 0, -0.005);
    this.status.mesh.position.z = 0.056;
    // Glass: slightly glossy, so it picks up the nebula/sun reflections as the ship turns, plus a fixed glare.
    const glassGeo = domeGeometry(RAD, DOME, 0.003);
    const glass = new THREE.Mesh(
      glassGeo,
      new THREE.MeshStandardMaterial({ color: 0x0a1418, metalness: 0.9, roughness: 0.12, transparent: true, opacity: 0.1, envMapIntensity: 2.5, depthWrite: false, fog: false }),
    );
    const glare = new THREE.Mesh(
      glassGeo,
      new THREE.MeshBasicMaterial({ map: glareTexture(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    for (const m of [glass, glare]) {
      m.position.set(0, -0.005, 0.056);
      panel.add(m);
    }
    // Bezel: a thick ring around the screen with a thin lit inner lip.
    const ringOuter = new THREE.Mesh(new THREE.TorusGeometry(RAD + 0.008, 0.011, 10, 64), this.metal);
    ringOuter.position.set(0, -0.005, 0.058);
    panel.add(ringOuter);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(RAD + 0.001, 0.0025, 6, 64), this.accent);
    ring.position.set(0, -0.005, 0.062);
    panel.add(ring);

    // LOCK lamp, lower left; status lamps column, lower right.
    this.lock = this.addScreen(panel, new THREE.PlaneGeometry(0.14, 0.055), 160, 60, -0.83, 0.0, 1.2);
    this.addBezel(panel, 0.16, 0.075, 0.012, -0.83, 0.0);
    const lampGeo = new THREE.BoxGeometry(0.05, 0.022, 0.012);
    const lampDefs: [number, THREE.Color][] = [
      [0.0, new THREE.Color(4, 3, 0.4)], // boost
      [-0.04, new THREE.Color(4, 1.8, 0.2)], // cruise
      [-0.08, new THREE.Color(0.4, 2.5, 4)], // shield charging
      [-0.12, new THREE.Color(6, 0.5, 0.25)], // hull warning
    ];
    for (const [y, on] of lampDefs) {
      on.multiplyScalar(0.5);
      const off = on.clone().multiplyScalar(0.1);
      const mat = new THREE.MeshBasicMaterial({ color: off.clone(), fog: false });
      const m = new THREE.Mesh(lampGeo, mat);
      m.position.set(0.8, y + 0.02, 0.035);
      panel.add(m);
      this.lamps.push({ mat, on, off });
    }

    // ---- Side consoles running back from the dash.
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.1), this.dark);
      side.position.set(sx * 1.3, -0.66, -0.5);
      side.rotation.z = sx * 0.35;
      g.add(side);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 1.2), this.metal);
      rail.position.set(sx * 1.08, -0.57, -0.5);
      rail.rotation.z = sx * 0.35;
      g.add(rail);
    }

    // ---- Canopy: two curved arches sweeping from the dash corners up and over the head,
    // each with a light strip along its inner edge, plus a rail running back along each side.
    g.add(this.frame);
    for (const sx of [-1, 1]) {
      const pts = [
        new THREE.Vector3(sx * 1.22, -0.5, -1.05),
        new THREE.Vector3(sx * 1.12, 0.1, -1.0),
        new THREE.Vector3(sx * 0.82, 0.58, -0.9),
        new THREE.Vector3(sx * 0.4, 0.85, -0.6),
        new THREE.Vector3(sx * 0.1, 0.95, 0.0),
      ];
      const curve = new THREE.CatmullRomCurve3(pts);
      this.frame.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.045, 8, false), this.metal));
      const inner = new THREE.CatmullRomCurve3(pts.map((p) => p.clone().multiplyScalar(0.96)));
      this.frame.add(new THREE.Mesh(new THREE.TubeGeometry(inner, 40, 0.005, 4, false), this.accent));
      const rail = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sx * 1.22, -0.5, -1.05),
        new THREE.Vector3(sx * 1.35, -0.3, -0.5),
        new THREE.Vector3(sx * 1.3, -0.2, 0.2),
      ]);
      this.frame.add(new THREE.Mesh(new THREE.TubeGeometry(rail, 16, 0.04, 6, false), this.metal));
    }

    // ---- Wings and wing-mounted cannons. These live in an unscaled "exterior" group (the cockpit
    // root is stretched to fit the screen, the ship's wings shouldn't be), and the barrels end
    // exactly at GUN_OFFSET, where Game.firePlayer spawns the bolts.
    this.gunMetal = new THREE.MeshStandardMaterial({ color: 0x4a515c, metalness: 0.85, roughness: 0.3, emissive: 0x05070a, envMapIntensity: 1.8, fog: false });
    this.coil = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.9, 1.2), fog: false });
    const hull = new THREE.MeshStandardMaterial({ color: 0x5a616c, metalness: 0.6, roughness: 0.45, emissive: 0x05070a, envMapIntensity: 1.4, fog: false });
    this.camera.add(this.exterior);
    const ex = this.exterior;
    const tip = GUN_OFFSET.z;
    const barrelLen = 0.5;
    for (const sx of [-1, 1]) {
      // Swept wing, seen from the cockpit: root under the canopy sill, tip out at the gun pod.
      const plan = new THREE.Shape();
      plan.moveTo(sx * 0.9, 0.35);
      plan.lineTo(sx * 0.9, 1.45);
      plan.lineTo(sx * 1.95, 1.75);
      plan.lineTo(sx * 2.15, 1.75);
      plan.lineTo(sx * 2.15, 1.25);
      plan.lineTo(sx * 1.45, 0.6);
      plan.closePath();
      const wingGeo = new THREE.ExtrudeGeometry(plan, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 2 });
      wingGeo.rotateX(-Math.PI / 2); // shape y -> forward (-z), extrusion -> up
      const wing = new THREE.Mesh(wingGeo, hull);
      wing.position.y = -0.72;
      wing.rotation.z = sx * 0.06; // slight dihedral: tips up
      ex.add(wing);
      // Leading-edge light strip.
      const le = new THREE.LineCurve3(new THREE.Vector3(sx * 0.95, 0, -1.46), new THREE.Vector3(sx * 1.94, 0, -1.76));
      const strip = new THREE.Mesh(new THREE.TubeGeometry(le, 8, 0.006, 4, false), this.coil);
      strip.position.y = 0.075;
      wing.add(strip);
      // Panel line / spar along the wing.
      const spar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.012, 0.03), this.dark);
      spar.position.set(sx * 1.45, 0.07, -1.05);
      spar.rotation.y = sx * -0.25;
      wing.add(spar);

      // Gun pod on the wingtip.
      const gun = new THREE.Group();
      gun.position.set(sx * GUN_OFFSET.x, GUN_OFFSET.y, 0);
      ex.add(gun);
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.6, 14), this.gunMetal);
      pod.rotation.x = Math.PI / 2;
      pod.position.z = tip + barrelLen + 0.28;
      gun.add(pod);
      const podNose = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 0.1, 14), this.gunMetal);
      podNose.rotation.x = Math.PI / 2;
      podNose.position.z = tip + barrelLen - 0.04;
      gun.add(podNose);
      const podLight = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.45), this.coil);
      podLight.position.set(-sx * 0.08, 0.02, tip + barrelLen + 0.28);
      gun.add(podLight);
      // Recoiling part: barrel, coils and muzzle brake.
      const slide = new THREE.Group();
      gun.add(slide);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, barrelLen, 12), this.gunMetal);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = tip + barrelLen / 2;
      slide.add(barrel);
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.008, 6, 18), this.coil);
        c.position.z = tip + 0.12 + i * 0.08;
        slide.add(c);
      }
      const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.06, 10), this.gunMetal);
      brake.rotation.x = Math.PI / 2;
      brake.position.z = tip + 0.03;
      slide.add(brake);
      this.slides.push(slide);
    }

    // ---- Muzzle flashes at the barrel tips.
    const muzzleGeo = new THREE.SphereGeometry(0.08, 8, 6);
    for (const sx of [-1, 1]) {
      const muzzle = new THREE.Mesh(
        muzzleGeo,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 5, 6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      );
      muzzle.position.copy(GUN_OFFSET).setX(sx * GUN_OFFSET.x);
      muzzle.scale.set(1, 1, 2);
      ex.add(muzzle);
      this.muzzles.push(muzzle);
    }
    this.exterior.traverse((o) => {
      o.frustumCulled = false;
      o.renderOrder = 9;
    });

    // The cockpit must never be culled, and draws after the world.
    this.root.traverse((o) => {
      o.frustumCulled = false;
      o.renderOrder = 10;
    });
  }

  private addScreen(parent: THREE.Object3D, geo: THREE.BufferGeometry, px: number, py: number, x: number, y: number, glow = 1.35) {
    const s = new Screen(geo, px, py, glow);
    s.mesh.position.set(x, y, 0.045);
    parent.add(s.mesh);
    this.screens.push(s);
    return s;
  }

  private addBezel(parent: THREE.Object3D, w: number, h: number, r: number, x: number, y: number) {
    const b = bezel(w, h, r, 0.012, this.metal);
    b.position.set(x, y, 0.025);
    parent.add(b);
  }

  setVisible(v: boolean) {
    this.enabled = v;
    this.root.visible = v;
    this.exterior.visible = v && this.camera.aspect > 1;
  }

  /** Fit the layout to the current aspect ratio / FOV. */
  fit() {
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfW = halfH * this.camera.aspect;
    const sx = Math.min(1.25, halfW / REF_HALF_W);
    // In portrait, limit the squash and instead slide the dash down to the bottom edge.
    const sy = Math.min(halfH / REF_HALF_H, sx * 1.6);
    this.root.scale.set(sx, sy, 1);
    this.root.position.y = -(halfH - REF_HALF_H * sy) * 0.9;
    // A narrow portrait view would be mostly arch; keep just the dash there.
    this.frame.visible = this.camera.aspect > 1;
    this.exterior.visible = this.enabled && this.camera.aspect > 1;
  }

  fired(side: number) {
    this.flash = 1;
    this.heat = Math.min(1, this.heat + 0.06);
    const i = side < 0 ? 0 : 1;
    this.recoil[i] = 1;
    const m = this.muzzles[i];
    (m.material as THREE.MeshBasicMaterial).opacity = 1;
  }

  damaged(intensity: number) {
    this.hurt = Math.min(1, this.hurt + intensity * 0.6);
    this.flicker = 0.25 * intensity;
  }

  update(dt: number, game: Game, nav: NavInfo) {
    if (!this.enabled) return;
    this.time += dt;
    const cam = this.camera;
    const p = game.player;

    // ---- Inertia: lag behind rotation and acceleration (in camera space).
    _q.copy(this.lastQuat).invert().multiply(cam.quaternion);
    _e.setFromQuaternion(_q);
    this.lastQuat.copy(cam.quaternion);
    const inv = dt > 0 ? 1 / dt : 0;
    const yawRate = THREE.MathUtils.clamp(_e.y * inv, -4, 4);
    const pitchRate = THREE.MathUtils.clamp(_e.x * inv, -4, 4);
    const rollRate = THREE.MathUtils.clamp(_e.z * inv, -4, 4);
    _v.subVectors(p.vel, this.lastVel).multiplyScalar(inv); // world accel
    this.lastVel.copy(p.vel);
    _v.applyQuaternion(_q.copy(cam.quaternion).invert()); // to camera space
    if (_v.lengthSq() > 250000) _v.setLength(500); // ignore teleports / resets
    const targetPos = _v.multiplyScalar(-0.00018);
    targetPos.x += -yawRate * 0.008;
    targetPos.y += pitchRate * 0.008;
    targetPos.clampLength(0, 0.04);
    // Engine vibration grows with boost and cruise.
    const vib = (p.boosting ? 0.0025 : 0.0006) + (p.cruising ? 0.0018 : 0);
    targetPos.x += (Math.random() - 0.5) * vib;
    targetPos.y += (Math.random() - 0.5) * vib;
    this.swayPos.lerp(targetPos, 1 - Math.exp(-8 * dt));
    this.swayRot.x += (pitchRate * 0.01 - this.swayRot.x) * (1 - Math.exp(-6 * dt));
    this.swayRot.y += (yawRate * 0.012 - this.swayRot.y) * (1 - Math.exp(-6 * dt));
    this.swayRot.z += (rollRate * 0.02 - this.swayRot.z) * (1 - Math.exp(-6 * dt));
    this.sway.position.copy(this.swayPos);
    this.sway.rotation.set(this.swayRot.x, this.swayRot.y, this.swayRot.z);
    this.exterior.position.copy(this.swayPos);
    this.exterior.rotation.copy(this.sway.rotation);

    // ---- Lighting cues.
    this.flash = Math.max(0, this.flash - dt * 12);
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    this.flicker = Math.max(0, this.flicker - dt);
    this.heat = Math.max(0, this.heat - dt * 0.35);
    for (const m of this.muzzles) {
      const mm = m.material as THREE.MeshBasicMaterial;
      mm.opacity = Math.max(0, mm.opacity - dt * 14);
    }
    // Barrel recoil: snap back, ease forward.
    for (let i = 0; i < 2; i++) {
      this.recoil[i] = Math.max(0, this.recoil[i] - dt * 9);
      const k = this.recoil[i];
      this.slides[i].position.z = 0.05 * k * k;
    }
    // Coils: cool cyan, heating to orange; brief pulse on each shot.
    const ht = this.heat;
    const pulse = 1 + shotPulse(this.recoil);
    this.coil.color.setRGB((0.15 + ht * 3.5) * pulse, (0.9 + ht * 0.4) * pulse * (1 - ht * 0.5), (1.2 - ht * 1.1) * pulse);
    this.gunMetal.emissive.setRGB(0.02 + this.flash * 0.08 + ht * 0.06, 0.03 + this.flash * 0.18, 0.04 + this.flash * 0.22);
    const f = this.flash;
    this.metal.emissive.setRGB(0.024 + f * 0.05 + this.hurt * 0.25, 0.03 + f * 0.17, 0.045 + f * 0.2);
    this.dark.emissive.setRGB(0.015 + f * 0.03 + this.hurt * 0.15, 0.02 + f * 0.1, 0.028 + f * 0.12);
    const flick = this.flicker > 0 && Math.random() < 0.5 ? 0.35 : 1;
    for (const s of this.screens) s.mat.color.setScalar(s.glow * flick);
    const lowHull = p.hull < PLAYER.hull * 0.3;
    const blink = Math.sin(this.time * 9) > 0;
    const lampState = [p.boosting, p.cruising, p.shield < PLAYER.shield && p.shieldTimer <= 0, lowHull && blink];
    this.lamps.forEach((l, i) => l.mat.color.copy(lampState[i] ? l.on : l.off));

    // ---- Screens.
    this.redraw -= dt;
    if (this.redraw <= 0) {
      this.redraw = 1 / 15;
      this.drawStrips(game);
      this.drawPrimary(game);
      this.drawSecondary(game, nav);
      this.drawStatus(game, nav);
      this.drawLock(game);
    }
  }

  // ---------- Screen drawing ----------
  private bg(c: CanvasRenderingContext2D, w: number, h: number, color = '#03121a') {
    c.fillStyle = color;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(120,230,255,0.05)';
    c.lineWidth = 1;
    for (let y = 0; y < h; y += 3) {
      c.beginPath();
      c.moveTo(0, y + 0.5);
      c.lineTo(w, y + 0.5);
      c.stroke();
    }
  }

  /** Energy (left) and shield (right) strips fill outward from the centre, plus centre readouts. */
  private drawStrips(game: Game) {
    const p = game.player;
    const strip = (s: Screen, frac: number, inner: string, outer: string, rightSide: boolean) => {
      const c = s.ctx;
      const { width: w, height: h } = s.canvas;
      c.fillStyle = '#05090c';
      c.fillRect(0, 0, w, h);
      const segs = 32;
      const sw = w / segs;
      const n = Math.round(frac * segs);
      const grd = c.createLinearGradient(rightSide ? 0 : w, 0, rightSide ? w : 0, 0);
      grd.addColorStop(0, inner);
      grd.addColorStop(1, outer);
      c.fillStyle = grd;
      for (let i = 0; i < n; i++) {
        const idx = rightSide ? i : segs - 1 - i;
        c.fillRect(idx * sw + 1.5, 6, sw - 3, h - 12);
      }
      s.tex.needsUpdate = true;
    };
    strip(this.energyBar, p.energy / PLAYER.energy, '#ffc04d', '#e8650f', false);
    const shieldLow = p.shield < PLAYER.shield * 0.25;
    strip(this.shieldBar, p.shield / PLAYER.shield, shieldLow ? '#ff9a7a' : '#6fd0ff', shieldLow ? RED : '#1f7fe0', true);

    const s = this.readout;
    const c = s.ctx;
    const { width: w, height: h } = s.canvas;
    this.bg(c, w, h, '#05090c');
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 34px ${MONO}`;
    c.fillStyle = '#ffd28a';
    c.fillText(String(Math.round(p.energy)), w / 2 - 38, h / 2);
    c.fillStyle = shieldLow ? RED : '#bff4ff';
    c.fillText(String(Math.round(p.shield)), w / 2 + 38, h / 2);
    c.fillStyle = CYAN_DIM;
    c.fillRect(w / 2 - 1, 18, 2, h - 36);
    c.textAlign = 'left';
    s.tex.needsUpdate = true;
  }

  private drawPrimary(game: Game) {
    const s = this.primary;
    const c = s.ctx;
    const { width: w, height: h } = s.canvas;
    const p = game.player;
    this.bg(c, w, h);
    // Twin-cannon glyph.
    c.save();
    c.translate(68, h / 2 + 14);
    c.strokeStyle = CYAN;
    c.fillStyle = 'rgba(127,232,255,0.15)';
    c.lineWidth = 2;
    for (const dx of [-16, 16]) {
      c.beginPath();
      c.rect(dx - 6, -60, 12, 80);
      c.fill();
      c.stroke();
      c.beginPath();
      c.rect(dx - 9, -66, 18, 8);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(-34, 20);
    c.lineTo(34, 20);
    c.lineTo(26, 44);
    c.lineTo(-26, 44);
    c.closePath();
    c.fill();
    c.stroke();
    if (this.flash > 0.3) {
      c.fillStyle = `rgba(191,244,255,${this.flash})`;
      c.beginPath();
      c.arc(p.gunSide > 0 ? 16 : -16, -72, 9, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();

    c.textBaseline = 'middle';
    c.fillStyle = CYAN_DIM;
    c.font = `600 14px ${MONO}`;
    c.fillText('PRIMARY', 140, 24);
    c.fillStyle = '#9cff8a';
    c.font = `700 24px ${MONO}`;
    c.fillText('PULSE', 140, 52);
    c.fillText('CANNON', 140, 78);
    c.fillStyle = '#e9fbff';
    c.font = `700 30px ${MONO}`;
    c.fillText('∞', 140, 112);
    c.font = `600 14px ${MONO}`;
    c.fillStyle = CYAN_DIM;
    c.fillText('CHARGE', 172, 114);
    const heat = this.heat;
    c.strokeStyle = CYAN_DIM;
    c.strokeRect(140, 138, 160, 14);
    c.fillStyle = heat > 0.8 ? RED : heat > 0.5 ? AMBER : CYAN;
    c.fillRect(142, 140, 156 * heat, 10);
    c.fillStyle = CYAN_DIM;
    c.fillText('HEAT', 140, 166);
    s.tex.needsUpdate = true;
  }

  private drawSecondary(game: Game, nav: NavInfo) {
    const s = this.secondary;
    const c = s.ctx;
    const { width: w } = s.canvas;
    const p = game.player;
    this.bg(c, w, s.canvas.height);
    c.textBaseline = 'middle';
    c.font = `600 14px ${MONO}`;
    c.fillStyle = CYAN_DIM;
    c.fillText('SECONDARY', 16, 24);
    c.font = `700 22px ${MONO}`;
    c.fillStyle = 'rgba(255,179,71,0.6)';
    c.fillText('NO ORDNANCE', 16, 52);
    c.strokeStyle = 'rgba(255,179,71,0.35)';
    c.setLineDash([4, 4]);
    c.strokeRect(w - 58, 12, 40, 62);
    c.setLineDash([]);

    c.strokeStyle = CYAN_DIM;
    c.beginPath();
    c.moveTo(16, 88);
    c.lineTo(w - 16, 88);
    c.stroke();
    const spd = Math.round(p.vel.length());
    c.font = `700 30px ${MONO}`;
    c.fillStyle = p.cruising ? '#ffd25f' : '#bff4ff';
    c.fillText(String(spd), 16, 114);
    c.font = `600 14px ${MONO}`;
    c.fillStyle = CYAN;
    c.fillText(`M/S  ${p.cruising ? 'CRUISE' : p.boosting ? 'BOOST' : ''}`, 90, 118);
    const alt = nav.altitude < 3000 && nav.zone !== 'mine' ? `  ALT ${Math.max(0, Math.round(nav.altitude))}` : '';
    c.fillText(`${nav.zone.toUpperCase()}${alt}`, 16, 142);
    const wp = nav.waypoints[0];
    if (wp) {
      const d = wp.pos.distanceTo(this.camera.position);
      c.fillStyle = '#ffcf7a';
      c.fillText(`${wp.label} ${d >= 1000 ? (d / 1000).toFixed(1) + ' KM' : Math.round(d) + ' M'}`, 16, 166);
    } else if (p.cruiseNote) {
      c.fillStyle = 'rgba(255,207,122,0.7)';
      c.fillText(`CRUISE: ${p.cruiseNote}`, 16, 166);
    }
    s.tex.needsUpdate = true;
  }

  /** Round centre display: radar sweep, with our ship's silhouette in the middle inside its shield bubble. */
  private drawStatus(game: Game, nav: NavInfo) {
    const s = this.status;
    const c = s.ctx;
    // Drawn in a 256x256 logical space on a 512x512 canvas (crisp on the curved screen).
    const scale = s.canvas.width / 256;
    c.setTransform(scale, 0, 0, scale, 0, 0);
    const w = 256;
    const h = 256;
    const p = game.player;
    const cx = w / 2;
    const cy = h / 2;
    const R = w / 2 - 6;
    this.bg(c, w, h, '#020d14');

    c.strokeStyle = 'rgba(127,232,255,0.65)';
    c.lineWidth = 2;
    for (const r of [R * 0.92, R * 0.66]) {
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.stroke();
    }
    // Bearing ticks around the rim, longer every 45°.
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const l = i % 9 === 0 ? 12 : i % 3 === 0 ? 7 : 4;
      c.globalAlpha = i % 9 === 0 ? 0.8 : 0.45;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92);
      c.lineTo(cx + Math.cos(a) * (R * 0.92 - l), cy + Math.sin(a) * (R * 0.92 - l));
      c.stroke();
    }
    c.globalAlpha = 1;
    const sweep = (this.time * 1.6) % (Math.PI * 2);
    const grd = c.createConicGradient?.(sweep, cx, cy);
    if (grd) {
      grd.addColorStop(0, 'rgba(127,232,255,0.4)');
      grd.addColorStop(0.12, 'rgba(127,232,255,0)');
      grd.addColorStop(1, 'rgba(127,232,255,0)');
      c.fillStyle = grd;
      c.beginPath();
      c.arc(cx, cy, R, 0, Math.PI * 2);
      c.fill();
    }

    // Shield bubble: arc length and brightness follow shield strength; flashes when hit.
    const sh = p.shield / PLAYER.shield;
    const hit = this.hurt;
    c.lineWidth = 6;
    c.strokeStyle = `rgba(${Math.round(90 + hit * 165)},${Math.round(200 - hit * 80)},255,${0.25 + sh * 0.7})`;
    c.beginPath();
    c.arc(cx, cy, R * 0.42, -Math.PI / 2 - Math.PI * sh, -Math.PI / 2 + Math.PI * sh);
    c.stroke();

    // Ship silhouette (top-down), green -> amber -> red with hull damage.
    const hull = p.hull / PLAYER.hull;
    const col = hull > 0.6 ? '#9cff8a' : hull > 0.3 ? AMBER : RED;
    c.save();
    c.translate(cx, cy + 4);
    c.fillStyle = col;
    c.globalAlpha = hull < 0.3 && Math.sin(this.time * 9) > 0 ? 0.45 : 0.9;
    c.beginPath();
    c.moveTo(0, -34);
    c.lineTo(7, -12);
    c.lineTo(30, 10);
    c.lineTo(30, 18);
    c.lineTo(9, 12);
    c.lineTo(6, 24);
    c.lineTo(-6, 24);
    c.lineTo(-9, 12);
    c.lineTo(-30, 18);
    c.lineTo(-30, 10);
    c.lineTo(-7, -12);
    c.closePath();
    c.fill();
    c.globalAlpha = 1;
    c.fillStyle = '#02101a';
    c.fillRect(-3, -18, 6, 10);
    c.restore();

    // Contacts: forward is up; stems show height above/below our plane.
    const cam = this.camera;
    cam.updateMatrixWorld();
    const plot = (pos: THREE.Vector3, color: string, size: number, diamond: boolean) => {
      _v.copy(pos).applyMatrix4(cam.matrixWorldInverse);
      let x = _v.x / RADAR_RANGE;
      let y = _v.z / RADAR_RANGE;
      const elev = _v.y / RADAR_RANGE;
      const d = Math.hypot(x, y);
      if (d > 1) {
        x /= d;
        y /= d;
      }
      const px = cx + x * R * 0.95;
      const py = cy + y * R * 0.95;
      const ey = py - THREE.MathUtils.clamp(elev, -1, 1) * R * 0.4;
      c.strokeStyle = color;
      c.lineWidth = 1.5;
      c.globalAlpha = 0.55;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px, ey);
      c.stroke();
      c.globalAlpha = 1;
      c.fillStyle = color;
      c.shadowColor = color;
      c.shadowBlur = 8;
      if (diamond) {
        c.beginPath();
        c.moveTo(px, ey - size);
        c.lineTo(px + size, ey);
        c.lineTo(px, ey + size);
        c.lineTo(px - size, ey);
        c.closePath();
        c.fill();
      } else c.fillRect(px - size / 2, ey - size / 2, size, size);
      c.shadowBlur = 0;
    };
    for (const wp of nav.waypoints) plot(wp.pos, '#ffb02e', 7, true);
    for (const e of game.tracked) plot(e.mesh.position, e.hitFlash > 0.3 ? '#ffffff' : '#ff5a3c', 9, false);

    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 18px ${MONO}`;
    c.fillStyle = col;
    c.fillText(`HULL ${Math.round(hull * 100)}%`, cx, cy + 56);
    c.textAlign = 'left';

    // CRT face: darker, slightly cooler toward the curved edge, and a faint inner reflection ring.
    const edge = c.createRadialGradient(cx, cy, R * 0.55, cx, cy, R + 6);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(0.8, 'rgba(0,8,14,0.15)');
    edge.addColorStop(1, 'rgba(0,4,8,0.6)');
    c.fillStyle = edge;
    c.fillRect(0, 0, w, h);
    c.setTransform(1, 0, 0, 1, 0, 0);
    s.tex.needsUpdate = true;
  }

  private drawLock(game: Game) {
    const s = this.lock;
    const c = s.ctx;
    const { width: w, height: h } = s.canvas;
    const locked = game.state === 'playing' && game.enemyUnderCrosshair();
    c.fillStyle = locked ? (Math.sin(this.time * 16) > 0 ? '#ff4a30' : '#7a1a10') : '#0a0d10';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = locked ? '#ffd0c0' : 'rgba(255,90,60,0.25)';
    c.lineWidth = 3;
    c.strokeRect(4, 4, w - 8, h - 8);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `800 34px ${MONO}`;
    c.fillStyle = locked ? '#fff2ea' : 'rgba(255,90,60,0.3)';
    c.fillText('LOCK', w / 2, h / 2 + 2);
    c.textAlign = 'left';
    s.tex.needsUpdate = true;
  }
}
