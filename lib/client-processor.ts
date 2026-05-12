// Client-side FFmpeg WASM processor
// Runs entirely in the browser — no server needed (works on Netlify free tier)

export type Quality = 'normal' | 'max' | 'pro';

export interface TransformSummary {
  cropPx: number;
  zoomPct: number;
  rotationDeg: number;
  hueDeg: number;
  satDelta: number;
  pitchPct: number;
  speedPct: number;
  bitrate: number;
  mirror: boolean;
  warmth: 'warm' | 'cold' | 'neutral';
  warmthStrength: number;
  invisibleText: boolean;
  vowb: boolean;
}

export interface ClientVariant {
  index: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  ffmpegProgress: number; // 0-1 per variant
  blobUrl: string | null;
  filename: string | null;
  summary: TransformSummary | null;
  error?: string;
}

interface TransformParams {
  cropPx: number;
  zoomFactor: number;
  rotationRad: number;
  hueShift: number;
  satFactor: number;
  pitchRate: number;
  speedFactor: number;
  bitrate: number;
  audioBitrate: number;
  mirror: boolean;
  warmth: 'warm' | 'cold' | 'neutral';
  warmthStrength: number;
  invisibleText: boolean;
  vowb: boolean;
  metadata: Record<string, string>;
}

function rand(min: number, max: number) { return Math.random() * (max - min) + min; }
function randInt(min: number, max: number) { return Math.floor(rand(min, max + 1)); }
function randStr(len = 12) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

export function generateParams(quality: Quality, vowb = false): TransformParams {
  const p: TransformParams = {
    cropPx: randInt(1, 2),
    zoomFactor: 1,
    rotationRad: 0,
    hueShift: 0,
    satFactor: 1,
    pitchRate: 1,
    speedFactor: 1,
    bitrate: randInt(2700, 3300),
    audioBitrate: randInt(128, 192),
    mirror: false,
    warmth: 'neutral',
    warmthStrength: 0,
    invisibleText: false,
    vowb,
    metadata: {
      title: randStr(16),
      comment: randStr(20),
      description: randStr(24),
    },
  };

  if (quality === 'max' || quality === 'pro') {
    p.cropPx = randInt(1, 3);
    p.pitchRate = 1 + rand(0.005, 0.01);
    p.hueShift = rand(-4, 4);
    p.satFactor = 1 + rand(-0.03, 0.04);
    p.zoomFactor = 1 + rand(0.005, 0.012);
    p.bitrate = randInt(2500, 3500);
    // Warm or cold filter (random)
    const side = Math.random();
    if (side < 0.45) {
      p.warmth = 'warm';
      p.warmthStrength = rand(0.03, 0.08);
    } else if (side < 0.9) {
      p.warmth = 'cold';
      p.warmthStrength = rand(0.03, 0.08);
    }
  }

  if (quality === 'pro') {
    p.cropPx = randInt(2, 4);
    p.rotationRad = rand(0.0017, 0.0087) * (Math.random() > 0.5 ? 1 : -1);
    p.speedFactor = 1 + rand(0.005, 0.015);
    p.zoomFactor = 1 + rand(0.01, 0.02);
    p.hueShift = rand(-5, 5);
    p.mirror = Math.random() > 0.4; // 60% chance mirror in pro
    p.invisibleText = true;
    p.bitrate = randInt(2400, 3600);
    p.warmthStrength = rand(0.04, 0.1); // stronger filter in pro
  }

  return p;
}

export function paramsToSummary(p: TransformParams): TransformSummary {
  return {
    cropPx: p.cropPx,
    zoomPct: parseFloat(((p.zoomFactor - 1) * 100).toFixed(2)),
    rotationDeg: parseFloat((p.rotationRad * (180 / Math.PI)).toFixed(2)),
    hueDeg: parseFloat(p.hueShift.toFixed(1)),
    satDelta: parseFloat(((p.satFactor - 1) * 100).toFixed(1)),
    pitchPct: parseFloat(((p.pitchRate - 1) * 100).toFixed(2)),
    speedPct: parseFloat(((p.speedFactor - 1) * 100).toFixed(2)),
    bitrate: p.bitrate,
    mirror: p.mirror,
    warmth: p.warmth,
    warmthStrength: parseFloat((p.warmthStrength * 100).toFixed(1)),
    invisibleText: p.invisibleText,
    vowb: p.vowb,
  };
}

