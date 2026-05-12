import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createJob, updateJob, updateVariant, getJob } from '@/lib/jobs';
import { processVariant, type Quality } from '@/lib/processor';

const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/mov'];
const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const quality = (formData.get('quality') as Quality) ?? 'max';
  const rawVariants = parseInt((formData.get('variants') as string) ?? '3');
  const variantCount = Math.min(50, Math.max(1, isNaN(rawVariants) ? 3 : rawVariants));

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const isImage = ALLOWED_IMAGE.includes(file.type);
  const isVideo = ALLOWED_VIDEO.includes(file.type);
  if (!isImage && !isVideo) {
    return NextResponse.json(
      { error: 'Unsupported file type. Use MP4, MOV, AVI, WEBM, JPG, or PNG.' },
      { status: 400 }
    );
  }

  const jobId = uuidv4();
  const rawExt = file.name.split('.').pop() ?? (isImage ? 'jpg' : 'mp4');
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
  const baseDir = path.join('/tmp', 'nevra', jobId);
  const inputPath = path.join(baseDir, `input.${ext}`);

  await mkdir(baseDir, { recursive: true });
  await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

  createJob(jobId, quality, variantCount, isImage, inputPath, baseDir);
  updateJob(jobId, { status: 'processing' });

  // Process sequentially in background
  (async () => {
    for (let i = 0; i < variantCount; i++) {
      updateVariant(jobId, i, { status: 'processing' });
      try {
        const result = await processVariant(inputPath, baseDir, quality as Quality, i, isImage);
        updateVariant(jobId, i, {
          status: 'done',
          filename: path.basename(result.outputPath),
          filePath: result.outputPath,
          summary: result.summary,
        });
      } catch (err) {
        console.error(`[nevra] variant ${i} failed:`, err);
        updateVariant(jobId, i, { status: 'error', error: String(err) });
      }
    }
    const finalJob = getJob(jobId);
    const allFailed = finalJob?.variants.every((v) => v.status === 'error');
    updateJob(jobId, { status: allFailed ? 'error' : 'done' });
  })();

  return NextResponse.json({ jobId });
}
