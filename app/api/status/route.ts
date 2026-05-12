import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/jobs';

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });

  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const doneCount = job.variants.filter((v) => v.status === 'done').length;

  return NextResponse.json({
    status: job.status,
    progress: doneCount,
    total: job.variantCount,
    isImage: job.isImage,
    variants: job.variants.map((v) => ({
      index: v.index,
      status: v.status,
      filename: v.filename,
      summary: v.summary,
      error: v.error,
    })),
  });
}
