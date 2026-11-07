'use client';
import { useState } from 'react';
import { useMe } from '@/parcels/components/Shell';
import {
  MoneyInput,
  RequestBadge,
  readFile,
  toPiastres,
  useRunner,
  type FileBody,
} from '@/parcels/components/money';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Table,
  Td,
} from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { egp, todayCairo } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useLocale, useT } from '@/parcels/lib/i18n';

interface Bill {
  id: string;
  code: string;
  number: string;
  date: string;
  dueDate: string;
  net: number;
  vat: number;
  wht: number;
  total: number;
  payable: number;
  status: string;
  overdue: boolean;
  mime: string;
  createdById: string;
  supplier: { name: string };
}

export default function BillsPage() {
  const t = useT();
  const me = useMe();
  const locale = useLocale();
  const list = useLoad<Bill[]>('/finance/bills');
  const suppliers = useLoad<{ id: string; name: string; active: boolean }[]>('/finance/suppliers');
  const accounts =
    useLoad<{ code: string; name: string; nameAr: string; type: string; active: boolean }[]>(
      '/finance/accounts',
    );
  const hubs = useLoad<{ id: string; code: string; name: string }[]>('/reference/hubs');
  const r = useRunner(() => list.reload());
  const [f, setF] = useState({
    supplierId: '',
    number: '',
    date: todayCairo(),
    dueDate: todayCairo(),
    accountCode: '5240',
    net: '',
    vat: '',
    whtBp: '0',
    hubId: '',
    note: '',
  });
  const [file, setFile] = useState<FileBody | null>(null);
  if (!list.data || !suppliers.data || !accounts.data) return <Loading />;
  const vatFor = () => {
    try {
      setF({ ...f, vat: (Math.round(toPiastres(f.net) * 0.14) / 100).toFixed(2) });
    } catch {
      /* no amount yet */
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Bills')}
        subtitle={t(
          'Supplier invoices: booked when a second person approves, paid by their due date',
        )}
      />
      {r.view}
      <Card title={t('New bill')}>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(async () => {
              await api('/finance/bills', {
                body: {
                  ...f,
                  net: toPiastres(f.net),
                  vat: f.vat ? toPiastres(f.vat) : 0,
                  whtBp: Number(f.whtBp),
                  hubId: f.hubId || null,
                  attachment: file,
                },
              });
              setF({ ...f, number: '', net: '', vat: '', note: '' });
              setFile(null);
            }, 'Bill saved. Someone else must approve it');
          }}
        >
          <Field label={t('Supplier')}>
            <Select
              required
              value={f.supplierId}
              onChange={(e) => setF({ ...f, supplierId: e.target.value })}
            >
              <option value="">{t('Choose a supplier')}</option>
              {suppliers.data
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('Their invoice number')}>
            <Input
              className="ltr-iso"
              value={f.number}
              onChange={(e) => setF({ ...f, number: e.target.value })}
            />
          </Field>
          <Field label={t('Date')}>
            <Input
              type="date"
              required
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
              className="ltr-iso"
            />
          </Field>
          <Field label={t('Due date')}>
            <Input
              type="date"
              required
              value={f.dueDate}
              onChange={(e) => setF({ ...f, dueDate: e.target.value })}
              className="ltr-iso"
            />
          </Field>
          <Field label={t('Account')}>
            <Select
              value={f.accountCode}
              onChange={(e) => setF({ ...f, accountCode: e.target.value })}
            >
              {accounts.data
                .filter((a) => a.type === 'EXPENSE' && a.active)
                .map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {locale === 'ar' ? a.nameAr : a.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('Amount before VAT (EGP)')}>
            <MoneyInput required value={f.net} onChange={(v) => setF({ ...f, net: v })} />
          </Field>
          <Field label={t('VAT (EGP)')}>
            <div className="flex gap-1">
              <MoneyInput value={f.vat} onChange={(v) => setF({ ...f, vat: v })} />
              <Button tone="ghost" onClick={vatFor}>
                14%
              </Button>
            </div>
          </Field>
          <Field label={t('Withholding tax')}>
            <Select value={f.whtBp} onChange={(e) => setF({ ...f, whtBp: e.target.value })}>
              <option value="0">0%</option>
              <option value="100">1%</option>
              <option value="300">3%</option>
              <option value="500">5%</option>
            </Select>
          </Field>
          <Field label={t('Hub')} hint={t('Optional: counts against this hub’s profit')}>
            <Select value={f.hubId} onChange={(e) => setF({ ...f, hubId: e.target.value })}>
              <option value="">{t('None')}</option>
              {(hubs.data ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.code} · {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('Notes')}>
            <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
          <Field label={t('Bill file')} hint={file?.fileName}>
            <label className="btn-secondary cursor-pointer">
              {file ? t('Change file') : t('Upload file')}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(e) => {
                  const x = e.target.files?.[0];
                  if (x) void readFile(x).then(setFile);
                }}
              />
            </label>
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" disabled={r.busy}>
              {t('Save bill')}
            </Button>
          </div>
        </form>
      </Card>
      <Card title={t('Bills')}>
        {list.data.length === 0 ? (
          <Empty>{t('No bills yet')}</Empty>
        ) : (
          <Table
            head={[
              t('Bill'),
              t('Supplier'),
              t('Due'),
              t('Total'),
              t('Withholding'),
              t('To pay'),
              t('Status'),
              '',
            ]}
          >
            {list.data.map((b) => (
              <tr key={b.id}>
                <Td>
                  <span className="ltr-iso font-bold">{b.code}</span>
                  {b.number && (
                    <div className="ltr-iso text-caption text-text-muted">{b.number}</div>
                  )}
                  {b.mime && (
                    <a
                      className="text-caption font-bold text-link"
                      href={`/api/parcels/finance/bills/${b.id}/file`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('File')}
                    </a>
                  )}
                </Td>
                <Td>{b.supplier.name}</Td>
                <Td>
                  <span className="ltr-iso">{b.dueDate}</span>
                  {b.overdue && (
                    <div>
                      <Badge tone="red">{t('Overdue')}</Badge>
                    </div>
                  )}
                </Td>
                <Td>
                  {egp(b.total)}
                  <div className="text-caption text-text-muted">
                    {t('VAT')} {egp(b.vat)}
                  </div>
                </Td>
                <Td>{b.wht ? egp(b.wht) : ''}</Td>
                <Td>
                  <span className="font-bold">{egp(b.payable)}</span>
                </Td>
                <Td>
                  <RequestBadge status={b.status} />
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {b.status === 'PENDING_APPROVAL' &&
                      (b.createdById === me.id ? (
                        <span className="text-caption text-text-muted">
                          {t('Someone else approves')}
                        </span>
                      ) : (
                        <>
                          <Button
                            onClick={() =>
                              void r.call(
                                `/finance/bills/${b.id}/approve`,
                                {},
                                'Approved and booked',
                              )
                            }
                          >
                            {t('Approve')}
                          </Button>
                          <Button
                            tone="ghost"
                            onClick={() =>
                              void r.call(`/finance/bills/${b.id}/reject`, {}, 'Rejected')
                            }
                          >
                            {t('Reject')}
                          </Button>
                        </>
                      ))}
                    {b.status === 'APPROVED' && (
                      <Button
                        onClick={() => {
                          const ref = window.prompt(t('Bank transfer reference'));
                          if (ref !== null)
                            void r.call(
                              `/finance/bills/${b.id}/paid`,
                              { reference: ref },
                              'Marked paid',
                            );
                        }}
                      >
                        {t('Mark paid')}
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
