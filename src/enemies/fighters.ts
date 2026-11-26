import * as THREE from 'three';
import { Enemy, rand, type EnemyCtx, type Habitat } from './base';
import { bulwarkModel, emberModel, gnatModel, shadeModel, wardenModel } from './models';

// Flying enemies. They all work in open space and in the mine; in the mine they sleep until they
// see the player (or a Lantern raises the alarm), then chase the player or their last known position.

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

/** Shared "hold range and circle" steering. Returns the acceleration direction in `out` (not normalised). */
function orbitSteer(e: Enemy, ctx: EnemyCtx, target: THREE.Vector3, range: number, orbitAxis: THREE.Vector3, orbit: number, out: THREE.Vector3) {
  _a.subVectors(target, e.pos);
  const dist = _a.length();
  _a.divideScalar(dist || 1);
  out.copy(_a).multiplyScalar(THREE.MathUtils.clamp((dist - range) / 15, -1, 1));
  _b.crossVectors(_a, orbitAxis);
  if (_b.lengthSq() > 1e-4) out.addScaledVector(_b.normalize(), orbit);
  return dist;
}

// ---------- Warden: baseline fighter ----------
export class Warden extends Enemy {
  readonly kind = 'warden';
  private orbitAxis = new THREE.Vector3().randomDirection();
  constructor(pos: THREE.Vector3, habitat: Habitat, hp = 34) {
    super(wardenModel(), pos, hp, 3.2, habitat);
    this.score = 60;
  }
  protected think(ctx: EnemyCtx, dt: number) {
    this.parts.ring.rotation.z += dt * 2;
    if (!this.awake) return;
    const mine = this.habitat === 'mine';
    const tgt = this.target(ctx);
    const steer = _c;
    const dist = orbitSteer(this, ctx, tgt, mine ? (this.sees ? 26 : 0) : 55, this.orbitAxis, 0.8, steer);
    this.separation(ctx, steer);
    this.move(ctx, steer.multiplyScalar(30 * Math.min(ctx.aggression, 1.6)), dt, 0.9);
    this.face(this.sees ? ctx.player.pos : tgt, 4, dt, mine ? ctx.mineUp : undefined);
    this.cooldown -= dt;
    if (this.sees && this.cooldown <= 0 && dist < (mine ? 110 : 170)) {
      this.cooldown = rand(1.1, 2.2) / ctx.aggression;
      this.shootAt(ctx, _d.set(Math.random() < 0.5 ? -1.75 : 1.75, -0.32, 2.1), { speed: 95, dmg: 8 * ctx.aggression, color: 'red' });
    }
  }
}

// ---------- Gnat: fast, weak, comes in packs ----------
export class Gnat extends Enemy {
  readonly kind = 'gnat';
  private orbitAxis = new THREE.Vector3().randomDirection();
  private gun = 1;
  constructor(pos: THREE.Vector3, habitat: Habitat) {
    super(gnatModel(), pos, 14, 2.8, habitat);
    this.score = 30;
    this.sightRange = 110;
  }
  protected think(ctx: EnemyCtx, dt: number) {
    const tail = this.parts.tail;
    tail.scale.z = 2 + Math.sin(ctx.time * 30 + this.seed) * 0.4;
    if (!this.awake) {
      // Idle hover.
      this.pos.y += Math.sin(ctx.time * 2 + this.seed) * dt * 0.6;
      return;
    }
    const mine = this.habitat === 'mine';
    const tgt = this.target(ctx);
    const steer = _c;
    // Tight orbit with a jinking wobble so they're lively but still trackable.
    const dist = orbitSteer(this, ctx, tgt, this.sees ? (mine ? 16 : 28) : 0, this.orbitAxis, 1.3, steer);
    steer.x += Math.sin(ctx.time * 3.1 + this.seed) * 0.6;
    steer.y += Math.sin(ctx.time * 2.3 + this.seed * 2) * 0.6;
    if (Math.random() < dt * 0.3) this.orbitAxis.randomDirection();
    this.separation(ctx, steer, 1.6);
    this.move(ctx, steer.multiplyScalar(52), dt, 1.25);
    this.face(this.sees ? ctx.player.pos : _a.copy(this.pos).add(this.vel), 7, dt, mine ? ctx.mineUp : undefined);
    this.cooldown -= dt;
    if (this.sees && this.cooldown <= 0 && dist < 90) {
      this.cooldown = rand(0.5, 1.0) / ctx.aggression;
      this.gun *= -1;
      this.shootAt(ctx, _d.set(2.6 * this.gun, -0.12, 1.5), { speed: 120, dmg: 3, color: 'amber', size: 0.6 }, 3);
    }
  }
}

