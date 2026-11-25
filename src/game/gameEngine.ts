import * as THREE from 'three';
import { SoundEngine } from '../audio/soundEngine';
import { CombatWorld, type EnemyEntity } from '../entities/enemies';
import { PlayerShip } from '../entities/playerShip';
import { InputManager } from '../input/inputManager';
import {
  computeShipStats,
  generateSector,
  getUpgradeCost,
  loadSave,
  resetSave,
  UPGRADE_DEFS,
  writeSave
} from '../state/saveManager';
import type {
  GameMode,
  MineClearSummary,
  PlanetData,
  RunStats,
  SaveState,
  SectorData,
  ShipComputedStats,
  TargetMarker,
  UpgradeKey
} from '../types';
import {
  generateMineLayout,
  resolveMineCollision,
  type GeneratedMine
} from '../world/mineGenerator';
import { MineScene } from '../world/mineScene';
import { SpaceScene } from '../world/spaceScene';
import { GameHud } from '../ui/hud';

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private sound = new SoundEngine();
  private input: InputManager;
  private hud: GameHud;
  private player = new PlayerShip();
  private spaceScene = new SpaceScene();
  private mineScene = new MineScene();
  private combat = new CombatWorld();

  private save: SaveState;
  private stats: ShipComputedStats;
  private mode: GameMode = 'TITLE';
  private previousPlayMode: 'SPACE' | 'MINE' = 'SPACE';

  private sector: SectorData | null = null;
  private activePlanet: PlanetData | null = null;
  private activeMine: GeneratedMine | null = null;
  private mineEscapeTimer: number | null = null;
  private mineKillsCount = 0;
  private lastMineSummary: MineClearSummary | null = null;

  private runStats: RunStats = {
    sectorIndex: 1,
    enemiesDestroyed: 0,
    minesClearedThisRun: 0,
    scrapEarnedThisRun: 0,
    coresEarnedThisRun: 0,
    timeSeconds: 0
  };

  private nearestInteractAction: (() => void) | null = null;
  private nearestInteractLabel: string | null = null;
  private spaceReinforceTimer = 18;
  private lastTime = performance.now();
  private elapsed = 0;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.save = loadSave();
    this.stats = computeShipStats(this.save.upgrades, this.save.bases.length);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.25, 2800);
    this.camera.add(this.player.cockpitGroup);
    this.scene.add(this.camera);

    this.sound.setConfig(this.save.settings.soundEnabled, this.save.settings.volume);

    this.hud = new GameHud(hudRoot, {
      onStartNewRun: () => this.startNewRun(),
      onContinueRun: () => this.continueSavedRun(),
      onResume: () => this.togglePause(),
      onOpenMap: () => this.openMap(),
      onCloseMap: () => this.closeMap(),
      onSelectPlanetAction: (id) => this.handlePlanetSelection(id),
      onWarpNextSector: () => this.warpToNextSector(),
      onBuyUpgrade: (key) => this.buyUpgrade(key),
      onRepairAtBase: () => this.repairAtBase(),
      onReturnToTitle: () => this.returnToTitle(),
      onResetSave: () => this.handleResetSave(),
      onToggleSetting: (key) => this.toggleSetting(key),
      onContinueAfterMine: () => this.exitMineClearedScreen(),
      onEnterNearestPrompt: () => this.nearestInteractAction?.()
    });

    this.input = new InputManager(
      canvas,
      () => this.mode === 'SPACE' || this.mode === 'MINE'
    );
    this.input.setSettings(
      this.save.settings.invertY,
      this.save.settings.mouseSensitivity,
      this.save.settings.forceTouchControls
    );
    this.input.mountTouchControls(hudRoot);
    this.player.flightAssist = this.save.settings.flightAssist;

    // Build an attractive live space backdrop on the Title Screen
    this.sector = generateSector(1, 133742);
    this.spaceScene.build(this.scene, this.sector);
    this.player.resetPose(new THREE.Vector3(0, 18, 95), new THREE.Vector3(0, 0, -60));
    this.player.syncCamera(this.camera);

    this.refreshUi();
    window.addEventListener('resize', () => this.onResize());
    requestAnimationFrame((t) => this.loop(t));
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private persistRun(): void {
    if (!this.sector) return;
    this.save.activeRun = {
      sectorSeed: this.sector.seed,
      sectorIndex: this.sector.index,
      clearedPlanetIds: this.sector.planets.filter((p) => p.mineCleared).map((p) => p.id),
      hullRatio: Math.max(0.1, this.player.hull / this.stats.maxHull),
      missiles: this.player.missiles,
      runStats: { ...this.runStats }
    };
    writeSave(this.save);
  }

  private refreshUi(): void {
    this.hud.setMode(
      this.mode,
      this.save,
      this.sector,
      this.activePlanet,
      this.lastMineSummary,
      this.runStats,
      this.player.hull / this.stats.maxHull
    );
    this.input.setTouchOverlayPlaying(this.mode === 'SPACE' || this.mode === 'MINE');
    if (this.mode !== 'SPACE' && this.mode !== 'MINE') {
      this.input.exitPointerLock();
    }
  }

  private startNewRun(): void {
    this.sound.unlock();
    this.sound.playUiClick(true);
    this.save.totalRuns += 1;
    this.stats = computeShipStats(this.save.upgrades, this.save.bases.length);
    this.player.syncStats(this.stats, true);

    this.runStats = {
      sectorIndex: 1,
      enemiesDestroyed: 0,
      minesClearedThisRun: 0,
      scrapEarnedThisRun: 0,
      coresEarnedThisRun: 0,
      timeSeconds: 0
    };

    const seed = Math.floor(Date.now() % 1_000_000_000);
    this.enterSpaceSector(1, seed, []);
    this.hud.showToast('Launch complete! Clear a planet mine to unlock a Base & Warp Gate.', 'info');
  }

  private continueSavedRun(): void {
    this.sound.unlock();
    this.sound.playUiClick(true);
    const active = this.save.activeRun;
    if (!active) {
      this.startNewRun();
      return;
    }
    this.stats = computeShipStats(this.save.upgrades, this.save.bases.length);
    this.player.syncStats(this.stats, true);
    this.player.hull = Math.max(15, Math.round(this.stats.maxHull * active.hullRatio));
    this.player.missiles = Math.min(this.stats.maxMissiles, active.missiles);
    this.runStats = { ...active.runStats };
    this.enterSpaceSector(active.sectorIndex, active.sectorSeed, active.clearedPlanetIds);
    this.hud.showToast(`Resumed Sector ${active.sectorIndex}.`, 'info');
  }

  private enterSpaceSector(sectorIndex: number, seed: number, clearedPlanetIds: string[]): void {
    this.activePlanet = null;
    this.activeMine = null;
    this.mineEscapeTimer = null;
    this.mineScene.dispose(this.scene);

    this.sector = generateSector(sectorIndex, seed, clearedPlanetIds);
    this.spaceScene.build(this.scene, this.sector);
    this.combat.clear(this.scene);

    this.player.resetPose(new THREE.Vector3(0, 0, 55), new THREE.Vector3(0, 0, -100));
    this.spawnSpacePatrolWave(sectorIndex);

    this.mode = 'SPACE';
    this.previousPlayMode = 'SPACE';
    this.spaceReinforceTimer = 22;
    this.persistRun();
    this.refreshUi();
    this.input.requestPointerLock();
  }

  private spawnSpacePatrolWave(sectorIndex: number): void {
    const count = Math.min(8, 3 + sectorIndex);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const dist = 115 + Math.random() * 110;
      const pos = new THREE.Vector3(
        Math.cos(angle) * dist,
        (Math.random() - 0.5) * 65,
        Math.sin(angle) * dist - 50
      );
      const isStriker = i % 3 === 2 || (sectorIndex >= 2 && Math.random() < 0.35);
      this.combat.spawnSpaceEnemy(isStriker ? 'striker' : 'interceptor', pos, sectorIndex);
    }
  }

  private enterPlanetMine(planet: PlanetData): void {
    this.sound.unlock();
    this.sound.playUiClick(true);
    this.activePlanet = planet;
    this.mineKillsCount = 0;
    this.mineEscapeTimer = null;

    this.spaceScene.dispose(this.scene);
    this.combat.clear(this.scene);

    this.activeMine = generateMineLayout(planet.seed, planet.mineSize, planet.threatLevel);
    this.mineScene.build(this.scene, planet, this.activeMine);

    // Spawn mine hazards & loot caches
    for (const sp of this.activeMine.spawns) {
      if (sp.kind === 'loot') {
        this.combat.spawnLoot(sp.position, 'scrap', Math.round(24 * this.stats.lootMultiplier));
      } else {
        this.combat.spawnMineHazard(sp.kind, sp.position, sp.normal, planet.threatLevel);
      }
    }

    // Place player inside entrance airlock looking straight down tunnel (-Z)
    this.player.resetPose(new THREE.Vector3(0, 0, 1.5), new THREE.Vector3(0, 0, -30));
    this.player.shield = this.stats.maxShield;

    this.mode = 'MINE';
    this.previousPlayMode = 'MINE';
    this.refreshUi();
    this.input.requestPointerLock();
    this.hud.showToast(
      `Entered ${planet.name} Mine! Clear hazards, destroy the Reactor, and escape!`,
      'warn'
    );
  }

  private completeMineEscape(): void {
    if (!this.activePlanet || !this.sector) return;
    const planet = this.activePlanet;
    const timeLeft = this.mineEscapeTimer ?? 0;

    planet.mineCleared = true;
    this.sector.warpUnlocked = true;

    const scrapReward = Math.round(planet.rewardScrap * this.stats.lootMultiplier);
    const coreReward = planet.rewardCores;

    this.save.scrap += scrapReward;
    this.save.cores += coreReward;
    this.save.totalMinesCleared += 1;
    this.runStats.minesClearedThisRun += 1;
    this.runStats.scrapEarnedThisRun += scrapReward;
    this.runStats.coresEarnedThisRun += coreReward;

    if (!this.save.bases.some((b) => b.id === planet.id)) {
      this.save.bases.push({
        id: planet.id,
        planetName: planet.name,
        sectorIndex: this.sector.index,
        biome: planet.biome,
        clearedAt: Date.now()
      });
    }

    this.stats = computeShipStats(this.save.upgrades, this.save.bases.length);
    this.player.syncStats(this.stats, true); // Full repair & rearm upon establishing base!

    this.lastMineSummary = {
      planetName: planet.name,
      sectorIndex: this.sector.index,
      scrapReward,
      coreReward,
      escapeTimeLeft: timeLeft,
      enemiesCleared: this.mineKillsCount,
      totalBases: this.save.bases.length
    };

    this.sound.playFanfare();
    this.mineScene.dispose(this.scene);
    this.combat.clear(this.scene);
    this.activeMine = null;
    this.activePlanet = null;
    this.mineEscapeTimer = null;

    // Rebuild space scene cleanly with new orbital base online
    this.spaceScene.build(this.scene, this.sector);
    this.spaceScene.refreshPlanetStatuses();
    const pv = this.spaceScene.planets.find((p) => p.data.id === planet.id);
    if (pv) {
      const safePos = pv.beaconPosition.clone().add(new THREE.Vector3(0, 12, 34));
      this.player.resetPose(safePos, new THREE.Vector3(0, 0, 0));
    }

    this.mode = 'MINE_CLEARED';
    this.previousPlayMode = 'SPACE';
    this.persistRun();
    this.refreshUi();
  }

  private exitMineClearedScreen(): void {
    this.sound.playUiClick(true);
    this.mode = 'SPACE';
    this.previousPlayMode = 'SPACE';
    if (this.sector && this.combat.enemies.length === 0) {
      this.spawnSpacePatrolWave(this.sector.index);
    }
    this.refreshUi();
    this.input.requestPointerLock();
  }

  private handlePlanetSelection(planetId: string): void {
    if (!this.sector || this.activePlanet) return;
    const planet = this.sector.planets.find((p) => p.id === planetId);
    if (!planet) return;

    if (planet.mineCleared) {
      this.repairAtBase();
      this.closeMap();
      const pv = this.spaceScene.planets.find((p) => p.data.id === planetId);
      if (pv) {
        this.player.resetPose(pv.beaconPosition.clone().add(new THREE.Vector3(0, 10, 28)), pv.group.position);
      }
      this.hud.showToast(`Docked at ${planet.name} Base — Hull repaired & missiles rearmed!`, 'good');
    } else {
      this.enterPlanetMine(planet);
    }
  }

  private warpToNextSector(): void {
    if (!this.sector || !this.sector.warpUnlocked || this.activePlanet) return;
    this.sound.playFanfare();
    const nextIndex = this.sector.index + 1;
    this.runStats.sectorIndex = nextIndex;
    if (nextIndex > this.save.bestSector) {
      this.save.bestSector = nextIndex;
    }
    const nextSeed = Math.floor((this.sector.seed * 1664525 + 1013904223) >>> 0);
    this.enterSpaceSector(nextIndex, nextSeed, []);
    this.hud.showToast(`Warped into Sector ${nextIndex}! Enemies are stronger & loot is richer.`, 'good');
  }

  private buyUpgrade(key: UpgradeKey): void {
    const def = UPGRADE_DEFS.find((u) => u.key === key);
    if (!def) return;
    const lvl = this.save.upgrades[key];
    if (lvl >= def.maxLevel) return;
    const cost = getUpgradeCost(key, lvl);
    if (this.save.scrap < cost.scrap || this.save.cores < cost.cores) return;

    this.save.scrap -= cost.scrap;
    this.save.cores -= cost.cores;
    this.save.upgrades[key] = lvl + 1;

    const prevMaxHull = this.stats.maxHull;
    this.stats = computeShipStats(this.save.upgrades, this.save.bases.length);
    const hullDelta = this.stats.maxHull - prevMaxHull;
    this.player.hull = Math.min(this.stats.maxHull, this.player.hull + Math.max(0, hullDelta));
    this.player.shield = this.stats.maxShield;
    this.player.missiles = this.stats.maxMissiles;
    this.player.syncStats(this.stats, false);

    this.sound.playFanfare();
    this.persistRun();
    this.refreshUi();
    this.hud.showToast(`${def.name} upgraded to Level ${lvl + 1}!`, 'good');
  }

  private repairAtBase(): void {
    this.player.hull = this.stats.maxHull;
    this.player.shield = this.stats.maxShield;
    this.player.missiles = this.stats.maxMissiles;
    this.sound.playPickup(true);
    this.persistRun();
    this.refreshUi();
    this.hud.showToast('Base Drydock: Hull 100%, Shields & Missiles restored!', 'good');
  }

  private openMap(): void {
    if (this.mode === 'TITLE' || this.mode === 'RUN_OVER' || this.mode === 'MINE_CLEARED') return;
    if (this.mode === 'SPACE' || this.mode === 'MINE') {
      this.previousPlayMode = this.mode;
    }
    this.sound.playUiClick(false);
    this.mode = 'MAP';
    this.refreshUi();
  }

  private closeMap(): void {
    this.sound.playUiClick(false);
    this.mode = this.previousPlayMode;
    this.refreshUi();
    this.input.requestPointerLock();
  }

  private togglePause(): void {
    if (this.mode === 'SPACE' || this.mode === 'MINE') {
      this.previousPlayMode = this.mode;
      this.mode = 'PAUSED';
      this.sound.playUiClick(false);
      this.refreshUi();
    } else if (this.mode === 'PAUSED' || this.mode === 'MAP') {
      this.mode = this.previousPlayMode;
      this.sound.playUiClick(false);
      this.refreshUi();
      this.input.requestPointerLock();
    }
  }

  private returnToTitle(): void {
    this.persistRun();
    this.mode = 'TITLE';
    this.refreshUi();
  }

  private handleResetSave(): void {
    this.save = resetSave();
    this.stats = computeShipStats(this.save.upgrades, this.save.bases.length);
    this.sound.setConfig(this.save.settings.soundEnabled, this.save.settings.volume);
    this.input.setSettings(
      this.save.settings.invertY,
      this.save.settings.mouseSensitivity,
      this.save.settings.forceTouchControls
    );
    this.refreshUi();
    this.hud.showToast('Save data wiped.', 'warn');
  }

  private toggleSetting(key: keyof SaveState['settings']): void {
    const val = this.save.settings[key];
    if (typeof val === 'boolean') {
      (this.save.settings[key] as boolean) = !val;
    }
    this.sound.setConfig(this.save.settings.soundEnabled, this.save.settings.volume);
    this.input.setSettings(
      this.save.settings.invertY,
      this.save.settings.mouseSensitivity,
      this.save.settings.forceTouchControls
    );
    this.player.flightAssist = this.save.settings.flightAssist;
    writeSave(this.save);
    this.sound.playUiClick(false);
    this.refreshUi();
  }

  private triggerRunOver(reason: string): void {
    this.sound.playExplosion(true);
    this.save.activeRun = null;
    writeSave(this.save);
    this.mode = 'RUN_OVER';
    this.refreshUi();
    this.hud.showToast(reason, 'warn');
  }

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.elapsed += dt;

    const inp = this.input.sample();

    if (inp.pausePressed) {
      if (this.mode === 'SPACE' || this.mode === 'MINE' || this.mode === 'PAUSED' || this.mode === 'MAP') {
        this.togglePause();
      }
    } else if (inp.mapPressed) {
      if (this.mode === 'SPACE' || this.mode === 'MINE') {
        this.openMap();
      } else if (this.mode === 'MAP') {
        this.closeMap();
      }
    }

    if (this.mode === 'TITLE') {
      // Gentle scenic camera drift around the star sector
      this.spaceScene.update(dt, this.elapsed);
      this.camera.position.set(
        Math.sin(this.elapsed * 0.08) * 110,
        24 + Math.sin(this.elapsed * 0.14) * 10,
        Math.cos(this.elapsed * 0.08) * 110
      );
      this.camera.lookAt(0, 0, -40);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.mode === 'SPACE' || this.mode === 'MINE') {
      this.updateActiveGameplay(dt, inp);
    }

    this.renderer.render(this.scene, this.camera);
  }

  private updateActiveGameplay(dt: number, inp: ReturnType<InputManager['sample']>): void {
    const inMine = this.mode === 'MINE';
    this.runStats.timeSeconds += dt;

    if (inp.assistTogglePressed) {
      this.player.flightAssist = !this.player.flightAssist;
      this.save.settings.flightAssist = this.player.flightAssist;
      this.hud.showToast(`Flight Assist: ${this.player.flightAssist ? 'ON' : 'OFF'}`, 'info');
    }

    // 1. Update 6-DoF Player Ship
    this.player.update(dt, inp, this.stats, inMine);

    // Collisions
    if (inMine && this.activeMine) {
      const hitWall = resolveMineCollision(
        this.activeMine,
        this.player.position,
        this.player.velocity,
        this.player.radius
      );
      if (hitWall && this.player.velocity.length() > 24) {
        this.player.screenShake = Math.min(0.6, this.player.screenShake + 0.15);
      }
    } else {
      const hitRock = this.spaceScene.resolveSphereCollision(
        this.player.position,
        this.player.velocity,
        this.player.radius
      );
      if (hitRock) {
        this.player.screenShake = Math.min(0.8, this.player.screenShake + 0.25);
        this.sound.playHit(true);
      }
    }

    this.player.syncCamera(this.camera);

    // 2. Weapons (with subtle aim-assist magnetism on mobile touch!)
    const fwd = this.player.getForward(new THREE.Vector3());
    const lockTarget = this.combat.findBestTargetInCone(
      this.player.position,
      fwd,
      inMine ? 95 : 260,
      inp.isTouchActive ? 0.92 : 0.96
    );

    if (inp.firePrimary && this.player.fireCooldown <= 0 && this.player.energy >= 4) {
      this.sound.unlock();
      this.player.fireCooldown = 1 / this.stats.laserFireRate;
      this.player.energy = Math.max(0, this.player.energy - 3.6);
      this.player.triggerMuzzleFlash();

      let aimDir = fwd.clone();
      if (lockTarget && (inp.isTouchActive || lockTarget.position.distanceTo(this.player.position) < 220)) {
        const toT = lockTarget.position.clone().sub(this.player.position).normalize();
        aimDir.lerp(toT, inp.isTouchActive ? 0.65 : 0.25).normalize();
      }

      const muzzles = this.player.getMuzzlePositions(this.stats.laserBarrels === 3);
      this.combat.firePlayerLaser(muzzles, aimDir, this.stats.laserDamage, this.player.velocity);
      this.sound.playLaser(this.stats.laserBarrels === 3);
    }

    if (inp.fireSecondaryPressed && this.player.missiles > 0) {
      this.sound.unlock();
      this.player.missiles -= 1;
      const origin = this.player.position.clone().addScaledVector(fwd, 2.6);
      this.combat.firePlayerMissile(origin, fwd, this.stats.missileDamage, lockTarget?.id);
      this.sound.playMissile();
    }

    // 3. Update Scene & Combat Entities
    if (inMine && this.activeMine) {
      this.mineScene.update(dt, this.elapsed);

      if (this.mineScene.reactorDestroyed && this.mineEscapeTimer !== null) {
        this.mineEscapeTimer -= dt;
        this.player.screenShake = Math.max(this.player.screenShake, 0.12);
        this.sound.playAlarmPulse();

        // Check if player reached Exit Airlock!
        if (this.player.position.distanceTo(this.activeMine.exitPosition) < 8.5) {
          this.completeMineEscape();
          return;
        }
        if (this.mineEscapeTimer <= 0) {
          this.triggerRunOver('The mine reactor detonated before you reached the exit airlock!');
          return;
        }
      }
    } else {
      this.spaceScene.update(dt, this.elapsed);

      // Gentle space patrol reinforcements if player lingers in space
      if (this.sector && this.combat.enemies.length < 2) {
        this.spaceReinforceTimer -= dt;
        if (this.spaceReinforceTimer <= 0) {
          this.spaceReinforceTimer = 24;
          const angle = Math.random() * Math.PI * 2;
          const pos = this.player.position
            .clone()
            .add(new THREE.Vector3(Math.cos(angle) * 160, (Math.random() - 0.5) * 40, Math.sin(angle) * 160));
          this.combat.spawnSpaceEnemy(
            Math.random() < 0.35 ? 'striker' : 'interceptor',
            pos,
            this.sector.index
          );
        }
      }
    }

    this.combat.update(
      dt,
      this.elapsed,
      this.player.position,
      this.player.velocity,
      this.player.radius,
      this.stats.magnetRange,
      this.stats.lootMultiplier,
      this.sector?.index ?? 1,
      this.activeMine,
      this.activeMine?.reactorPosition ?? null,
      inMine && !this.mineScene.reactorDestroyed,
      this.sound,
      {
        onPlayerDamaged: (dmg) => {
          const res = this.player.applyDamage(dmg);
          this.sound.playHit(res.shielded);
          if (res.destroyed) {
            this.triggerRunOver('Hull integrity critical — ship lost in combat.');
          }
        },
        onEnemyKilled: (enemy: EnemyEntity) => {
          this.save.totalKills += 1;
          this.runStats.enemiesDestroyed += 1;
          if (inMine) {
            this.mineKillsCount += 1;
          } else if (this.sector) {
            this.sector.enemiesDefeated += 1;
            if (this.sector.enemiesDefeated >= this.sector.enemiesTotal && !this.sector.warpUnlocked) {
              this.sector.warpUnlocked = true;
              this.spaceScene.refreshPlanetStatuses();
              this.hud.showToast('Sector patrol broken — Warp Gate unlocked!', 'good');
            }
          }
          void enemy;
        },
        onReactorHit: (dmg) => {
          const destroyed = this.mineScene.damageReactor(dmg);
          if (destroyed && this.activeMine) {
            this.mineEscapeTimer = this.activeMine.escapeTimeSeconds;
            this.combat.spawnExplosion(this.activeMine.reactorPosition, 0xff4500, 40, 2.2);
            this.sound.playExplosion(true);
            this.player.screenShake = 1.2;
            this.hud.showToast(
              `REACTOR DESTROYED! Follow the GREEN chevrons back to the Exit Airlock!`,
              'warn'
            );
          } else {
            this.sound.playHit(false);
          }
        },
        onPickupCollected: (kind, value) => {
          if (kind === 'scrap') {
            this.save.scrap += value;
            this.runStats.scrapEarnedThisRun += value;
            this.sound.playPickup(false);
          } else if (kind === 'core') {
            this.save.cores += value;
            this.runStats.coresEarnedThisRun += value;
            this.sound.playPickup(true);
            this.hud.showToast(`+${value} Core Shard salvaged!`, 'good');
          } else if (kind === 'hull') {
            this.player.hull = Math.min(this.stats.maxHull, this.player.hull + value);
            this.sound.playPickup(false);
          } else if (kind === 'missile') {
            this.player.missiles = Math.min(this.stats.maxMissiles, this.player.missiles + value);
            this.sound.playPickup(false);
          }
        }
      }
    );

    if (this.mode !== 'SPACE' && this.mode !== 'MINE') return;

    // 4. Contextual Dock / Mine / Warp Prompts
    this.nearestInteractAction = null;
    this.nearestInteractLabel = null;

    if (!inMine && this.sector) {
      for (const pv of this.spaceScene.planets) {
        const d = this.player.position.distanceTo(pv.beaconPosition);
        if (d < 46) {
          if (pv.data.mineCleared) {
            this.nearestInteractLabel = `[E] DOCK AT ${pv.data.name.toUpperCase()} BASE (REPAIR & UPGRADE)`;
            this.nearestInteractAction = () => {
              this.repairAtBase();
              this.openMap();
            };
          } else {
            this.nearestInteractLabel = `[E] DESCEND INTO ${pv.data.name.toUpperCase()} MINE`;
            this.nearestInteractAction = () => this.enterPlanetMine(pv.data);
          }
          break;
        }
      }

      if (!this.nearestInteractAction) {
        const warpDist = this.player.position.distanceTo(this.spaceScene.warpGatePos);
        if (warpDist < 48) {
          if (this.sector.warpUnlocked) {
            this.nearestInteractLabel = `[E] WARP TO SECTOR ${this.sector.index + 1}`;
            this.nearestInteractAction = () => this.warpToNextSector();
          } else {
            this.nearestInteractLabel = `WARP GATE LOCKED — CLEAR 1 PLANET MINE FIRST`;
          }
        }
      }
    } else if (inMine && this.activeMine && !this.mineScene.reactorDestroyed) {
      if (this.player.position.distanceTo(this.activeMine.exitPosition) < 9.5) {
        this.nearestInteractLabel = `[E] ABORT MINE & RETURN TO ORBIT`;
        this.nearestInteractAction = () => {
          this.mineScene.dispose(this.scene);
          this.combat.clear(this.scene);
          this.activeMine = null;
          this.activePlanet = null;
          if (this.sector) {
            this.spaceScene.build(this.scene, this.sector);
            this.player.resetPose(new THREE.Vector3(0, 0, 55), new THREE.Vector3(0, 0, -100));
            this.spawnSpacePatrolWave(this.sector.index);
          }
          this.mode = 'SPACE';
          this.refreshUi();
        };
      }
    }

    if (inp.interactPressed && this.nearestInteractAction) {
      this.nearestInteractAction();
      return;
    }

    // 5. Build 3D HUD Target Markers
    const markers: TargetMarker[] = [];

    for (const e of this.combat.enemies) {
      const dist = this.player.position.distanceTo(e.position);
      if (inMine && dist > 95) continue;
      markers.push({
        id: e.id,
        label: e.name,
        kind: e.kind === 'mine' ? 'mine' : e.kind === 'turret' ? 'turret' : 'enemy',
        worldPos: e.position,
        distance: dist,
        hpRatio: Math.max(0, e.hp / e.maxHp),
        color: e.kind === 'mine' ? '#fb7185' : '#f43f5e'
      });
    }

    if (inMine && this.activeMine) {
      if (!this.mineScene.reactorDestroyed) {
        markers.push({
          id: 'reactor',
          label: 'MINE REACTOR',
          sublabel: 'DESTROY',
          kind: 'reactor',
          worldPos: this.activeMine.reactorPosition,
          distance: this.player.position.distanceTo(this.activeMine.reactorPosition),
          hpRatio: this.mineScene.reactorHp / this.mineScene.reactorMaxHp,
          color: '#f97316'
        });
      }
      markers.push({
        id: 'exit',
        label: this.mineScene.reactorDestroyed ? 'ESCAPE AIRLOCK' : 'EXIT AIRLOCK',
        kind: 'exit',
        worldPos: this.activeMine.exitPosition,
        distance: this.player.position.distanceTo(this.activeMine.exitPosition),
        color: '#34d399'
      });
    } else if (this.sector) {
      for (const pv of this.spaceScene.planets) {
        markers.push({
          id: pv.data.id,
          label: pv.data.name,
          sublabel: pv.data.mineCleared ? 'BASE' : 'MINE',
          kind: pv.data.mineCleared ? 'base' : 'planet',
          worldPos: pv.beaconPosition,
          distance: this.player.position.distanceTo(pv.beaconPosition),
          color: pv.data.mineCleared ? '#34d399' : '#f97316'
        });
      }
      markers.push({
        id: 'warp',
        label: `WARP GATE S${this.sector.index + 1}`,
        sublabel: this.sector.warpUnlocked ? 'READY' : 'LOCKED',
        kind: 'warp',
        worldPos: this.spaceScene.warpGatePos,
        distance: this.player.position.distanceTo(this.spaceScene.warpGatePos),
        color: this.sector.warpUnlocked ? '#38bdf8' : '#64748b'
      });
    }

    const locationStr = inMine && this.activePlanet
      ? `${this.activePlanet.name.toUpperCase()} — SUBTERRANEAN MINE`
      : this.sector?.name.toUpperCase() ?? 'DEEP SPACE';

    const objectiveStr = inMine
      ? this.mineScene.reactorDestroyed
        ? 'ESCAPE! Follow green chevrons back to the Exit Airlock!'
        : `Clear tunnels (${this.combat.enemies.length} hostiles) & destroy the Reactor Core`
      : this.sector?.warpUnlocked
        ? 'Warp Gate ONLINE! Clear more mines for Bases or Warp to the next sector [M]'
        : 'Fight enemy raiders & fly to an orange Planet Beacon (or press M) to clear its Mine';

    this.hud.updateHud({
      mode: this.mode,
      hull: this.player.hull,
      shield: this.player.shield,
      energy: this.player.energy,
      missiles: this.player.missiles,
      speed: this.player.velocity.length(),
      stats: this.stats,
      scrap: this.save.scrap,
      cores: this.save.cores,
      location: locationStr,
      objective: objectiveStr,
      flightAssist: this.player.flightAssist,
      damageFlash: this.player.damageFlash,
      pointerLocked: this.input.isPointerLocked(),
      touchControls: this.input.isTouchControlsVisible(),
      hasTargetLock: lockTarget !== null,
      promptLabel: this.nearestInteractLabel,
      escapeTimer: this.mineEscapeTimer,
      markers,
      camera: this.camera,
      playerPos: this.player.position,
      playerQuat: this.player.quaternion
    });
  }
}
