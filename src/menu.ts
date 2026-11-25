import { ACTIONS, DEFAULTS, DEFAULT_BINDINGS, keyName, saveSettings, settings, type Action } from './settings';

// The Esc / pause menu (also reachable from the title screen): resume, graphics, controls,
// sound, fullscreen and quit. Plain DOM so it works the same with a mouse or a finger.

export interface MenuHooks {
  resume(): void;
  quit(): void;
  qualityNames: string[];
  touch: boolean;
}

type Page = 'main' | 'graphics' | 'controls' | 'sound';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export class Menu {
  private root: HTMLElement;
  private panel: HTMLElement;
  private page: Page = 'main';
  private mode: 'pause' | 'title' = 'pause';
  private capture: { action: Action; slot: number } | null = null;
  open = false;

  constructor(private hooks: MenuHooks) {
    this.root = h('div', 'menu hidden');
    this.panel = h('div', 'menu-panel');
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
    // Clicks inside the menu must not fall through to the title overlay (which launches the game).
    this.root.addEventListener('click', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    document.addEventListener('fullscreenchange', () => this.open && this.render());
  }

  show(mode: 'pause' | 'title') {
    this.mode = mode;
    this.page = 'main';
    this.capture = null;
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.open = false;
    this.capture = null;
    this.root.classList.add('hidden');
  }

  private onKey(e: KeyboardEvent) {
    if (!this.open) return;
    if (this.capture) {
      e.preventDefault();
      e.stopPropagation();
      const { action, slot } = this.capture;
      this.capture = null;
      if (e.code === 'Escape') return this.render();
      const list = settings.bindings[action].slice();
      if (e.code === 'Backspace' || e.code === 'Delete') list.splice(slot, 1);
      else {
        // A key does one thing: take it away from any other action first.
        for (const a of ACTIONS) settings.bindings[a.id] = settings.bindings[a.id].filter((c) => c !== e.code);
        const own = settings.bindings[action].slice();
        own[slot] = e.code;
        settings.bindings[action] = own.filter(Boolean).slice(0, 2);
        saveSettings();
        return this.render();
      }
      settings.bindings[action] = list;
      saveSettings();
      return this.render();
    }
    if (e.code === 'Escape' && this.page !== 'main') {
      e.preventDefault();
      e.stopPropagation();
      this.go('main');
    }
    // Keep game hotkeys (cockpit, mute, quality) from firing while the menu is up.
    e.stopPropagation();
  }

  private go(p: Page) {
    this.page = p;
    this.render();
  }

  private render() {
    const p = this.panel;
    p.innerHTML = '';
    if (this.page === 'main') this.renderMain(p);
    else if (this.page === 'graphics') this.renderGraphics(p);
    else if (this.page === 'controls') this.renderControls(p);
    else this.renderSound(p);
  }

  private title(p: HTMLElement, text: string) {
    p.appendChild(h('h2', 'menu-title', text));
  }

  private button(p: HTMLElement, text: string, fn: () => void, cls = '') {
    const b = h('button', `menu-btn ${cls}`, text);
    b.addEventListener('click', fn);
    p.appendChild(b);
    return b;
  }

  private back(p: HTMLElement) {
    const row = h('div', 'menu-footer');
    this.button(row, '‹ BACK', () => this.go('main'), 'ghost');
    p.appendChild(row);
  }

  private renderMain(p: HTMLElement) {
    this.title(p, this.mode === 'pause' ? 'PAUSED' : 'SETTINGS');
    const list = h('div', 'menu-list');
    p.appendChild(list);
    this.button(list, this.mode === 'pause' ? 'RESUME' : 'BACK', () => this.hooks.resume(), 'primary');
    this.button(list, 'GRAPHICS', () => this.go('graphics'));
    this.button(list, 'CONTROLS', () => this.go('controls'));
    this.button(list, 'SOUND', () => this.go('sound'));
    if (document.fullscreenEnabled) {
      this.button(list, document.fullscreenElement ? 'EXIT FULL SCREEN' : 'FULL SCREEN', () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
      });
    }
    if (this.mode === 'pause') this.button(list, 'QUIT TO TITLE', () => this.hooks.quit(), 'danger');
  }

  // ---------- Rows ----------
  private row(p: HTMLElement, label: string, hint = '') {
    const r = h('div', 'menu-row');
    const l = h('div', 'menu-label', label);
    if (hint) l.appendChild(h('span', 'menu-hint', hint));
    r.appendChild(l);
    p.appendChild(r);
    const ctl = h('div', 'menu-ctl');
    r.appendChild(ctl);
    return ctl;
  }

  private slider(p: HTMLElement, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) {
    const ctl = this.row(p, label);
    const input = h('input', 'menu-range');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    const out = h('span', 'menu-value', fmt(get()));
    input.addEventListener('input', () => {
      set(Number(input.value));
      out.textContent = fmt(Number(input.value));
      saveSettings();
    });
    ctl.append(input, out);
  }

  private toggle(p: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void, hint = '') {
    const ctl = this.row(p, label, hint);
    const b = h('button', 'menu-toggle');
    const paint = () => {
      b.textContent = get() ? 'ON' : 'OFF';
      b.classList.toggle('on', get());
    };
    paint();
    b.addEventListener('click', () => {
      set(!get());
      paint();
      saveSettings();
    });
    ctl.appendChild(b);
  }

  private segmented(p: HTMLElement, label: string, options: { label: string; value: number }[], get: () => number, set: (v: number) => void) {
    const ctl = this.row(p, label);
    const seg = h('div', 'menu-seg');
    for (const o of options) {
      const b = h('button', '', o.label);
      b.classList.toggle('on', get() === o.value);
      b.addEventListener('click', () => {
        set(o.value);
        saveSettings();
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      });
      seg.appendChild(b);
    }
    ctl.appendChild(seg);
  }

  // ---------- Pages ----------
  private renderGraphics(p: HTMLElement) {
    this.title(p, 'GRAPHICS');
    const body = h('div', 'menu-body');
    p.appendChild(body);
    const q = [{ label: 'AUTO', value: -1 }, ...this.hooks.qualityNames.map((n, i) => ({ label: n, value: i }))];
    this.segmented(body, 'Quality', q, () => settings.quality, (v) => (settings.quality = v));
    body.appendChild(h('div', 'menu-note', 'Auto lowers detail when the frame rate drops and raises it again when there is headroom.'));
    this.slider(body, 'Bloom', 0, 1.5, 0.05, () => settings.bloom, (v) => (settings.bloom = v), (v) => (v < 0.01 ? 'OFF' : `${Math.round(v * 100)}%`));
    this.slider(body, 'Field of view', 60, 100, 1, () => settings.fov, (v) => (settings.fov = v), (v) => `${v}°`);
    this.toggle(body, 'Cockpit view', () => settings.cockpit, (v) => (settings.cockpit = v));
    this.toggle(body, 'Screen effects', () => settings.effects, (v) => (settings.effects = v), 'vignette, colour fringe, grain');
    const reset = h('div', 'menu-footer');
    this.button(reset, '‹ BACK', () => this.go('main'), 'ghost');
    this.button(reset, 'RESET', () => {
      Object.assign(settings, { quality: DEFAULTS.quality, bloom: DEFAULTS.bloom, fov: DEFAULTS.fov, cockpit: DEFAULTS.cockpit, effects: DEFAULTS.effects });
      saveSettings();
      this.render();
    }, 'ghost');
    p.appendChild(reset);
  }

  private renderControls(p: HTMLElement) {
    this.title(p, 'CONTROLS');
    const body = h('div', 'menu-body');
    p.appendChild(body);
    if (this.hooks.touch) {
      this.slider(body, 'Aim stick speed', 0.4, 2, 0.05, () => settings.touchSens, (v) => (settings.touchSens = v), (v) => `${v.toFixed(2)}×`);
    }
    else this.slider(body, 'Mouse sensitivity', 0.2, 3, 0.05, () => settings.mouseSens, (v) => (settings.mouseSens = v), (v) => `${v.toFixed(2)}×`);
    this.toggle(body, 'Invert vertical aim', () => settings.invertY, (v) => (settings.invertY = v));
    // Phones and tablets have no keyboard to rebind.
    if (!this.hooks.touch) this.renderKeys(body);
    const foot = h('div', 'menu-footer');
    this.button(foot, '‹ BACK', () => this.go('main'), 'ghost');
    this.button(foot, 'RESET', () => {
      settings.bindings = structuredClone(DEFAULT_BINDINGS);
      Object.assign(settings, { mouseSens: DEFAULTS.mouseSens, touchSens: DEFAULTS.touchSens, invertY: DEFAULTS.invertY });
      saveSettings();
      this.render();
    }, 'ghost');
    p.appendChild(foot);
  }

  private renderKeys(body: HTMLElement) {

    body.appendChild(h('div', 'menu-sub', 'KEYS'));
    body.appendChild(h('div', 'menu-note', 'Click a key, then press the new one. Backspace clears it, Esc cancels. Mouse: aim and left-click to fire.'));
    const grid = h('div', 'menu-keys');
    body.appendChild(grid);
    for (const a of ACTIONS) {
      grid.appendChild(h('div', 'menu-label', a.label));
      for (let slot = 0; slot < 2; slot++) {
        const code = settings.bindings[a.id][slot];
        const capturing = this.capture?.action === a.id && this.capture.slot === slot;
        const b = h('button', `menu-key${capturing ? ' capturing' : ''}${code ? '' : ' empty'}`, capturing ? 'PRESS A KEY' : code ? keyName(code) : '—');
        b.addEventListener('click', () => {
          this.capture = { action: a.id, slot: code ? slot : Math.min(slot, settings.bindings[a.id].length) };
          this.render();
        });
        grid.appendChild(b);
      }
    }
  }

  private renderSound(p: HTMLElement) {
    this.title(p, 'SOUND');
    const body = h('div', 'menu-body');
    p.appendChild(body);
    this.slider(body, 'Volume', 0, 1, 0.05, () => settings.volume, (v) => (settings.volume = v), (v) => `${Math.round(v * 100)}%`);
    this.toggle(body, 'Mute', () => settings.muted, (v) => (settings.muted = v));
    this.back(p);
  }
}
