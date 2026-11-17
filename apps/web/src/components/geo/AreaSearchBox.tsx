'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { debounce, searchable } from '@/lib/zone-areas';

/**
 * A search box for areas by name (Arabic or English): asks `search` once typing pauses and
 * lists the answers as a listbox the keyboard can walk (arrows, Enter, Escape).
 */
export function AreaSearchBox<T>({
  label,
  placeholder,
  emptyText,
  failedText,
  search,
  keyOf,
  render,
  onPick,
  className = '',
}: {
  label: string;
  placeholder?: string;
  emptyText: string;
  failedText: string;
  search(q: string): Promise<T[] | null>;
  keyOf(item: T): string;
  render(item: T): React.ReactNode;
  onPick(item: T): void;
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [results, setResults] = useState<T[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const asked = useRef(0);
  const searchRef = useRef(search);
  searchRef.current = search;

  const ask = useMemo(
    () =>
      debounce(async (q: string) => {
        const turn = ++asked.current;
        const found = await searchRef.current(q);
        if (turn !== asked.current) return; // a newer search is on its way
        setFailed(found === null);
        setResults(found ?? []);
        setActive(0);
        setOpen(true);
      }, 300),
    [],
  );
  useEffect(() => () => ask.cancel(), [ask]);

  function change(value: string) {
    setText(value);
    const q = searchable(value);
    if (q) ask.call(q);
    else {
      ask.cancel();
      asked.current++;
      setResults(null);
      setOpen(false);
    }
  }

  function pick(item: T) {
    onPick(item);
    setOpen(false);
    setText('');
    setResults(null);
  }

  const list = open && results !== null;
  return (
    <div className={`relative ${className}`}>
      <label htmlFor={`${id}-input`} className="block text-caption">
        {label}
      </label>
      <input
        id={`${id}-input`}
        type="search"
        role="combobox"
        aria-expanded={list}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={list && results.length ? `${id}-${active}` : undefined}
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (!list) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        className="mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text"
      />
      {list && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute inset-x-0 top-full z-[1000] mt-1 max-h-72 overflow-y-auto rounded-md border border-line bg-surface shadow-lg"
        >
          {results.length === 0 && (
            <li className="px-3 py-2 text-body-sm text-text-muted">
              {failed ? failedText : emptyText}
            </li>
          )}
          {results.map((item, i) => (
            <li
              key={keyOf(item)}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(item)}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-body-sm ${
                i === active ? 'bg-selected-bg text-link' : 'text-text'
              }`}
            >
              {render(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
