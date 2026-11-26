// Unified input for keyboard + mouse (pointer lock) and touch (twin virtual sticks).

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

export class Input {
  /** strafe (-1 left .. 1 right) */
  moveX = 0;
  /** vertical (-1 down .. 1 up) */
  moveY = 0;
  /** thrust (-1 back .. 1 forward) */
  moveZ = 0;
  /** turn rate from the touch stick, -1..1 */
  turnX = 0;
  turnY = 0;
  roll = 0;
  fire = false;
  boost = false;
  locked = false;
  readonly touch: boolean;
  onLockChange?: (locked: boolean) => void;
  onPause?: () => void;

  private keys = new Set<string>();
  private mouseDown = false;
  private lookX = 0;
  private lookY = 0;
  private tMoveX = 0;
  private tMoveZ = 0;
  private tBoost = false;
  private cruiseToggle = false;

  constructor(private el: HTMLElement, touchRoot: HTMLElement) {
    this.touch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.code === 'KeyP') this.onPause?.();
      if (e.code === 'KeyX' && !e.repeat) this.cruiseToggle = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.mouseDown = false;
      this.onLockChange?.(this.locked);
    });

    if (this.touch) this.setupTouch(touchRoot);
  }

  requestLock() {
    if (this.touch) return;
    try {
      const r = this.el.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /** Mouse movement since last call, in pixels. */
  consumeLook(): [number, number] {
    const r: [number, number] = [this.lookX, this.lookY];
    this.lookX = this.lookY = 0;
    return r;
  }

  /** True once per press of the cruise key / button. */
  consumeCruiseToggle() {
    const t = this.cruiseToggle;
    this.cruiseToggle = false;
    return t;
  }

  poll() {
    const k = (...codes: string[]) => (codes.some((c) => this.keys.has(c)) ? 1 : 0);
    this.moveZ = clamp1(k('KeyW') - k('KeyS') + this.tMoveZ);
    this.moveX = clamp1(k('KeyD') - k('KeyA') + this.tMoveX);
    this.moveY = clamp1(k('Space', 'KeyR') - k('KeyC', 'KeyF'));
    this.roll = k('KeyQ') - k('KeyE');
    this.boost = k('ShiftLeft', 'ShiftRight') === 1 || this.tBoost;
    this.fire = this.mouseDown;
  }

  private setupTouch(root: HTMLElement) {
    root.classList.add('touch');

    const stick = (side: 'left' | 'right', label: string, cb: (x: number, y: number) => void) => {
      const zone = document.createElement('div');
      zone.className = `zone ${side}`;
      const base = document.createElement('div');
      base.className = 'stick-base';
      const knob = document.createElement('div');
      knob.className = 'stick-knob';
      const cap = document.createElement('span');
      cap.className = 'stick-label';
      cap.textContent = label;
      base.append(knob, cap);
      zone.appendChild(base);
      root.appendChild(zone);

      const R = 56;
      let id: number | null = null;
      let ox = 0;
      let oy = 0;
      zone.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          if (id !== null) return;
          const t = e.changedTouches[0];
          const r = zone.getBoundingClientRect();
          id = t.identifier;
          ox = t.clientX;
          oy = t.clientY;
          base.style.left = `${t.clientX - r.left}px`;
          base.style.top = `${t.clientY - r.top}px`;
          base.style.bottom = 'auto';
          base.classList.add('active');
          cb(0, 0);
        },
        { passive: false },
      );
      zone.addEventListener(
        'touchmove',
        (e) => {
          e.preventDefault();
          for (const t of Array.from(e.changedTouches)) {
            if (t.identifier !== id) continue;
            let dx = t.clientX - ox;
            let dy = t.clientY - oy;
            const l = Math.hypot(dx, dy);
            if (l > R) {
              dx *= R / l;
              dy *= R / l;
            }
            knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            cb(dx / R, dy / R);
          }
        },
        { passive: false },
      );
      const end = (e: TouchEvent) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier !== id) continue;
          id = null;
          base.classList.remove('active');
          base.removeAttribute('style');
          knob.style.transform = '';
          cb(0, 0);
        }
      };
      zone.addEventListener('touchend', end);
      zone.addEventListener('touchcancel', end);
    };

    stick('left', 'MOVE', (x, y) => {
      this.tMoveX = x;
      this.tMoveZ = -y;
    });
    // Quadratic response gives fine aim near the centre and fast turns at the edge.
    stick('right', 'AIM', (x, y) => {
      this.turnX = Math.sign(x) * x * x;
      this.turnY = Math.sign(y) * y * y;
    });

    const button = (cls: string, text: string, down: () => void, up?: () => void) => {
      const b = document.createElement('button');
      b.className = `tbtn ${cls}`;
      b.textContent = text;
      b.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          b.classList.add('down');
          down();
        },
        { passive: false },
      );
      const release = (e: TouchEvent) => {
        e.preventDefault();
        b.classList.remove('down');
        up?.();
      };
      b.addEventListener('touchend', release);
      b.addEventListener('touchcancel', release);
      root.appendChild(b);
    };
    button(
      'boost',
      'BOOST',
      () => (this.tBoost = true),
      () => (this.tBoost = false),
    );
    button('cruise', 'CRUISE', () => (this.cruiseToggle = true));
    button('pause', 'II', () => this.onPause?.());
  }
}
