// YouTube clip analyzer — heuristic scoring + TikTok instructions generator
// No AI API key needed: pure signal-based scoring on transcript text.

export interface TranscriptEntry {
  text: string;
  duration: number;
  offset: number; // ms
}

export interface ClipSegment {
  index: number;
  start: number;       // seconds
  end: number;         // seconds
  duration: number;    // seconds
  transcript: string;
  score: number;
  hook: string;
  caption: string;
  hashtags: string;
  textPlacement: 'top' | 'center' | 'bottom';
  callToAction: string;
  checklist: string[];
}

export interface YTInfo {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: number;
  hasTranscript: boolean;
  clips: ClipSegment[];
}

// ── Scoring signals ────────────────────────────────────────────────────────

const HOOK_KEYWORDS = [
  'never', 'always', 'secret', 'truth', 'honest', 'actually', 'wait',
  'wrong', 'mistake', 'crazy', 'insane', 'incredible', 'shocking', 'wild',
  'nobody', 'everyone', 'most people', 'biggest', 'worst', 'best', 'only',
  'real reason', 'changed', 'broke', 'stopped', 'quit', 'realized',
  'confess', 'admit', 'discovered', 'earned', 'million', 'billion',
  'first time', 'last time', 'suddenly', 'thought', 'imagine',
];
const QUESTION_RE = /\b(why|how|what|when|where|who|would|could|should|did|do|does|is|are|was|were)\b[^.!?]*\?/i;
const NUMBER_RE   = /\b\d+(\s*%|k|m\b|billion|million|thousand|hundred|percent)/i;
const EMOTION_WDS = ['love','hate','fear','angry','happy','sad','excited','scared','proud','regret','hurt','lucky','shocked','surprised'];

function scoreText(text: string): number {
  let score = 0;
  const lower = text.toLowerCase();
  HOOK_KEYWORDS.forEach(kw => { if (lower.includes(kw)) score += 2; });
  if (QUESTION_RE.test(text)) score += 5;
  if (NUMBER_RE.test(text))   score += 3;
  const exclamations = (text.match(/!/g) || []).length;
  score += Math.min(exclamations * 2, 6);
  EMOTION_WDS.forEach(e => { if (lower.includes(e)) score += 1; });
  // Short punchy sentences = watchable
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);
  const avgLen = sentences.length ? sentences.reduce((s, t) => s + t.length, 0) / sentences.length : 80;
  if (avgLen < 50) score += 3;
  else if (avgLen < 80) score += 1;
  return score;
}

// ── Hook templates ─────────────────────────────────────────────────────────

function genHook(text: string): string {
  const l = text.toLowerCase();
  if (l.includes('secret') || l.includes('nobody'))           return 'Nobody talks about this...';
  if (l.includes('mistake') || l.includes('wrong'))           return "I was completely wrong about this";
  if (QUESTION_RE.test(text))                                 return 'Wait until you hear the answer...';
  if (NUMBER_RE.test(text))                                   return 'These numbers will surprise you 👀';
  if (l.includes('first time') || l.includes('never'))        return 'This changed everything for me';
  if (l.includes('million') || l.includes('billion'))         return 'This is how it actually works 💰';
  if (l.includes('quit') || l.includes('stopped'))            return 'I finally did it...';
  if (l.includes('realized') || l.includes('discovered'))     return 'When I realized this, everything clicked';
  if (l.includes('truth') || l.includes('honest'))            return "The truth nobody wants to admit";
  return 'You need to hear this 👇';
}

function genCaption(text: string, hook: string, hashtags: string): string {
  const body = text.length > 100 ? text.slice(0, 100).replace(/\s\S+$/, '') + '...' : text;
  return `${hook}\n\n${body}\n\n${hashtags}`;
}

function genHashtags(text: string, title: string): string {
  const base = '#viral #fyp #foryou #trending';
  const l = (text + ' ' + title).toLowerCase();
  const extras: string[] = [];
  if (l.match(/money|rich|earn|million|income|wealth/))      extras.push('#money #financetok #moneytips');
  if (l.match(/business|entrepreneur|startup|company/))      extras.push('#business #entrepreneur');
  if (l.match(/fitness|workout|gym|body|health/))            extras.push('#fitness #gym #healthtok');
  if (l.match(/food|recipe|cook|eat|restaurant/))            extras.push('#food #recipe #foodtok');
  if (l.match(/motivat|success|mindset|discipline/))         extras.push('#motivation #mindset #success');
  if (l.match(/tech|ai|software|app|digital/))               extras.push('#tech #AI #technology');
  if (l.match(/fashion|style|outfit|clothing/))              extras.push('#fashion #style #ootd');
  if (l.match(/relationship|love|dating|couple/))            extras.push('#relationship #love');
  if (l.match(/travel|trip|country|city|world/))             extras.push('#travel #wanderlust');
  return `${base} ${extras.slice(0, 2).join(' ')}`.trim();
}

