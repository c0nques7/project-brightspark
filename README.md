# Project Brightspark

A first-person 6-DoF space combat roguelike blending **Everspace**-style sector runs with **Descent 2**-style procedural 3D mine clearing and persistent planetary base building.

Built in a single **TypeScript + Three.js + Vite** codebase for desktop (keyboard + mouse) and mobile (dual virtual touch sticks), ready for automatic deployment on Vercel.

## Features Implemented

- **6-DoF Space Flight & Combat**
  - Quaternion-based pitch, yaw, roll, lateral & vertical strafe, afterburner boost, and toggleable inertial flight assist (`Z`).
  - Twin/Triple pulse lasers + homing micro-missiles + enemy Interceptors and Heavy Strikers that flank, lead shots, and drop magnetic salvage loot.
  - Responsive mobile touch controls (dual virtual thumbsticks + `FIRE`, `MSL`, `BOOST`, `UP/DN`, `ROLL`, `DOCK` buttons, plus subtle touch aim-assist magnetism). Desktop players can preview touch controls from the Title or Pause menu.
- **Procedural Descent-Style 3D Mine Levels**
  - Seeded 3D tunnel networks with corridors, vertical shafts, side alcoves, and smooth wall-sliding collision.
  - Floating proximity mines (shootable for chain blasts), wall/ceiling defense turrets, underground security sentinels, and a multi-ring **Reactor Core**.
  - Destroying the reactor triggers a live **Meltdown Escape Countdown** with flashing alarms and glowing green breadcrumb chevrons guiding you back to the Exit Airlock.
- **Sector Map & Persistent Planetary Bases**
  - Fly directly to orbital planet beacons (`E`) or open the **Sector Map (`M` / `Tab`)** to descend into mines, dock at cleared bases for free hull repair/rearm, or warp to the next sector.
  - Clearing a planet's mine establishes a permanent **Planetary Base** and unlocks persistent upgrades (`Weapons Foundry`, `Aegis Relay`, `Alloy Drydock`, `Ion Drive Lab`, `Ordnance Fabricator`, `Salvage Refinery`) that carry over between runs.
- **Roguelike Loop, Browser Saves & Procedural Audio**
  - Infinite procedurally generated sectors with scaling enemies and rewards.
  - Automatic `localStorage` persistence for bases, upgrades, resources, settings, and in-progress runs.
  - Zero-asset procedural Web Audio API sound effects (lasers, enemy plasma, missiles, explosions, alarms, pickups, fanfares).

## Controls

| Action | PC (Keyboard + Mouse) | Mobile (Touch) |
| --- | --- | --- |
| Thrust / Strafe | `W A S D` | Left Thumbstick |
| Pitch / Yaw Aim | Mouse (click to lock) or Arrow Keys | Right Thumbstick |
| Vertical Strafe | `Space` / `Ctrl` (or `R` / `C`) | `▲ UP` / `▼ DN` |
| Roll | `Q` / `E` | `↺` / `↻` |
| Boost | `Shift` | `BOOST` |
| Primary Lasers | Left Click (or `J`) | `FIRE` |
| Homing Missiles | Right Click (or `F`) | `MSL` |
| Dock / Enter Mine / Warp | `E` (or `Enter`) near beacon | `DOCK` |
| Sector Map & Base Upgrades | `M` or `Tab` | `MAP / BASES` button |
| Toggle Flight Assist | `Z` | Pause Menu |
| Pause | `Esc` or `P` | `☰` button |

## Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
```
