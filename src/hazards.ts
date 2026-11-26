import * as THREE from 'three';
import { Enemy, rand, type EnemyCtx } from './enemies/base';
import { additive, box, cannon, glow, gunMetal, hdr, mesh, metal, place, tube, type Model } from './enemies/models';
import type { Mine } from './mine';

// Static mine hazards (wall turrets, proximity mines) and the reactor, plus the objective that ties
// them together: destroy the reactor, then get out of the mine before it blows.

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

// ---------- Models ----------
const T = {
  base: new THREE.CylinderGeometry(1.7, 2, 0.6, 10).translate(0, 0.3, 0),
  collar: new THREE.CylinderGeometry(1.05, 1.3, 0.7, 10).translate(0, 0.95, 0),
  dome: new THREE.SphereGeometry(1.05, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6),
  gun: cannon(0.42, 1.1, 0.13, 1.6),
  eye: new THREE.SphereGeometry(0.28, 10, 8),
  eyeMat: glow(hdr(5, 0.7, 0.35)),
  muzzleMat: glow(hdr(4, 1, 0.5)),
};

function turretModel(): Model {
  const root = new THREE.Group();
  const body = metal(0x5a606b, 0.6, 0.4);
  body.flatShading = false;
  mesh(T.base, body, root);
  mesh(T.collar, gunMetal, root);
  const head = new THREE.Group();
  head.position.y = 1.35;
  root.add(head);
  mesh(T.dome, body, head).rotation.x = Math.PI / 2; // dome faces +z, the aim direction
  place(T.gun, gunMetal, head, 0.5, 0, 0.4);
  place(T.gun, gunMetal, head, -0.5, 0, 0.4);
  place(T.eye, T.eyeMat, head, 0, 0.35, 0.85);
  return { root, body, parts: { head } };
}

const M = {
  core: new THREE.IcosahedronGeometry(0.95, 1),
  spike: new THREE.ConeGeometry(0.22, 0.9, 6).translate(0, 1.2, 0),
  band: new THREE.TorusGeometry(1.0, 0.09, 6, 20),
};

function mineModel(): Model {
  const root = new THREE.Group();
  const body = metal(0x5b3a36, 0.5, 0.5);
  mesh(M.core, body, root);
  const dirs = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    [0.7, 0.7, 0], [-0.7, -0.7, 0], [0, 0.7, 0.7], [0, -0.7, -0.7],
  ];
  for (const d of dirs) {
    const s = mesh(M.spike, gunMetal, root);
    s.quaternion.setFromUnitVectors(Y, new THREE.Vector3(d[0], d[1], d[2]).normalize());
  }
  const lightMat = glow(hdr(3, 0.5, 0.2));
  const band = mesh(M.band, lightMat, root);
  band.rotation.x = Math.PI / 2;
  return { root, body, parts: { band } };
}

const R = {
  pedestal: new THREE.CylinderGeometry(5.5, 7, 3, 12).translate(0, -9.5, 0),
  cap: new THREE.CylinderGeometry(4, 5.5, 2.4, 12).translate(0, 9.2, 0),
  pillar: box(1.1, 17, 1.1),
  core: new THREE.IcosahedronGeometry(3, 3),
  halo: new THREE.SphereGeometry(4.6, 20, 14),
  ring: new THREE.TorusGeometry(5.2, 0.28, 8, 40),
  conduit: tube(0.5, 9, 0, 8),
};

function reactorModel(): Model {
  const root = new THREE.Group();
  const body = metal(0x3d434d, 0.7, 0.35);
  body.flatShading = false;
  mesh(R.pedestal, body, root);
  mesh(R.cap, body, root);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    place(R.pillar, gunMetal, root, Math.cos(a) * 6, 0, Math.sin(a) * 6);
    // Conduits running from the pillars into the floor.
    const c = place(R.conduit, gunMetal, root, Math.cos(a) * 6, -10, Math.sin(a) * 6);
    c.lookAt(Math.cos(a) * 16, -14, Math.sin(a) * 16);
  }
  const core = mesh(R.core, glow(hdr(6, 3.2, 1.1)), root);
  const halo = mesh(R.halo, additive(hdr(2.5, 1.1, 0.3), 0.35), root);
  const ringMat = glow(hdr(0.6, 2.8, 4));
  const ringA = mesh(R.ring, ringMat, root);
  const ringB = mesh(R.ring, ringMat, root);
  ringB.rotation.x = Math.PI / 2;
  return { root, body, parts: { core, halo, ringA, ringB } };
}

