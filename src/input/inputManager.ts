import type { InputState } from '../types';

interface TouchStickState {
  pointerId: number | null;
  originX: number;
  originY: number;
  x: number; // -1..1
  y: number; // -1..1
}

export class InputManager {
  private keys = new Set<string>();
  private mouseDownLeft = false;
  private mouseDownRight = false;
  private dragLookActive = false;
  private lastDragX = 0;
  private lastDragY = 0;

  private pendingPitchDelta = 0;
  private pendingYawDelta = 0;
  private pendingMissile = false;
  private pendingInteract = false;
  private pendingMap = false;
  private pendingPause = false;
  private pendingAssistToggle = false;

  private pointerLocked = false;
  private invertY = false;
  private sensitivity = 1.0;

  // Touch state
  public isTouchDevice = false;
  private forceTouch = false;
  private leftStick: TouchStickState = { pointerId: null, originX: 0, originY: 0, x: 0, y: 0 };
  private rightStick: TouchStickState = { pointerId: null, originX: 0, originY: 0, x: 0, y: 0 };
  private touchFire = false;
  private touchBoost = false;
  private touchUp = false;
  private touchDown = false;
  private touchRollLeft = false;
  private touchRollRight = false;

  private touchOverlayEl: HTMLElement | null = null;
  private leftKnobEl: HTMLElement | null = null;
  private rightKnobEl: HTMLElement | null = null;
  private canvas: HTMLCanvasElement;
  private onPointerLockChange?: (locked: boolean) => void;
  private isPlayingCheck: () => boolean;

  constructor(
    canvas: HTMLCanvasElement,
    isPlayingCheck: () => boolean,
    onPointerLockChange?: (locked: boolean) => void
  ) {
    this.canvas = canvas;
    this.isPlayingCheck = isPlayingCheck;
    this.onPointerLockChange = onPointerLockChange;
    this.isTouchDevice =
      'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;

    this.bindDesktopEvents();
  }

  public setSettings(invertY: boolean, sensitivity: number, forceTouch: boolean): void {
    this.invertY = invertY;
    this.sensitivity = sensitivity;
    this.forceTouch = forceTouch;
    this.updateTouchOverlayVisibility();
  }

  public isTouchControlsVisible(): boolean {
    return this.isTouchDevice || this.forceTouch;
  }

  public requestPointerLock(): void {
    if (this.isTouchControlsVisible()) return;
    if (document.pointerLockElement !== this.canvas && this.canvas.requestPointerLock) {
      try {
        const res = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        if (res && typeof res.catch === 'function') {
          res.catch(() => {
            // Pointer lock may be blocked in embedded views; drag-look fallback works seamlessly.
          });
        }
      } catch {
        // Fallback to drag look
      }
    }
  }

  public exitPointerLock(): void {
    if (document.pointerLockElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  public isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  public mountTouchControls(container: HTMLElement): void {
    if (this.touchOverlayEl) {
      this.touchOverlayEl.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'touch-controls';
    overlay.innerHTML = `
      <div class="touch-zone touch-left" data-stick="left">
        <div class="stick-base">
          <div class="stick-knob" data-knob="left"></div>
        </div>
        <span class="stick-label">THRUST / STRAFE</span>
      </div>
      <div class="touch-zone touch-right" data-stick="right">
        <div class="stick-base">
          <div class="stick-knob" data-knob="right"></div>
        </div>
        <span class="stick-label">AIM / PITCH</span>
      </div>
      <div class="touch-actions-left">
        <button class="tbtn" data-act="up">▲ UP</button>
        <button class="tbtn" data-act="down">▼ DN</button>
        <button class="tbtn" data-act="rollL">↺</button>
        <button class="tbtn" data-act="rollR">↻</button>
      </div>
      <div class="touch-actions-right">
        <button class="tbtn tbtn-fire" data-act="fire">FIRE</button>
        <button class="tbtn tbtn-missile" data-act="missile">MSL</button>
        <button class="tbtn tbtn-boost" data-act="boost">BOOST</button>
        <button class="tbtn tbtn-interact" data-act="interact">DOCK</button>
      </div>
    `;
    container.appendChild(overlay);
    this.touchOverlayEl = overlay;
    this.leftKnobEl = overlay.querySelector('[data-knob="left"]');
    this.rightKnobEl = overlay.querySelector('[data-knob="right"]');

    const leftZone = overlay.querySelector('[data-stick="left"]') as HTMLElement;
    const rightZone = overlay.querySelector('[data-stick="right"]') as HTMLElement;

    this.bindStick(leftZone, this.leftStick, this.leftKnobEl);
    this.bindStick(rightZone, this.rightStick, this.rightKnobEl);

    const bindHoldBtn = (selector: string, setter: (v: boolean) => void) => {
      const btn = overlay.querySelector(selector) as HTMLElement | null;
      if (!btn) return;
      const onDown = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('active');
        setter(true);
      };
      const onUp = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.remove('active');
        setter(false);
      };
      btn.addEventListener('pointerdown', onDown);
      btn.addEventListener('pointerup', onUp);
      btn.addEventListener('pointercancel', onUp);
      btn.addEventListener('pointerleave', onUp);
    };

    bindHoldBtn('[data-act="fire"]', (v) => (this.touchFire = v));
    bindHoldBtn('[data-act="boost"]', (v) => (this.touchBoost = v));
    bindHoldBtn('[data-act="up"]', (v) => (this.touchUp = v));
    bindHoldBtn('[data-act="down"]', (v) => (this.touchDown = v));
    bindHoldBtn('[data-act="rollL"]', (v) => (this.touchRollLeft = v));
    bindHoldBtn('[data-act="rollR"]', (v) => (this.touchRollRight = v));

    const mslBtn = overlay.querySelector('[data-act="missile"]') as HTMLElement | null;
    mslBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.pendingMissile = true;
    });

