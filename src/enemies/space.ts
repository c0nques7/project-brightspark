import * as THREE from 'three';
import { Enemy, closestOnSegment, rand, segmentHitsSphere, type EnemyCtx } from './base';
import { glow, hdr } from './models';
import { aegisModel, arcModel, corsairModel, lancerModel, matriarchModel, quiverModel, sowerModel } from './space-models';

// The space faction. All of these live in open space around the asteroid field and follow the
// combat-zone leash: when the player leaves the zone they drift back toward the field.

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

/** Lazily put a free-floating effect mesh in the same scene as its owner. */
function attach(owner: Enemy, fx: THREE.Object3D) {
  if (!fx.parent && owner.mesh.parent) owner.mesh.parent.add(fx);
}

// ---------- Lancer: squads of three making strafing runs ----------
type LancerState = 'run' | 'extend';
export class Lancer extends Enemy {
  readonly kind = 'lancer';
  leader: Lancer | null = null;
  /** Formation slot relative to the leader (leader space). */
  slot = new THREE.Vector3();
  private state: LancerState = 'extend';
  private timer = rand(1, 2);
  private runGoal = new THREE.Vector3();
  private gun = 1;
  constructor(pos: THREE.Vector3) {
    super(lancerModel(), pos, 26, 2.6, 'space');
    this.score = 60;
  }
  /** Make a V of three; returns [leader, wing, wing]. */
  static squad(pos: THREE.Vector3): Lancer[] {
    const lead = new Lancer(pos.clone());
    const out = [lead];
    for (const side of [-1, 1]) {
      const w = new Lancer(pos.clone().add(new THREE.Vector3(side * 9, 0, -7)));
      w.leader = lead;
      w.slot.set(side * 9, 0, -7);
      out.push(w);
    }
    return out;
  }
  protected think(ctx: EnemyCtx, dt: number) {
    this.parts.engine.scale.z = 2.3 + Math.sin(ctx.time * 40 + this.seed) * 0.4;
    // Leader died: the first surviving wingman takes over.
    if (this.leader && this.leader.hp <= 0) this.leader = null;
    if (this.leader) {
      // Hold formation and copy the leader's trigger.
      const goal = _a.copy(this.slot).applyQuaternion(this.leader.mesh.quaternion).add(this.leader.pos);
      const steer = _b.subVectors(goal, this.pos).multiplyScalar(2.2).add(_c.copy(this.leader.vel).sub(this.vel).multiplyScalar(1.5));
      this.move(ctx, steer, dt, 0.4);
      this.mesh.quaternion.slerp(this.leader.mesh.quaternion, Math.min(1, dt * 5));
      if (this.leader.firing) this.tryFire(ctx, dt);
      return;
    }
    const target = this.target(ctx);
    this.timer -= dt;
    const toP = _a.subVectors(target, this.pos);
    const dist = toP.length();
    if (this.state === 'extend') {
      // Fly away, then swing round for another pass.
      const away = _b.copy(toP).negate().normalize();
      const goal = _c.copy(target).addScaledVector(away, 150).add(_d.set(Math.sin(this.seed) * 40, Math.cos(this.seed) * 40, 0));
      this.steerTo(ctx, goal, dt, 3);
      if (this.timer <= 0 && (dist > 120 || this.timer < -4)) {
        this.state = 'run';
        this.timer = 6;
        // Aim to pass close beside the player, not into them.
        this.runGoal.copy(target).add(_d.randomDirection().multiplyScalar(14));
      }
      this.firing = false;
    } else {
      this.runGoal.lerp(_d.copy(target).add(_b.copy(ctx.player.vel).multiplyScalar(0.6)), Math.min(1, dt * 0.8));
      this.steerTo(ctx, this.runGoal, dt, 1.8);
      const facing = this.forward(_b).dot(toP.normalize());
      this.firing = ctx.engaged && facing > 0.93 && dist < 160;
      if (this.firing) this.tryFire(ctx, dt);
      // Passed the player or the run timed out: break off.
      if (this.forward(_b).dot(_c.subVectors(target, this.pos)) < 0 || this.timer <= 0) {
        this.state = 'extend';
        this.timer = rand(2.5, 3.5);
      }
    }
  }
  firing = false;
  private steerTo(ctx: EnemyCtx, goal: THREE.Vector3, dt: number, turn: number) {
    this.face(goal, turn, dt);
    const steer = this.forward(_b).multiplyScalar(1);
    this.separation(ctx, steer, 0.6);
    this.move(ctx, steer.multiplyScalar(85), dt, 1.2);
  }
  private tryFire(ctx: EnemyCtx, dt: number) {
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown = 0.22;
    this.gun *= -1;
    const from = _a.set(0.95 * this.gun, -0.25, 4.3).applyMatrix4(this.mesh.matrixWorld);
    ctx.fire(from.clone(), this.forward(_b).clone(), { speed: 160, dmg: 4, color: 'violet', size: 0.7 });
    if (Math.random() < 0.5) ctx.sfx.enemyShot(from);
  }
}

