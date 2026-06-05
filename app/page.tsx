'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  generateParams, paramsToSummary, buildFFmpegArgs,
  type Quality, type ClientVariant,
} from '@/lib/client-processor';
import { processImageWithCanvas } from '@/lib/canvas-image-processor';
import {
  loadFolders, createFolder, renameFolder, deleteFolder,
  getVariantsByFolder, saveVariant, deleteVariant,
  type NevraFolder, type NevraVariant,
} from '@/lib/storage';
import type { ClipSegment, YTInfo } from '@/lib/yt-analyzer';

type FileMode = 'video' | 'photo' | 'youtube';

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
function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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

function VariantCard({ v, onDelete, onDownload, savedToFolder }: {
  v: ClientVariant; onDelete: () => void; onDownload: () => void; savedToFolder?: boolean;
}) {
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
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#1a1a32' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black"
            style={{ background: isDone ? 'rgba(124,58,237,0.25)' : isProcessing ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.04)', color: isDone ? '#a78bfa' : isProcessing ? '#7c3aed' : '#4b5563' }}>
            {v.index + 1}
          </div>
          <span className="text-sm font-bold" style={{ color: isDone ? '#f0f0ff' : isProcessing ? '#a78bfa' : '#4b5563' }}>
            Variant {v.index + 1}
          </span>
          {savedToFolder && isDone && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
              📁 Saved
            </span>
          )}
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
            <TransformRow icon={s.warmth === 'warm' ? '🌅' : '🧊'} label={s.warmth === 'warm' ? 'Warm filter' : 'Cold filter'} value={`${s.warmthStrength.toFixed(1)}% intensity`} color={s.warmth === 'warm' ? '#fb923c' : '#67e8f9'} />
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
          <button onClick={onDownload} className="w-full flex items-center justify-center gap-2 text-sm font-bold py-2.5 rounded-xl"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: 'white' }}>
            ⬇ Download Variant {v.index + 1}
          </button>
        </div>
      )}
    </div>
  );
}

// ── YouTube Clip Card ──────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-[10px] px-2 py-0.5 rounded-md font-bold transition-all flex-shrink-0"
      style={{ background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(124,58,237,0.12)', color: copied ? '#10b981' : '#a78bfa', border: `1px solid ${copied ? 'rgba(16,185,129,0.3)' : 'rgba(124,58,237,0.3)'}` }}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function YTClipCard({ clip, blobUrl, isProcessing, onDownload }: {
  clip: ClipSegment; blobUrl: string | null; isProcessing: boolean; onDownload: () => void;
}) {
  const [showInstructions, setShowInstructions] = useState(false);
  const stars = clip.score >= 10 ? '⭐⭐⭐⭐⭐' : clip.score >= 7 ? '⭐⭐⭐⭐' : clip.score >= 4 ? '⭐⭐⭐' : clip.score >= 2 ? '⭐⭐' : '⭐';
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: '#0c0c1e', borderColor: blobUrl ? '#2d2d5a' : '#1a1a32' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#1a1a32' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black"
            style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa' }}>{clip.index + 1}</div>
          <div>
            <p className="text-sm font-bold" style={{ color: '#f0f0ff' }}>
              {fmtTime(clip.start)} → {fmtTime(clip.end)}
              <span className="ml-2 text-xs font-normal" style={{ color: '#4b5563' }}>{clip.duration.toFixed(0)}s</span>
            </p>
            <p className="text-[10px]" style={{ color: '#374151' }}>{stars} Engagement score</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isProcessing && (
            <div className="flex items-center gap-1" style={{ color: '#7c3aed' }}>
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              <span className="text-xs">Cutting...</span>
            </div>
          )}
          {blobUrl && <span className="text-xs font-bold" style={{ color: '#10b981' }}>✓ Ready</span>}
        </div>
      </div>

      {/* TikTok instructions toggle */}
      <button onClick={() => setShowInstructions(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-all"
        style={{ background: 'rgba(124,58,237,0.04)', borderBottom: showInstructions ? '1px solid #1a1a32' : 'none' }}>
        <span className="text-xs font-bold" style={{ color: '#a78bfa' }}>📱 TikTok Strategy</span>
        <span className="text-xs" style={{ color: '#374151' }}>{showInstructions ? '▲' : '▼'}</span>
      </button>

      {showInstructions && (
        <div className="px-4 py-3 space-y-3">
          {/* Hook */}
          <div className="rounded-xl p-3" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)' }}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#fbbf24' }}>🪝 Hook — First 3 seconds (big text overlay)</p>
              <CopyButton text={clip.hook} />
            </div>
            <p className="text-sm font-bold" style={{ color: '#f0f0ff' }}>"{clip.hook}"</p>
            <p className="text-[10px] mt-1" style={{ color: '#6b7280' }}>Position: <strong style={{color:'#d1d5db'}}>{clip.textPlacement.toUpperCase()}</strong> of screen · Bold white · Black outline</p>
          </div>

          {/* Caption */}
          <div className="rounded-xl p-3" style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)' }}>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#a78bfa' }}>📝 Full Caption (paste in TikTok description)</p>
              <CopyButton text={clip.caption} />
            </div>
            <p className="text-xs leading-relaxed whitespace-pre-line" style={{ color: '#9ca3af' }}>{clip.caption}</p>
          </div>

          {/* Hashtags */}
          <div className="rounded-xl p-3" style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)' }}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#10b981' }}>#️⃣ Hashtags</p>
              <CopyButton text={clip.hashtags} />
            </div>
            <p className="text-xs" style={{ color: '#6b7280' }}>{clip.hashtags}</p>
          </div>

          {/* Call to action */}
          <div className="rounded-xl p-3" style={{ background: 'rgba(251,146,60,0.05)', border: '1px solid rgba(251,146,60,0.15)' }}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#fb923c' }}>🎯 Call to Action (end of clip)</p>
              <CopyButton text={clip.callToAction} />
            </div>
            <p className="text-sm font-bold" style={{ color: '#f0f0ff' }}>"{clip.callToAction}"</p>
          </div>

          {/* Checklist */}
          <div className="rounded-xl p-3 space-y-1.5" style={{ background: '#09091a', border: '1px solid #1a1a32' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#374151' }}>✅ Before posting checklist</p>
            {clip.checklist.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-xs mt-0.5 flex-shrink-0" style={{ color: '#4b5563' }}>☐</span>
                <span className="text-xs leading-relaxed" style={{ color: '#6b7280' }}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Download */}
      {blobUrl && (
        <div className="px-3 pb-3 pt-2">
          <button onClick={onDownload} className="w-full flex items-center justify-center gap-2 text-sm font-bold py-2.5 rounded-xl"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: 'white' }}>
            ⬇ Download Clip {clip.index + 1}
          </button>
        </div>
      )}
    </div>
  );
}

