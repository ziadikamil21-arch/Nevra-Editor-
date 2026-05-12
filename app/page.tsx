'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { TransformSummary } from '@/lib/processor';

type Quality = 'normal' | 'max' | 'pro';
type FileMode = 'video' | 'photo';

interface VariantResult {
  index: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  filename: string | null;
  summary: TransformSummary | null;
  error?: string;
}

interface JobPoll {
  status: string;
  progress: number;
  total: number;
  isImage: boolean;
  variants: VariantResult[];
}

const QUALITY_CONFIG = {
  normal: { label: 'Normal', speed: 'Ultra Fast', desc: 'Crop · Bitrate · Metadata', color: '#10b981', rgb: '16,185,129', glow: 'rgba(16,185,129,0.2)' },
  max:    { label: 'Max',    speed: '~12s / variant', desc: 'Pitch · Zoom · Hue · Color', color: '#f59e0b', rgb: '245,158,11', glow: 'rgba(245,158,11,0.2)' },
  pro:    { label: 'Pro',    speed: 'Premium',  desc: 'Rotation · Speed · Ghost text', color: '#a78bfa', rgb: '124,58,237', glow: 'rgba(124,58,237,0.25)' },
} as const;

function fmtBytes(b: number) {
  return b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

function TransformRow({ icon, label, value, highlight }: { icon: string; label: string; value: string; highlight?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded-lg"
      style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="flex items-center gap-2">
        <span className="text-sm w-5 text-center">{icon}</span>
        <span className="text-xs" style={{ color: '#9ca3af' }}>{label}</span>
      </div>
      <span className="text-xs font-bold font-mono" style={{ color: highlight ?? '#e2e8f0' }}>{value}</span>
    </div>
  );
}

function VariantCard({ v, jobId, quality, onDelete }: { v: VariantResult; jobId: string; quality: Quality; onDelete: () => void }) {
  const s = v.summary;
  const isDone = v.status === 'done';
  const isProcessing = v.status === 'processing';
  const isError = v.status === 'error';

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-all duration-300"
      style={{
        background: '#0c0c1e',
        borderColor: isDone ? '#2d2d5a' : isProcessing ? '#7c3aed' : isError ? '#7f1d1d' : '#1a1a32',
        boxShadow: isDone ? '0 4px 30px rgba(124,58,237,0.08)' : isProcessing ? '0 0 20px rgba(124,58,237,0.15)' : 'none',
      }}
    >
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#1a1a32' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0"
            style={{
              background: isDone ? 'rgba(124,58,237,0.25)' : isProcessing ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.05)',
              color: isDone ? '#a78bfa' : isProcessing ? '#7c3aed' : '#4b5563',
            }}>
            {v.index + 1}
          </div>
          <span className="text-sm font-bold" style={{ color: isDone ? '#f0f0ff' : isProcessing ? '#a78bfa' : '#4b5563' }}>
            Variant {v.index + 1}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {isProcessing && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: '#7c3aed' }}>
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              <span className="font-medium">Editing...</span>
            </div>
          )}
          {isDone && <span className="text-xs font-bold" style={{ color: '#10b981' }}>✓ Done</span>}
          {isError && <span className="text-xs font-bold" style={{ color: '#ef4444' }}>✗ Failed</span>}
          {v.status === 'pending' && <span className="text-xs" style={{ color: '#374151' }}>Waiting</span>}
          {/* Delete button — always visible */}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Remove variant"
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ml-1 transition-all hover:scale-110"
            style={{ background: 'rgba(239,68,68,0.18)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', flexShrink: 0 }}
          >✕</button>
        </div>
      </div>

      {/* Transformations — only shown after processing */}
      {isDone && s && (
        <div className="px-3 py-3 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest px-1 mb-2" style={{ color: '#4b5563' }}>
            Applied transformations
          </p>

          <TransformRow icon="✂️" label="Crop" value={`${s.cropPx}px each edge`} highlight="#94a3b8" />
          <TransformRow icon="📊" label="Bitrate" value={`${s.bitrate.toLocaleString()}k`} highlight="#94a3b8" />

          {s.zoomPct > 0 && (
            <TransformRow icon="🔍" label="Zoom" value={`+${s.zoomPct.toFixed(2)}%`} highlight="#38bdf8" />
          )}
          {Math.abs(s.hueDeg) > 0.05 && (
            <TransformRow icon="🎨" label="Hue shift" value={`${s.hueDeg > 0 ? '+' : ''}${s.hueDeg.toFixed(1)}°`} highlight="#f472b6" />
          )}
          {Math.abs(s.satDelta) > 0.05 && (
            <TransformRow icon="🌈" label="Saturation" value={`${s.satDelta > 0 ? '+' : ''}${s.satDelta.toFixed(1)}%`} highlight="#fb923c" />
          )}
          {s.pitchPct > 0.001 && (
            <TransformRow icon="🔊" label="Audio pitch" value={`+${s.pitchPct.toFixed(3)}%`} highlight="#34d399" />
          )}
          {s.speedPct > 0.001 && (
            <TransformRow icon="⏩" label="Speed" value={`+${s.speedPct.toFixed(3)}%`} highlight="#fbbf24" />
          )}
          {Math.abs(s.rotationDeg) > 0.01 && (
            <TransformRow icon="🔄" label="Rotation" value={`${s.rotationDeg > 0 ? '+' : ''}${s.rotationDeg.toFixed(3)}°`} highlight="#c084fc" />
          )}
          {s.invisibleText && (
            <TransformRow icon="👻" label="Ghost text" value="1px · α 2%" highlight="#818cf8" />
          )}
        </div>
      )}

      {/* Processing skeleton */}
      {isProcessing && (
        <div className="px-3 py-3 space-y-1.5">
          {[80, 60, 70, 55].map((w, i) => (
            <div key={i} className="h-7 rounded-lg shimmer" style={{ width: `${w}%`, opacity: 0.3 }} />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="px-4 py-3 text-xs" style={{ color: '#f87171' }}>
          {v.error ?? 'Processing failed'}
        </div>
      )}

      {/* Download button */}
      {isDone && (
        <div className="px-3 pb-3 mt-1">
          <a
            href={`/api/download?jobId=${jobId}&index=${v.index}`}
            download={v.filename ?? `variant_${v.index + 1}.mp4`}
            className="flex items-center justify-center gap-2 text-sm font-bold py-2.5 rounded-xl transition-all"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: 'white' }}
          >
            <span>⬇</span>
            <span>Download Variant {v.index + 1}</span>
          </a>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [fileMode, setFileMode] = useState<FileMode>('video');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>('max');
  const [variants, setVariants] = useState(3);
  const [isDragging, setIsDragging] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [deletedIdxs, setDeletedIdxs] = useState<Set<number>>(new Set());
  const [jobData, setJobData] = useState<JobPoll | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const acceptAttr = fileMode === 'video'
    ? 'video/mp4,video/quicktime,video/x-msvideo,video/webm'
    : 'image/jpeg,image/png,image/webp';

  const handleFile = useCallback((f: File) => {
    const isVid = f.type.startsWith('video/');
    const isImg = f.type.startsWith('image/');
    if (!isVid && !isImg) { setError('Unsupported format.'); return; }
    if (fileMode === 'video' && !isVid) { setError('Switch to Photo mode to use an image.'); return; }
    if (fileMode === 'photo' && !isImg) { setError('Switch to Video mode to use a video.'); return; }
    setFile(f);
    setError(null);
    setJobId(null);
    setJobData(null);
    setPreviewUrl(URL.createObjectURL(f));
  }, [fileMode]);

  const switchMode = (mode: FileMode) => {
    setFileMode(mode);
    setFile(null);
    setPreviewUrl(null);
    setJobId(null);
    setJobData(null);
    setError(null);
    setDeletedIdxs(new Set());
  };

  const startPolling = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/status?jobId=${id}`);
        if (!res.ok) return;
        const data: JobPoll = await res.json();
        setJobData(data);
        if (data.status === 'done' || data.status === 'error') {
          clearInterval(pollRef.current!);
        }
      } catch { /* ignore */ }
    }, 700);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Auto-scroll to results when they start appearing
  useEffect(() => {
    if (jobData && jobData.progress > 0 && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [jobData?.progress]);

  const handleCreate = async () => {
    if (!file) return;
    setIsSubmitting(true);
    setError(null);
    setJobData(null);
    setJobId(null);
    setDeletedIdxs(new Set());

    const form = new FormData();
    form.append('file', file);
    form.append('quality', quality);
    form.append('variants', String(variants));

    try {
      const res = await fetch('/api/process', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Server error');
      setJobId(data.jobId);
      startPolling(data.jobId);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isProcessing = !!jobId && !!jobData && jobData.status === 'processing';
  const isDone = jobData?.status === 'done';
  const activeVariants = (jobData?.variants ?? []).filter((v) => !deletedIdxs.has(v.index));
  const doneCount = activeVariants.filter((v) => v.status === 'done').length;
  const progressPct = jobData ? Math.round((jobData.progress / jobData.total) * 100) : 0;

  return (
    <div className="min-h-screen" style={{ background: '#030308' }}>
      {/* Ambient glow */}
      <div className="fixed top-[-300px] left-[-300px] w-[700px] h-[700px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)' }} />
      <div className="fixed bottom-[-200px] right-[-200px] w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(79,70,229,0.08) 0%, transparent 70%)' }} />

      <div className="relative z-10 max-w-2xl mx-auto px-4 py-10">

        {/* ── Header ── */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', boxShadow: '0 0 30px rgba(124,58,237,0.4)' }}>N</div>
            <span className="text-3xl font-black tracking-tight gradient-text">NEVRA EDITOR</span>
          </div>
          <p className="text-sm" style={{ color: '#4b5563' }}>
            Generate algorithmically unique variants to bypass Meta's duplicate detection
          </p>
        </div>

        {/* ── Mode toggle ── */}
        <div className="flex justify-center mb-5">
          <div className="flex rounded-2xl p-1 gap-1" style={{ background: '#0d0d1e', border: '1px solid #1c1c3a' }}>
            {(['video', 'photo'] as FileMode[]).map((m) => {
              const sel = fileMode === m;
              return (
                <button key={m} onClick={() => switchMode(m)}
                  className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
                  style={{
                    background: sel ? 'linear-gradient(135deg,#7c3aed,#4f46e5)' : 'transparent',
                    color: sel ? 'white' : '#6b7280',
                    boxShadow: sel ? '0 2px 15px rgba(124,58,237,0.35)' : 'none',
                  }}>
                  {m === 'video' ? '🎬  Video' : '🖼️  Photo'}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Drop zone ── */}
        <div
          className={`rounded-2xl border-2 border-dashed cursor-pointer mb-5 transition-all duration-200 ${isDragging ? 'drop-active' : ''}`}
          style={{ borderColor: file ? '#3d2b6e' : '#1a1a32', background: file ? 'rgba(124,58,237,0.04)' : '#09091a' }}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept={acceptAttr} className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

          {file ? (
            <div className="p-4 flex items-center gap-4">
              {previewUrl && fileMode === 'video' && (
                <video src={previewUrl} className="w-20 h-14 rounded-xl object-cover flex-shrink-0 border" style={{ borderColor: '#2d1b69' }} muted playsInline />
              )}
              {previewUrl && fileMode === 'photo' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="" className="w-20 h-14 rounded-xl object-cover flex-shrink-0 border" style={{ borderColor: '#2d1b69' }} />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: '#e2e8f0' }}>{file.name}</p>
                <p className="text-xs mt-0.5" style={{ color: '#4b5563' }}>
                  {fileMode === 'video' ? '🎬 Video' : '🖼️ Photo'} · {fmtBytes(file.size)}
                </p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setFile(null); setPreviewUrl(null); setJobId(null); setJobData(null); }}
                className="text-xs px-3 py-1.5 rounded-lg border shrink-0"
                style={{ borderColor: '#2d2d5a', color: '#6b7280' }}>
                Change
              </button>
            </div>
          ) : (
            <div className="py-12 flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                style={{ background: '#0e0e22', border: '1px solid #1a1a32' }}>
                {isDragging ? '✨' : fileMode === 'video' ? '🎬' : '🖼️'}
              </div>
              <div className="text-center">
                <p className="font-semibold" style={{ color: '#d1d5db' }}>
                  Drop your {fileMode === 'video' ? 'video' : 'photo'} here
                </p>
                <p className="text-sm mt-1" style={{ color: '#374151' }}>
                  {fileMode === 'video' ? 'MP4 · MOV · AVI · WEBM' : 'JPG · PNG · WEBP'} · Max 500MB
                </p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}>
            ⚠️ {error}
          </div>
        )}

        {/* ── Quality ── */}
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
                  <p className="text-[10px] font-medium mb-1.5" style={{ color: sel ? cfg.color : '#374151', opacity: 0.8 }}>{cfg.speed}</p>
                  <p className="text-[10px] leading-relaxed" style={{ color: '#374151' }}>{cfg.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Variants ── */}
        <div className="mb-7">
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#374151' }}>Variants</p>
          <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: '#09091a', border: '1px solid #1a1a32' }}>
            <button onClick={() => setVariants((v) => Math.max(1, v - 1))}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold transition-all flex-shrink-0"
              style={{ background: '#0f0f25', border: '1px solid #2d2d5a', color: '#9ca3af' }}>−</button>

            <div className="flex-1 flex items-center justify-center gap-3">
              <input type="number" min={1} max={50} value={variants}
                onChange={(e) => { const n = parseInt(e.target.value); if (!isNaN(n)) setVariants(Math.min(50, Math.max(1, n))); }}
                className="text-3xl font-black text-center bg-transparent border-none outline-none w-16 gradient-text"
                style={{ fontFamily: 'Inter,sans-serif' }} />
              <span className="text-sm" style={{ color: '#374151' }}>
                unique variant{variants !== 1 ? 's' : ''} will be generated
              </span>
            </div>

            <button onClick={() => setVariants((v) => Math.min(50, v + 1))}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold transition-all flex-shrink-0"
              style={{ background: '#0f0f25', border: '1px solid #2d2d5a', color: '#9ca3af' }}>+</button>
          </div>
        </div>

        {/* ── Create button ── */}
        <button
          className="btn-gradient w-full py-4 rounded-2xl font-bold text-base text-white tracking-widest uppercase"
          disabled={!file || isSubmitting || isProcessing}
          onClick={handleCreate}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg> Uploading...
            </span>
          ) : isProcessing ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg> Generating...
            </span>
          ) : `⚡  Create ${variants} Variant${variants !== 1 ? 's' : ''}`}
        </button>

        {/* ── Progress bar ── */}
        {jobData && activeVariants.length > 0 && (
          <div className="mt-5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-medium" style={{ color: isDone ? '#10b981' : '#7c3aed' }}>
                {isDone ? `✅ ${doneCount} variant${doneCount !== 1 ? 's' : ''} generated` : `Editing variant ${jobData.progress + 1} / ${jobData.total}...`}
              </span>
              <span className="text-xs font-bold tabular-nums" style={{ color: isDone ? '#10b981' : '#7c3aed' }}>{progressPct}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1a32' }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%`, background: isDone ? 'linear-gradient(90deg,#10b981,#34d399)' : 'linear-gradient(90deg,#7c3aed,#a78bfa)' }} />
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {activeVariants.length > 0 && (
          <div ref={resultsRef} className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#374151' }}>
                Results
                {doneCount > 0 && <span className="ml-2 font-black" style={{ color: '#7c3aed' }}>{doneCount}/{activeVariants.length}</span>}
              </p>
              {doneCount > 1 && jobId && (
                <a href={`/api/zip?jobId=${jobId}`}
                  className="text-xs px-3 py-1.5 rounded-xl font-semibold transition-all"
                  style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa' }}>
                  ⬇ Download All (.zip)
                </a>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {activeVariants.map((v) => (
                <VariantCard
                  key={v.index}
                  v={v}
                  jobId={jobId!}
                  quality={quality}
                  onDelete={() => setDeletedIdxs((prev) => new Set([...prev, v.index]))}
                />
              ))}
            </div>
          </div>
        )}

        <p className="text-center mt-10 text-xs" style={{ color: '#1f2937' }}>
          Nevra Editor · Every variant is algorithmically unique
        </p>
      </div>
    </div>
  );
}
