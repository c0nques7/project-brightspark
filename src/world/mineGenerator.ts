import * as THREE from 'three';
import { createRng } from '../state/saveManager';

export interface GridCoord {
  x: number;
  y: number;
  z: number;
}

export interface MineSpawnPoint {
  kind: 'mine' | 'turret' | 'drone' | 'loot';
  position: THREE.Vector3;
  normal: THREE.Vector3; // Surface normal for turrets
}

export interface GeneratedMine {
  cellSize: number;
  cells: Map<string, GridCoord>;
  startCell: GridCoord;
  reactorCell: GridCoord;
  escapePath: THREE.Vector3[]; // Ordered from reactor -> start/exit
  spawns: MineSpawnPoint[];
  exitPosition: THREE.Vector3;
  reactorPosition: THREE.Vector3;
  escapeTimeSeconds: number;
}

export function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function cellCenter(c: GridCoord, cellSize: number): THREE.Vector3 {
  return new THREE.Vector3(c.x * cellSize, c.y * cellSize, c.z * cellSize);
}

const DIRS: GridCoord[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 }
];

/**
 * Generates a true 3D Descent-2-style mine tunnel network:
 * - Guaranteed connected main spine + vertical shafts + side chambers
 * - Entrance airlock at (0,0,0), Reactor Chamber at deepest graph node
 * - Precomputed BFS escape route from Reactor back to Exit
 */
