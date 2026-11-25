import * as THREE from 'three';
import { GUN_OFFSET, PLAYER, type Game } from './game';
import type { NavInfo } from './hud';

// A 3D cockpit attached to the camera: canopy frame, dashboard with three live screens
// (systems, radar, nav), gun pods, and inertia so it sways against the ship's motion.
// Built from primitives so it costs a handful of draw calls; screens redraw at ~15 Hz.

// Layout reference: 16:9 at 75° vertical FOV (visible half-size at 1 m: 1.36 x 0.77).
const REF_HALF_W = 1.364;
const REF_HALF_H = 0.767;
const RADAR_RANGE = 450;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function strut(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, mat: THREE.Material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v.subVectors(b, a).normalize());
  return m;
}

class Screen {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshBasicMaterial;

  constructor(w: number, h: number, px: number, py: number) {
    this.canvas.width = px;
    this.canvas.height = py;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, color: new THREE.Color(1.35, 1.35, 1.35), toneMapped: true, fog: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.mat);
  }
}

export class Cockpit {
  readonly root = new THREE.Group();
  private sway = new THREE.Group();
  private frame = new THREE.Group();
  private metal: THREE.MeshStandardMaterial;
  private dark: THREE.MeshStandardMaterial;
  private accent: THREE.MeshBasicMaterial;
  private warnLamp: THREE.MeshBasicMaterial;
  private muzzles: THREE.Mesh[] = [];
  private sys: Screen;
  private radar: Screen;
  private nav: Screen;
  private redraw = 0;
  private flash = 0;
  private hurt = 0;
  private flicker = 0;
  private lastQuat = new THREE.Quaternion();
  private lastVel = new THREE.Vector3();
  private swayPos = new THREE.Vector3();
  private swayRot = new THREE.Vector3();
  private time = 0;
  enabled = true;

