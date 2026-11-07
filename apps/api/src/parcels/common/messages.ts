// Customer and merchant messages (SMS or WhatsApp). They are written to the outbox in the same
// transaction as the event; a sender delivers them once a provider is set up.
import { formatEgp } from '@shiplynow/shared/parcels';
import type { PrismaService, Tx } from './prisma.service';

type Template =
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'ATTEMPT_FAILED'
  | 'OTP'
  | 'POSTPONED'
  | 'DELIVERY_CODE'
  | 'RETURN_CODE'
  | 'RETURN_PICKUP'
  | 'PACKAGING_CODE';

/** Arabic first: most customers read Arabic. Each message carries the tracking link. */
function render(t: Template, v: Record<string, string>) {
  switch (t) {
    case 'OUT_FOR_DELIVERY':
      return `${v.store}: شحنتك ${v.number} خرجت للتوصيل اليوم. جهز ${v.cod}. للتأكيد أو التأجيل: ${v.link}`;
    case 'DELIVERED':
      return `${v.store}: تم توصيل شحنتك ${v.number}. قيّم التوصيل: ${v.link}`;
    case 'ATTEMPT_FAILED':
      return `${v.store}: لم نتمكن من توصيل ${v.number} اليوم. اختر موعدا آخر أو صحح العنوان: ${v.link}`;
    case 'POSTPONED':
      return `${v.store}: سنوصل ${v.number} يوم ${v.date}. ${v.link}`;
    case 'DELIVERY_CODE':
      return `${v.store}: كود استلام شحنتك ${v.number} هو ${v.code}. أعطه للمندوب فقط بعد أن تستلم الشحنة.`;
    case 'RETURN_CODE':
      return `Shiply: كود استلام المرتجع ${v.number} هو ${v.code}. أعطه للمندوب فقط بعد أن تستلم الشحنة.`;
    case 'PACKAGING_CODE':
      return `Shiply: طلب مواد التغليف ${v.number} في الطريق إليك. كود الاستلام ${v.code}. أعطه للمندوب فقط بعد أن تستلم الطلب.`;
    case 'RETURN_PICKUP':
      return `${v.store}: المندوب سيأتي اليوم لاستلام المرتجع ${v.number}. جهز المنتج في غلافه. ${v.link}`;
    case 'OTP':
      return `كود التحقق من Shiply: ${v.code}. صالح لمدة 10 دقائق. لا تشاركه مع أحد.`;
  }
}

async function setting(db: Tx | PrismaService, key: string, fallback: string) {
  const row = await db.setting.findUnique({
    where: { key_scope: { key: `parcels.${key}`, scope: 'global' } },
  });
  return typeof row?.value === 'string' ? row.value : fallback;
}

export async function queueMessage(
  db: Tx | PrismaService,
  a: { to: string; template: Template; vars: Record<string, string>; shipmentId?: string | null },
) {
  const channel =
    a.template === 'OTP' ||
    a.template === 'DELIVERY_CODE' ||
    a.template === 'RETURN_CODE' ||
    a.template === 'PACKAGING_CODE'
      ? 'SMS'
      : await setting(db, 'messages.channel', 'WHATSAPP');
  return db.message.create({
    data: {
      channel,
      to: a.to,
      template: a.template,
      body: render(a.template, a.vars),
      shipmentId: a.shipmentId ?? null,
    },
  });
}

/** The customer message for a parcel event, when there is one for it. */
export async function queueParcelMessage(
  db: Tx | PrismaService,
  shipmentId: string,
  template: Exclude<Template, 'OTP'>,
  extra: Record<string, string> = {},
) {
  const s = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      trackingNumber: true,
      customerPhone: true,
      codAmount: true,
      direction: true,
      kind: true,
      merchant: { select: { name: true } },
    },
  });
  if (!s || s.direction !== 'FORWARD') return null;
  if (s.kind === 'CUSTOMER_RETURN') {
    // A return we collect from the customer: only the "courier is coming" message makes sense.
    if (template !== 'OUT_FOR_DELIVERY') return null;
    template = 'RETURN_PICKUP';
  }
  const base = await setting(db, 'tracking.base_url', 'https://track.shiply.example/t');
  return queueMessage(db, {
    to: s.customerPhone,
    template,
    shipmentId: s.id,
    vars: {
      store: s.merchant.name,
      number: s.trackingNumber,
      cod: s.codAmount ? formatEgp(s.codAmount).replace(' EGP', ' جنيه') : 'لا يوجد مبلغ للدفع',
      link: `${base}/${s.trackingNumber}`,
      ...extra,
    },
  });
}
