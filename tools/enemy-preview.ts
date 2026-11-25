// Dev-only turntable for enemy models: /tools/enemy-preview.html?kind=bulwark&yaw=0.6
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MODELS } from '../src/enemies/models';
import { SPACE_MODELS } from '../src/enemies/space-models';
const ALL = { ...MODELS, ...SPACE_MODELS } as Record<string, () => import('../src/enemies/models').Model>;

const q = new URLSearchParams(location.search);
const kind = q.get('kind') ?? 'warden';
const yaw = Number(q.get('yaw') ?? 0.7);
const pitch = Number(q.get('pitch') ?? 0.25);
const mine = kind === 'tick' || kind === 'lantern' || kind === 'heartforge';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(mine ? 0x07080a : 0x03050b);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const key = new THREE.DirectionalLight(mine ? 0xffe2c0 : 0xfff2e0, 2.6);
key.position.set(4, 6, 5);
const rim = new THREE.DirectionalLight(mine ? 0x6688aa : 0x88aaff, 1.6);
rim.position.set(-6, 2, -5);
scene.add(key, rim, new THREE.HemisphereLight(0x8899bb, 0x221a14, 0.5));

const m = ALL[kind]();
scene.add(m.root);
m.root.rotation.set(pitch, yaw, 0);
if (kind === 'heartforge') {
  // Show one vent opened.
  m.parts.shutter0.position.x -= 1.6;
  m.parts.shutter1.position.x += 1.6;
}
if (kind === 'shade') m.body.opacity = 1;
m.root.updateMatrixWorld(true);
const beam = m.parts.beam ?? m.parts.bubble;
const beamParent = beam?.parent;
beam?.removeFromParent();

const box = new THREE.Box3().setFromObject(m.root);
const size = box.getSize(new THREE.Vector3()).length();
const center = box.getCenter(new THREE.Vector3());
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 500);
if (beam) beamParent!.add(beam);
const fit = kind === 'lantern' ? 1.15 : kind === 'aegis' ? 1.35 : kind === 'matriarch' ? 0.62 : kind in SPACE_MODELS ? 0.72 : 1;
camera.position.copy(center).add(new THREE.Vector3(0, size * 0.12, size * 1.55 * fit));
camera.lookAt(center);

const composer = new EffectComposer(renderer, q.get("ldr") ? new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.UnsignedByteType }) : undefined);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.35, 1.0));
composer.addPass(new OutputPass());
if (q.get('raw')) renderer.render(scene, camera); else composer.render();
(window as any).model = m;
(window as any).ready = true;
