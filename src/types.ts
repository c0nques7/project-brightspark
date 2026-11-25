import type * as THREE from 'three';

export type GameMode =
  | 'TITLE'
  | 'SPACE'
  | 'MINE'
  | 'MAP'
  | 'PAUSED'
  | 'MINE_CLEARED'
  | 'RUN_OVER';

export type UpgradeKey =
  | 'weapons'
  | 'hull'
  | 'shields'
  | 'thrusters'
  | 'missiles'
  | 'salvage';

export interface UpgradeDefinition {
  key: UpgradeKey;
  name: string;
  facility: string;
  description: string;
  maxLevel: number;
  baseScrapCost: number;
  baseCoreCost: number;
  scrapScale: number;
  perLevelSummary: (level: number) => string;
}

export interface BaseUpgrades {
  weapons: number;
  hull: number;
  shields: number;
  thrusters: number;
  missiles: number;
  salvage: number;
}

export interface ClearedBaseRecord {
  id: string;
  planetName: string;
  sectorIndex: number;
  biome: PlanetBiome;
  clearedAt: number;
}

export type PlanetBiome = 'volcanic' | 'cryo' | 'verdant' | 'obsidian' | 'amber';

export interface PlanetData {
  id: string;
  name: string;
  biome: PlanetBiome;
  seed: number;
  radius: number;
  position: { x: number; y: number; z: number };
  primaryColor: number;
  accentColor: number;
  atmosphereColor: number;
  hasRings: boolean;
  threatLevel: number;
  mineCleared: boolean;
  mineSize: number;
  rewardScrap: number;
  rewardCores: number;
}

export interface SectorData {
  index: number;
  name: string;
  seed: number;
  nebulaPrimary: number;
  nebulaSecondary: number;
  starColor: number;
  planets: PlanetData[];
  warpGatePosition: { x: number; y: number; z: number };
  enemiesTotal: number;
  enemiesDefeated: number;
  warpUnlocked: boolean;
}

export interface RunStats {
  sectorIndex: number;
  enemiesDestroyed: number;
  minesClearedThisRun: number;
  scrapEarnedThisRun: number;
  coresEarnedThisRun: number;
  timeSeconds: number;
}

export interface SaveState {
  version: number;
  scrap: number;
  cores: number;
  upgrades: BaseUpgrades;
  bases: ClearedBaseRecord[];
  bestSector: number;
  totalRuns: number;
  totalMinesCleared: number;
  totalKills: number;
  activeRun: {
    sectorSeed: number;
    sectorIndex: number;
    clearedPlanetIds: string[];
    hullRatio: number;
    missiles: number;
    runStats: RunStats;
  } | null;
  settings: {
    soundEnabled: boolean;
    volume: number;
    invertY: boolean;
    mouseSensitivity: number;
    flightAssist: boolean;
    forceTouchControls: boolean;
  };
}

export interface ShipComputedStats {
  maxHull: number;
  maxShield: number;
  shieldRegenRate: number;
  shieldRegenDelay: number;
  maxEnergy: number;
  energyRegenRate: number;
  laserDamage: number;
  laserFireRate: number;
  laserBarrels: 2 | 3;
  maxSpeed: number;
  boostMultiplier: number;
  acceleration: number;
  maxMissiles: number;
  missileDamage: number;
  lootMultiplier: number;
  magnetRange: number;
}

export interface InputState {
  forward: number; // -1..1
  strafe: number; // -1..1
  vertical: number; // -1..1
  roll: number; // -1..1
  pitchDelta: number; // radians/frame or continuous
  yawDelta: number; // radians/frame or continuous
  pitchRate: number; // -1..1 (from touch stick)
  yawRate: number; // -1..1 (from touch stick)
  firePrimary: boolean;
  fireSecondaryPressed: boolean;
  boost: boolean;
  interactPressed: boolean;
  mapPressed: boolean;
  pausePressed: boolean;
  assistTogglePressed: boolean;
  isTouchActive: boolean;
}

export interface TargetMarker {
  id: string;
  label: string;
  sublabel?: string;
  kind: 'enemy' | 'planet' | 'base' | 'warp' | 'reactor' | 'exit' | 'mine' | 'turret';
  worldPos: THREE.Vector3;
  distance: number;
  hpRatio?: number;
  color: string;
}

export interface MineClearSummary {
  planetName: string;
  sectorIndex: number;
  scrapReward: number;
  coreReward: number;
  escapeTimeLeft: number;
  enemiesCleared: number;
  totalBases: number;
}