export function buildVideoFilters(p: TransformParams): string {
  const vf: string[] = [];

  // 0. VOWB — place video on white background with caption space at bottom
  if (p.vowb) {
    // Scale video to 86% of its size, center it on original-size white canvas
    // Add ~200px white space at bottom for caption
    vf.push('scale=trunc(iw*0.86/2)*2:trunc(ih*0.86/2)*2');
    vf.push('pad=trunc(iw/0.86/2)*2:trunc((ih/0.86+200)/2)*2:(ow-iw)/2:trunc(ih*0.07):white');
  }

  // 1. Crop + rescale
  const c = p.cropPx;
  vf.push(`crop=iw-${c * 2}:ih-${c * 2}:${c}:${c}`);
  vf.push(`scale=iw+${c * 2}:ih+${c * 2}`);

  // 2. Zoom: scale up then center-crop
  if (p.zoomFactor > 1.001) {
    const z = p.zoomFactor.toFixed(5);
    vf.push(`scale=iw*${z}:ih*${z}`);
    vf.push(`crop=iw/${z}:ih/${z}:(iw-iw/${z})/2:(ih-ih/${z})/2`);
  }

  // 3. Rotation
  if (Math.abs(p.rotationRad) > 0.001) {
    vf.push(`rotate=${p.rotationRad.toFixed(6)}:fillcolor=black@0`);
  }

  // 4. Hue + saturation
  if (Math.abs(p.hueShift) > 0.05 || Math.abs(p.satFactor - 1) > 0.005) {
    vf.push(`hue=h=${p.hueShift.toFixed(3)}:s=${p.satFactor.toFixed(4)}`);
  }

  // 5. Warm / cold color filter
  if (p.warmth !== 'neutral' && p.warmthStrength > 0) {
    const s = p.warmthStrength.toFixed(4);
    if (p.warmth === 'warm') {
      // Boost reds/yellows, reduce blues
      vf.push(`colorbalance=rs=${s}:gs=${(parseFloat(s) * 0.15).toFixed(4)}:bs=-${s}:rm=${(parseFloat(s)*0.5).toFixed(4)}:gm=0:bm=-${(parseFloat(s)*0.5).toFixed(4)}`);
    } else {
      // Boost blues, reduce reds
      vf.push(`colorbalance=rs=-${s}:gs=0:bs=${s}:rm=-${(parseFloat(s)*0.5).toFixed(4)}:gm=0:bm=${(parseFloat(s)*0.5).toFixed(4)}`);
    }
  }

  // 6. Mirror (horizontal flip)
  if (p.mirror) {
    vf.push('hflip');
  }

  // 7. Speed (video PTS)
  if (Math.abs(p.speedFactor - 1) > 0.001) {
    vf.push(`setpts=${(1 / p.speedFactor).toFixed(6)}*PTS`);
  }

  // 8. Invisible ghost text (1px, ~2% opacity)
  if (p.invisibleText) {
    const txt = randStr(10);
    vf.push(`drawtext=text='${txt}':fontcolor=white@0.02:fontsize=2:x=2:y=2`);
  }

  return vf.join(',');
}

export function buildAudioFilters(p: TransformParams): string {
  const af: string[] = [];
  if (Math.abs(p.pitchRate - 1) > 0.0005) {
    af.push(`asetrate=44100*${p.pitchRate.toFixed(6)}`);
    af.push('aresample=44100');
  }
  if (Math.abs(p.speedFactor - 1) > 0.001) {
    const t = Math.max(0.5, Math.min(2.0, p.speedFactor)).toFixed(6);
    af.push(`atempo=${t}`);
  }
  return af.join(',');
}

export function buildFFmpegArgs(
  inputName: string,
  outputName: string,
  p: TransformParams,
  isImage: boolean,
  hasAudio: boolean,
): string[] {
  const args: string[] = ['-i', inputName];

  const vf = buildVideoFilters(p);
  if (vf) args.push('-vf', vf);

  const af = buildAudioFilters(p);
  if (!isImage && hasAudio && af) args.push('-af', af);

  if (isImage) {
    args.push('-vframes', '1', '-q:v', '2');
  } else {
    args.push(
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',   // Required for QuickTime / Instagram compatibility
      '-b:v', `${p.bitrate}k`,
      ...(hasAudio ? ['-c:a', 'aac', '-b:a', `${p.audioBitrate}k`] : ['-an']),
    );
    // Metadata
    for (const [k, v] of Object.entries(p.metadata)) {
      args.push('-metadata', `${k}=${v}`);
    }
  }

  args.push(outputName);
  return args;
}