// ---------- Missile: fired by the Quiver; homes in, can be shot down or outrun ----------
export class Missile extends Enemy {
  readonly kind = 'missile';
  private life = 9;
  private flame: THREE.Mesh;
  constructor(pos: THREE.Vector3, dir: THREE.Vector3) {
    const root = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0xd8dce4, metalness: 0.5, roughness: 0.4, flatShading: true });
    root.add(new THREE.Mesh(MISSILE_GEO, body));
    const flame = new THREE.Mesh(FLAME_GEO, FLAME_MAT);
    flame.position.z = -1.1;
    root.add(flame);
    super({ root, body, parts: {} }, pos, 4, 1.2, 'space');
    this.flame = flame;
    this.score = 10;
    this.vel.copy(dir).multiplyScalar(40);
    this.face(_a.copy(pos).add(dir), Infinity, 0);
  }
  protected think(ctx: EnemyCtx, dt: number) {
    this.life -= dt;
    this.flame.scale.z = 1.5 + Math.random();
    // Turn toward an intercept point at a limited rate, then burn forward.
    const t = Math.min(2, this.pos.distanceTo(ctx.player.pos) / 75);
    this.face(_a.copy(ctx.player.pos).addScaledVector(ctx.player.vel, t * 0.5), 1.6, dt);
    this.move(ctx, this.forward(_b).multiplyScalar(110), dt, 1.4);
    if (this.pos.distanceTo(ctx.player.pos) < this.radius + ctx.player.radius + 1.5 || this.life <= 0) {
      this.hp = 0;
      ctx.blast(this.pos, 7, 14, this);
    }
  }
}
const MISSILE_GEO = new THREE.ConeGeometry(0.3, 2, 6).rotateX(Math.PI / 2);
const FLAME_GEO = new THREE.OctahedronGeometry(0.35, 0);
const FLAME_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.2, 1.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });

// ---------- Quiver: missile boat that keeps its distance ----------
export class Quiver extends Enemy {
  readonly kind = 'quiver';
  private orbitAxis = new THREE.Vector3().randomDirection();
  private salvo = 0;
  private salvoTimer = 0;
  private tube = 0;
  constructor(pos: THREE.Vector3) {
    super(quiverModel(), pos, 70, 3.6, 'space');
    this.score = 120;
    this.cooldown = rand(2, 3);
  }
  protected think(ctx: EnemyCtx, dt: number) {
    this.parts.dish.rotation.y += dt * 1.5;
    const target = this.target(ctx);
    _a.subVectors(target, this.pos);
    const dist = _a.length();
    _a.normalize();
    // Hold 130-170 m: back off if the player closes in.
    const steer = _c.copy(_a).multiplyScalar(THREE.MathUtils.clamp((dist - 150) / 30, -1.5, 1));
    steer.addScaledVector(_b.crossVectors(_a, this.orbitAxis).normalize(), 0.5);
    this.separation(ctx, steer);
    this.move(ctx, steer.multiplyScalar(26), dt, 0.8);
    this.face(target, 1.5, dt);
    if (!ctx.engaged) return;
    this.cooldown -= dt;
    if (this.cooldown <= 0 && dist < 260) {
      this.cooldown = rand(5.5, 7) / ctx.aggression;
      this.salvo = 2;
    }
    this.salvoTimer -= dt;
    if (this.salvo > 0 && this.salvoTimer <= 0) {
      this.salvo--;
      this.salvoTimer = 0.45;
      const tip = this.parts[`missile${this.tube++ % 8}`];
      const from = tip.getWorldPosition(new THREE.Vector3());
      const dir = this.forward(new THREE.Vector3()).add(_b.randomDirection().multiplyScalar(0.25)).normalize();
      ctx.spawn(new Missile(from.addScaledVector(dir, 1.5), dir));
      ctx.sfx.charge(from);
    }
  }
}

