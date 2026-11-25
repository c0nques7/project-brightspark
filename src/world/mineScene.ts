import * as THREE from 'three';
import type { PlanetData } from '../types';
import { cellCenter, cellKey, type GeneratedMine } from './mineGenerator';
import { createMineWallTexture } from './textures';

export class MineScene {
  public readonly group = new THREE.Group();
  public reactorGroup = new THREE.Group();
  public reactorCoreMesh: THREE.Mesh | null = null;
  public reactorRings: THREE.Mesh[] = [];
  public reactorHp = 220;
  public reactorMaxHp = 220;
  public reactorDestroyed = false;

  public exitPortalGroup = new THREE.Group();
  private exitRing: THREE.Mesh | null = null;
  private escapeChevrons: THREE.Mesh[] = [];
  private tunnelLights: THREE.PointLight[] = [];
  private ambientLight: THREE.AmbientLight | null = null;
  private biomeAccent = 0x38bdf8;
  private hitFlashTimer = 0;

  public build(scene: THREE.Scene, planet: PlanetData, mine: GeneratedMine): void {
    this.dispose(scene);
    this.group.clear();
    this.reactorRings = [];
    this.escapeChevrons = [];
    this.tunnelLights = [];
    this.reactorDestroyed = false;
    this.reactorMaxHp = 180 + planet.threatLevel * 55;
    this.reactorHp = this.reactorMaxHp;
    this.biomeAccent = planet.accentColor;

    scene.background = new THREE.Color(0x06080f);
    scene.fog = new THREE.FogExp2(0x06080f, 0.011);

    this.ambientLight = new THREE.AmbientLight(0xa8c2e0, 1.05);
    this.group.add(this.ambientLight);

    const wallTex = createMineWallTexture(planet.primaryColor, planet.accentColor);
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      emissiveMap: wallTex,
      emissive: new THREE.Color(0x28354d),
      emissiveIntensity: 0.55,
      roughness: 0.62,
      metalness: 0.32
    });

    const strutMat = new THREE.MeshStandardMaterial({
      color: 0x263143,
      roughness: 0.45,
      metalness: 0.72
    });

    const stripMat = new THREE.MeshBasicMaterial({
      color: planet.accentColor
    });

    const cs = mine.cellSize;
    const half = cs * 0.5;
    const wallGeo = new THREE.PlaneGeometry(cs, cs);

    // Build only faces bordering solid rock so every open corridor is seamlessly connected
    const faceSpecs: Array<{
      dx: number;
      dy: number;
      dz: number;
      pos: [number, number, number];
      rot: [number, number, number];
    }> = [
      { dx: 1, dy: 0, dz: 0, pos: [half, 0, 0], rot: [0, -Math.PI / 2, 0] },
      { dx: -1, dy: 0, dz: 0, pos: [-half, 0, 0], rot: [0, Math.PI / 2, 0] },
      { dx: 0, dy: 1, dz: 0, pos: [0, half, 0], rot: [Math.PI / 2, 0, 0] },
      { dx: 0, dy: -1, dz: 0, pos: [0, -half, 0], rot: [-Math.PI / 2, 0, 0] },
      { dx: 0, dy: 0, dz: 1, pos: [0, 0, half], rot: [0, Math.PI, 0] },
      { dx: 0, dy: 0, dz: -1, pos: [0, 0, -half], rot: [0, 0, 0] }
    ];

    const stripGeo = new THREE.BoxGeometry(cs * 0.6, 0.25, 0.25);
    const strutGeo = new THREE.BoxGeometry(cs, 0.7, 0.7);
    let cellIdx = 0;

    for (const c of mine.cells.values()) {
      const center = cellCenter(c, cs);
      cellIdx++;

      for (const f of faceSpecs) {
        if (!mine.cells.has(cellKey(c.x + f.dx, c.y + f.dy, c.z + f.dz))) {
          const panel = new THREE.Mesh(wallGeo, wallMat);
          panel.position.set(center.x + f.pos[0], center.y + f.pos[1], center.z + f.pos[2]);
          panel.rotation.set(f.rot[0], f.rot[1], f.rot[2]);
          this.group.add(panel);

          // Add recessed ceiling/wall neon conduit accents
          if (f.dy === 1 && cellIdx % 2 === 0) {
            const strip = new THREE.Mesh(stripGeo, stripMat);
            strip.position.set(center.x, center.y + half - 0.2, center.z);
            this.group.add(strip);
          }
        }
      }

      // Industrial ceiling rib beams for Descent tunnel depth perception
      if (cellIdx % 2 === 0) {
        const beam = new THREE.Mesh(strutGeo, strutMat);
        beam.position.set(center.x, center.y + half - 0.4, center.z);
        this.group.add(beam);
      }

      // Place selective point lights every ~3 cells (keeping mobile GPU fast)
      if (cellIdx % 3 === 0 && this.tunnelLights.length < 8) {
        const light = new THREE.PointLight(planet.accentColor, 26, cs * 2.6, 1.5);
        light.position.copy(center);
        this.group.add(light);
        this.tunnelLights.push(light);
      }
    }

    // Build Multi-Ring Reactor Core in Reactor Chamber
    this.reactorGroup = new THREE.Group();
    this.reactorGroup.position.copy(mine.reactorPosition);

    const coreGeo = new THREE.IcosahedronGeometry(3.6, 1);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xff5522,
      emissive: 0xff3b00,
      emissiveIntensity: 2.2,
      roughness: 0.2,
      metalness: 0.5
    });
    this.reactorCoreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.reactorGroup.add(this.reactorCoreMesh);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      emissive: 0xf97316,
      emissiveIntensity: 0.9,
      metalness: 0.85,
      roughness: 0.2
    });
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.45, 10, 28), ringMat);
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(6.3, 0.38, 10, 28), ringMat);
    r2.rotation.x = Math.PI / 2;
    this.reactorGroup.add(r1, r2);
    this.reactorRings.push(r1, r2);

    // Support pylons anchoring reactor to floor/ceiling
    const pylonGeo = new THREE.CylinderGeometry(0.65, 0.9, cs * 0.95, 8);
    const pylonMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.8,
      roughness: 0.35
    });
    const pylon = new THREE.Mesh(pylonGeo, pylonMat);
    this.reactorGroup.add(pylon);

    const reactorLight = new THREE.PointLight(0xff4500, 55, cs * 3, 1.4);
    this.reactorGroup.add(reactorLight);
    this.tunnelLights.push(reactorLight);
    this.group.add(this.reactorGroup);

    // Build Exit Airlock Portal at Start Cell
    this.exitPortalGroup = new THREE.Group();
    this.exitPortalGroup.position.copy(mine.exitPosition);

    const exitRingMat = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 1.8,
      metalness: 0.7,
      roughness: 0.25
    });
    this.exitRing = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.55, 12, 32), exitRingMat);
    const exitDisc = new THREE.Mesh(
      new THREE.CircleGeometry(5.0, 24),
      new THREE.MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      })
    );
    const exitLight = new THREE.PointLight(0x10b981, 35, cs * 2.2, 1.4);
    this.exitPortalGroup.add(this.exitRing, exitDisc, exitLight);
    this.group.add(this.exitPortalGroup);

    // Build Escape Breadcrumb Chevrons along escapePath (activated once reactor is destroyed!)
    const chevGeo = new THREE.ConeGeometry(1.1, 2.6, 4);
    chevGeo.rotateX(Math.PI / 2); // Point along +Z for lookAt
    const chevMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.88
    });

    for (let i = 0; i < mine.escapePath.length - 1; i++) {
      const from = mine.escapePath[i];
      const to = mine.escapePath[i + 1];
      const mid = from.clone().lerp(to, 0.5);
      const chev = new THREE.Mesh(chevGeo, chevMat);
      chev.position.copy(mid);
      chev.lookAt(to);
      chev.visible = false;
      this.group.add(chev);
      this.escapeChevrons.push(chev);
    }

    scene.add(this.group);
  }

  public damageReactor(amount: number): boolean {
    if (this.reactorDestroyed) return false;
    this.reactorHp = Math.max(0, this.reactorHp - amount);
    this.hitFlashTimer = 0.14;
    if (this.reactorHp <= 0) {
      this.reactorDestroyed = true;
      this.reactorGroup.visible = false;
      for (const chev of this.escapeChevrons) {
        chev.visible = true;
      }
      return true;
    }
    return false;
  }

  public update(dt: number, elapsed: number): void {
    if (!this.reactorDestroyed && this.reactorCoreMesh) {
      this.reactorCoreMesh.rotation.y += dt * 1.1;
      this.reactorCoreMesh.rotation.x += dt * 0.6;
      const pulse = 1 + Math.sin(elapsed * 5) * 0.08;
      this.reactorCoreMesh.scale.setScalar(pulse);
      if (this.reactorRings.length >= 2) {
        this.reactorRings[0].rotation.z += dt * 1.5;
        this.reactorRings[0].rotation.y += dt * 0.8;
        this.reactorRings[1].rotation.x -= dt * 1.8;
        this.reactorRings[1].rotation.z += dt * 0.7;
      }

      const mat = this.reactorCoreMesh.material as THREE.MeshStandardMaterial;
      if (this.hitFlashTimer > 0) {
        this.hitFlashTimer -= dt;
        mat.emissive.setHex(0xffffff);
        mat.emissiveIntensity = 4.0;
      } else {
        const ratio = this.reactorHp / this.reactorMaxHp;
        mat.emissive.setHex(ratio < 0.35 ? 0xff0044 : 0xff3b00);
        mat.emissiveIntensity = 2.0 + (1 - ratio) * 1.5;
      }
    }

    if (this.exitRing) {
      this.exitRing.rotation.z += dt * (this.reactorDestroyed ? 2.6 : 0.8);
    }

    // During reactor meltdown escape: flash red alarm lighting & animate green escape chevrons
    if (this.reactorDestroyed) {
      const alarm = Math.sin(elapsed * 8) * 0.5 + 0.5;
      for (const l of this.tunnelLights) {
        l.color.setHex(alarm > 0.45 ? 0xff1e38 : 0x450a0a);
        l.intensity = 18 + alarm * 32;
      }
      if (this.ambientLight) {
        this.ambientLight.color.setHex(alarm > 0.5 ? 0x993344 : 0x552233);
      }
      this.escapeChevrons.forEach((c, idx) => {
        const wave = Math.sin(elapsed * 7 - idx * 0.7) * 0.25 + 1;
        c.scale.setScalar(wave);
      });
    } else if (this.ambientLight) {
      this.ambientLight.color.setHex(0x8fa8c8);
      for (let i = 0; i < this.tunnelLights.length - 1; i++) {
        this.tunnelLights[i].color.setHex(this.biomeAccent);
      }
    }
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    this.group.clear();
  }
}
