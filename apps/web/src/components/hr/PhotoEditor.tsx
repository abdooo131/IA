'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { Avatar } from './Avatar';

const OUT = 512;
const FRAME = 260;

/** Draws the chosen square of the picture into a 512 px JPEG. */
async function cropToSquare(
  img: HTMLImageElement,
  view: { zoom: number; x: number; y: number },
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = OUT;
  canvas.height = OUT;
  const ctx = canvas.getContext('2d')!;
  // At zoom 1 the picture's shorter side fills the frame.
  const base = FRAME / Math.min(img.naturalWidth, img.naturalHeight);
  const scale = base * view.zoom;
  const ratio = OUT / FRAME;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, OUT, OUT);
  ctx.drawImage(
    img,
    (FRAME / 2 + view.x - (img.naturalWidth * scale) / 2) * ratio,
    (FRAME / 2 + view.y - (img.naturalHeight * scale) / 2) * ratio,
    img.naturalWidth * scale * ratio,
    img.naturalHeight * scale * ratio,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.85),
  );
}

/**
 * The person's photo with Change: take one with the phone camera or choose a file, place the
 * face in the circle (drag, zoom), and save a 512 px square JPEG. `uploadPath` is the API
 * address the photo is PUT to; without it the photo is only shown.
 */
export function PhotoEditor({
  employeeId,
  photoVersion,
  name,
  uploadPath,
  deletePath,
  src,
}: {
  employeeId: string;
  photoVersion: number | null;
  name: string;
  uploadPath?: string;
  deletePath?: string;
  src?: string | null;
}) {
  const t = useTranslations('people');
  const router = useRouter();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) return setError(t('errors.photo_type_not_allowed'));
    setUrl(URL.createObjectURL(file));
    setView({ zoom: 1, x: 0, y: 0 });
    if (camera.current) camera.current.value = '';
    if (picker.current) picker.current.value = '';
  }

  async function save() {
    if (!imgRef.current || !uploadPath) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await cropToSquare(imgRef.current, view);
      const res = await fetch(`/api${uploadPath}`, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: blob,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'generic');
      }
      setUrl(null);
      setOpen(false);
      router.refresh();
    } catch (e) {
      const code = (e as Error).message;
      setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deletePath || !window.confirm(t('removePhotoConfirm'))) return;
    setBusy(true);
    const result = await apiSend('DELETE', deletePath);
    setBusy(false);
    if (!result.ok) return setError(t('errors.generic'));
    router.refresh();
  }

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const d = drag.current;
    setView((v) => ({ ...v, x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
  };
  const button =
    'flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

  return (
    <div className="flex flex-col items-center gap-2">
      <Avatar employeeId={employeeId} photoVersion={photoVersion} name={name} size="xl" src={src} />
      {uploadPath && (
        <button
          type="button"
          className="text-caption font-bold text-link"
          onClick={() => setOpen(true)}
        >
          {photoVersion ? t('changePhoto') : t('addPhoto')}
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('photo')}
          className="fixed inset-0 z-50 flex items-center justify-center bg-shiply-navy/60 p-4"
        >
          <div className="w-full max-w-sm space-y-3 rounded-lg bg-surface p-4 shadow-lg">
            <h2 className="text-h3">{t('photo')}</h2>
            {url ? (
              <>
                <p className="text-caption text-text-muted">{t('cropHint')}</p>
                <div
                  className="relative mx-auto touch-none overflow-hidden rounded-md bg-surface-raised"
                  style={{ width: FRAME, height: FRAME, cursor: 'grab' }}
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={() => (drag.current = null)}
                  onPointerCancel={() => (drag.current = null)}
                >
                  <img
                    ref={imgRef}
                    src={url}
                    alt=""
                    draggable={false}
                    className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                    style={{
                      transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.zoom})`,
                      height: FRAME,
                    }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      // The shorter side fills the frame at zoom 1.
                      if (img.naturalWidth < img.naturalHeight) {
                        img.style.width = `${FRAME}px`;
                        img.style.height = 'auto';
                      }
                    }}
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{
                      boxShadow:
                        '0 0 0 9999px color-mix(in srgb, var(--shiply-surface) 60%, transparent)',
                    }}
                  />
                </div>
                <label className="block text-caption">
                  {t('zoom')}
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.01}
                    value={view.zoom}
                    onChange={(e) => setView((v) => ({ ...v, zoom: Number(e.target.value) }))}
                    className="mt-1 block w-full"
                  />
                </label>
              </>
            ) : (
              <p className="text-body-sm text-text-muted">{t('photoHint')}</p>
            )}
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="user"
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => choose(e.target.files?.[0])}
            />
            <input
              ref={picker}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => choose(e.target.files?.[0])}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={button} onClick={() => camera.current?.click()}>
                {t('takePhoto')}
              </button>
              <button type="button" className={button} onClick={() => picker.current?.click()}>
                {t('choosePhoto')}
              </button>
              {deletePath && photoVersion && !url && (
                <button
                  type="button"
                  className={`${button} text-danger`}
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  {t('removePhoto')}
                </button>
              )}
            </div>
            {error && (
              <p role="alert" className="text-body-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <button
                type="button"
                className={button}
                onClick={() => {
                  setUrl(null);
                  setOpen(false);
                  setError(null);
                }}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={!url || busy}
                onClick={() => void save()}
                className="h-10 rounded-md bg-primary px-4 font-bold text-on-primary disabled:opacity-50"
              >
                {busy ? t('saving') : t('savePhoto')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