// ---------- Aegis: shields its allies; tethers show who's covered ----------
const SHIELD_RANGE = 26;
export class Aegis extends Enemy {
  readonly kind = 'aegis';
  private tethers: THREE.LineSegments;
  private tetherPos: Float32Array;
  constructor(pos: THREE.Vector3) {
    super(aegisModel(), pos, 45, 2.4, 'space');
    this.score = 150;
    this.tetherPos = new Float32Array(8 * 2 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.tetherPos, 3));
    this.tethers = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(0.6, 1.4, 3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tethers.frustumCulled = false;
    // The big bubble is just a tell on the Aegis itself; keep it subtle.
    this.parts.bubble.scale.setScalar(0.5);
  }
  protected think(ctx: EnemyCtx, dt: number) {
    attach(this, this.tethers);
    this.parts.arms.rotation.y += dt * 1.2;
    this.parts.ring.rotation.z -= dt * 2;
    this.parts.bubble.rotation.y += dt * 0.3;
    // Stay near the middle of the allies, away from the player.
    const centre = _a.set(0, 0, 0);
    let n = 0;
    for (const e of ctx.enemies) {
      if (e === this || e.habitat !== 'space' || e.kind === 'missile' || e.kind === 'spacemine') continue;
      if (e.pos.distanceTo(this.pos) < 120) {
        centre.add(e.pos);
        n++;
      }
    }
    const target = this.target(ctx);
    if (n) centre.divideScalar(n).addScaledVector(_b.subVectors(centre, target).normalize(), 12);
    else centre.copy(this.pos).addScaledVector(_b.subVectors(this.pos, target).normalize(), 30);
    const steer = _c.subVectors(centre, this.pos).clampLength(0, 20).divideScalar(20);
    this.separation(ctx, steer);
    this.move(ctx, steer.multiplyScalar(30), dt, 1.2);
    this.face(target, 2, dt);

    // Shield everyone in range and draw a tether to each.
    let k = 0;
    for (const e of ctx.enemies) {
      if (e === this || e.habitat !== 'space' || e.kind === 'missile' || e.kind === 'spacemine') continue;
      if (e.pos.distanceTo(this.pos) > SHIELD_RANGE + e.radius) continue;
      e.shielded = 0.2;
      if (k < 8) {
        this.pos.toArray(this.tetherPos, k * 6);
        e.pos.toArray(this.tetherPos, k * 6 + 3);
        k++;
      }
    }
    this.tetherPos.fill(0, k * 6);
    this.tethers.geometry.attributes.position.needsUpdate = true;
    this.tethers.geometry.setDrawRange(0, k * 2);
    (this.tethers.material as THREE.LineBasicMaterial).opacity = 0.5 + Math.sin(ctx.time * 12) * 0.3;

    this.cooldown -= dt;
    if (ctx.engaged && this.cooldown <= 0 && this.pos.distanceTo(ctx.player.pos) < 120) {
      this.cooldown = rand(1.6, 2.4);
      this.shootAt(ctx, _d.set(0, -1.4, 1.8), { speed: 100, dmg: 4, color: 'violet', size: 0.7 });
    }
  }
  dispose() {
    super.dispose();
    this.tethers.removeFromParent();
    this.tethers.geometry.dispose();
  }
}