function ResultsSection({ label, icon, variants, deletedIdxs, isProcessing, currentFolder, onDelete, onDownload, onDownloadAll, resultsRef }: {
  label: string; icon: string; variants: ClientVariant[]; deletedIdxs: Set<number>;
  isProcessing: boolean; currentFolder: NevraFolder | null;
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
            {label}{doneCount > 0 && <span className="ml-2 font-black" style={{ color: '#7c3aed' }}>{doneCount}/{total}</span>}
          </p>
          {currentFolder && (
            <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold" style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.25)' }}>
              📁 {currentFolder.name}
            </span>
          )}
        </div>
        {doneCount > 1 && (
          <button onClick={onDownloadAll} className="text-xs px-3 py-1.5 rounded-xl font-semibold"
            style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa' }}>
            ⬇ Download All
          </button>
        )}
      </div>
      <div className="mb-4">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs font-medium" style={{ color: allDone ? '#10b981' : '#7c3aed' }}>
            {allDone ? `✅ ${doneCount} variant${doneCount !== 1 ? 's' : ''} ready${currentFolder ? ` · saved to 📁 ${currentFolder.name}` : ''}`
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
          <VariantCard key={v.index} v={v} savedToFolder={!!currentFolder && v.status === 'done'}
            onDelete={() => onDelete(v.index)} onDownload={() => onDownload(v)} />
        ))}
      </div>
    </div>
  );
}

