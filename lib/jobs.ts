import type { TransformSummary } from './processor';

export type JobStatus = 'queued' | 'processing' | 'done' | 'error';

export interface VariantResult {
  index: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  filename: string | null;
  filePath: string | null;
  summary: TransformSummary | null;
  error?: string;
}

export interface Job {
  id: string;
  status: JobStatus;
  quality: string;
  variantCount: number;
  isImage: boolean;
  inputPath: string;
  outputDir: string;
  variants: VariantResult[];
  createdAt: number;
  error?: string;
}

const store = new Map<string, Job>();

export function createJob(
  id: string,
  quality: string,
  variantCount: number,
  isImage: boolean,
  inputPath: string,
  outputDir: string,
): Job {
  const job: Job = {
    id, status: 'queued', quality, variantCount, isImage, inputPath, outputDir,
    variants: Array.from({ length: variantCount }, (_, i) => ({
      index: i, status: 'pending', filename: null, filePath: null, summary: null,
    })),
    createdAt: Date.now(),
  };
  store.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined { return store.get(id); }

export function updateJob(id: string, patch: Partial<Job>) {
  const job = store.get(id);
  if (job) store.set(id, { ...job, ...patch });
}

export function updateVariant(jobId: string, idx: number, patch: Partial<VariantResult>) {
  const job = store.get(jobId);
  if (!job) return;
  job.variants[idx] = { ...job.variants[idx], ...patch };
  store.set(jobId, job);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of store.entries()) {
    if (now - job.createdAt > 2 * 60 * 60 * 1000) store.delete(id);
  }
}, 30 * 60 * 1000);
