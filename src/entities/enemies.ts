import * as THREE from 'three';
import type { SoundEngine } from '../audio/soundEngine';
import { isPointInsideMine, resolveMineCollision, type GeneratedMine } from '../world/mineGenerator';

export type EnemyKind = 'interceptor' | 'striker' | 'turret' | 'mine' | 'drone';

export interface EnemyEntity {
  id: string;
  kind: EnemyKind;
  name: string;
  group: THREE.Group;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  hp: number;
  maxHp: number;
  fireCooldown: number;
  aiPhase: number;
  hitFlash: number;
  scrapValue: number;
  coreChance: number;
  turretHead?: THREE.Object3D;
  anchorNormal?: THREE.Vector3;
  armedPulse?: number;
}

export interface ProjectileEntity {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  fromPlayer: boolean;
  isMissile: boolean;
  damage: number;
  life: number;
  radius: number;
  targetEnemyId?: string;
}

export interface LootPickup {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  kind: 'scrap' | 'hull' | 'core' | 'missile';
  value: number;
  life: number;
}

interface ExplosionParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

let nextEntityId = 1;

export class CombatWorld {
  public readonly group = new THREE.Group();
  public enemies: EnemyEntity[] = [];
  public projectiles: ProjectileEntity[] = [];
  public pickups: LootPickup[] = [];
  private particles: ExplosionParticle[] = [];

  // Shared geometries & materials for smooth mobile framerate
  private playerLaserGeo = new THREE.CylinderGeometry(0.11, 0.11, 4.2, 6).rotateX(Math.PI / 2);
  private playerLaserMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  private enemyBoltGeo = new THREE.SphereGeometry(0.45, 8, 8);
  private enemyBoltMat = new THREE.MeshBasicMaterial({ color: 0xff4d6d });
  private missileGeo = new THREE.ConeGeometry(0.32, 1.8, 6).rotateX(Math.PI / 2);
  private missileMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  private particleGeo = new THREE.OctahedronGeometry(0.45, 0);

  public clear(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.clear();
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.particles = [];
    scene.add(this.group);
  }