    const dockBtn = overlay.querySelector('[data-act="interact"]') as HTMLElement | null;
    dockBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.pendingInteract = true;
    });

    this.updateTouchOverlayVisibility();
  }

  public setTouchOverlayPlaying(playing: boolean): void {
    if (!this.touchOverlayEl) return;
    const show = playing && this.isTouchControlsVisible();
    this.touchOverlayEl.style.display = show ? 'block' : 'none';
    if (!show) {
      this.resetTouchInputs();
    }
  }

  private updateTouchOverlayVisibility(): void {
    if (!this.touchOverlayEl) return;
    const show = this.isPlayingCheck() && this.isTouchControlsVisible();
    this.touchOverlayEl.style.display = show ? 'block' : 'none';
  }

  private resetTouchInputs(): void {
    this.leftStick.pointerId = null;
    this.leftStick.x = 0;
    this.leftStick.y = 0;
    this.rightStick.pointerId = null;
    this.rightStick.x = 0;
    this.rightStick.y = 0;
    this.touchFire = false;
    this.touchBoost = false;
    this.touchUp = false;
    this.touchDown = false;
    this.touchRollLeft = false;
    this.touchRollRight = false;
    if (this.leftKnobEl) this.leftKnobEl.style.transform = 'translate(-50%, -50%)';
    if (this.rightKnobEl) this.rightKnobEl.style.transform = 'translate(-50%, -50%)';
  }

  private bindStick(
    zone: HTMLElement,
    stick: TouchStickState,
    knob: HTMLElement | null
  ): void {
    const maxRadius = 42;

    const updateKnob = (dx: number, dy: number) => {
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, maxRadius);
      const angle = Math.atan2(dy, dx);
      const cx = Math.cos(angle) * clamped;
      const cy = Math.sin(angle) * clamped;
      stick.x = Math.abs(cx / maxRadius) < 0.08 ? 0 : cx / maxRadius;
      stick.y = Math.abs(cy / maxRadius) < 0.08 ? 0 : cy / maxRadius;
      if (knob) {
        knob.style.transform = `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px))`;
      }
    };

    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (stick.pointerId !== null) return;
      this.isTouchDevice = true;
      stick.pointerId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const rect = zone.getBoundingClientRect();
      stick.originX = rect.left + rect.width / 2;
      stick.originY = rect.top + rect.height / 2;
      updateKnob(e.clientX - stick.originX, e.clientY - stick.originY);
    });

    zone.addEventListener('pointermove', (e) => {
      if (stick.pointerId !== e.pointerId) return;
      e.preventDefault();
      updateKnob(e.clientX - stick.originX, e.clientY - stick.originY);
    });

    const release = (e: PointerEvent) => {
      if (stick.pointerId !== e.pointerId) return;
      stick.pointerId = null;
      stick.x = 0;
      stick.y = 0;
      if (knob) knob.style.transform = 'translate(-50%, -50%)';
    };

    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
  }

  private bindDesktopEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const code = e.code;

      if (code === 'Escape' || code === 'KeyP') {
        this.pendingPause = true;
        return;
      }
      if (code === 'Tab' || code === 'KeyM') {
        e.preventDefault();
        this.pendingMap = true;
        return;
      }
      if (!this.isPlayingCheck()) return;

      if (code === 'Space' || code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight') {
        e.preventDefault();
      }
      if (code === 'KeyE') this.pendingInteract = true;
      if (code === 'KeyF' || code === 'KeyX') this.pendingMissile = true;
      if (code === 'KeyZ') this.pendingAssistToggle = true;
      this.keys.add(code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDownLeft = false;
      this.mouseDownRight = false;
      this.dragLookActive = false;
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.onPointerLockChange?.(this.pointerLocked);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.isPlayingCheck() || this.isTouchControlsVisible()) return;
      if (e.button === 0) {
        this.mouseDownLeft = true;
        if (!this.pointerLocked) {
          this.requestPointerLock();
          this.dragLookActive = true;
          this.lastDragX = e.clientX;
          this.lastDragY = e.clientY;
        }
      } else if (e.button === 2) {
        this.mouseDownRight = true;
        this.pendingMissile = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouseDownLeft = false;
        this.dragLookActive = false;
      } else if (e.button === 2) {
        this.mouseDownRight = false;
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!this.isPlayingCheck()) return;
      const scale = 0.0022 * this.sensitivity;
      const ySign = this.invertY ? 1 : -1;

      if (this.pointerLocked) {
        this.pendingYawDelta -= e.movementX * scale;
        this.pendingPitchDelta += e.movementY * scale * ySign;
      } else if (this.dragLookActive) {
        const dx = e.clientX - this.lastDragX;
        const dy = e.clientY - this.lastDragY;
        this.lastDragX = e.clientX;
        this.lastDragY = e.clientY;
        this.pendingYawDelta -= dx * scale * 1.4;
        this.pendingPitchDelta += dy * scale * 1.4 * ySign;
      }
    });
  }

  public sample(): InputState {
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);

    const keyForward = k('KeyW') - k('KeyS');
    const keyStrafe = k('KeyD') - k('KeyA');
    const keyVertical = (k('Space') || k('KeyR') ? 1 : 0) - (k('ControlLeft') || k('KeyC') ? 1 : 0);
    const keyRoll = k('KeyQ') - k('KeyE') * 0 + (k('KeyQ') - (this.keys.has('BracketRight') ? 1 : 0));
    // Note: Q rolls left, V or Alt or Shift+Q? Let's make Q roll left and E interact OR tap E interact & hold? Better: Q/C roll? Wait:
    // Standard 6-DoF Descent controls: Q = roll left, E = roll right (and G or Enter or E near beacon? Let's keep Q/E roll AND F/G interact? Wait - users love E to interact AND Q/E to roll!).
    // Solution: Q = roll left, E = roll right, AND pressing E near a beacon triggers interact cleanly! Even better: let's use Q/E for roll AND keep E as interact when prompted.
    const rollVal =
      (this.keys.has('KeyQ') ? 1 : 0) -
      (this.keys.has('KeyE') ? 1 : 0) +
      (this.touchRollLeft ? 1 : 0) -
      (this.touchRollRight ? 1 : 0);
    void keyRoll;

    // Arrow keys also steer pitch/yaw nicely for laptop trackpad play!
    const arrowYaw = (this.keys.has('ArrowLeft') ? 1 : 0) - (this.keys.has('ArrowRight') ? 1 : 0);
    const arrowPitch =
      ((this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('ArrowDown') ? 1 : 0)) *
      (this.invertY ? -1 : 1);

    const forward = Math.max(-1, Math.min(1, keyForward - this.leftStick.y));
    const strafe = Math.max(-1, Math.min(1, keyStrafe + this.leftStick.x));
    const vertical = Math.max(
      -1,
      Math.min(1, keyVertical + (this.touchUp ? 1 : 0) - (this.touchDown ? 1 : 0))
    );

    const ySign = this.invertY ? 1 : -1;
    const pitchRate = Math.max(-1, Math.min(1, arrowPitch + this.rightStick.y * ySign));
    const yawRate = Math.max(-1, Math.min(1, arrowYaw - this.rightStick.x));

    const state: InputState = {
      forward,
      strafe,
      vertical,
      roll: Math.max(-1, Math.min(1, rollVal)),
      pitchDelta: this.pendingPitchDelta,
      yawDelta: this.pendingYawDelta,
      pitchRate,
      yawRate,
      firePrimary: this.mouseDownLeft || this.keys.has('KeyJ') || this.touchFire,
      fireSecondaryPressed: this.pendingMissile,
      boost: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchBoost,
      interactPressed: this.pendingInteract || this.keys.has('Enter'),
      mapPressed: this.pendingMap,
      pausePressed: this.pendingPause,
      assistTogglePressed: this.pendingAssistToggle,
      isTouchActive: this.isTouchControlsVisible()
    };

    this.pendingPitchDelta = 0;
    this.pendingYawDelta = 0;
    this.pendingMissile = false;
    this.pendingInteract = false;
    this.pendingMap = false;
    this.pendingPause = false;
    this.pendingAssistToggle = false;
    if (this.mouseDownRight) {
      this.mouseDownRight = false;
    }

    return state;
  }
}