// ── Folder Browser ─────────────────────────────────────────────────────────────
function FolderBrowser({ folders, onClose, onFoldersChange }: {
  folders: NevraFolder[];
  onClose: () => void;
  onFoldersChange: (folders: NevraFolder[]) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<'all' | 'video' | 'photo'>('all');
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [folderVariants, setFolderVariants] = useState<NevraVariant[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [variantCounts, setVariantCounts] = useState<Record<string, number>>({});
  const blobUrlsRef = useRef<string[]>([]);
  // Inline create-folder form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState<'video' | 'photo'>('video');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    // Load variant counts for all folders
    Promise.all(
      folders.map(async (f) => {
        const vs = await getVariantsByFolder(f.id);
        return [f.id, vs.length] as [string, number];
      })
    ).then((pairs) => setVariantCounts(Object.fromEntries(pairs)));
  }, [folders]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => { blobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  const openFolder = async (folderId: string) => {
    setLoadingVariants(true);
    setOpenFolderId(folderId);
    const vs = await getVariantsByFolder(folderId);
    setFolderVariants(vs);
    setLoadingVariants(false);
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm('Delete this folder and all its variants?')) return;
    await deleteFolder(folderId);
    const updated = folders.filter((f) => f.id !== folderId);
    onFoldersChange(updated);
    if (openFolderId === folderId) setOpenFolderId(null);
  };

  const handleRenameFolder = async (folderId: string) => {
    if (!renameVal.trim()) return;
    await renameFolder(folderId, renameVal.trim());
    onFoldersChange(folders.map((f) => f.id === folderId ? { ...f, name: renameVal.trim() } : f));
    setRenamingId(null);
  };

  const handleDeleteVariant = async (variantId: string) => {
    await deleteVariant(variantId);
    const updated = folderVariants.filter((v) => v.id !== variantId);
    setFolderVariants(updated);
    if (openFolderId) setVariantCounts((p) => ({ ...p, [openFolderId]: updated.length }));
  };

  const handleDownloadVariant = (v: NevraVariant) => {
    const url = URL.createObjectURL(v.blob);
    blobUrlsRef.current.push(url);
    const a = document.createElement('a'); a.href = url; a.download = v.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleCreateFolder = async () => {
    if (!createName.trim() || creating) return;
    setCreating(true);
    try {
      const folder = await createFolder(createName.trim(), createType);
      onFoldersChange([folder, ...folders]);
      setCreateName('');
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  };

  const filtered = folders.filter((f) => typeFilter === 'all' || f.type === typeFilter);
  const openFolder_ = openFolderId ? folders.find((f) => f.id === openFolderId) : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6">

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              {openFolderId && (
                <button onClick={() => setOpenFolderId(null)} className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: '#0f0f25', border: '1px solid #2d2d5a', color: '#9ca3af' }}>←</button>
              )}
              <div>
                <h2 className="text-lg font-black" style={{ color: '#f0f0ff' }}>
                  {openFolder_ ? openFolder_.name : '📁 My Folders'}
                </h2>
                <p className="text-xs" style={{ color: '#4b5563' }}>
                  {openFolder_
                    ? `${folderVariants.length} variant${folderVariants.length !== 1 ? 's' : ''} · ${openFolder_.type === 'video' ? '🎬 Video' : '🖼️ Photo'}`
                    : `${folders.length} folder${folders.length !== 1 ? 's' : ''}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {openFolder_ && renamingId !== openFolderId && (
                <button onClick={() => { setRenamingId(openFolderId!); setRenameVal(openFolder_.name); }}
                  className="text-xs px-3 py-1.5 rounded-xl font-semibold"
                  style={{ background: '#0f0f25', border: '1px solid #2d2d5a', color: '#9ca3af' }}>
                  ✏️ Rename
                </button>
              )}
              {openFolder_ && (
                <button onClick={() => handleDeleteFolder(openFolderId!)}
                  className="text-xs px-3 py-1.5 rounded-xl font-semibold"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                  🗑 Delete
                </button>
              )}
              {!openFolderId && (
                <button onClick={() => { setShowCreate((v) => !v); setCreateName(''); }}
                  className="flex items-center gap-1.5 px-3 h-8 rounded-xl font-bold text-sm transition-all"
                  style={{ background: showCreate ? 'rgba(124,58,237,0.3)' : 'linear-gradient(135deg,rgba(124,58,237,0.25),rgba(79,70,229,0.25))', border: `1px solid ${showCreate ? '#7c3aed' : 'rgba(124,58,237,0.5)'}`, color: '#a78bfa' }}>
                  <span className="text-base font-black">+</span>
                  <span>New Folder</span>
                </button>
              )}
              <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: '#0f0f25', border: '1px solid #2d2d5a', color: '#9ca3af' }}>✕</button>
            </div>
          </div>

          {/* Inline create-folder form */}
          {showCreate && !openFolderId && (
            <div className="mb-4 rounded-2xl border overflow-hidden"
              style={{ background: '#0c0c1e', borderColor: '#7c3aed', boxShadow: '0 0 20px rgba(124,58,237,0.15)' }}>
              <div className="px-4 pt-4 pb-3">
                <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#7c3aed' }}>New Folder</p>
                {/* Type selector */}
                <div className="flex gap-2 mb-3">
                  {(['video', 'photo'] as const).map((t) => (
                    <button key={t} onClick={() => setCreateType(t)}
                      className="flex-1 py-1.5 rounded-xl text-xs font-bold transition-all"
                      style={{
                        background: createType === t ? 'rgba(124,58,237,0.2)' : '#09091a',
                        border: `1px solid ${createType === t ? '#7c3aed' : '#1a1a32'}`,
                        color: createType === t ? '#a78bfa' : '#4b5563',
                      }}>
                      {t === 'video' ? '🎬 Video' : '🖼️ Photo'}
                    </button>
                  ))}
                </div>
                {/* Name input */}
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') setShowCreate(false); }}
                    className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold bg-transparent outline-none"
                    style={{ background: '#09091a', border: '1px solid #2d2d5a', color: '#f0f0ff' }}
                    placeholder="Folder name..." />
                  <button onClick={handleCreateFolder} disabled={!createName.trim() || creating}
                    className="px-4 py-2 rounded-xl text-sm font-bold transition-all"
                    style={{
                      background: createName.trim() ? 'linear-gradient(135deg,#7c3aed,#4f46e5)' : '#1a1a32',
                      color: createName.trim() ? 'white' : '#374151',
                    }}>
                    {creating ? '…' : 'Create'}
                  </button>
                  <button onClick={() => setShowCreate(false)}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-sm"
                    style={{ background: '#0f0f25', border: '1px solid #1a1a32', color: '#6b7280' }}>✕</button>
                </div>
              </div>
            </div>
          )}

          {/* Rename inline input */}
          {renamingId === openFolderId && openFolder_ && (
            <div className="flex gap-2 mb-4">
              <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder(openFolderId!); if (e.key === 'Escape') setRenamingId(null); }}
                className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold bg-transparent outline-none"
                style={{ background: '#0f0f25', border: '1px solid #7c3aed', color: '#f0f0ff' }}
                placeholder="New name..." />
              <button onClick={() => handleRenameFolder(openFolderId!)}
                className="px-4 py-2 rounded-xl text-sm font-bold"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: 'white' }}>OK</button>
              <button onClick={() => setRenamingId(null)}
                className="px-3 py-2 rounded-xl text-sm"
                style={{ background: '#0f0f25', border: '1px solid #2d2d5a', color: '#6b7280' }}>✕</button>
            </div>
          )}

          {/* Folder view */}
          {!openFolderId ? (
            <>
              {/* Type filter tabs */}
              <div className="flex gap-2 mb-4">
                {(['all', 'video', 'photo'] as const).map((t) => (
                  <button key={t} onClick={() => setTypeFilter(t)}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold transition-all"
                    style={{
                      background: typeFilter === t ? 'rgba(124,58,237,0.2)' : '#09091a',
                      border: `1px solid ${typeFilter === t ? '#7c3aed' : '#1a1a32'}`,
                      color: typeFilter === t ? '#a78bfa' : '#4b5563',
                    }}>
                    {t === 'all' ? 'All' : t === 'video' ? '🎬 Videos' : '🖼️ Photos'}
                  </button>
                ))}
              </div>

              {filtered.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-3">📁</div>
                  <p style={{ color: '#374151' }}>No folders yet</p>
                  <p className="text-xs mt-1" style={{ color: '#1f2937' }}>Create a folder on your next upload</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filtered.map((folder) => (
                    <div key={folder.id} className="rounded-2xl border p-4 flex items-center gap-4 cursor-pointer transition-all hover:border-purple-700"
                      style={{ background: '#0c0c1e', borderColor: '#1a1a32' }}
                      onClick={() => openFolder(folder.id)}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                        style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}>
                        {folder.type === 'video' ? '🎬' : '🖼️'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate" style={{ color: '#f0f0ff' }}>{folder.name}</p>
                        <p className="text-xs mt-0.5" style={{ color: '#4b5563' }}>
                          {variantCounts[folder.id] ?? '…'} variant{(variantCounts[folder.id] ?? 0) !== 1 ? 's' : ''} · {fmtDate(folder.createdAt)}
                        </p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-xs flex-shrink-0 transition-all hover:scale-110"
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* Variant list inside folder */
            <div>
              {loadingVariants ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-2xl shimmer" style={{ opacity: 0.15 }} />)}
                </div>
              ) : folderVariants.length === 0 ? (
                <div className="text-center py-12" style={{ color: '#374151' }}>No variants in this folder</div>
              ) : (
                <div className="space-y-2">
                  {folderVariants.map((v) => {
                    const previewUrl = v.type === 'photo' ? URL.createObjectURL(v.blob) : null;
                    if (previewUrl) blobUrlsRef.current.push(previewUrl);
                    return (
                      <div key={v.id} className="rounded-2xl border p-3 flex items-center gap-3"
                        style={{ background: '#0c0c1e', borderColor: '#1a1a32' }}>
                        {previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={previewUrl} alt="" className="w-14 h-10 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-14 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0"
                            style={{ background: '#0f0f25', border: '1px solid #1a1a32' }}>🎬</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: '#e2e8f0' }}>{v.filename}</p>
                          <p className="text-xs" style={{ color: '#4b5563' }}>{fmtBytes(v.size)} · {fmtDate(v.createdAt)}</p>
                        </div>
                        <button onClick={() => handleDownloadVariant(v)}
                          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa' }}>
                          ⬇
                        </button>
                        <button onClick={() => handleDeleteVariant(v.id)}
                          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                          🗑
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function Home() {
  const [activeMode, setActiveMode] = useState<FileMode>('video');

  // Video state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoVariants, setVideoVariants] = useState<ClientVariant[]>([]);
  const [videoDeletedIdxs, setVideoDeletedIdxs] = useState<Set<number>>(new Set());
  const [videoIsProcessing, setVideoIsProcessing] = useState(false);
  const [vowbMode, setVowbMode] = useState(false);
  const [vowbCount, setVowbCount] = useState(1);

  // Photo state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoVariants, setPhotoVariants] = useState<ClientVariant[]>([]);
  const [photoDeletedIdxs, setPhotoDeletedIdxs] = useState<Set<number>>(new Set());
  const [photoIsProcessing, setPhotoIsProcessing] = useState(false);
  const [powbMode, setPowbMode] = useState(false);
  const [powbCount, setPowbCount] = useState(1);

  // Shared
  const [quality, setQuality] = useState<Quality>('max');
  const [variantCount, setVariantCount] = useState(3);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const [showMirrorModal, setShowMirrorModal] = useState(false);
  const [removeAudio, setRemoveAudio] = useState(false);

  // Folder system
  const [folders, setFolders] = useState<NevraFolder[]>([]);
  const [videoFolder, setVideoFolder] = useState<NevraFolder | null>(null); // folder for current video session
  const [photoFolder, setPhotoFolder] = useState<NevraFolder | null>(null); // folder for current photo session
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showSaveModeModal, setShowSaveModeModal] = useState(false);
  const [saveModeTab, setSaveModeTab] = useState<'new' | 'existing'>('new');
  const [folderNameInput, setFolderNameInput] = useState('');
  const [savingFolder, setSavingFolder] = useState(false);
  const [selectedExistingFolderId, setSelectedExistingFolderId] = useState<string | null>(null);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  // ── YouTube state ──────────────────────────────────────────────────────────
  const [ytUrl, setYtUrl] = useState('');
  const [ytClipCount, setYtClipCount] = useState(10);
  const [ytAnalyzing, setYtAnalyzing] = useState(false);
  const [ytInfo, setYtInfo] = useState<YTInfo | null>(null);
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytDownloading, setYtDownloading] = useState(false);
  const [ytDownloadPct, setYtDownloadPct] = useState(0);
  const [ytClipBlobs, setYtClipBlobs] = useState<Record<number, string>>({});   // index → blobUrl
  const [ytClipProcessing, setYtClipProcessing] = useState<Set<number>>(new Set());
  const [ytVideoBlob, setYtVideoBlob] = useState<Blob | null>(null);

  const ffVideoRef = useRef<import('@ffmpeg/ffmpeg').FFmpeg | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoResultsRef = useRef<HTMLDivElement>(null);
  const photoResultsRef = useRef<HTMLDivElement>(null);

  const file = activeMode === 'video' ? videoFile : photoFile;
  const previewUrl = activeMode === 'video' ? videoPreviewUrl : photoPreviewUrl;
  const isProcessing = activeMode === 'video' ? videoIsProcessing : photoIsProcessing;
  const currentFolder = activeMode === 'video' ? videoFolder : photoFolder;
  const acceptAttr = activeMode === 'video'
    ? 'video/mp4,video/quicktime,video/x-msvideo,video/webm'
    : 'image/jpeg,image/png,image/webp';

  // Load FFmpeg (video only)
  useEffect(() => {
    async function init() {
      setFfmpegLoading(true);
      try {
        const { FFmpeg } = await import('@ffmpeg/ffmpeg');
        const { toBlobURL } = await import('@ffmpeg/util');
        const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
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

  // Load persisted folders on mount
  useEffect(() => {
    loadFolders().then(setFolders).catch(console.error);
  }, []);

  // Clamp WB counts when variantCount changes
  useEffect(() => {
    setVowbCount((c) => Math.min(c, variantCount));
    setPowbCount((c) => Math.min(c, variantCount));
  }, [variantCount]);

  // ── File handling: show save-mode modal on drop ────────────────────────────
  const validateFile = useCallback((f: File): boolean => {
    const isVid = f.type.startsWith('video/');
    const isImg = f.type.startsWith('image/');
    if (!isVid && !isImg) { setError('Unsupported format.'); return false; }
    if (activeMode === 'video' && !isVid) { setError('Please drop a video, or switch to Photo mode.'); return false; }
    if (activeMode === 'photo' && !isImg) { setError('Please drop an image, or switch to Video mode.'); return false; }
    return true;
  }, [activeMode]);

  const applyFile = useCallback((f: File) => {
    setError(null);
    if (activeMode === 'video') {
      setVideoFile(f); setVideoVariants([]); setVideoDeletedIdxs(new Set());
      setVideoPreviewUrl(URL.createObjectURL(f));
    } else {
      setPhotoFile(f); setPhotoVariants([]); setPhotoDeletedIdxs(new Set());
      setPhotoPreviewUrl(URL.createObjectURL(f));
    }
  }, [activeMode]);

  const handleFile = useCallback((f: File) => {
    if (!validateFile(f)) return;
    setPendingFile(f);
    setFolderNameInput('');
    setSaveModeTab('new');
    setSelectedExistingFolderId(null);
    setShowSaveModeModal(true);
  }, [validateFile]);

  const confirmAlone = () => {
    setShowSaveModeModal(false);
    // No folder — explicitly clear any previously set folder for this mode
    if (pendingFile) {
      if (pendingFile.type.startsWith('video/')) setVideoFolder(null);
      else setPhotoFolder(null);
      applyFile(pendingFile);
      setPendingFile(null);
    }
  };

  const confirmFolder = async () => {
    if (!folderNameInput.trim() || !pendingFile) return;
    setSavingFolder(true);
    try {
      const type = pendingFile.type.startsWith('video/') ? 'video' : 'photo';
      const folder = await createFolder(folderNameInput.trim(), type);
      setFolders((prev) => [folder, ...prev]);
      if (activeMode === 'video') setVideoFolder(folder);
      else setPhotoFolder(folder);
      setShowSaveModeModal(false);
      applyFile(pendingFile);
      setPendingFile(null);
      setFolderNameInput('');
    } finally {
      setSavingFolder(false);
    }
  };

  const confirmExistingFolder = () => {
    if (!selectedExistingFolderId || !pendingFile) return;
    const folder = folders.find((f) => f.id === selectedExistingFolderId);
    if (!folder) return;
    if (pendingFile.type.startsWith('video/')) setVideoFolder(folder);
    else setPhotoFolder(folder);
    setShowSaveModeModal(false);
    applyFile(pendingFile);
    setPendingFile(null);
    setSelectedExistingFolderId(null);
  };

  const switchMode = (mode: FileMode) => { setActiveMode(mode); setError(null); };

  // ── YouTube: download helper (browser-side, avoids server IP blocks) ───
  const ytStreamWithProgress = async (res: Response): Promise<Uint8Array[]> => {
    const reader = res.body!.getReader();
    const total = parseInt(res.headers.get('content-length') ?? '0');
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total > 0) setYtDownloadPct(Math.round((received / total) * 100));
    }
    setYtDownloadPct(100);
    return chunks;
  };

  const getYtVideoBlob = async (url: string): Promise<Blob> => {
    // ── Attempt 1: cobalt.tools directly from browser (CORS-enabled, residential IPs) ──
    try {
      const cobaltRes = await fetch('https://api.cobalt.tools/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ url, videoQuality: '480', downloadMode: 'auto' }),
      });
      if (cobaltRes.ok) {
        const data = await cobaltRes.json();
        const videoUrl = data.url as string | undefined;
        if (videoUrl && data.status !== 'error') {
          const videoRes = await fetch(videoUrl);
          if (videoRes.ok && videoRes.body) {
            const chunks = await ytStreamWithProgress(videoRes);
            return new Blob(chunks as BlobPart[], { type: 'video/mp4' });
          }
        }
      }
    } catch { /* fall through */ }

    // ── Attempt 2: server proxy (fallback) ────────────────────────────────
    const proxyRes = await fetch(`/api/yt-proxy?v=${encodeURIComponent(url)}`);
    if (!proxyRes.ok) {
      const errData = await proxyRes.json().catch(() => ({})) as { error?: string };
      throw new Error(errData.error ?? 'Video download failed — try again');
    }
    const chunks = await ytStreamWithProgress(proxyRes);
    return new Blob(chunks as BlobPart[], { type: 'video/mp4' });
  };

  // ── YouTube: ONE click → analyze + download + cut ─────────────────────
  const handleYtCreate = async () => {
    if (!ytUrl.trim() || !ffmpegReady) return;
    setYtAnalyzing(true);
    setYtDownloading(false);
    setYtError(null);
    setYtInfo(null);
    setYtClipBlobs({});
    setYtVideoBlob(null);
    setYtClipProcessing(new Set());
    setYtDownloadPct(0);

    try {
      // Step 1: analyze transcript (parallel with download start)
      const infoRes = await fetch(`/api/yt-info?url=${encodeURIComponent(ytUrl.trim())}&count=${ytClipCount}`);
      const infoData = await infoRes.json();
      if (!infoRes.ok) throw new Error(infoData.error ?? 'Analysis failed');
      setYtInfo(infoData);
      setYtAnalyzing(false);
      setYtDownloading(true);

      // Step 2: download video (browser-side → no server IP block)
      const videoBlob = await getYtVideoBlob(ytUrl.trim());
      setYtVideoBlob(videoBlob);

      // Step 3: load into FFmpeg + cut each clip
      const ff = ffVideoRef.current!;
      const { fetchFile } = await import('@ffmpeg/util');
      const inputName = 'yt_input.mp4';
      await ff.writeFile(inputName, await fetchFile(videoBlob));

      for (const clip of (infoData.clips as import('@/lib/yt-analyzer').ClipSegment[])) {
        setYtClipProcessing(p => new Set([...p, clip.index]));
        const outputName = `yt_clip_${clip.index + 1}.mp4`;
        try {
          await ff.exec(['-ss', String(clip.start), '-i', inputName, '-t', String(clip.duration), '-c', 'copy', '-movflags', '+faststart', outputName]);
          const raw = await ff.readFile(outputName);
          const blob = new Blob([raw as unknown as BlobPart], { type: 'video/mp4' });
          setYtClipBlobs(p => ({ ...p, [clip.index]: URL.createObjectURL(blob) }));
          try { await ff.deleteFile(outputName); } catch { /* ok */ }
        } catch (e) { console.error(`Clip ${clip.index + 1}:`, e); }
        setYtClipProcessing(p => { const n = new Set(p); n.delete(clip.index); return n; });
      }
      try { await ff.deleteFile(inputName); } catch { /* ok */ }
    } catch (e) {
      setYtError(String(e));
    } finally {
      setYtAnalyzing(false);
      setYtDownloading(false);
    }
  };

  const ytDownloadClip = (idx: number) => {
    const url = ytClipBlobs[idx];
    if (!url || !ytInfo) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ytInfo.title.replace(/[^a-z0-9]/gi, '_')}_clip_${idx + 1}.mp4`;
    a.click();
  };

  const ytDownloadAllClips = () => {
    if (!ytInfo) return;
    ytInfo.clips.forEach(c => { if (ytClipBlobs[c.index]) ytDownloadClip(c.index); });
  };

  // ── Create variants ────────────────────────────────────────────────────────
  const handleCreate = async (mirrorChoice?: boolean, removeAudio = false) => {
    const isImage = activeMode === 'photo';
    const currentFile = isImage ? photoFile : videoFile;
    const currentIsProcessing = isImage ? photoIsProcessing : videoIsProcessing;
    if (!currentFile || currentIsProcessing) return;
    if (!isImage && !ffmpegReady) return;

    const setVariants = isImage ? setPhotoVariants : setVideoVariants;
    const setDeletedIdxs = isImage ? setPhotoDeletedIdxs : setVideoDeletedIdxs;
    const setIsProcessing = isImage ? setPhotoIsProcessing : setVideoIsProcessing;
    const resultsRef = isImage ? photoResultsRef : videoResultsRef;
    const activeFolder = isImage ? photoFolder : videoFolder;

    setIsProcessing(true);
    setError(null);
    setDeletedIdxs(new Set());
    setVariants(Array.from({ length: variantCount }, (_, i) => ({
      index: i, status: 'pending', ffmpegProgress: 0, blobUrl: null, filename: null, summary: null,
    })));

    // ── PHOTO: Canvas API ─────────────────────────────────────────────────
    if (isImage) {
      for (let i = 0; i < variantCount; i++) {
        setVariants((prev) => prev.map((v) => v.index === i ? { ...v, status: 'processing' } : v));
        if (i === 0) setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        try {
          const usePowb = powbMode && i < powbCount;
          const params = generateParams(quality, false, usePowb, true);
          const outputName = `photo_v${i + 1}_${Math.random().toString(36).slice(2, 8)}.png`;
          const blob = await processImageWithCanvas(currentFile, params);
          const summary = paramsToSummary(params);
          // Auto-save to folder
          if (activeFolder) {
            saveVariant({ folderId: activeFolder.id, filename: outputName, blob, size: blob.size, summary, type: 'photo' }).catch(console.error);
          }
          setVariants((prev) => prev.map((v) =>
            v.index === i ? { ...v, status: 'done', blobUrl: URL.createObjectURL(blob), filename: outputName, summary, ffmpegProgress: 1 } : v
          ));
        } catch (err) {
          setVariants((prev) => prev.map((v) => v.index === i ? { ...v, status: 'error', error: String(err) } : v));
        }
      }
      setIsProcessing(false);
      return;
    }

    // ── VIDEO: FFmpeg WASM ─────────────────────────────────────────────────
    const ff = ffVideoRef.current!;
    const ext = currentFile.name.split('.').pop()?.toLowerCase() ?? 'mp4';
    const inputName = `input_v.${ext}`;
    const { fetchFile } = await import('@ffmpeg/util');
    await ff.writeFile(inputName, await fetchFile(currentFile));

    for (let i = 0; i < variantCount; i++) {
      setVariants((prev) => prev.map((v) => v.index === i ? { ...v, status: 'processing' } : v));
      if (i === 0) setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      try {
        const useVowb = vowbMode && i < vowbCount;
        const params = generateParams(quality, useVowb, false, false);
        if (mirrorChoice !== undefined) params.mirror = mirrorChoice;
        const outputName = `video_v${i + 1}_${Math.random().toString(36).slice(2, 8)}.mp4`;
        const onProgress = ({ progress }: { progress: number }) => {
          setVariants((prev) => prev.map((v) => v.index === i ? { ...v, ffmpegProgress: Math.max(0, Math.min(1, progress)) } : v));
        };
        ff.on('progress', onProgress);
        await ff.exec(buildFFmpegArgs(inputName, outputName, params, false, !removeAudio));
        ff.off('progress', onProgress);
        const raw = await ff.readFile(outputName);
        const blob = new Blob([raw as unknown as BlobPart], { type: 'video/mp4' });
        const summary = paramsToSummary(params);
        try { await ff.deleteFile(outputName); } catch { /* ok */ }
        // Auto-save to folder
        if (activeFolder) {
          saveVariant({ folderId: activeFolder.id, filename: outputName, blob, size: blob.size, summary, type: 'video' }).catch(console.error);
        }
        setVariants((prev) => prev.map((v) =>
          v.index === i ? { ...v, status: 'done', blobUrl: URL.createObjectURL(blob), filename: outputName, summary, ffmpegProgress: 1 } : v
        ));
      } catch (err) {
        setVariants((prev) => prev.map((v) => v.index === i ? { ...v, status: 'error', error: String(err) } : v));
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

        {/* Mode toggle */}
        <div className="flex justify-center mb-5">
          <div className="flex rounded-2xl p-1 gap-1" style={{ background: '#0d0d1e', border: '1px solid #1c1c3a' }}>
            {(['video', 'photo', 'youtube'] as FileMode[]).map((m) => {
              const sel = activeMode === m;
              const hasFile = m === 'video' ? !!videoFile : m === 'photo' ? !!photoFile : !!ytInfo;
              const proc = m === 'video' ? videoIsProcessing : m === 'photo' ? photoIsProcessing : ytDownloading;
              const label = m === 'video' ? '🎬  Video' : m === 'photo' ? '🖼️  Photo' : '📺  YouTube';
              return (
                <button key={m} onClick={() => switchMode(m)}
                  className="relative px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
                  style={{
                    background: sel ? 'linear-gradient(135deg,#7c3aed,#4f46e5)' : 'transparent',
                    color: sel ? 'white' : '#6b7280',
                    boxShadow: sel ? '0 2px 15px rgba(124,58,237,0.35)' : 'none',
                  }}>
                  {label}
                  {!sel && (hasFile || proc) && (
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                      style={{ background: proc ? '#f59e0b' : '#10b981' }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── YouTube section ──────────────────────────────────────────────── */}
        {activeMode === 'youtube' && (
          <div className="mb-5">
            {/* URL input + clip count */}
            <div className="rounded-2xl border p-4 mb-3" style={{ background: '#09091a', borderColor: '#1a1a32' }}>
              <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#374151' }}>YouTube URL</p>
              <input
                value={ytUrl}
                onChange={e => setYtUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !ytAnalyzing && !ytDownloading) handleYtCreate(); }}
                placeholder="https://youtube.com/watch?v=..."
                className="w-full px-3 py-2.5 rounded-xl text-sm bg-transparent outline-none mb-3"
                style={{ background: '#0c0c1e', border: '1px solid #2d2d5a', color: '#f0f0ff' }}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold" style={{ color: '#6b7280' }}>Clips to extract</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setYtClipCount(c => Math.max(1, c - 1))}
                    className="w-7 h-7 rounded-lg flex items-center justify-center font-bold"
                    style={{ background: '#0f0f25', border: '1px solid #2d2d5a', color: '#9ca3af' }}>−</button>
                  <span className="w-8 text-center font-black text-lg gradient-text">{ytClipCount}</span>
                  <button onClick={() => setYtClipCount(c => Math.min(30, c + 1))}
                    className="w-7 h-7 rounded-lg flex items-center justify-center font-bold"
                    style={{ background: '#0f0f25', border: '1px solid #2d2d5a', color: '#9ca3af' }}>+</button>
                </div>
              </div>
            </div>

            {/* Single action button */}
            {!ytAnalyzing && !ytDownloading && Object.keys(ytClipBlobs).length === 0 && (
              <button onClick={handleYtCreate} disabled={!ytUrl.trim() || !ffmpegReady}
                className="btn-gradient w-full py-4 rounded-2xl font-bold text-base text-white tracking-widest uppercase mb-4">
                {!ffmpegReady ? 'Loading engine...' : `⚡  Create ${ytClipCount} Clip${ytClipCount !== 1 ? 's' : ''}`}
              </button>
            )}

            {/* Progress */}
            {(ytAnalyzing || ytDownloading) && (
              <div className="mb-4 rounded-2xl border p-4" style={{ background: '#09091a', borderColor: '#1a1a32' }}>
                {ytAnalyzing && (
                  <div className="flex items-center gap-2 mb-3" style={{ color: '#a78bfa' }}>
                    <svg className="animate-spin w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    <span className="text-sm font-semibold">Step 1/3 — Analyzing video & finding best moments...</span>
                  </div>
                )}
                {ytDownloading && (
                  <>
                    <div className="flex justify-between text-xs mb-2">
                      <span style={{ color: '#9ca3af' }}>
                        {ytDownloadPct < 100 ? 'Step 2/3 — Downloading video...' : 'Step 3/3 — Cutting clips with FFmpeg...'}
                      </span>
                      {ytDownloadPct < 100 && <span className="font-bold tabular-nums" style={{ color: '#7c3aed' }}>{ytDownloadPct}%</span>}
                    </div>
                    {ytDownloadPct < 100 && (
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1a32' }}>
                        <div className="h-full rounded-full transition-all duration-300"
                          style={{ width: `${ytDownloadPct}%`, background: 'linear-gradient(90deg,#7c3aed,#a78bfa)' }} />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {ytError && (
              <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}>
                ⚠️ {ytError}
                <button onClick={() => { setYtError(null); setYtInfo(null); setYtClipBlobs({}); }}
                  className="ml-3 text-xs underline" style={{ color: '#f87171' }}>Try again</button>
              </div>
            )}

            {/* Video info bar (shows once analyzed) */}
            {ytInfo && (
              <div className="rounded-2xl border p-3 mb-4 flex items-center gap-3" style={{ background: '#0c0c1e', borderColor: '#2d2d5a' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ytInfo.thumbnail} alt="" className="w-16 h-11 rounded-xl object-cover flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate" style={{ color: '#f0f0ff' }}>{ytInfo.title}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: '#4b5563' }}>
                    {Math.floor(ytInfo.duration / 60)}m{ytInfo.duration % 60}s ·{' '}
                    {ytInfo.hasTranscript ? '✅ Transcript scored' : '⚡ Even distribution'}
                  </p>
                </div>
                {Object.keys(ytClipBlobs).length > 1 && (
                  <button onClick={ytDownloadAllClips}
                    className="text-xs px-3 py-1.5 rounded-xl font-bold flex-shrink-0"
                    style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa' }}>
                    ⬇ All
                  </button>
                )}
              </div>
            )}

            {/* Clip cards — appear progressively as cuts complete */}
            {ytInfo && ytInfo.clips.length > 0 && (
              <div className="space-y-3">
                {ytInfo.clips.map(clip => (
                  <YTClipCard
                    key={clip.index}
                    clip={clip}
                    blobUrl={ytClipBlobs[clip.index] ?? null}
                    isProcessing={ytClipProcessing.has(clip.index) || (ytDownloading && !ytClipBlobs[clip.index])}
                    onDownload={() => ytDownloadClip(clip.index)}
                  />
                ))}
              </div>
            )}

            {/* New search button after done */}
            {Object.keys(ytClipBlobs).length > 0 && !ytDownloading && (
              <button onClick={() => { setYtInfo(null); setYtClipBlobs({}); setYtUrl(''); setYtError(null); }}
                className="w-full mt-4 py-3 rounded-2xl font-bold text-sm"
                style={{ background: '#09091a', border: '1px solid #1a1a32', color: '#6b7280' }}>
                ↩ New YouTube video
              </button>
            )}
          </div>
        )}

        {/* Drop zone */}
        {activeMode !== 'youtube' && <div
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
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs" style={{ color: '#4b5563' }}>
                    {activeMode === 'video' ? '🎬 Video' : '🖼️ Photo'} · {fmtBytes(file.size)}
                  </p>
                  {currentFolder && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.25)' }}>
                      📁 {currentFolder.name}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={(e) => {
                e.stopPropagation();
                if (activeMode === 'video') { setVideoFile(null); setVideoPreviewUrl(null); setVideoVariants([]); setVideoFolder(null); }
                else { setPhotoFile(null); setPhotoPreviewUrl(null); setPhotoVariants([]); setPhotoFolder(null); }
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
        </div>}

        {activeMode !== 'youtube' && <>
        {/* VOWB toggle */}
        {activeMode === 'video' && (
          <div className="mb-5">
            <div className="rounded-2xl border overflow-hidden transition-all duration-200"
              style={{ background: vowbMode ? 'rgba(255,255,255,0.05)' : '#09091a', borderColor: vowbMode ? 'rgba(255,255,255,0.3)' : '#1a1a32', boxShadow: vowbMode ? '0 0 20px rgba(255,255,255,0.08)' : 'none' }}>
              <button onClick={() => setVowbMode((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 transition-all duration-200">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: vowbMode ? 'white' : '#0f0f25', border: `1px solid ${vowbMode ? 'white' : '#2d2d5a'}` }}>🤍</div>
                  <div className="text-left">
                    <p className="text-sm font-bold" style={{ color: vowbMode ? 'white' : '#9ca3af' }}>VOWB Edit</p>
                    <p className="text-[11px]" style={{ color: vowbMode ? '#d1d5db' : '#374151' }}>Video on white background · caption space at bottom</p>
                  </div>
                </div>
                <div className="relative w-11 h-6 rounded-full flex-shrink-0 transition-all duration-200" style={{ background: vowbMode ? 'white' : '#1a1a32' }}>
                  <div className="absolute top-0.5 w-5 h-5 rounded-full shadow transition-all duration-200" style={{ background: vowbMode ? '#7c3aed' : '#4b5563', left: vowbMode ? '22px' : '2px' }} />
                </div>
              </button>
              {vowbMode && (
                <div className="px-4 pb-3 flex items-center justify-between gap-3"
                  style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <p className="text-xs font-semibold" style={{ color: '#d1d5db' }}>
                    Apply VOWB to <span className="font-black" style={{ color: 'white' }}>{vowbCount}</span> of <span className="font-black" style={{ color: 'white' }}>{variantCount}</span> variant{variantCount !== 1 ? 's' : ''}
                  </p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setVowbCount((c) => Math.max(1, c - 1))}
                      className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm transition-all hover:scale-110"
                      style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }}>−</button>
                    <span className="w-6 text-center font-black text-sm" style={{ color: 'white' }}>{vowbCount}</span>
                    <button onClick={() => setVowbCount((c) => Math.min(variantCount, c + 1))}
                      className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm transition-all hover:scale-110"
                      style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }}>+</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* POWB toggle */}
        {activeMode === 'photo' && (
          <div className="mb-5">
            <div className="rounded-2xl border overflow-hidden transition-all duration-200"
              style={{ background: powbMode ? 'rgba(255,255,255,0.05)' : '#09091a', borderColor: powbMode ? 'rgba(255,255,255,0.3)' : '#1a1a32', boxShadow: powbMode ? '0 0 20px rgba(255,255,255,0.08)' : 'none' }}>
              <button onClick={() => setPowbMode((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 transition-all duration-200">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: powbMode ? 'white' : '#0f0f25', border: `1px solid ${powbMode ? 'white' : '#2d2d5a'}` }}>🤍</div>
                  <div className="text-left">
                    <p className="text-sm font-bold" style={{ color: powbMode ? 'white' : '#9ca3af' }}>POWB Edit</p>
                    <p className="text-[11px]" style={{ color: powbMode ? '#d1d5db' : '#374151' }}>Picture on white background · caption space at bottom</p>
                  </div>
                </div>
                <div className="relative w-11 h-6 rounded-full flex-shrink-0 transition-all duration-200" style={{ background: powbMode ? 'white' : '#1a1a32' }}>
                  <div className="absolute top-0.5 w-5 h-5 rounded-full shadow transition-all duration-200" style={{ background: powbMode ? '#7c3aed' : '#4b5563', left: powbMode ? '22px' : '2px' }} />
                </div>
              </button>
              {powbMode && (
                <div className="px-4 pb-3 flex items-center justify-between gap-3"
                  style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <p className="text-xs font-semibold" style={{ color: '#d1d5db' }}>
                    Apply POWB to <span className="font-black" style={{ color: 'white' }}>{powbCount}</span> of <span className="font-black" style={{ color: 'white' }}>{variantCount}</span> variant{variantCount !== 1 ? 's' : ''}
                  </p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPowbCount((c) => Math.max(1, c - 1))}
                      className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm transition-all hover:scale-110"
                      style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }}>−</button>
                    <span className="w-6 text-center font-black text-sm" style={{ color: 'white' }}>{powbCount}</span>
                    <button onClick={() => setPowbCount((c) => Math.min(variantCount, c + 1))}
                      className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm transition-all hover:scale-110"
                      style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }}>+</button>
                  </div>
                </div>
              )}
            </div>
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
                  style={{ borderColor: sel ? cfg.color : '#1a1a32', background: sel ? `rgba(${cfg.rgb},0.07)` : '#09091a', boxShadow: sel ? `0 0 18px ${cfg.glow}` : 'none' }}>
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

        {/* Audio toggle — video only, inline between variants and create */}
        {activeMode === 'video' && (
          <div className="mb-4 flex items-center justify-between px-4 py-2.5 rounded-2xl"
            style={{ background: '#09091a', border: '1px solid #1a1a32' }}>
            <div className="flex items-center gap-2">
              <span className="text-base">{removeAudio ? '🔇' : '🔊'}</span>
              <span className="text-xs font-semibold" style={{ color: '#9ca3af' }}>
                {removeAudio ? 'No audio' : 'Keep audio'}
              </span>
            </div>
            <button onClick={() => setRemoveAudio((v) => !v)}
              className="relative w-10 h-5 rounded-full flex-shrink-0 transition-all duration-200"
              style={{ background: removeAudio ? '#7c3aed' : '#1a1a32', border: '1px solid #2d2d5a' }}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full shadow transition-all duration-200"
                style={{ background: 'white', left: removeAudio ? '22px' : '2px' }} />
            </button>
          </div>
        )}

        {/* Create button */}
        <button
          className="btn-gradient w-full py-4 rounded-2xl font-bold text-base text-white tracking-widest uppercase"
          disabled={!file || (activeMode === 'video' && !ffmpegReady) || isProcessing}
          onClick={() => activeMode === 'video' ? setShowMirrorModal(true) : handleCreate()}>
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
        </>}

        {/* Results */}
        <ResultsSection label="Video Results" icon="🎬"
          variants={videoVariants} deletedIdxs={videoDeletedIdxs} isProcessing={videoIsProcessing} currentFolder={videoFolder}
          onDelete={(idx) => setVideoDeletedIdxs((p) => new Set([...p, idx]))}
          onDownload={downloadVariant} onDownloadAll={() => downloadAll(videoVariants, videoDeletedIdxs)}
          resultsRef={videoResultsRef} />
        <ResultsSection label="Photo Results" icon="🖼️"
          variants={photoVariants} deletedIdxs={photoDeletedIdxs} isProcessing={photoIsProcessing} currentFolder={photoFolder}
          onDelete={(idx) => setPhotoDeletedIdxs((p) => new Set([...p, idx]))}
          onDownload={downloadVariant} onDownloadAll={() => downloadAll(photoVariants, photoDeletedIdxs)}
          resultsRef={photoResultsRef} />

        {/* Folder browser button */}
        <div className="mt-10 flex justify-center">
          <button onClick={() => setShowFolderBrowser(true)}
            className="flex items-center gap-3 px-5 py-3 rounded-2xl border transition-all hover:border-purple-700"
            style={{ background: '#09091a', borderColor: '#1a1a32', color: '#6b7280' }}>
            <span className="text-xl">📁</span>
            <div className="text-left">
              <p className="text-sm font-bold" style={{ color: '#9ca3af' }}>My Folders</p>
              <p className="text-[11px]">{folders.length} folder{folders.length !== 1 ? 's' : ''} · persistent</p>
            </div>
            {folders.length > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-black" style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa' }}>
                {folders.length}
              </span>
            )}
          </button>
        </div>

        <p className="text-center mt-6 text-xs" style={{ color: '#1f2937' }}>
          Nevra Editor · Processing runs entirely in your browser
        </p>
      </div>

      {/* ── Save Mode Modal ─────────────────────────────────────────────────── */}
      {showSaveModeModal && (() => {
        const pendingType = pendingFile?.type.startsWith('video/') ? 'video' : 'photo';
        const compatibleFolders = folders.filter((f) => f.type === pendingType);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
            <div className="w-full max-w-sm rounded-2xl border overflow-hidden"
              style={{ background: '#0c0c1e', borderColor: '#2d2d5a', boxShadow: '0 0 60px rgba(124,58,237,0.3)' }}>
              <div className="px-6 pt-6 pb-5">
                {/* Header */}
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4"
                  style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}>💾</div>
                <p className="text-lg font-black text-center mb-1" style={{ color: '#f0f0ff' }}>How to save?</p>
                <p className="text-xs text-center mb-5 truncate px-2" style={{ color: '#4b5563' }}>{pendingFile?.name}</p>

                {/* Tabs: New Folder / Existing Folder */}
                <div className="flex gap-2 mb-4">
                  {(['new', 'existing'] as const).map((tab) => (
                    <button key={tab} onClick={() => setSaveModeTab(tab)}
                      className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                      style={{
                        background: saveModeTab === tab ? 'rgba(124,58,237,0.2)' : '#09091a',
                        border: `1px solid ${saveModeTab === tab ? '#7c3aed' : '#1a1a32'}`,
                        color: saveModeTab === tab ? '#a78bfa' : '#4b5563',
                      }}>
                      {tab === 'new' ? '✨ New Folder' : `📂 Existing Folder${compatibleFolders.length > 0 ? ` (${compatibleFolders.length})` : ''}`}
                    </button>
                  ))}
                </div>

                {/* Tab: New Folder */}
                {saveModeTab === 'new' && (
                  <>
                    <div className="mb-4">
                      <label className="text-xs font-bold uppercase tracking-widest mb-2 block" style={{ color: '#374151' }}>
                        Folder name
                      </label>
                      <input
                        autoFocus
                        value={folderNameInput}
                        onChange={(e) => setFolderNameInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && folderNameInput.trim()) confirmFolder(); }}
                        className="w-full px-4 py-3 rounded-xl text-sm font-semibold bg-transparent outline-none"
                        style={{ background: '#09091a', border: '1px solid #2d2d5a', color: '#f0f0ff' }}
                        placeholder="ex: Summer Campaign, Collab Nike..." />
                    </div>
                    <button
                      onClick={confirmFolder}
                      disabled={!folderNameInput.trim() || savingFolder}
                      className="w-full py-3 rounded-xl font-bold text-sm mb-2 transition-all"
                      style={{
                        background: folderNameInput.trim() ? 'linear-gradient(135deg,#7c3aed,#4f46e5)' : '#1a1a32',
                        color: folderNameInput.trim() ? 'white' : '#374151',
                        boxShadow: folderNameInput.trim() ? '0 0 20px rgba(124,58,237,0.35)' : 'none',
                      }}>
                      {savingFolder ? '...' : '📁 Create folder and continue'}
                    </button>
                  </>
                )}

                {/* Tab: Existing Folder */}
                {saveModeTab === 'existing' && (
                  <>
                    {compatibleFolders.length === 0 ? (
                      <div className="text-center py-6 mb-2">
                        <p className="text-sm" style={{ color: '#4b5563' }}>No {pendingType} folders yet.</p>
                        <p className="text-xs mt-1" style={{ color: '#1f2937' }}>Create a new folder first.</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto mb-3 pr-0.5">
                        {compatibleFolders.map((folder) => {
                          const sel = selectedExistingFolderId === folder.id;
                          return (
                            <button key={folder.id} onClick={() => setSelectedExistingFolderId(folder.id)}
                              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                              style={{
                                background: sel ? 'rgba(124,58,237,0.15)' : '#09091a',
                                border: `1px solid ${sel ? '#7c3aed' : '#1a1a32'}`,
                              }}>
                              <span className="text-lg flex-shrink-0">{folder.type === 'video' ? '🎬' : '🖼️'}</span>
                              <span className="text-sm font-semibold flex-1 truncate" style={{ color: sel ? '#e2e8f0' : '#9ca3af' }}>{folder.name}</span>
                              {sel && <span className="text-xs font-black flex-shrink-0" style={{ color: '#a78bfa' }}>✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button
                      onClick={confirmExistingFolder}
                      disabled={!selectedExistingFolderId}
                      className="w-full py-3 rounded-xl font-bold text-sm mb-2 transition-all"
                      style={{
                        background: selectedExistingFolderId ? 'linear-gradient(135deg,#7c3aed,#4f46e5)' : '#1a1a32',
                        color: selectedExistingFolderId ? 'white' : '#374151',
                        boxShadow: selectedExistingFolderId ? '0 0 20px rgba(124,58,237,0.35)' : 'none',
                      }}>
                      📂 Add to this folder
                    </button>
                  </>
                )}

                {/* Always: Generate Alone */}
                <button onClick={confirmAlone}
                  className="w-full py-2.5 rounded-xl font-semibold text-sm transition-all"
                  style={{ background: '#09091a', border: '1px solid #1a1a32', color: '#6b7280' }}>
                  ⚡ Generate Alone — no folder
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Mirror Modal ────────────────────────────────────────────────────── */}
      {showMirrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
          <div className="w-full max-w-sm rounded-2xl border overflow-hidden"
            style={{ background: '#0c0c1e', borderColor: '#2d2d5a', boxShadow: '0 0 60px rgba(124,58,237,0.3)' }}>
            <div className="px-6 pt-6 pb-4">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4"
                style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}>🪞</div>
              <p className="text-lg font-black text-center" style={{ color: '#f0f0ff' }}>Mirror effect?</p>
              <p className="text-sm text-center mt-2" style={{ color: '#6b7280' }}>
                Apply horizontal mirror to the variants?<br />
                <span style={{ color: '#4b5563', fontSize: '11px' }}>Disable if the video contains visible text.</span>
              </p>
            </div>
            <div className="px-6 pb-6 grid grid-cols-2 gap-3">
              <button onClick={() => { setShowMirrorModal(false); handleCreate(false, removeAudio); }}
                className="py-3 rounded-xl font-bold text-sm"
                style={{ background: '#0f0f25', border: '1px solid #2d2d5a', color: '#9ca3af' }}>
                ❌ No, without mirror
              </button>
              <button onClick={() => { setShowMirrorModal(false); handleCreate(true, removeAudio); }}
                className="py-3 rounded-xl font-bold text-sm"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: 'white', boxShadow: '0 0 20px rgba(124,58,237,0.35)' }}>
                🪞 Yes, mirror
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Folder Browser ──────────────────────────────────────────────────── */}
      {showFolderBrowser && (
        <FolderBrowser
          folders={folders}
          onClose={() => setShowFolderBrowser(false)}
          onFoldersChange={setFolders}
        />
      )}
    </div>
  );
}
