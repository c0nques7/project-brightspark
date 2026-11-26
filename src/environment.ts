import * as THREE from 'three';
import { Mine } from './mine';
import { Planet } from './planet';
import type { Sky } from './world';

// Ties the planet and the mine into one continuous world: collision routing, and blending the
// sky, fog and lights from deep space to atmosphere to underground, all driven by where the camera is.

export type Zone = 'space' | 'atmosphere' | 'surface' | 'mine';

const SPACE_BG = new THREE.Color(0x03050b);
const SKY_HIGH = new THREE.Color(0x4f7896);
const SKY_LOW = new THREE.Color(0xa9c4cf);
const MINE_BG = new THREE.Color(0x020203);

function smoothstep(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class Environment {
  readonly planet: Planet;
  readonly mine: Mine;
  zone: Zone = 'space';
  /** 0 in space .. 1 at ground level. */
  atmo = 0;
  /** 0 above ground .. 1 deep in the mine. */
  under = 0;
  altitude = Infinity;
  private headlight: THREE.SpotLight;
  private bg = new THREE.Color();

  constructor(
    private scene: THREE.Scene,
    camera: THREE.Camera,
    private sky: Sky,
    private sun: THREE.DirectionalLight,
    private hemi: THREE.HemisphereLight,
  ) {
    const entranceDir = new THREE.Vector3(0.12, 0.3, 1).normalize();
    this.planet = new Planet(scene, {
      center: new THREE.Vector3(0, -900, -6400),
      radius: 3000,
      seed: 1337,
      entranceDir,
      holeHalf: 8,
    });
    this.mine = new Mine(scene, this.planet.entranceFrame, 4242);

    this.headlight = new THREE.SpotLight(0xfff4e0, 0, 180, 0.85, 0.5, 1);
    this.headlight.position.set(0, 0.4, 0);
    this.headlight.target.position.set(0, 0, -10);
    camera.add(this.headlight, this.headlight.target);
  }

  /**
   * Keep a sphere out of the ground and inside the tunnels.
   * Returns the push direction (world) when a correction happened.
   */
  collide(pos: THREE.Vector3, radius: number): THREE.Vector3 | null {
    if (this.mine.contains(pos, radius)) return this.mine.confine(pos, radius);
    if (this.planet.overHole(pos, -radius)) return null;
    const alt = this.planet.altitude(pos);
    if (alt >= radius) return null;
    const n = pos.clone().sub(this.planet.center).normalize();
    pos.addScaledVector(n, radius - alt);
    return n;
  }

  /** Is this point inside solid rock (for projectiles)? */
  blocks(pos: THREE.Vector3) {
    if (this.mine.contains(pos)) return false;
    if (this.planet.overHole(pos)) return false;
    return this.planet.altitude(pos) < 0;
  }

  /** Reason cruise can't engage here, or null if it can. */
  cruiseBlocked(pos: THREE.Vector3): string | null {
    if (this.zone === 'mine') return 'IN MINE';
    if (this.planet.altitude(pos) < 250) return 'TOO LOW';
    return null;
  }

  update(cam: THREE.Camera, time: number) {
    const pos = cam.position;
    const p = this.planet;
    p.update(pos);
    this.mine.update(time);

    const shell = p.shellAltitude(pos);
    this.altitude = p.altitude(pos);
    this.atmo = 1 - smoothstep(0, p.atmosphereHeight, shell);
    const inMine = this.mine.contains(pos, 2);
    this.under = inMine ? smoothstep(0, 40, this.mine.depth(pos)) : 0;
    this.zone = inMine ? 'mine' : this.altitude < 150 ? 'surface' : this.atmo > 0.02 ? 'atmosphere' : 'space';

    // Sky colour: space -> high sky -> hazy horizon, then dark underground.
    const a = this.atmo;
    this.bg.copy(SPACE_BG).lerp(SKY_HIGH, smoothstep(0, 0.5, a)).lerp(SKY_LOW, smoothstep(0.5, 1, a));
    this.bg.lerp(MINE_BG, this.under);
    (this.scene.background as THREE.Color).copy(this.bg);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.bg);
    fog.density = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.00012, 0.0011, a * a), 0.0065, this.under);

    this.sky.setDaylight(a, this.under);
    this.sun.intensity = 2.6 * (1 - this.under);
    this.hemi.intensity = THREE.MathUtils.lerp(0.55 + a * 0.5, 0.9, this.under);
    this.headlight.intensity = 60 * smoothstep(0, 1, this.under + (this.zone === 'surface' ? 0.1 : 0));
  }
}
