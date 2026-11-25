import type {
  BaseUpgrades,
  PlanetBiome,
  PlanetData,
  SaveState,
  SectorData,
  ShipComputedStats,
  UpgradeDefinition,
  UpgradeKey
} from '../types';

const STORAGE_KEY = 'brightspark_save_v1';

export const UPGRADE_DEFS: UpgradeDefinition[] = [
  {
    key: 'weapons',
    name: 'Weapons Foundry',
    facility: 'Pulse Laser Forge',
    description: 'Boosts laser damage, fire rate, and unlocks a triple-barrel cannon at Level 3.',
    maxLevel: 5,
    baseScrapCost: 60,
    baseCoreCost: 0,
    scrapScale: 1.75,
    perLevelSummary: (lvl) =>
      `+${lvl * 28}% DMG • +${lvl * 12}% ROF${lvl >= 3 ? ' • Triple Barrel' : ''}`
  },
  {
    key: 'shields',
    name: 'Aegis Relay',
    facility: 'Deflector Grid',
    description: 'Increases shield capacity and accelerates shield recharge after combat.',
    maxLevel: 5,
    baseScrapCost: 55,
    baseCoreCost: 0,
    scrapScale: 1.7,
    perLevelSummary: (lvl) => `+${lvl * 30} Shield • +${lvl * 25}% Regen`
  },
  {
    key: 'hull',
    name: 'Alloy Drydock',
    facility: 'Composite Hull Bay',
    description: 'Reinforces hull plating for deeper sectors and reactor escapes.',
    maxLevel: 5,
    baseScrapCost: 50,
    baseCoreCost: 0,
    scrapScale: 1.65,
    perLevelSummary: (lvl) => `+${lvl * 35} Max Hull`
  },
  {
    key: 'thrusters',
    name: 'Ion Drive Lab',
    facility: 'Vector Thruster Core',
    description: 'Enhances 6-DoF thrust, top speed, afterburner boost, and capacitor energy.',
    maxLevel: 5,
    baseScrapCost: 55,
    baseCoreCost: 0,
    scrapScale: 1.7,
    perLevelSummary: (lvl) => `+${lvl * 12}% Speed • +${lvl * 20} Energy`
  },
  {
    key: 'missiles',
    name: 'Ordnance Fabricator',
    facility: 'Seeker Rack Bay',
    description: 'Expands homing micro-missile salvo capacity and warhead yield.',
    maxLevel: 4,
    baseScrapCost: 85,
    baseCoreCost: 1,
    scrapScale: 1.8,
    perLevelSummary: (lvl) => `${4 + lvl * 3} Max Missiles • ${65 + lvl * 25} DMG`
  },
  {
    key: 'salvage',
    name: 'Salvage Refinery',
    facility: 'Tractor & Ore Array',
    description: 'Multiplies scrap harvested from enemies & mines and extends loot tractor range.',
    maxLevel: 4,
    baseScrapCost: 70,
    baseCoreCost: 1,
    scrapScale: 1.75,
    perLevelSummary: (lvl) => `+${lvl * 25}% Scrap • +${lvl * 14}m Magnet`
  }
];

export function createDefaultSave(): SaveState {
  return {
    version: 1,
    scrap: 40,
    cores: 0,
    upgrades: {
      weapons: 0,
      hull: 0,
      shields: 0,
      thrusters: 0,
      missiles: 0,
      salvage: 0
    },
    bases: [],
    bestSector: 1,
    totalRuns: 0,
    totalMinesCleared: 0,
    totalKills: 0,
    activeRun: null,
    settings: {
      soundEnabled: true,
      volume: 0.65,
      invertY: false,
      mouseSensitivity: 1.0,
      flightAssist: true,
      forceTouchControls: false
    }
  };
}

export function loadSave(): SaveState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultSave();
    const parsed = JSON.parse(raw) as Partial<SaveState>;
    const def = createDefaultSave();
    return {
      ...def,
      ...parsed,
      upgrades: { ...def.upgrades, ...(parsed.upgrades ?? {}) },
      settings: { ...def.settings, ...(parsed.settings ?? {}) },
      bases: Array.isArray(parsed.bases) ? parsed.bases : []
    };
  } catch {
    return createDefaultSave();
  }
}

