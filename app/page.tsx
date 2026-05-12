'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  generateParams, paramsToSummary, buildFFmpegArgs,
  type Quality, type ClientVariant,
} from '@/lib/client-processor';
import { processImageWithCanvas } from '@/lib/canvas-image-processor';

type FileMode = 'video' | 'photo';

const QUALITY_CONFIG = {
  normal: {
    label: 'Normal', speed: 'Ultra Fast',
    descVideo: 'Crop · Bitrate · Metadata',
    descPhoto: 'Crop · Metadata',
    color: '#10b981', rgb: '16,185,129', glow: 'rgba(16,185,129,0.2)',
  },
  max: {
    label: 'Max', speed: '~15s / variant',
    descVideo: 'Pitch · Zoom · Hue · Color filter',
    descPhoto: 'Zoom · Hue · Color filter',
    color: '#f59e0b', rgb: '245,158,11', glow: 'rgba(245,158,11,0.2)',
  },
  pro: {
    label: 'Pro', speed: 'Premium',
    descVideo: 'Rotation · Speed · Mirror · Ghost text',
    descPhoto: 'Rotation · Zoom · Hue · Ghost text',
    color: '#a78bfa', rgb: '124,58,237', glow: 'rgba(124,58,237,0.25)',
  },
} as const;