// ---------- Corsair: gunship that circles wide and lets its turrets work ----------
export class Corsair extends Enemy {
  readonly kind = 'corsair';
  private orbitAxis = new THREE.Vector3().randomDirection();
  private turretCd = [rand(1, 2), rand(1.5, 2.5)];
  private turretBurst = [0, 0];
  constructor(pos: THREE.Vector3) {
    super(corsairModel(), pos, 230, 6, 'space');
    this.score = 250;
  }
  hitTest(a: THREE.Vector3, b: THREE.Vector3) {
    // Long hull: two spheres along its axis.
    this.forward(_d);
    return segmentHitsSphere(a, b, _c.copy(this.pos).addScaledVector(_d, 4), 4.5) || segmentHitsSphere(a, b, _c.copy(this.pos).addScaledVector(_d, -3), 5.5);
  }
  protected think(ctx: EnemyCtx, dt: number) {
    const target = this.target(ctx);
    _a.subVectors(target, this.pos);
    const dist = _a.length();
    _a.normalize();
    // Broadside orbit at ~75 m, nose along the orbit so both turrets bear.
    const tangent = _b.crossVectors(_a, this.orbitAxis).normalize();
    const steer = _c.copy(tangent).addScaledVector(_a, THREE.MathUtils.clamp((dist - 75) / 25, -1, 1));
    this.separation(ctx, steer, 0.5);
    this.move(ctx, steer.multiplyScalar(14), dt, 0.6);
    this.face(_d.copy(this.pos).add(tangent), 0.5, dt);
    if (!ctx.engaged) return;
    const turrets = [this.parts.turretTop, this.parts.turretBottom];
    turrets.forEach((t, i) => {
      // Turn the turret toward the player (turrets yaw about their own up).
      _d.copy(ctx.player.pos);
      t.parent!.worldToLocal(_d).sub(t.position);
      if (i === 1) _d.set(-_d.x, _d.y, _d.z); // the bottom turret is flipped upside down
      const yaw = Math.atan2(_d.x, _d.z);
      t.rotation.y += THREE.MathUtils.euclideanModulo(yaw - t.rotation.y + Math.PI, Math.PI * 2) * Math.min(1, dt * 2.5) - Math.PI * Math.min(1, dt * 2.5);
      this.turretCd[i] -= dt;
      if (this.turretCd[i] <= 0 && dist < 180) {
        this.turretCd[i] = rand(3, 3.8) / ctx.aggression;
        this.turretBurst[i] = 3;
      }
      if (this.turretBurst[i] > 0 && this.turretCd[i] < 2) {
        this.turretBurst[i]--;
        this.turretCd[i] += 0.14;
        const muzzleLocal = _d.set(0, 0.55, 3.8).applyEuler(t.rotation).add(t.position);
        this.shootAt(ctx, muzzleLocal, { speed: 110, dmg: 5, color: 'red' }, 3);
      }
    });
  }
}

// ---------- SpaceMine: dropped by the Sower; arms when you get close ----------
export class SpaceMine extends Enemy {
  readonly kind = 'spacemine';
  private arming = -1;
  private life = 45;
  constructor(pos: THREE.Vector3) {
    const root = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x3a3d45, metalness: 0.7, roughness: 0.4, flatShading: true });
    root.add(new THREE.Mesh(MINE_GEO, body));
    const core = new THREE.Mesh(MINE_CORE, glow(hdr(2, 0.6, 0.15)));
    root.add(core);
    super({ root, body, parts: { core } }, pos, 6, 1.4, 'space');
    this.score = 10;
  }
  protected think(ctx: EnemyCtx, dt: number) {
    this.life -= dt;
    this.vel.multiplyScalar(Math.exp(-1.5 * dt));
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.rotation.y += dt;
    const core = this.parts.core as THREE.Mesh;
    const d = this.pos.distanceTo(ctx.player.pos);
    if (this.arming < 0 && d < 14) {
      this.arming = 0.7;
      ctx.sfx.lockOn(this.pos, 1);
    }
    if (this.arming >= 0) {
      this.arming -= dt;
      core.scale.setScalar(1 + Math.sin(ctx.time * 40) * 0.4);
      (core.material as THREE.MeshBasicMaterial).color.setRGB(6, 1, 0.3);
      if (this.arming <= 0) {
        this.hp = 0;
        ctx.blast(this.pos, 13, 20, this);
      }
    }
    if (this.life <= 0) this.hp = 0;
  }
  onDeath(ctx: EnemyCtx) {
    if (this.arming !== -2) {
      this.arming = -2;
      ctx.blast(this.pos, 9, 10, this);
    }
  }
}
const MINE_GEO = new THREE.IcosahedronGeometry(1, 0);
const MINE_CORE = new THREE.OctahedronGeometry(0.6, 0);