// ---------- Bulwark: slow armoured brute; the front plate deflects, the rear core takes double ----------
export class Bulwark extends Enemy {
  readonly kind = 'bulwark';
  private side = 1;
  private turretTimer = 3;
  private burst = 0;
  private burstTimer = 0;
  constructor(pos: THREE.Vector3, habitat: Habitat) {
    super(bulwarkModel(), pos, 170, 5, habitat);
    this.score = 200;
  }
  protected think(ctx: EnemyCtx, dt: number) {
    const core = this.parts.core;
    core.scale.setScalar(1 + Math.sin(ctx.time * 4 + this.seed) * 0.08);
    if (!this.awake) return;
    const mine = this.habitat === 'mine';
    const tgt = this.target(ctx);
    const steer = _c;
    const dist = orbitSteer(this, ctx, tgt, this.sees ? 32 : 0, ctx.mineUp, 0.15, steer);
    this.separation(ctx, steer, 0.6);
    this.move(ctx, steer.multiplyScalar(11), dt, 0.8);
    // Turns slowly, which is the opening: get around it.
    this.face(this.sees ? ctx.player.pos : tgt, 0.75, dt, mine ? ctx.mineUp : undefined);
    const turret = this.parts.turret;
    // The turret tracks faster than the hull.
    _a.copy(ctx.player.pos);
    turret.parent!.worldToLocal(_a);
    turret.rotation.y = THREE.MathUtils.lerp(turret.rotation.y, Math.atan2(_a.x, _a.z), Math.min(1, dt * 2));

    if (!this.sees) return;
    this.cooldown -= dt;
    this.turretTimer -= dt;
    const facing = this.forward(_b).dot(_a.subVectors(ctx.player.pos, this.pos).normalize());
    if (this.cooldown <= 0 && dist < 120 && facing > 0.7) {
      this.cooldown = rand(1.3, 1.9) / ctx.aggression;
      this.side *= -1;
      this.shootAt(ctx, _d.set(4.8 * this.side, -0.8, 6), { speed: 80, dmg: 11, color: 'orange', size: 1.6 }, 1.5);
    }
    if (this.turretTimer <= 0 && dist < 120) {
      this.turretTimer = 4;
      this.burst = 3;
    }
    this.burstTimer -= dt;
    if (this.burst > 0 && this.burstTimer <= 0) {
      this.burst--;
      this.burstTimer = 0.16;
      this.shootAt(ctx, _d.set(0, 3.7, 4.6), { speed: 105, dmg: 5, color: 'amber' }, 2.5);
    }
  }
  takeHit(dmg: number, from: THREE.Vector3, at: THREE.Vector3, ctx: EnemyCtx) {
    // Which side did the bolt come from? (Use where it started, relative to the hull axis.)
    this.forward(_a);
    _b.subVectors(from, this.pos).normalize();
    const side = _a.dot(_b);
    if (side > 0.35) {
      ctx.sparks(at, 0xffd27a, 6);
      ctx.sfx.deflect(at);
      if (this.habitat === 'mine') this.alertTo(ctx, ctx.player.pos);
      return 0;
    }
    return super.takeHit(side < -0.5 ? dmg * 2 : dmg, from, at, ctx);
  }
}

// ---------- Shade: cloaks, flanks, decloaks to fire a charged rail shot ----------
type ShadeState = 'stalk' | 'reveal' | 'strike' | 'exposed';
export class Shade extends Enemy {
  readonly kind = 'shade';
  private state: ShadeState = 'stalk';
  private timer = rand(2.5, 4);
  private flankSide = Math.random() < 0.5 ? -1 : 1;
  private cloak = 1;
  constructor(pos: THREE.Vector3, habitat: Habitat) {
    super(shadeModel(), pos, 55, 3, habitat);
    this.score = 150;
    this.applyCloak(1);
  }
  private applyCloak(c: number) {
    this.cloak = c;
    this.stealth = c;
    this.body.opacity = THREE.MathUtils.lerp(1, 0.07, c);
    this.body.depthWrite = c < 0.5;
    this.parts.gear.visible = c < 0.6;
  }
  protected think(ctx: EnemyCtx, dt: number) {
    const mine = this.habitat === 'mine';
    const up = mine ? ctx.mineUp : undefined;
    // Shimmer while cloaked.
    if (this.cloak > 0.5) this.body.opacity = 0.05 + 0.04 * Math.sin(ctx.time * 9 + this.seed);
    if (!this.awake) return;
    this.timer -= dt;
    const target = this.target(ctx);
    const steer = _c.set(0, 0, 0);

    if (this.state === 'stalk') {
      // Head for a point off to the player's side and slightly behind them.
      _a.subVectors(this.pos, ctx.player.pos).normalize();
      _b.crossVectors(_a, up ?? _d.set(0, 1, 0)).normalize().multiplyScalar(this.flankSide);
      const goal = _d.copy(target).addScaledVector(_a, mine ? 22 : 40).addScaledVector(_b, mine ? 10 : 25);
      steer.subVectors(goal, this.pos).clampLength(0, 15).divideScalar(15);
      this.face(_a.copy(this.pos).add(this.vel), 3, dt, up);
      if (this.timer <= 0 && this.sees) {
        this.state = 'reveal';
        this.timer = 0.7;
        ctx.sfx.cloak(this.pos, false);
        ctx.sfx.charge(this.pos);
      }
    } else {
      this.face(ctx.player.pos, 5, dt, up);
    }
    if (this.state === 'reveal') {
      this.applyCloak(Math.max(0, this.timer / 0.7));
      this.parts.charge.scale.setScalar(1.8 + (1 - this.timer / 0.7) * 2.5);
      if (this.timer <= 0) {
        this.state = 'strike';
        this.timer = 0.12;
      }
    } else if (this.state === 'strike') {
      if (this.timer <= 0) {
        // Fast, hard-hitting rail shot.
        this.shootAt(ctx, _d.set(0, -0.62, 5), { speed: 210, dmg: 18, color: 'violet', size: 1.4 }, 1, 0.85);
        this.parts.charge.scale.setScalar(1.8);
        this.state = 'exposed';
        this.timer = 1.4;
      }
    } else if (this.state === 'exposed') {
      // Strafe while visible, then fade out again.
      _a.subVectors(ctx.player.pos, this.pos).normalize();
      steer.crossVectors(_a, up ?? _d.set(0, 1, 0)).normalize().multiplyScalar(this.flankSide);
      if (this.timer <= 0) {
        this.state = 'stalk';
        this.timer = rand(3, 5);
        this.flankSide *= -1;
        this.applyCloak(1);
        ctx.sfx.cloak(this.pos, true);
      }
    }
    this.separation(ctx, steer);
    this.move(ctx, steer.multiplyScalar(40), dt, 1.1);
  }
  takeHit(dmg: number, from: THREE.Vector3, at: THREE.Vector3, ctx: EnemyCtx) {
    // Getting shot knocks it out of cloak for a moment.
    if (this.state === 'stalk') {
      this.state = 'exposed';
      this.timer = 2;
      this.applyCloak(0);
      ctx.sfx.cloak(this.pos, false);
    }
    return super.takeHit(dmg, from, at, ctx);
  }
}

