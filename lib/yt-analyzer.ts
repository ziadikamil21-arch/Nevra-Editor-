// YouTube clip analyzer — smart heuristic scoring + contextual TikTok strategy
// Reads the actual transcript to generate hooks, captions and hashtags that
// reflect the real content of each clip, not generic templates.

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
  hook: string | null; // null = no text overlay needed
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

// ── Language detection ─────────────────────────────────────────────────────

const FR_MARKERS = /\b(je|tu|il|elle|nous|vous|ils|elles|ma|mon|mes|les|des|que|qui|avec|pour|dans|sur|une|est|pas|mais|ou|et|en|au|aux|donc|genre|nan|ouais|voila|c'est|j'ai|t'as|y'a|quoi|bien|faire|dire|voir|aller|aussi|comme|très|tout|plus|même|toujours|jamais|souvent)\b/i;

function detectLang(text: string): 'fr' | 'en' {
  const matches = (text.match(FR_MARKERS) || []).length;
  const words = text.split(/\s+/).length;
  return matches / words > 0.08 ? 'fr' : 'en';
}

// ── Per-sentence hook scoring ──────────────────────────────────────────────

function sentenceHookScore(s: string): number {
  let score = 0;
  const lower = s.toLowerCase().trim();

  // Questions = curiosity gap, great hooks
  if (/\?$/.test(s)) score += 12;
  if (/^(why|how|what|when|where|who|did|do|is|are|was|were|would|could|should)/i.test(s)) score += 6;
  if (/^(pourquoi|comment|combien|c'est quoi|qu'est-ce|est-ce que|t'as|tu as|tu veux)/i.test(lower)) score += 6;

  // Short punchy = better hook (sweet spot 10-50 chars)
  const len = s.trim().length;
  if (len >= 8 && len <= 30) score += 8;
  else if (len <= 50) score += 4;
  else if (len > 100) score -= 4;

  // Numbers / stats are always viral
  if (/\d+/.test(s)) score += 5;
  if (/(€|\$|k€|euros?|dollars?|millions?|milliards?|thousand|billion)/i.test(s)) score += 6;

  // Contrast / reveal words
  if (/(mais|but|sauf|except|pourtant|however|actually|en fait|finalement|au final|wait)/i.test(lower)) score += 5;

  // Emotion / reaction words
  if (/(incroyable|fou|dingue|choquant|crazy|insane|incredible|shocked|amazing|sérieusement|honnêtement|franchement)/i.test(lower)) score += 4;

  // Personal & story
  if (/\b(j'ai|i )\b.*(jamais|never|first time|la première fois|toujours|always)/i.test(lower)) score += 5;

  // Avoid boring opener sentences (filler words)
  if (/^(so|donc|et|and|um|euh|alors|ok|bah|ben)\b/i.test(lower)) score -= 3;

  return score;
}

// ── Extract best hook quote from transcript ────────────────────────────────

function extractBestHook(transcript: string): string | null {
  if (!transcript.trim()) return null;

  const sentences = transcript
    .replace(/\[.*?\]/g, '') // remove [Music], [Applause] etc.
    .split(/(?<=[.!?])\s+|(?<=\?)\s*/)
    .map(s => s.trim())
    .filter(s => s.length >= 8 && s.length <= 120);

  if (!sentences.length) return null;

  const scored = sentences
    .map(s => ({ text: s, score: sentenceHookScore(s) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 3) return null; // not worth showing a hook

  // Clean up: remove leading filler
  let hook = best.text.replace(/^(so,?|donc,?|and,?|et,?|um,?|euh,?|bah,?)\s+/i, '');
  // Capitalize first letter
  hook = hook.charAt(0).toUpperCase() + hook.slice(1);
  // Remove trailing period (looks odd as overlay text), keep ? and !
  hook = hook.replace(/\.$/, '');

  return hook.length >= 6 ? hook : null;
}

// ── Topic detection ────────────────────────────────────────────────────────

interface TopicMatch {
  tags: string[];
  frTags: string[];
  enTags: string[];
}

const TOPICS: Array<{ pattern: RegExp; match: TopicMatch }> = [
  {
    pattern: /voiture|car|supercar|ferrari|lamborghini|porsche|bmw|mercedes|audi|moto|driving|drive|vitesse|speed|racing|garage|auto/i,
    match: { tags: ['#car', '#supercar', '#automotive'], frTags: ['#voiture', '#auto', '#carfrancais'], enTags: ['#carculture', '#carporn', '#driving'] },
  },
  {
    pattern: /argent|money|rich|riche|business|entrepreneur|investir|invest|startup|trading|revenu|income|passive|earn|gagner|million|milliardaire|billionaire|salaire|salary/i,
    match: { tags: ['#money', '#business', '#success'], frTags: ['#argent', '#entrepreneur', '#investissement'], enTags: ['#financetok', '#moneytips', '#investing'] },
  },
  {
    pattern: /fitness|gym|sport|muscle|entraînement|workout|training|nutrition|regime|diet|poids|weight|minceur|running|course/i,
    match: { tags: ['#fitness', '#gym', '#sport'], frTags: ['#fitnessfr', '#muscu', '#sporttiktok'], enTags: ['#gymtok', '#workout', '#fitfam'] },
  },
  {
    pattern: /amour|love|relation|couple|mec|meuf|boyfriend|girlfriend|dating|rencontre|rupture|breakup|mariage|wedding|kiss|câlin/i,
    match: { tags: ['#love', '#relationship'], frTags: ['#amour', '#couple', '#relatable'], enTags: ['#dating', '#relationship', '#couplegoals'] },
  },
  {
    pattern: /cuisine|food|recipe|recette|manger|restaurant|chef|plat|meal|cook|cooking|gastronomie|gourmet/i,
    match: { tags: ['#food', '#foodie'], frTags: ['#cuisine', '#recette', '#foodtiktok'], enTags: ['#foodtok', '#recipe', '#cooking'] },
  },
  {
    pattern: /voyage|travel|trip|vacances|holiday|pays|country|city|ville|explore|aventure|adventure|abroad|etranger/i,
    match: { tags: ['#travel', '#explore'], frTags: ['#voyage', '#traveltiktok', '#aventure'], enTags: ['#wanderlust', '#traveltok', '#adventure'] },
  },
  {
    pattern: /tech|technologie|ai|intelligence artificielle|application|app|software|digital|code|programme|ordinateur|phone|smartphone/i,
    match: { tags: ['#tech', '#AI'], frTags: ['#techtok', '#technologie'], enTags: ['#technology', '#techreview'] },
  },
  {
    pattern: /mode|fashion|style|outfit|vêtement|clothes|shopping|tendance|trend|luxe|luxury|marque|brand/i,
    match: { tags: ['#fashion', '#style'], frTags: ['#mode', '#tenue', '#shopping'], enTags: ['#ootd', '#fashiontok', '#luxury'] },
  },
  {
    pattern: /psycho|mental|anxiety|stress|dépression|depression|bien-être|wellbeing|santé|health|thérapie|therapy|motivat/i,
    match: { tags: ['#mentalhealth', '#motivation'], frTags: ['#bienetre', '#psychologie'], enTags: ['#mindset', '#mentalhealthtok'] },
  },
  {
    pattern: /music|musique|chanson|song|rap|hip.?hop|rnb|pop|artiste|artist|concert|album|clip/i,
    match: { tags: ['#music', '#musicvideo'], frTags: ['#musique', '#artiste'], enTags: ['#musictok', '#newmusic'] },
  },
];

function detectTopics(text: string, title: string): TopicMatch[] {
  const full = text + ' ' + title;
  return TOPICS.filter(t => t.pattern.test(full)).map(t => t.match);
}

// ── Smart hashtags ─────────────────────────────────────────────────────────

function buildHashtags(text: string, title: string, lang: 'fr' | 'en'): string {
  const topics = detectTopics(text, title);
  const tags = new Set<string>();

  // Universal base
  tags.add('#fyp');
  tags.add('#foryou');
  tags.add('#viral');
  if (lang === 'fr') { tags.add('#france'); tags.add('#pourtoi'); }

  for (const topic of topics.slice(0, 2)) {
    topic.tags.forEach(t => tags.add(t));
    if (lang === 'fr') topic.frTags.slice(0, 2).forEach(t => tags.add(t));
    else topic.enTags.slice(0, 2).forEach(t => tags.add(t));
  }

  // Fallback niche tags if no topic detected
  if (topics.length === 0) {
    if (lang === 'fr') { tags.add('#france'); tags.add('#tiktokfrance'); tags.add('#tendance'); }
    else { tags.add('#trending'); tags.add('#video'); tags.add('#content'); }
  }

  return Array.from(tags).slice(0, 8).join(' ');
}

// ── Call to action — varied & natural ─────────────────────────────────────

const CTA_FR = [
  'Abonne-toi pour la suite 🔔',
  'Sauvegarde si ça te parle 💾',
  'C\'est quoi ton avis ? 👇',
  'Tu kiffes ou pas ? Commente 👇',
  'Suuis pour plus de contenu comme ça ✅',
];
const CTA_EN = [
  'Follow for more 🔥',
  'Save this for later 💾',
  'Drop your thoughts below 👇',
  'What do you think? Comment 👇',
  'Turn on notifs so you don\'t miss it 🔔',
];

function pickCTA(index: number, lang: 'fr' | 'en'): string {
  const pool = lang === 'fr' ? CTA_FR : CTA_EN;
  return pool[index % pool.length];
}

// ── Caption builder ────────────────────────────────────────────────────────

function buildCaption(hook: string | null, transcript: string, hashtags: string, lang: 'fr' | 'en'): string {
  // Use the actual transcript for the caption body (clean up a bit)
  const body = transcript
    .replace(/\[.*?\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);

  const ellipsis = transcript.length > 150 ? '...' : '';
  const opener = hook ? `${hook}\n\n` : '';
  const cta = lang === 'fr' ? '👇 voir la suite' : '👇 watch till the end';
  return `${opener}${body}${ellipsis}\n\n${cta}\n\n${hashtags}`;
}

// ── Checklist (language-aware) ─────────────────────────────────────────────

function buildChecklist(placement: 'top' | 'center' | 'bottom', lang: 'fr' | 'en'): string[] {
  if (lang === 'fr') {
    return [
      `Ajoute le texte hook en ${placement === 'top' ? 'haut' : placement === 'center' ? 'milieu' : 'bas'} d'écran (gras, blanc, contour noir)`,
      'Active les sous-titres auto: Modifier → Sous-titres → Générer automatiquement',
      'Coupe 0.5s de silence au début/fin si besoin',
      'Visibilité: Tout le monde (pas Amis)',
      'Poste entre 19h–22h heure locale pour max reach',
      'Réponds au 1er commentaire dans les 30 min 🚀',
    ];
  }
  return [
    `Add hook text overlay at ${placement} of screen (bold white, black outline)`,
    'Enable auto-captions: Edit → Captions → Auto-generate',
    'Trim 0.5s of silence from start/end if needed',
    'Set visibility to Everyone (not Friends)',
    'Post between 7–10 PM local time for max reach',
    'Reply to first comment within 30 min 🚀',
  ];
}

// ── Engagement scoring ─────────────────────────────────────────────────────

const HOOK_KEYWORDS = [
  'never', 'always', 'secret', 'truth', 'honest', 'actually', 'wait',
  'wrong', 'mistake', 'crazy', 'insane', 'incredible', 'shocking',
  'nobody', 'everyone', 'biggest', 'worst', 'best', 'only', 'changed',
  'broke', 'stopped', 'quit', 'realized', 'discovered', 'earned', 'million',
  'jamais', 'toujours', 'secret', 'vrai', 'honnêtement', 'fou', 'dingue',
  'incroyable', 'choquant', 'personne', 'tout le monde', 'meilleur', 'pire',
  'changé', 'arrêté', 'réalisé', 'découvert', 'gagné',
];

function scoreText(text: string): number {
  let score = 0;
  const lower = text.toLowerCase();
  HOOK_KEYWORDS.forEach(kw => { if (lower.includes(kw)) score += 2; });
  if (/\?/.test(text)) score += 5;
  if (/\d+/.test(text)) score += 3;
  const exclamations = (text.match(/!/g) || []).length;
  score += Math.min(exclamations * 2, 6);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);
  const avgLen = sentences.length ? sentences.reduce((s, t) => s + t.length, 0) / sentences.length : 80;
  if (avgLen < 50) score += 3;
  else if (avgLen < 80) score += 1;
  return score;
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
  if (!transcript.length) return buildEvenClips(targetCount, videoDuration, videoTitle);

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
        const atBoundary = /[.!?]$/.test(entry.text.trim());
        if (atBoundary || elapsed >= MAX_CLIP_SEC) break;
      }
    }

    const elapsed = (endMs - startMs) / 1000;
    if (elapsed >= MIN_CLIP_SEC) {
      windows.push({ start: startMs / 1000, end: endMs / 1000, text: text.trim(), score: scoreText(text) });
    }

    const step = Math.max(1, Math.floor((j - i) * 0.6));
    i += step;
  }

  if (!windows.length) return buildEvenClips(targetCount, videoDuration, videoTitle);

  const sorted = [...windows].sort((a, b) => b.score - a.score);
  const selected: typeof windows = [];

  for (const w of sorted) {
    if (selected.length >= targetCount) break;
    const overlaps = selected.some(s => Math.max(s.start, w.start) < Math.min(s.end, w.end));
    if (!overlaps) selected.push(w);
  }

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
  const lang = detectLang(w.text + ' ' + title);
  const placements: Array<'top' | 'center' | 'bottom'> = ['top', 'center', 'bottom'];
  const placement = placements[idx % 3];

  // Smart hook: extracted from actual transcript
  const hook = extractBestHook(w.text);
  const hashtags = buildHashtags(w.text, title, lang);
  const caption = buildCaption(hook, w.text, hashtags, lang);
  const cta = pickCTA(idx, lang);

  return {
    index: idx,
    start: Math.max(0, parseFloat(w.start.toFixed(2))),
    end: parseFloat(w.end.toFixed(2)),
    duration: parseFloat((w.end - w.start).toFixed(2)),
    transcript: w.text.trim(),
    score: w.score,
    hook,
    caption,
    hashtags,
    textPlacement: placement,
    callToAction: cta,
    checklist: buildChecklist(placement, lang),
  };
}

function buildEvenClips(count: number, duration: number, title: string): ClipSegment[] {
  const clipDur = Math.min(30, duration / count);
  const step = (duration - clipDur) / Math.max(1, count - 1);
  const lang = detectLang(title);
  return Array.from({ length: count }, (_, i) => {
    const start = parseFloat((i * step).toFixed(2));
    const end = parseFloat((start + clipDur).toFixed(2));
    const hashtags = buildHashtags('', title, lang);
    const hook = extractBestHook(title);
    const caption = buildCaption(hook, title, hashtags, lang);
    return {
      index: i,
      start,
      end,
      duration: parseFloat(clipDur.toFixed(2)),
      transcript: title,
      score: 0,
      hook,
      caption,
      hashtags,
      textPlacement: (['top', 'center', 'bottom'] as const)[i % 3],
      callToAction: pickCTA(i, lang),
      checklist: buildChecklist((['top', 'center', 'bottom'] as const)[i % 3], lang),
    };
  });
}