// ---------- Wall turret ----------
export class Turret extends Enemy {
  readonly kind = 'turret';
  private burst = 0;
  private burstTimer = 0;
  private barrel = 1;
  private idlePhase = Math.random() * 10;

  /** `normal` is the world-space direction pointing out of the wall it is bolted to. */
  constructor(pos: THREE.Vector3, normal: THREE.Vector3) {
    super(turretModel(), pos, 45, 2.1, 'mine');
    this.isStatic = true;
    this.score = 60;
    this.sightRange = 120;
    this.mesh.quaternion.setFromUnitVectors(Y, normal);
    this.mesh.rotateY(Math.random() * Math.PI * 2);
  }

  protected think(ctx: EnemyCtx, dt: number) {
    const head = this.parts.head;
    if (!this.sees && this.unseenFor > 2) {
      // Idle: slow scan.
      head.rotation.set(Math.sin(ctx.time * 0.4 + this.idlePhase) * 0.5 - 0.3, Math.sin(ctx.time * 0.27 + this.idlePhase) * 1.2, 0);
      this.burst = 0;
      return;
    }
    // Track the player's last known position, limited turn rate.
    this.mesh.updateMatrixWorld();
    _q0.copy(head.quaternion);
    head.lookAt(this.target(ctx));
    _q1.copy(head.quaternion);
    head.quaternion.copy(_q0).rotateTowards(_q1, 2.4 * dt);

    this.cooldown -= dt;
    this.burstTimer -= dt;
    if (!this.sees) return;
    const fwd = _a.set(0, 0, 1).transformDirection(head.matrixWorld);
    const to = _b.subVectors(ctx.player.pos, this.pos).normalize();
    if (this.burst === 0 && this.cooldown <= 0 && fwd.angleTo(to) < 0.2) {
      this.burst = 3;
      this.cooldown = rand(1.3, 2.1) / ctx.aggression;
    }
    if (this.burst > 0 && this.burstTimer <= 0) {
      this.burst--;
      this.burstTimer = 0.13;
      this.barrel *= -1;
      const from = head.localToWorld(new THREE.Vector3(0.5 * this.barrel, 0, 2.7));
      const dist = from.distanceTo(ctx.player.pos);
      const aim = _a.copy(ctx.player.pos).addScaledVector(ctx.player.vel, (dist / 110) * rand(0.4, 0.9));
      ctx.fire(from, aim.sub(from).normalize().clone(), { speed: 110, dmg: 6, color: 'red' });
      ctx.sfx.enemyShot(from);
    }
  }
}

// ---------- Proximity mine ----------
const ARM_RANGE = 15;
const BLAST_RADIUS = 15;

export class ProxMine extends Enemy {
  readonly kind = 'proxmine';
  private home = new THREE.Vector3();
  private up: THREE.Vector3;
  private armed = -1;
  private beep = 0;
  private bandMat: THREE.MeshBasicMaterial;

  constructor(pos: THREE.Vector3, up: THREE.Vector3) {
    super(mineModel(), pos, 12, 1.5, 'mine');
    this.isStatic = true;
    this.score = 25;
    this.sightRange = 45;
    this.home.copy(pos);
    this.up = up.clone();
    this.bandMat = (this.parts.band as THREE.Mesh).material as THREE.MeshBasicMaterial;
  }

