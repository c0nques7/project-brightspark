import * as THREE from 'three';
import { computeShipStats, getUpgradeCost, UPGRADE_DEFS } from '../state/saveManager';
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

export interface HudCallbacks {
  onStartNewRun: () => void;
  onContinueRun: () => void;
  onResume: () => void;
  onOpenMap: () => void;
  onCloseMap: () => void;
  onSelectPlanetAction: (planetId: string) => void;
  onWarpNextSector: () => void;
  onBuyUpgrade: (key: UpgradeKey) => void;
  onRepairAtBase: () => void;
  onReturnToTitle: () => void;
  onResetSave: () => void;
  onToggleSetting: (key: keyof SaveState['settings']) => void;
  onContinueAfterMine: () => void;
  onEnterNearestPrompt: () => void;
}

export class GameHud {
  private root: HTMLElement;
  private cb: HudCallbacks;

  private hudLayer!: HTMLElement;
  private markerLayer!: HTMLElement;
  private modalLayer!: HTMLElement;
  private damageOverlay!: HTMLElement;
  private escapeBanner!: HTMLElement;
  private promptBanner!: HTMLElement;
  private toastContainer!: HTMLElement;

  // Dynamic HUD element refs
  private hullBar!: HTMLElement;
  private hullText!: HTMLElement;
  private shieldBar!: HTMLElement;
  private shieldText!: HTMLElement;
  private energyBar!: HTMLElement;
  private speedText!: HTMLElement;
  private missileText!: HTMLElement;
  private scrapText!: HTMLElement;
  private coreText!: HTMLElement;
  private locationText!: HTMLElement;
  private objectiveText!: HTMLElement;
  private assistBadge!: HTMLElement;
  private reticleEl!: HTMLElement;
  private lockHintEl!: HTMLElement;
  private radarCanvas!: HTMLCanvasElement;
  private radarCtx!: CanvasRenderingContext2D;

  private activeMapTab: 'sector' | 'bases' = 'sector';
  private tmpProj = new THREE.Vector3();

  constructor(root: HTMLElement, callbacks: HudCallbacks) {
    this.root = root;
    this.cb = callbacks;
    this.mountBaseMarkup();
  }

