'use client';

import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/** Full screen camera view that reports the first barcode it reads. */
export default function CameraScanner({
  onCode,
  onClose,
}: {
  onCode(code: string): void;
  onClose(): void;
}) {
  const t = useTranslations('scan');
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let controls: IScannerControls | undefined;
    let done = false;
    const reader = new BrowserMultiFormatReader();
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailed(true);
      return;
    }
    reader
      .decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current!, (result) => {
        if (result && !done) {
          done = true;
          navigator.vibrate?.(60);
          controls?.stop();
          onCode(result.getText());
        }
      })
      .then((c) => {
        controls = c;
        if (done) c.stop();
      })
      .catch(() => setFailed(true));
    return () => controls?.stop();
  }, [onCode]);

  return (
    <div
      className="fixed inset-0 z-[1000] flex flex-col bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between text-white">
        <p className="text-body-sm">{failed ? '' : t('cameraHint')}</p>
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-md bg-white px-4 text-body-sm font-bold text-[#13294B]"
        >
          {t('closeCamera')}
        </button>
      </div>
      {failed ? (
        <p className="mt-6 rounded-md bg-white p-4 text-body-sm text-[#13294B]">
          {t('cameraUnavailable')}
        </p>
      ) : (
        <video
          ref={video}
          className="mt-4 w-full flex-1 rounded-lg object-cover"
          muted
          playsInline
        />
      )}
    </div>
  );
}