  protected think(ctx: EnemyCtx, dt: number) {
    const t = ctx.time + this.seed;
    this.pos.copy(this.home).addScaledVector(this.up, Math.sin(t * 1.3) * 0.35);
    this.mesh.rotation.y += dt * 0.6;
    this.mesh.rotation.x += dt * 0.25;

    const d = this.pos.distanceTo(ctx.player.pos);
    if (this.armed < 0) {
      const blink = Math.sin(t * 3) > 0.6 ? 1 : 0.25;
      this.bandMat.color.setRGB(3 * blink, 0.5 * blink, 0.2 * blink);
      if (d < ARM_RANGE && ctx.inMine && this.sees) {
        this.armed = 0.85;
        this.awake = true;
      }
      return;
    }
    // Armed: fast beeping, then detonate.
    this.armed -= dt;
    this.beep -= dt;
    const on = Math.sin(ctx.time * 40) > 0;
    this.bandMat.color.setRGB(on ? 6 : 1, on ? 1.5 : 0.2, on ? 0.6 : 0.1);
    if (this.beep <= 0) {
      this.beep = 0.14;
      ctx.sfx.lockOn(this.pos, 1 - Math.max(0, this.armed) / 0.85);
    }
    if (this.armed <= 0) this.hp = 0; // the game removes it and onDeath detonates
  }

  onDeath(ctx: EnemyCtx) {
    ctx.blast(this.pos.clone(), BLAST_RADIUS, 38, this);
    ctx.sfx.explode(false, this.pos);
  }
}

// ---------- Reactor ----------
export class Reactor extends Enemy {
  readonly kind = 'reactor';
  private volley = 3;
  private pulse = 5;
  private announced = 4;

  constructor(pos: THREE.Vector3, up: THREE.Vector3, private onDestroyed: () => void) {
    super(reactorModel(), pos, 520, 5, 'mine');
    this.isStatic = true;
    this.score = 2000;
    this.sightRange = 90;
    this.mesh.quaternion.setFromUnitVectors(Y, up);
  }

  hitTest(a: THREE.Vector3, b: THREE.Vector3) {
    // The core and its cage; the pedestal and cap are covered by the wall-bolt sparks.
    return super.hitTest(a, b);
  }

  takeHit(dmg: number, from: THREE.Vector3, at: THREE.Vector3, ctx: EnemyCtx) {
    const done = super.takeHit(dmg, from, at, ctx);
    ctx.alert(this.pos, 160);
    const quarter = Math.ceil((this.hp / this.maxHp) * 4);
    if (quarter < this.announced && this.hp > 0) {
      this.announced = quarter;
      ctx.message(`REACTOR INTEGRITY ${quarter * 25}%`, quarter <= 1 ? 'Core is unstable' : '', 1.6);
    }
    return done;
  }

  protected think(ctx: EnemyCtx, dt: number) {
    const health = this.hp / this.maxHp;
    const rate = 1 + (1 - health) * 3;
    const t = ctx.time;
    const s = 1 + Math.sin(t * 2.4 * rate) * 0.06 * rate;
    this.parts.core.scale.setScalar(s);
    this.parts.halo.scale.setScalar(1 + Math.sin(t * 2.4 * rate + 1) * 0.08);
    this.parts.ringA.rotation.z += dt * 0.8 * rate;
    this.parts.ringB.rotation.y += dt * 0.55 * rate;

    if (!this.sees || !ctx.inMine) return;
    // Defensive volleys: a fan of slow plasma toward the player.
    this.volley -= dt * ctx.aggression;
    if (this.volley <= 0) {
      this.volley = rand(2.6, 3.6) - (1 - health);
      const to = _a.subVectors(ctx.player.pos, this.pos).normalize();
      const side = _b.crossVectors(to, ctx.mineUp).normalize();
      const n = 5 + Math.round((1 - health) * 4);
      for (let i = 0; i < n; i++) {
        const k = n === 1 ? 0 : i / (n - 1) - 0.5;
        const dir = to.clone().addScaledVector(side, k * 0.7).add(new THREE.Vector3(rand(-0.05, 0.05), rand(-0.05, 0.05), rand(-0.05, 0.05))).normalize();
        ctx.fire(this.pos.clone().addScaledVector(dir, 5.5), dir, { speed: 60, dmg: 7, color: 'orange', size: 1.6, life: 4 });
      }
      ctx.sfx.charge(this.pos);
    }
    // Once damaged, it lashes out at anything too close.
    if (health < 0.6) {
      this.pulse -= dt;
      if (this.pulse <= 0 && this.pos.distanceTo(ctx.player.pos) < 20) {
        this.pulse = 4.5;
        ctx.blast(this.pos.clone(), 18, 22, this);
      }
    }
  }