  private mountBaseMarkup(): void {
    this.root.innerHTML = `
      <div class="damage-vignette" id="damage-vignette"></div>
      <div class="hud-layer" id="hud-layer">
        <div class="marker-layer" id="marker-layer"></div>

        <div class="hud-top-left">
          <div class="location-pill" id="hud-location">SECTOR 1</div>
          <div class="objective-box" id="hud-objective">Patrol sector & clear planetary mines</div>
        </div>

        <div class="hud-top-right">
          <div class="resource-row">
            <span class="res-chip res-scrap">⚙ <strong id="hud-scrap">0</strong></span>
            <span class="res-chip res-cores">◆ <strong id="hud-cores">0</strong></span>
            <button class="hud-mini-btn" id="btn-hud-map" title="Sector Map & Base Upgrades [M]">MAP / BASES</button>
            <button class="hud-mini-btn" id="btn-hud-pause" title="Pause [ESC]">☰</button>
          </div>
          <div class="radar-wrap">
            <canvas id="radar-canvas" width="124" height="124"></canvas>
            <span class="radar-label">3D RADAR</span>
          </div>
        </div>

        <div class="escape-banner" id="escape-banner" style="display:none">
          <div class="escape-title">⚠ REACTOR CRITICAL — ESCAPE TO AIRLOCK!</div>
          <div class="escape-timer" id="escape-timer">00.0s</div>
        </div>

        <div class="reticle" id="reticle">
          <div class="reticle-ring"></div>
          <div class="reticle-dot"></div>
        </div>
        <div class="lock-hint" id="lock-hint">Click anywhere to lock mouse aim • WASD + Mouse • Q/E Roll • M Map</div>

        <div class="prompt-banner" id="prompt-banner" style="display:none">
          <button class="prompt-btn" id="prompt-btn"></button>
        </div>

        <div class="hud-bottom-center">
          <div class="status-bars">
            <div class="bar-row">
              <span class="bar-label">SHLD</span>
              <div class="bar-track"><div class="bar-fill bar-shield" id="bar-shield"></div></div>
              <span class="bar-val" id="val-shield">75</span>
            </div>
            <div class="bar-row">
              <span class="bar-label">HULL</span>
              <div class="bar-track"><div class="bar-fill bar-hull" id="bar-hull"></div></div>
              <span class="bar-val" id="val-hull">110</span>
            </div>
            <div class="bar-row">
              <span class="bar-label">ENGY</span>
              <div class="bar-track"><div class="bar-fill bar-energy" id="bar-energy"></div></div>
              <span class="bar-val" id="val-speed">0 m/s</span>
            </div>
          </div>
          <div class="ship-telemetry">
            <span class="tel-pill">MSL: <strong id="hud-missiles">4</strong></span>
            <span class="tel-pill" id="hud-assist">ASSIST: ON</span>
          </div>
        </div>
      </div>

      <div class="toast-container" id="toast-container"></div>
      <div class="modal-layer" id="modal-layer"></div>
    `;

    this.hudLayer = this.root.querySelector('#hud-layer')!;
    this.markerLayer = this.root.querySelector('#marker-layer')!;
    this.modalLayer = this.root.querySelector('#modal-layer')!;
    this.damageOverlay = this.root.querySelector('#damage-vignette')!;
    this.escapeBanner = this.root.querySelector('#escape-banner')!;
    this.promptBanner = this.root.querySelector('#prompt-banner')!;
    this.toastContainer = this.root.querySelector('#toast-container')!;

    this.hullBar = this.root.querySelector('#bar-hull')!;
    this.hullText = this.root.querySelector('#val-hull')!;
    this.shieldBar = this.root.querySelector('#bar-shield')!;
    this.shieldText = this.root.querySelector('#val-shield')!;
    this.energyBar = this.root.querySelector('#bar-energy')!;
    this.speedText = this.root.querySelector('#val-speed')!;
    this.missileText = this.root.querySelector('#hud-missiles')!;
    this.scrapText = this.root.querySelector('#hud-scrap')!;
    this.coreText = this.root.querySelector('#hud-cores')!;
    this.locationText = this.root.querySelector('#hud-location')!;
    this.objectiveText = this.root.querySelector('#hud-objective')!;
    this.assistBadge = this.root.querySelector('#hud-assist')!;
    this.reticleEl = this.root.querySelector('#reticle')!;
    this.lockHintEl = this.root.querySelector('#lock-hint')!;
    this.radarCanvas = this.root.querySelector('#radar-canvas')!;
    this.radarCtx = this.radarCanvas.getContext('2d')!;

    this.root.querySelector('#btn-hud-map')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onOpenMap();
    });
    this.root.querySelector('#btn-hud-pause')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onResume();
    });
    this.root.querySelector('#prompt-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onEnterNearestPrompt();
    });
  }

  public showToast(text: string, tone: 'info' | 'good' | 'warn' = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast toast-${tone}`;
    el.textContent = text;
    this.toastContainer.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-fade');
      setTimeout(() => el.remove(), 350);
    }, 2800);
  }

  public setMode(
    mode: GameMode,
    save: SaveState,
    sector: SectorData | null,
    activePlanet: PlanetData | null,
    mineSummary: MineClearSummary | null,
    runStats: RunStats | null,
    hullRatio: number
  ): void {
    const playing = mode === 'SPACE' || mode === 'MINE';
    this.hudLayer.style.display = playing ? 'block' : 'none';

    if (playing) {
      this.modalLayer.innerHTML = '';
      this.modalLayer.style.display = 'none';
      return;
    }

    this.modalLayer.style.display = 'flex';
    if (mode === 'TITLE') {
      this.renderTitleModal(save);
    } else if (mode === 'PAUSED') {
      this.renderPauseModal(save);
    } else if (mode === 'MAP' && sector) {
      this.renderMapModal(save, sector, activePlanet, hullRatio);
    } else if (mode === 'MINE_CLEARED' && mineSummary) {
      this.renderMineClearedModal(mineSummary);
    } else if (mode === 'RUN_OVER' && runStats) {
      this.renderRunOverModal(save, runStats);
    }
  }

  public updateHud(params: {
    mode: GameMode;
    hull: number;
    shield: number;
    energy: number;
    missiles: number;
    speed: number;
    stats: ShipComputedStats;
    scrap: number;
    cores: number;
    location: string;
    objective: string;
    flightAssist: boolean;
    damageFlash: number;
    pointerLocked: boolean;
    touchControls: boolean;
    hasTargetLock: boolean;
    promptLabel: string | null;
    escapeTimer: number | null;
    markers: TargetMarker[];
    camera: THREE.PerspectiveCamera;
    playerPos: THREE.Vector3;
    playerQuat: THREE.Quaternion;
  }): void {
    const hullPct = Math.max(0, Math.min(100, (params.hull / params.stats.maxHull) * 100));
    const shldPct = Math.max(0, Math.min(100, (params.shield / params.stats.maxShield) * 100));
    const engPct = Math.max(0, Math.min(100, (params.energy / params.stats.maxEnergy) * 100));

    this.hullBar.style.width = `${hullPct}%`;
    this.hullBar.style.background =
      hullPct < 30 ? 'linear-gradient(90deg,#dc2626,#f87171)' : 'linear-gradient(90deg,#10b981,#34d399)';
    this.hullText.textContent = `${Math.ceil(params.hull)}`;

    this.shieldBar.style.width = `${shldPct}%`;
    this.shieldText.textContent = `${Math.ceil(params.shield)}`;

    this.energyBar.style.width = `${engPct}%`;
    this.speedText.textContent = `${Math.round(params.speed)} m/s`;
    this.missileText.textContent = `${params.missiles}/${params.stats.maxMissiles}`;
    this.scrapText.textContent = `${params.scrap}`;
    this.coreText.textContent = `${params.cores}`;
    this.locationText.textContent = params.location;
    this.objectiveText.textContent = params.objective;
    this.assistBadge.textContent = `ASSIST: ${params.flightAssist ? 'ON' : 'OFF'}`;

    this.reticleEl.classList.toggle('locked', params.hasTargetLock);
    this.lockHintEl.style.display =
      !params.pointerLocked && !params.touchControls ? 'block' : 'none';

    this.damageOverlay.style.opacity = `${Math.min(0.85, params.damageFlash)}`;

    if (params.escapeTimer !== null) {
      this.escapeBanner.style.display = 'block';
      const timerEl = this.escapeBanner.querySelector('#escape-timer');
      if (timerEl) timerEl.textContent = `${Math.max(0, params.escapeTimer).toFixed(1)}s`;
    } else {
      this.escapeBanner.style.display = 'none';
    }

    if (params.promptLabel) {
      this.promptBanner.style.display = 'flex';
      const btn = this.promptBanner.querySelector('#prompt-btn')!;
      btn.textContent = params.promptLabel;
    } else {
      this.promptBanner.style.display = 'none';
    }

    this.renderMarkers(params.markers, params.camera);
    this.renderRadar(params.markers, params.playerPos, params.playerQuat, params.mode === 'MINE');
  }

  private renderMarkers(markers: TargetMarker[], camera: THREE.PerspectiveCamera): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const htmlParts: string[] = [];
    const padX = 54;
    const padY = 58;

    for (const m of markers) {
      this.tmpProj.copy(m.worldPos).project(camera);
      const behind = this.tmpProj.z > 1;
      let sx = (this.tmpProj.x * 0.5 + 0.5) * w;
      let sy = (-this.tmpProj.y * 0.5 + 0.5) * h;

      if (behind) {
        sx = w - sx;
        sy = h - sy;
      }

      const offscreen = behind || sx < padX || sx > w - padX || sy < padY || sy > h - padY;

      // Skip offscreen clutter for regular mines/turrets unless close
      if (offscreen && (m.kind === 'mine' || m.kind === 'turret')) continue;

      if (offscreen) {
        const cx = w / 2;
        const cy = h / 2;
        const angle = Math.atan2(sy - cy, sx - cx);
        const rx = w / 2 - padX;
        const ry = h / 2 - padY;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const scale = Math.min(
          Math.abs(cosA) > 0.0001 ? Math.abs(rx / cosA) : Infinity,
          Math.abs(sinA) > 0.0001 ? Math.abs(ry / sinA) : Infinity
        );
        sx = Math.max(padX, Math.min(w - padX, cx + cosA * scale));
        sy = Math.max(padY, Math.min(h - padY, cy + sinA * scale));
      }

      const hpBar =
        m.hpRatio !== undefined && !offscreen
          ? `<div class="mk-hp"><div style="width:${Math.round(m.hpRatio * 100)}%;background:${m.color}"></div></div>`
          : '';

      htmlParts.push(`
        <div class="world-marker ${offscreen ? 'mk-edge' : ''}" style="left:${sx.toFixed(0)}px;top:${sy.toFixed(0)}px;--mk-color:${m.color}">
          <div class="mk-diamond"></div>
          <div class="mk-info">
            <span class="mk-label">${m.label}</span>
            <span class="mk-dist">${Math.round(m.distance)}m${m.sublabel && !offscreen ? ` • ${m.sublabel}` : ''}</span>
            ${hpBar}
          </div>
        </div>
      `);
    }

    this.markerLayer.innerHTML = htmlParts.join('');
  }

  private renderRadar(
    markers: TargetMarker[],
    playerPos: THREE.Vector3,
    playerQuat: THREE.Quaternion,
    inMine: boolean
  ): void {
    const ctx = this.radarCtx;
    const size = this.radarCanvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 6;

    ctx.clearRect(0, 0, size, size);

    ctx.fillStyle = 'rgba(7, 14, 28, 0.72)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    const invQuat = playerQuat.clone().invert();
    const maxRange = inMine ? 95 : 420;

    for (const m of markers) {
      const local = m.worldPos.clone().sub(playerPos).applyQuaternion(invQuat);
      // Forward is -Z -> radar UP (-y), Right is +X -> radar RIGHT (+x)
      let nx = local.x / maxRange;
      let ny = local.z / maxRange;
      const mag = Math.hypot(nx, ny);
      if (mag > 0.94) {
        nx = (nx / mag) * 0.94;
        ny = (ny / mag) * 0.94;
      }
      const px = cx + nx * r;
      const py = cy + ny * r;

      ctx.fillStyle = m.color;
      ctx.beginPath();
      const dotR = m.kind === 'planet' || m.kind === 'base' || m.kind === 'reactor' || m.kind === 'exit' ? 4 : 2.6;
      ctx.arc(px, py, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player chevron in center
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx + 4, cy + 4);
    ctx.lineTo(cx - 4, cy + 4);
    ctx.closePath();
    ctx.fill();
  }

  private renderTitleModal(save: SaveState): void {
    const hasActive = save.activeRun !== null;
    this.modalLayer.innerHTML = `
      <div class="panel panel-title">
        <div class="brand-kicker">6-DOF SPACE COMBAT &amp; MINE-CLEARING ROGUELIKE</div>
        <h1 class="brand-title">PROJECT <span>BRIGHTSPARK</span></h1>
        <p class="brand-sub">
          Fight through procedural star sectors, descend into 3D subterranean mines, destroy reactors before meltdown, and build permanent planetary bases that empower every run.
        </p>

        <div class="stat-strip">
          <div><span>BASES ONLINE</span><strong>${save.bases.length}</strong></div>
          <div><span>BEST SECTOR</span><strong>${save.bestSector}</strong></div>
          <div><span>SCRAP BANK</span><strong>${save.scrap}</strong></div>
          <div><span>CORE SHARDS</span><strong>${save.cores}</strong></div>
        </div>

        <div class="btn-stack">
          ${hasActive ? `<button class="btn btn-primary" id="act-continue">RESUME SECTOR ${save.activeRun!.sectorIndex}</button>` : ''}
          <button class="btn ${hasActive ? 'btn-secondary' : 'btn-primary'}" id="act-new-run">
            ${hasActive ? 'LAUNCH NEW RUN (KEEP BASES & UPGRADES)' : 'LAUNCH SORTIE'}
          </button>
        </div>

        <div class="controls-grid">
          <div><strong>PC Flight</strong><span>WASD Thrust/Strafe • Mouse Aim • Q/E Roll • Space/Ctrl Up/Down • Shift Boost</span></div>
          <div><strong>Combat &amp; Nav</strong><span>LMB Laser • RMB / F Missile • E Dock / Descend • M Sector Map &amp; Bases</span></div>
          <div><strong>Mobile Touch</strong><span>Dual Virtual Sticks + Fire / Missile / Boost / Up-Down / Dock buttons</span></div>
        </div>

        <div class="title-footer">
          <button class="btn-link" id="act-toggle-touch">Touch Controls: ${save.settings.forceTouchControls ? 'FORCED ON' : 'AUTO'}</button>
          <button class="btn-link" id="act-toggle-sound">Sound: ${save.settings.soundEnabled ? 'ON' : 'OFF'}</button>
          <button class="btn-link danger" id="act-reset-save">Reset Save</button>
        </div>
      </div>
    `;

    this.modalLayer.querySelector('#act-continue')?.addEventListener('click', () => this.cb.onContinueRun());
    this.modalLayer.querySelector('#act-new-run')?.addEventListener('click', () => this.cb.onStartNewRun());
    this.modalLayer.querySelector('#act-toggle-touch')?.addEventListener('click', () =>
      this.cb.onToggleSetting('forceTouchControls')
    );
    this.modalLayer.querySelector('#act-toggle-sound')?.addEventListener('click', () =>
      this.cb.onToggleSetting('soundEnabled')
    );
    this.modalLayer.querySelector('#act-reset-save')?.addEventListener('click', () => {
      if (confirm('Reset all bases, upgrades, scrap, and run progress?')) {
        this.cb.onResetSave();
      }
    });
  }

  private renderPauseModal(save: SaveState): void {
    this.modalLayer.innerHTML = `
      <div class="panel panel-compact">
        <h2>FLIGHT PAUSED</h2>
        <div class="settings-list">
          <button class="setting-row" id="set-sound"><span>Audio Synthesizer</span><strong>${save.settings.soundEnabled ? 'ON' : 'MUTED'}</strong></button>
          <button class="setting-row" id="set-invert"><span>Invert Pitch Axis</span><strong>${save.settings.invertY ? 'INVERTED' : 'STANDARD'}</strong></button>
          <button class="setting-row" id="set-assist"><span>Flight Assist Dampeners [Z]</span><strong>${save.settings.flightAssist ? 'ON' : 'OFF'}</strong></button>
          <button class="setting-row" id="set-touch"><span>Force Touch Sticks (Phone Preview)</span><strong>${save.settings.forceTouchControls ? 'ON' : 'AUTO'}</strong></button>
        </div>
        <div class="btn-stack">
          <button class="btn btn-primary" id="act-resume">RESUME FLIGHT</button>
          <button class="btn btn-secondary" id="act-open-map">SECTOR MAP &amp; BASE UPGRADES</button>
          <button class="btn btn-ghost" id="act-title">SAVE &amp; RETURN TO TITLE</button>
        </div>
      </div>
    `;

    this.modalLayer.querySelector('#set-sound')?.addEventListener('click', () => this.cb.onToggleSetting('soundEnabled'));
    this.modalLayer.querySelector('#set-invert')?.addEventListener('click', () => this.cb.onToggleSetting('invertY'));
    this.modalLayer.querySelector('#set-assist')?.addEventListener('click', () => this.cb.onToggleSetting('flightAssist'));
    this.modalLayer.querySelector('#set-touch')?.addEventListener('click', () => this.cb.onToggleSetting('forceTouchControls'));
    this.modalLayer.querySelector('#act-resume')?.addEventListener('click', () => this.cb.onResume());
    this.modalLayer.querySelector('#act-open-map')?.addEventListener('click', () => this.cb.onOpenMap());
    this.modalLayer.querySelector('#act-title')?.addEventListener('click', () => this.cb.onReturnToTitle());
  }

  private renderMapModal(
    save: SaveState,
    sector: SectorData,
    activePlanet: PlanetData | null,
    hullRatio: number
  ): void {
    const stats = computeShipStats(save.upgrades, save.bases.length);
    const inMine = activePlanet !== null;
    const anyBaseOnline = save.bases.length > 0;

    const planetCards = sector.planets
      .map((p) => {
        const statusBadge = p.mineCleared
          ? `<span class="badge badge-base">BASE ONLINE</span>`
          : `<span class="badge badge-hostile">HOSTILE MINE • THREAT ${p.threatLevel}</span>`;
        const actionText = p.mineCleared
          ? 'DOCK AT BASE &amp; REPAIR'
          : 'AUTOPILOT &amp; DESCEND INTO MINE';
        return `
          <div class="planet-card ${p.mineCleared ? 'cleared' : ''}">
            <div class="planet-swatch" style="background:radial-gradient(circle at 30% 30%, #${p.accentColor.toString(16).padStart(6, '0')}, #${p.primaryColor.toString(16).padStart(6, '0')})"></div>
            <div class="planet-meta">
              <div class="planet-head">
                <strong>${p.name}</strong>
                ${statusBadge}
              </div>
              <div class="planet-sub">Biome: ${p.biome.toUpperCase()} • Reward: ⚙ ${p.rewardScrap} &amp; ◆ ${p.rewardCores} Core</div>
            </div>
            <button class="btn btn-sm ${p.mineCleared ? 'btn-secondary' : 'btn-primary'}" data-planet="${p.id}" ${inMine ? 'disabled' : ''}>
              ${inMine ? 'IN MINE' : actionText}
            </button>
          </div>
        `;
      })
      .join('');

    const upgradeCards = UPGRADE_DEFS.map((u) => {
      const lvl = save.upgrades[u.key];
      const maxed = lvl >= u.maxLevel;
      const cost = getUpgradeCost(u.key, lvl);
      const canAfford = !maxed && save.scrap >= cost.scrap && save.cores >= cost.cores;

      return `
        <div class="upgrade-card ${maxed ? 'maxed' : ''}">
          <div class="up-top">
            <div>
              <strong>${u.name}</strong>
              <span class="up-facility">${u.facility}</span>
            </div>
            <span class="up-level">LVL ${lvl} / ${u.maxLevel}</span>
          </div>
          <p>${u.description}</p>
          <div class="up-current">${lvl > 0 ? u.perLevelSummary(lvl) : 'Base stock configuration'}</div>
          <div class="up-bottom">
            <span class="up-cost">${maxed ? 'MAXED OUT' : `⚙ ${cost.scrap}${cost.cores > 0 ? `  •  ◆ ${cost.cores}` : ''}`}</span>
            <button class="btn btn-sm ${canAfford ? 'btn-primary' : 'btn-ghost'}" data-upgrade="${u.key}" ${!canAfford ? 'disabled' : ''}>
              ${maxed ? 'MAX' : 'UPGRADE'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.modalLayer.innerHTML = `
      <div class="panel panel-wide">
        <div class="modal-header">
          <div>
            <h2>${sector.name}</h2>
            <div class="modal-sub">
              Scrap: <strong>⚙ ${save.scrap}</strong> • Core Shards: <strong>◆ ${save.cores}</strong> • Planetary Bases: <strong>${save.bases.length}</strong> (+${Math.min(save.bases.length, 12) * 3}% Fleet Bonus)
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" id="act-close-map">RETURN TO COCKPIT [M]</button>
        </div>

        <div class="tab-bar">
          <button class="tab-btn ${this.activeMapTab === 'sector' ? 'active' : ''}" data-tab="sector">SECTOR NAV &amp; PLANETS</button>
          <button class="tab-btn ${this.activeMapTab === 'bases' ? 'active' : ''}" data-tab="bases">BASE NETWORK &amp; UPGRADES (${save.bases.length})</button>
        </div>

        ${
          this.activeMapTab === 'sector'
            ? `
          <div class="planet-list">${planetCards}</div>
          <div class="warp-bar">
            <div>
              <strong>SECTOR ${sector.index + 1} WARP GATE</strong>
              <p>${
                sector.warpUnlocked
                  ? 'Warp coordinates locked! Jump ahead for stronger enemies and richer mines.'
                  : 'Clear at least 1 planetary mine in this sector (or defeat the patrol) to charge the Warp Gate.'
              }</p>
            </div>
            <button class="btn ${sector.warpUnlocked && !inMine ? 'btn-primary' : 'btn-ghost'}" id="act-warp" ${!sector.warpUnlocked || inMine ? 'disabled' : ''}>
              ${sector.warpUnlocked ? `WARP TO SECTOR ${sector.index + 1}` : 'WARP LOCKED'}
            </button>
          </div>
        `
            : `
          <div class="base-banner">
            <div>
              <strong>${anyBaseOnline ? `${save.bases.length} Planetary Base${save.bases.length > 1 ? 's' : ''} Operational` : 'No Planetary Base Established Yet'}</strong>
              <p>${
                anyBaseOnline
                  ? 'All base upgrades are permanent and carry over across every roguelike run.'
                  : 'Clear your first planetary mine to establish a base, or install starter ship upgrades now.'
              }</p>
            </div>
            ${
              anyBaseOnline && hullRatio < 0.99 && !inMine
                ? `<button class="btn btn-secondary btn-sm" id="act-repair">FREE BASE HULL REPAIR &amp; REARM</button>`
                : `<span class="ship-mini-stats">Hull ${stats.maxHull} • Shield ${stats.maxShield} • DMG ${stats.laserDamage}</span>`
            }
          </div>
          <div class="upgrade-grid">${upgradeCards}</div>
        `
        }
      </div>
    `;

    this.modalLayer.querySelector('#act-close-map')?.addEventListener('click', () => this.cb.onCloseMap());
    this.modalLayer.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeMapTab = (btn as HTMLElement).dataset.tab as 'sector' | 'bases';
        this.renderMapModal(save, sector, activePlanet, hullRatio);
      });
    });
    this.modalLayer.querySelectorAll('[data-planet]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.planet!;
        this.cb.onSelectPlanetAction(id);
      });
    });
    this.modalLayer.querySelectorAll('[data-upgrade]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = (btn as HTMLElement).dataset.upgrade as UpgradeKey;
        this.cb.onBuyUpgrade(key);
      });
    });
    this.modalLayer.querySelector('#act-warp')?.addEventListener('click', () => this.cb.onWarpNextSector());
    this.modalLayer.querySelector('#act-repair')?.addEventListener('click', () => this.cb.onRepairAtBase());
  }

  private renderMineClearedModal(summary: MineClearSummary): void {
    this.modalLayer.innerHTML = `
      <div class="panel panel-compact panel-victory">
        <div class="brand-kicker">PLANETARY BASE ESTABLISHED</div>
        <h2>${summary.planetName} CLEARED!</h2>
        <p class="brand-sub">
          You escaped the reactor meltdown with <strong>${summary.escapeTimeLeft.toFixed(1)}s</strong> to spare. An orbital Base is now online and permanently boosts your fleet!
        </p>
        <div class="stat-strip">
          <div><span>SCRAP SALVAGED</span><strong>+${summary.scrapReward}</strong></div>
          <div><span>CORE SHARDS</span><strong>+${summary.coreReward}</strong></div>
          <div><span>HOSTILES CLEARED</span><strong>${summary.enemiesCleared}</strong></div>
          <div><span>TOTAL BASES</span><strong>${summary.totalBases}</strong></div>
        </div>
        <div class="btn-stack">
          <button class="btn btn-primary" id="act-open-bases">SPEND SCRAP AT BASE UPGRADES</button>
          <button class="btn btn-secondary" id="act-return-orbit">RETURN TO SECTOR ORBIT</button>
        </div>
      </div>
    `;

    this.modalLayer.querySelector('#act-open-bases')?.addEventListener('click', () => {
      this.activeMapTab = 'bases';
      this.cb.onContinueAfterMine();
      this.cb.onOpenMap();
    });
    this.modalLayer.querySelector('#act-return-orbit')?.addEventListener('click', () =>
      this.cb.onContinueAfterMine()
    );
  }

  private renderRunOverModal(save: SaveState, runStats: RunStats): void {
    this.modalLayer.innerHTML = `
      <div class="panel panel-compact panel-defeat">
        <div class="brand-kicker">SHIP DESTROYED — CLONE POD RECOVERED</div>
        <h2>RUN ENDED IN SECTOR ${runStats.sectorIndex}</h2>
        <p class="brand-sub">
          Your established Planetary Bases (<strong>${save.bases.length}</strong>), permanent upgrades, and salvaged Scrap/Cores remain intact for your next sortie.
        </p>
        <div class="stat-strip">
          <div><span>ENEMIES DESTROYED</span><strong>${runStats.enemiesDestroyed}</strong></div>
          <div><span>MINES CLEARED</span><strong>${runStats.minesClearedThisRun}</strong></div>
          <div><span>SCRAP EARNED</span><strong>${runStats.scrapEarnedThisRun}</strong></div>
          <div><span>BEST SECTOR</span><strong>${save.bestSector}</strong></div>
        </div>
        <div class="btn-stack">
          <button class="btn btn-primary" id="act-retry">LAUNCH STRONGER RUN</button>
          <button class="btn btn-ghost" id="act-title">TITLE SCREEN</button>
        </div>
      </div>
    `;

    this.modalLayer.querySelector('#act-retry')?.addEventListener('click', () => this.cb.onStartNewRun());
    this.modalLayer.querySelector('#act-title')?.addEventListener('click', () => this.cb.onReturnToTitle());
  }
}
