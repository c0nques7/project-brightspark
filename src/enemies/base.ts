import * as THREE from 'three';
import type { Sfx } from '../sfx';
import type { Rock } from '../world';
import type { Model } from './models';

// Shared enemy plumbing: the context the game hands to every enemy each frame, and a base class
// with hit flashing, perception (line of sight, last known position) and tunnel-safe movement.

export type EnemyKind = 'warden' | 'gnat' | 'bulwark' | 'shade' | 'ember' | 'tick' | 'lantern' | 'heartforge' | (string & {});
export type Habitat = 'space' | 'mine';
export type BoltColor = 'red' | 'amber' | 'violet' | 'white' | 'orange';

export interface MineInfo {
  rooms: { box: { min: THREE.Vector3; max: THREE.Vector3 }; center: THREE.Vector3; depth: number; reactor?: boolean }[];
  /** Mine-local to world. Local +y is up. */
  frame: THREE.Matrix4;
  contains(pos: THREE.Vector3, slack?: number): boolean;
}

export interface EnemyWorld {
  collide(pos: THREE.Vector3, radius: number): THREE.Vector3 | null;
  blocks(pos: THREE.Vector3): boolean;
  mine?: MineInfo;
}

export interface FireOpts {
  speed: number;
  dmg: number;
  color?: BoltColor;
  size?: number;
  life?: number;
}

/** What the game exposes to enemies. */
export interface EnemyCtx {
  readonly time: number;
  readonly player: { pos: THREE.Vector3; vel: THREE.Vector3; radius: number };
  readonly enemies: readonly Enemy[];
  readonly rocks: readonly Rock[];
  readonly world: EnemyWorld;
  readonly sfx: Sfx;
  /** Player is inside the mine. */
  readonly inMine: boolean;
  /** Player is in the space combat zone (asteroid field). */
  readonly engaged: boolean;
  /** 1 at the start, grows with waves / depth. */
  readonly aggression: number;
  /** World up inside the mine (unit). */
  readonly mineUp: THREE.Vector3;
  fire(from: THREE.Vector3, dir: THREE.Vector3, o: FireOpts): void;
  hurtPlayer(dmg: number): void;
  /** Explosion that hurts the player and enemies (not `source`) within radius, with falloff. */
  blast(at: THREE.Vector3, radius: number, dmg: number, source?: Enemy): void;
  explode(at: THREE.Vector3, scale: number): void;
  sparks(at: THREE.Vector3, color: number, n: number): void;
  spawn(e: Enemy): void;
  /** Wake mine enemies near a point and tell them where the player is. */
  alert(at: THREE.Vector3, radius: number): void;
  message(text: string, sub?: string, seconds?: number): void;
  canSee(from: THREE.Vector3, to: THREE.Vector3): boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const FWD = new THREE.Vector3(0, 0, 1);

export function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

/** Does segment a->b pass within r of point c? */
export function segmentHitsSphere(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, r: number) {
  return closestOnSegment(a, b, c, _c).distanceToSquared(c) <= r * r;
}
export function closestOnSegment(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3, out: THREE.Vector3) {
  _a.subVectors(b, a);
  const len2 = _a.lengthSq();
  const t = len2 > 0 ? THREE.MathUtils.clamp(_b.subVectors(p, a).dot(_a) / len2, 0, 1) : 0;
  return out.copy(a).addScaledVector(_a, t);
}

export abstract class Enemy {
  abstract readonly kind: EnemyKind;
  readonly mesh: THREE.Group;
  readonly body: THREE.MeshStandardMaterial;
  readonly parts: Record<string, THREE.Object3D>;
  readonly vel = new THREE.Vector3();
  hp: number;
  maxHp: number;
  radius: number;
  hitFlash = 0;
  /** Seconds of Aegis shielding left (refreshed every frame while an Aegis covers it). */
  shielded = 0;
  /** 0 = fully visible; 1 = hidden from HUD markers, radar and touch auto-fire. */
  stealth = 0;
  /** Counts toward the current space wave. */
  wave = false;
  habitat: Habitat;
  /** Fixed hazards (turrets etc.): never move, shown on HUD once awake. */
  isStatic = false;
  score = 50;
  /** Has noticed the player (mine enemies start asleep). */
  awake = false;
  /** Can currently see the player (refreshed a few times a second). */
  sees = false;
  readonly lastSeen = new THREE.Vector3();
  unseenFor = 999;
  cooldown = rand(1, 2);
  /** Random per-enemy phase for wobble etc. */
  readonly seed = Math.random() * 100;
  private lookTimer = Math.random() * 0.25;
  private baseEmissive = new THREE.Color();

