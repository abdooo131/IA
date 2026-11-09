'use client';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

export interface TimelineEntry {
  at: string;
  text: string;
  who?: string;
}

/** Every record in the system: number, status and actions; tabs; the timeline beside them. */
export function RecordPage(props: {
  back?: ReactNode;
  number: string;
  status?: ReactNode;
  actions?: ReactNode;
  tabs: { key: string; label: string; content: ReactNode }[];
  timeline: TimelineEntry[];
}) {
  const t = useTranslations('common');
  const [tab, setTab] = useState(props.tabs[0]?.key);
  const current = props.tabs.find((x) => x.key === tab);
  return (
    <section className="record-page">
      {props.back}
      <div className="record-head">
        <h1>{props.number}</h1>
        {props.status}
        <div className="record-actions">{props.actions}</div>
      </div>
      <div className="record-body">
        <div className="record-main">
          <div className="tabs" role="tablist">
            {props.tabs.map((x) => (
              <button key={x.key} role="tab" aria-selected={x.key === tab} className={x.key === tab ? 'tab active' : 'tab'} onClick={() => setTab(x.key)}>
                {x.label}
              </button>
            ))}
          </div>
          <div role="tabpanel">{current?.content}</div>
        </div>
        <aside className="timeline" aria-label={t('timeline')} data-testid="timeline">
          <h2>{t('timeline')}</h2>
          <ol>
            {props.timeline.map((e, i) => (
              <li key={i}>
                <time>{new Date(e.at).toLocaleString()}</time>
                <span>{e.text}</span>
                {e.who && <small>{e.who}</small>}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}
