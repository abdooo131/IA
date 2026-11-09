import { JOB_ROLE_TEMPLATES, PURCHASE_ORDER_STATUSES } from '@shiplynow/shared';
import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import { appsFor, canOpenPath, locate } from './apps';
import { WORKFLOWS } from './workflows';

const profile = (role: keyof typeof JOB_ROLE_TEMPLATES) => ({
  ...JOB_ROLE_TEMPLATES[role],
  jobRole: role,
  storeIds: [],
  merchantIds: [],
});

describe('purchase orders, packaging and emails on the desk', () => {
  it('puts each page in its app and menu', () => {
    expect(locate('/finance/purchase-orders/abc')?.app.id).toBe('accounting');
    expect(locate('/finance/emails')?.page?.label).toBe('emails');
    expect(locate('/admin/packaging')?.app.id).toBe('inventory');
    const accounting = appsFor(profile('owner')).find((a) => a.id === 'accounting')!;
    expect(
      accounting.menus.find((m) => m.label === 'moneyOut')!.pages.map((p) => p.href),
    ).toContain('/finance/purchase-orders');
  });

  it('shows packaging to inventory people and purchase orders to accounting people only', () => {
    expect(canOpenPath(profile('store_manager'), '/admin/packaging')).toBe(true);
    expect(canOpenPath(profile('hr_officer'), '/admin/packaging')).toBe(false);
    expect(canOpenPath(profile('hr_officer'), '/finance/purchase-orders')).toBe(false);
  });

  it('walks every purchase order state and names each one in both languages', () => {
    const flow = WORKFLOWS.purchase_order;
    expect([...flow.path, ...flow.side].sort()).toEqual([...PURCHASE_ORDER_STATUSES].sort());
    for (const s of [...flow.path, ...flow.side]) {
      expect(en.workflow.states).toHaveProperty(s);
      expect(ar.workflow.states).toHaveProperty(s);
    }
  });
});
