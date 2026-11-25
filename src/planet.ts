import * as THREE from 'three';
import { Simplex } from './noise';

// A real, flyable planet: cube-sphere quadtree terrain that refines as you get closer,
// an atmosphere rim visible from space, and a square hole in the terrain where the mine shaft opens.

const SEGMENTS = 16; // quads per chunk edge
const MAX_DEPTH = 8;
const SPLIT_K = 2.2; // split when camera is closer than chunkArc * SPLIT_K
const BUILDS_PER_FRAME = 4;

export interface PlanetOptions {
  center: THREE.Vector3;
  radius: number;
  seed: number;
  /** Unit direction from the centre to the mine entrance. */
  entranceDir: THREE.Vector3;
  /** Half-width of the square shaft opening, in metres. */
  holeHalf: number;
}

interface Face {
  n: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
}

const FACES: Face[] = [
  { n: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 0, -1), v: new THREE.Vector3(0, 1, 0) },
  { n: new THREE.Vector3(-1, 0, 0), u: new THREE.Vector3(0, 0, 1), v: new THREE.Vector3(0, 1, 0) },
  { n: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, -1) },
  { n: new THREE.Vector3(0, -1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1) },
  { n: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) },
  { n: new THREE.Vector3(0, 0, -1), u: new THREE.Vector3(-1, 0, 0), v: new THREE.Vector3(0, 1, 0) },
];

class Node {
  mesh: THREE.Mesh | null = null;
  children: Node[] | null = null;
  readonly centerWorld = new THREE.Vector3();
  queued = false;

