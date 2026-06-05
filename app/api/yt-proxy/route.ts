import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

function extractVideoId(raw: string): string | null {
  try {
    if (raw.startsWith('http')) {
      const u = new URL(raw);
      if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
      return u.searchParams.get('v');
    }
    return raw; // already a video ID
  } catch {
    return null;
  }
}

// ── Cobalt.tools: bypass YouTube datacenter IP blocks ───────────────────────
async function tryCobalTools(ytUrl: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.cobalt.tools/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        url: ytUrl,
        videoQuality: '480',
        downloadMode: 'auto',
        filenameStyle: 'basic',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if ((data.status === 'stream' || data.status === 'tunnel') && data.url) {
      return data.url as string;
    }
    if (data.status === 'picker' && Array.isArray(data.picker) && data.picker[0]?.url) {
      return data.picker[0].url as string;
    }
    return null;
  } catch {
    return null;
  }
}

// ── ytdl-core: direct stream fallback ────────────────────────────────────────
async function tryYtdlStream(videoId: string): Promise<ReadableStream | null> {
  try {
    const ytdl = (await import('@distube/ytdl-core')).default;
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const info = await ytdl.getInfo(url);
    const format =
      info.formats.find(f => f.itag === 18) ??
      info.formats.find(f => f.itag === 22) ??
      ytdl.chooseFormat(info.formats, { quality: 'lowestvideo', filter: 'videoandaudio' });
    if (!format?.url) return null;

    const upstream = await fetch(format.url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.youtube.com/' },
    });
    if (!upstream.ok || !upstream.body) return null;
    return upstream.body;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const v = request.nextUrl.searchParams.get('v') ?? '';
  if (!v) return NextResponse.json({ error: 'Missing v param' }, { status: 400 });

  const videoId = extractVideoId(v);
  if (!videoId) return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });

  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // ── 1. Try cobalt.tools ──────────────────────────────────────────────────
  const cobaltUrl = await tryCobalTools(ytUrl);
  if (cobaltUrl) {
    try {
      const upstream = await fetch(cobaltUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (upstream.ok && upstream.body) {
        const headers: HeadersInit = { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' };
        const cl = upstream.headers.get('content-length');
        if (cl) headers['Content-Length'] = cl;
        return new NextResponse(upstream.body, { status: 200, headers });
      }
    } catch { /* fall through */ }
  }

  // ── 2. Fallback: ytdl-core direct stream ─────────────────────────────────
  const stream = await tryYtdlStream(videoId);
  if (stream) {
    return new NextResponse(stream, {
      status: 200,
      headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.json(
    { error: 'Could not download video. YouTube may be blocking the server. Try a different video.' },
    { status: 502 },
  );
}
