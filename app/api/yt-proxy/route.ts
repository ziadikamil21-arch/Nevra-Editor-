import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

function extractVideoId(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    return u.searchParams.get('v') ?? '';
  } catch { return raw; }
}

async function proxyStream(url: string): Promise<NextResponse | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok || !res.body) return null;
    const headers: HeadersInit = { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' };
    const cl = res.headers.get('content-length');
    if (cl) headers['Content-Length'] = cl;
    return new NextResponse(res.body, { status: 200, headers });
  } catch { return null; }
}

// ── Method 1: youtubei.js (InnerTube API — same as official YouTube apps) ──
async function tryInnertube(videoId: string): Promise<NextResponse | null> {
  try {
    const { Innertube } = await import('youtubei.js');
    const yt = await Innertube.create({ retrieve_player: false });
    const info = await yt.getBasicInfo(videoId);
    const formats = info.streaming_data?.formats ?? [];
    const adaptiveFormats = info.streaming_data?.adaptive_formats ?? [];

    // Prefer combined format (has both video and audio) at lowest quality
    const combined = [...formats].sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0))[0];
    if (combined) {
      const streamUrl = await combined.decipher(yt.session.player);
      const res = await proxyStream(streamUrl);
      if (res) return res;
    }

    // Fallback: lowest adaptive video with separate audio
    const videoFormat = [...adaptiveFormats]
      .filter(f => f.mime_type?.includes('video/mp4'))
      .sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0))[0];

    if (videoFormat) {
      const streamUrl = await videoFormat.decipher(yt.session.player);
      const res = await proxyStream(streamUrl);
      if (res) return res;
    }
  } catch { /* fall through */ }
  return null;
}

// ── Method 2: Piped API (multiple instances) ───────────────────────────────
const PIPED_INSTANCES = [
  'https://api.piped.yt',
  'https://pipedapi.tokhmi.xyz',
  'https://piped-api.tiekoetter.com',
  'https://api.piped.projectsegfau.lt',
  'https://watchapi.whatever.social',
  'https://pipedapi.adminforge.de',
];

async function tryPiped(videoId: string): Promise<NextResponse | null> {
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${instance}/streams/${videoId}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const info = await res.json() as {
        videoStreams: Array<{ url: string; quality: string; mimeType: string; videoOnly?: boolean }>;
      };
      const streams = info.videoStreams ?? [];
      const stream = streams.find(s => s.quality === '360p' && !s.videoOnly)
        ?? streams.find(s => !s.videoOnly && s.mimeType?.includes('mp4'))
        ?? streams[0];
      if (!stream?.url) continue;
      const proxyRes = await proxyStream(stream.url);
      if (proxyRes) return proxyRes;
    } catch { continue; }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const directUrl = request.nextUrl.searchParams.get('direct');
  if (directUrl) {
    const res = await proxyStream(directUrl);
    return res ?? NextResponse.json({ error: 'Direct URL failed' }, { status: 502 });
  }

  const v = request.nextUrl.searchParams.get('v') ?? '';
  if (!v) return NextResponse.json({ error: 'Missing v' }, { status: 400 });
  const videoId = extractVideoId(v);
  if (!videoId) return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });

  // Try InnerTube first (most reliable), then Piped
  const innertube = await tryInnertube(videoId);
  if (innertube) return innertube;

  const piped = await tryPiped(videoId);
  if (piped) return piped;

  return NextResponse.json({ error: 'All download methods failed. YouTube may be restricting this video.' }, { status: 502 });
}
