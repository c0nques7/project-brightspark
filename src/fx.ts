import * as THREE from 'three';

// Extra visual effects layered on the game's own particles: a pooled light flash that
// lights up nearby rocks, walls and the cockpit, expanding shockwave rings, and smoke puffs.
// Everything is pooled, so there are no per-explosion allocations or shader recompiles.

function softTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 40, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

interface Puff {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
  fade: number;
}

export class Fx {
  private light: THREE.PointLight;
  private lightLife = 0;
  private lightMax = 1;
  private lightPeak = 0;
  private rings: { mesh: THREE.Mesh; life: number; max: number; size: number }[] = [];
  private puffs: Puff[] = [];
  private freePuffs: THREE.Sprite[] = [];
  private smokeTex = softTexture();

  constructor(private scene: THREE.Scene) {
    this.light = new THREE.PointLight(0xffa860, 0, 140, 1.6);
    scene.add(this.light);
    const rt = ringTexture();
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: rt, color: new THREE.Color(2.5, 1.6, 0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, max: 1, size: 1 });
    }
  }

  explosion(at: THREE.Vector3, scale: number, camera: THREE.Camera) {
    // Light flash: keep the strongest/nearest one.
    const peak = 900 * scale;
    if (this.lightLife <= 0 || peak >= this.lightPeak * (this.lightLife / this.lightMax)) {
      this.light.position.copy(at);
      this.light.distance = 90 * scale + 60;
      this.lightPeak = peak;
      this.lightMax = this.lightLife = 0.45 + scale * 0.15;
    }
    // Shockwave ring, facing the camera with a random tilt.
    const r = this.rings.find((x) => x.life <= 0) ?? this.rings[0];
    r.mesh.position.copy(at);
    r.mesh.quaternion.copy(camera.quaternion);
    r.mesh.rotateX((Math.random() - 0.5) * 1.2);
    r.mesh.rotateY((Math.random() - 0.5) * 1.2);
    r.max = r.life = 0.55;
    r.size = 16 * scale;
    r.mesh.visible = true;
    // Smoke left behind.
    for (let i = 0; i < 6 * scale; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 6 * scale);
      this.puff(at, v, (2 + Math.random() * 2) * scale, 1.6 + Math.random(), 0x6a5a50, 0.55);
    }
  }

  /** Small dust puff where a bolt hits rock. */
  impact(at: THREE.Vector3) {
    for (let i = 0; i < 2; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4);
      this.puff(at, v, 0.6 + Math.random() * 0.6, 0.6, 0x8a8078, 0.5);
    }
  }

  private puff(at: THREE.Vector3, vel: THREE.Vector3, size: number, life: number, color: number, opacity: number) {
    if (this.puffs.length > 80) return;
    const s =
      this.freePuffs.pop() ??
      new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false }));
    const m = s.material as THREE.SpriteMaterial;
    m.color.setHex(color);
    m.opacity = opacity;
    m.rotation = Math.random() * 6.28;
    s.position.copy(at);
    s.scale.setScalar(size);
    s.visible = true;
    if (!s.parent) this.scene.add(s);
    this.puffs.push({ sprite: s, vel, life, max: life, size, grow: 2.5, fade: opacity });
  }

  update(dt: number) {
    if (this.lightLife > 0) {
      this.lightLife -= dt;
      const k = Math.max(0, this.lightLife / this.lightMax);
      this.light.intensity = this.lightPeak * k * k;
    } else this.light.intensity = 0;

    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const k = 1 - Math.max(0, r.life) / r.max;
      r.mesh.scale.setScalar(r.size * (0.2 + k));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * (1 - k);
      if (r.life <= 0) r.mesh.visible = false;
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        this.freePuffs.push(p.sprite);
        this.puffs.splice(i, 1);
        continue;
      }
      const k = 1 - p.life / p.max;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-1.5 * dt));
      p.sprite.scale.setScalar(p.size * (1 + k * p.grow));
      (p.sprite.material as THREE.SpriteMaterial).opacity = p.fade * (1 - k) * Math.min(1, k * 8);
    }
  }
}