  constructor(
    readonly face: Face,
    readonly u: number,
    readonly v: number,
    readonly size: number,
    readonly depth: number,
    planet: Planet,
  ) {
    cubeToSphere(face, u + size / 2, v + size / 2, this.centerWorld);
    const h = planet.heightAt(this.centerWorld);
    this.centerWorld.multiplyScalar(planet.radius + h).add(planet.center);
  }
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

/** Cube face coordinate (u,v in -1..1) to a unit sphere direction, with even area distribution. */
function cubeToSphere(f: Face, u: number, v: number, out: THREE.Vector3) {
  const c = _p.copy(f.n).addScaledVector(f.u, u).addScaledVector(f.v, v);
  const x2 = c.x * c.x;
  const y2 = c.y * c.y;
  const z2 = c.z * c.z;
  return out.set(
    c.x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3),
    c.y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3),
    c.z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3),
  );
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class Planet {
  readonly center: THREE.Vector3;
  readonly radius: number;
  readonly entranceDir: THREE.Vector3;
  readonly atmosphereHeight: number;
  /** Height of the flattened landing pad around the mine entrance. */
  readonly padHeight: number;
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  private noise: Simplex;
  private roots: Node[];
  private queue = new Set<Node>();
  private atmosphere: THREE.Mesh;
  private holeUniforms: Record<string, THREE.IUniform>;

  /** Local frame of the mine entrance: X/Z span the pad, Y points up out of the ground, origin at pad centre. */
  readonly entranceFrame = new THREE.Matrix4();

  constructor(scene: THREE.Scene, opts: PlanetOptions) {
    this.center = opts.center.clone();
    this.radius = opts.radius;
    this.entranceDir = opts.entranceDir.clone().normalize();
    this.atmosphereHeight = opts.radius * 0.3;
    this.noise = new Simplex(opts.seed);
    this.padHeight = this.rawHeight(this.entranceDir);
    {
      const Y = this.entranceDir;
      const X = new THREE.Vector3(0, 1, 0).cross(Y);
      if (X.lengthSq() < 1e-6) X.set(1, 0, 0);
      X.normalize();
      const Z = new THREE.Vector3().crossVectors(X, Y);
      const S = Y.clone().multiplyScalar(this.radius + this.padHeight).add(this.center);
      this.entranceFrame.makeBasis(X, Y, Z).setPosition(S);
    }
    const entranceFrame = this.entranceFrame;

    this.holeUniforms = {
      uHoleCenter: { value: new THREE.Vector3() },
      uHoleAxis: { value: new THREE.Vector3() },
      uHoleU: { value: new THREE.Vector3() },
      uHoleV: { value: new THREE.Vector3() },
      uHoleHalf: { value: opts.holeHalf },
    };
    const e = entranceFrame.elements;
    this.holeUniforms.uHoleU.value.set(e[0], e[1], e[2]);
    this.holeUniforms.uHoleAxis.value.set(e[4], e[5], e[6]);
    this.holeUniforms.uHoleV.value.set(e[8], e[9], e[10]);
    this.holeUniforms.uHoleCenter.value.set(e[12], e[13], e[14]);

    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.holeUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vTerrainWorld;
uniform vec3 uHoleCenter; uniform vec3 uHoleAxis; uniform vec3 uHoleU; uniform vec3 uHoleV; uniform float uHoleHalf;`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
{ vec3 d = vTerrainWorld - uHoleCenter; float a = dot(d, uHoleAxis);
  if (a > -40.0 && a < 40.0 && abs(dot(d, uHoleU)) < uHoleHalf && abs(dot(d, uHoleV)) < uHoleHalf) discard; }`,
        );
    };

    // Atmosphere rim, seen from outside.
    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius + this.atmosphereHeight, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0x8fc4e0) } },
        vertexShader: `varying vec3 vN; varying vec3 vV;
          void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
        fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
          void main(){ float f = 1.0 - max(dot(vN, vV), 0.0); gl_FragColor = vec4(uColor * pow(f, 2.5) * 1.3, pow(f, 1.5)); }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.atmosphere.position.copy(this.center);
    this.group.add(this.atmosphere);

    this.roots = FACES.map((f) => new Node(f, -1, -1, 2, 0, this));
    for (const r of this.roots) this.build(r);
    scene.add(this.group);
  }

  // ---------- Height field ----------
  private rawHeight(d: THREE.Vector3) {
    const n = this.noise;
    const R = this.radius;
    const s = R / 3000; // keep feature sizes stable if the radius changes
    let cont = 0;
    let amp = 1;
    let f = 1.3;
    for (let i = 0; i < 4; i++) {
      cont += amp * n.noise3(d.x * f * s + 11, d.y * f * s, d.z * f * s);
      amp *= 0.5;
      f *= 2.1;
    }
    const r = 1 - Math.abs(n.noise3(d.x * 7 * s, d.y * 7 * s + 5, d.z * 7 * s));
    const ridges = r * r * r * smoothstep(-0.15, 0.35, cont);
    const detail = n.noise3(d.x * 45 * s, d.y * 45 * s, d.z * 45 * s + 3) * 5 + n.noise3(d.x * 160 * s, d.y * 160 * s, d.z * 160 * s) * 1.2;
    return cont * 70 + ridges * 120 + detail;
  }

  /** Terrain height above the base radius in the given unit direction. */
  heightAt(d: THREE.Vector3) {
    const h = this.rawHeight(d);
    // Flatten a landing pad around the mine entrance.
    const surfDist = Math.acos(Math.min(1, d.dot(this.entranceDir))) * this.radius;
    const w = smoothstep(45, 220, surfDist);
    return this.padHeight + (h - this.padHeight) * w;
  }

  /** Height of pos above the terrain (negative = underground). */
  altitude(pos: THREE.Vector3) {
    _q.subVectors(pos, this.center);
    const r = _q.length();
    return r - this.radius - this.heightAt(_q.divideScalar(r));
  }

  /** Height above the base radius (ignores terrain). Used for the atmosphere blend. */
  shellAltitude(pos: THREE.Vector3) {
    return pos.distanceTo(this.center) - this.radius - this.padHeight;
  }

  /** Is pos over the shaft opening (where terrain must not collide)? */
  overHole(pos: THREE.Vector3, margin = 0) {
    const U = this.holeUniforms;
    _q.subVectors(pos, U.uHoleCenter.value as THREE.Vector3);
    const half = (U.uHoleHalf.value as number) - margin;
    const up = _q.dot(U.uHoleAxis.value);
    return Math.abs(_q.dot(U.uHoleU.value)) < half && Math.abs(_q.dot(U.uHoleV.value)) < half && up < 60 && up > -2;
  }

  // ---------- LOD ----------
  update(cam: THREE.Vector3) {
    this.atmosphere.visible = this.shellAltitude(cam) > this.atmosphereHeight * 0.6;
    for (const r of this.roots) this.visit(r, cam);
    if (this.queue.size) {
      const list = [...this.queue].sort((a, b) => a.centerWorld.distanceToSquared(cam) - b.centerWorld.distanceToSquared(cam));
      for (let i = 0; i < Math.min(BUILDS_PER_FRAME, list.length); i++) {
        const n = list[i];
        this.queue.delete(n);
        n.queued = false;
        if (!n.mesh) this.build(n);
      }
    }
  }

  private arc(n: Node) {
    return n.size * 0.785 * this.radius;
  }

  private visit(n: Node, cam: THREE.Vector3) {
    const dist = n.centerWorld.distanceTo(cam);
    const wantSplit = n.depth < MAX_DEPTH && dist < this.arc(n) * SPLIT_K;
    if (wantSplit && !n.children) {
      const h = n.size / 2;
      n.children = [
        new Node(n.face, n.u, n.v, h, n.depth + 1, this),
        new Node(n.face, n.u + h, n.v, h, n.depth + 1, this),
        new Node(n.face, n.u, n.v + h, h, n.depth + 1, this),
        new Node(n.face, n.u + h, n.v + h, h, n.depth + 1, this),
      ];
    }
    const ready = wantSplit && n.children!.every((c) => c.mesh);
    if (ready) {
      if (n.mesh) n.mesh.visible = false;
      for (const c of n.children!) this.visit(c, cam);
      return;
    }
    if (n.mesh) n.mesh.visible = true;
    else this.request(n);
    if (n.children) {
      if (wantSplit) {
        for (const c of n.children) {
          this.hide(c);
          if (!c.mesh) this.request(c);
        }
      } else if (dist > this.arc(n) * SPLIT_K * 1.6) {
        for (const c of n.children) this.dispose(c);
        n.children = null;
      } else for (const c of n.children) this.hide(c);
    }
  }

  private request(n: Node) {
    if (n.queued) return;
    n.queued = true;
    this.queue.add(n);
  }

  private hide(n: Node) {
    if (n.mesh) n.mesh.visible = false;
    if (n.children) for (const c of n.children) this.hide(c);
  }

  private dispose(n: Node) {
    if (n.children) for (const c of n.children) this.dispose(c);
    if (n.mesh) {
      this.group.remove(n.mesh);
      n.mesh.geometry.dispose();
      n.mesh = null;
    }
    this.queue.delete(n);
    n.queued = false;
  }

  private build(n: Node) {
    const N = SEGMENTS;
    const W = N + 3; // grid with a one-vertex apron for normals
    const dirs = new Float32Array(W * W * 3);
    const hts = new Float32Array(W * W);
    const d = new THREE.Vector3();
    const step = n.size / N;
    for (let j = 0; j < W; j++)
      for (let i = 0; i < W; i++) {
        cubeToSphere(n.face, n.u + (i - 1) * step, n.v + (j - 1) * step, d);
        const k = j * W + i;
        d.toArray(dirs, k * 3);
        hts[k] = this.heightAt(d);
      }
    const P = (i: number, j: number, out: THREE.Vector3) => {
      const k = j * W + i;
      return out.fromArray(dirs, k * 3).multiplyScalar(this.radius + hts[k]).add(this.center);
    };

    const vCount = (N + 1) * (N + 1);
    const skirtCount = 4 * (N + 1);
    const pos = new Float32Array((vCount + skirtCount) * 3);
    const nor = new Float32Array((vCount + skirtCount) * 3);
    const col = new Float32Array((vCount + skirtCount) * 3);
    const origin = n.centerWorld;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const e = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const up = new THREE.Vector3();
    const color = new THREE.Color();
    const sand = new THREE.Color(0xb39470);
    const rust = new THREE.Color(0x8a5a40);
    const pale = new THREE.Color(0xd8cfc2);
    const cliff = new THREE.Color(0x4f4540);

    for (let j = 0; j <= N; j++)
      for (let i = 0; i <= N; i++) {
        const gi = i + 1;
        const gj = j + 1;
        const k = j * (N + 1) + i;
        P(gi, gj, e).sub(origin).toArray(pos, k * 3);
        P(gi + 1, gj, a);
        P(gi - 1, gj, b);
        P(gi, gj + 1, c);
        P(gi, gj - 1, nrm);
        a.sub(b);
        c.sub(nrm);
        nrm.crossVectors(a, c).normalize();
        up.fromArray(dirs, (gj * W + gi) * 3);
        if (nrm.dot(up) < 0) nrm.negate();
        nrm.toArray(nor, k * 3);
        const h = hts[gj * W + gi];
        const slope = nrm.dot(up);
        color.copy(sand).lerp(rust, smoothstep(10, 60, h)).lerp(pale, smoothstep(110, 170, h));
        color.lerp(cliff, smoothstep(0.9, 0.7, slope));
        const v = 0.92 + 0.08 * Math.sin(i * 12.9898 + j * 78.233 + n.depth);
        color.multiplyScalar(v).toArray(col, k * 3);
      }

    // Skirts: copies of the edge vertices pushed down, hiding cracks between LOD levels.
    const skirtDepth = this.arc(n) / N * 1.5 + 2;
    const edge: number[] = [];
    for (let i = 0; i <= N; i++) edge.push(i); // bottom (j=0)
    for (let j = 0; j <= N; j++) edge.push(j * (N + 1) + N); // right
    for (let i = N; i >= 0; i--) edge.push(N * (N + 1) + i); // top
    for (let j = N; j >= 0; j--) edge.push(j * (N + 1)); // left
    edge.forEach((src, s) => {
      const k = vCount + s;
      a.fromArray(pos, src * 3).add(origin).sub(this.center);
      a.setLength(a.length() - skirtDepth).add(this.center).sub(origin).toArray(pos, k * 3);
      for (let t = 0; t < 3; t++) {
        nor[k * 3 + t] = nor[src * 3 + t];
        col[k * 3 + t] = col[src * 3 + t];
      }
    });

    const idx: number[] = [];
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const a0 = j * (N + 1) + i;
        const a1 = a0 + 1;
        const a2 = a0 + N + 1;
        const a3 = a2 + 1;
        idx.push(a0, a1, a3, a0, a3, a2);
      }
    // Skirt strips (both windings so they show from either side).
    for (let s = 0; s < edge.length - 1; s++) {
      if ((s + 1) % (N + 1) === 0) continue; // corner jump between edges
      const t0 = edge[s];
      const t1 = edge[s + 1];
      const b0 = vCount + s;
      const b1 = vCount + s + 1;
      idx.push(t0, b0, t1, t1, b0, b1, t0, t1, b0, t1, b1, b0);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.material);
    m.position.copy(origin);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    n.mesh = m;
    this.group.add(m);
  }
}
