import * as THREE from 'three';
import type { InputState, ShipComputedStats } from '../types';

export class PlayerShip {
  public position = new THREE.Vector3(0, 0, 0);
  public velocity = new THREE.Vector3(0, 0, 0);
  public quaternion = new THREE.Quaternion();
  public radius = 2.4;

  public hull = 110;
  public shield = 75;
  public energy = 100;
  public missiles = 4;

  public fireCooldown = 0;
  public shieldDelayTimer = 0;
  public damageFlash = 0;
  public screenShake = 0;
  public flightAssist = true;
  public isBoosting = false;

  // Cockpit / Weapon Viewmodel attached to camera
  public readonly cockpitGroup = new THREE.Group();
  private leftBarrel: THREE.Mesh;
  private rightBarrel: THREE.Mesh;
  private centerBarrel: THREE.Mesh;
  private muzzleFlash: THREE.PointLight;
  private muzzleTimer = 0;
  private barrelRecoil = 0;
  private shipLight: THREE.PointLight;

  // Reusable math helpers
  private tmpRight = new THREE.Vector3();
  private tmpUp = new THREE.Vector3();
  private tmpForward = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private tmpAxisX = new THREE.Vector3(1, 0, 0);
  private tmpAxisY = new THREE.Vector3(0, 1, 0);
  private tmpAxisZ = new THREE.Vector3(0, 0, 1);