// ---------- Sower: runs across your path dropping mines ----------
export class Sower extends Enemy {
  readonly kind = 'sower';
  private dropTimer = 2;
  private laid: Enemy[] = [];
  private heading = new THREE.Vector3().randomDirection();
  constructor(pos: THREE.Vector3) {
    super(sowerModel(), pos, 60, 3, 'space');
    this.score = 120;
  }
  protected think(ctx: EnemyCtx, dt: number) {
    this.parts.drum.rotation.z += dt * 1.5;
    const target = this.target(ctx);
    _a.subVectors(this.pos, target);
    const dist = _a.length();
    _a.normalize();
    // Cross in front of the player at 60-120 m: tangent motion plus range keeping.
    if (Math.random() < dt * 0.15) this.heading.randomDirection();
    const tangent = _b.copy(this.heading).projectOnPlane(_a).normalize();
    const steer = _c.copy(tangent).addScaledVector(_a, THREE.MathUtils.clamp((90 - dist) / 30, -1, 1.5));
    this.separation(ctx, steer);
    this.move(ctx, steer.multiplyScalar(38), dt, 0.9);
    this.face(_d.copy(this.pos).add(this.vel), 2.5, dt);
    if (!ctx.engaged) return;
    this.dropTimer -= dt;
    this.laid = this.laid.filter((m) => m.hp > 0 && ctx.enemies.includes(m));
    if (this.dropTimer <= 0 && this.laid.length < 8 && dist < 200) {
      this.dropTimer = rand(1.8, 2.6);
      const m = new SpaceMine(this.pos.clone().addScaledVector(this.forward(_d), -4));
      m.vel.copy(this.vel).multiplyScalar(0.2);
      ctx.spawn(m);
      this.laid.push(m);
    }
    this.cooldown -= dt;
    if (this.cooldown <= 0 && dist < 90) {
      this.cooldown = rand(1.5, 2.2);
      this.shootAt(ctx, _d.set(0, -1.2, 2.7), { speed: 95, dmg: 5, color: 'red' });
    }
  }
}

