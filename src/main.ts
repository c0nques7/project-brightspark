import * as THREE from 'three';
import './style.css';
import { Cockpit } from './cockpit';
import { Environment } from './environment';
import { Fx } from './fx';
import { Renderer } from './render';
import { Game, PLAYER } from './game';
import { MineObjective } from './hazards';
import { Hud, type Waypoint } from './hud';
import { Input } from './input';
import { Menu } from './menu';
import { onSettingsChange, saveSettings, settings } from './settings';
import { Sfx } from './sfx';
import { Dust, Sky, makeRocks } from './world';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud')!;
const touchRoot = document.getElementById('touch')!;
const overlay = document.getElementById('overlay')!;
const overlayTitle = document.getElementById('overlay-title')!;
const overlayBody = document.getElementById('overlay-body')!;
const overlayAction = document.getElementById('overlay-action')!;

// ---------- Renderer & scene ----------
const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03050b);
scene.fog = new THREE.FogExp2(0x03050b, 0.00012);

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 40000);
scene.add(camera);
// Post-processed renderer (bloom, grade) with adaptive quality. Keeps logarithmicDepthBuffer.
const view = new Renderer(canvas, scene, camera, isTouch);
const renderer = view.gl;

// Sun behind the start position, so the planet ahead is lit.
const sunDir = new THREE.Vector3(0.45, 0.5, 0.75).normalize();
const sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
sun.position.copy(sunDir);
scene.add(sun);
const hemi = new THREE.HemisphereLight(0x5a78a8, 0x1a1410, 0.55);
scene.add(hemi);

const sky = new Sky(scene, sunDir, renderer, isTouch);
const dust = new Dust(scene);
const rocks = makeRocks(scene, 70);
const env = new Environment(scene, camera, sky, sun, hemi);
// Mount the mine headlight just outside the canopy so it lights the tunnel, not the dashboard.
for (const o of camera.children) {
  if (o instanceof THREE.SpotLight) {
    o.position.set(0, 0.1, -1.7);
    o.target.position.set(0, 0, -12);
  }
}

// ---------- Systems ----------
const sfx = new Sfx();
sfx.setListener(camera);
const fx = new Fx(scene);
const cockpit = new Cockpit(camera);
{
  // Image-based lighting from the nebula: soft coloured fill on rocks, ships and the cockpit.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(sky.nebula).texture;
  pmrem.dispose();
}
let hurtFx = 0;
const input = new Input(canvas, touchRoot);
const hud = new Hud(hudRoot);
const game = new Game(scene, camera, rocks, input, sfx, {
  message: (t, s, sec) => hud.message(t, s, sec),
  damaged: (a) => {
    hud.damaged(a);
    cockpit.damaged(a);
    hurtFx = Math.min(1, hurtFx + a * 0.6);
  },
  fired: (side) => cockpit.fired(side),
  exploded: (at, scale) => fx.explosion(at, scale, camera),
  impact: (at) => fx.impact(at),
  started: () => {
    for (const e of objective.populate()) game.addEnemy(e);
  },
  gameOver: (score, wave) => {
    setTimeout(() => {
      if (game.state !== 'over') return;
      document.exitPointerLock?.();
      showOverlay('SHIP DESTROYED', `Reached wave ${wave} · Score ${score}`, isTouch ? 'Tap to relaunch' : 'Click to relaunch');
    }, 1400);
  },
}, env);

// The mine's goal: destroy the reactor, then escape to the surface before the meltdown.
const objective = new MineObjective(env.mine, {
  message: (t, sub, sec) => hud.message(t, sub, sec),
  setObjective: (t, urgent) => hud.setObjective(t, urgent),
  alarm: () => sfx.alarm(),
  explode: (at, scale) => game.explode(at, scale),
  shake: (a) => game.addShake(a),
  killPlayer: () => game.killPlayer(),
  addScore: (n) => (game.score += n),
  chime: () => sfx.chime(),
});

const mineWaypoint: Waypoint = { pos: env.mine.entrance, label: 'MINE' };
const exitWaypoint: Waypoint = { pos: env.mine.entrance, label: 'EXIT' };
const zoneWaypoint: Waypoint = { pos: new THREE.Vector3(0, 0, 0), label: 'COMBAT ZONE' };

const controlsHelp = isTouch
  ? 'Left stick: thrust & strafe · Right stick: aim · Guns fire automatically when a target is under the crosshair · BOOST to sprint · CRUISE to travel to the planet and its mine'
  : 'Mouse: aim · Left click: fire · W/S: thrust · A/D: strafe · Space/C: up/down · Q/E: roll · Shift: boost · X: cruise to the planet and its mine · V: cockpit view · M: mute · Esc: menu (graphics, controls, full screen)';

function showOverlay(title: string, body: string, action: string) {
  overlayTitle.textContent = title;
  overlayBody.textContent = body;
  overlayAction.textContent = action;
  overlay.classList.remove('hidden');
  hud.setVisible(false);
  touchRoot.classList.add('hidden');
}

