// YouTube clip analyzer — sliding-window hook extraction + contextual TikTok strategy

export interface TranscriptEntry {
  text: string;
  duration: number;
  offset: number;
}

export interface ClipSegment {
  index: number;
  start: number;
  end: number;
  duration: number;
  transcript: string;
  score: number;
  hook: string | null;
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

const FR_RE = /\b(je|tu|il|elle|nous|vous|ils|elles|ma|mon|mes|les|des|que|qui|avec|pour|dans|sur|une|est|pas|mais|ou|et|en|au|aux|donc|genre|nan|ouais|c'est|j'ai|t'as|y'a|quoi|faire|aussi|comme|très|tout|plus|même|toujours|jamais|souvent|alors|après|avant|ça|là|bah|mec|bro|kiff)\b/gi;

function detectLang(text: string): 'fr' | 'en' {
  const words = text.split(/\s+/).filter(Boolean).length || 1;
  const hits = (text.match(FR_RE) || []).length;
  return hits / words > 0.07 ? 'fr' : 'en';
}

// ── Per-word-window hook scoring ───────────────────────────────────────────
// YouTube auto-transcripts have NO punctuation — split by words, not sentences.

function windowScore(words: string[]): number {
  const s = words.join(' ');
  const lower = s.toLowerCase();
  let score = 0;

  // Sweet spot length
  const len = s.length;
  if (len >= 12 && len <= 40) score += 8;
  else if (len <= 60) score += 4;
  else score -= 2;

  // Questions are the #1 hook format
  if (/\?$/.test(s.trim())) score += 12;
  if (/^(pourquoi|comment|combien|c'est quoi|est-ce|tu sais|t'as|tu veux|vous savez|why|how|what|when|who|did you|do you|have you)/i.test(lower)) score += 8;

  // Numbers / money = viral
  if (/\d+/.test(s)) score += 6;
  if (/(€|\$|k€|euros?|dollars?|millions?|milliards?)/i.test(s)) score += 8;

  // Contrast / reveal
  if (/\b(mais|sauf|pourtant|except|but|however|actually|en fait|finalement|wait|au final)\b/i.test(lower)) score += 5;

  // Shock / emotion
  if (/\b(incroyable|fou|dingue|choquant|crazy|insane|incredible|jamais vu|unbelievable|no way|vraiment|sérieusement|honnêtement)\b/i.test(lower)) score += 5;

  // Personal / story
  if (/\b(j'ai|i (was|did|made|got|lost|found|saw)|on m'a|ils m'ont|they told|he said|she said)\b/i.test(lower)) score += 4;

  // Don't start with filler
  if (/^(donc|et|and|so|um|euh|bah|ben|ok|well|like)\b/i.test(lower)) score -= 4;

  // Avoid just being a list of common words
  const uniqueWords = new Set(words.map(w => w.toLowerCase())).size;
  if (uniqueWords < words.length * 0.6) score -= 3;

  return score;
}

function extractBestHook(transcript: string): string | null {
  const clean = transcript
    .replace(/\[.*?\]/g, '')   // remove [Music], [Applause]
    .replace(/[^\w\s'àâäéèêëîïôùûüœçÀÂÄÉÈÊËÎÏÔÙÛÜŒÇ€$.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = clean.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 5) return null;

  let bestScore = -Infinity;
  let bestWindow = '';

  // Slide windows of 4–12 words
  for (let size = 4; size <= 12; size++) {
    for (let i = 0; i <= words.length - size; i++) {
      const window = words.slice(i, i + size);
      const score = windowScore(window);
      if (score > bestScore) {
        bestScore = score;
        bestWindow = window.join(' ');
      }
    }
  }

  if (bestScore < 5) return null;

  // Clean and capitalize
  let hook = bestWindow.trim();
  hook = hook.charAt(0).toUpperCase() + hook.slice(1);
  hook = hook.replace(/[.,]+$/, '');

  return hook.length >= 8 ? hook : null;
}

// ── Topic detection ────────────────────────────────────────────────────────

type TopicKey = 'car' | 'money' | 'fitness' | 'food' | 'travel' | 'tech' | 'fashion' | 'relationship' | 'music' | 'general';

function detectTopicKey(text: string): TopicKey {
  const lower = text.toLowerCase();
  if (/voiture|supercar|ferrari|lamborghini|porsche|bmw|mercedes|audi|moto|drive|vitesse|racing|garage|car\b/.test(lower)) return 'car';
  if (/argent|money|rich|riche|business|invest|trading|revenu|income|earn|gagner|million|salaire/.test(lower)) return 'money';
  if (/fitness|gym|sport|muscle|workout|training|nutrition|regime|poids|running/.test(lower)) return 'fitness';
  if (/cuisine|food|recipe|recette|manger|restaurant|chef|plat|cook/.test(lower)) return 'food';
  if (/voyage|travel|trip|vacances|holiday|pays|country|city|explore|aventure/.test(lower)) return 'travel';
  if (/tech|ia|ai|intelligence|app|software|digital|code|phone|smartphone/.test(lower)) return 'tech';
  if (/mode|fashion|style|outfit|vêtement|clothes|shopping|tendance|marque/.test(lower)) return 'fashion';
  if (/amour|love|couple|relation|mec|meuf|boyfriend|girlfriend|dating|rupture/.test(lower)) return 'relationship';
  if (/music|musique|chanson|song|rap|hip.?hop|rnb|artiste|concert|album/.test(lower)) return 'music';
  return 'general';
}

// No predefined hook templates — hooks ONLY come from the actual transcript.
// Without transcript we return null (no hook). Better to have no hook than
// a robotic generic one that has nothing to do with the clip content.

// ── Hashtag builder ────────────────────────────────────────────────────────

const TOPIC_HASHTAGS: Record<TopicKey, { fr: string; en: string }> = {
  car:          { fr: '#voiture #supercar #auto #carfrancais', en: '#car #supercar #automotive #carculture' },
  money:        { fr: '#argent #business #entrepreneur #investissement', en: '#money #business #entrepreneur #investing' },
  fitness:      { fr: '#fitness #muscu #sport #fitnessfr', en: '#fitness #gym #gymtok #workout' },
  food:         { fr: '#cuisine #recette #foodtiktok #chef', en: '#food #recipe #cooking #foodtok' },
  travel:       { fr: '#voyage #travel #aventure #monde', en: '#travel #wanderlust #adventure #explore' },
  tech:         { fr: '#tech #ia #technologie #techtok', en: '#tech #AI #technology #techtok' },
  fashion:      { fr: '#mode #tenue #shopping #style', en: '#fashion #style #ootd #fashiontok' },
  relationship: { fr: '#couple #amour #relatable #relation', en: '#relationship #love #dating #couplegoals' },
  music:        { fr: '#musique #artiste #rap #musicfr', en: '#music #musicvideo #newmusic #musictok' },
  general:      { fr: '#france #tiktokfrance #tendance', en: '#trending #content #video' },
};

function buildHashtags(text: string, title: string, lang: 'fr' | 'en'): string {
  const topicKey = detectTopicKey(text + ' ' + title);
  const topicTags = TOPIC_HASHTAGS[topicKey][lang];
  const base = lang === 'fr' ? '#fyp #foryou #viral #pourtoi' : '#fyp #foryou #viral #trending';
  return `${base} ${topicTags}`;
}

// ── Caption builder ────────────────────────────────────────────────────────

const CTA_FR = [
  'Abonne-toi pour la suite 🔔',
  'Sauvegarde si ça te parle 💾',
  'C\'est quoi ton avis ? 👇',
  'Tu kiffes ? Dis-le en commentaire 👇',
  'Suis pour plus de contenu comme ça ✅',
];
const CTA_EN = [
  'Follow for more 🔥',
  'Save this for later 💾',
  'Drop your thoughts below 👇',
  'What do you think? Comment 👇',
  'Turn on notifs 🔔',
];

function buildCaption(hook: string | null, transcript: string, hashtags: string, lang: 'fr' | 'en'): string {
  const body = transcript.replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150);
  const ellipsis = transcript.length > 150 ? '...' : '';
  const opener = hook ? `${hook}\n\n` : '';
  const cta = lang === 'fr' ? '👇 regarde jusqu\'à la fin' : '👇 watch till the end';
  return `${opener}${body}${ellipsis}\n\n${cta}\n\n${hashtags}`;
}

function buildChecklist(placement: 'top' | 'center' | 'bottom', lang: 'fr' | 'en'): string[] {
  if (lang === 'fr') {
    return [
      `Ajoute le texte hook en ${placement === 'top' ? 'haut' : placement === 'center' ? 'milieu' : 'bas'} d'écran (gras, blanc, contour noir)`,
      'Active les sous-titres auto: Modifier → Sous-titres → Générer',
      'Coupe 0.5s de silence au début/fin si besoin',
      'Visibilité: Tout le monde',
      'Poste entre 19h–22h heure locale 📅',
      'Réponds au 1er commentaire dans les 30 min 🚀',
    ];
  }
  return [
    `Add hook text at ${placement} of screen (bold white, black outline)`,
    'Enable auto-captions: Edit → Captions → Auto-generate',
    'Trim 0.5s silence at start/end if needed',
    'Set visibility to Everyone',
    'Post 7–10 PM local time 📅',
    'Reply to first comment within 30 min 🚀',
  ];
}

// ── Engagement scoring (for window selection) ─────────────────────────────

const ENGAGE_WORDS = [
  'never','always','secret','truth','honest','actually','wait','wrong','mistake',
  'crazy','insane','incredible','shocking','nobody','everyone','biggest','worst',
  'best','only','changed','stopped','quit','realized','million','jamais','toujours',
  'secret','vrai','honnêtement','fou','dingue','incroyable','choquant','personne',
  'tout le monde','meilleur','pire','changé','arrêté','réalisé','gagné',
];

function scoreText(text: string): number {
  let score = 0;
  const lower = text.toLowerCase();
  ENGAGE_WORDS.forEach(kw => { if (lower.includes(kw)) score += 2; });
  if (/\?/.test(text)) score += 5;
  if (/\d+/.test(text)) score += 3;
  score += Math.min((text.match(/!/g) || []).length * 2, 6);
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
    i += Math.max(1, Math.floor((j - i) * 0.6));
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
      if (!overlaps) selected.push({ start, end, text: '', score: 0 });
    }
  }

  return selected
    .sort((a, b) => a.start - b.start)
    .slice(0, targetCount)
    .map((w, idx) => buildClipSegment(w, idx, targetCount, videoTitle, true));
}

function buildClipSegment(
  w: { start: number; end: number; text: string; score: number },
  idx: number,
  total: number,
  title: string,
  hasTranscript: boolean,
): ClipSegment {
  const lang = detectLang((w.text || '') + ' ' + title);
  const placements: Array<'top' | 'center' | 'bottom'> = ['top', 'center', 'bottom'];
  const placement = placements[idx % 3];
  const topicKey = detectTopicKey((w.text || '') + ' ' + title);

  // Hook: extract from actual transcript only. No templates — null if nothing good.
  const hook: string | null = (hasTranscript && w.text) ? extractBestHook(w.text) : null;

  const hashtags = buildHashtags(w.text || '', title, lang);
  const caption = buildCaption(hook, w.text || title, hashtags, lang);
  const cta = (lang === 'fr' ? CTA_FR : CTA_EN)[idx % (lang === 'fr' ? CTA_FR : CTA_EN).length];

  return {
    index: idx,
    start: Math.max(0, parseFloat(w.start.toFixed(2))),
    end: parseFloat(w.end.toFixed(2)),
    duration: parseFloat((w.end - w.start).toFixed(2)),
    transcript: (w.text || title).trim(),
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
  return Array.from({ length: count }, (_, i) => {
    const start = parseFloat((i * step).toFixed(2));
    const end = parseFloat((start + clipDur).toFixed(2));
    return buildClipSegment({ start, end, text: '', score: 0 }, i, count, title, false);
  });
}
