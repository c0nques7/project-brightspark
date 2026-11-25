import './style.css';
import { GameEngine } from './game/gameEngine';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const hudRoot = document.getElementById('hud-root') as HTMLElement | null;

if (canvas && hudRoot) {
  new GameEngine(canvas, hudRoot);
}
