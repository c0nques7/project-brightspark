import * as THREE from 'three';
import type { Enemy } from './base';
import { Warden } from './fighters';
import { Aegis, Arc, Corsair, Lancer, Matriarch, Quiver, Sower } from './space';

// Space wave schedule. The first waves introduce one ship type each (with a one-line tip), then
// waves are drawn from a growing budget. Every fifth wave brings the Matriarch.

type Kind = 'warden' | 'lancers' | 'quiver' | 'aegis' | 'corsair' | 'sower' | 'arc' | 'matriarch';
type Wave = Partial<Record<Kind, number>>;

const SCRIPTED: Wave[] = [
  { warden: 3 },
  { lancers: 1, warden: 2 },
  { quiver: 1, lancers: 1 },
  { aegis: 1, corsair: 1, warden: 2 },
  { matriarch: 1, lancers: 1 },
  { sower: 1, lancers: 1, quiver: 1 },
  { arc: 1, corsair: 1, aegis: 1, warden: 2 },
];

export const INTRO: Partial<Record<Kind, [string, string]>> = {
  lancers: ['NEW CONTACT: LANCERS', 'They strafe in threes. Dodge sideways'],
  quiver: ['NEW CONTACT: QUIVER', 'Shoot its missiles down or boost away'],
  aegis: ['NEW CONTACT: AEGIS', 'It shields its allies. Kill it first'],
  corsair: ['NEW CONTACT: CORSAIR', 'Heavy gunship. Stay off its turrets'],
  sower: ['NEW CONTACT: SOWER', 'Mines in its wake. Shoot them early'],
  arc: ['NEW CONTACT: ARC', 'Sniper. Break its aim line'],
};

const COST: Record<Exclude<Kind, 'matriarch'>, number> = { warden: 1, lancers: 3, quiver: 2, aegis: 2, corsair: 4, sower: 2, arc: 3 };

function randomWave(n: number): Wave {
  const w: Wave = {};
  let budget = 4 + n * 1.2;
  const kinds = Object.keys(COST) as (keyof typeof COST)[];
  let guard = 0;
  while (budget >= 1 && guard++ < 40) {
    const k = kinds[Math.floor(Math.random() * kinds.length)];
    if (COST[k] > budget) continue;
    if ((k === 'aegis' || k === 'arc') && (w[k] ?? 0) >= 2) continue;
    w[k] = (w[k] ?? 0) + 1;
    budget -= COST[k];
  }
  if (n % 5 === 0) w.matriarch = 1;
  return w;
}

export function waveFor(n: number): Wave {
  return n <= SCRIPTED.length ? SCRIPTED[n - 1] : randomWave(n);
}

/** Build the enemies for a wave. `place` returns a spawn point (ahead of the player, clear of rocks). */
export function buildWave(n: number, place: (min: number, max: number) => THREE.Vector3): { enemies: Enemy[]; intro?: [string, string] } {
  const w = waveFor(n);
  const out: Enemy[] = [];
  const hpScale = 1 + Math.max(0, n - 7) * 0.08;
  for (const [kind, count] of Object.entries(w) as [Kind, number][]) {
    for (let i = 0; i < count; i++) {
      switch (kind) {
        case 'warden': out.push(new Warden(place(120, 190), 'space', 30 + 6 * (n - 1))); break;
        case 'lancers': out.push(...Lancer.squad(place(200, 260))); break;
        case 'quiver': out.push(new Quiver(place(180, 240))); break;
        case 'aegis': out.push(new Aegis(place(150, 200))); break;
        case 'corsair': out.push(new Corsair(place(160, 220))); break;
        case 'sower': out.push(new Sower(place(140, 200))); break;
        case 'arc': out.push(new Arc(place(220, 280))); break;
        case 'matriarch': out.push(new Matriarch(place(320, 380))); break;
      }
    }
  }
  for (const e of out) {
    e.wave = true;
    e.maxHp = e.hp = e.hp * (e.kind === 'warden' ? 1 : hpScale);
  }
  const introKind = n <= SCRIPTED.length ? (Object.keys(w) as Kind[]).find((k) => INTRO[k] && SCRIPTED.findIndex((s) => s[k]) === n - 1) : undefined;
  return { enemies: out, intro: introKind ? INTRO[introKind] : undefined };
}
