import * as THREE from 'three';
import { Enemy, closestOnSegment, rand, type EnemyCtx } from './base';
import { Ember } from './fighters';
import { heartforgeModel } from './models';

// Mine boss. An armoured core that only takes damage through whichever of its three vents is open.
// Vents open one at a time. Each destroyed vent unlocks a new attack:
//   3 vents: aimed shots + a spinning ring of bolts
//   2 vents: + launches Embers
//   1 vent:  + a sweeping beam

const VENT_HP = 160;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();

const beamGeo = new THREE.CylinderGeometry(0.35, 0.35, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);

type BeamState = 'idle' | 'warn' | 'fire';

export class Heartforge extends Enemy {
  readonly kind = 'heartforge';
  private ventHp = [VENT_HP, VENT_HP, VENT_HP];
  private ventMats: THREE.MeshBasicMaterial[] = [];
  private open = -1;
  private ventTimer = 2;
  private ringTimer = 3;
  private ringPhase = 0;
  private spawnTimer = 4;
  private beamState: BeamState = 'idle';
  private beamTimer = 3;
  private beam: THREE.Mesh;
  private beamMat: THREE.MeshBasicMaterial;
  private beamDir = new THREE.Vector3(0, 0, 1);
  private announced = false;
  private hurtTick = 0;
  private launched: Enemy[] = [];

  constructor(pos: THREE.Vector3, frameQuat: THREE.Quaternion) {
    super(heartforgeModel(), pos, VENT_HP * 3, 8.6, 'mine');
    this.score = 3000;
    this.sightRange = 75;
    this.mesh.quaternion.copy(frameQuat);
    for (let i = 0; i < 3; i++) {
      const v = this.parts[`vent${i}`] as THREE.Mesh;
      const m = (v.material as THREE.MeshBasicMaterial).clone();
      v.material = m;
      this.ventMats.push(m);
    }
    this.beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.2, 0.3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.setVentGlow();
  }

  get phase() {
    return 3 - this.ventHp.filter((h) => h > 0).length; // 0, 1, 2
  }

  private setVentGlow() {
    for (let i = 0; i < 3; i++) {
      const alive = this.ventHp[i] > 0;
      const k = !alive ? 0.08 : i === this.open ? 1.6 : 0.35;
      this.ventMats[i].color.setRGB(5 * k, 1.8 * k, 0.3 * k);
    }
  }

  private ventWorld(i: number, out: THREE.Vector3) {
    return (this.parts[`vent${i}`] as THREE.Object3D).getWorldPosition(out);
  }

  wake(ctx: EnemyCtx) {
    super.wake(ctx);
    if (!this.announced) {
      this.announced = true;
      ctx.message('HEARTFORGE', 'Hit the open vents', 3);
      ctx.sfx.roar(this.pos);
    }
  }

