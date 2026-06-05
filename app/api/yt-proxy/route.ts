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
    return raw;
  } catch { return null; }
}

async function streamUrl(url: string, extraHeaders?: Record<string, string>): Promise<NextResponse | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.youtube.com/',
        ...extraHeaders,
      },
    });
    if (!res.ok || !res.body) return null;
    const headers: HeadersInit = { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' };
    const cl = res.headers.get('content-length');
    if (cl) headers['Content-Length'] = cl;
    return new NextResponse(res.body, { status: 200, headers });
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  // ── Handle direct URL proxying (for cobalt redirect URLs) ────────────────
  const directUrl = request.nextUrl.searchParams.get('direct');
  if (directUrl) {
    const res = await streamUrl(directUrl);
    if (res) return res;
    return NextResponse.json({ error: 'Direct URL fetch failed' }, { status: 502 });
  }

  const v = request.nextUrl.searchParams.get('v') ?? '';
  if (!v) return NextResponse.json({ error: 'Missing v param' }, { status: 400 });

  const videoId = extractVideoId(v);
  if (!videoId) return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });

  const ytUrl = v.startsWith('http') ? v : `https://www.youtube.com/watch?v=${videoId}`;
  const errors: string[] = [];

  // ── 1. cobalt.tools: server-side (only trust tunnel status) ─────────────
  try {
    const cobaltRes = await fetch('https://api.cobalt.tools/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://cobalt.tools',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({ url: ytUrl, videoQuality: '360' }),
    });
    if (cobaltRes.ok) {
      const data = await cobaltRes.json() as { status: string; url?: string; error?: { code: string } };
      if (data.status === 'tunnel' && data.url) {
        const res = await streamUrl(data.url);
        if (res) return res;
        errors.push('cobalt tunnel fetch failed');
      } else if (data.status === 'redirect' && data.url) {
        // Direct CDN URL — try fetching from server
        const res = await streamUrl(data.url);
        if (res) return res;
        errors.push('cobalt redirect CDN failed (IP block)');
      } else {
        errors.push(`cobalt: ${data.status} ${data.error?.code ?? ''}`);
      }
    } else {
      errors.push(`cobalt API ${cobaltRes.status}`);
    }
  } catch (e) { errors.push(`cobalt: ${e}`); }

  // ── 2. ytdl-core direct stream ────────────────────────────────────────────
  try {
    const ytdl = (await import('@distube/ytdl-core')).default;
    const info = await ytdl.getInfo(ytUrl);
    const format =
      info.formats.find(f => f.itag === 18) ??
      info.formats.find(f => f.itag === 22) ??
      ytdl.chooseFormat(info.formats, { quality: 'lowestvideo', filter: 'videoandaudio' });
    if (format?.url) {
      const res = await streamUrl(format.url);
      if (res) return res;
      errors.push('ytdl format URL blocked by YouTube IP filter');
    } else {
      errors.push('ytdl: no format found');
    }
  } catch (e) { errors.push(`ytdl: ${e}`); }

  return NextResponse.json(
    { error: `Download failed. Server errors: ${errors.join(' | ')}` },
    { status: 502 },
  );
}