  constructor() {
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.25
    });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

    // Sleek lower cockpit canopy frame + twin/triple laser barrels visible in FPS view
    const dash = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.22, 0.85), metalMat);
    dash.position.set(0, -0.96, -1.35);
    dash.rotation.x = 0.22;
    this.cockpitGroup.add(dash);

    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.022, 0.03),
      new THREE.MeshBasicMaterial({ color: 0x0ea5e9 })
    );
    trim.position.set(0, -0.84, -1.24);
    this.cockpitGroup.add(trim);

    const barrelGeo = new THREE.CylinderGeometry(0.055, 0.075, 1.35, 8);
    barrelGeo.rotateX(Math.PI / 2);

    this.leftBarrel = new THREE.Mesh(barrelGeo, metalMat);
    this.leftBarrel.position.set(-0.88, -0.5, -1.45);
    const leftTip = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 8).rotateX(Math.PI / 2), glowMat);
    leftTip.position.set(0, 0, -0.68);
    this.leftBarrel.add(leftTip);

    this.rightBarrel = new THREE.Mesh(barrelGeo, metalMat);
    this.rightBarrel.position.set(0.88, -0.5, -1.45);
    const rightTip = leftTip.clone();
    this.rightBarrel.add(rightTip);

    this.centerBarrel = new THREE.Mesh(barrelGeo, metalMat);
    this.centerBarrel.position.set(0, -0.64, -1.55);
    const centerTip = leftTip.clone();
    this.centerBarrel.add(centerTip);
    this.centerBarrel.visible = false;

    this.muzzleFlash = new THREE.PointLight(0x38bdf8, 0, 18);
    this.muzzleFlash.position.set(0, -0.35, -2.1);

    // Headlamp so dark Descent mine tunnels illuminate cleanly in front of the ship
    this.shipLight = new THREE.PointLight(0xdbeafe, 46, 78, 1.3);
    this.shipLight.position.set(0, 0.2, -1.0);

    this.cockpitGroup.add(
      this.leftBarrel,
      this.rightBarrel,
      this.centerBarrel,
      this.muzzleFlash,
      this.shipLight
    );
  }

  public syncStats(stats: ShipComputedStats, fullHeal = false): void {
    this.centerBarrel.visible = stats.laserBarrels === 3;
    if (fullHeal) {
      this.hull = stats.maxHull;
      this.shield = stats.maxShield;
      this.energy = stats.maxEnergy;
      this.missiles = stats.maxMissiles;
    } else {
      this.hull = Math.min(this.hull, stats.maxHull);
      this.shield = Math.min(this.shield, stats.maxShield);
      this.energy = Math.min(this.energy, stats.maxEnergy);
      this.missiles = Math.min(this.missiles, stats.maxMissiles);
    }
  }

  public resetPose(pos: THREE.Vector3, lookAt?: THREE.Vector3): void {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    if (lookAt) {
      const m = new THREE.Matrix4().lookAt(pos, lookAt, new THREE.Vector3(0, 1, 0));
      this.quaternion.setFromRotationMatrix(m);
    } else {
      this.quaternion.identity();
    }
  }

  public getForward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
  }

  public getRight(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();
  }

  public getUp(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 1, 0).applyQuaternion(this.quaternion).normalize();
  }

  public getMuzzlePositions(triple: boolean): THREE.Vector3[] {
    const fwd = this.getForward(new THREE.Vector3());
    const right = this.getRight(new THREE.Vector3());
    const up = this.getUp(new THREE.Vector3());

    const left = this.position
      .clone()
      .addScaledVector(fwd, 2.3)
      .addScaledVector(right, -0.95)
      .addScaledVector(up, -0.45);
    const rightP = this.position
      .clone()
      .addScaledVector(fwd, 2.3)
      .addScaledVector(right, 0.95)
      .addScaledVector(up, -0.45);

    if (triple) {
      const mid = this.position
        .clone()
        .addScaledVector(fwd, 2.5)
        .addScaledVector(up, -0.6);
      return [left, rightP, mid];
    }
    return [left, rightP];
  }

  public triggerMuzzleFlash(): void {
    this.muzzleTimer = 0.06;
    this.barrelRecoil = 0.22;
  }

  public applyDamage(amount: number): { shielded: boolean; destroyed: boolean } {
    this.shieldDelayTimer = 3.2;
    this.damageFlash = Math.min(1, this.damageFlash + 0.55);
    this.screenShake = Math.min(1.2, this.screenShake + 0.45);

    let shielded = false;
    if (this.shield > 0) {
      shielded = true;
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
    }

    if (amount > 0) {
      this.hull = Math.max(0, this.hull - amount);
    }

    return { shielded, destroyed: this.hull <= 0 };
  }

  public update(dt: number, input: InputState, stats: ShipComputedStats, inMine: boolean): void {
    // 1. Quaternion 6-DoF Rotational Control (no gimbal lock!)
    const stickTurnSpeed = 2.15;
    const rollSpeed = 2.05;

    const pitchAngle = input.pitchDelta + input.pitchRate * stickTurnSpeed * dt;
    const yawAngle = input.yawDelta + input.yawRate * stickTurnSpeed * dt;
    const rollAngle = input.roll * rollSpeed * dt;

    if (yawAngle !== 0) {
      this.tmpQuat.setFromAxisAngle(this.tmpAxisY, yawAngle);
      this.quaternion.multiply(this.tmpQuat);
    }
    if (pitchAngle !== 0) {
      this.tmpQuat.setFromAxisAngle(this.tmpAxisX, pitchAngle);
      this.quaternion.multiply(this.tmpQuat);
    }
    if (rollAngle !== 0) {
      this.tmpQuat.setFromAxisAngle(this.tmpAxisZ, rollAngle);
      this.quaternion.multiply(this.tmpQuat);
    }
    this.quaternion.normalize();

    // 2. 6-DoF Linear Thrust
    this.tmpForward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.tmpRight.set(1, 0, 0).applyQuaternion(this.quaternion);
    this.tmpUp.set(0, 1, 0).applyQuaternion(this.quaternion);

    const wantsBoost = input.boost && this.energy > 6 && (Math.abs(input.forward) > 0.05 || Math.abs(input.strafe) > 0.05 || Math.abs(input.vertical) > 0.05);
    this.isBoosting = wantsBoost;

    const modeSpeedScale = inMine ? 0.62 : 1.0;
    const boostMult = wantsBoost ? stats.boostMultiplier : 1.0;
    const maxSpeed = stats.maxSpeed * modeSpeedScale * boostMult;
    const accel = stats.acceleration * modeSpeedScale * (wantsBoost ? 1.55 : 1.0);

    if (wantsBoost) {
      this.energy = Math.max(0, this.energy - 28 * dt);
    } else {
      this.energy = Math.min(stats.maxEnergy, this.energy + stats.energyRegenRate * dt);
    }

    const thrustVec = new THREE.Vector3();
    thrustVec.addScaledVector(this.tmpForward, input.forward);
    thrustVec.addScaledVector(this.tmpRight, input.strafe);
    thrustVec.addScaledVector(this.tmpUp, input.vertical);

    if (thrustVec.lengthSq() > 1) thrustVec.normalize();
    this.velocity.addScaledVector(thrustVec, accel * dt);

    // Inertial Dampeners (Flight Assist)
    const damping = this.flightAssist ? (inMine ? 4.4 : 2.9) : 0.28;
    const dampFactor = Math.exp(-damping * dt);
    if (thrustVec.lengthSq() < 0.01 || this.flightAssist) {
      this.velocity.multiplyScalar(dampFactor);
    }

    const speed = this.velocity.length();
    if (speed > maxSpeed) {
      this.velocity.multiplyScalar(maxSpeed / speed);
    }

    this.position.addScaledVector(this.velocity, dt);

    // 3. Shield & Cooldown Timers
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.shieldDelayTimer > 0) {
      this.shieldDelayTimer -= dt;
    } else if (this.shield < stats.maxShield) {
      this.shield = Math.min(stats.maxShield, this.shield + stats.shieldRegenRate * dt);
    }

    if (this.damageFlash > 0) this.damageFlash = Math.max(0, this.damageFlash - dt * 2.2);
    if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - dt * 2.8);

    // 4. Cockpit Recoil & Inertial Sway
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      this.muzzleFlash.intensity = 10;
    } else {
      this.muzzleFlash.intensity = 0;
    }

    this.barrelRecoil = Math.max(0, this.barrelRecoil - dt * 1.4);
    this.leftBarrel.position.z = -1.45 + this.barrelRecoil;
    this.rightBarrel.position.z = -1.45 + this.barrelRecoil;
    this.centerBarrel.position.z = -1.55 + this.barrelRecoil;

    const targetSwayX = -input.strafe * 0.055;
    const targetSwayY = -input.vertical * 0.045;
    this.cockpitGroup.position.x += (targetSwayX - this.cockpitGroup.position.x) * Math.min(1, dt * 8);
    this.cockpitGroup.position.y += (targetSwayY - this.cockpitGroup.position.y) * Math.min(1, dt * 8);

    // Brighter ship headlamp inside dark underground mines
    this.shipLight.intensity = inMine ? 52 : 8;
  }

  public syncCamera(camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.position);
    camera.quaternion.copy(this.quaternion);

    if (this.screenShake > 0.005) {
      const mag = this.screenShake * 0.35;
      camera.position.x += (Math.random() - 0.5) * mag;
      camera.position.y += (Math.random() - 0.5) * mag;
      camera.position.z += (Math.random() - 0.5) * mag;
    }

    const targetFov = this.isBoosting ? 84 : 74;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * 0.12;
      camera.updateProjectionMatrix();
    }
  }
}