  constructor(model: Model, pos: THREE.Vector3, hp: number, radius: number, habitat: Habitat) {
    this.mesh = model.root;
    this.body = model.body;
    this.parts = model.parts;
    this.mesh.position.copy(pos);
    this.hp = this.maxHp = hp;
    this.radius = radius;
    this.habitat = habitat;
    this.baseEmissive.copy(this.body.emissive);
    if (habitat === 'space') this.awake = true;
  }

  get pos() {
    return this.mesh.position;
  }

  /** Per-frame update; subclasses put their behaviour in think(). */
  update(ctx: EnemyCtx, dt: number) {
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    this.shielded = Math.max(0, this.shielded - dt);
    const f = this.hitFlash;
    this.body.emissive.setRGB(this.baseEmissive.r + f, this.baseEmissive.g + f * 0.9, this.baseEmissive.b + f * 0.8);
    this.perceive(ctx, dt);
    this.think(ctx, dt);
  }

  protected abstract think(ctx: EnemyCtx, dt: number): void;

  /** How far this enemy can notice the player in the mine. */
  protected sightRange = 90;

  protected perceive(ctx: EnemyCtx, dt: number) {
    this.unseenFor += dt;
    if (this.habitat === 'space') {
      this.sees = ctx.engaged;
      if (this.sees) {
        this.lastSeen.copy(ctx.player.pos);
        this.unseenFor = 0;
      }
      return;
    }
    this.lookTimer -= dt;
    if (this.lookTimer > 0) {
      if (this.sees) this.lastSeen.copy(ctx.player.pos);
      return;
    }
    this.lookTimer = 0.25;
    const d = this.pos.distanceTo(ctx.player.pos);
    this.sees = ctx.inMine && d < (this.awake ? this.sightRange * 1.4 : this.sightRange) && ctx.canSee(this.pos, ctx.player.pos);
    if (this.sees) {
      if (!this.awake) this.wake(ctx);
      this.lastSeen.copy(ctx.player.pos);
      this.unseenFor = 0;
    }
  }

  /** Called when the enemy first notices the player (or is alerted). */
  wake(_ctx: EnemyCtx) {
    this.awake = true;
  }

  /** Alerted by a Lantern or a hit: wake up and head for the player. */
  alertTo(ctx: EnemyCtx, where: THREE.Vector3) {
    this.lastSeen.copy(where);
    this.unseenFor = Math.min(this.unseenFor, 0.5);
    if (!this.awake) this.wake(ctx);
  }

  /** Default sphere hit test for a bolt moving a -> b. */
  hitTest(a: THREE.Vector3, b: THREE.Vector3) {
    return segmentHitsSphere(a, b, this.pos, this.radius);
  }

  /**
   * Apply a hit from a bolt that travelled from `from` to `at`. Returns the damage actually done
   * (0 means it glanced off armour).
   */
  takeHit(dmg: number, _from: THREE.Vector3, at: THREE.Vector3, ctx: EnemyCtx): number {
    if (this.shielded > 0) {
      // An Aegis is covering it: most of the hit soaks into the shield.
      dmg *= 0.2;
      ctx.sparks(at, 0x7fb6ff, 5);
    }
    this.hp -= dmg;
    if (this.habitat === 'mine') this.alertTo(ctx, ctx.player.pos);
    return dmg;
  }

