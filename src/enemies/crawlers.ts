import * as THREE from 'three';
import { Enemy, rand, type EnemyCtx } from './base';
import { lanternModel, tickModel } from './models';

// Mine natives: the Tick ambushes from the ceiling, the Lantern sweeps rooms with a searchlight
// and raises the alarm.

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

// ---------- Tick ----------
type TickState = 'cling' | 'hunt';
export class Tick extends Enemy {
  readonly kind = 'tick';
  private state: TickState = 'cling';
  private hop = 0;
  private biteTimer = 0;
  private grounded = false;
  constructor(pos: THREE.Vector3, up: THREE.Vector3) {
    super(tickModel(), pos, 22, 1.9, 'mine');
    this.score = 40;
    this.stealth = 1; // invisible to sensors until it drops
    this.sightRange = 60;
    // Hang upside down from the ceiling, facing a random way.
    this.mesh.up.copy(up).negate();
    this.face(_a.copy(pos).add(_b.randomDirection().projectOnPlane(up)), Infinity, 0, this.mesh.up);
  }
  /** Spotting the player (or an alarm) makes it drop. */
  wake(ctx: EnemyCtx) {
    super.wake(ctx);
    if (this.state === 'cling') {
      this.state = 'hunt';
      this.stealth = 0;
      this.hop = rand(0.3, 0.6);
      this.vel.copy(ctx.mineUp).multiplyScalar(-6);
      this.mesh.up.copy(ctx.mineUp);
      ctx.sfx.bite(this.pos);
    }
  }
  protected perceive(ctx: EnemyCtx, dt: number) {
    // While clinging it only reacts to the player passing close by, not to distant sightings.
    if (this.state === 'cling') {
      if (ctx.inMine && this.pos.distanceTo(ctx.player.pos) < 15 && ctx.canSee(this.pos, ctx.player.pos)) this.wake(ctx);
      return;
    }
    super.perceive(ctx, dt);
  }
  protected think(ctx: EnemyCtx, dt: number) {
    if (this.state === 'cling') {
      this.parts.legs.rotation.y = Math.sin(ctx.time * 0.7 + this.seed) * 0.05;
      return;
    }
    const up = ctx.mineUp;
    // Legs scuttle, tools spin.
    this.parts.legs.rotation.y = Math.sin(ctx.time * 18 + this.seed) * 0.18;
    this.parts.drillL.rotation.z += dt * 30;
    this.parts.drillR.rotation.z -= dt * 30;
    this.parts.cutter.rotation.x += dt * 20;

    const tgt = this.target(ctx);
    // Gravity, then hop toward the target whenever it lands (or every so often anyway).
    const acc = _c.copy(up).multiplyScalar(-20);
    this.hop -= dt;
    if (this.hop <= 0 && (this.grounded || this.hop < -1.2)) {
      this.hop = rand(0.45, 0.8);
      _a.subVectors(tgt, this.pos);
      const d = _a.length();
      _a.divideScalar(d || 1);
      const speed = Math.min(26, 8 + d * 1.1);
      this.vel.copy(_a).multiplyScalar(speed).addScaledVector(up, 7 + Math.max(0, _a.dot(up)) * 6);
      this.vel.x += rand(-3, 3);
      this.vel.z += rand(-3, 3);
    }
    const n = this.move(ctx, acc, dt, 0.4);
    this.grounded = !!n && n.dot(up) > 0.5;
    if (this.grounded) this.vel.multiplyScalar(Math.exp(-8 * dt));
    this.face(this.sees ? ctx.player.pos : _a.copy(this.pos).add(this.vel), 8, dt, up);

    // Bite on contact.
    this.biteTimer -= dt;
    if (this.biteTimer <= 0 && this.pos.distanceTo(ctx.player.pos) < this.radius + ctx.player.radius + 1.2) {
      this.biteTimer = 0.7;
      ctx.hurtPlayer(6 * ctx.aggression);
      ctx.sfx.bite(this.pos);
      ctx.sparks(_a.lerpVectors(this.pos, ctx.player.pos, 0.6), 0xb8ff9a, 6);
      // Bounce off so it doesn't just sit on the player.
      this.vel.subVectors(this.pos, ctx.player.pos).normalize().multiplyScalar(12);
    }
  }
}

// ---------- Lantern ----------
type LanternState = 'sweep' | 'track';
const BEAM_RANGE = 45;
const BEAM_HALF_ANGLE = Math.atan(11 / 45);
const WHITE = new THREE.Color(1, 0.9, 0.55);
const RED = new THREE.Color(1.6, 0.2, 0.12);
const LENS_WHITE = new THREE.Color(4.5, 4, 2.6);
const LENS_RED = new THREE.Color(6, 0.5, 0.3);