export function writeSave(save: SaveState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch {
    // Ignore storage quota errors in private browsing
  }
}

export function resetSave(): SaveState {
  const fresh = createDefaultSave();
  writeSave(fresh);
  return fresh;
}

export function getUpgradeCost(
  key: UpgradeKey,
  currentLevel: number
): { scrap: number; cores: number } {
  const def = UPGRADE_DEFS.find((u) => u.key === key)!;
  const scrap = Math.round(def.baseScrapCost * Math.pow(def.scrapScale, currentLevel));
  const cores =
    def.baseCoreCost > 0
      ? def.baseCoreCost + Math.floor(currentLevel / 2)
      : currentLevel >= 3
        ? currentLevel - 2
        : 0;
  return { scrap, cores };
}

export function computeShipStats(upgrades: BaseUpgrades, baseCount: number): ShipComputedStats {
  // Each established planetary base also grants a subtle global +3% hull/shield/weapon network bonus
  const networkBonus = 1 + Math.min(baseCount, 12) * 0.03;
  return {
    maxHull: Math.round((110 + upgrades.hull * 35) * networkBonus),
    maxShield: Math.round((75 + upgrades.shields * 30) * networkBonus),
    shieldRegenRate: (10 + upgrades.shields * 3.5) * networkBonus,
    shieldRegenDelay: Math.max(1.8, 3.6 - upgrades.shields * 0.32),
    maxEnergy: 100 + upgrades.thrusters * 20,
    energyRegenRate: 26 + upgrades.thrusters * 5,
    laserDamage: Math.round((16 + upgrades.weapons * 4.8) * networkBonus),
    laserFireRate: 6.2 + upgrades.weapons * 0.85,
    laserBarrels: upgrades.weapons >= 3 ? 3 : 2,
    maxSpeed: 54 + upgrades.thrusters * 6.5,
    boostMultiplier: 1.72 + upgrades.thrusters * 0.08,
    acceleration: 95 + upgrades.thrusters * 14,
    maxMissiles: 4 + upgrades.missiles * 3,
    missileDamage: Math.round((65 + upgrades.missiles * 25) * networkBonus),
    lootMultiplier: 1 + upgrades.salvage * 0.25 + Math.min(baseCount, 10) * 0.05,
    magnetRange: 30 + upgrades.salvage * 14
  };
}

// Deterministic seeded PRNG (Mulberry32)
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SECTOR_PREFIXES = [
  'Helios',
  'Vesper',
  'Acheron',
  'Kestrel',
  'Cinder',
  'Cygnus',
  'Nyx',
  'Orpheus',
  'Pyre',
  'Valkyrie',
  'Solstice',
  'Borealis'
];
const SECTOR_SUFFIXES = ['Expanse', 'Rift', 'Reach', 'Drift', 'Verge', 'Belt', 'Crown', 'Basin'];

const PLANET_NAMES = [
  'Tarsis',
  'Korah',
  'Veyra',
  'Drakon',
  'Ophir',
  'Sable',
  'Meridian',
  'Caldera',
  'Glacis',
  'Nadir',
  'Talon',
  'Aurelia',
  'Cairn',
  'Halcyon',
  'Ferrum',
  'Myra'
];

const BIOME_PALETTES: Record<
  PlanetBiome,
  { primary: number; accent: number; atmo: number }
> = {
  volcanic: { primary: 0x7c2d12, accent: 0xf97316, atmo: 0xfb923c },
  cryo: { primary: 0x164e63, accent: 0x38bdf8, atmo: 0x7dd3fc },
  verdant: { primary: 0x14532d, accent: 0x34d399, atmo: 0x6ee7b7 },
  obsidian: { primary: 0x312e81, accent: 0xa78bfa, atmo: 0xc4b5fd },
  amber: { primary: 0x78350f, accent: 0xfbbf24, atmo: 0xfde68a }
};

const BIOMES: PlanetBiome[] = ['volcanic', 'cryo', 'verdant', 'obsidian', 'amber'];

