import * as THREE from 'three';
import './style.css';
import { Environment } from './environment';
import { Game } from './game';
import { Hud, type Waypoint } from './hud';
import { Input } from './input';
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch || window.devicePixelRatio < 2, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.75 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03050b);
scene.fog = new THREE.FogExp2(0x03050b, 0.00012);

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 40000);
scene.add(camera);

// Sun behind the start position, so the planet ahead is lit.
const sunDir = new THREE.Vector3(0.45, 0.5, 0.75).normalize();
const sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
sun.position.copy(sunDir);
scene.add(sun);
const hemi = new THREE.HemisphereLight(0x5a78a8, 0x1a1410, 0.55);
scene.add(hemi);

const sky = new Sky(scene, sunDir);
const dust = new Dust(scene);
const rocks = makeRocks(scene, 70);
const env = new Environment(scene, camera, sky, sun, hemi);

// ---------- Systems ----------
const sfx = new Sfx();
const input = new Input(canvas, touchRoot);
const hud = new Hud(hudRoot);
const game = new Game(scene, camera, rocks, input, sfx, {
  message: (t, s, sec) => hud.message(t, s, sec),
  damaged: (a) => hud.damaged(a),
  gameOver: (score, wave) => {
    setTimeout(() => {
      if (game.state !== 'over') return;
      document.exitPointerLock?.();
      showOverlay('SHIP DESTROYED', `Reached wave ${wave} · Score ${score}`, isTouch ? 'Tap to relaunch' : 'Click to relaunch');
    }, 1400);
  },
}, env);

const mineWaypoint: Waypoint = { pos: env.mine.entrance, label: 'MINE' };
const zoneWaypoint: Waypoint = { pos: new THREE.Vector3(0, 0, 0), label: 'COMBAT ZONE' };

const controlsHelp = isTouch
  ? 'Left stick: thrust & strafe · Right stick: aim · Guns fire automatically when a target is under the crosshair · BOOST to sprint · CRUISE to travel to the planet and its mine'
  : 'Mouse: aim · Left click: fire · W/S: thrust · A/D: strafe · Space/C: up/down · Q/E: roll · Shift: boost · X: cruise to the planet and its mine · Esc: pause';

function showOverlay(title: string, body: string, action: string) {
  overlayTitle.textContent = title;
  overlayBody.textContent = body;
  overlayAction.textContent = action;
  overlay.classList.remove('hidden');
  hud.setVisible(false);
  touchRoot.classList.add('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
  hud.setVisible(true);
  touchRoot.classList.remove('hidden');
}

function pause() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  showOverlay('PAUSED', controlsHelp, isTouch ? 'Tap to resume' : 'Click to resume');
}

function goFullscreen() {
  if (!isTouch || document.fullscreenElement) return;
  const r = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  r?.then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {})).catch(() => {});
}

overlay.addEventListener('click', () => {
  sfx.unlock();
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
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep a usable horizontal view in portrait.
  camera.fov = w < h ? 90 : 75;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- Loop ----------
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  env.update(camera, now / 1000);
  sky.follow(camera);
  dust.update(camera.position);
  if (game.state === 'playing') {
    const wps: Waypoint[] = [];
    if (env.zone !== 'mine') wps.push(mineWaypoint);
    if (!game.inCombatZone() && env.zone !== 'mine') wps.push(zoneWaypoint);
    hud.update(dt, game, { zone: env.zone, altitude: env.altitude, waypoints: wps });
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for debugging in the browser console during development.
if (import.meta.env.DEV) Object.assign(window, { game, env, THREE, renderer });
