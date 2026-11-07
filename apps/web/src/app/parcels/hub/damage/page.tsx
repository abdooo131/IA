'use client';
import { useState } from 'react';
import { useHub } from '@/parcels/components/HubContext';
import { PhotoButton, photoBody } from '@/parcels/components/PhotoButton';
import { useRunner } from '@/parcels/components/money';
import { Button, Card, Field, Input, PageHeader, Textarea } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { useT } from '@/parcels/lib/i18n';

/** A damaged parcel: scan it, describe it, photograph it. A quality ticket opens against whoever had it before. */
export default function DamagePage() {
  const t = useT();
  const hub = useHub();
  const r = useRunner();
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title={t('Report damage')} subtitle={t('Scan the damaged parcel, say what is wrong and take a photo. The person who handled it before you is recorded.')} />
      {r.view}
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(async () => {
              if (!photo) throw new Error('Take a photo of the damage');
              const x = await api<{ message: string }>(`/hubs/${hub.id}/damaged`, { body: { code, note, photo: photoBody(photo) } });
              r.setMsg({ ok: true, text: x.message });
              setCode('');
              setNote('');
              setPhoto(null);
            }, 'Saved');
          }}
        >
          <Field label={t('Parcel tracking number')}><Input required autoFocus className="ltr-iso" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label={t('What is damaged')}><Textarea required minLength={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <PhotoButton value={photo} onChange={setPhoto} label={t('Photo of the damage')} />
          <Button type="submit" className="min-h-12 w-full" disabled={r.busy}>{t('Report damage')}</Button>
        </form>
      </Card>
    </div>
  );
}
