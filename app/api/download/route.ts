import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, statSync } from 'fs';
import path from 'path';
import { getJob } from '@/lib/jobs';

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  const idxStr = req.nextUrl.searchParams.get('index');
  if (!jobId || idxStr === null) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const idx = parseInt(idxStr);
  const variant = job.variants[idx];
  if (!variant || variant.status !== 'done' || !variant.filePath) {
    return NextResponse.json({ error: 'Variant not ready' }, { status: 404 });
  }

  const filePath = variant.filePath;
  const filename = variant.filename ?? path.basename(filePath);

  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
  }

  const ext = path.extname(filename).toLowerCase();
  const isImage = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
  const contentType = isImage ? `image/${ext.slice(1)}` : 'video/mp4';

  const stream = createReadStream(filePath);
  const readable = new ReadableStream({
    start(controller) {
      stream.on('data', (chunk) => controller.enqueue(chunk));
      stream.on('end', () => controller.close());
      stream.on('error', (err) => controller.error(err));
    },
  });

  return new NextResponse(readable, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
