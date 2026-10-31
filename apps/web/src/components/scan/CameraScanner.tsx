'use client';

import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

type Problem = 'insecure' | 'denied' | 'notFound' | 'busy' | { other: string };

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type NativeDetectorClass = {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
};

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

function problemOf(error: unknown): Problem {
  const name = error instanceof DOMException || error instanceof Error ? error.name : 'Error';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'notFound';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return { other: name };
}

/**
 * Full screen camera view that reports the first barcode it reads. Uses the browser's
 * own barcode reader where there is one (Android Chrome), and the zxing library
 * elsewhere (iPhone Safari). Any failure is explained, so staff know what to fix.
 */
export default function CameraScanner({
  onCode,
  onClose,
}: {
  onCode(code: string): void;
  onClose(): void;
}) {
  const t = useTranslations('scan');
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let controls: IScannerControls | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const finish = (code: string) => {
      if (stopped) return;
      stopped = true;
      navigator.vibrate?.(60);
      onCode(code);
    };

    async function start() {
      if (!window.isSecureContext) return setProblem('insecure');
      if (!navigator.mediaDevices?.getUserMedia) return setProblem('notFound');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch (error) {
        return setProblem(problemOf(error));
      }
      const el = video.current;
      if (!el || stopped) return;
      // iPhone Safari only plays inline, muted video without a user gesture.
      el.setAttribute('playsinline', 'true');
      el.muted = true;
      el.srcObject = stream;
      try {
        await el.play();
      } catch (error) {
        return setProblem(problemOf(error));
      }
      setReady(true);

      const Native = (window as unknown as { BarcodeDetector?: NativeDetectorClass })
        .BarcodeDetector;
      const supported = Native ? await Native.getSupportedFormats().catch(() => []) : [];
      const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      if (Native && formats.length > 0) {
        const detector = new Native({ formats });
        const tick = async () => {
          if (stopped) return;
          const found = await detector.detect(el).catch(() => []);
          if (found[0]?.rawValue) return finish(found[0].rawValue);
          timer = setTimeout(tick, 150);
        };
        void tick();
        return;
      }

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.QR_CODE,
      ]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
      controls = await reader
        .decodeFromVideoElement(el, (result) => {
          if (result) finish(result.getText());
        })
        .catch((error: unknown) => {
          setProblem(problemOf(error));
          return undefined;
        });
    }

    void start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onCode]);

  const message =
    problem === null
      ? null
      : problem === 'insecure'
        ? t('cameraInsecure')
        : problem === 'denied'
          ? t('cameraDenied')
          : problem === 'notFound'
            ? t('cameraNotFound')
            : problem === 'busy'
              ? t('cameraBusy')
              : t('cameraError', { name: problem.other });

  return (
    <div
      className="fixed inset-0 z-[1000] flex flex-col bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between gap-3 text-white">
        <p className="text-body-sm">
          {message ? '' : ready ? t('cameraHint') : t('cameraStarting')}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="h-10 shrink-0 rounded-md bg-white px-4 text-body-sm font-bold text-[#13294B]"
        >
          {t('closeCamera')}
        </button>
      </div>
      {message ? (
        <p role="alert" className="mt-6 rounded-md bg-white p-4 text-body-sm text-[#13294B]">
          {message}
        </p>
      ) : (
        <div className="relative mt-4 flex-1 overflow-hidden rounded-lg">
          <video ref={video} className="h-full w-full object-cover" muted playsInline autoPlay />
          {/* Aiming frame */}
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-32 -translate-y-1/2 rounded-md border-4 border-white/80" />
        </div>
      )}
    </div>
  );
}