  protected think(ctx: EnemyCtx, dt: number) {
    // Beam mesh lives in the scene (so it isn't rotated by the spinning core).
    if (!this.beam.parent && this.mesh.parent) this.mesh.parent.add(this.beam);
    const spin = this.parts.spin;
    spin.rotation.y += dt * (0.25 + this.phase * 0.12);

    // Shutters slide toward their target (open or closed).
    for (let i = 0; i < 6; i++) {
      const s = this.parts[`shutter${i}`];
      const vent = i >> 1;
      const open = vent === this.open && this.ventHp[vent] > 0;
      const target = s.userData.side * (open ? 2.9 : 1.1);
      s.position.x += (target - s.position.x) * Math.min(1, dt * 6);
    }
    if (!this.awake) return;

    // Vent cycle: open the next living vent for a few seconds, then close.
    this.ventTimer -= dt;
    if (this.ventTimer <= 0) {
      if (this.open >= 0) {
        this.open = -1;
        this.ventTimer = 1.6;
      } else {
        const alive = [0, 1, 2].filter((i) => this.ventHp[i] > 0);
        this.open = alive[Math.floor(Math.random() * alive.length)];
        this.ventTimer = 4.5 - this.phase * 0.5;
      }
      this.setVentGlow();
    }
    if (!this.sees && this.unseenFor > 3) {
      this.endBeam();
      return;
    }

    // Aimed shots from the core.
    this.cooldown -= dt;
    if (this.cooldown <= 0) {
      this.cooldown = rand(1.0, 1.5) - this.phase * 0.15;
      _a.subVectors(ctx.player.pos, this.pos).normalize().multiplyScalar(9);
      this.mesh.worldToLocal(_a.add(this.pos));
      this.shootAt(ctx, _a, { speed: 85, dmg: 7, color: 'orange', size: 1.3 }, 2);
    }

    // Ring of bolts in the core's equatorial plane: dodge by moving up or down.
    this.ringTimer -= dt;
    if (this.ringTimer <= 0) {
      this.ringTimer = 4.2 - this.phase * 0.6;
      this.ringPhase += 0.37;
      const n = 14 + this.phase * 4;
      _q.copy(this.mesh.quaternion);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + this.ringPhase;
        const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).applyQuaternion(_q);
        ctx.fire(_b.copy(this.pos).addScaledVector(dir, 9).clone(), dir, { speed: 38, dmg: 9, color: 'orange', size: 1.4, life: 4 });
      }
      ctx.sfx.enemyShot(this.pos);
    }

    // Phase 2+: launch Embers.
    if (this.phase >= 1) {
      this.spawnTimer -= dt;
      this.launched = this.launched.filter((e) => e.hp > 0 && ctx.enemies.includes(e));
      if (this.spawnTimer <= 0 && this.launched.length < 3) {
        this.spawnTimer = 7 - this.phase;
        _a.subVectors(ctx.player.pos, this.pos).normalize();
        const e = new Ember(_b.copy(this.pos).addScaledVector(_a, 12).clone(), 'mine');
        e.alertTo(ctx, ctx.player.pos);
        e.vel.copy(_a).multiplyScalar(20);
        ctx.spawn(e);
        this.launched.push(e);
      }
    }

    // Phase 3: sweeping beam.
    if (this.phase >= 2) this.updateBeam(ctx, dt);
  }

  private updateBeam(ctx: EnemyCtx, dt: number) {
    this.beamTimer -= dt;
    const toP = _a.subVectors(ctx.player.pos, this.pos).normalize();
    if (this.beamState === 'idle') {
      if (this.beamTimer <= 0) {
        this.beamState = 'warn';
        this.beamTimer = 1.2;
        // Start off to one side of the player and sweep across.
        this.beamDir.copy(toP).applyAxisAngle(ctx.mineUp, rand(0.5, 0.8) * (Math.random() < 0.5 ? -1 : 1));
        ctx.sfx.charge(this.pos);
      }
      return;
    }
    // Sweep toward the player.
    const rate = this.beamState === 'warn' ? 0.15 : 0.42;
    const ang = this.beamDir.angleTo(toP);
    if (ang > 1e-3) {
      _b.crossVectors(this.beamDir, toP).normalize();
      this.beamDir.applyAxisAngle(_b, Math.min(ang, rate * dt));
    }
    // Length: until it hits rock.
    let len = 8;
    while (len < 90 && !ctx.world.blocks(_c.copy(this.pos).addScaledVector(this.beamDir, len))) len += 3;
    this.beam.visible = true;
    this.beam.position.copy(this.pos);
    this.beam.quaternion.setFromUnitVectors(_c.set(0, 0, 1), this.beamDir);
    const warn = this.beamState === 'warn';
    const w = warn ? 0.25 : 1 + Math.sin(ctx.time * 40) * 0.15;
    this.beam.scale.set(w, w, len);
    this.beamMat.opacity = warn ? 0.35 : 1;

    if (!warn) {
      // Damage if the player is near the beam line.
      _b.copy(this.pos).addScaledVector(this.beamDir, len);
      const p = closestOnSegment(this.pos, _b, ctx.player.pos, _c);
      this.hurtTick -= dt;
      if (p.distanceTo(ctx.player.pos) < 2.4 + ctx.player.radius && this.hurtTick <= 0) {
        this.hurtTick = 0.2;
        ctx.hurtPlayer(7);
      }
    }
    if (this.beamTimer <= 0) {
      if (warn) {
        this.beamState = 'fire';
        this.beamTimer = 3.2;
        ctx.sfx.roar(this.pos);
      } else this.endBeam();
    }
  }

  private endBeam() {
    if (this.beamState === 'idle') return;
    this.beamState = 'idle';
    this.beamTimer = 5;
    this.beam.visible = false;
  }

  takeHit(dmg: number, from: THREE.Vector3, at: THREE.Vector3, ctx: EnemyCtx) {
    if (!this.awake) this.wake(ctx);
    this.alertTo(ctx, ctx.player.pos);
    if (this.open >= 0) {
      const v = this.ventWorld(this.open, _a);
      if (closestOnSegment(from, at, v, _b).distanceTo(v) < 3.2) {
        const i = this.open;
        const done = Math.min(dmg, this.ventHp[i]);
        this.ventHp[i] -= done;
        this.hp = this.ventHp.reduce((s, h) => s + Math.max(0, h), 0);
        if (this.ventHp[i] <= 0) {
          // Vent destroyed: blow it out and step up the fight.
          ctx.explode(v, 1.6);
          this.open = -1;
          this.ventTimer = 1.5;
          this.setVentGlow();
          if (this.hp > 0) {
            ctx.sfx.roar(this.pos);
            ctx.message('', this.phase === 1 ? 'VENT DESTROYED · launch bays open' : 'VENT DESTROYED · beam online', 2.5);
          }
        }
        return done;
      }
    }
    ctx.sparks(at, 0xffc080, 5);
    ctx.sfx.deflect(at);
    return 0;
  }

  onDeath(ctx: EnemyCtx) {
    this.endBeam();
    for (let i = 0; i < 4; i++) ctx.explode(_a.copy(this.pos).addScaledVector(_b.randomDirection(), 6), 2);
    ctx.message('HEARTFORGE DESTROYED', 'The way to the reactor is open', 4);
  }

  dispose() {
    super.dispose();
    this.beam.removeFromParent();
    this.beamMat.dispose();
    for (const m of this.ventMats) m.dispose();
  }
}
