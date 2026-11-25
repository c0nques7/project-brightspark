import * as THREE from 'three';

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export function createMineWallTexture(primaryHex: number, accentHex: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Base metallic bulkhead
  ctx.fillStyle = '#151b26';
  ctx.fillRect(0, 0, size, size);

  // Subtle biome-tinted plating
  ctx.fillStyle = hexToCss(primaryHex);
  ctx.globalAlpha = 0.28;
  ctx.fillRect(10, 10, size - 20, size - 20);
  ctx.globalAlpha = 1;

  // Ribbed industrial panels
  ctx.strokeStyle = '#2b364a';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, size - 16, size - 16);
  ctx.strokeRect(24, 24, size - 48, size - 48);

  // Diagonal structural crossbeams
  ctx.strokeStyle = '#1d2534';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(24, 24);
  ctx.lineTo(size - 24, size - 24);
  ctx.moveTo(size - 24, 24);
  ctx.lineTo(24, size - 24);
  ctx.stroke();

  // Glowing conduit trim along borders
  ctx.fillStyle = hexToCss(accentHex);
  ctx.globalAlpha = 0.75;
  ctx.fillRect(16, size / 2 - 4, 28, 8);
  ctx.fillRect(size - 44, size / 2 - 4, 28, 8);
  ctx.fillRect(size / 2 - 4, 16, 8, 28);
  ctx.fillRect(size / 2 - 4, size - 44, 8, 28);
  ctx.globalAlpha = 1;

  // Rivets
  ctx.fillStyle = '#475569';
  const pts = [18, size - 18];
  for (const x of pts) {
    for (const y of pts) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Subtle surface grain
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(x, y, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createPlanetTexture(
  primaryHex: number,
  accentHex: number,
  seed: number
): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(0.25, hexToCss(primaryHex));
  grad.addColorStop(0.55, hexToCss(accentHex));
  grad.addColorStop(0.8, hexToCss(primaryHex));
  grad.addColorStop(1, '#090d16');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Procedural cloud / terrain bands & craters
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };

  for (let i = 0; i < 48; i++) {
    const y = rand() * h;
    const bh = 4 + rand() * 20;
    ctx.fillStyle = i % 2 === 0 ? hexToCss(accentHex) : hexToCss(primaryHex);
    ctx.globalAlpha = 0.1 + rand() * 0.22;
    ctx.fillRect(0, y, w, bh);
  }

  for (let i = 0; i < 75; i++) {
    const cx = rand() * w;
    const cy = 20 + rand() * (h - 40);
    const r = 4 + rand() * 26;
    ctx.fillStyle = rand() > 0.45 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.12)';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 1.4, r, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGlowSpriteTexture(innerColor: string, outerColor: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0, innerColor);
  grad.addColorStop(0.35, outerColor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
