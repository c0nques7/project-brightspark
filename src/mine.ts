import * as THREE from 'three';
import { mulberry32 } from './noise';

// A Descent-style mine built from axis-aligned boxes (shaft, rooms, corridors) in the entrance's local
// frame. Walls are tiled on a 4 m grid; tiles that fall inside another box are dropped, which opens
// up the junctions. Collision keeps the player inside the union of the boxes.

const TILE = 4;

export interface Box {
  min: THREE.Vector3;
  max: THREE.Vector3;
  kind: 'shaft' | 'room' | 'corridor';
}

export interface Room {
  box: Box;
  center: THREE.Vector3;
  /** Steps from the hub room. */
  depth: number;
  /** The reactor chamber: the mine's objective, reached past the deepest room. */
  reactor?: boolean;
}

const _l = new THREE.Vector3();
const _c = new THREE.Vector3();

function boxesOverlap(a: Box, b: Box, margin: number) {
  return (
    a.min.x - margin < b.max.x && a.max.x + margin > b.min.x &&
    a.min.y - margin < b.max.y && a.max.y + margin > b.min.y &&
    a.min.z - margin < b.max.z && a.max.z + margin > b.min.z
  );
}

function makeBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, kind: Box['kind']): Box {
  return { min: new THREE.Vector3(cx - hx, cy - hy, cz - hz), max: new THREE.Vector3(cx + hx, cy + hy, cz + hz), kind };
}

function panelTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d0d0d0';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#e8e8e8';
  g.fillRect(4, 4, 56, 56);
  g.strokeStyle = '#8a8a8a';
  g.lineWidth = 2;
  g.strokeRect(3, 3, 58, 58);
  g.fillStyle = '#9a9a9a';
  for (const [x, y] of [[8, 8], [56, 8], [8, 56], [56, 56]]) g.fillRect(x - 2, y - 2, 4, 4);
  g.fillStyle = 'rgba(0,0,0,0.08)';
  g.fillRect(4, 30, 56, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  return t;
}

export class Mine {
  readonly boxes: Box[] = [];
  readonly rooms: Room[] = [];
  readonly group = new THREE.Group();
  readonly frame: THREE.Matrix4;
  private inverse: THREE.Matrix4;
  private bounds = new THREE.Box3();
  private beacon: THREE.Mesh;
  private pylonLights: THREE.Mesh[] = [];
  private lightsMat!: THREE.MeshBasicMaterial;
  private beaconColor = new THREE.Color(1, 0.62, 0.25);
  /** 0 = normal, >0 = meltdown alarm (lights strobe red). */
  alarm = 0;
  readonly shaftHalf = 8;
  readonly shaftDepth = 160;

  constructor(scene: THREE.Scene, frame: THREE.Matrix4, seed: number) {
    this.frame = frame.clone();
    this.inverse = frame.clone().invert();
    this.generate(seed);
    for (const b of this.boxes) this.bounds.expandByPoint(b.min).expandByPoint(b.max);
    this.bounds.expandByScalar(4);

    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(frame);
    this.group.matrixWorldNeedsUpdate = true;
    this.buildGeometry(seed);
    this.beacon = this.buildPad();
    scene.add(this.group);
  }