  public spawnSpaceEnemy(kind: 'interceptor' | 'striker', pos: THREE.Vector3, sectorIndex: number): EnemyEntity {
    const group = new THREE.Group();
    group.position.copy(pos);

    const scaleMult = 1 + (sectorIndex - 1) * 0.25;
    const isStriker = kind === 'striker';

    const hullMat = new THREE.MeshStandardMaterial({
      color: isStriker ? 0x7f1d1d : 0x3f1d38,
      metalness: 0.7,
      roughness: 0.3
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: isStriker ? 0xf97316 : 0xf43f5e
    });

    if (isStriker) {
      // Heavy twin-hull fighter
      const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.5, 5.2), hullMat);
      const wingL = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.35, 2.2), hullMat);
      wingL.position.set(0, 0, 0.6);
      const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), glowMat);
      cockpit.position.set(0, 0.55, -1.4);
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.9, 8).rotateX(Math.PI / 2), glowMat);
      engine.position.set(0, 0, 2.8);
      group.add(body, wingL, cockpit, engine);
    } else {
      // Agile dart interceptor
      const fuselage = new THREE.Mesh(new THREE.ConeGeometry(1.4, 5.4, 6).rotateX(-Math.PI / 2), hullMat);
      const wings = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.22, 1.5), hullMat);
      wings.position.set(0, 0, 0.8);
      const canopy = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), glowMat);
      canopy.position.set(0, 0.45, -0.5);
      const thruster = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), glowMat);
      thruster.position.set(0, 0, 2.6);
      group.add(fuselage, wings, canopy, thruster);
    }

    this.group.add(group);
    const maxHp = Math.round((isStriker ? 95 : 52) * scaleMult);
    const entity: EnemyEntity = {
      id: `e-${nextEntityId++}`,
      kind,
      name: isStriker ? 'Raider Striker' : 'Viper Interceptor',
      group,
      position: pos.clone(),
      velocity: new THREE.Vector3(),
      radius: isStriker ? 3.5 : 2.8,
      hp: maxHp,
      maxHp,
      fireCooldown: 1.0 + Math.random() * 1.4,
      aiPhase: Math.random() * Math.PI * 2,
      hitFlash: 0,
      scrapValue: Math.round((isStriker ? 34 : 18) * scaleMult),
      coreChance: isStriker ? 0.3 : 0.08
    };
    this.enemies.push(entity);
    return entity;
  }

  public spawnMineHazard(
    kind: 'mine' | 'turret' | 'drone',
    pos: THREE.Vector3,
    normal: THREE.Vector3,
    threatLevel: number
  ): EnemyEntity {
    const group = new THREE.Group();
    group.position.copy(pos);
    const scaleMult = 1 + (threatLevel - 1) * 0.22;

    let turretHead: THREE.Object3D | undefined;
    let radius = 2.0;
    let maxHp = 35;
    let name = 'Proximity Mine';
    let scrapValue = 12;

    if (kind === 'mine') {
      const coreMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        emissive: 0xef4444,
        emissiveIntensity: 1.2,
        metalness: 0.8,
        roughness: 0.25
      });
      const sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 0), coreMat);
      const spikeGeo = new THREE.ConeGeometry(0.28, 1.2, 5);
      const spikeMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
      const dirs = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1]
      ];
      for (const [dx, dy, dz] of dirs) {
        const s = new THREE.Mesh(spikeGeo, spikeMat);
        s.position.set(dx * 1.6, dy * 1.6, dz * 1.6);
        s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz));
        sphere.add(s);
      }
      group.add(sphere);
      radius = 2.0;
      maxHp = Math.round(28 * scaleMult);
      scrapValue = Math.round(12 * scaleMult);
      name = 'Proximity Mine';
    } else if (kind === 'turret') {
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0x475569,
        metalness: 0.8,
        roughness: 0.3
      });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 1.1, 8), baseMat);
      base.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone().normalize());
      group.add(base);

      const head = new THREE.Group();
      const pod = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 1.2, 1.8),
        new THREE.MeshStandardMaterial({
          color: 0x991b1b,
          emissive: 0xef4444,
          emissiveIntensity: 0.6,
          metalness: 0.65,
          roughness: 0.3
        })
      );
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.22, 2.2, 6).rotateX(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xf97316 })
      );
      barrel.position.set(0, 0, 1.3);
      head.add(pod, barrel);
      head.position.copy(normal).multiplyScalar(0.9);
      group.add(head);
      turretHead = head;
      radius = 2.1;
      maxHp = Math.round(52 * scaleMult);
      scrapValue = Math.round(20 * scaleMult);
      name = 'Defense Turret';
    } else {
      // Mine Security Drone
      const body = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.65, 1),
        new THREE.MeshStandardMaterial({
          color: 0x312e81,
          emissive: 0xc026d3,
          emissiveIntensity: 0.9,
          metalness: 0.75,
          roughness: 0.25
        })
      );
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.1, 0.16, 6, 18),
        new THREE.MeshBasicMaterial({ color: 0xe879f9 })
      );
      group.add(body, ring);
      radius = 2.2;
      maxHp = Math.round(62 * scaleMult);
      scrapValue = Math.round(25 * scaleMult);
      name = 'Mine Sentinel';
    }

    this.group.add(group);
    const entity: EnemyEntity = {
      id: `m-${nextEntityId++}`,
      kind,
      name,
      group,
      position: pos.clone(),
      velocity: new THREE.Vector3(),
      radius,
      hp: maxHp,
      maxHp,
      fireCooldown: 0.8 + Math.random() * 1.4,
      aiPhase: Math.random() * Math.PI * 2,
      hitFlash: 0,
      scrapValue,
      coreChance: kind === 'drone' ? 0.22 : 0.06,
      turretHead,
      anchorNormal: normal.clone(),
      armedPulse: 0
    };
    this.enemies.push(entity);
    return entity;
  }

  public spawnLoot(pos: THREE.Vector3, kind: LootPickup['kind'], value: number): void {
    const colorMap: Record<LootPickup['kind'], number> = {
      scrap: 0xfbbf24,
      hull: 0x34d399,
      core: 0xa78bfa,
      missile: 0xf97316
    };
    const geo =
      kind === 'core'
        ? new THREE.OctahedronGeometry(1.15, 0)
        : new THREE.BoxGeometry(1.1, 1.1, 1.1);
    const mat = new THREE.MeshStandardMaterial({
      color: colorMap[kind],
      emissive: colorMap[kind],
      emissiveIntensity: 1.4,
      metalness: 0.4,
      roughness: 0.2
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    this.group.add(mesh);

    this.pickups.push({
      mesh,
      position: pos.clone(),
      kind,
      value,
      life: 45
    });
  }

  public firePlayerLaser(
    muzzles: THREE.Vector3[],
    direction: THREE.Vector3,
    damage: number,
    shipVelocity: THREE.Vector3
  ): void {
    const speed = 260;
    const perBoltDamage = muzzles.length === 3 ? damage * 0.46 : damage * 0.6;
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      direction.clone().normalize()
    );

    for (const origin of muzzles) {
      const mesh = new THREE.Mesh(this.playerLaserGeo, this.playerLaserMat);
      mesh.position.copy(origin);
      mesh.quaternion.copy(quat);
      this.group.add(mesh);

      this.projectiles.push({
        mesh,
        position: origin.clone(),
        velocity: direction.clone().normalize().multiplyScalar(speed).addScaledVector(shipVelocity, 0.35),
        fromPlayer: true,
        isMissile: false,
        damage: perBoltDamage,
        life: 2.1,
        radius: 0.9
      });
    }
  }

  public firePlayerMissile(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    damage: number,
    targetEnemyId?: string
  ): void {
    const mesh = new THREE.Mesh(this.missileGeo, this.missileMat);
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      direction.clone().normalize()
    );
    this.group.add(mesh);

    this.projectiles.push({
      mesh,
      position: origin.clone(),
      velocity: direction.clone().normalize().multiplyScalar(115),
      fromPlayer: true,
      isMissile: true,
      damage,
      life: 5.0,
      radius: 1.5,
      targetEnemyId
    });
  }

  public fireEnemyBolt(origin: THREE.Vector3, direction: THREE.Vector3, damage: number, speed: number): void {
    const mesh = new THREE.Mesh(this.enemyBoltGeo, this.enemyBoltMat);
    mesh.position.copy(origin);
    this.group.add(mesh);

    this.projectiles.push({
      mesh,
      position: origin.clone(),
      velocity: direction.clone().normalize().multiplyScalar(speed),
      fromPlayer: false,
      isMissile: false,
      damage,
      life: 4.0,
      radius: 0.85
    });
  }

  public spawnExplosion(pos: THREE.Vector3, colorHex = 0xf97316, count = 18, scale = 1): void {
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.particleGeo, mat);
      mesh.position.copy(pos);
      mesh.scale.setScalar((0.5 + Math.random() * 1.1) * scale);
      this.group.add(mesh);

      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      )
        .normalize()
        .multiplyScalar((14 + Math.random() * 34) * scale);

      const maxLife = 0.45 + Math.random() * 0.45;
      this.particles.push({
        mesh,
        velocity: dir,
        life: maxLife,
        maxLife
      });
    }
  }

  public findBestTargetInCone(
    playerPos: THREE.Vector3,
    playerFwd: THREE.Vector3,
    maxDist: number,
    minDot: number
  ): EnemyEntity | null {
    let best: EnemyEntity | null = null;
    let bestScore = -Infinity;
    for (const e of this.enemies) {
      const toE = e.position.clone().sub(playerPos);
      const dist = toE.length();
      if (dist > maxDist || dist < 1) continue;
      const dot = toE.divideScalar(dist).dot(playerFwd);
      if (dot < minDot) continue;
      const score = dot * 2 - dist / maxDist;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  public update(
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    playerRadius: number,
    magnetRange: number,
    lootMult: number,
    sectorIndex: number,
    mine: GeneratedMine | null,
    reactorPos: THREE.Vector3 | null,
    reactorAlive: boolean,
    sound: SoundEngine,
    callbacks: {
      onPlayerDamaged: (amount: number) => void;
      onEnemyKilled: (enemy: EnemyEntity) => void;
      onReactorHit: (damage: number) => void;
      onPickupCollected: (kind: LootPickup['kind'], value: number) => void;
    }
  ): void {
    // 1. Update Enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const toPlayer = playerPos.clone().sub(e.position);
      const dist = toPlayer.length();
      const dirToPlayer = dist > 0.001 ? toPlayer.clone().divideScalar(dist) : new THREE.Vector3(0, 0, -1);

      if (e.hitFlash > 0) {
        e.hitFlash -= dt;
        e.group.scale.setScalar(1 + e.hitFlash * 0.35);
      } else {
        e.group.scale.setScalar(1);
      }

      if (e.kind === 'interceptor' || e.kind === 'striker') {
        const desiredDist = e.kind === 'striker' ? 58 : 42;
        const speed = e.kind === 'striker' ? 24 : 34;

        // Orbit & strafe around player
        const strafeDir = new THREE.Vector3(-dirToPlayer.z, Math.sin(elapsed * 1.1 + e.aiPhase) * 0.45, dirToPlayer.x).normalize();
        const moveVec = new THREE.Vector3();
        if (dist > desiredDist + 14) {
          moveVec.addScaledVector(dirToPlayer, 1.0);
        } else if (dist < desiredDist - 12) {
          moveVec.addScaledVector(dirToPlayer, -0.75);
        }
        moveVec.addScaledVector(strafeDir, 0.85 * Math.sin(elapsed * 0.6 + e.aiPhase));
        if (moveVec.lengthSq() > 0.01) moveVec.normalize();

        e.velocity.lerp(moveVec.multiplyScalar(speed), Math.min(1, dt * 2.4));
        e.position.addScaledVector(e.velocity, dt);
        e.group.position.copy(e.position);
        e.group.lookAt(playerPos);

        // Fire plasma back at player when within range
        e.fireCooldown -= dt;
        if (dist < 220 && e.fireCooldown <= 0) {
          e.fireCooldown = (e.kind === 'striker' ? 1.55 : 1.9) / (1 + (sectorIndex - 1) * 0.08);
          const leadPos = playerPos.clone().addScaledVector(playerVel, Math.min(0.6, dist / 150));
          const aimDir = leadPos.sub(e.position).normalize();
          const dmg = Math.round((e.kind === 'striker' ? 13 : 9) * (1 + (sectorIndex - 1) * 0.16));
          this.fireEnemyBolt(e.position.clone().addScaledVector(aimDir, 3), aimDir, dmg, 128);
          if (dist < 150) sound.playEnemyShot();
        }
      } else if (e.kind === 'mine') {
        e.group.rotation.y += dt * 0.9;
        e.group.rotation.x += dt * 0.5;
        // Proximity homing pull when player gets close
        if (dist < 17) {
          e.armedPulse = (e.armedPulse ?? 0) + dt * 10;
          e.group.scale.setScalar(1 + Math.sin(e.armedPulse) * 0.14);
          e.position.addScaledVector(dirToPlayer, 9.5 * dt);
          e.group.position.copy(e.position);
        }
        if (dist < e.radius + playerRadius + 1.4) {
          // Detonate!
          this.spawnExplosion(e.position, 0xff3b30, 22, 1.3);
          sound.playExplosion(true);
          callbacks.onPlayerDamaged(24 + sectorIndex * 4);
          this.group.remove(e.group);
          this.enemies.splice(i, 1);
          continue;
        }
      } else if (e.kind === 'turret') {
        if (e.turretHead && dist < 75) {
          e.turretHead.lookAt(playerPos);
        }
        e.fireCooldown -= dt;
        if (dist < 56 && e.fireCooldown <= 0) {
          e.fireCooldown = Math.max(0.85, 1.65 - sectorIndex * 0.1);
          const dmg = Math.round(9 + sectorIndex * 2);
          this.fireEnemyBolt(e.position.clone().addScaledVector(dirToPlayer, 2.2), dirToPlayer, dmg, 95);
          sound.playEnemyShot();
        }
      } else if (e.kind === 'drone') {
        e.group.rotation.y += dt * 2.2;
        if (dist < 62) {
          const desired = dist > 20 ? dirToPlayer : dirToPlayer.clone().negate();
          const wobble = new THREE.Vector3(Math.cos(elapsed * 2 + e.aiPhase), Math.sin(elapsed * 2.5 + e.aiPhase), 0);
          e.velocity.lerp(desired.multiplyScalar(14).addScaledVector(wobble, 5), Math.min(1, dt * 3));
          e.position.addScaledVector(e.velocity, dt);
          if (mine) {
            resolveMineCollision(mine, e.position, e.velocity, e.radius);
          }
          e.group.position.copy(e.position);

          e.fireCooldown -= dt;
          if (dist < 54 && e.fireCooldown <= 0) {
            e.fireCooldown = Math.max(0.95, 1.75 - sectorIndex * 0.1);
            this.fireEnemyBolt(e.position.clone().addScaledVector(dirToPlayer, 2.2), dirToPlayer, 10 + sectorIndex * 2, 102);
            sound.playEnemyShot();
          }
        }
      }
    }

    // 2. Update Projectiles & Hit Detection
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;

      // Homing guidance for player missiles
      if (p.isMissile && p.fromPlayer) {
        let targetPos: THREE.Vector3 | null = null;
        if (p.targetEnemyId) {
          const te = this.enemies.find((e) => e.id === p.targetEnemyId);
          if (te) targetPos = te.position;
        }
        if (!targetPos && reactorAlive && reactorPos) {
          targetPos = reactorPos;
        }
        if (targetPos) {
          const desired = targetPos.clone().sub(p.position).normalize().multiplyScalar(135);
          p.velocity.lerp(desired, Math.min(1, dt * 5.2));
          p.mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, -1),
            p.velocity.clone().normalize()
          );
        }
      }

      p.position.addScaledVector(p.velocity, dt);
      p.mesh.position.copy(p.position);

      let remove = p.life <= 0;

      // Stop projectiles on mine walls
      if (!remove && mine && !isPointInsideMine(mine, p.position)) {
        this.spawnExplosion(p.position, p.fromPlayer ? 0x38bdf8 : 0xff4d6d, 5, 0.45);
        remove = true;
      }

      // Check Player Projectile vs Enemies & Reactor
      if (!remove && p.fromPlayer) {
        for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
          const e = this.enemies[ei];
          const hitDist = e.radius + p.radius + (p.isMissile ? 1.4 : 0.4);
          if (p.position.distanceTo(e.position) <= hitDist) {
            e.hp -= p.damage;
            e.hitFlash = 0.2;
            remove = true;
            this.spawnExplosion(p.position, p.isMissile ? 0xfacc15 : 0x38bdf8, p.isMissile ? 14 : 6, p.isMissile ? 0.9 : 0.5);

            if (e.hp <= 0) {
              this.spawnExplosion(e.position, 0xf97316, 20, e.kind === 'striker' ? 1.4 : 1.0);
              sound.playExplosion(e.kind === 'striker' || e.kind === 'mine');

              // Chain-blast damage if a proximity mine is shot!
              if (e.kind === 'mine') {
                for (const other of this.enemies) {
                  if (other.id !== e.id && other.position.distanceTo(e.position) < 16) {
                    other.hp -= 45;
                  }
                }
              }

              // Drop loot
              const scrapVal = Math.max(5, Math.round(e.scrapValue * lootMult));
              this.spawnLoot(e.position, 'scrap', scrapVal);
              if (Math.random() < e.coreChance) {
                this.spawnLoot(e.position.clone().add(new THREE.Vector3(1.5, 0.8, 0)), 'core', 1);
              } else if (Math.random() < 0.28) {
                this.spawnLoot(e.position.clone().add(new THREE.Vector3(-1.4, 0.6, 0)), 'hull', 22);
              } else if (Math.random() < 0.22) {
                this.spawnLoot(e.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 'missile', 2);
              }

              this.group.remove(e.group);
              this.enemies.splice(ei, 1);
              callbacks.onEnemyKilled(e);
            } else {
              sound.playHit(false);
            }
            break;
          }
        }

        // Check Reactor Hit inside Mine
        if (!remove && reactorAlive && reactorPos && p.position.distanceTo(reactorPos) <= 5.4 + p.radius) {
          remove = true;
          this.spawnExplosion(p.position, 0xf97316, 8, 0.7);
          callbacks.onReactorHit(p.damage);
        }
      } else if (!remove && !p.fromPlayer) {
        // Enemy bolt vs Player
        if (p.position.distanceTo(playerPos) <= playerRadius + p.radius) {
          remove = true;
          callbacks.onPlayerDamaged(p.damage);
        }
      }

      if (remove) {
        this.group.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    // 3. Update Loot Pickups (Magnetic Tractor Pull!)
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.life -= dt;
      pk.mesh.rotation.y += dt * 2.4;
      pk.mesh.rotation.x += dt * 1.4;

      const toPlayer = playerPos.clone().sub(pk.position);
      const dist = toPlayer.length();
      if (dist < magnetRange && dist > 0.01) {
        const pullSpeed = 24 + (1 - dist / magnetRange) * 65;
        pk.position.addScaledVector(toPlayer.divideScalar(dist), pullSpeed * dt);
        pk.mesh.position.copy(pk.position);
      }

      if (dist < playerRadius + 2.6) {
        callbacks.onPickupCollected(pk.kind, pk.value);
        this.group.remove(pk.mesh);
        pk.mesh.geometry.dispose();
        (pk.mesh.material as THREE.Material).dispose();
        this.pickups.splice(i, 1);
        continue;
      }

      if (pk.life <= 0) {
        this.group.remove(pk.mesh);
        pk.mesh.geometry.dispose();
        (pk.mesh.material as THREE.Material).dispose();
        this.pickups.splice(i, 1);
      }
    }

    // 4. Update Explosion Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.group.remove(pt.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      pt.mesh.position.addScaledVector(pt.velocity, dt);
      pt.velocity.multiplyScalar(0.95);
      const ratio = pt.life / pt.maxLife;
      pt.mesh.scale.setScalar(ratio * 1.1);
    }
  }
}
