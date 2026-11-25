import * as THREE from 'three';
import { rand, type Enemy, type MineInfo } from './base';
import { Lantern, Tick } from './crawlers';
import { Bulwark, Ember, Gnat, Shade, Warden } from './fighters';
import { Heartforge } from './heartforge';

// Fills the mine: the hub stays empty, the deepest room (that isn't the reactor chamber) holds the
// Heartforge, and the rooms in between get squads that introduce each enemy in turn and then mix them.

type Squad = Partial<Record<'tick' | 'lantern' | 'warden' | 'gnat' | 'bulwark' | 'shade' | 'ember', number>>;

/** In order of depth. Later rooms past the end of the list reuse the last few. */
const SQUADS: Squad[] = [
  { tick: 3, lantern: 1 },
  { warden: 2, tick: 2 },
  { gnat: 4, lantern: 1 },
  { bulwark: 1, warden: 1, tick: 2 },
  { shade: 2, tick: 2, lantern: 1 },
  { ember: 3, gnat: 3 },
  { bulwark: 1, shade: 1, ember: 2, lantern: 1 },
];

const _l = new THREE.Vector3();

export function populateMine(mine: MineInfo): Enemy[] {
  const out: Enemy[] = [];
  const frameQuat = new THREE.Quaternion().setFromRotationMatrix(mine.frame);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(frameQuat).normalize();
  const rooms = mine.rooms.filter((r) => !r.reactor);
  if (rooms.length < 2) return out;
  // Deepest room for the boss (ties: the one furthest from the hub).
  const boss = rooms.reduce((a, b) => (b.depth > a.depth || (b.depth === a.depth && b.center.lengthSq() > a.center.lengthSq()) ? b : a));
  const middle = rooms
    .filter((r) => r !== boss && r.depth > 0)
    .sort((a, b) => a.depth - b.depth || a.center.lengthSq() - b.center.lengthSq());

  const world = (local: THREE.Vector3) => local.clone().applyMatrix4(mine.frame);
  /** Random point in a room's box (local), kept `margin` from the walls; `yLo..yHi` are 0..1 of the height. */
  const inRoom = (box: MineInfo['rooms'][number]['box'], margin: number, yLo = 0.25, yHi = 0.75) =>
    _l.set(
      rand(box.min.x + margin, box.max.x - margin),
      THREE.MathUtils.lerp(box.min.y + margin, box.max.y - margin, rand(yLo, yHi)),
      rand(box.min.z + margin, box.max.z - margin),
    );

  middle.forEach((room, i) => {
    const squad = SQUADS[i < SQUADS.length ? i : SQUADS.length - 3 + ((i - SQUADS.length) % 3)];
    const b = room.box;
    for (const [kind, n] of Object.entries(squad) as [keyof Squad, number][]) {
      for (let k = 0; k < n; k++) {
        switch (kind) {
          case 'tick': {
            // On the ceiling.
            const p = inRoom(b, 4);
            p.y = b.max.y - 1.3;
            out.push(new Tick(world(p), up));
            break;
          }
          case 'lantern': {
            const p = room.center.clone();
            p.y = THREE.MathUtils.lerp(b.min.y, b.max.y, 0.62);
            p.x += rand(-3, 3);
            p.z += rand(-3, 3);
            out.push(new Lantern(world(p), frameQuat));
            break;
          }
          case 'warden':
            out.push(new Warden(world(inRoom(b, 6)), 'mine'));
            break;
          case 'gnat':
            out.push(new Gnat(world(inRoom(b, 5)), 'mine'));
            break;
          case 'bulwark':
            out.push(new Bulwark(world(inRoom(b, 9, 0.4, 0.6)), 'mine'));
            break;
          case 'shade':
            out.push(new Shade(world(inRoom(b, 6)), 'mine'));
            break;
          case 'ember':
            out.push(new Ember(world(inRoom(b, 5)), 'mine'));
            break;
        }
      }
    }
  });

  out.push(new Heartforge(world(boss.center.clone()), frameQuat));
  // Orient the flyers to the mine's up so they don't start rolled.
  for (const e of out) if (e.kind !== 'tick') e.mesh.up.copy(up);
  return out;
}
