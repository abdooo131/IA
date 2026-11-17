'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DocumentTypeRow } from '@/lib/hr-types';
import { MultiUpload } from './MultiUpload';

/**
 * HR phase 2, on the documents page: pick someone whose documents are not in order and drop
 * their files in one go, each matched to one of their missing types with one tap.
 */
export function UploadForPerson({
  people,
  types,
}: {
  people: { id: string; name: string; code: string; missing: string[] }[];
  types: DocumentTypeRow[];
}) {
  const t = useTranslations('hr2');
  const router = useRouter();
  const [id, setId] = useState('');
  const person = people.find((p) => p.id === id);
  return (
    <section
      className="mt-4 rounded-lg border border-line bg-surface p-4"
      aria-labelledby="upload-for"
    >
      <h2 id="upload-for" className="text-h3">
        {t('docs.forPersonTitle')}
      </h2>
      <p className="mt-1 text-body-sm text-text-muted">{t('docs.forPersonIntro')}</p>
      <label className="mt-3 block max-w-md text-caption font-bold">
        {t('docs.person')}
        <select
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="mt-1 block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm"
        >
          <option value="">–</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.code}) · {t('docs.missingCount', { count: p.missing.length })}
            </option>
          ))}
        </select>
      </label>
      {person && (
        <div className="mt-3">
          <MultiUpload
            key={person.id}
            uploadPath={`/hr/employees/${person.id}/documents`}
            types={types
              .filter((x) => x.isActive)
              .map((x) => ({
                id: x.id,
                nameEn: x.nameEn,
                nameAr: x.nameAr,
                hasExpiry: x.hasExpiry,
                allowedTypes: x.allowedTypes,
                maxBytes: x.maxBytes,
                suggested: person.missing.includes(x.id),
              }))
              .sort((a, b) => Number(b.suggested) - Number(a.suggested))}
            onUploaded={() => router.refresh()}
          />
        </div>
      )}
    </section>
  );
}