function genChecklist(placement: string): string[] {
  return [
    `Add hook text overlay at ${placement} of screen (bold white, black outline)`,
    'Enable TikTok auto-captions: Edit → Captions → Auto-generate',
    'Trim 0.5s of silence from start/end if needed',
    'Set visibility to Everyone (not Friends)',
    'Post between 6–10 PM your local time for max reach',
    'Reply to the first comment within 30 min to boost algorithm',
  ];
}

// ── Main analyzer ──────────────────────────────────────────────────────────

const MIN_CLIP_SEC = 12;
const MAX_CLIP_SEC = 50;

export function analyzeTranscriptForClips(
  transcript: TranscriptEntry[],
  targetCount: number,
  videoDuration: number,
  videoTitle: string,
): ClipSegment[] {
  if (!transcript.length) {
    return buildEvenClips(targetCount, videoDuration, videoTitle);
  }

  // Build candidate windows with ~30% overlap
  const windows: Array<{ start: number; end: number; text: string; score: number }> = [];
  let i = 0;

  while (i < transcript.length) {
    const startMs = transcript[i].offset;
    let endMs = startMs;
    let text = '';
    let j = i;

    while (j < transcript.length) {
      const entry = transcript[j];
      text += ' ' + entry.text;
      endMs = entry.offset + entry.duration;
      const elapsed = (endMs - startMs) / 1000;
      j++;
      if (elapsed >= MIN_CLIP_SEC) {
        // Prefer to cut at sentence boundary
        const atBoundary = /[.!?]$/.test(entry.text.trim());
        if (atBoundary || elapsed >= MAX_CLIP_SEC) break;
      }
    }

    const elapsed = (endMs - startMs) / 1000;
    if (elapsed >= MIN_CLIP_SEC) {
      windows.push({ start: startMs / 1000, end: endMs / 1000, text: text.trim(), score: scoreText(text) });
    }

    // Advance by ~60% of window for overlap
    const step = Math.max(1, Math.floor((j - i) * 0.6));
    i += step;
  }

  if (!windows.length) return buildEvenClips(targetCount, videoDuration, videoTitle);

  // Take top-scoring windows, de-duplicate overlapping ones
  const sorted = [...windows].sort((a, b) => b.score - a.score);
  const selected: typeof windows = [];

  for (const w of sorted) {
    if (selected.length >= targetCount) break;
    const overlaps = selected.some(s => Math.max(s.start, w.start) < Math.min(s.end, w.end));
    if (!overlaps) selected.push(w);
  }

  // Pad with evenly-spaced if not enough
  if (selected.length < targetCount) {
    const step = videoDuration / (targetCount + 1);
    for (let k = 1; selected.length < targetCount; k++) {
      const start = k * step;
      const end = Math.min(start + 25, videoDuration);
      const overlaps = selected.some(s => Math.max(s.start, start) < Math.min(s.end, end));
      if (!overlaps) selected.push({ start, end, text: videoTitle, score: 0 });
    }
  }

  return selected
    .sort((a, b) => a.start - b.start)
    .slice(0, targetCount)
    .map((w, idx) => buildClipSegment(w, idx, targetCount, videoTitle));
}

function buildClipSegment(
  w: { start: number; end: number; text: string; score: number },
  idx: number,
  total: number,
  title: string,
): ClipSegment {
  const placements: Array<'top' | 'center' | 'bottom'> = ['top', 'center', 'bottom'];
  const placement = placements[idx % 3];
  const hook     = genHook(w.text);
  const tags     = genHashtags(w.text, title);
  const caption  = genCaption(w.text, hook, tags);
  const cta      = idx === total - 1 ? 'Follow for more 🔥' : idx % 2 === 0 ? 'Save this 💾' : 'Comment below 👇';

  return {
    index: idx,
    start: Math.max(0, parseFloat(w.start.toFixed(2))),
    end: parseFloat(w.end.toFixed(2)),
    duration: parseFloat((w.end - w.start).toFixed(2)),
    transcript: w.text,
    score: w.score,
    hook,
    caption,
    hashtags: tags,
    textPlacement: placement,
    callToAction: cta,
    checklist: genChecklist(placement),
  };
}

function buildEvenClips(count: number, duration: number, title: string): ClipSegment[] {
  const clipDur = Math.min(30, duration / count);
  const step    = (duration - clipDur) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, i) => {
    const start = parseFloat((i * step).toFixed(2));
    const end   = parseFloat((start + clipDur).toFixed(2));
    const w     = { start, end, text: `${title} — clip ${i + 1}`, score: 0 };
    return buildClipSegment(w, i, count, title);
  });
}
