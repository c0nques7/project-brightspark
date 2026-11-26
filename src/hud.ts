import * as THREE from 'three';
import { PLAYER, type Game } from './game';

const _v = new THREE.Vector3();

export interface Waypoint {
  pos: THREE.Vector3;
  label: string;
}

export interface NavInfo {
  zone: string;
  altitude: number;
  waypoints: Waypoint[];
}

function fmtDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
const _lead = new THREE.Vector3();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement) {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

export class Hud {
  private shieldBar: HTMLElement;
  private hullBar: HTMLElement;
  private energyBar: HTMLElement;
  private stats: HTMLElement;
  private speed: HTMLElement;
  private msg: HTMLElement;
  private msgSub: HTMLElement;
  private warn: HTMLElement;
  private vignette: HTMLElement;
  private markerLayer: HTMLElement;
  private markers: { box: HTMLElement; hp: HTMLElement; arrow: HTMLElement; lead: HTMLElement }[] = [];
  private waypoints: { root: HTMLElement; label: HTMLElement }[] = [];
  private zone: HTMLElement;
  private msgTimer = 0;
  private hurt = 0;

  constructor(private root: HTMLElement) {
    el('div', 'crosshair', root);
    this.markerLayer = el('div', 'markers', root);
    this.vignette = el('div', 'vignette', root);

    const bars = el('div', 'bars', root);
    const bar = (label: string, cls: string) => {
      const row = el('div', 'bar-row', bars);
      el('span', 'bar-label', row).textContent = label;
      const track = el('div', 'bar-track', row);
      return el('div', `bar-fill ${cls}`, track);
    };
    this.shieldBar = bar('SHD', 'shield');
    this.hullBar = bar('HULL', 'hull');
    this.energyBar = bar('BST', 'energy');

    this.stats = el('div', 'stats', root);
    this.speed = el('div', 'speed', root);
    this.zone = el('div', 'zone-label', root);
    const m = el('div', 'message', root);
    this.msg = el('div', 'msg-main', m);
    this.msgSub = el('div', 'msg-sub', m);
    this.warn = el('div', 'warning', root);
    this.warn.textContent = 'LEAVING COMBAT ZONE';
  }

  message(text: string, sub = '', seconds = 2) {
    this.msg.textContent = text;
    this.msgSub.textContent = sub;
    this.msgTimer = seconds;
    this.msg.parentElement!.classList.add('show');
  }

  damaged(intensity: number) {
    this.hurt = Math.min(1, this.hurt + 0.5 * intensity);
  }

  setVisible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  update(dt: number, game: Game, nav: NavInfo) {
    const p = game.player;
    this.shieldBar.style.width = `${(p.shield / PLAYER.shield) * 100}%`;
    this.hullBar.style.width = `${(p.hull / PLAYER.hull) * 100}%`;
    this.hullBar.classList.toggle('low', p.hull < 30);
    this.energyBar.style.width = `${(p.energy / PLAYER.energy) * 100}%`;
    this.stats.textContent = `WAVE ${game.wave}   HOSTILES ${game.enemies.length}   SCORE ${game.score}`;
    const mode = p.cruising ? '  CRUISE' : p.boosting ? '  BOOST' : '';
    this.speed.textContent = `${Math.round(p.vel.length())} m/s${mode}`;
    this.speed.classList.toggle('cruise', p.cruising);
    const alt = nav.altitude < 3000 && nav.zone !== 'mine' ? `   ALT ${Math.max(0, Math.round(nav.altitude))} m` : '';
    this.zone.textContent = `${nav.zone.toUpperCase()}${alt}`;
    this.updateWaypoints(game, nav.waypoints);
    this.warn.classList.toggle('show', p.outOfBounds);

    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    this.vignette.style.opacity = String(this.hurt);

    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msg.parentElement!.classList.remove('show');
    }

    this.updateMarkers(game);
  }

  private updateWaypoints(game: Game, list: Waypoint[]) {
    const cam = game.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    while (this.waypoints.length < list.length) {
      const root = el('div', 'waypoint', this.markerLayer);
      el('div', 'wp-diamond', root);
      const label = el('div', 'wp-label', root);
      this.waypoints.push({ root, label });
    }
    this.waypoints.forEach((wp, i) => {
      const t = list[i];
      if (!t) {
        wp.root.style.display = 'none';
        return;
      }
      wp.root.style.display = 'block';
      const dist = t.pos.distanceTo(cam.position);
      wp.label.textContent = `${t.label} ${fmtDist(dist)}`;
      _v.copy(t.pos).applyMatrix4(cam.matrixWorldInverse);
      const inFront = _v.z < 0;
      _v.applyMatrix4(cam.projectionMatrix);
      let sx = (_v.x * 0.5 + 0.5) * w;
      let sy = (-_v.y * 0.5 + 0.5) * h;
      const m = 48;
      if (!inFront || sx < m || sx > w - m || sy < m || sy > h - m) {
        // Clamp to the screen edge in the target's direction.
        _v.copy(t.pos).applyMatrix4(cam.matrixWorldInverse);
        const ang = Math.atan2(-_v.y, _v.x);
        const rx = w / 2 - m;
        const ry = h / 2 - m;
        sx = w / 2 + Math.cos(ang) * rx;
        sy = h / 2 + Math.sin(ang) * ry;
      }
      wp.root.style.transform = `translate(${sx}px, ${sy}px)`;
      wp.root.classList.toggle('flip', sx > w - 180);
    });
  }

  private updateMarkers(game: Game) {
    const cam = game.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    while (this.markers.length < game.enemies.length) {
      const box = el('div', 'marker', this.markerLayer);
      const hp = el('div', 'marker-hp', box);
      const arrow = el('div', 'edge-arrow', this.markerLayer);
      const lead = el('div', 'lead', this.markerLayer);
      this.markers.push({ box, hp, arrow, lead });
    }
    cam.updateMatrixWorld();
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i];
      const e = game.enemies[i];
      if (!e) {
        m.box.style.display = m.arrow.style.display = m.lead.style.display = 'none';
        continue;
      }
      _v.copy(e.mesh.position).applyMatrix4(cam.matrixWorldInverse);
      const dist = _v.length();
      const inFront = _v.z < 0;
      _v.applyMatrix4(cam.projectionMatrix);
      const sx = (_v.x * 0.5 + 0.5) * w;
      const sy = (-_v.y * 0.5 + 0.5) * h;
      const onScreen = inFront && sx > 0 && sx < w && sy > 0 && sy < h;

      if (onScreen) {
        const size = THREE.MathUtils.clamp(2200 / dist, 18, 90);
        m.box.style.display = 'block';
        m.box.style.transform = `translate(${sx - size / 2}px, ${sy - size / 2}px)`;
        m.box.style.width = m.box.style.height = `${size}px`;
        m.hp.style.width = `${(e.hp / e.maxHp) * 100}%`;
        m.arrow.style.display = 'none';

        // Lead marker: where to shoot so the bolt meets the target.
        game.leadPoint(e, _lead).applyMatrix4(cam.matrixWorldInverse);
        if (_lead.z < 0 && dist < 300) {
          _lead.applyMatrix4(cam.projectionMatrix);
          m.lead.style.display = 'block';
          m.lead.style.transform = `translate(${(_lead.x * 0.5 + 0.5) * w - 6}px, ${(-_lead.y * 0.5 + 0.5) * h - 6}px)`;
        } else m.lead.style.display = 'none';
      } else {
        m.box.style.display = 'none';
        m.lead.style.display = 'none';
        // Point to the off-screen enemy from the screen centre.
        _v.copy(e.mesh.position).applyMatrix4(cam.matrixWorldInverse);
        const ang = Math.atan2(-_v.y, _v.x);
        const rx = w / 2 - 36;
        const ry = h / 2 - 36;
        m.arrow.style.display = 'block';
        m.arrow.style.transform = `translate(${w / 2 + Math.cos(ang) * rx - 9}px, ${h / 2 + Math.sin(ang) * ry - 9}px) rotate(${ang}rad)`;
      }
    }
  }
}