// ---------- Settings ----------
function applySettings() {
  view.setQuality(settings.quality);
  view.setUserEffects(settings.bloom, settings.effects);
  cockpit.setVisible(settings.cockpit);
  hudRoot.classList.toggle('cockpit', settings.cockpit);
  sfx.setVolume(settings.muted ? 0 : settings.volume);
  resize();
}
onSettingsChange(applySettings);
view.onTierChange = (t) => {
  sky.setPixelRatio(t.pixelRatio);
  if (game.state === 'playing' && settings.quality < 0) hud.message('', `GRAPHICS ${t.name}`, 1.2);
};
sky.setPixelRatio(view.tier.pixelRatio);
window.addEventListener('keydown', (e) => {
  if (e.repeat || game.state !== 'playing') return;
  if (settings.bindings.cockpit.includes(e.code)) {
    settings.cockpit = !settings.cockpit;
    saveSettings();
    sfx.blip(settings.cockpit);
  } else if (settings.bindings.mute.includes(e.code)) {
    settings.muted = !settings.muted;
    saveSettings();
  }
});

function hideOverlay() {
  overlay.classList.add('hidden');
  hud.setVisible(true);
  touchRoot.classList.remove('hidden');
}

// ---------- Pause menu ----------
const menu = new Menu({
  qualityNames: view.tierNames,
  touch: isTouch,
  resume() {
    menu.hide();
    if (game.state !== 'paused') return; // opened from the title screen: just close
    game.state = 'playing';
    sfx.setSuspended(false);
    hideOverlay();
    input.requestLock();
  },
  quit() {
    menu.hide();
    game.state = 'title';
    sfx.setSuspended(false);
    showOverlay('PROJECT: BRIGHTSPARK', controlsHelp, isTouch ? 'Tap to launch' : 'Click to launch');
  },
});

function pause() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  sfx.setSuspended(true);
  if (document.pointerLockElement) document.exitPointerLock();
  hud.setVisible(false);
  touchRoot.classList.add('hidden');
  menu.show('pause');
}

// Settings button on the title / game-over screen.
const settingsBtn = document.createElement('button');
settingsBtn.className = 'overlay-settings';
settingsBtn.textContent = 'SETTINGS';
settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  menu.show('title');
});
overlayAction.insertAdjacentElement('afterend', settingsBtn);

function goFullscreen() {
  if (!isTouch || document.fullscreenElement) return;
  const r = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  r?.then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {})).catch(() => {});
}

overlay.addEventListener('click', () => {
  if (menu.open) return;
  sfx.unlock();
  sfx.setSuspended(false);
  goFullscreen();
  if (game.state === 'paused') game.state = 'playing';
  else game.start();
  hideOverlay();
  input.requestLock();
});

input.onLockChange = (locked) => {
  if (!locked) pause();
};
input.onPause = pause;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

showOverlay('PROJECT: BRIGHTSPARK', controlsHelp, isTouch ? 'Tap to launch' : 'Click to launch');

// ---------- Resize ----------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  // Keep a usable horizontal view in portrait.
  camera.fov = w < h ? Math.min(120, settings.fov + 15) : settings.fov;
  camera.updateProjectionMatrix();
  view.setSize(w, h);
  cockpit.fit();
}
window.addEventListener('resize', resize);
applySettings();

// ---------- Loop ----------
let last = performance.now();
let wasCruising = false;
function frame(now: number) {
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, rawDt);
  last = now;
  const t = now / 1000;
  game.update(dt);
  env.update(camera, t);
  sky.follow(camera, t);
  dust.update(camera.position);
  fx.update(dt);
  const p = game.player;
  const playing = game.state === 'playing';
  const wps: Waypoint[] = [];
  objective.update(dt, playing, env.zone === 'mine', env.altitude, camera.position);
  if (env.zone !== 'mine' && objective.state !== 'escaped') wps.push(mineWaypoint);
  if (env.zone === 'mine' && objective.state === 'meltdown') wps.push(exitWaypoint);
  if (!game.inCombatZone() && env.zone !== 'mine') wps.push(zoneWaypoint);
  const nav = { zone: env.zone, altitude: env.altitude, waypoints: wps };
  if (playing) hud.update(dt, game, nav);
  cockpit.update(dt, game, nav);
  // Sky reflections fade in atmosphere (sky colour changes) and vanish underground.
  scene.environmentIntensity = 0.7 * (1 - env.atmo * 0.6) * (1 - env.under);

  if (playing && p.cruising !== wasCruising) sfx.cruise(p.cruising);
  wasCruising = p.cruising;
  sfx.update(dt, {
    playing,
    thrust: input.moveZ,
    move: Math.min(1, Math.hypot(input.moveX, input.moveY, input.moveZ)),
    speed: p.vel.length(),
    boosting: p.boosting,
    cruising: p.cruising,
    atmo: env.atmo,
    under: env.under,
    hull: p.hull / PLAYER.hull,
  });

  hurtFx = Math.max(0, hurtFx - dt * 1.6);
  view.setEffects(t, hurtFx, p.boosting ? 1 : p.cruising ? 0.6 : 0);
  // Softer bloom in daylight so the bright sky doesn't haze over.
  view.setBloom(THREE.MathUtils.lerp(0.9, 0.35, env.atmo * (1 - env.under)));
  view.render(game.state === 'paused' ? 0 : Math.min(rawDt, 0.25));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for debugging in the browser console during development.
if (import.meta.env.DEV) Object.assign(window, { game, env, THREE, renderer, view, cockpit, sfx, objective });
