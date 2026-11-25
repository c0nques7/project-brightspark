import * as THREE from 'three';

export interface Rock {
  mesh: THREE.Mesh;
  radius: number;
  spin: THREE.Vector3;
}

export const ARENA_RADIUS = 420;

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function randomOnSphere(out: THREE.Vector3, r: number) {
  const u = Math.random() * 2 - 1;
  const th = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(th), u, s * Math.sin(th)).multiplyScalar(r);
}

function glowTexture(inner: string, outer: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, outer);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Background objects that stay at "infinite" distance by following the camera. */
export class Sky {
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene, sunDir: THREE.Vector3) {
    // Stars
    const n = 2500;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      randomOnSphere(v, 1800).toArray(pos, i * 3);
      c.setHSL(rand(0.55, 0.68), rand(0, 0.5), rand(0.55, 1)).toArray(col, i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }),
    );
    this.group.add(stars);

    // Sun glow
    const sun = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture('rgba(255,250,235,1)', 'rgba(255,190,110,0.5)'),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    sun.position.copy(sunDir).multiplyScalar(1500);
    sun.scale.setScalar(420);
    this.group.add(sun);

    // A distant planet: a hint of where the mine levels will be.
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(320, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0x3a6f8f, roughness: 1, metalness: 0, fog: false }),
    );
    planet.position.set(-700, -180, -1200);
    this.group.add(planet);
    const atmo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture('rgba(120,200,255,0)', 'rgba(90,170,255,0.25)'),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    atmo.position.copy(planet.position);
    atmo.scale.setScalar(980);
    this.group.add(atmo);

    this.group.renderOrder = -1;
    scene.add(this.group);
  }

  follow(cam: THREE.Camera) {
    this.group.position.copy(cam.position);
  }
}

/** Space dust around the player, so speed is visible even with nothing nearby. */
export class Dust {
  private points: THREE.Points;
  private base: Float32Array;
  private readonly size = 80;

  constructor(scene: THREE.Scene) {
    const n = 450;
    this.base = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) this.base[i] = Math.random() * this.size;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0x8fa6c8, size: 0.18, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(center: THREE.Vector3) {
    const arr = (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const s = this.size;
    const h = s / 2;
    for (let i = 0; i < arr.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const c = k === 0 ? center.x : k === 1 ? center.y : center.z;
        // Wrap each mote into a cube centred on the player.
        const local = ((((this.base[i + k] - c) % s) + s) % s) - h;
        arr[i + k] = c + local;
      }
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
  }
}

export function makeRocks(scene: THREE.Scene, count: number): Rock[] {
  const rocks: Rock[] = [];
  const mat = new THREE.MeshStandardMaterial({ color: 0x6f6a66, roughness: 0.95, metalness: 0.05, flatShading: true });
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const radius = Math.random() < 0.15 ? rand(14, 26) : rand(3, 10);
    const geo = new THREE.IcosahedronGeometry(1, radius > 12 ? 2 : 1);
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    // Displace vertices consistently (shared positions get the same offset).
    const seen = new Map<string, number>();
    for (let j = 0; j < p.count; j++) {
      v.fromBufferAttribute(p, j);
      const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
      let d = seen.get(key);
      if (d === undefined) {
        d = rand(0.75, 1.15);
        seen.set(key, d);
      }
      v.multiplyScalar(d);
      p.setXYZ(j, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(radius * rand(0.85, 1.15), radius * rand(0.7, 1), radius * rand(0.85, 1.15));
    // Keep the spawn point clear.
    do randomOnSphere(v, rand(40, ARENA_RADIUS)); while (v.length() < 45);
    mesh.position.copy(v);
    mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    scene.add(mesh);
    rocks.push({
      mesh,
      radius: radius * 0.9,
      spin: new THREE.Vector3(rand(-0.15, 0.15), rand(-0.15, 0.15), rand(-0.15, 0.15)),
    });
  }
  return rocks;
}

export { rand, randomOnSphere };