const NEBULA_THEMES: Array<{ primary: number; secondary: number; star: number }> = [
  { primary: 0x0b1630, secondary: 0x1e1b4b, star: 0xfff3d6 },
  { primary: 0x1c0f24, secondary: 0x3b1334, star: 0xffd6e0 },
  { primary: 0x092026, secondary: 0x103c42, star: 0xd6f8ff },
  { primary: 0x21130b, secondary: 0x3f1d0e, star: 0xffe4b5 },
  { primary: 0x0d1b2a, secondary: 0x1b3a4b, star: 0xcceeff }
];

export function generateSector(
  sectorIndex: number,
  seed: number,
  clearedPlanetIds: string[] = []
): SectorData {
  const rng = createRng(seed);
  const prefix = SECTOR_PREFIXES[Math.floor(rng() * SECTOR_PREFIXES.length)];
  const suffix = SECTOR_SUFFIXES[Math.floor(rng() * SECTOR_SUFFIXES.length)];
  const theme = NEBULA_THEMES[(sectorIndex - 1 + Math.floor(rng() * NEBULA_THEMES.length)) % NEBULA_THEMES.length];

  const planetCount = Math.min(4, 3 + (sectorIndex >= 2 && rng() > 0.4 ? 1 : 0));
  const usedNames = new Set<string>();
  const planets: PlanetData[] = [];

  for (let i = 0; i < planetCount; i++) {
    let baseName = PLANET_NAMES[Math.floor(rng() * PLANET_NAMES.length)];
    while (usedNames.has(baseName)) {
      baseName = PLANET_NAMES[Math.floor(rng() * PLANET_NAMES.length)];
    }
    usedNames.add(baseName);
    const roman = ['I', 'II', 'III', 'IV', 'V'][Math.floor(rng() * 5)];
    const name = `${baseName} ${roman}`;
    const biome = BIOMES[Math.floor(rng() * BIOMES.length)];
    const pal = BIOME_PALETTES[biome];

    // Place planets in distinct sectors around origin at reachable distances (220 - 420 units)
    const angle = (i / planetCount) * Math.PI * 2 + (rng() - 0.5) * 0.55;
    const dist = 230 + i * 52 + rng() * 45;
    const elev = (rng() - 0.5) * 110;
    const radius = 32 + rng() * 14;
    const id = `s${sectorIndex}-p${i}-${Math.floor(seed % 10000)}`;
    const threatLevel = sectorIndex + (i === planetCount - 1 ? 1 : 0);

    planets.push({
      id,
      name,
      biome,
      seed: Math.floor(rng() * 1_000_000_000),
      radius,
      position: {
        x: Math.cos(angle) * dist,
        y: elev,
        z: Math.sin(angle) * dist - 60
      },
      primaryColor: pal.primary,
      accentColor: pal.accent,
      atmosphereColor: pal.atmo,
      hasRings: rng() > 0.45,
      threatLevel,
      mineCleared: clearedPlanetIds.includes(id),
      mineSize: Math.min(28, 12 + sectorIndex * 3 + i * 2),
      rewardScrap: Math.round((75 + sectorIndex * 35 + i * 20) * (0.95 + rng() * 0.2)),
      rewardCores: Math.max(1, Math.floor((sectorIndex + 1) / 2) + (i === planetCount - 1 ? 1 : 0))
    });
  }

  const warpAngle = rng() * Math.PI * 2;
  const warpDist = 340 + rng() * 60;
  const enemiesTotal = 4 + sectorIndex * 2;

  return {
    index: sectorIndex,
    name: `${prefix} ${suffix} — Sector ${sectorIndex}`,
    seed,
    nebulaPrimary: theme.primary,
    nebulaSecondary: theme.secondary,
    starColor: theme.star,
    planets,
    warpGatePosition: {
      x: Math.cos(warpAngle) * warpDist,
      y: (rng() - 0.5) * 70,
      z: Math.sin(warpAngle) * warpDist - 80
    },
    enemiesTotal,
    enemiesDefeated: 0,
    warpUnlocked: clearedPlanetIds.length > 0
  };
}