// ---------- Ember: locks on and rams; explodes on contact or when shot ----------
type EmberState = 'approach' | 'lock' | 'charge';
export class Ember extends Enemy {
  readonly kind = 'ember';
  private state: EmberState = 'approach';
  private timer = 0;
  private beep = 0;
  private orbitAxis = new THREE.Vector3().randomDirection();
  private detonated = false;
  constructor(pos: THREE.Vector3, habitat: Habitat) {
    super(emberModel(), pos, 12, 2.2, habitat);
    this.score = 40;
  }
  protected think(ctx: EnemyCtx, dt: number) {
    const mine = this.habitat === 'mine';
    const up = mine ? ctx.mineUp : undefined;
    const urgency = this.state === 'charge' ? 1 : this.state === 'lock' ? 0.6 : 0;
    this.parts.core.scale.setScalar(1 + Math.sin(ctx.time * (6 + urgency * 24)) * (0.06 + urgency * 0.1));
    this.parts.spikes.rotation.z += dt * (1 + urgency * 6);
    this.parts.drill.rotation.z += dt * (3 + urgency * 25);
    if (!this.awake) return;
    this.timer -= dt;
    const steer = _c.set(0, 0, 0);
    const toP = _a.subVectors(ctx.player.pos, this.pos);
    const dist = toP.length();

    if (this.state === 'approach') {
      orbitSteer(this, ctx, this.target(ctx), this.sees ? (mine ? 30 : 45) : 0, this.orbitAxis, 0.6, steer);
      this.separation(ctx, steer);
      this.move(ctx, steer.multiplyScalar(34), dt, 1);
      this.face(this.sees ? ctx.player.pos : _b.copy(this.pos).add(this.vel), 4, dt, up);
      if (this.sees && dist < (mine ? 55 : 80)) {
        this.state = 'lock';
        this.timer = 1.1;
      }
    } else if (this.state === 'lock') {
      // Hold still and aim: the tell.
      this.face(ctx.player.pos, 6, dt, up);
      this.move(ctx, steer, dt, 4);
      this.beep -= dt;
      if (this.beep <= 0) {
        this.beep = 0.18;
        ctx.sfx.lockOn(this.pos, 1 - this.timer / 1.1);
      }
      if (this.timer <= 0) {
        this.state = 'charge';
        this.timer = 4;
      }
    } else {
      // Ram: accelerates along its nose and can only turn slowly, so a sidestep or boost beats it.
      this.face(ctx.player.pos, 1.5, dt, up);
      this.forward(steer);
      const wall = this.move(ctx, steer.multiplyScalar(85), dt, 0.9);
      this.beep -= dt;
      if (this.beep <= 0) {
        this.beep = 0.09;
        ctx.sfx.lockOn(this.pos, 1);
      }
      if (dist < this.radius + ctx.player.radius + 1.2 || this.timer <= 0 || (wall && this.vel.length() > 20)) this.detonate(ctx);
    }
  }
  detonate(ctx: EnemyCtx) {
    if (this.detonated) return;
    this.detonated = true;
    this.hp = 0;
    ctx.blast(this.pos, 11, 30, this);
  }
  onDeath(ctx: EnemyCtx) {
    // Shot down: still goes off, which can take out its friends.
    if (!this.detonated) {
      this.detonated = true;
      ctx.blast(this.pos, 11, 24, this);
    }
  }
}
