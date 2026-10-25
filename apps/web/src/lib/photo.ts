/**
 * Shrinks a camera photo to a JPEG of at most `maxSide` pixels before upload, so proof
 * photos stay small (well under the 1.5 MB limit) even on slow mobile data.
 */
export async function shrinkPhoto(file: Blob, maxSide = 1280, quality = 0.72): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encode_failed'))),
      'image/jpeg',
      quality,
    ),
  );
}

export async function uploadPhoto(
  kind: 'pack' | 'delivery',
  blob: Blob,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/photos?kind=${kind}`, {
      method: 'POST',
      headers: { 'content-type': blob.type || 'image/jpeg' },
      body: blob,
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !data.id) return { ok: false, error: data.error ?? `http_${res.status}` };
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, error: 'network' };
  }
}