// ---------- Arc: long-range sniper; a visible aim line, then a hitscan rail shot ----------
type ArcState = 'move' | 'aim' | 'lock' | 'cool';
export class Arc extends Enemy {
  readonly kind = 'arc';
  private state: ArcState = 'move';
  private timer = rand(2, 3);
  private aimDir = new THREE.Vector3(0, 0, 1);
  private line: THREE.Mesh;
  private lineMat: THREE.MeshBasicMaterial;
  private perch = new THREE.Vector3();
  constructor(pos: THREE.Vector3) {
    super(arcModel(), pos, 55, 3, 'space');
    this.score = 180;
    this.lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 1), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.line = new THREE.Mesh(LINE_GEO, this.lineMat);
    this.line.visible = false;
    this.line.frustumCulled = false;
    this.pickPerch(new THREE.Vector3());
  }
  hitTest(a: THREE.Vector3, b: THREE.Vector3) {
    this.forward(_d);
    return segmentHitsSphere(a, b, this.pos, 2.6) || segmentHitsSphere(a, b, _c.copy(this.pos).addScaledVector(_d, 6), 1.4);
  }
  private pickPerch(target: THREE.Vector3) {
    this.perch.randomDirection().multiplyScalar(rand(190, 240)).add(target);
  }
  protected think(ctx: EnemyCtx, dt: number) {
    attach(this, this.line);
    const target = this.target(ctx);
    this.timer -= dt;
    const muzzle = _a.set(0, 0, 11.2).applyMatrix4(this.mesh.matrixWorld);
    const rings = [0, 1, 2, 3].map((i) => this.parts[`ring${i}`]);
    if (this.state === 'move') {
      if (this.perch.distanceTo(target) > 300 || this.perch.distanceTo(target) < 150) this.pickPerch(target);
      const steer = _b.subVectors(this.perch, this.pos).clampLength(0, 30).divideScalar(30);
      this.separation(ctx, steer);
      this.move(ctx, steer.multiplyScalar(40), dt, 1);
      this.face(target, 1.2, dt);
      if (this.timer <= 0 && ctx.engaged && this.pos.distanceTo(ctx.player.pos) < 320) {
        this.state = 'aim';
        this.timer = 2;
        this.aimDir.subVectors(ctx.player.pos, muzzle).normalize();
        ctx.sfx.charge(this.pos);
      }
    } else {
      this.move(ctx, _b.set(0, 0, 0), dt, 3);
    }
    if (this.state === 'aim' || this.state === 'lock') {
      if (this.state === 'aim') {
        // Track with lag, so strafing hard can stay ahead of it.
        const want = _b.subVectors(ctx.player.pos, muzzle).normalize();
        this.aimDir.lerp(want, Math.min(1, dt * 2.2)).normalize();
        this.face(_c.copy(this.pos).add(this.aimDir), 3, dt);
      }
      const k = this.state === 'lock' ? 1 : 1 - this.timer / 2;
      rings.forEach((r, i) => r.scale.setScalar(1 + k * 0.6 * ((i + 1) / 4)));
      // Seen nose-on, the aim line is a dot, so the muzzle itself flares up as the warning.
      this.parts.tip.scale.setScalar(2 + k * 5 + Math.sin(ctx.time * 50) * k);
      this.showLine(muzzle, this.state === 'lock' ? 0.12 : 0.05, this.state === 'lock' ? 1 : 0.35 + k * 0.3, ctx);
      if (this.timer <= 0) {
        if (this.state === 'aim') {
          this.state = 'lock';
          this.timer = 0.4;
          ctx.sfx.lockOn(this.pos, 1);
        } else this.fire(ctx, muzzle);
      }
    } else this.line.visible = false;
    if (this.state === 'cool' && this.timer <= 0) {
      this.state = 'move';
      this.timer = rand(2.5, 4) / ctx.aggression;
      this.pickPerch(target);
    }
  }
  private showLine(from: THREE.Vector3, width: number, opacity: number, ctx: EnemyCtx) {
    this.line.visible = true;
    this.line.position.copy(from);
    this.line.quaternion.setFromUnitVectors(_c.set(0, 0, 1), this.aimDir);
    // Stop short of the player so it never passes through the camera (which would fill the screen).
    const along = _d.subVectors(ctx.player.pos, from).dot(this.aimDir);
    const miss = closestOnSegment(from, _c.copy(from).addScaledVector(this.aimDir, 400), ctx.player.pos, _c).distanceTo(ctx.player.pos);
    const len = miss < 8 ? Math.max(5, along - 8) : 400;
    this.line.scale.set(width, width, len);
    this.lineMat.opacity = opacity;
  }
  private fire(ctx: EnemyCtx, muzzle: THREE.Vector3) {
    this.state = 'cool';
    this.timer = 0.25;
    const end = _b.copy(muzzle).addScaledVector(this.aimDir, 400);
    const p = closestOnSegment(muzzle, end, ctx.player.pos, _c);
    if (p.distanceTo(ctx.player.pos) < ctx.player.radius + 2.2) {
      ctx.hurtPlayer(22);
      ctx.sparks(ctx.player.pos, 0xff60a0, 10);
    }
    // Flash the full-power beam briefly.
    this.showLine(muzzle, 0.5, 1, ctx);
    ctx.sfx.enemyShot(muzzle);
    ctx.sfx.deflect(muzzle);
    for (let i = 0; i < 4; i++) this.parts[`ring${i}`].scale.setScalar(1);
    this.parts.tip.scale.setScalar(2);
  }
  dispose() {
    super.dispose();
    this.line.removeFromParent();
    this.lineMat.dispose();
  }
}
const LINE_GEO = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);

