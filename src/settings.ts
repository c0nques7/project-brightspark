// Player settings, persisted in localStorage. Everything here is optional to the game: if storage is
// unavailable the defaults are used and changes just last for the session.

export type Action = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down' | 'rollLeft' | 'rollRight' | 'boost' | 'cruise' | 'cockpit' | 'mute';

export const ACTIONS: { id: Action; label: string }[] = [
  { id: 'forward', label: 'Thrust forward' },
  { id: 'back', label: 'Thrust back' },
  { id: 'left', label: 'Strafe left' },
  { id: 'right', label: 'Strafe right' },
  { id: 'up', label: 'Strafe up' },
  { id: 'down', label: 'Strafe down' },
  { id: 'rollLeft', label: 'Roll left' },
  { id: 'rollRight', label: 'Roll right' },
  { id: 'boost', label: 'Boost' },
  { id: 'cruise', label: 'Cruise' },
  { id: 'cockpit', label: 'Toggle cockpit' },
  { id: 'mute', label: 'Mute' },
];

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['Space', 'KeyR'],
  down: ['KeyC', 'KeyF'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  boost: ['ShiftLeft', 'ShiftRight'],
  cruise: ['KeyX'],
  cockpit: ['KeyV'],
  mute: ['KeyM'],
};

export interface Settings {
  /** -1 = automatic, else a fixed tier index (0 low .. 3 ultra). */
  quality: number;
  /** Multiplier on the bloom strength, 0..1.5. */
  bloom: number;
  /** Screen effects: vignette, chromatic fringe, grain. */
  effects: boolean;
  fov: number;
  cockpit: boolean;
  volume: number;
  muted: boolean;
  mouseSens: number;
  touchSens: number;
  invertY: boolean;
  bindings: Record<Action, string[]>;
}

export const DEFAULTS: Settings = {
  quality: -1,
  bloom: 1,
  effects: true,
  fov: 75,
  cockpit: true,
  volume: 0.7,
  muted: false,
  mouseSens: 1,
  touchSens: 1,
  invertY: false,
  bindings: DEFAULT_BINDINGS,
};

const KEY = 'bs-settings';

function load(): Settings {
  const s: Settings = { ...DEFAULTS, bindings: structuredClone(DEFAULT_BINDINGS) };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
        if (k === 'bindings') continue;
        if (saved[k] !== undefined && typeof saved[k] === typeof DEFAULTS[k]) (s as unknown as Record<string, unknown>)[k] = saved[k];
      }
      if (saved.bindings) for (const a of ACTIONS) if (Array.isArray(saved.bindings[a.id])) s.bindings[a.id] = saved.bindings[a.id].slice(0, 2);
    } else {
      // Carry over the older single-purpose keys.
      if (localStorage.getItem('bs-cockpit') === '0') s.cockpit = false;
      const q = localStorage.getItem('bs-quality');
      if (q !== null && Number.isInteger(Number(q))) s.quality = Number(q);
    }
  } catch {
    /* ignore */
  }
  return s;
}

export const settings = load();

const listeners: (() => void)[] = [];

/** Save and notify everything that applies settings. */
export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

export function onSettingsChange(fn: () => void) {
  listeners.push(fn);
}

/** Human-readable key name for a KeyboardEvent.code. */
export function keyName(code: string) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'L Shift',
    ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl',
    ControlRight: 'R Ctrl',
    AltLeft: 'L Alt',
    AltRight: 'R Alt',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Tab: 'Tab',
    Enter: 'Enter',
    Backspace: 'Backspace',
  };
  return map[code] ?? code;
}
