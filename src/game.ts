import * as THREE from 'three';
import type { Input } from './input';
import type { Sfx } from './sfx';
import { ARENA_RADIUS, rand, randomOnSphere, type Rock } from './world';
import { Enemy, type BoltColor, type EnemyCtx, type FireOpts, type MineInfo } from './enemies/base';
import { Warden } from './enemies/fighters';
import { populateMine } from './enemies/spawn';

export type { Enemy };

/** The parts of the world beyond the asteroid field that the game needs to ask about. */
export interface WorldQuery {
  collide(pos: THREE.Vector3, radius: number): THREE.Vector3 | null;
  blocks(pos: THREE.Vector3): boolean;
  cruiseBlocked(pos: THREE.Vector3): string | null;
  /** The mine, if this world has one; its enemies are spawned from its rooms. */
  mine?: MineInfo;
}

const SECTOR_RADIUS = 14000;
/** Fights only happen near the asteroid field; drones won't follow you down to the planet. */
const LEASH_RADIUS = 900;

/** Right gun muzzle in camera space (outside the cockpit canopy); the left one mirrors x. */
export const GUN_OFFSET = new THREE.Vector3(0.95, -0.36, -1.5);

// ---------- Tuning ----------
export const PLAYER = {
  radius: 1.4,
  accel: 62,
  boostAccel: 125,
  damping: 1.1, // "flight assist": terminal speed = accel / damping
  mouseSens: 0.0021,
  stickYaw: 2.3,
  stickPitch: 1.9,
  rollRate: 1.9,
  hull: 100,
  shield: 60,
  shieldRegen: 18,
  shieldDelay: 3,
  energy: 100,
  boostDrain: 30,
  energyRegen: 18,
  fireInterval: 0.11,
  boltSpeed: 260,
  boltDamage: 10,
  boltLife: 1.1,
  convergence: 110,
  cruiseSpeed: 480,
  cruiseTurn: 0.45, // turn-rate multiplier while cruising
};

const WAVE = {
  baseHp: 30,
  hpPerWave: 6,
};

// ---------- Shared resources ----------
const geo = {
  bolt: new THREE.BoxGeometry(0.14, 0.14, 3.2),
  enemyBolt: new THREE.IcosahedronGeometry(0.55, 0),
  spark: new THREE.IcosahedronGeometry(1, 0),
};
const mat = {
  // HDR colours (>1) so bolts, eyes and thrusters bloom.
  bolt: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 3.2, 3.6), blending: THREE.AdditiveBlending, transparent: true }),
};
const boltMat = (r: number, g: number, b: number) =>
  new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), blending: THREE.AdditiveBlending, transparent: true });
const enemyBoltMat: Record<BoltColor, THREE.MeshBasicMaterial> = {
  red: boltMat(4, 0.9, 0.45),
  amber: boltMat(4, 2.6, 0.4),
  orange: boltMat(5, 1.6, 0.25),
  violet: boltMat(2.6, 0.8, 5),
  white: boltMat(4, 3.8, 3),
};

// ---------- Types ----------
interface Bolt {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  prev: THREE.Vector3;
  life: number;
  dmg: number;
  hostile: boolean;
}


interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  grow: boolean;
}

export type GameState = 'title' | 'playing' | 'paused' | 'over';

export interface GameEvents {
  message(text: string, sub?: string, seconds?: number): void;
  damaged(amount: number): void;
  gameOver(score: number, wave: number): void;
  /** Optional presentation hooks (cockpit, effects). */
  fired?(side: number): void;
  exploded?(at: THREE.Vector3, scale: number): void;
  impact?(at: THREE.Vector3): void;
  /** A new run has started (after the mine's roaming enemies are placed). */
  started?(): void;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const FORWARD = new THREE.Vector3(0, 0, -1);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const ORIGIN = new THREE.Vector3();

/** Does segment a->b pass within r of point c? */
function segmentHitsSphere(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, r: number) {
  _a.subVectors(b, a);
  const len2 = _a.lengthSq();
  let t = len2 > 0 ? _b.subVectors(c, a).dot(_a) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  _c.copy(a).addScaledVector(_a, t);
  return _c.distanceToSquared(c) <= r * r;
}

export class Game {
  state: GameState = 'title';
  wave = 0;
  score = 0;
  kills = 0;

