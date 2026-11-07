'use client';
import { useEffect, useState } from 'react';
import {
  Badge,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  PageHeader,
  Table,
  Td,
  cx,
} from '@/parcels/components/ui';
import { dateTime, egp, todayCairo } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Courier {
  courierId: string;
  name: string;
  phone: string;
  agent: string;
  hub: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  at: string;
  run: { code: string; status: string; total: number; open: number; cash: number } | null;
}
interface Trail {
  pings: { lat: number; lng: number; at: string }[];
  stops: {
    id: string;
    result: string;
    failReason: string | null;
    lat: number | null;
    lng: number | null;
    resolvedAt: string;
    codeChecked: boolean;
    hasPhoto: boolean;
    shipment: { trackingNumber: string; address: string };
  }[];
}

const minutesAgo = (at: string) =>
  Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));

/** Draws points and a path inside their own bounding box: enough to see the shape of a day without a map service. */
function Sketch({
  path,
  dots,
}: {
  path: { lat: number; lng: number }[];
  dots: { lat: number; lng: number; tone: string; label: string }[];
}) {
  const all = [...path, ...dots];
  if (path.length < 2 && dots.length === 0) return null;
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const pad = 0.002;
  const [minLat, maxLat, minLng, maxLng] = [
    Math.min(...lats) - pad,
    Math.max(...lats) + pad,
    Math.min(...lngs) - pad,
    Math.max(...lngs) + pad,
  ];
  const W = 640;
  const H = 360;
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * W;
  const y = (lat: number) => H - ((lat - minLat) / (maxLat - minLat)) * H;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mx-auto h-auto max-h-96 w-full rounded-lg bg-surface-raised"
      role="img"
      aria-label="trail"
    >
      {path.length > 1 && (
        <polyline
          points={path.map((p) => `${x(p.lng)},${y(p.lat)}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-link"
          strokeLinejoin="round"
        />
      )}
      {dots.map((d, i) => (
        <g key={i}>
          <circle cx={x(d.lng)} cy={y(d.lat)} r={7} className={d.tone} />
          <title>{d.label}</title>
        </g>
      ))}
    </svg>
  );
}

export default function LivePage() {
  const t = useT();
  const live = useLoad<Courier[]>('/control/couriers/live');
  const [pick, setPick] = useState<string | null>(null);
  const [date, setDate] = useState(todayCairo());
  const trail = useLoad<Trail>(pick ? `/control/couriers/${pick}/trail?date=${date}` : null);
  useEffect(() => {
    const timer = setInterval(() => void live.reload(), 60_000);
    return () => clearInterval(timer);
  }, [live.reload]);

  const chosen = live.data?.find((c) => c.courierId === pick) ?? null;
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Couriers on the road')}
        subtitle={t(
          'Each courier phone sends its place about once a minute while the app is open. Refreshes every minute',
        )}
      />
      <Card>
        {!live.data ? (
          <Loading />
        ) : live.data.length === 0 ? (
          <Empty>{t('No courier phone has sent a location in the last 12 hours')}</Empty>
        ) : (
          <Table head={[t('Courier'), t('Last seen'), t('Run'), t('Cash'), '']}>
            {live.data.map((c) => {
              const ago = minutesAgo(c.at);
              return (
                <tr key={c.courierId} className={cx(pick === c.courierId && 'bg-selected-bg')}>
                  <Td>
                    <button
                      type="button"
                      className="font-bold text-link"
                      onClick={() => setPick(c.courierId)}
                    >
                      {c.name}
                    </button>
                    <div className="text-caption text-text-muted">
                      {[c.hub, c.agent].filter(Boolean).join(' · ')}{' '}
                      {c.phone && (
                        <a href={`tel:${c.phone}`} className="ltr-iso">
                          {c.phone}
                        </a>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={ago <= 5 ? 'green' : ago <= 30 ? 'amber' : 'red'}>
                      {ago <= 1 ? t('Now') : t('{n} min ago', { n: ago })}
                    </Badge>
                  </Td>
                  <Td>
                    {c.run ? (
                      <span>
                        <span className="ltr-iso">{c.run.code}</span> ·{' '}
                        {c.run.status === 'LOADING'
                          ? t('Loading')
                          : t('{a} of {b} stops left', { a: c.run.open, b: c.run.total })}
                      </span>
                    ) : (
                      <span className="text-text-muted">{t('No run')}</span>
                    )}
                  </Td>
                  <Td>{c.run ? egp(c.run.cash) : ''}</Td>
                  <Td>
                    <a
                      className="text-caption font-semibold text-link"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`}
                    >
                      {t('Open map')}
                    </a>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {pick && (
        <Card
          title={chosen ? chosen.name : t('Courier')}
          actions={
            <Field label="">
              <Input
                type="date"
                value={date}
                max={todayCairo()}
                onChange={(e) => setDate(e.target.value)}
                className="ltr-iso"
              />
            </Field>
          }
        >
          {chosen && (
            <iframe
              title="map"
              className="mb-4 h-72 w-full rounded-lg border-0"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${chosen.lng - 0.01},${chosen.lat - 0.007},${chosen.lng + 0.01},${chosen.lat + 0.007}&layer=mapnik&marker=${chosen.lat},${chosen.lng}`}
            />
          )}
          {!trail.data ? (
            <Loading />
          ) : (
            <>
              <p className="mb-2 text-body-sm text-text-muted">
                {t(
                  '{p} location updates and {s} stops on this day. Green delivered, red failed, blue returns',
                  { p: trail.data.pings.length, s: trail.data.stops.length },
                )}
              </p>
              <Sketch
                path={trail.data.pings}
                dots={trail.data.stops
                  .filter((s) => s.lat !== null && s.lng !== null)
                  .map((s) => ({
                    lat: s.lat!,
                    lng: s.lng!,
                    label: `${s.shipment.trackingNumber} ${s.result}`,
                    tone:
                      s.result === 'DELIVERED'
                        ? 'fill-status-delivered'
                        : s.result === 'FAILED' &&
                            s.failReason !== 'CUSTOMER_RETURN' &&
                            s.failReason !== 'EXCHANGE'
                          ? 'fill-danger'
                          : 'fill-link',
                  }))}
              />
              {trail.data.stops.length > 0 && (
                <div className="mt-4">
                  <Table head={[t('Time'), t('Parcel'), t('Result'), t('Code'), t('Place')]}>
                    {trail.data.stops.map((s) => (
                      <tr key={s.id}>
                        <Td>{dateTime(s.resolvedAt)}</Td>
                        <Td>
                          <span className="ltr-iso font-mono">{s.shipment.trackingNumber}</span>
                          <div className="text-caption text-text-muted">{s.shipment.address}</div>
                        </Td>
                        <Td>
                          {s.result}
                          {s.failReason ? ` · ${s.failReason}` : ''}
                          {s.hasPhoto && (
                            <a
                              className="ms-2 text-caption font-semibold text-link"
                              href={`/api/parcels/control/stops/${s.id}/photo`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t('Photo')}
                            </a>
                          )}
                        </Td>
                        <Td>{s.codeChecked ? <Badge tone="green">{t('Checked')}</Badge> : ''}</Td>
                        <Td>
                          {s.lat !== null ? (
                            <a
                              className="text-caption text-link"
                              target="_blank"
                              rel="noreferrer"
                              href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`}
                            >
                              {t('Open map')}
                            </a>
                          ) : (
                            <span className="text-caption text-text-muted">
                              {t('No location sent')}
                            </span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
