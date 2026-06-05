import { NextRequest, NextResponse } from 'next/server';
import { analyzeTranscriptForClips, type TranscriptEntry } from '@/lib/yt-analyzer';

export const runtime = 'nodejs';
export const maxDuration = 60;

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    return u.searchParams.get('v');
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const url   = request.nextUrl.searchParams.get('url')   ?? '';
  const count = parseInt(request.nextUrl.searchParams.get('count') ?? '10', 10);

  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

  const videoId = extractVideoId(url);
  if (!videoId) return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });

  try {
    // ── 1. Video metadata via oEmbed (no API key) ──────────────────────────
    const oembed = await fetch(
      `https://www.youtube.com/oembed?url=https://youtube.com/watch?v=${videoId}&format=json`,
    ).then(r => r.json()).catch(() => null);

    const title     = oembed?.title     ?? 'YouTube Video';
    const thumbnail = oembed?.thumbnail_url ?? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

    // ── 2. Video duration via YouTube page scrape ──────────────────────────
    let duration = 600; // fallback 10 min
    try {
      const page = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }).then(r => r.text());
      const dMatch = page.match(/"approxDurationMs":"(\d+)"/);
      if (dMatch) duration = Math.floor(parseInt(dMatch[1], 10) / 1000);
    } catch { /* fallback ok */ }

    // ── 3. Transcript via youtube-transcript ─────────────────────────────
    let transcript: TranscriptEntry[] = [];
    let hasTranscript = false;
    try {
      const { YoutubeTranscript } = await import('youtube-transcript');
      const raw = await YoutubeTranscript.fetchTranscript(videoId);
      transcript = raw.map(e => ({ text: e.text, duration: e.duration, offset: e.offset }));
      hasTranscript = transcript.length > 0;
    } catch { /* no captions — use even distribution */ }

    // ── 4. Analyze ────────────────────────────────────────────────────────
    const clips = analyzeTranscriptForClips(transcript, count, duration, title);

    return NextResponse.json({ videoId, title, thumbnail, duration, hasTranscript, clips });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