  onDeath(ctx: EnemyCtx) {
    ctx.explode(this.pos.clone(), 4);
    ctx.sfx.explode(true, this.pos);
    this.onDestroyed();
  }
}

// ---------- Placement ----------
/**
 * Build the mine's static hazards from its layout. Turrets go on walls and corridor ceilings,
 * mines in corridors off the centre line; room centres are left to the roaming enemies.
 */
export function placeHazards(mine: Mine, onReactorDestroyed: () => void): { list: Enemy[]; reactor: Reactor | null } {
  const list: Enemy[] = [];
  const toWorld = (l: THREE.Vector3) => l.clone().applyMatrix4(mine.frame);
  const dirWorld = (l: THREE.Vector3) => l.clone().transformDirection(mine.frame);
  const up = dirWorld(Y);
  const entrance = new THREE.Vector3(0, -mine.shaftDepth, 0);

  /** Try to bolt a turret to the wall at local point p, facing local normal n. */
  const mount = (p: THREE.Vector3, n: THREE.Vector3) => {
    if (mine.openAt(_a.copy(p).addScaledVector(n, -1))) return false; // opening, not a wall
    if (!mine.openAt(_a.copy(p).addScaledVector(n, 1.5))) return false;
    list.push(new Turret(toWorld(p), dirWorld(n)));
    return true;
  };

  let reactor: Reactor | null = null;
  const chamber = mine.reactorRoom;
  for (const room of mine.rooms) {
    const b = room.box;
    if (room.depth === 0) continue; // the hub is a safe landing
    const midY = THREE.MathUtils.lerp(b.min.y, b.max.y, 0.55);
    const walls: [THREE.Vector3, THREE.Vector3][] = [
      [new THREE.Vector3(b.min.x, midY, room.center.z), new THREE.Vector3(1, 0, 0)],
      [new THREE.Vector3(b.max.x, midY, room.center.z), new THREE.Vector3(-1, 0, 0)],
      [new THREE.Vector3(room.center.x, midY, b.min.z), new THREE.Vector3(0, 0, 1)],
      [new THREE.Vector3(room.center.x, midY, b.max.z), new THREE.Vector3(0, 0, -1)],
    ];
    if (room === chamber) {
      for (const [p, n] of walls) mount(p, n) || mount(p.clone().add(new THREE.Vector3(n.z, 0, n.x).multiplyScalar(12)), n);
      reactor = new Reactor(toWorld(room.center), up, onReactorDestroyed);
      list.push(reactor);
      continue;
    }
    if (room.depth >= 2 && Math.random() < 0.7) {
      const [p, n] = walls[Math.floor(Math.random() * 4)];
      mount(p.clone().add(new THREE.Vector3(n.z, 0, n.x).multiplyScalar(rand(-8, 8))), n);
    }
  }

  for (const c of mine.boxes) {
    if (c.kind !== 'corridor') continue;
    const size = _b.subVectors(c.max, c.min);
    const axis = size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z';
    const len = size[axis];
    const mid = new THREE.Vector3().addVectors(c.min, c.max).multiplyScalar(0.5);
    // Ceiling turret (or a side-wall one in a vertical shaft) on long runs.
    if (len >= 36 && Math.random() < 0.75) {
      const p = mid.clone();
      p[axis] = THREE.MathUtils.lerp(c.min[axis], c.max[axis], rand(0.3, 0.7));
      if (axis === 'y') mount(p.setX(c.min.x), new THREE.Vector3(1, 0, 0));
      else mount(p.setY(c.max.y), new THREE.Vector3(0, -1, 0));
    }
    // Mines, off the centre line, not too near the bottom of the entrance shaft.
    const count = Math.floor(len / 28);
    for (let i = 0; i < count; i++) {
      const p = mid.clone();
      p[axis] = THREE.MathUtils.lerp(c.min[axis], c.max[axis], rand(0.2, 0.8));
      for (const k of ['x', 'y', 'z'] as const) if (k !== axis) p[k] += rand(-4, 4);
      if (p.distanceTo(entrance) < 45) continue;
      list.push(new ProxMine(toWorld(p), up));
    }
  }
  return { list, reactor };
}