  readonly player = {
    vel: new THREE.Vector3(),
    hull: PLAYER.hull,
    shield: PLAYER.shield,
    energy: PLAYER.energy,
    shieldTimer: 0,
    fireTimer: 0,
    gunSide: 1,
    boosting: false,
    outOfBounds: false,
    cruising: false,
    cruiseNote: '' as string,
  };

  enemies: Enemy[] = [];
  /** Enemies the HUD, radar and touch auto-fire should know about (not cloaked, not asleep in the mine). */
  tracked: Enemy[] = [];
  private ctx: EnemyCtx;
  private mineUp = new THREE.Vector3(0, 1, 0);
  private inMine = false;
  private bolts: Bolt[] = [];
  private particles: Particle[] = [];
  private waveTimer = 0;
  private shake = 0;
  private time = 0;

  constructor(
    private scene: THREE.Scene,
    readonly camera: THREE.PerspectiveCamera,
    private rocks: Rock[],
    private input: Input,
    private sfx: Sfx,
    private events: GameEvents,
    private world: WorldQuery,
  ) {
    if (world.mine) this.mineUp.set(0, 1, 0).transformDirection(world.mine.frame);
    // The view of the game that enemies get each frame.
    const g = this;
    this.ctx = {
      get time() { return g.time; },
      player: { pos: camera.position, vel: this.player.vel, radius: PLAYER.radius },
      get enemies() { return g.enemies; },
      rocks,
      world,
      sfx,
      get inMine() { return g.inMine; },
      get engaged() { return g.inCombatZone(); },
      get aggression() { return 1 + Math.max(0, g.wave - 1) * 0.12; },
      mineUp: this.mineUp,
      fire: (from, dir, o) => this.fireBolt(from, dir, o),
      hurtPlayer: (dmg) => this.damagePlayer(dmg),
      blast: (at, r, dmg, src) => this.blast(at, r, dmg, src),
      explode: (at, scale) => this.explode(at, scale),
      sparks: (at, c, n) => this.sparks(at, c, n),
      spawn: (e) => this.addEnemy(e),
      alert: (at, r) => {
        for (const e of this.enemies) if (e.habitat === 'mine' && e.pos.distanceTo(at) < r) e.alertTo(this.ctx, this.camera.position);
      },
      message: (t, sub, sec) => this.events.message(t, sub, sec),
      canSee: (a, b) => this.lineOfSight(a, b),
    };
  }

  // ---------- Lifecycle ----------
  start() {
    for (const e of this.enemies) e.dispose();
    for (const b of this.bolts) this.scene.remove(b.mesh);
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.enemies = [];
    this.tracked = [];
    this.bolts = [];
    this.particles = [];
    Object.assign(this.player, {
      hull: PLAYER.hull,
      shield: PLAYER.shield,
      energy: PLAYER.energy,
      shieldTimer: 0,
      fireTimer: 0,
      cruising: false,
    });
    this.player.vel.set(0, 0, 0);
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.identity();
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.waveTimer = 1.2;
    this.state = 'playing';
    if (this.world.mine) for (const e of populateMine(this.world.mine)) this.addEnemy(e);
    this.events.message('SECTOR 1', 'Clear the hostiles', 2);
    this.events.started?.();
  }