function fmtBytes(b: number) {
  return b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

function TransformRow({ icon, label, value, color }: { icon: string; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="flex items-center gap-2">
        <span className="text-sm w-5 text-center">{icon}</span>
        <span className="text-xs" style={{ color: '#9ca3af' }}>{label}</span>
      </div>
      <span className="text-xs font-bold font-mono" style={{ color: color ?? '#e2e8f0' }}>{value}</span>
    </div>
  );
}

function VariantCard({ v, onDelete, onDownload }: { v: ClientVariant; onDelete: () => void; onDownload: () => void }) {
  const s = v.summary;
  const isDone = v.status === 'done';
  const isProcessing = v.status === 'processing';
  const isError = v.status === 'error';

  return (
    <div className="rounded-2xl border overflow-hidden transition-all duration-300"
      style={{
        background: '#0c0c1e',
        borderColor: isDone ? '#2d2d5a' : isProcessing ? '#7c3aed' : isError ? '#7f1d1d' : '#1a1a32',
        boxShadow: isProcessing ? '0 0 20px rgba(124,58,237,0.15)' : 'none',
      }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#1a1a32' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black"
            style={{
              background: isDone ? 'rgba(124,58,237,0.25)' : isProcessing ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.04)',
              color: isDone ? '#a78bfa' : isProcessing ? '#7c3aed' : '#4b5563',
            }}>
            {v.index + 1}
          </div>
          <span className="text-sm font-bold" style={{ color: isDone ? '#f0f0ff' : isProcessing ? '#a78bfa' : '#4b5563' }}>
            Variant {v.index + 1}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isProcessing && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: '#7c3aed' }}>
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              {v.ffmpegProgress > 0 && <span className="font-mono text-[10px]">{Math.round(v.ffmpegProgress * 100)}%</span>}
            </div>
          )}
          {isDone && <span className="text-xs font-bold" style={{ color: '#10b981' }}>✓ Done</span>}
          {isError && <span className="text-xs font-bold" style={{ color: '#ef4444' }}>✗ Error</span>}
          {v.status === 'pending' && <span className="text-xs" style={{ color: '#374151' }}>Waiting</span>}
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Remove"
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black transition-all hover:scale-110"
            style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)', flexShrink: 0 }}>✕</button>
        </div>
      </div>

      {/* Transforms */}
      {isDone && s && (
        <div className="px-3 py-3 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest px-1 mb-2" style={{ color: '#374151' }}>Applied Transformations</p>
          {s.vowb && <TransformRow icon="🤍" label="White background" value="VOWB Edit" color="#f1f5f9" />}
          {s.powb && <TransformRow icon="🤍" label="White background" value="POWB Edit" color="#f1f5f9" />}
          <TransformRow icon="✂️" label="Crop" value={`${s.cropPx}px each edge`} color="#94a3b8" />
          <TransformRow icon="📊" label="Bitrate" value={`${s.bitrate.toLocaleString()}k`} color="#94a3b8" />
          {s.zoomPct > 0 && <TransformRow icon="🔍" label="Zoom" value={`+${s.zoomPct.toFixed(2)}%`} color="#38bdf8" />}
          {Math.abs(s.hueDeg) > 0.05 && <TransformRow icon="🎨" label="Hue shift" value={`${s.hueDeg > 0 ? '+' : ''}${s.hueDeg.toFixed(1)}°`} color="#f472b6" />}
          {Math.abs(s.satDelta) > 0.05 && <TransformRow icon="🌈" label="Saturation" value={`${s.satDelta > 0 ? '+' : ''}${s.satDelta.toFixed(1)}%`} color="#fb923c" />}
          {s.pitchPct > 0.001 && <TransformRow icon="🔊" label="Audio pitch" value={`+${s.pitchPct.toFixed(3)}%`} color="#34d399" />}
          {s.speedPct > 0.001 && <TransformRow icon="⏩" label="Speed" value={`+${s.speedPct.toFixed(3)}%`} color="#fbbf24" />}
          {Math.abs(s.rotationDeg) > 0.01 && <TransformRow icon="🔄" label="Rotation" value={`${s.rotationDeg > 0 ? '+' : ''}${s.rotationDeg.toFixed(3)}°`} color="#c084fc" />}
          {s.mirror && <TransformRow icon="🪞" label="Mirror" value="Horizontal flip" color="#67e8f9" />}
          {s.warmth !== 'neutral' && (
            <TransformRow
              icon={s.warmth === 'warm' ? '🌅' : '🧊'}
              label={s.warmth === 'warm' ? 'Warm filter' : 'Cold filter'}
              value={`${s.warmthStrength.toFixed(1)}% intensity`}
              color={s.warmth === 'warm' ? '#fb923c' : '#67e8f9'}
            />
          )}
          {s.invisibleText && <TransformRow icon="👻" label="Ghost text" value="invisible micro-shift" color="#818cf8" />}
        </div>
      )}

      {isProcessing && (
        <div className="px-3 py-3 space-y-1.5">
          {[75, 55, 65, 50, 70].map((w, i) => (
            <div key={i} className="h-7 rounded-lg shimmer" style={{ width: `${w}%`, opacity: 0.25 }} />
          ))}
          {v.ffmpegProgress > 0 && (
            <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: '#1a1a32' }}>
              <div className="h-full rounded-full transition-all shimmer" style={{ width: `${v.ffmpegProgress * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {isError && <div className="px-4 py-3 text-xs" style={{ color: '#f87171' }}>{v.error ?? 'Processing failed'}</div>}

      {isDone && v.blobUrl && (
        <div className="px-3 pb-3 mt-1">
          <button onClick={onDownload}
            className="w-full flex items-center justify-center gap-2 text-sm font-bold py-2.5 rounded-xl"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: 'white' }}>
            ⬇ Download Variant {v.index + 1}
          </button>
        </div>
      )}
    </div>
  );
}

function ResultsSection({
  label, icon, variants, deletedIdxs, isProcessing,
  onDelete, onDownload, onDownloadAll, resultsRef,
}: {
  label: string; icon: string;
  variants: ClientVariant[]; deletedIdxs: Set<number>; isProcessing: boolean;
  onDelete: (idx: number) => void; onDownload: (v: ClientVariant) => void;
  onDownloadAll: () => void; resultsRef: React.RefObject<HTMLDivElement>;
}) {
  const visible = variants.filter((v) => !deletedIdxs.has(v.index));
  const total = variants.length;
  const doneCount = visible.filter((v) => v.status === 'done').length;
  const allDone = total > 0 && variants.every((v) => v.status === 'done' || v.status === 'error');
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  if (visible.length === 0) return null;

  return (
    <div ref={resultsRef} className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#374151' }}>
            {label}
            {doneCount > 0 && <span className="ml-2 font-black" style={{ color: '#7c3aed' }}>{doneCount}/{total}</span>}
          </p>
        </div>
        {doneCount > 1 && (
          <button onClick={onDownloadAll}
            className="text-xs px-3 py-1.5 rounded-xl font-semibold"
            style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa' }}>
            ⬇ Download All
          </button>
        )}
      </div>
      <div className="mb-4">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs font-medium" style={{ color: allDone ? '#10b981' : '#7c3aed' }}>
            {allDone ? `✅ ${doneCount} variant${doneCount !== 1 ? 's' : ''} ready`
              : isProcessing ? `Editing variant ${doneCount + 1} of ${total}...`
              : `${doneCount}/${total} done`}
          </span>
          <span className="text-xs font-bold tabular-nums" style={{ color: allDone ? '#10b981' : '#7c3aed' }}>{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1a32' }}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: allDone ? 'linear-gradient(90deg,#10b981,#34d399)' : 'linear-gradient(90deg,#7c3aed,#a78bfa)' }} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {visible.map((v) => (
          <VariantCard key={v.index} v={v} onDelete={() => onDelete(v.index)} onDownload={() => onDownload(v)} />
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [activeMode, setActiveMode] = useState<FileMode>('video');

  // ── Video state ──────────────────────────────────────────────────────────
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoVariants, setVideoVariants] = useState<ClientVariant[]>([]);
  const [videoDeletedIdxs, setVideoDeletedIdxs] = useState<Set<number>>(new Set());
  const [videoIsProcessing, setVideoIsProcessing] = useState(false);
  const [vowbMode, setVowbMode] = useState(false);

  // ── Photo state ──────────────────────────────────────────────────────────
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoVariants, setPhotoVariants] = useState<ClientVariant[]>([]);
  const [photoDeletedIdxs, setPhotoDeletedIdxs] = useState<Set<number>>(new Set());
  const [photoIsProcessing, setPhotoIsProcessing] = useState(false);
  const [powbMode, setPowbMode] = useState(false);

  // ── Shared ───────────────────────────────────────────────────────────────
  const [quality, setQuality] = useState<Quality>('max');
  const [variantCount, setVariantCount] = useState(3);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const [showMirrorModal, setShowMirrorModal] = useState(false);

  // One FFmpeg instance for videos — photos use Canvas API (no WASM needed)
  const ffVideoRef = useRef<import('@ffmpeg/ffmpeg').FFmpeg | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoResultsRef = useRef<HTMLDivElement>(null);
  const photoResultsRef = useRef<HTMLDivElement>(null);

  // Active-mode shortcuts
  const file = activeMode === 'video' ? videoFile : photoFile;
  const previewUrl = activeMode === 'video' ? videoPreviewUrl : photoPreviewUrl;
  const isProcessing = activeMode === 'video' ? videoIsProcessing : photoIsProcessing;
  const acceptAttr = activeMode === 'video'
    ? 'video/mp4,video/quicktime,video/x-msvideo,video/webm'
    : 'image/jpeg,image/png,image/webp';

  // Load both FFmpeg instances in parallel on mount
  useEffect(() => {
    async function init() {
      setFfmpegLoading(true);
      try {
        const { FFmpeg } = await import('@ffmpeg/ffmpeg');
        const { toBlobURL } = await import('@ffmpeg/util');
        const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
        // Fetch WASM files once, reuse for both instances
        const [coreURL, wasmURL] = await Promise.all([
          toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
          toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
        ]);
        const ff = new FFmpeg();
        await ff.load({ coreURL, wasmURL });
        ffVideoRef.current = ff;
        setFfmpegReady(true);
      } catch (e) {
        console.error('FFmpeg load failed', e);
        setError('Failed to load engine. Please refresh.');
      } finally {
        setFfmpegLoading(false);
      }
    }
    init();
  }, []);

  const handleFile = useCallback((f: File) => {
    const isVid = f.type.startsWith('video/');
    const isImg = f.type.startsWith('image/');
    if (!isVid && !isImg) { setError('Unsupported format.'); return; }
    if (activeMode === 'video' && !isVid) { setError('Please drop a video, or switch to Photo mode.'); return; }
    if (activeMode === 'photo' && !isImg) { setError('Please drop an image, or switch to Video mode.'); return; }
    setError(null);
    if (activeMode === 'video') {
      setVideoFile(f); setVideoVariants([]); setVideoDeletedIdxs(new Set());
      setVideoPreviewUrl(URL.createObjectURL(f));
    } else {
      setPhotoFile(f); setPhotoVariants([]); setPhotoDeletedIdxs(new Set());
      setPhotoPreviewUrl(URL.createObjectURL(f));
    }
  }, [activeMode]);

  // Switching mode never clears the other mode's state
  const switchMode = (mode: FileMode) => { setActiveMode(mode); setError(null); };

  const handleCreate = async (mirrorChoice?: boolean) => {
    const isImage = activeMode === 'photo';
    const currentFile = isImage ? photoFile : videoFile;
    const currentIsProcessing = isImage ? photoIsProcessing : videoIsProcessing;
    if (!currentFile || currentIsProcessing) return;
    if (!isImage && !ffmpegReady) return; // video needs FFmpeg

    const setVariants = isImage ? setPhotoVariants : setVideoVariants;
    const setDeletedIdxs = isImage ? setPhotoDeletedIdxs : setVideoDeletedIdxs;
    const setIsProcessing = isImage ? setPhotoIsProcessing : setVideoIsProcessing;
    const resultsRef = isImage ? photoResultsRef : videoResultsRef;

    setIsProcessing(true);
    setError(null);
    setDeletedIdxs(new Set());
    setVariants(Array.from({ length: variantCount }, (_, i) => ({
      index: i, status: 'pending', ffmpegProgress: 0, blobUrl: null, filename: null, summary: null,
    })));

    // ── PHOTO: Canvas API — no FFmpeg, no WASM, no crashes ──────────────────
    if (isImage) {
      for (let i = 0; i < variantCount; i++) {
        setVariants((prev) => prev.map((v) => v.index === i ? { ...v, status: 'processing' } : v));
        if (i === 0) setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        try {
          const params = generateParams(quality, false, powbMode, true);
          const outputName = `photo_v${i + 1}_${Math.random().toString(36).slice(2, 8)}.png`;
          const blob = await processImageWithCanvas(currentFile, params);
          setVariants((prev) => prev.map((v) =>
            v.index === i ? { ...v, status: 'done', blobUrl: URL.createObjectURL(blob), filename: outputName, summary: paramsToSummary(params), ffmpegProgress: 1 } : v
          ));
        } catch (err) {
          console.error(`Photo variant ${i} failed:`, err);
          setVariants((prev) => prev.map((v) =>
            v.index === i ? { ...v, status: 'error', error: String(err) } : v
          ));
        }
      }
      setIsProcessing(false);
      return;
    }

    // ── VIDEO: FFmpeg WASM ───────────────────────────────────────────────────
    const ff = ffVideoRef.current!;
    const ext = currentFile.name.split('.').pop()?.toLowerCase() ?? 'mp4';
    const inputName = `input_v.${ext}`;

    const { fetchFile } = await import('@ffmpeg/util');
    await ff.writeFile(inputName, await fetchFile(currentFile));

    for (let i = 0; i < variantCount; i++) {
      setVariants((prev) => prev.map((v) => v.index === i ? { ...v, status: 'processing' } : v));
      if (i === 0) setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      try {
        const params = generateParams(quality, vowbMode, false, false);
        // Apply user's mirror choice (confirmed via modal before processing)
        if (mirrorChoice !== undefined) params.mirror = mirrorChoice;
        const outputName = `video_v${i + 1}_${Math.random().toString(36).slice(2, 8)}.mp4`;
        const onProgress = ({ progress }: { progress: number }) => {
          setVariants((prev) => prev.map((v) => v.index === i ? { ...v, ffmpegProgress: Math.max(0, Math.min(1, progress)) } : v));
        };
        ff.on('progress', onProgress);
        await ff.exec(buildFFmpegArgs(inputName, outputName, params, false, true));
        ff.off('progress', onProgress);
        const raw = await ff.readFile(outputName);
        const blob = new Blob([raw as unknown as BlobPart], { type: 'video/mp4' });
        try { await ff.deleteFile(outputName); } catch { /* ok */ }
        setVariants((prev) => prev.map((v) =>
          v.index === i ? { ...v, status: 'done', blobUrl: URL.createObjectURL(blob), filename: outputName, summary: paramsToSummary(params), ffmpegProgress: 1 } : v
        ));
      } catch (err) {
        console.error(`Video variant ${i} failed:`, err);
        setVariants((prev) => prev.map((v) =>
          v.index === i ? { ...v, status: 'error', error: String(err) } : v
        ));
      }
    }
    try { await ff.deleteFile(inputName); } catch { /* ok */ }
    setIsProcessing(false);
  };

  const downloadVariant = (v: ClientVariant) => {
    if (!v.blobUrl || !v.filename) return;
    const a = document.createElement('a'); a.href = v.blobUrl; a.download = v.filename; a.click();
  };
  const downloadAll = (variants: ClientVariant[], deleted: Set<number>) =>
    variants.filter((v) => !deleted.has(v.index) && v.status === 'done' && v.blobUrl).forEach(downloadVariant);

  return (
    <div className="min-h-screen" style={{ background: '#030308' }}>
      <div className="fixed top-[-300px] left-[-300px] w-[700px] h-[700px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle,rgba(124,58,237,0.1) 0%,transparent 70%)' }} />
      <div className="fixed bottom-[-200px] right-[-200px] w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle,rgba(79,70,229,0.07) 0%,transparent 70%)' }} />

      <div className="relative z-10 max-w-2xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-black text-xl"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', boxShadow: '0 0 30px rgba(124,58,237,0.4)' }}>N</div>
            <span className="text-3xl font-black tracking-tight gradient-text">NEVRA EDITOR</span>
          </div>
          <p className="text-sm" style={{ color: '#4b5563' }}>
            Generate algorithmically unique variants · Bypass Meta's duplicate detection
          </p>
          <div className="mt-2 flex justify-center">
            {ffmpegLoading && (
              <span className="text-[11px] flex items-center gap-1.5" style={{ color: '#6b7280' }}>
                <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Loading engine...
              </span>
            )}
            {ffmpegReady && <span className="text-[11px]" style={{ color: '#10b981' }}>● Engine ready</span>}
          </div>
        </div>

        {/* Mode toggle — dots show activity on inactive tab */}
        <div className="flex justify-center mb-5">
          <div className="flex rounded-2xl p-1 gap-1" style={{ background: '#0d0d1e', border: '1px solid #1c1c3a' }}>
            {(['video', 'photo'] as FileMode[]).map((m) => {
              const sel = activeMode === m;
              const hasFile = m === 'video' ? !!videoFile : !!photoFile;
              const proc = m === 'video' ? videoIsProcessing : photoIsProcessing;
              return (
                <button key={m} onClick={() => switchMode(m)}
                  className="relative px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
                  style={{
                    background: sel ? 'linear-gradient(135deg,#7c3aed,#4f46e5)' : 'transparent',
                    color: sel ? 'white' : '#6b7280',
                    boxShadow: sel ? '0 2px 15px rgba(124,58,237,0.35)' : 'none',
                  }}>
                  {m === 'video' ? '🎬  Video' : '🖼️  Photo'}
                  {!sel && (hasFile || proc) && (
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                      style={{ background: proc ? '#f59e0b' : '#10b981' }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Drop zone */}
        <div
          className={`rounded-2xl border-2 border-dashed cursor-pointer mb-5 transition-all duration-200 ${isDragging ? 'drop-active' : ''}`}
          style={{ borderColor: file ? '#3d2b6e' : '#1a1a32', background: file ? 'rgba(124,58,237,0.04)' : '#09091a' }}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept={acceptAttr} className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />

          {file ? (
            <div className="p-4 flex items-center gap-4">
              {previewUrl && activeMode === 'video' && (
                <video src={previewUrl} className="w-20 h-14 rounded-xl object-cover flex-shrink-0 border" style={{ borderColor: '#2d1b69' }} muted playsInline />
              )}
              {previewUrl && activeMode === 'photo' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="" className="w-20 h-14 rounded-xl object-cover flex-shrink-0 border" style={{ borderColor: '#2d1b69' }} />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: '#e2e8f0' }}>{file.name}</p>
                <p className="text-xs mt-0.5" style={{ color: '#4b5563' }}>
                  {activeMode === 'video' ? '🎬 Video' : '🖼️ Photo'} · {fmtBytes(file.size)}
                </p>
              </div>
              <button onClick={(e) => {
                e.stopPropagation();
                if (activeMode === 'video') { setVideoFile(null); setVideoPreviewUrl(null); setVideoVariants([]); }
                else { setPhotoFile(null); setPhotoPreviewUrl(null); setPhotoVariants([]); }
              }} className="text-xs px-3 py-1.5 rounded-lg border shrink-0"
                style={{ borderColor: '#2d2d5a', color: '#6b7280' }}>Change</button>
            </div>
          ) : (
            <div className="py-12 flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                style={{ background: '#0e0e22', border: '1px solid #1a1a32' }}>
                {isDragging ? '✨' : activeMode === 'video' ? '🎬' : '🖼️'}
              </div>
              <div className="text-center">
                <p className="font-semibold" style={{ color: '#d1d5db' }}>Drop your {activeMode === 'video' ? 'video' : 'photo'} here</p>
                <p className="text-sm mt-1" style={{ color: '#374151' }}>
                  {activeMode === 'video' ? 'MP4 · MOV · AVI · WEBM' : 'JPG · PNG · WEBP'} · Max 500MB
                </p>
              </div>
            </div>
          )}
        </div>

        {/* VOWB toggle — video mode only */}
        {activeMode === 'video' && (
          <div className="mb-5">
            <button onClick={() => setVowbMode((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-2xl border transition-all duration-200"
              style={{
                background: vowbMode ? 'rgba(255,255,255,0.05)' : '#09091a',
                borderColor: vowbMode ? 'rgba(255,255,255,0.3)' : '#1a1a32',
                boxShadow: vowbMode ? '0 0 20px rgba(255,255,255,0.08)' : 'none',
              }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{ background: vowbMode ? 'white' : '#0f0f25', border: `1px solid ${vowbMode ? 'white' : '#2d2d5a'}` }}>🤍</div>
                <div className="text-left">
                  <p className="text-sm font-bold" style={{ color: vowbMode ? 'white' : '#9ca3af' }}>VOWB Edit</p>
                  <p className="text-[11px]" style={{ color: vowbMode ? '#d1d5db' : '#374151' }}>Video on white background · caption space at bottom</p>
                </div>
              </div>
              <div className="relative w-11 h-6 rounded-full flex-shrink-0 transition-all duration-200" style={{ background: vowbMode ? 'white' : '#1a1a32' }}>
                <div className="absolute top-0.5 w-5 h-5 rounded-full shadow transition-all duration-200"
                  style={{ background: vowbMode ? '#7c3aed' : '#4b5563', left: vowbMode ? '22px' : '2px' }} />
              </div>
            </button>
          </div>
        )}

        {/* POWB toggle — photo mode only */}
        {activeMode === 'photo' && (
          <div className="mb-5">
            <button onClick={() => setPowbMode((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-2xl border transition-all duration-200"
              style={{
                background: powbMode ? 'rgba(255,255,255,0.05)' : '#09091a',
                borderColor: powbMode ? 'rgba(255,255,255,0.3)' : '#1a1a32',
                boxShadow: powbMode ? '0 0 20px rgba(255,255,255,0.08)' : 'none',
              }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{ background: powbMode ? 'white' : '#0f0f25', border: `1px solid ${powbMode ? 'white' : '#2d2d5a'}` }}>🤍</div>
                <div className="text-left">
                  <p className="text-sm font-bold" style={{ color: powbMode ? 'white' : '#9ca3af' }}>POWB Edit</p>
                  <p className="text-[11px]" style={{ color: powbMode ? '#d1d5db' : '#374151' }}>Picture on white background · caption space at bottom</p>
                </div>
              </div>
              <div className="relative w-11 h-6 rounded-full flex-shrink-0 transition-all duration-200" style={{ background: powbMode ? 'white' : '#1a1a32' }}>
                <div className="absolute top-0.5 w-5 h-5 rounded-full shadow transition-all duration-200"
                  style={{ background: powbMode ? '#7c3aed' : '#4b5563', left: powbMode ? '22px' : '2px' }} />
              </div>
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Quality */}
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#374151' }}>Quality</p>
          <div className="grid grid-cols-3 gap-2.5">
            {(Object.keys(QUALITY_CONFIG) as Quality[]).map((q) => {
              const cfg = QUALITY_CONFIG[q];
              const sel = quality === q;
              return (
                <button key={q} onClick={() => setQuality(q)}
                  className="relative rounded-xl border p-4 text-left transition-all duration-200"
                  style={{
                    borderColor: sel ? cfg.color : '#1a1a32',
                    background: sel ? `rgba(${cfg.rgb},0.07)` : '#09091a',
                    boxShadow: sel ? `0 0 18px ${cfg.glow}` : 'none',
                  }}>
                  {sel && <div className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />}
                  <p className="font-black text-sm mb-0.5" style={{ color: sel ? cfg.color : '#9ca3af' }}>{cfg.label}</p>
                  <p className="text-[10px] font-medium mb-1.5" style={{ color: sel ? cfg.color : '#374151', opacity: 0.85 }}>{cfg.speed}</p>
                  <p className="text-[10px] leading-relaxed" style={{ color: '#374151' }}>
                    {activeMode === 'photo' ? cfg.descPhoto : cfg.descVideo}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Variants */}
        <div className="mb-7">
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#374151' }}>Variants</p>
          <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: '#09091a', border: '1px solid #1a1a32' }}>
            <button onClick={() => setVariantCount((v) => Math.max(1, v - 1))}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold flex-shrink-0"
              style={{ background: '#0f0f25', border: '1px solid #2d2d5a', color: '#9ca3af' }}>−</button>
            <div className="flex-1 flex items-center justify-center gap-3">
              <input type="number" min={1} max={50} value={variantCount}
                onChange={(e) => { const n = parseInt(e.target.value); if (!isNaN(n)) setVariantCount(Math.min(50, Math.max(1, n))); }}
                className="text-3xl font-black text-center bg-transparent border-none outline-none w-16 gradient-text"
                style={{ fontFamily: 'Inter,sans-serif' }} />
              <span className="text-sm" style={{ color: '#374151' }}>unique variant{variantCount !== 1 ? 's' : ''}</span>
            </div>
            <button onClick={() => setVariantCount((v) => Math.min(50, v + 1))}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold flex-shrink-0"
              style={{ background: '#0f0f25', border: '1px solid #2d2d5a', color: '#9ca3af' }}>+</button>
          </div>
        </div>

        {/* Create button */}
        <button
          className="btn-gradient w-full py-4 rounded-2xl font-bold text-base text-white tracking-widest uppercase"
          disabled={!file || (activeMode === 'video' && !ffmpegReady) || isProcessing}
          onClick={() => activeMode === 'video' ? setShowMirrorModal(true) : handleCreate()}
        >
          {isProcessing ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Editing in browser...
            </span>
          ) : (activeMode === 'video' && !ffmpegReady) ? 'Loading engine...'
            : `⚡  Create ${variantCount} Variant${variantCount !== 1 ? 's' : ''}`}
        </button>

        {/* Results — both modes shown independently, always visible */}
        <ResultsSection
          label="Video Results" icon="🎬"
          variants={videoVariants} deletedIdxs={videoDeletedIdxs} isProcessing={videoIsProcessing}
          onDelete={(idx) => setVideoDeletedIdxs((p) => new Set([...p, idx]))}
          onDownload={downloadVariant}
          onDownloadAll={() => downloadAll(videoVariants, videoDeletedIdxs)}
          resultsRef={videoResultsRef}
        />
        <ResultsSection
          label="Photo Results" icon="🖼️"
          variants={photoVariants} deletedIdxs={photoDeletedIdxs} isProcessing={photoIsProcessing}
          onDelete={(idx) => setPhotoDeletedIdxs((p) => new Set([...p, idx]))}
          onDownload={downloadVariant}
          onDownloadAll={() => downloadAll(photoVariants, photoDeletedIdxs)}
          resultsRef={photoResultsRef}
        />

        <p className="text-center mt-10 text-xs" style={{ color: '#1f2937' }}>
          Nevra Editor · Processing runs entirely in your browser
        </p>
      </div>

      {/* Mirror modal — video only, shown before processing starts */}
      {showMirrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
          <div className="w-full max-w-sm rounded-2xl border overflow-hidden"
            style={{ background: '#0c0c1e', borderColor: '#2d2d5a', boxShadow: '0 0 60px rgba(124,58,237,0.3)' }}>
            {/* Header */}
            <div className="px-6 pt-6 pb-4">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4"
                style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}>🪞</div>
              <p className="text-lg font-black text-center" style={{ color: '#f0f0ff' }}>Effet miroir ?</p>
              <p className="text-sm text-center mt-2" style={{ color: '#6b7280' }}>
                Appliquer le miroir horizontal sur les variantes ?<br />
                <span style={{ color: '#4b5563', fontSize: '11px' }}>
                  Désactiver si la vidéo contient du texte visible.
                </span>
              </p>
            </div>
            {/* Buttons */}
            <div className="px-6 pb-6 grid grid-cols-2 gap-3">
              <button
                onClick={() => { setShowMirrorModal(false); handleCreate(false); }}
                className="py-3 rounded-xl font-bold text-sm transition-all"
                style={{ background: '#0f0f25', border: '1px solid #2d2d5a', color: '#9ca3af' }}>
                ❌ Non, sans miroir
              </button>
              <button
                onClick={() => { setShowMirrorModal(false); handleCreate(true); }}
                className="py-3 rounded-xl font-bold text-sm transition-all"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: 'white', boxShadow: '0 0 20px rgba(124,58,237,0.35)' }}>
                🪞 Oui, mirror
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
