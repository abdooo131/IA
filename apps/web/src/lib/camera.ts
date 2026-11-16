/**
 * Asks for the camera and hands back the stream, unless the scanner was closed while the phone
 * was still starting the camera (permission prompt, slow start): its clean up already ran with
 * no stream to stop, so this stream is switched off here and null comes back.
 */
export async function openCamera(
  open: () => Promise<MediaStream>,
  closed: () => boolean,
): Promise<MediaStream | null> {
  const stream = await open();
  if (!closed()) return stream;
  stream.getTracks().forEach((track) => track.stop());
  return null;
}

/**
 * Uploads a proof photo and, only once it is stored, makes the preview of it. A failed upload
 * (first photo or retake) makes no preview, so the screen keeps showing the photo still
 * attached, if any.
 */
export async function captureProof<T>(
  photo: T,
  upload: (photo: T) => Promise<{ ok: true; id: string } | { ok: false; error: string }>,
  preview: (photo: T) => string,
): Promise<{ ok: true; id: string; url: string } | { ok: false; error: string }> {
  const result = await upload(photo);
  if (!result.ok) return result;
  return { ok: true, id: result.id, url: preview(photo) };
}
