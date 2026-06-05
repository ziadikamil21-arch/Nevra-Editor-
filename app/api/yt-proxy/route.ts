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

async function proxyFetch(url: string): Promise<NextResponse | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok || !res.body) return null;
    const headers: HeadersInit = { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' };
    const cl = res.headers.get('content-length');
    if (cl) headers['Content-Length'] = cl;
    return new NextResponse(res.body, { status: 200, headers });
  } catch { return null; }
}

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://piped-api.privacy.com.de',
  'https://pipedapi.adminforge.de',
];

export async function GET(request: NextRequest) {
  // ── Direct URL proxy (for redirect streams) ──────────────────────────────
  const directUrl = request.nextUrl.searchParams.get('direct');
  if (directUrl) {
    const res = await proxyFetch(directUrl);
    if (res) return res;
    return NextResponse.json({ error: 'Direct URL failed' }, { status: 502 });
  }

  const v = request.nextUrl.searchParams.get('v') ?? '';
  if (!v) return NextResponse.json({ error: 'Missing v' }, { status: 400 });

  const videoId = extractVideoId(v);
  if (!videoId) return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });

  const errors: string[] = [];

  // ── Piped API: server-side fallback ────────────────────────────────────
  for (const instance of PIPED_INSTANCES) {
    try {
      const infoRes = await fetch(`${instance}/streams/${videoId}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!infoRes.ok) { errors.push(`${instance} → ${infoRes.status}`); continue; }

      const info = await infoRes.json() as {
        videoStreams: Array<{ url: string; quality: string; mimeType: string; videoOnly?: boolean }>;
      };
      const streams = info.videoStreams ?? [];
      const stream = streams.find(s => s.quality === '360p' && !s.videoOnly)
        ?? streams.find(s => s.quality === '480p' && !s.videoOnly)
        ?? streams.find(s => !s.videoOnly && s.mimeType?.includes('mp4'))
        ?? streams[0];

      if (!stream?.url) { errors.push(`${instance}: no stream`); continue; }

      const res = await proxyFetch(stream.url);
      if (res) return res;
      errors.push(`${instance} stream proxy failed`);
    } catch (e) { errors.push(`${instance}: ${e}`); }
  }

  return NextResponse.json(
    { error: `Server download failed: ${errors.join(' | ')}` },
    { status: 502 },
  );
}
