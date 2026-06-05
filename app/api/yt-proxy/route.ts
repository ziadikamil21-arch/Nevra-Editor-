import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get('v');
  if (!videoId) return NextResponse.json({ error: 'Missing v' }, { status: 400 });

  try {
    // Dynamically import so it's not bundled client-side
    const ytdl = (await import('@distube/ytdl-core')).default;

    const url = `https://www.youtube.com/watch?v=${videoId}`;

    // Get formats — prefer 360p MP4 with audio (itag 18) for reasonable file size
    const info = await ytdl.getInfo(url);
    const format =
      info.formats.find(f => f.itag === 18) ??             // 360p mp4 + audio
      info.formats.find(f => f.itag === 22) ??             // 720p mp4 + audio
      ytdl.chooseFormat(info.formats, { quality: 'lowestvideo', filter: 'videoandaudio' });

    if (!format?.url) {
      return NextResponse.json({ error: 'No suitable format found' }, { status: 500 });
    }

    // Proxy: fetch from YouTube CDN and stream back
    const upstream = await fetch(format.url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.youtube.com/' },
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 });
    }

    const contentLength = upstream.headers.get('content-length');
    const headers: HeadersInit = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    if (contentLength) headers['Content-Length'] = contentLength;

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
