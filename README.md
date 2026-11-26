# Project: Brightspark

A first-person space exploration shooter for PC and mobile browsers. Roguelike runs through space sectors,
Descent-style mine clearing on planets, and a base you build up between fights.

Built with TypeScript, [Three.js](https://threejs.org/) and [Vite](https://vitejs.dev/).

## Running it

```bash
npm install
npm run dev        # dev server, also reachable from your phone on the same network
npm run build      # production build in dist/
npm run typecheck
```

In the browser console during `npm run dev`, `game` is the running `Game` instance.

## Controls

| | PC | Touch |
|---|---|---|
| Aim | Mouse | Right stick |
| Thrust / strafe | W S / A D | Left stick |
| Up / down | Space / C | |
| Roll | Q / E | |
| Fire | Left click | Automatic when a target is under the crosshair |
| Boost | Shift | BOOST button |
| Pause | Esc or P | II button |

## Roadmap

1. **Fly and fight in space** (current): 6DOF flight, twin lasers, drone enemies in waves, shields/hull/boost, HUD with target and lead markers.
2. **One mine level**: generated tunnels with mines and turrets, a reactor to destroy, then escape.
3. **Sector and base loop**: sector map with planets; clearing a mine unlocks a base whose upgrades persist between runs.
4. **Roguelike structure and polish**: random sectors, scaling difficulty, loot, saves, sound and menus.

## Code layout

- `src/main.ts`: renderer, scene, overlay screens and the main loop
- `src/game.ts`: player, enemies, projectiles, waves, effects, and tuning constants at the top
- `src/input.ts`: keyboard/mouse with pointer lock, and touch twin sticks
- `src/hud.ts`: bars, messages, enemy markers, off-screen arrows, lead marker
- `src/world.ts`: starfield, sun, planet, space dust, asteroids
- `src/sfx.ts`: synthesized sound effects (no audio files)
