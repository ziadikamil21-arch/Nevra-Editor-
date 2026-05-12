// Canvas-based image processor — replaces FFmpeg WASM for photos entirely.
// Uses the browser's native 2D Canvas API: no WASM, no memory crashes, GPU-accelerated.

import { type TransformParams } from './client-processor';

export async function processImageWithCanvas(
  file: File,
  p: TransformParams,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = renderFrame(img, p);
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))),
          'image/png',
        );
      } catch (e) {
        reject(e);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };

    img.src = url;
  });
}

function renderFrame(img: HTMLImageElement, p: TransformParams): HTMLCanvasElement {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const c = p.cropPx;
  const z = p.zoomFactor;

  // Source rect: crop edges then zoom into center
  const innerW = W - c * 2;
  const innerH = H - c * 2;
  const srcW = Math.round(innerW / z);
  const srcH = Math.round(innerH / z);
  const srcX = c + Math.round((innerW - srcW) / 2);
  const srcY = c + Math.round((innerH - srcH) / 2);

  // Output canvas size & draw target
  let outW: number, outH: number;
  let drawX: number, drawY: number, drawW: number, drawH: number;

  if (p.powb) {
    // Scale photo to 86%, center on white canvas with caption space at bottom
    const photoW = Math.floor(W * 0.86 / 2) * 2;
    const photoH = Math.floor(H * 0.86 / 2) * 2;
    outW  = Math.max(W, Math.floor(photoW / 0.86 / 2) * 2);
    outH  = Math.floor((photoH / 0.86 + 200) / 2) * 2;
    drawW = photoW;
    drawH = photoH;
    drawX = Math.floor((outW - photoW) / 2);
    drawY = Math.floor(photoH * 0.07);
  } else {
    outW = W; outH = H;
    drawX = 0; drawY = 0; drawW = W; drawH = H;
  }

  const canvas = document.createElement('canvas');
  canvas.width  = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;

  // Background: white for POWB, black for non-POWB rotation fill
  ctx.fillStyle = p.powb ? '#ffffff' : '#000000';
  ctx.fillRect(0, 0, outW, outH);

  // Build CSS color filter string (applied to the draw call only)
  const cf: string[] = [];
  if (Math.abs(p.hueShift) > 0.05)
    cf.push(`hue-rotate(${p.hueShift.toFixed(2)}deg)`);
  if (Math.abs(p.satFactor - 1) > 0.005)
    cf.push(`saturate(${(p.satFactor * 100).toFixed(1)}%)`);
  if (p.warmth === 'warm' && p.warmthStrength > 0.001) {
    const s = p.warmthStrength;
    cf.push(`sepia(${(s * 40).toFixed(1)}%) saturate(${(120 + s * 30).toFixed(0)}%) hue-rotate(-${(s * 15).toFixed(1)}deg)`);
  } else if (p.warmth === 'cold' && p.warmthStrength > 0.001) {
    const s = p.warmthStrength;
    cf.push(`saturate(${(100 - s * 20).toFixed(0)}%) hue-rotate(${(s * 20).toFixed(1)}deg) brightness(${(100 - s * 5).toFixed(0)}%)`);
  }
  // Invisible micro-shift (replaces ghost text)
  if (p.invisibleText) cf.push('brightness(100.1%)');

  if (cf.length > 0) ctx.filter = cf.join(' ');

  // Geometry: mirror + rotation, centered on draw area
  const cx = drawX + drawW / 2;
  const cy = drawY + drawH / 2;

  ctx.save();
  ctx.translate(cx, cy);
  if (p.mirror) ctx.scale(-1, 1);
  if (Math.abs(p.rotationRad) > 0.001) ctx.rotate(p.rotationRad);
  ctx.drawImage(img, srcX, srcY, srcW, srcH, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  return canvas;
}
