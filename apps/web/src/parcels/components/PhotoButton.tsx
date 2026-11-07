'use client';
import { useT } from '@/parcels/lib/i18n';

/** Shrinks a camera photo to at most 1280 px JPEG, so uploads stay small on a phone line. */
export async function toJpeg(file: File, max = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

/** A button that opens the camera (or picks a picture) and shows the photo taken. */
export function PhotoButton({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (dataUrl: string) => void;
  label?: string;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-3">
      {value && <img src={value} alt="" className="h-16 w-16 rounded-md object-cover" />}
      <label className="btn-secondary cursor-pointer">
        {value ? t('Take another photo') : (label ?? t('Take photo'))}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void toJpeg(f).then(onChange);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

export const photoBody = (dataUrl: string) => ({ mime: 'image/jpeg', dataBase64: dataUrl });