export function generateMineLayout(
  seed: number,
  targetCellCount: number,
  threatLevel: number
): GeneratedMine {
  const rng = createRng(seed);
  const cellSize = 18;
  const cells = new Map<string, GridCoord>();

  const addCell = (c: GridCoord) => {
    const k = cellKey(c.x, c.y, c.z);
    if (!cells.has(k)) cells.set(k, { ...c });
  };

  // Start airlock + entry corridor facing -Z
  const startCell: GridCoord = { x: 0, y: 0, z: 0 };
  addCell(startCell);
  addCell({ x: 0, y: 0, z: -1 });
  addCell({ x: 0, y: 0, z: -2 });

  // Carve main winding 3D tunnel with occasional vertical shafts
  let cursor: GridCoord = { x: 0, y: 0, z: -2 };
  let lastDir: GridCoord = { x: 0, y: 0, z: -1 };
  const mainPathCount = Math.max(10, Math.floor(targetCellCount * 0.72));
  let attempts = 0;

  while (cells.size < mainPathCount && attempts < 500) {
    attempts++;
    // Bias forward / horizontal, allow vertical shaft turns ~24% of the time
    let dir: GridCoord;
    if (rng() < 0.45) {
      dir = lastDir;
    } else {
      const candidates = DIRS.filter((d) => !(d.x === -lastDir.x && d.y === -lastDir.y && d.z === -lastDir.z));
      dir = candidates[Math.floor(rng() * candidates.length)];
      if (dir.y !== 0 && rng() < 0.45) {
        // Keep vertical excursion reasonable (-2..2)
        const horiz = candidates.filter((d) => d.y === 0);
        dir = horiz[Math.floor(rng() * horiz.length)];
      }
    }

    const next: GridCoord = {
      x: cursor.x + dir.x,
      y: cursor.y + dir.y,
      z: cursor.z + dir.z
    };

    // Keep bounds clean and prevent returning onto start airlock behind z > 0
    if (next.z > 0 || Math.abs(next.y) > 2 || Math.abs(next.x) > 6 || next.z < -12) {
      lastDir = { x: 0, y: 0, z: -1 };
      continue;
    }

    // Carve 1-2 cells in this direction for readable corridors
    addCell(next);
    cursor = next;
    lastDir = dir;

    if (rng() < 0.55 && cells.size < mainPathCount) {
      const next2: GridCoord = {
        x: cursor.x + dir.x,
        y: cursor.y + dir.y,
        z: cursor.z + dir.z
      };
      if (next2.z <= -1 && Math.abs(next2.y) <= 2 && Math.abs(next2.x) <= 6 && next2.z >= -12) {
        addCell(next2);
        cursor = next2;
      }
    }
  }

  // Add side branches / junction alcoves for exploration & loot
  const coreList = Array.from(cells.values());
  let branchAttempts = 0;
  while (cells.size < targetCellCount && branchAttempts < 220) {
    branchAttempts++;
    const base = coreList[Math.floor(rng() * coreList.length)];
    if (base.x === 0 && base.y === 0 && base.z === 0) continue;
    const dir = DIRS[Math.floor(rng() * DIRS.length)];
    const b1: GridCoord = { x: base.x + dir.x, y: base.y + dir.y, z: base.z + dir.z };
    if (b1.z > -1 || Math.abs(b1.y) > 2 || Math.abs(b1.x) > 7 || b1.z < -13) continue;
    if (!cells.has(cellKey(b1.x, b1.y, b1.z))) {
      addCell(b1);
      if (rng() < 0.5 && cells.size < targetCellCount) {
        const b2: GridCoord = { x: b1.x + dir.x, y: b1.y + dir.y, z: b1.z + dir.z };
        if (b2.z <= -1 && Math.abs(b2.y) <= 2) {
          addCell(b2);
        }
      }
    }
  }

  // BFS from startCell to find farthest cell for the Reactor Chamber & compute shortest escape route
  const distMap = new Map<string, number>();
  const parentMap = new Map<string, string | null>();
  const queue: GridCoord[] = [startCell];
  const startK = cellKey(startCell.x, startCell.y, startCell.z);
  distMap.set(startK, 0);
  parentMap.set(startK, null);

  let farthestCell = startCell;
  let maxDist = 0;

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curK = cellKey(cur.x, cur.y, cur.z);
    const curD = distMap.get(curK)!;
    if (curD > maxDist) {
      maxDist = curD;
      farthestCell = cur;
    }

    for (const d of DIRS) {
      const nb: GridCoord = { x: cur.x + d.x, y: cur.y + d.y, z: cur.z + d.z };
      const nbK = cellKey(nb.x, nb.y, nb.z);
      if (cells.has(nbK) && !distMap.has(nbK)) {
        distMap.set(nbK, curD + 1);
        parentMap.set(nbK, curK);
        queue.push(nb);
      }
    }
  }

  // Expand the Reactor Chamber slightly (add 1-2 adjacent open cells if possible for spacious boss arena)
  const reactorCell = farthestCell;
  for (const d of [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 }
  ]) {
    const side: GridCoord = {
      x: reactorCell.x + d.x,
      y: reactorCell.y + d.y,
      z: reactorCell.z + d.z
    };
    const sideK = cellKey(side.x, side.y, side.z);
    if (!cells.has(sideK) && side.z <= -2) {
      addCell(side);
      break;
    }
  }

  // Reconstruct escape path from reactorCell -> startCell
  const escapePath: THREE.Vector3[] = [];
  let traceK: string | null = cellKey(reactorCell.x, reactorCell.y, reactorCell.z);
  while (traceK) {
    const c = cells.get(traceK)!;
    escapePath.push(cellCenter(c, cellSize));
    traceK = parentMap.get(traceK) ?? null;
  }

  // Populate Spawns: Mines, Wall Turrets, Security Drones, and Loot Caches
  const spawns: MineSpawnPoint[] = [];
  const reactorK = cellKey(reactorCell.x, reactorCell.y, reactorCell.z);

  for (const [k, c] of cells.entries()) {
    const d = distMap.get(k) ?? 2;
    if (d <= 2) continue; // Safe spawn airlock & entry corridor

    const center = cellCenter(c, cellSize);

    // Find solid wall faces around this cell for mounting turrets
    const wallNormals: THREE.Vector3[] = [];
    for (const dir of DIRS) {
      const nbK = cellKey(c.x + dir.x, c.y + dir.y, c.z + dir.z);
      if (!cells.has(nbK)) {
        // Wall is in +dir direction; turret normal points inward (-dir)
        wallNormals.push(new THREE.Vector3(-dir.x, -dir.y, -dir.z));
      }
    }

    if (k === reactorK) {
      // Guard the reactor with 2 turrets + 1 drone
      for (let t = 0; t < Math.min(2, wallNormals.length); t++) {
        const n = wallNormals[t];
        const pos = center.clone().addScaledVector(n, -(cellSize * 0.5 - 1.5));
        spawns.push({ kind: 'turret', position: pos, normal: n.clone() });
      }
      spawns.push({
        kind: 'drone',
        position: center.clone().add(new THREE.Vector3(0, 4, 0)),
        normal: new THREE.Vector3(0, 1, 0)
      });
      continue;
    }

    const roll = rng();
    const hazardChance = Math.min(0.86, 0.54 + threatLevel * 0.06);

    if (roll < hazardChance * 0.42) {
      // Proximity Mine floating near tunnel center
      const offset = new THREE.Vector3(
        (rng() - 0.5) * 6,
        (rng() - 0.5) * 6,
        (rng() - 0.5) * 6
      );
      spawns.push({
        kind: 'mine',
        position: center.clone().add(offset),
        normal: new THREE.Vector3(0, 1, 0)
      });
    } else if (roll < hazardChance * 0.78 && wallNormals.length > 0) {
      // Wall/Ceiling/Floor Turret
      const n = wallNormals[Math.floor(rng() * wallNormals.length)];
      const pos = center.clone().addScaledVector(n, -(cellSize * 0.5 - 1.3));
      spawns.push({
        kind: 'turret',
        position: pos,
        normal: n.clone()
      });
    } else if (roll < hazardChance) {
      // Underground Security Drone
      spawns.push({
        kind: 'drone',
        position: center.clone(),
        normal: new THREE.Vector3(0, 1, 0)
      });
    } else if (rng() < 0.55) {
      // Salvage Crate / Loot Cache
      spawns.push({
        kind: 'loot',
        position: center.clone().add(new THREE.Vector3(0, -3.5, 0)),
        normal: new THREE.Vector3(0, 1, 0)
      });
    }
  }

  const exitPosition = cellCenter(startCell, cellSize).add(new THREE.Vector3(0, 0, cellSize * 0.32));
  const reactorPosition = cellCenter(reactorCell, cellSize);
  const escapeTimeSeconds = Math.max(26, Math.round(16 + escapePath.length * 3.1));

  return {
    cellSize,
    cells,
    startCell,
    reactorCell,
    escapePath,
    spawns,
    exitPosition,
    reactorPosition,
    escapeTimeSeconds
  };
}

