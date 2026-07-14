// Text overlay generator — renders text to a transparent PNG (Canvas API).
// This is the browser equivalent of Python PIL's Image + ImageDraw.text().
// The resulting PNG is fed to FFmpeg as a second input and composited with
// `overlay=0:0` — the drawtext filter is NOT used (no font files in WASM).

export interface TextOverlay {
  text: string;
  xPct: number;   // 0..1 — click position on the video, relative
  yPct: number;   // 0..1
}

/**
 * Render `text` at (xPct, yPct) on a fully transparent canvas the exact size
 * of the video, then export as PNG bytes.
 *
 * Font: Arial 22px, black — matching the spec.
 */
export async function renderTextPng(
  overlay: TextOverlay,
  videoWidth: number,
  videoHeight: number,
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = videoWidth;
  canvas.height = videoHeight;

  const ctx = canvas.getContext('2d')!;
  // Canvas starts fully transparent — no fill, just draw the text.

  ctx.font = '22px Arial, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const x = Math.round(overlay.xPct * videoWidth);
  const y = Math.round(overlay.yPct * videoHeight);

  // Support multi-line (in case the user pastes a newline)
  const lines = overlay.text.split('\n');
  const lineHeight = 26; // 22px font + leading
  lines.forEach((line, i) => {
    ctx.fillText(line, x, y + i * lineHeight);
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob) throw new Error('Failed to render text PNG');

  return new Uint8Array(await blob.arrayBuffer());
}

/** Read the intrinsic dimensions of a video file. */
export function getVideoDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ width: video.videoWidth, height: video.videoHeight });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read video dimensions'));
    };
    video.src = url;
  });
}
