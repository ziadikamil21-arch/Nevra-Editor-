import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Use process.cwd() so Next.js server routes resolve to the real project dir
// (ffmpeg-static returns /ROOT/... in Next.js context which is wrong)
const FFMPEG_BIN = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
const FFPROBE_BIN = path.join(
  process.cwd(), 'node_modules', 'ffprobe-static', 'bin',
  process.platform,
  process.arch,
  process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
);

ffmpeg.setFfmpegPath(FFMPEG_BIN);
ffmpeg.setFfprobePath(FFPROBE_BIN);

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
  audioBitrate: number;
  invisibleText: boolean;
}

export interface ProcessResult {
  outputPath: string;
  summary: TransformSummary;
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
  addInvisibleText: boolean;
  metadata: Record<string, string>;
}

function rand(min: number, max: number) { return Math.random() * (max - min) + min; }
function randInt(min: number, max: number) { return Math.floor(rand(min, max + 1)); }
function randStr(len = 12) { return uuidv4().replace(/-/g, '').substring(0, len); }

function generateParams(quality: Quality): TransformParams {
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
    addInvisibleText: false,
    metadata: {
      title: randStr(16),
      comment: randStr(20),
      description: randStr(24),
      artist: randStr(10),
    },
  };

  if (quality === 'max' || quality === 'pro') {
    p.cropPx = randInt(1, 3);
    p.pitchRate = 1 + rand(0.005, 0.01);
    p.hueShift = rand(-4, 4);
    p.satFactor = 1 + rand(-0.03, 0.04);
    p.zoomFactor = 1 + rand(0.005, 0.012);
    p.bitrate = randInt(2500, 3500);
  }

  if (quality === 'pro') {
    p.cropPx = randInt(2, 4);
    p.rotationRad = rand(0.0017, 0.0087) * (Math.random() > 0.5 ? 1 : -1); // 0.1–0.5°
    p.speedFactor = 1 + rand(0.005, 0.015);
    p.zoomFactor = 1 + rand(0.01, 0.02);
    p.hueShift = rand(-5, 5);
    p.addInvisibleText = true;
    p.bitrate = randInt(2400, 3600);
  }

  return p;
}

async function probeHasAudio(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) { resolve(false); return; }
      resolve((meta.streams ?? []).some((s) => s.codec_type === 'audio'));
    });
  });
}

export async function processVariant(
  inputPath: string,
  outputDir: string,
  quality: Quality,
  variantIdx: number,
  isImage: boolean,
): Promise<ProcessResult> {
  const p = generateParams(quality);
  const ext = isImage ? 'jpg' : 'mp4';
  const outputFilename = `variant_${variantIdx + 1}_${randStr(8)}.${ext}`;
  const outputPath = path.join(outputDir, outputFilename);

  const hasAudio = isImage ? false : await probeHasAudio(inputPath);

  const summary: TransformSummary = {
    cropPx: p.cropPx,
    zoomPct: parseFloat(((p.zoomFactor - 1) * 100).toFixed(2)),
    rotationDeg: parseFloat((p.rotationRad * (180 / Math.PI)).toFixed(2)),
    hueDeg: parseFloat(p.hueShift.toFixed(1)),
    satDelta: parseFloat(((p.satFactor - 1) * 100).toFixed(1)),
    pitchPct: parseFloat(((p.pitchRate - 1) * 100).toFixed(2)),
    speedPct: parseFloat(((p.speedFactor - 1) * 100).toFixed(2)),
    bitrate: p.bitrate,
    audioBitrate: p.audioBitrate,
    invisibleText: p.addInvisibleText,
  };

  await runFFmpeg(inputPath, outputPath, p, hasAudio, isImage);

  return { outputPath, summary };
}

function runFFmpeg(
  inputPath: string,
  outputPath: string,
  p: TransformParams,
  hasAudio: boolean,
  isImage: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath);

    // ── Video filter chain ──
    const vf: string[] = [];

    // 1. Crop edges then scale back to original size
    const c = p.cropPx;
    vf.push(`crop=iw-${c * 2}:ih-${c * 2}:${c}:${c}`);
    vf.push(`scale=iw+${c * 2}:ih+${c * 2}`);

    // 2. Zoom: scale up then center-crop back
    if (p.zoomFactor > 1.001) {
      const z = p.zoomFactor.toFixed(5);
      // After scale, new_iw = old_iw * z
      // Crop back to old_iw = new_iw / z, centered
      vf.push(`scale=iw*${z}:ih*${z}`);
      vf.push(`crop=iw/${z}:ih/${z}:(iw-iw/${z})/2:(ih-ih/${z})/2`);
    }

    // 3. Slight rotation (fillcolor=none to avoid black borders bleeding)
    if (Math.abs(p.rotationRad) > 0.001) {
      const rad = p.rotationRad.toFixed(6);
      vf.push(`rotate=${rad}:fillcolor=black@0`);
    }

    // 4. Color: hue + saturation
    if (Math.abs(p.hueShift) > 0.05 || Math.abs(p.satFactor - 1) > 0.005) {
      vf.push(`hue=h=${p.hueShift.toFixed(3)}:s=${p.satFactor.toFixed(4)}`);
    }

    // 5. Speed (video PTS)
    if (Math.abs(p.speedFactor - 1) > 0.001) {
      vf.push(`setpts=${(1 / p.speedFactor).toFixed(6)}*PTS`);
    }

    // 6. Invisible metadata text (1px, nearly transparent white)
    if (p.addInvisibleText) {
      const txt = randStr(10);
      vf.push(`drawtext=text='${txt}':fontcolor=white@0.02:fontsize=2:x=2:y=2`);
    }

    cmd.videoFilter(vf.join(','));

    // ── Audio filter chain ──
    if (!isImage && hasAudio) {
      const af: string[] = [];
      if (Math.abs(p.pitchRate - 1) > 0.0005) {
        af.push(`asetrate=44100*${p.pitchRate.toFixed(6)}`);
        af.push('aresample=44100');
      }
      if (Math.abs(p.speedFactor - 1) > 0.001) {
        const t = Math.max(0.5, Math.min(2.0, p.speedFactor)).toFixed(6);
        af.push(`atempo=${t}`);
      }
      if (af.length) cmd.audioFilter(af.join(','));
    }

    // ── Output options ──
    const metaArgs = Object.entries(p.metadata).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);

    if (isImage) {
      cmd.outputOptions(['-vframes', '1', '-q:v', '2', ...metaArgs]);
    } else {
      cmd.outputOptions([
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '20',
        ...(hasAudio ? ['-c:a', 'aac', '-b:a', `${p.audioBitrate}k`] : ['-an']),
        '-b:v', `${p.bitrate}k`,
        '-movflags', '+faststart',
        ...metaArgs,
      ]);
    }

    cmd
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}