// ---------- Objective ----------
export type ObjectiveState = 'intact' | 'meltdown' | 'escaped' | 'failed';

export interface ObjectiveHost {
  message(text: string, sub?: string, seconds?: number): void;
  setObjective(text: string, urgent?: boolean): void;
  alarm(): void;
  explode(at: THREE.Vector3, scale: number): void;
  shake(amount: number): void;
  killPlayer(): void;
  addScore(n: number): void;
  chime(): void;
}

/** Destroy the reactor, then escape to the surface before the countdown ends. */
export class MineObjective {
  state: ObjectiveState = 'intact';
  timeLeft = 0;
  reactor: Reactor | null = null;
  private tick = 0;
  private rumble = 0;

  constructor(private mine: Mine, private host: ObjectiveHost) {}

  /** Fresh hazards for a new run. */
  populate(): Enemy[] {
    this.state = 'intact';
    this.timeLeft = 0;
    this.mine.alarm = 0;
    this.mine.setCleared(false);
    const { list, reactor } = placeHazards(this.mine, () => this.meltdown());
    this.reactor = reactor;
    return list;
  }

  private meltdown() {
    if (this.state !== 'intact' || !this.reactor) return;
    this.state = 'meltdown';
    // Enough time to retrace the route at cruising speed through the tunnels, with some slack.
    const dist = this.reactor.pos.distanceTo(this.mine.entrance);
    this.timeLeft = Math.round(35 + dist / 9);
    this.mine.alarm = 1;
    this.host.message('REACTOR DESTROYED', `Meltdown in ${this.timeLeft} s. Get to the surface!`, 3.5);
    this.host.addScore(1500);
  }

  /** `inMine`: player is below the surface in the tunnels; `altitude`: metres above the terrain. */
  update(dt: number, playing: boolean, inMine: boolean, altitude: number, playerPos: THREE.Vector3) {
    if (!playing) return;
    if (this.state === 'intact') {
      this.host.setObjective(inMine ? 'DESTROY THE REACTOR' : '');
      return;
    }
    if (this.state !== 'meltdown') {
      this.host.setObjective('');
      return;
    }
    this.timeLeft -= dt;
    this.tick -= dt;
    this.rumble -= dt;
    if (this.tick <= 0) {
      this.tick = this.timeLeft < 10 ? 0.5 : 1;
      this.host.alarm();
    }
    if (inMine && this.rumble <= 0) {
      this.rumble = rand(1.5, 3.5) * Math.max(0.3, this.timeLeft / 40);
      this.host.shake(0.6);
    }
    this.host.setObjective(`MELTDOWN ${Math.max(0, this.timeLeft).toFixed(1)}  ESCAPE TO THE SURFACE`, true);

    if (!inMine && altitude > 40) {
      this.state = 'escaped';
      this.mine.alarm = 0;
      this.mine.setCleared();
      const bonus = 1000 + Math.round(this.timeLeft * 25);
      this.host.addScore(bonus);
      this.host.explode(this.mine.entrance.clone(), 6);
      this.host.shake(1.5);
      this.host.message('MINE CLEARED', `Escape bonus +${bonus}`, 4);
      this.host.chime();
      return;
    }
    if (this.timeLeft <= 0) {
      this.state = 'failed';
      this.mine.alarm = 0;
      this.host.explode(playerPos.clone(), 5);
      this.host.killPlayer();
    }
  }
}