  constructor(private camera: THREE.PerspectiveCamera) {
    this.metal = new THREE.MeshStandardMaterial({ color: 0x3a404a, metalness: 0.75, roughness: 0.38, emissive: 0x06080c, envMapIntensity: 1.6, fog: false });
    this.dark = new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.35, roughness: 0.75, emissive: 0x040507, fog: false });
    this.accent = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.8, 1.0), fog: false });
    this.warnLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.05, 0.03), fog: false });

    const g = this.sway;
    this.root.add(g);
    camera.add(this.root);

    // ---- Dashboard: a slab tilted back toward the pilot, with a glare shield on top.
    const dashTilt = -0.6;
    const panel = new THREE.Group();
    panel.position.set(0, -0.575, -0.87);
    panel.rotation.x = dashTilt;
    g.add(panel);
    const face = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 0.05), this.dark);
    panel.add(face);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.03, 0.09), this.metal);
    bezel.position.set(0, 0.2, 0.01);
    panel.add(bezel);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.006, 0.006), this.accent);
    lip.position.set(0, 0.208, 0.058);
    panel.add(lip);

    // Screens sit just proud of the dash face.
    this.sys = new Screen(0.36, 0.24, 300, 200);
    this.radar = new Screen(0.3, 0.3, 256, 256);
    this.nav = new Screen(0.36, 0.24, 300, 200);
    this.sys.mesh.position.set(-0.46, 0.035, 0.03);
    this.radar.mesh.position.set(0, 0.01, 0.03);
    this.nav.mesh.position.set(0.46, 0.035, 0.03);
    panel.add(this.sys.mesh, this.radar.mesh, this.nav.mesh);
    // Screen housings.
    for (const s of [this.sys, this.radar, this.nav]) {
      const geo = s.mesh.geometry as THREE.PlaneGeometry;
      const { width, height } = geo.parameters;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.03, height + 0.03, 0.03), this.metal);
      frame.position.copy(s.mesh.position).setZ(0.012);
      frame.rotation.copy(s.mesh.rotation);
      panel.add(frame);
    }
    // Warning lamp and a row of small indicator lights.
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.02), this.warnLamp);
    lamp.position.set(0, 0.17, 0.035);
    panel.add(lamp);
    const dot = new THREE.BoxGeometry(0.018, 0.012, 0.01);
    for (let i = 0; i < 8; i++) {
      const c = i % 3 === 0 ? new THREE.Color(2, 1.2, 0.2) : new THREE.Color(0.2, 1.2, 0.5);
      const m = new THREE.Mesh(dot, new THREE.MeshBasicMaterial({ color: c.multiplyScalar(0.6), fog: false }));
      m.position.set(-0.98 + i * 0.035, 0.1, 0.03);
      panel.add(m);
      const m2 = m.clone();
      m2.position.x = 0.73 + i * 0.035;
      panel.add(m2);
    }

    // ---- Side consoles running back from the dash.
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.1), this.dark);
      side.position.set(sx * 1.05, -0.62, -0.5);
      side.rotation.z = sx * 0.35;
      g.add(side);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 1.2), this.metal);
      rail.position.set(sx * 0.84, -0.53, -0.5);
      rail.rotation.z = sx * 0.35;
      g.add(rail);
    }

    // ---- Canopy frame: A-pillars from the dash corners up over the head, a top bow, side sills.
    g.add(this.frame);
    const pillarA = (sx: number) => [new THREE.Vector3(sx * 1.18, -0.47, -1.05), new THREE.Vector3(sx * 0.62, 0.66, -0.7)] as const;
    for (const sx of [-1, 1]) {
      const [a, b] = pillarA(sx);
      this.frame.add(strut(a, b, 0.07, 0.05, this.metal));
      // Thin light strip on the inner edge.
      const ia = a.clone().add(new THREE.Vector3(-sx * 0.04, 0, 0.03));
      const ib = b.clone().add(new THREE.Vector3(-sx * 0.04, 0, 0.03));
      this.frame.add(strut(ia, ib, 0.006, 0.006, this.accent));
      // Rear pillar sweeping back past the shoulders.
      this.frame.add(strut(b, new THREE.Vector3(sx * 1.0, 0.4, 0.2), 0.07, 0.05, this.metal));
      this.frame.add(strut(a, new THREE.Vector3(sx * 1.25, -0.4, 0.1), 0.06, 0.05, this.metal));
    }
    const [l] = [pillarA(-1)[1], pillarA(1)[1]];
    this.frame.add(strut(l, pillarA(1)[1], 0.07, 0.05, this.metal));
    this.frame.add(strut(new THREE.Vector3(0, 0.68, -0.7), new THREE.Vector3(0, 0.75, 0.2), 0.05, 0.04, this.metal));

    // ---- Muzzle flashes outside the canopy, where the bolts spawn (see Game.firePlayer).
    const muzzleGeo = new THREE.SphereGeometry(0.06, 8, 6);
    for (const sx of [-1, 1]) {
      const muzzle = new THREE.Mesh(
        muzzleGeo,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 5, 6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      );
      muzzle.position.copy(GUN_OFFSET).setX(sx * GUN_OFFSET.x);
      muzzle.scale.set(1, 1, 2);
      g.add(muzzle);
      this.muzzles.push(muzzle);
    }

    // The cockpit must never be clipped by world geometry or culled.
    this.root.traverse((o) => {
      o.frustumCulled = false;
      o.renderOrder = 10;
    });
  }

  setVisible(v: boolean) {
    this.enabled = v;
    this.root.visible = v;
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
    // A narrow portrait view would be mostly pillar; keep just the dash there.
    this.frame.visible = this.camera.aspect > 1;
  }

  fired(side: number) {
    this.flash = 1;
    const m = this.muzzles[side < 0 ? 0 : 1];
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
    // Engine vibration grows with thrust and boost.
    const vib = (p.boosting ? 0.0025 : 0.0006) + (p.cruising ? 0.0018 : 0);
    targetPos.x += (Math.random() - 0.5) * vib;
    targetPos.y += (Math.random() - 0.5) * vib;
    this.swayPos.lerp(targetPos, 1 - Math.exp(-8 * dt));
    this.swayRot.x += (pitchRate * 0.01 - this.swayRot.x) * (1 - Math.exp(-6 * dt));
    this.swayRot.y += (yawRate * 0.012 - this.swayRot.y) * (1 - Math.exp(-6 * dt));
    this.swayRot.z += (rollRate * 0.02 - this.swayRot.z) * (1 - Math.exp(-6 * dt));
    this.sway.position.copy(this.swayPos);
    this.sway.rotation.set(this.swayRot.x, this.swayRot.y, this.swayRot.z);

    // ---- Lighting cues.
    this.flash = Math.max(0, this.flash - dt * 12);
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    this.flicker = Math.max(0, this.flicker - dt);
    for (const m of this.muzzles) {
      const mm = m.material as THREE.MeshBasicMaterial;
      mm.opacity = Math.max(0, mm.opacity - dt * 14);
    }
    const f = this.flash;
    this.metal.emissive.setRGB(0.024 + f * 0.05 + this.hurt * 0.25, 0.03 + f * 0.17, 0.045 + f * 0.2);
    this.dark.emissive.setRGB(0.015 + f * 0.03 + this.hurt * 0.15, 0.02 + f * 0.1, 0.028 + f * 0.12);
    const low = p.hull < PLAYER.hull * 0.3;
    const blink = low && Math.sin(this.time * 9) > 0;
    this.warnLamp.color.setRGB(blink ? 6 : 0.25, blink ? 0.6 : 0.05, blink ? 0.3 : 0.03);
    const flick = this.flicker > 0 && Math.random() < 0.5 ? 0.35 : 1;
    const scr = 1.35 * flick;
    for (const s of [this.sys, this.radar, this.nav]) s.mat.color.setRGB(scr, scr, scr);

    // ---- Screens.
    this.redraw -= dt;
    if (this.redraw <= 0) {
      this.redraw = 1 / 15;
      this.drawSystems(game);
      this.drawRadar(game, nav);
      this.drawNav(game, nav);
    }
  }

  // ---------- Screen drawing ----------
  private bg(c: CanvasRenderingContext2D, w: number, h: number) {
    c.fillStyle = '#03141a';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(120,230,255,0.06)';
    c.lineWidth = 1;
    for (let y = 0; y < h; y += 3) {
      c.beginPath();
      c.moveTo(0, y + 0.5);
      c.lineTo(w, y + 0.5);
      c.stroke();
    }
  }

  private drawSystems(game: Game) {
    const s = this.sys;
    const c = s.ctx;
    const { width: w, height: h } = s.canvas;
    const p = game.player;
    this.bg(c, w, h);
    c.font = '600 18px ui-monospace, Menlo, Consolas, monospace';
    c.textBaseline = 'middle';
    const bar = (y: number, label: string, frac: number, color: string, warn = false) => {
      c.fillStyle = '#7fe8ff';
      c.fillText(label, 14, y);
      c.strokeStyle = 'rgba(127,232,255,0.5)';
      c.strokeRect(78, y - 10, w - 96, 20);
      c.fillStyle = warn && Math.sin(this.time * 10) > 0 ? '#ff4a30' : color;
      // Segmented fill.
      const segs = 20;
      const sw = (w - 100) / segs;
      const n = Math.round(frac * segs);
      for (let i = 0; i < n; i++) c.fillRect(80 + i * sw, y - 8, sw - 2, 16);
    };
    bar(36, 'SHLD', p.shield / PLAYER.shield, '#5fc8ff');
    bar(76, 'HULL', p.hull / PLAYER.hull, p.hull < 30 ? '#ff5a3c' : '#9cff8a', p.hull < 30);
    bar(116, 'BOOST', p.energy / PLAYER.energy, '#ffd25f');
    c.fillStyle = '#7fe8ff';
    c.font = '600 16px ui-monospace, Menlo, Consolas, monospace';
    const shieldState = p.shieldTimer > 0 ? 'RECHARGE WAIT' : p.shield < PLAYER.shield ? 'CHARGING' : 'ONLINE';
    c.fillText(`SHIELD ${shieldState}`, 14, 158);
    c.fillStyle = 'rgba(127,232,255,0.6)';
    c.fillText(`WAVE ${game.wave}  KILLS ${game.kills}`, 14, 184);
    s.tex.needsUpdate = true;
  }

  private drawRadar(game: Game, nav: NavInfo) {
    const s = this.radar;
    const c = s.ctx;
    const { width: w, height: h } = s.canvas;
    const cx = w / 2;
    const cy = h / 2;
    const R = w / 2 - 10;
    this.bg(c, w, h);
    // Rings and sweep.
    c.strokeStyle = 'rgba(127,232,255,0.35)';
    c.lineWidth = 1.5;
    for (const r of [R, R * 0.66, R * 0.33]) {
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(cx - R, cy);
    c.lineTo(cx + R, cy);
    c.moveTo(cx, cy - R);
    c.lineTo(cx, cy + R);
    c.stroke();
    const sweep = (this.time * 1.6) % (Math.PI * 2);
    const grd = c.createConicGradient?.(sweep, cx, cy);
    if (grd) {
      grd.addColorStop(0, 'rgba(127,232,255,0.28)');
      grd.addColorStop(0.12, 'rgba(127,232,255,0)');
      grd.addColorStop(1, 'rgba(127,232,255,0)');
      c.fillStyle = grd;
      c.beginPath();
      c.arc(cx, cy, R, 0, Math.PI * 2);
      c.fill();
    }
    // Forward view cone.
    c.strokeStyle = 'rgba(127,232,255,0.2)';
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx - R * 0.6, cy - R * 0.8);
    c.moveTo(cx, cy);
    c.lineTo(cx + R * 0.6, cy - R * 0.8);
    c.stroke();

    const cam = this.camera;
    cam.updateMatrixWorld();
    const plot = (pos: THREE.Vector3, color: string, size: number, clampEdge: boolean, diamond = false) => {
      _v.copy(pos).applyMatrix4(cam.matrixWorldInverse);
      let x = _v.x / RADAR_RANGE;
      let y = _v.z / RADAR_RANGE;
      const elev = _v.y / RADAR_RANGE;
      const d = Math.hypot(x, y);
      if (d > 1) {
        if (!clampEdge) return;
        x /= d;
        y /= d;
      }
      const px = cx + x * R;
      const py = cy + y * R;
      const ey = py - THREE.MathUtils.clamp(elev, -1, 1) * R * 0.5;
      // Elevation stem: blip floats above/below its spot on the plane.
      c.strokeStyle = color;
      c.globalAlpha = 0.55;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px, ey);
      c.stroke();
      c.globalAlpha = 1;
      c.fillStyle = color;
      if (diamond) {
        c.beginPath();
        c.moveTo(px, ey - size);
        c.lineTo(px + size, ey);
        c.lineTo(px, ey + size);
        c.lineTo(px - size, ey);
        c.closePath();
        c.fill();
      } else c.fillRect(px - size / 2, ey - size / 2, size, size);
    };
    for (const wp of nav.waypoints) plot(wp.pos, '#ffb02e', 6, true, true);
    for (const e of game.enemies) plot(e.mesh.position, e.hitFlash > 0.3 ? '#ffffff' : '#ff5a3c', 7, true);
    // Ship marker.
    c.fillStyle = '#e9fbff';
    c.beginPath();
    c.moveTo(cx, cy - 7);
    c.lineTo(cx + 5, cy + 5);
    c.lineTo(cx - 5, cy + 5);
    c.closePath();
    c.fill();
    s.tex.needsUpdate = true;
  }

  private drawNav(game: Game, nav: NavInfo) {
    const s = this.nav;
    const c = s.ctx;
    const { width: w, height: h } = s.canvas;
    const p = game.player;
    this.bg(c, w, h);
    c.textBaseline = 'middle';
    c.fillStyle = p.cruising ? '#ffd25f' : '#a8eeff';
    c.font = '700 44px ui-monospace, Menlo, Consolas, monospace';
    const spd = Math.round(p.vel.length());
    c.fillText(String(spd).padStart(3, ' '), 14, 44);
    c.font = '600 16px ui-monospace, Menlo, Consolas, monospace';
    c.fillStyle = '#7fe8ff';
    c.fillText('M/S', 120, 54);
    c.fillText(p.cruising ? 'CRUISE' : p.boosting ? 'BOOST' : 'NOMINAL', 180, 54);
    // Throttle/speed bar.
    c.strokeStyle = 'rgba(127,232,255,0.5)';
    c.strokeRect(14, 76, w - 28, 10);
    c.fillStyle = p.cruising ? '#ffd25f' : '#7fe8ff';
    c.fillRect(15, 77, (w - 30) * Math.min(1, spd / (p.cruising ? 480 : 120)), 8);
    c.fillStyle = '#7fe8ff';
    c.fillText(nav.zone.toUpperCase(), 14, 112);
    if (nav.altitude < 3000 && nav.zone !== 'mine') c.fillText(`ALT ${Math.max(0, Math.round(nav.altitude))} M`, 150, 112);
    c.fillStyle = 'rgba(127,232,255,0.6)';
    c.fillText(`SCORE ${game.score}`, 14, 144);
    const wp = nav.waypoints[0];
    if (wp) {
      const d = wp.pos.distanceTo(this.camera.position);
      c.fillStyle = '#ffcf7a';
      c.fillText(`${wp.label} ${d >= 1000 ? (d / 1000).toFixed(1) + ' KM' : Math.round(d) + ' M'}`, 14, 176);
    } else if (p.cruiseNote) {
      c.fillStyle = 'rgba(255,207,122,0.7)';
      c.fillText(`CRUISE: ${p.cruiseNote}`, 14, 176);
    }
    s.tex.needsUpdate = true;
  }
}
