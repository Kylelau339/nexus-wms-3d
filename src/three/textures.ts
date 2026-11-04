import * as THREE from 'three';

/** Procedural canvas textures — keeps the bundle self-contained and offline-safe. */

export function makeFloorTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#eef2f7';
  ctx.fillRect(0, 0, size, size);

  // Concrete mottling
  const img = ctx.getImageData(0, 0, size, size);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    data[i] = Math.max(0, Math.min(255, data[i]! + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1]! + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);

  // Slab joints
  ctx.strokeStyle = 'rgba(47,127,212,0.12)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    const p = (i / 8) * size;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  // Hazard hatching near the edges
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = '#f0b93c';
  ctx.lineWidth = 6;
  for (let i = -size; i < size * 2; i += 34) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
  }
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 6);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface SignOptions {
  text: string;
  sub?: string;
  color?: string;
  background?: string;
  width?: number;
  height?: number;
  fontSize?: number;
}

export function makeSignTexture(options: SignOptions): THREE.CanvasTexture {
  const width = options.width ?? 512;
  const height = options.height ?? 160;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = options.background ?? 'rgba(255,255,255,0.96)';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = options.color ?? '#276bb9';
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, width - 6, height - 6);

  ctx.fillStyle = options.color ?? '#276bb9';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${options.fontSize ?? 54}px "Noto Sans TC","Microsoft JhengHei",sans-serif`;
  ctx.fillText(options.text, width / 2, options.sub ? height * 0.38 : height / 2);

  if (options.sub) {
    ctx.fillStyle = 'rgba(60,95,129,0.9)';
    ctx.font = '400 28px "Noto Sans TC","Microsoft JhengHei",sans-serif';
    ctx.fillText(options.sub, width / 2, height * 0.72);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Small capsule label used for bin / dock tags. */
export function makeTagTexture(text: string, color = '#276bb9'): THREE.CanvasTexture {
  const width = 256;
  const height = 64;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.roundRect(2, 8, width - 4, height - 16, 10);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '600 26px "JetBrains Mono",Consolas,monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Vertical gradient used as the scene backdrop — light sky over pale blue haze. */
export function makeSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.5, '#f2f8ff');
  gradient.addColorStop(0.82, '#dcecff');
  gradient.addColorStop(1, '#c9ddf5');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft radial disc used for selection rings and status beacons. */
export function makeGlowTexture(color = '#2f7fd4'): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, hexToRgba(color, 0.75));
  gradient.addColorStop(0.45, hexToRgba(color, 0.28));
  gradient.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.replace(/(.)/g, '$1$1') : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