  // ---------- Main update ----------
  update(dt: number) {
    this.time += dt;
    for (const r of this.rocks) {
      r.mesh.rotation.x += r.spin.x * dt;
      r.mesh.rotation.y += r.spin.y * dt;
      r.mesh.rotation.z += r.spin.z * dt;
    }
    this.updateParticles(dt);
    if (this.state !== 'playing') {
      // Idle drift on the title / game-over screens.
      if (this.state !== 'paused') this.camera.rotateY(dt * 0.03);
      return;
    }

    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updateBolts(dt);
    this.updateWaves(dt);

    // Camera shake (applied as a tiny random rotation, removed next frame by being small & random).
    if (this.shake > 0) {
      const s = this.shake * 0.012;
      this.camera.rotateX(rand(-s, s));
      this.camera.rotateY(rand(-s, s));
      this.shake = Math.max(0, this.shake - dt * 3);
    }
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    const cam = this.camera;
    const inp = this.input;
    inp.poll();

    // Rotation (local axes, so it's true 6DOF: no "up" in space).
    const [lx, ly] = inp.consumeLook();
    const turn = p.cruising ? PLAYER.cruiseTurn : 1;
    cam.rotateY((-lx * PLAYER.mouseSens - inp.turnX * PLAYER.stickYaw * dt) * turn);
    cam.rotateX((-ly * PLAYER.mouseSens - inp.turnY * PLAYER.stickPitch * dt) * turn);
    cam.rotateZ(inp.roll * PLAYER.rollRate * dt);

    // Boost uses energy.
    p.boosting = inp.boost && p.energy > 0 && inp.moveZ > 0;
    p.energy = p.boosting
      ? Math.max(0, p.energy - PLAYER.boostDrain * dt)
      : Math.min(PLAYER.energy, p.energy + PLAYER.energyRegen * dt);

    // Cruise: a fast travel mode for crossing the sector. Drops out near enemies or the ground.
    const blocked = this.cruiseBlockedReason();
    if (inp.consumeCruiseToggle()) {
      if (p.cruising) p.cruising = false;
      else if (blocked) this.events.message('CRUISE UNAVAILABLE', blocked, 1.5);
      else p.cruising = true;
    }
    if (p.cruising && (blocked || inp.moveZ < 0)) {
      p.cruising = false;
      if (blocked) this.events.message('CRUISE DISENGAGED', blocked, 1.5);
    }
    p.cruiseNote = blocked ?? '';

    if (p.cruising) {
      p.boosting = false;
      _a.copy(FORWARD).applyQuaternion(cam.quaternion).multiplyScalar(PLAYER.cruiseSpeed);
      p.vel.lerp(_a, 1 - Math.exp(-1.2 * dt));
    } else {
      // Thrust in ship space.
      _a.set(inp.moveX, inp.moveY, -inp.moveZ);
      if (_a.lengthSq() > 1) _a.normalize();
      _a.applyQuaternion(cam.quaternion).multiplyScalar(p.boosting ? PLAYER.boostAccel : PLAYER.accel);
      p.vel.addScaledVector(_a, dt);
      // Flight assist brakes harder after dropping out of cruise, so you don't overshoot.
      const speed = p.vel.length();
      const extra = speed > 120 ? 1.5 : 0;
      p.vel.multiplyScalar(Math.exp(-(PLAYER.damping + extra) * dt));
    }

    // Soft sector boundary.
    const d = cam.position.length();
    p.outOfBounds = d > SECTOR_RADIUS;
    if (p.outOfBounds) p.vel.addScaledVector(_b.copy(cam.position).normalize(), -(d - SECTOR_RADIUS) * 2 * dt);

    cam.position.addScaledVector(p.vel, dt);

    // Asteroid collisions.
    for (const r of this.rocks) {
      const min = r.radius + PLAYER.radius;
      _b.subVectors(cam.position, r.mesh.position);
      const dist = _b.length();
      if (dist < min) {
        _b.divideScalar(dist || 1);
        cam.position.copy(r.mesh.position).addScaledVector(_b, min);
        const into = p.vel.dot(_b);
        if (into < 0) {
          p.vel.addScaledVector(_b, -into * 1.4);
          if (-into > 18) this.damagePlayer((-into - 18) * 0.9);
        }
      }
    }

    // Ground and tunnel walls.
    const n = this.world.collide(cam.position, PLAYER.radius);
    if (n) {
      const into = p.vel.dot(n);
      if (into < 0) {
        p.vel.addScaledVector(n, -into * 1.3);
        if (-into > 18) this.damagePlayer((-into - 18) * 0.9);
        if (p.cruising) p.cruising = false;
      }
    }

    // Shields.
    p.shieldTimer -= dt;
    if (p.shieldTimer <= 0) p.shield = Math.min(PLAYER.shield, p.shield + PLAYER.shieldRegen * dt);

    // Weapons. Touch players get auto-fire whenever an enemy is under the crosshair.
    p.fireTimer -= dt;
    const wantFire = inp.fire || (inp.touch && this.enemyUnderCrosshair());
    if (wantFire && p.fireTimer <= 0) {
      p.fireTimer = PLAYER.fireInterval;
      this.firePlayer();
    }
  }