  onDeath(_ctx: EnemyCtx) {}

  dispose() {
    this.mesh.removeFromParent();
    this.body.dispose();
  }

  // ---------- Helpers for subclasses ----------
  /** Integrate velocity with damping, keep out of rocks and inside the tunnels. Returns the wall normal if one was hit. */
  protected move(ctx: EnemyCtx, accel: THREE.Vector3, dt: number, damping: number): THREE.Vector3 | null {
    this.vel.addScaledVector(accel, dt);
    this.vel.multiplyScalar(Math.exp(-damping * dt));
    this.pos.addScaledVector(this.vel, dt);
    if (this.habitat === 'space') {
      for (const r of ctx.rocks) {
        _a.subVectors(this.pos, r.mesh.position);
        const min = r.radius + this.radius;
        const d = _a.length();
        if (d < min) this.pos.copy(r.mesh.position).addScaledVector(_a.divideScalar(d || 1), min);
      }
    }
    const n = ctx.world.collide(this.pos, this.radius);
    if (n) {
      const into = this.vel.dot(n);
      if (into < 0) this.vel.addScaledVector(n, -into * 1.2);
    }
    return n;
  }

  /** Steering away from nearby enemies (and asteroids in space). Adds into `out`. */
  protected separation(ctx: EnemyCtx, out: THREE.Vector3, strength = 1.2) {
    for (const o of ctx.enemies) {
      if (o === this) continue;
      _a.subVectors(this.pos, o.pos);
      const min = this.radius + o.radius + 3;
      const d2 = _a.lengthSq();
      if (d2 < min * min && d2 > 0) out.addScaledVector(_a.normalize(), strength);
    }
    if (this.habitat === 'space') {
      for (const r of ctx.rocks) {
        _a.subVectors(this.pos, r.mesh.position);
        const d = _a.length();
        const clear = r.radius + this.radius + 6;
        if (d < clear) out.addScaledVector(_a.normalize(), (clear - d) / 3);
      }
    }
    return out;
  }

  /** Where to go: the player if visible, else their last known position. */
  protected target(ctx: EnemyCtx): THREE.Vector3 {
    if (this.habitat === 'space') return ctx.engaged ? ctx.player.pos : _b.set(0, 0, 0);
    return this.sees ? ctx.player.pos : this.lastSeen;
  }

  /** Turn the model's +z toward a point, at most `rate` rad/s (Infinity = snap). Keeps `up` as the roll reference. */
  protected face(point: THREE.Vector3, rate: number, dt: number, up?: THREE.Vector3) {
    _a.subVectors(point, this.pos);
    if (_a.lengthSq() < 1e-6) return;
    _m.lookAt(_a.normalize(), _c.set(0, 0, 0), up ?? this.mesh.up);
    // With eye = dir and target = origin, the basis' +z is dir.
    _q.setFromRotationMatrix(_m);
    if (rate === Infinity) this.mesh.quaternion.copy(_q);
    else this.mesh.quaternion.rotateTowards(_q, rate * dt);
  }

  /** Model +z in world space. */
  protected forward(out: THREE.Vector3) {
    return out.copy(FWD).applyQuaternion(this.mesh.quaternion);
  }

  /** Fire a bolt from a model-local point toward the player, leading them imperfectly. */
  protected shootAt(ctx: EnemyCtx, local: THREE.Vector3, o: FireOpts, spread = 2, lead = 0.65) {
    const from = _c.copy(local).applyMatrix4(this.mesh.matrixWorld);
    const to = ctx.player.pos;
    const t = from.distanceTo(to) / o.speed;
    const aim = _a.copy(to).addScaledVector(ctx.player.vel, t * lead * rand(0.6, 1.3));
    aim.x += rand(-spread, spread);
    aim.y += rand(-spread, spread);
    aim.z += rand(-spread, spread);
    ctx.fire(from.clone(), aim.sub(from).normalize(), o);
    ctx.sfx.enemyShot(from);
  }
}