// ---------- Matriarch: carrier boss ----------
const ENGINE_HP = 320;
const PD_HP = 45;
export class Matriarch extends Enemy {
  readonly kind = 'matriarch';
  private engineHp = [ENGINE_HP, ENGINE_HP];
  private pdHp: number[] = [PD_HP, PD_HP, PD_HP, PD_HP, PD_HP];
  private pdCd = [0, 0, 0, 0, 0].map(() => rand(1, 3));
  private launchTimer = 4;
  private launched: Enemy[] = [];
  private announced = false;
  private orbitAxis = new THREE.Vector3(0, 1, 0);
  private bay = 0;
  constructor(pos: THREE.Vector3) {
    super(matriarchModel(), pos, ENGINE_HP * 2, 26, 'space');
    this.score = 4000;
  }
  /** Hull is a capsule along the ship's axis. */
  hitTest(_a2: THREE.Vector3, b: THREE.Vector3) {
    this.forward(_d);
    const p = closestOnSegment(_c.copy(this.pos).addScaledVector(_d, -24), _b.copy(this.pos).addScaledVector(_d, 30), b, _a);
    return p.distanceTo(b) < 12;
  }
  protected think(ctx: EnemyCtx, dt: number) {
    if (!this.announced && ctx.engaged) {
      this.announced = true;
      ctx.message('MATRIARCH', 'Hit the engines at the stern', 3.5);
      ctx.sfx.roar(this.pos);
    }
    const target = this.target(ctx);
    _a.subVectors(target, this.pos);
    const dist = _a.length();
    _a.normalize();
    // Slow, wide circle around the fight.
    const tangent = _b.crossVectors(_a, this.orbitAxis).normalize();
    const steer = _c.copy(tangent).addScaledVector(_a, THREE.MathUtils.clamp((dist - 160) / 60, -1, 1));
    const slow = this.engineHp.filter((h) => h > 0).length / 2;
    this.move(ctx, steer.multiplyScalar(5 * (0.4 + slow * 0.6)), dt, 0.5);
    this.face(_d.copy(this.pos).add(tangent), 0.12, dt);
    if (!ctx.engaged) return;

    // Point-defence turrets.
    for (let i = 0; i < 5; i++) {
      const t = this.parts[`pd${i}`];
      if (this.pdHp[i] <= 0) continue;
      _d.copy(ctx.player.pos);
      t.parent!.worldToLocal(_d).sub(t.position);
      if (t.rotation.x !== 0) _d.x = -_d.x;
      t.rotation.y = Math.atan2(_d.x, _d.z);
      this.pdCd[i] -= dt;
      if (this.pdCd[i] <= 0 && dist < 220) {
        this.pdCd[i] = rand(1.2, 2) / ctx.aggression;
        const local = _d.set(0, 1.3, 5.5).applyEuler(t.rotation).add(t.position);
        this.shootAt(ctx, local, { speed: 100, dmg: 6, color: 'orange', size: 1.2 }, 4);
      }
    }
    // Launch Lancer squads from the side bays.
    this.launchTimer -= dt;
    this.launched = this.launched.filter((e) => e.hp > 0 && ctx.enemies.includes(e));
    if (this.launchTimer <= 0 && this.launched.length <= 3) {
      this.launchTimer = 14 / ctx.aggression;
      const side = (this.bay++ % 2 ? 1 : -1) * 11.5;
      const at = _d.set(side, -1, 18).applyMatrix4(this.mesh.matrixWorld).clone();
      for (const l of Lancer.squad(at)) {
        l.wave = true;
        l.vel.copy(this.forward(_b)).multiplyScalar(40).add(this.vel);
        l.mesh.quaternion.copy(this.mesh.quaternion);
        ctx.spawn(l);
        this.launched.push(l);
      }
      ctx.message('', 'LAUNCH DETECTED', 1.5);
    }
  }
  takeHit(dmg: number, from: THREE.Vector3, at: THREE.Vector3, ctx: EnemyCtx) {
    // Engines first (the stern weak points), then point-defence turrets; the hull deflects.
    for (let i = 0; i < 2; i++) {
      if (this.engineHp[i] <= 0) continue;
      const e = this.parts[i ? 'engineR' : 'engineL'].getWorldPosition(_a);
      if (closestOnSegment(from, at, e, _b).distanceTo(e) < 4.5) {
        const done = Math.min(dmg, this.engineHp[i]);
        this.engineHp[i] -= done;
        this.hp = this.engineHp[0] + this.engineHp[1];
        if (this.engineHp[i] <= 0) {
          ctx.explode(e, 3);
          (this.parts[i ? 'engineR' : 'engineL'] as THREE.Mesh).visible = false;
          if (this.hp > 0) ctx.message('', 'ENGINE DESTROYED', 2);
        }
        return done;
      }
    }
    for (let i = 0; i < 5; i++) {
      if (this.pdHp[i] <= 0) continue;
      const t = this.parts[`pd${i}`].getWorldPosition(_a);
      if (closestOnSegment(from, at, t, _b).distanceTo(t) < 3.2) {
        this.pdHp[i] -= dmg;
        if (this.pdHp[i] <= 0) {
          ctx.explode(t, 1.2);
          this.parts[`pd${i}`].visible = false;
        } else ctx.sparks(t, 0xffffff, 4);
        return 0.0001; // counts as a hit (flash), but the carrier's own health is the engines
      }
    }
    ctx.sparks(at, 0xffc0e0, 5);
    ctx.sfx.deflect(at);
    return 0;
  }
  onDeath(ctx: EnemyCtx) {
    for (let i = 0; i < 6; i++) ctx.explode(_a.copy(this.pos).addScaledVector(this.forward(_b), rand(-24, 28)).addScaledVector(_c.randomDirection(), 6), 2.5);
    ctx.message('MATRIARCH DESTROYED', '', 4);
  }
}
