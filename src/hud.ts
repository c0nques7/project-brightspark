import * as THREE from 'three';
import { PLAYER, type Game } from './game';

const _v = new THREE.Vector3();
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

  update(dt: number, game: Game) {
    const p = game.player;
    this.shieldBar.style.width = `${(p.shield / PLAYER.shield) * 100}%`;
    this.hullBar.style.width = `${(p.hull / PLAYER.hull) * 100}%`;
    this.hullBar.classList.toggle('low', p.hull < 30);
    this.energyBar.style.width = `${(p.energy / PLAYER.energy) * 100}%`;
    this.stats.textContent = `WAVE ${game.wave}   HOSTILES ${game.enemies.length}   SCORE ${game.score}`;
    this.speed.textContent = `${Math.round(p.vel.length())} m/s${p.boosting ? '  BOOST' : ''}`;
    this.warn.classList.toggle('show', p.outOfBounds);

    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    this.vignette.style.opacity = String(this.hurt);

    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msg.parentElement!.classList.remove('show');
    }

    this.updateMarkers(game);
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
