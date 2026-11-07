'use client';

import type { SearchHit } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { apiGetClient } from '@/lib/api-client';

/**
 * The one search of the Accounting app, in its top bar: a document number (JV-, PAY-, CH-,
 * BILL-, INV-, CN-, PO-, CHQ-, PC-, RW-, BS-), an order number or a merchant name. Enter opens
 * the first hit; arrows move through them. On phones it opens from a search button.
 */
export function AccountingSearch() {
  const t = useTranslations('documents.search');
  const router = useRouter();
  const id = useId();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      void apiGetClient<SearchHit[]>(`/finance/search?q=${encodeURIComponent(text)}`).then((r) => {
        if (r.ok) {
          setHits(r.data);
          setActive(0);
          setOpen(true);
        }
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setPhone(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  useEffect(() => {
    if (phone) input.current?.focus();
  }, [phone]);

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    setOpen(false);
    setPhone(false);
    setQ('');
    router.push(hit.href);
  };
  const kind = (k: string) => (t.has(`kinds.${k}`) ? t(`kinds.${k}`) : k);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setPhone((v) => !v)}
        aria-label={t('label')}
        aria-expanded={phone}
        className="flex h-11 w-11 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised md:hidden"
      >
        <SearchIcon />
      </button>
      <div
        className={`${phone ? 'fixed inset-x-2 top-16 z-50 flex' : 'hidden'} items-center gap-2 rounded-md border border-line-strong bg-surface px-2 shadow-lg md:static md:flex md:w-40 md:shadow-none 2xl:w-56`}
      >
        <SearchIcon />
        <input
          ref={input}
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls={id}
          aria-autocomplete="list"
          aria-label={t('label')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(hits[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
              setPhone(false);
            }
          }}
          placeholder={t('placeholder')}
          className="h-10 min-w-0 flex-1 bg-transparent text-body-sm outline-none"
        />
      </div>
      {open && q.trim().length >= 2 && (
        <ul
          id={id}
          role="listbox"
          className={`absolute z-50 mt-1 max-h-[60dvh] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg ${phone ? 'fixed inset-x-2 top-28' : 'end-0 w-80'}`}
        >
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-body-sm text-text-muted">{t('nothing')}</li>
          ) : (
            hits.map((h, i) => (
              <li
                key={`${h.kind}:${h.href}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(h);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer rounded-md px-3 py-2 ${i === active ? 'bg-selected-bg' : ''}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="ltr-iso truncate text-body-sm font-bold text-link">
                    {h.label}
                  </span>
                  <span className="shrink-0 text-caption text-text-muted">{kind(h.kind)}</span>
                </span>
                {h.detail && (
                  <span className="block truncate text-caption text-text-muted">{h.detail}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="shrink-0 text-text-muted"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" strokeLinecap="round" />
    </svg>
  );
}
