'use client';
import { useRunner } from '@/parcels/components/money';
import { Button, Card, Empty, Loading, PageHeader, Table, Td } from '@/parcels/components/ui';
import { dateTime } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Signup {
  id: string;
  code: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  pickupAddress: string;
  governorateCode: string;
  taxId: string;
  createdAt: string;
}

/** Businesses that signed themselves up; call them, then switch them on. */
export default function SignupsPage() {
  const t = useT();
  const list = useLoad<Signup[]>('/admin/signups');
  const r = useRunner(() => list.reload());
  if (!list.data) return <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Merchant sign ups')}
        subtitle={t('Call the business, then approve. Their phone was checked with a code')}
      />
      {r.view}
      <Card>
        {list.data.length === 0 ? (
          <Empty>{t('No sign ups waiting')}</Empty>
        ) : (
          <Table head={[t('Business'), t('Contact'), t('Pickup address'), t('Signed up'), '']}>
            {list.data.map((m) => (
              <tr key={m.id}>
                <Td>
                  <span className="font-bold">{m.name}</span>
                  <div className="ltr-iso text-caption text-text-muted">
                    {m.code}
                    {m.taxId && ` · ${m.taxId}`}
                  </div>
                </Td>
                <Td>
                  {m.contactName}
                  <div className="ltr-iso text-caption">
                    {m.phone} · {m.email}
                  </div>
                </Td>
                <Td>
                  {m.pickupAddress}
                  <div className="ltr-iso text-caption text-text-muted">{m.governorateCode}</div>
                </Td>
                <Td>{dateTime(m.createdAt)}</Td>
                <Td>
                  <div className="flex gap-1">
                    <Button
                      onClick={() =>
                        void r.call(
                          `/admin/merchants/${m.id}/signup/approve`,
                          {},
                          'Approved. They can sign in now',
                        )
                      }
                    >
                      {t('Approve')}
                    </Button>
                    <Button
                      tone="ghost"
                      onClick={() =>
                        void r.call(`/admin/merchants/${m.id}/signup/reject`, {}, 'Rejected')
                      }
                    >
                      {t('Reject')}
                    </Button>
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
