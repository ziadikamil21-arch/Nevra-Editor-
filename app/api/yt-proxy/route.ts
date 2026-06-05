import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

function toFullYtUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.hostname === 'youtu.be') return `https://www.youtube.com/watch?v=${u.pathname.slice(1).split('?')[0]}`;
    return raw;
  } catch { return raw; }
}

async function streamFetch(url: string): Promise<NextResponse | null> {
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

const COBALT_INSTANCES = [
  'https://api.cobalt.tools/',
  'https://cobalt.api.lolcat.sh/',
  'https://cobalt.api.onlix.me/',
];

export async function GET(request: NextRequest) {
  // ── Direct URL proxy (for cobalt redirect status) ────────────────────────
  const directUrl = request.nextUrl.searchParams.get('direct');
  if (directUrl) {
    const res = await streamFetch(directUrl);
    if (res) return res;
    return NextResponse.json({ error: 'Direct URL proxy failed' }, { status: 502 });
  }

  const v = request.nextUrl.searchParams.get('v') ?? '';
  if (!v) return NextResponse.json({ error: 'Missing v param' }, { status: 400 });

  const ytUrl = toFullYtUrl(v);
  const errors: string[] = [];

  // ── 1. cobalt.tools: try all instances (minimal request, no extra headers) ─
  for (const instance of COBALT_INSTANCES) {
    try {
      const cobaltRes = await fetch(instance, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ url: ytUrl }),
      });
      if (!cobaltRes.ok) { errors.push(`${instance}→${cobaltRes.status}`); continue; }
      const data = await cobaltRes.json() as { status: string; url?: string; error?: { code: string } };
      if (!data.url || data.status === 'error') { errors.push(`${instance}→${data.status}`); continue; }
      const res = await streamFetch(data.url);
      if (res) return res;
      errors.push(`${instance} stream failed`);
    } catch (e) { errors.push(`${instance}: ${e}`); }
  }

  return NextResponse.json({ error: `Download failed. Server errors: ${errors.join(' | ')}` }, { status: 502 });
}
