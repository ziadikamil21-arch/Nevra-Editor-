// Trial Reels — Alter + Mirror processor.
// Alter: combines asymmetric crop + micro speed + color grading + optional grain
//        + full metadata rewrite. The first ~1.5s (the hook) is spared from
//        color grading and grain via FFmpeg timeline `enable='gte(t,1.5)'`.
// Mirror: horizontal flip (hflip) applied to the ALREADY-generated Alter file.
//
// Everything runs through the existing @ffmpeg/ffmpeg WASM instance.

const HOOK_SKIP_SEC = 1.5; // never grade/grain the first 1.5s

function rand(min: number, max: number) { return Math.random() * (max - min) + min; }
function randStr(len = 14) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

export interface AlterOptions {
  cropPct: number;      // 0.05 – 0.12  (overall edge crop intensity)
  speedPct: number;     // 0.97 – 1.03
  colorGrade: boolean;  // auto colorimetric adjustment
  grain: boolean;       // subtle film grain / noise
}

export interface AlterParams {
  // crop fractions per edge (asymmetric, sum ≈ cropPct per axis)
  cropL: number; cropR: number; cropT: number; cropB: number;
  speed: number;
  // color grading
  contrast: number;   // ~0.97 – 1.08
  brightness: number; // ~ -0.05 – 0.05
  saturation: number; // ~0.90 – 1.10
  tempShift: number;  // colorbalance red/blue shift, -0.06 .. 0.06 (warm=+, cold=-)
  grainStrength: number; // 0 or ~4-10
  metadata: Record<string, string>;
  opts: AlterOptions;
}

export function randomizeAlterParams(opts: AlterOptions): AlterParams {
  // Distribute the crop asymmetrically around the requested intensity.
  const c = opts.cropPct;
  const splitH = rand(0.35, 0.65);
  const splitV = rand(0.35, 0.65);
  const jitter = () => rand(0.85, 1.15);
  const cropL = Math.max(0.02, c * splitH * jitter());
  const cropR = Math.max(0.02, c * (1 - splitH) * jitter());
  const cropT = Math.max(0.02, c * splitV * jitter());
  const cropB = Math.max(0.02, c * (1 - splitV) * jitter());

  return {
    cropL, cropR, cropT, cropB,
    speed: opts.speedPct,
    contrast: opts.colorGrade ? 1 + rand(-0.05, 0.08) : 1,
    brightness: opts.colorGrade ? rand(-0.05, 0.05) : 0,
    saturation: opts.colorGrade ? 1 + rand(-0.08, 0.10) : 1,
    tempShift: opts.colorGrade ? rand(-0.06, 0.06) : 0,
    grainStrength: opts.grain ? rand(4, 10) : 0,
    metadata: {
      title: randStr(16),
      comment: randStr(20),
      encoder: `Lavf${58 + Math.floor(rand(0, 8))}.${Math.floor(rand(10, 90))}.100`,
      creation_time: new Date(Date.now() - Math.floor(rand(0, 60)) * 86400000).toISOString(),
      make: '', model: '', location: '', // wipe device / GPS if present
    },
    opts,
  };
}

function even(n: number) { return Math.max(2, Math.floor(n / 2) * 2); }

/** Build the ffmpeg exec args for the Alter pass. `w`/`h` are the source dims. */
export function buildAlterArgs(
  inputName: string,
  outputName: string,
  p: AlterParams,
  w: number,
  h: number,
  hasAudio: boolean,
): string[] {
  const vf: string[] = [];

  // 1. Asymmetric crop then scale back to the original even dimensions.
  const cw = even(w * (1 - p.cropL - p.cropR));
  const ch = even(h * (1 - p.cropT - p.cropB));
  const cx = Math.floor(w * p.cropL);
  const cy = Math.floor(h * p.cropT);
  vf.push(`crop=${cw}:${ch}:${cx}:${cy}`);
  vf.push(`scale=${even(w)}:${even(h)}`);

  // 2. Micro speed change (video PTS). Audio handled below via atempo.
  if (Math.abs(p.speed - 1) > 0.0005) {
    vf.push(`setpts=${(1 / p.speed).toFixed(6)}*PTS`);
  }

  // 3. Color grading — spare the hook via timeline enable.
  if (p.opts.colorGrade) {
    vf.push(
      `eq=contrast=${p.contrast.toFixed(4)}:brightness=${p.brightness.toFixed(4)}:saturation=${p.saturation.toFixed(4)}:enable='gte(t\\,${HOOK_SKIP_SEC})'`,
    );
    if (Math.abs(p.tempShift) > 0.002) {
      const s = p.tempShift; // + = warm (more red, less blue)
      vf.push(
        `colorbalance=rs=${s.toFixed(4)}:bs=${(-s).toFixed(4)}:rm=${(s * 0.5).toFixed(4)}:bm=${(-s * 0.5).toFixed(4)}:enable='gte(t\\,${HOOK_SKIP_SEC})'`,
      );
    }
  }

  // 4. Subtle grain / noise — also spares the hook.
  if (p.opts.grain && p.grainStrength > 0) {
    vf.push(`noise=alls=${p.grainStrength.toFixed(1)}:allf=t+u:enable='gte(t\\,${HOOK_SKIP_SEC})'`);
  }

  // 5. Safety: even dimensions for yuv420p.
  vf.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');

  const args = ['-i', inputName, '-vf', vf.join(',')];

  // Audio: keep sync with speed change (atempo preserves pitch better than resample).
  if (hasAudio && Math.abs(p.speed - 1) > 0.0005) {
    const t = Math.max(0.5, Math.min(2, p.speed)).toFixed(6);
    args.push('-af', `atempo=${t}`);
  }

  args.push(
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-map_metadata', '-1',            // strip ALL original metadata (incl. GPS/device)
  );
  for (const [k, v] of Object.entries(p.metadata)) {
    if (v) args.push('-metadata', `${k}=${v}`);
  }
  args.push('-movflags', '+faststart', outputName);
  return args;
}

/** Build the ffmpeg exec args for the Mirror pass (horizontal flip of the Alter). */
export function buildMirrorArgs(
  inputName: string,
  outputName: string,
  hasAudio: boolean,
): string[] {
  return [
    '-i', inputName,
    '-vf', 'hflip',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
    ...(hasAudio ? ['-c:a', 'copy'] : ['-an']),
    '-map_metadata', '-1',
    '-metadata', `title=${randStr(16)}`,
    '-metadata', `encoder=Lavf60.${Math.floor(rand(10, 90))}.100`,
    '-movflags', '+faststart',
    outputName,
  ];
}

/** Human-readable log of the exact random values used (for reproducing a good preset). */
export function alterConfigLog(p: AlterParams): Record<string, unknown> {
  return {
    crop: {
      left: +(p.cropL * 100).toFixed(2), right: +(p.cropR * 100).toFixed(2),
      top: +(p.cropT * 100).toFixed(2), bottom: +(p.cropB * 100).toFixed(2),
    },
    speedPct: +(p.speed * 100).toFixed(2),
    colorGrade: p.opts.colorGrade && {
      contrast: +p.contrast.toFixed(3), brightness: +p.brightness.toFixed(3),
      saturation: +p.saturation.toFixed(3), tempShift: +p.tempShift.toFixed(3),
    },
    grainStrength: p.grainStrength ? +p.grainStrength.toFixed(1) : false,
    metadata: p.metadata,
  };
}