export class Lantern extends Enemy {
  readonly kind = 'lantern';
  private state: LanternState = 'sweep';
  private home = new THREE.Vector3();
  private sweepPhase = Math.random() * Math.PI * 2;
  private alarmCooldown = 0;
  private gun = 1;
  constructor(pos: THREE.Vector3, frameQuat: THREE.Quaternion) {
    super(lanternModel(), pos, 40, 2.5, 'mine');
    this.score = 80;
    this.home.copy(pos);
    this.mesh.quaternion.copy(frameQuat);
    this.mesh.rotateY(Math.random() * Math.PI * 2);
    this.parts.head.rotation.order = 'YXZ';
    this.sightRange = 60;
  }
  private setColor(alarmed: boolean) {
    const beam = this.parts.beam as THREE.Mesh;
    ((beam.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).copy(alarmed ? RED : WHITE);
    ((this.parts.lens as THREE.Mesh).material as THREE.MeshBasicMaterial).color.copy(alarmed ? LENS_RED : LENS_WHITE);
  }
  protected perceive(ctx: EnemyCtx, dt: number) {
    if (this.state === 'track') {
      super.perceive(ctx, dt);
      return;
    }
    // Sweeping: only the beam can spot the player.
    this.sees = false;
    if (!ctx.inMine) return;
    _a.subVectors(ctx.player.pos, this.pos);
    const d = _a.length();
    if (d > BEAM_RANGE) return;
    const beamDir = _b.set(0, 0, 1).transformDirection(this.parts.head.matrixWorld);
    if (beamDir.angleTo(_a) < BEAM_HALF_ANGLE + 0.04 && ctx.canSee(this.pos, ctx.player.pos)) this.spot(ctx);
  }
  private spot(ctx: EnemyCtx) {
    this.state = 'track';
    this.awake = true;
    this.sees = true;
    this.unseenFor = 0;
    this.lastSeen.copy(ctx.player.pos);
    this.cooldown = 0.8;
    this.setColor(true);
    if (this.alarmCooldown <= 0) {
      this.alarmCooldown = 8;
      ctx.sfx.alarm(this.pos);
      ctx.alert(this.pos, 80);
      ctx.message('', 'DETECTED', 1.2);
    }
  }
  wake(ctx: EnemyCtx) {
    // Alerted by someone else or shot: switch to tracking.
    if (this.state !== 'track') this.spot(ctx);
  }
  protected think(ctx: EnemyCtx, dt: number) {
    this.alarmCooldown -= dt;
    const head = this.parts.head;
    this.parts.ring.rotation.z += dt * 0.8;
    // Gentle bob around its post.
    this.pos.copy(this.home).addScaledVector(ctx.mineUp, Math.sin(ctx.time * 1.3 + this.seed) * 0.5);

    if (this.state === 'sweep') {
      this.sweepPhase += dt * 0.55;
      head.rotation.y = Math.sin(this.sweepPhase) * 1.4;
      head.rotation.x = 0.45 + Math.sin(this.sweepPhase * 0.37) * 0.25;
      return;
    }
    // Track: turn the head toward the player (or last known spot).
    _a.copy(this.sees ? ctx.player.pos : this.lastSeen);
    this.mesh.worldToLocal(_a).sub(head.position);
    const yaw = Math.atan2(_a.x, _a.z);
    const pitch = Math.atan2(-_a.y, Math.hypot(_a.x, _a.z));
    const k = Math.min(1, dt * 3);
    head.rotation.y += THREE.MathUtils.euclideanModulo(yaw - head.rotation.y + Math.PI, Math.PI * 2) * k - Math.PI * k;
    head.rotation.x += (pitch - head.rotation.x) * k;

    if (this.unseenFor > 4) {
      this.state = 'sweep';
      this.setColor(false);
      return;
    }
    this.cooldown -= dt;
    if (this.sees && this.cooldown <= 0) {
      this.cooldown = rand(1.2, 1.7) / ctx.aggression;
      this.gun *= -1;
      // Muzzles are on the head; convert to root-local for shootAt.
      _d.set(0.45 * this.gun, -0.85, 2.7);
      head.updateMatrix();
      _d.applyMatrix4(head.matrix);
      this.shootAt(ctx, _d, { speed: 90, dmg: 5 * ctx.aggression, color: 'white' }, 1.5);
    }
  }
}