  /** True if some enemy is close to the line of fire. */
  enemyUnderCrosshair() {
    _a.copy(FORWARD).applyQuaternion(this.camera.quaternion);
    for (const e of this.tracked) {
      _b.subVectors(e.mesh.position, this.camera.position);
      const dist = _b.length();
      if (dist > 260) continue;
      const ang = _a.angleTo(_b);
      if (ang < Math.atan2(e.radius * 1.4, dist) + 0.02) return true;
    }
    return false;
  }

  private firePlayer() {
    const cam = this.camera;
    const p = this.player;
    p.gunSide *= -1;
    const spawn = new THREE.Vector3(GUN_OFFSET.x * p.gunSide, GUN_OFFSET.y, GUN_OFFSET.z).applyMatrix4(cam.matrixWorld);
    const target = _a.set(0, 0, -PLAYER.convergence).applyMatrix4(cam.matrixWorld);
    const dir = target.sub(spawn).normalize().clone();
    const mesh = new THREE.Mesh(geo.bolt, mat.bolt);
    mesh.position.copy(spawn);
    mesh.quaternion.setFromUnitVectors(Z_AXIS, dir);
    this.scene.add(mesh);
    this.bolts.push({
      mesh,
      vel: dir.multiplyScalar(PLAYER.boltSpeed).add(p.vel),
      prev: spawn.clone(),
      life: PLAYER.boltLife,
      dmg: PLAYER.boltDamage,
      hostile: false,
    });
    this.sfx.laser(p.gunSide);
    this.events.fired?.(p.gunSide);
  }

  private fireBolt(from: THREE.Vector3, dir: THREE.Vector3, o: FireOpts) {
    const mesh = new THREE.Mesh(geo.enemyBolt, enemyBoltMat[o.color ?? 'red']);
    mesh.position.copy(from);
    if (o.size) mesh.scale.setScalar(o.size);
    this.scene.add(mesh);
    this.bolts.push({
      mesh,
      vel: dir.clone().multiplyScalar(o.speed),
      prev: from.clone(),
      life: o.life ?? 3.5,
      dmg: o.dmg,
      hostile: true,
    });
  }

  /** Hostiles left in the current area: the mine's population while down there, else the space wave. */
  get hostiles() {
    let n = 0;
    for (const e of this.enemies) if (this.inMine ? e.habitat === 'mine' : e.wave) n++;
    return n;
  }

  addEnemy(e: Enemy) {
    this.scene.add(e.mesh);
    this.enemies.push(e);
  }

  /** Sample the segment for rock (tunnel walls, terrain). */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3) {
    const d = a.distanceTo(b);
    const steps = Math.ceil(d / 2.5);
    for (let i = 1; i < steps; i++) if (this.world.blocks(_c.lerpVectors(a, b, i / steps))) return false;
    return true;
  }

