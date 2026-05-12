import { NextRequest, NextResponse } from 'next/server';
import archiver from 'archiver';
import path from 'path';
import { getJob } from '@/lib/jobs';
import { Readable } from 'stream';

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });

  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const readyVariants = job.variants.filter((v) => v.status === 'done' && v.filePath);
  if (readyVariants.length === 0) {
    return NextResponse.json({ error: 'No variants ready' }, { status: 400 });
  }

  const archive = archiver('zip', { zlib: { level: 0 } });

  for (const v of readyVariants) {
    archive.file(v.filePath!, { name: v.filename ?? path.basename(v.filePath!) });
  }

  archive.finalize();

  const readable = new ReadableStream({
    start(controller) {
      const nodeReadable = archive as unknown as Readable;
      nodeReadable.on('data', (chunk) => controller.enqueue(chunk));
      nodeReadable.on('end', () => controller.close());
      nodeReadable.on('error', (err) => controller.error(err));
    },
  });

  return new NextResponse(readable, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="nevra_variants_${jobId.slice(0, 8)}.zip"`,
    },
  });
}
