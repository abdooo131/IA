'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '@/shell/Icon';

/** A side panel for forms: the page stays visible behind it. Escape or the backdrop closes it. */
export function Drawer({ open, title, onClose, children, closeLabel }: { open: boolean; title: string; onClose: () => void; children: ReactNode; closeLabel: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    panel.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="drawer-wrap">
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <button className="btn ghost icon-btn" onClick={onClose} aria-label={closeLabel}>
            ✕
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}

/** A labelled summary card: an icon, a title and its lines. */
export function InfoCard({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <section className="info-card">
      <header>
        <span className="info-icon">
          <Icon name={icon} size={18} />
        </span>
        <h3>{title}</h3>
      </header>
      <div className="info-body">{children}</div>
    </section>
  );
}

/** A big number with its label, for the top of a page. */
export function StatCard({ icon, label, value, active, onClick, testId }: { icon?: string; label: string; value: ReactNode; active?: boolean; onClick?: () => void; testId?: string }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`stat-card${active ? ' active' : ''}`} onClick={onClick} data-testid={testId}>
      {icon && (
        <span className="info-icon">
          <Icon name={icon} size={18} />
        </span>
      )}
      <strong>{value}</strong>
      <span>{label}</span>
    </Tag>
  );
}

/** Where something is on its journey: done steps filled, the current one highlighted. */
export function Journey({ steps, current, failed }: { steps: { key: string; label: string }[]; current: number; failed?: boolean }) {
  return (
    <ol className="journey">
      {steps.map((s, i) => (
        <li key={s.key} className={i < current ? 'done' : i === current ? (failed ? 'current failed' : 'current') : ''}>
          <span className="journey-dot" />
          <span className="journey-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
