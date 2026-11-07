'use client';

import { useTranslations } from 'next-intl';
import { WORKFLOWS, type WorkflowName } from '@/lib/workflows';

/**
 * Where a document is on its path, like a form's status bar: done steps ticked, the current
 * one lit, later ones grey. A side state (cancelled, failed) replaces the path's end in red.
 * On phones only the step before, the current one and the next one show, so nothing is cut.
 */
export function StatusBar({ flow, status }: { flow: WorkflowName; status: string }) {
  const t = useTranslations('workflow');
  const { path, side } = WORKFLOWS[flow];
  const steps = path as readonly string[];
  const off = (side as readonly string[]).includes(status);
  const at = steps.indexOf(status);
  const label = (s: string) => (t.has(`states.${s}`) ? t(`states.${s}`) : s);
  return (
    <ol
      className="mt-3 flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface text-caption"
      aria-label={t('statusBar')}
    >
      {steps.map((s, i) => {
        const done = !off && at > i;
        const current = !off && at === i;
        // Steps far from where the document is wait for a wider screen.
        const far = off ? i < steps.length - 1 : Math.abs(i - at) > 1;
        return (
          <li
            key={s}
            aria-current={current ? 'step' : undefined}
            className={`flex shrink-0 items-center gap-1 whitespace-nowrap px-3 py-2 ${
              far ? 'max-sm:hidden' : ''
            } ${i > 0 ? 'border-s border-line' : ''} ${current ? 'bg-primary font-bold text-on-primary' : done ? 'text-text' : 'text-text-muted'}`}
          >
            {done && <span aria-hidden>✓</span>}
            {label(s)}
          </li>
        );
      })}
      {off && (
        <li
          aria-current="step"
          className="flex shrink-0 items-center whitespace-nowrap border-s border-line bg-danger px-3 py-2 font-bold text-on-primary"
        >
          {label(status)}
        </li>
      )}
    </ol>
  );
}