  private updateEnemies(dt: number) {
    const ppos = this.camera.position;
    this.inMine = !!this.world.mine?.contains(ppos, 2);
    this.tracked.length = 0;
    for (const e of this.enemies.slice()) {
      if (e.hp <= 0) continue;
      const dist = e.pos.distanceTo(ppos);
      if (e.habitat === 'mine') {
        // Mine enemies only run (and draw) while the player is down there and reasonably close.
        const active = this.inMine && dist < 260;
        e.mesh.visible = active && dist < 200;
        if (!active) continue;
      }
      e.update(this.ctx, dt);
      if (e.stealth < 0.5 && (e.habitat === 'space' || (e.awake && dist < 220))) this.tracked.push(e);
    }
    // Anything that died during its own update (Embers detonating).
    for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i].hp <= 0) this.killEnemy(this.enemies[i]);
  }

  private updateBolts(dt: number) {
    const ppos = this.camera.position;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.prev.copy(b.mesh.position);
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      let dead = b.life <= 0;

      if (!dead && this.world.blocks(b.mesh.position)) {
        this.sparks(b.prev, b.hostile ? 0xff7a50 : 0x9ff8ff, 5);
        this.events.impact?.(b.prev);
        this.sfx.impact(b.prev);
        dead = true;
      }
      if (!dead) {
        for (const r of this.rocks) {
          if (segmentHitsSphere(b.prev, b.mesh.position, r.mesh.position, r.radius)) {
            this.sparks(b.mesh.position, b.hostile ? 0xff7a50 : 0x9ff8ff, 5);
            this.events.impact?.(b.mesh.position);
            this.sfx.impact(b.mesh.position);
            dead = true;
            break;
          }
        }
      }
      if (!dead && b.hostile) {
        if (segmentHitsSphere(b.prev, b.mesh.position, ppos, PLAYER.radius)) {
          this.damagePlayer(b.dmg);
          dead = true;
        }
      } else if (!dead) {
        for (const e of this.enemies) {
          if (e.hp > 0 && e.mesh.visible !== false && e.hitTest(b.prev, b.mesh.position)) {
            this.damageEnemy(e, b.dmg, b.prev, b.mesh.position);
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        this.scene.remove(b.mesh);
        this.bolts.splice(i, 1);
      }
    }
  }

  /** Is the player close enough to the asteroid field for the fight to follow them? */
  inCombatZone() {
    return this.camera.position.length() < LEASH_RADIUS;
  }

  private cruiseBlockedReason(): string | null {
    for (const e of this.enemies) if ((e.habitat === 'space' || e.awake) && e.mesh.position.distanceTo(this.camera.position) < 300) return 'HOSTILES NEARBY';
    return this.world.cruiseBlocked(this.camera.position);
  }

  private updateWaves(dt: number) {
    if (this.enemies.some((e) => e.wave)) return;
    if (!this.inCombatZone()) return;
    if (this.waveTimer > 0) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.spawnWave();
      return;
    }
    // Wave cleared.
    if (this.wave > 0) {
      this.player.hull = Math.min(PLAYER.hull, this.player.hull + 20);
      this.score += 100 * this.wave;
      this.events.message(`WAVE ${this.wave} CLEARED`, 'Hull repaired +20', 2.5);
      this.sfx.chime();
    }
    this.waveTimer = 3;
  }

  private spawnWave() {
    this.wave++;
    const count = Math.min(2 + this.wave, 12);
    const hp = WAVE.baseHp + WAVE.hpPerWave * (this.wave - 1);
    const fwd = _a.copy(FORWARD).applyQuaternion(this.camera.quaternion);
    for (let i = 0; i < count; i++) {
      const pos = new THREE.Vector3();
      // Spawn mostly ahead of the player so the fight finds them.
      do {
        randomOnSphere(pos, rand(120, 190));
        if (pos.dot(fwd) < 0 && Math.random() < 0.7) pos.negate();
        pos.add(this.camera.position);
      } while (this.rocks.some((r) => r.mesh.position.distanceTo(pos) < r.radius + 8));
      const e = new Warden(pos, 'space', hp);
      e.wave = true;
      e.score = 50 + this.wave * 10;
      this.addEnemy(e);
    }
    if (this.wave > 1) this.events.message(`WAVE ${this.wave}`, `${count} hostiles inbound`, 2);
  }

  private damageEnemy(e: Enemy, dmg: number, from: THREE.Vector3, at: THREE.Vector3) {
    const done = e.takeHit(dmg, from, at, this.ctx);
    if (done <= 0) return; // deflected; the enemy made its own sparks
    e.hitFlash = 1;
    this.sparks(at, 0x9ff8ff, 4);
    this.sfx.hit(at);
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy) {
    const i = this.enemies.indexOf(e);
    if (i < 0) return;
    this.enemies.splice(i, 1);
    e.hp = 0;
    e.onDeath(this.ctx);
    this.explode(e.mesh.position, THREE.MathUtils.clamp(e.radius / 3, 0.7, 3));
    e.dispose();
    this.kills++;
    this.score += e.score;
  }

  /** Area damage with linear falloff. Hurts the player and every enemy except the source. */
  private blast(at: THREE.Vector3, radius: number, dmg: number, source?: Enemy) {
    this.explode(at, radius / 7);
    const pd = at.distanceTo(this.camera.position);
    if (pd < radius + PLAYER.radius) this.damagePlayer(dmg * (1 - Math.max(0, pd - PLAYER.radius) / radius));
    const pos = at.clone();
    for (const e of this.enemies.slice()) {
      if (e === source || e.hp <= 0) continue;
      const d = e.pos.distanceTo(pos) - e.radius;
      if (d >= radius) continue;
      e.hp -= dmg * 2 * (1 - Math.max(0, d) / radius);
      e.hitFlash = 1;
      if (e.hp <= 0) this.killEnemy(e);
    }
  }

  /** Destroy the ship outright (caught in the reactor meltdown). */
  killPlayer() {
    if (this.state !== 'playing') return;
    this.player.shield = 0;
    this.damagePlayer(this.player.hull + 1);
  }

  /** Add camera shake (0..1.5). */
  addShake(amount: number) {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  private damagePlayer(dmg: number) {
    const p = this.player;
    p.shieldTimer = PLAYER.shieldDelay;
    const absorbed = Math.min(p.shield, dmg);
    p.shield -= absorbed;
    p.hull -= dmg - absorbed;
    this.shake = Math.min(1.5, this.shake + dmg / 12);
    this.events.damaged(dmg - absorbed > 0 ? 1 : 0.4);
    this.sfx.hurt(dmg - absorbed <= 0);
    if (p.hull <= 0) {
      p.hull = 0;
      this.explode(_a.set(0, 0, -6).applyMatrix4(this.camera.matrixWorld), 2.5);
      this.sfx.explode(true);
      this.state = 'over';
      this.events.gameOver(this.score, this.wave);
    }
  }

  // ---------- Effects ----------
  private spawnParticle(at: THREE.Vector3, color: number, speed: number, size: number, life: number, grow = false) {
    const m = new THREE.Mesh(
      geo.spark,
      new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    );
    (m.material as THREE.MeshBasicMaterial).color.multiplyScalar(2.5); // HDR so it blooms
    m.position.copy(at);
    m.scale.setScalar(size);
    this.scene.add(m);
    this.particles.push({
      mesh: m,
      vel: randomOnSphere(new THREE.Vector3(), speed * rand(0.3, 1)),
      life,
      maxLife: life,
      size,
      grow,
    });
  }

  private sparks(at: THREE.Vector3, color: number, n: number) {
    for (let i = 0; i < n; i++) this.spawnParticle(at, color, 18, 0.15, rand(0.15, 0.35));
  }

  explode(at: THREE.Vector3, scale: number) {
    this.events.exploded?.(at, scale);
    this.spawnParticle(at, 0xfff1c0, 0, 2 * scale, 0.35, true);
    for (let i = 0; i < 26 * scale; i++) this.spawnParticle(at, i % 3 ? 0xff9a3c : 0xffe08a, 30 * scale, rand(0.3, 0.7) * scale, rand(0.5, 1.2));
    if (scale < 2) this.sfx.explode(false, at);
  }

  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      const k = p.life / p.maxLife;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-2 * dt));
      p.mesh.scale.setScalar(p.grow ? p.size * (1 + (1 - k) * 4) : p.size * k);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = k;
    }
  }

  /** Where to aim to hit enemy e with a player bolt (for the lead marker). */
  leadPoint(e: Enemy, out: THREE.Vector3) {
    const dist = e.mesh.position.distanceTo(this.camera.position);
    const t = dist / PLAYER.boltSpeed;
    return out.copy(e.mesh.position).addScaledVector(_a.subVectors(e.vel, this.player.vel), t);
  }
}
