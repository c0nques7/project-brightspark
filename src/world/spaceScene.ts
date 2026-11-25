import * as THREE from 'three';
import { createRng } from '../state/saveManager';
import type { PlanetData, SectorData } from '../types';
import { createGlowSpriteTexture, createPlanetTexture } from './textures';

export interface AsteroidBody {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  radius: number;
  rotSpeed: THREE.Vector3;
}

export interface PlanetVisual {
  data: PlanetData;
  group: THREE.Group;
  mesh: THREE.Mesh;
  beaconGroup: THREE.Group;
  beaconPosition: THREE.Vector3;
  beaconRing: THREE.Mesh;
  baseMarker: THREE.Group;
}

export class SpaceScene {
  public readonly group = new THREE.Group();
  public planets: PlanetVisual[] = [];
  public asteroids: AsteroidBody[] = [];
  public warpGateGroup = new THREE.Group();
  public warpGatePos = new THREE.Vector3();
  private warpRings: THREE.Mesh[] = [];
  private starfield: THREE.Points | null = null;
  private nebulaSprites: THREE.Sprite[] = [];
  private sector: SectorData | null = null;

  public build(scene: THREE.Scene, sector: SectorData): void {
    this.dispose(scene);
    this.sector = sector;
    this.group.clear();
    this.planets = [];
    this.asteroids = [];
    this.warpRings = [];
    this.nebulaSprites = [];

    scene.background = new THREE.Color(sector.nebulaPrimary);
    scene.fog = new THREE.FogExp2(sector.nebulaPrimary, 0.00055);

    const rng = createRng(sector.seed + 17);

    // Ambient + Sun lighting
    const hemi = new THREE.HemisphereLight(0xbbe1ff, sector.nebulaSecondary, 0.85);
    this.group.add(hemi);

    const sunDir = new THREE.Vector3(0.7, 0.45, -0.55).normalize();
    const sun = new THREE.DirectionalLight(sector.starColor, 2.2);
    sun.position.copy(sunDir).multiplyScalar(600);
    this.group.add(sun);

    const rim = new THREE.DirectionalLight(sector.nebulaSecondary, 0.7);
    rim.position.copy(sunDir).multiplyScalar(-400);
    this.group.add(rim);

    // Distant sun visual sprite
    const sunTex = createGlowSpriteTexture('#ffffff', `#${sector.starColor.toString(16).padStart(6, '0')}`);
    const sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    sunSprite.position.copy(sunDir).multiplyScalar(1400);
    sunSprite.scale.set(380, 380, 1);
    this.group.add(sunSprite);

    // Multi-color starfield
    const starCount = 2600;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const palette = [
      new THREE.Color(0xffffff),
      new THREE.Color(0x93c5fd),
      new THREE.Color(0xfde68a),
      new THREE.Color(0xfca5a5),
      new THREE.Color(0xc4b5fd)
    ];

    for (let i = 0; i < starCount; i++) {
      const r = 750 + rng() * 900;
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(2 * rng() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      const c = palette[Math.floor(rng() * palette.length)];
      const dim = 0.55 + rng() * 0.45;
      colors[i * 3] = c.r * dim;
      colors[i * 3 + 1] = c.g * dim;
      colors[i * 3 + 2] = c.b * dim;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const starMat = new THREE.PointsMaterial({
      size: 2.6,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      sizeAttenuation: true
    });
    this.starfield = new THREE.Points(starGeo, starMat);
    this.group.add(this.starfield);

    // Volumetric nebula clouds
    const nebColorA = `#${sector.nebulaSecondary.toString(16).padStart(6, '0')}`;
    const nebTex = createGlowSpriteTexture(nebColorA, 'rgba(30,60,120,0.0)');
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({
        map: nebTex,
        transparent: true,
        opacity: 0.28 + rng() * 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const sp = new THREE.Sprite(mat);
      const dist = 650 + rng() * 400;
      const a = rng() * Math.PI * 2;
      const b = (rng() - 0.5) * 1.1;
      sp.position.set(Math.cos(a) * dist, Math.sin(b) * dist, Math.sin(a) * dist);
      const scale = 340 + rng() * 340;
      sp.scale.set(scale, scale, 1);
      this.group.add(sp);
      this.nebulaSprites.push(sp);
    }

    // Build Planets
    for (const p of sector.planets) {
      const pGroup = new THREE.Group();
      pGroup.position.set(p.position.x, p.position.y, p.position.z);

      const pTex = createPlanetTexture(p.primaryColor, p.accentColor, p.seed);
      const pMesh = new THREE.Mesh(
        new THREE.SphereGeometry(p.radius, 36, 28),
        new THREE.MeshStandardMaterial({
          map: pTex,
          roughness: 0.78,
          metalness: 0.12
        })
      );
      pGroup.add(pMesh);

      // Subtle glowing atmosphere shell
      const atmoMesh = new THREE.Mesh(
        new THREE.SphereGeometry(p.radius * 1.07, 28, 20),
        new THREE.MeshBasicMaterial({
          color: p.atmosphereColor,
          transparent: true,
          opacity: 0.17,
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending
        })
      );
      pGroup.add(atmoMesh);

      if (p.hasRings) {
        const ringGeo = new THREE.RingGeometry(p.radius * 1.32, p.radius * 2.0, 48);
        const ringMat = new THREE.MeshBasicMaterial({
          color: p.accentColor,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.28
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI * 0.42;
        ring.rotation.y = (p.seed % 10) * 0.08;
        pGroup.add(ring);
      }

      // Orbital Mine Descent Beacon positioned facing origin so player can fly right up to it
      const dirToOrigin = new THREE.Vector3(-p.position.x, -p.position.y, -p.position.z).normalize();
      const beaconLocalPos = dirToOrigin.clone().multiplyScalar(p.radius + 26);

      const beaconGroup = new THREE.Group();
      beaconGroup.position.copy(beaconLocalPos);
      beaconGroup.lookAt(0, 0, 0);

      const beaconColor = p.mineCleared ? 0x34d399 : 0xf97316;
      const beaconRing = new THREE.Mesh(
        new THREE.TorusGeometry(9.5, 0.85, 10, 32),
        new THREE.MeshStandardMaterial({
          color: beaconColor,
          emissive: beaconColor,
          emissiveIntensity: 1.5,
          roughness: 0.3,
          metalness: 0.7
        })
      );
      beaconGroup.add(beaconRing);

      const innerBeacon = new THREE.Mesh(
        new THREE.OctahedronGeometry(2.8, 0),
        new THREE.MeshBasicMaterial({
          color: beaconColor,
          wireframe: true
        })
      );
      beaconGroup.add(innerBeacon);

      // Orbital base outpost structure (visible when mine is cleared)
      const baseMarker = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(2.4, 3.2, 6, 8),
        new THREE.MeshStandardMaterial({
          color: 0xe2e8f0,
          emissive: 0x10b981,
          emissiveIntensity: 0.65,
          metalness: 0.7,
          roughness: 0.25
        })
      );
      const solarWing = new THREE.Mesh(
        new THREE.BoxGeometry(14, 0.4, 3.2),
        new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x0284c7,
          emissiveIntensity: 0.6,
          metalness: 0.8
        })
      );
      baseMarker.add(core, solarWing);
      baseMarker.position.set(0, 6.5, 0);
      baseMarker.visible = p.mineCleared;
      beaconGroup.add(baseMarker);

      pGroup.add(beaconGroup);
      this.group.add(pGroup);

      const worldBeaconPos = new THREE.Vector3(p.position.x, p.position.y, p.position.z).add(
        beaconLocalPos
      );
      this.planets.push({
        data: p,
        group: pGroup,
        mesh: pMesh,
        beaconGroup,
        beaconPosition: worldBeaconPos,
        beaconRing,
        baseMarker
      });
    }

    // Build Asteroid Field
    const rockGeo = new THREE.DodecahedronGeometry(1, 1);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x5b6475,
      roughness: 0.9,
      metalness: 0.18,
      flatShading: true
    });

    for (let i = 0; i < 55; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = 85 + rng() * 320;
      const y = (rng() - 0.5) * 160;
      const pos = new THREE.Vector3(Math.cos(angle) * dist, y, Math.sin(angle) * dist - 40);

      // Keep clear of origin & planet centers
      if (pos.length() < 65) continue;
      let tooClose = false;
      for (const pv of this.planets) {
        if (pos.distanceTo(pv.group.position) < pv.data.radius + 40) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const radius = 3.2 + rng() * 9.5;
      const mesh = new THREE.Mesh(rockGeo, rockMat);
      mesh.position.copy(pos);
      mesh.scale.set(
        radius * (0.8 + rng() * 0.4),
        radius * (0.75 + rng() * 0.45),
        radius * (0.8 + rng() * 0.4)
      );
      mesh.rotation.set(rng() * 6, rng() * 6, rng() * 6);
      this.group.add(mesh);

      this.asteroids.push({
        mesh,
        position: pos,
        radius: radius * 0.95,
        rotSpeed: new THREE.Vector3(
          (rng() - 0.5) * 0.35,
          (rng() - 0.5) * 0.35,
          (rng() - 0.5) * 0.35
        )
      });
    }

    // Build Warp Gate to Next Sector
    this.warpGateGroup = new THREE.Group();
    this.warpGatePos.set(
      sector.warpGatePosition.x,
      sector.warpGatePosition.y,
      sector.warpGatePosition.z
    );
    this.warpGateGroup.position.copy(this.warpGatePos);
    this.warpGateGroup.lookAt(0, 0, 0);

    const outerRing = new THREE.Mesh(
      new THREE.TorusGeometry(20, 1.8, 12, 48),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0ea5e9,
        emissiveIntensity: 1.4,
        metalness: 0.75,
        roughness: 0.2
      })
    );
    const innerRing = new THREE.Mesh(
      new THREE.TorusGeometry(14.5, 0.9, 10, 36),
      new THREE.MeshStandardMaterial({
        color: 0xa78bfa,
        emissive: 0x8b5cf6,
        emissiveIntensity: 1.8,
        metalness: 0.6,
        roughness: 0.25
      })
    );
    const portalDisc = new THREE.Mesh(
      new THREE.CircleGeometry(13.8, 32),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: sector.warpUnlocked ? 0.32 : 0.08,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      })
    );
    portalDisc.name = 'portalDisc';

    this.warpGateGroup.add(outerRing, innerRing, portalDisc);
    this.warpRings.push(outerRing, innerRing);
    this.group.add(this.warpGateGroup);

    scene.add(this.group);
  }

  public refreshPlanetStatuses(): void {
    for (const pv of this.planets) {
      const cleared = pv.data.mineCleared;
      const color = cleared ? 0x34d399 : 0xf97316;
      const mat = pv.beaconRing.material as THREE.MeshStandardMaterial;
      mat.color.setHex(color);
      mat.emissive.setHex(color);
      pv.baseMarker.visible = cleared;
    }

    if (this.sector) {
      const disc = this.warpGateGroup.getObjectByName('portalDisc') as THREE.Mesh | undefined;
      if (disc) {
        const mat = disc.material as THREE.MeshBasicMaterial;
        mat.opacity = this.sector.warpUnlocked ? 0.35 : 0.08;
      }
    }
  }

  public update(dt: number, elapsed: number): void {
    for (const pv of this.planets) {
      pv.mesh.rotation.y += dt * 0.04;
      pv.beaconRing.rotation.z += dt * 0.9;
      pv.baseMarker.rotation.y += dt * 0.6;
    }

    for (const a of this.asteroids) {
      a.mesh.rotation.x += a.rotSpeed.x * dt;
      a.mesh.rotation.y += a.rotSpeed.y * dt;
      a.mesh.rotation.z += a.rotSpeed.z * dt;
    }

    if (this.warpRings.length >= 2) {
      this.warpRings[0].rotation.z += dt * 0.35;
      this.warpRings[1].rotation.z -= dt * 0.7;
    }

    for (let i = 0; i < this.nebulaSprites.length; i++) {
      this.nebulaSprites[i].material.rotation = Math.sin(elapsed * 0.04 + i) * 0.15;
    }
  }

  /**
   * Resolves sphere collision against planets and asteroids in space.
   */
  public resolveSphereCollision(pos: THREE.Vector3, velocity: THREE.Vector3, radius: number): boolean {
    let hit = false;
    for (const pv of this.planets) {
      const center = pv.group.position;
      const minDist = pv.data.radius + radius + 2.5;
      const diff = pos.clone().sub(center);
      const dist = diff.length();
      if (dist < minDist && dist > 0.001) {
        diff.normalize();
        pos.copy(center).addScaledVector(diff, minDist);
        const vn = velocity.dot(diff);
        if (vn < 0) velocity.addScaledVector(diff, -vn * 1.4);
        hit = true;
      }
    }

    for (const a of this.asteroids) {
      const minDist = a.radius + radius;
      const diff = pos.clone().sub(a.position);
      const dist = diff.length();
      if (dist < minDist && dist > 0.001) {
        diff.normalize();
        pos.copy(a.position).addScaledVector(diff, minDist);
        const vn = velocity.dot(diff);
        if (vn < 0) velocity.addScaledVector(diff, -vn * 1.5);
        hit = true;
      }
    }
    return hit;
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
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