/**
 * Smooth sphere-vs-voxel-tunnel collision resolution.
 * Keeps the player (or drones) cleanly inside open tunnel cells and slides along solid walls.
 */
export function resolveMineCollision(
  mine: GeneratedMine,
  pos: THREE.Vector3,
  velocity: THREE.Vector3,
  radius: number
): boolean {
  const cs = mine.cellSize;
  const half = cs * 0.5;
  const gx = Math.round(pos.x / cs);
  const gy = Math.round(pos.y / cs);
  const gz = Math.round(pos.z / cs);

  let collided = false;

  // Check all 26 neighbor solid cells + current cell bounds if somehow outside
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const nx = gx + dx;
        const ny = gy + dy;
        const nz = gz + dz;
        if (mine.cells.has(cellKey(nx, ny, nz))) continue;

        // Solid cube centered at (nx*cs, ny*cs, nz*cs) with half-extent = half
        const minX = nx * cs - half;
        const maxX = nx * cs + half;
        const minY = ny * cs - half;
        const maxY = ny * cs + half;
        const minZ = nz * cs - half;
        const maxZ = nz * cs + half;

        const closestX = Math.max(minX, Math.min(pos.x, maxX));
        const closestY = Math.max(minY, Math.min(pos.y, maxY));
        const closestZ = Math.max(minZ, Math.min(pos.z, maxZ));

        const diffX = pos.x - closestX;
        const diffY = pos.y - closestY;
        const diffZ = pos.z - closestZ;
        const distSq = diffX * diffX + diffY * diffY + diffZ * diffZ;

        if (distSq < radius * radius) {
          collided = true;
          const dist = Math.sqrt(distSq);
          let nxPush = 0;
          let nyPush = 0;
          let nzPush = 0;

          if (dist > 0.0001) {
            nxPush = diffX / dist;
            nyPush = diffY / dist;
            nzPush = diffZ / dist;
            const penetration = radius - dist;
            pos.x += nxPush * penetration;
            pos.y += nyPush * penetration;
            pos.z += nzPush * penetration;
          } else {
            // Fallback: push toward nearest open cell center
            const fallback = cellCenter(mine.startCell, cs);
            const toCenter = fallback.sub(pos).normalize();
            pos.addScaledVector(toCenter, radius * 0.5);
            nxPush = toCenter.x;
            nyPush = toCenter.y;
            nzPush = toCenter.z;
          }

          const vn = velocity.x * nxPush + velocity.y * nyPush + velocity.z * nzPush;
          if (vn < 0) {
            // Slide smoothly along walls with gentle bounce damping
            velocity.x -= nxPush * vn * 1.15;
            velocity.y -= nyPush * vn * 1.15;
            velocity.z -= nzPush * vn * 1.15;
          }
        }
      }
    }
  }

  return collided;
}

export function isPointInsideMine(mine: GeneratedMine, pos: THREE.Vector3): boolean {
  const cs = mine.cellSize;
  const gx = Math.round(pos.x / cs);
  const gy = Math.round(pos.y / cs);
  const gz = Math.round(pos.z / cs);
  return mine.cells.has(cellKey(gx, gy, gz));
}