  // ---------- Layout ----------
  private generate(seed: number) {
    const rnd = mulberry32(seed);
    const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    const S = this.shaftHalf;
    const hubY = -this.shaftDepth - 12;
    const shaft = makeBox(0, (-this.shaftDepth + 4) / 2, 0, S, (this.shaftDepth + 4) / 2, S, 'shaft');
    shaft.max.y = 0;
    shaft.min.y = hubY + 12 - 4; // dips 4 m into the hub's ceiling
    this.boxes.push(shaft);
    const hub = makeBox(0, hubY, 0, 20, 12, 20, 'room');
    this.boxes.push(hub);
    this.rooms.push({ box: hub, center: new THREE.Vector3(0, hubY, 0), depth: 0 });

    const dirs = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, -1, 0),
    ];
    const targetRooms = 9;
    let attempts = 0;
    while (this.rooms.length < targetRooms && attempts++ < 400) {
      // Favour growing from recent rooms, so the mine goes somewhere rather than staying a blob.
      const from = this.rooms[Math.max(0, this.rooms.length - 1 - Math.floor(rnd() * rnd() * this.rooms.length))];
      const d = dirs[rnd() < 0.15 ? 4 : ri(0, 3)];
      const fb = from.box;
      const half = new THREE.Vector3().subVectors(fb.max, fb.min).multiplyScalar(0.5);
      const len = ri(8, 22) * TILE;
      const cw = 8; // corridor half-width (16 m tunnels)
      const axis = d.x !== 0 ? 'x' : d.y !== 0 ? 'y' : 'z';
      const sign = d.x + d.y + d.z;
      const start = from.center[axis] + sign * (half[axis] - TILE);
      const end = start + sign * (len + TILE);
      const mid = (start + end) / 2;
      const c = from.center.clone();
      c[axis] = mid;
      const corridor = makeBox(
        axis === 'x' ? c.x : c.x,
        c.y,
        c.z,
        axis === 'x' ? Math.abs(end - start) / 2 : cw,
        axis === 'y' ? Math.abs(end - start) / 2 : cw,
        axis === 'z' ? Math.abs(end - start) / 2 : cw,
        'corridor',
      );
      const rh = new THREE.Vector3(ri(4, 7) * TILE, ri(3, 4) * TILE, ri(4, 7) * TILE);
      const rc = from.center.clone();
      rc[axis] = end - sign * TILE + sign * rh[axis];
      const room = makeBox(rc.x, rc.y, rc.z, rh.x, rh.y, rh.z, 'room');
      // Reject overlaps with anything except the room we grew from (and keep clear of the surface).
      if (room.max.y > -40 || corridor.max.y > -40 && axis !== 'y') continue;
      const clash = this.boxes.some((b) => b !== fb && (boxesOverlap(b, room, 8) || boxesOverlap(b, corridor, 4)));
      if (clash) continue;
      this.boxes.push(corridor, room);
      this.rooms.push({ box: room, center: rc, depth: from.depth + 1 });
    }
    this.addReactorChamber(rnd);
  }

  /** Bolt a reactor chamber onto the deepest room, so the boss stands between the player and the objective. */
  private addReactorChamber(rnd: () => number) {
    const deepest = this.rooms.reduce((a, b) => (b.depth > a.depth || (b.depth === a.depth && b.center.lengthSq() > a.center.lengthSq()) ? b : a));
    const dirs = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, -1, 0),
    ].sort(() => rnd() - 0.5);
    for (const room of [deepest, ...this.rooms.filter((r) => r !== deepest).sort((a, b) => b.depth - a.depth)]) {
      const fb = room.box;
      const half = new THREE.Vector3().subVectors(fb.max, fb.min).multiplyScalar(0.5);
      for (const d of dirs) {
        for (const len of [40, 56, 72, 32]) {
          const axis = d.x !== 0 ? 'x' : d.y !== 0 ? 'y' : 'z';
          const sign = d.x + d.y + d.z;
          const start = room.center[axis] + sign * (half[axis] - TILE);
          const end = start + sign * (len + TILE);
          const c = room.center.clone();
          c[axis] = (start + end) / 2;
          const corridor = makeBox(c.x, c.y, c.z, axis === 'x' ? len / 2 + 2 : 8, axis === 'y' ? len / 2 + 2 : 8, axis === 'z' ? len / 2 + 2 : 8, 'corridor');
          const rh = new THREE.Vector3(24, 16, 24);
          const rc = room.center.clone();
          rc[axis] = end - sign * TILE + sign * rh[axis];
          if (axis !== 'y') rc.y = room.box.min.y + rh.y; // floor-level with the room it hangs off
          const chamber = makeBox(rc.x, rc.y, rc.z, rh.x, rh.y, rh.z, 'room');
          if (chamber.max.y > -40) continue;
          if (axis !== 'y' && (corridor.min.y < chamber.min.y || corridor.max.y > chamber.max.y)) continue;
          if (this.boxes.some((b) => b !== fb && (boxesOverlap(b, chamber, 8) || boxesOverlap(b, corridor, 4)))) continue;
          this.boxes.push(corridor, chamber);
          this.rooms.push({ box: chamber, center: rc, depth: room.depth + 1, reactor: true });
          return;
        }
      }
    }
  }

  get reactorRoom() {
    return this.rooms.find((r) => r.reactor);
  }

  /** Is the local point inside any box (open space)? */
  openAt(l: THREE.Vector3) {
    return this.insideAny(l, 0);
  }

  // ---------- Geometry ----------
  private insideOther(p: THREE.Vector3, self: Box) {
    const e = 0.01;
    for (const b of this.boxes) {
      if (b === self) continue;
      if (p.x > b.min.x + e && p.x < b.max.x - e && p.y > b.min.y + e && p.y < b.max.y - e && p.z > b.min.z + e && p.z < b.max.z - e) return true;
    }
    return false;
  }

  private buildGeometry(seed: number) {
    const rnd = mulberry32(seed ^ 0x9e3779b9);
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const lpos: number[] = [];
    const lcol: number[] = [];
    const wall = new THREE.Color(0x6b7280);
    const floor = new THREE.Color(0x454a52);
    const ceil = new THREE.Color(0x565c66);
    const shaftCol = new THREE.Color(0x7a6f60);
    const lightCols = [new THREE.Color(0x7ff6ff), new THREE.Color(0xffc46b), new THREE.Color(0x9dff8a)];
    const c = new THREE.Color();
    const p = new THREE.Vector3();

    // For each face: axis index, sign of the inward normal, and the two in-plane axes.
    const faces: [number, number, number, number][] = [
      [0, 1, 2, 1], // min x wall, normal +x
      [0, -1, 1, 2], // max x wall, normal -x
      [1, 1, 0, 2], // floor (min y), normal +y
      [1, -1, 2, 0], // ceiling (max y), normal -y
      [2, 1, 0, 1], // min z wall, normal +z
      [2, -1, 1, 0], // max z wall, normal -z
    ];
    const comp = (v: THREE.Vector3, i: number) => (i === 0 ? v.x : i === 1 ? v.y : v.z);
    const setc = (v: THREE.Vector3, i: number, x: number) => (i === 0 ? (v.x = x) : i === 1 ? (v.y = x) : (v.z = x));

    for (const b of this.boxes) {
      for (const [ax, sgn, ua, va] of faces) {
        if (b.kind === 'shaft' && ax === 1 && sgn === -1) continue; // open to the sky
        const plane = sgn > 0 ? comp(b.min, ax) : comp(b.max, ax);
        const u0 = comp(b.min, ua);
        const u1 = comp(b.max, ua);
        const v0 = comp(b.min, va);
        const v1 = comp(b.max, va);
        // Wind triangles so the visible side faces into the box.
        const cyclic = (ua + 1) % 3 === va ? 1 : -1;
        const order = cyclic === sgn ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        const base = b.kind === 'shaft' ? shaftCol : ax === 1 ? (sgn > 0 ? floor : ceil) : wall;
        for (let u = u0; u < u1 - 0.01; u += TILE)
          for (let v = v0; v < v1 - 0.01; v += TILE) {
            p.set(0, 0, 0);
            setc(p, ax, plane);
            setc(p, ua, u + TILE / 2);
            setc(p, va, v + TILE / 2);
            if (this.insideOther(p, b)) continue;
            const jitter = 0.85 + rnd() * 0.25;
            c.copy(base).multiplyScalar(jitter);
            // Quad corners, wound so the face points inward.
            const corners = [
              [u, v],
              [u + TILE, v],
              [u + TILE, v + TILE],
              [u, v + TILE],
            ];
            for (const k of order) {
              const q = new THREE.Vector3();
              setc(q, ax, plane);
              setc(q, ua, corners[k][0]);
              setc(q, va, corners[k][1]);
              pos.push(q.x, q.y, q.z);
              const n = [0, 0, 0];
              n[ax] = sgn;
              nor.push(n[0], n[1], n[2]);
              uv.push(k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0);
              col.push(c.r, c.g, c.b);
            }
            // Light strips on walls, around head height in rooms and corridors.
            const isWall = ax !== 1;
            const vAxisIsY = va === 1 || ua === 1;
            const height = comp(p, 1) - b.min.y;
            if (isWall && vAxisIsY && b.kind !== 'shaft' && height >= 6 && height <= 10 && rnd() < 0.3) {
              const lc = lightCols[Math.floor(rnd() * lightCols.length)];
              const inset = sgn * 0.06;
              const um = u + TILE / 2;
              const vm = v + TILE / 2;
              const hu = ua === 1 ? 0.35 : 1.6;
              const hv = va === 1 ? 0.35 : 1.6;
              const lc4 = [
                [um - hu, vm - hv],
                [um + hu, vm - hv],
                [um + hu, vm + hv],
                [um - hu, vm + hv],
              ];
              for (const k of order) {
                const q = new THREE.Vector3();
                setc(q, ax, plane + inset);
                setc(q, ua, lc4[k][0]);
                setc(q, va, lc4[k][1]);
                lpos.push(q.x, q.y, q.z);
                lcol.push(lc.r, lc.g, lc.b);
              }
            }
            // Shaft: guide lights every few metres so the way down reads clearly.
            if (b.kind === 'shaft' && ax !== 1 && Math.round(comp(p, 1)) % 16 === -2 && rnd() < 0.7) {
              const lc = lightCols[1];
              const inset = sgn * 0.06;
              const um = u + TILE / 2;
              const vm = v + TILE / 2;
              const hu = ua === 1 ? 0.3 : 1.2;
              const hv = va === 1 ? 0.3 : 1.2;
              const lc4 = [
                [um - hu, vm - hv],
                [um + hu, vm - hv],
                [um + hu, vm + hv],
                [um - hu, vm + hv],
              ];
              for (const k of order) {
                const q = new THREE.Vector3();
                setc(q, ax, plane + inset);
                setc(q, ua, lc4[k][0]);
                setc(q, va, lc4[k][1]);
                lpos.push(q.x, q.y, q.z);
                lcol.push(lc.r, lc.g, lc.b);
              }
            }
          }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    const walls = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({ map: panelTexture(), vertexColors: true, roughness: 0.8, metalness: 0.2 }),
    );
    walls.matrixAutoUpdate = false;
    this.group.add(walls);

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lcol, 3));
    this.lightsMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const lights = new THREE.Mesh(lg, this.lightsMat);
    lights.matrixAutoUpdate = false;
    this.group.add(lights);
  }

  /** Landing pad around the shaft opening, with corner pylons and a sky beam visible from orbit. */
  private buildPad() {
    const S = this.shaftHalf;
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x5d5a55, roughness: 0.9, metalness: 0.2 });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffb02e });
    const W = 6;
    const slabs: [number, number, number, number][] = [
      [0, S + W / 2, S * 2 + W * 2, W],
      [0, -S - W / 2, S * 2 + W * 2, W],
      [S + W / 2, 0, W, S * 2],
      [-S - W / 2, 0, W, S * 2],
    ];
    for (const [x, z, w, d] of slabs) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), slabMat);
      m.position.set(x, -0.2, z);
      this.group.add(m);
    }
    // Hazard stripes along the hole rim.
    for (const [x, z, w, d] of [
      [0, S + 0.4, S * 2, 0.8],
      [0, -S - 0.4, S * 2, 0.8],
      [S + 0.4, 0, 0.8, S * 2],
      [-S - 0.4, 0, 0.8, S * 2],
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), stripeMat);
      m.position.set(x, 0.45, z);
      this.group.add(m);
    }
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.6, roughness: 0.4 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
    const P = S + W - 1;
    for (const [x, z] of [
      [P, P],
      [-P, P],
      [P, -P],
      [-P, -P],
    ]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(1.2, 10, 1.2), pylonMat);
      pylon.position.set(x, 5, z);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), lightMat);
      light.position.set(x, 10.4, z);
      this.group.add(pylon, light);
      this.pylonLights.push(light);
    }
    // Beam
    const beamGeo = new THREE.CylinderGeometry(4, 4, 1400, 16, 1, true);
    beamGeo.translate(0, 700, 0);
    const beam = new THREE.Mesh(
      beamGeo,
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: this.beaconColor } },
        vertexShader: `varying float vY; void main(){ vY = position.y / 1400.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform float uTime; uniform vec3 uColor; varying float vY; void main(){ float a = (1.0 - vY) * (0.35 + 0.1 * sin(uTime * 3.0)); gl_FragColor = vec4(uColor, a * a); }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    beam.renderOrder = 5;
    this.group.add(beam);
    return beam;
  }

  // ---------- Queries ----------
  /** World position of the shaft opening (pad centre). */
  get entrance() {
    return new THREE.Vector3().setFromMatrixPosition(this.frame);
  }

  toLocal(world: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(world).applyMatrix4(this.inverse);
  }

  private insideAny(l: THREE.Vector3, shrink: number) {
    for (const b of this.boxes) {
      if (
        l.x > b.min.x + shrink && l.x < b.max.x - shrink &&
        l.y > b.min.y + shrink && l.y < b.max.y - shrink + (b.kind === 'shaft' ? shrink + 50 : 0) &&
        l.z > b.min.z + shrink && l.z < b.max.z - shrink
      )
        return true;
    }
    return false;
  }

  /** Is this world point in the mine (below the surface, inside the tunnels)? */
  contains(world: THREE.Vector3, slack = 0) {
    this.toLocal(world, _l);
    if (_l.y >= 0 || !this.bounds.containsPoint(_l)) return false;
    return this.insideAny(_l, -slack);
  }

  /** How far below the pad the point is, in metres (0 when above). */
  depth(world: THREE.Vector3) {
    this.toLocal(world, _l);
    return Math.max(0, -_l.y);
  }

  /**
   * Keep a sphere inside the tunnels. Returns the inward-pointing world normal of the push,
   * or null if no correction was needed.
   */
  confine(pos: THREE.Vector3, radius: number): THREE.Vector3 | null {
    this.toLocal(pos, _l);
    if (this.insideAny(_l, radius)) return null;
    let best = Infinity;
    const out = new THREE.Vector3();
    for (const b of this.boxes) {
      const top = b.kind === 'shaft' ? b.max.y + 50 : b.max.y - radius;
      _c.set(
        THREE.MathUtils.clamp(_l.x, b.min.x + radius, b.max.x - radius),
        THREE.MathUtils.clamp(_l.y, b.min.y + radius, top),
        THREE.MathUtils.clamp(_l.z, b.min.z + radius, b.max.z - radius),
      );
      const d = _c.distanceToSquared(_l);
      if (d < best) {
        best = d;
        out.copy(_c);
      }
    }
    const n = out.clone().sub(_l);
    out.applyMatrix4(this.frame);
    pos.copy(out);
    return n.lengthSq() > 0 ? n.normalize().transformDirection(this.frame) : null;
  }

  /** Mine cleared: the beacon turns green. */
  setCleared(cleared = true) {
    if (cleared) this.beaconColor.setRGB(0.35, 1, 0.45);
    else this.beaconColor.setRGB(1, 0.62, 0.25);
  }

  update(time: number) {
    (this.beacon.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    const on = Math.sin(time * (this.alarm > 0 ? 10 : 4)) > 0;
    for (const l of this.pylonLights) l.visible = on;
    // Meltdown: every light strip strobes red.
    if (this.alarm > 0) {
      const k = 0.5 + 0.5 * Math.sin(time * 9);
      this.lightsMat.color.setRGB(1.6 + k, 0.15 + 0.2 * (1 - k), 0.1);
    } else this.lightsMat.color.setRGB(1, 1, 1);
  }
}
