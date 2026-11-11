import { z } from 'zod';
import { type AccessProfile, canDo, type MyAccess } from './access';

// Web push notifications (phones and browsers). Each kind of notification is a type the person
// can switch off; the words are kept here in English and Arabic so the server writes every
// notification in the language of the device that receives it.

export const PUSH_TYPES = [
  'order_new',
  'order_late',
  'stock_arriving',
  'rider_order',
  'finance_approval',
  'cash_difference',
  'ops_alert',
  'merchant_signup',
  'site_lead',
  'merchant_alert',
  'ticket',
  'attendance_late',
  'document_expiring',
  'merchant_order',
  'merchant_payout',
  'merchant_low_stock',
  'rider_cash_overdue',
  'crm_lead',
  'crm_followup',
  'crm_proposal',
  'hr_request',
  'hr_update',
  'rider_wallet',
  'activity_due',
  'payslip_ready',
  'expense_claim',
  'basata_deposit',
  'rider_frozen',
] as const;
export type PushType = (typeof PUSH_TYPES)[number];

export const PUSH_LANGS = ['en', 'ar'] as const;
export type PushLang = (typeof PUSH_LANGS)[number];

/**
 * The notification types a person can receive, from what they may open: store screens for the
 * store's orders, accounting for approvals, merchant rights for merchant users. Tickets, own
 * attendance and own documents reach every team member and rider.
 */
export function pushTypesFor(me: MyAccess): PushType[] {
  if (me.kind === 'merchant') {
    const list: PushType[] = [];
    if (me.rights.includes('orders')) list.push('merchant_order');
    if (me.rights.includes('money')) list.push('merchant_payout');
    if (me.rights.includes('stock')) list.push('merchant_low_stock');
    return list;
  }
  if (me.kind === 'rider')
    return [
      'rider_order',
      'ticket',
      'attendance_late',
      'document_expiring',
      'hr_request',
      'hr_update',
      'rider_wallet',
      'expense_claim',
      'basata_deposit',
    ];
  const p: AccessProfile = me.profile;
  const list: PushType[] = [];
  if (canDo(p, 'store', 'use')) list.push('order_new', 'order_late', 'stock_arriving');
  if (canDo(p, 'accounting', 'use')) list.push('finance_approval', 'cash_difference');
  if (canDo(p, 'store', 'manage') || canDo(p, 'accounting', 'use'))
    list.push('rider_cash_overdue', 'rider_frozen');
  if (canDo(p, 'operations', 'manage')) list.push('ops_alert');
  if (canDo(p, 'merchants', 'manage')) list.push('merchant_signup');
  if (canDo(p, 'merchants', 'use')) list.push('merchant_alert');
  // Sales CRM: website leads reach the sales managers' queue; reps hear about their deals.
  if (canDo(p, 'sales', 'manage')) list.push('site_lead');
  if (canDo(p, 'sales', 'use')) list.push('crm_lead', 'crm_followup', 'crm_proposal');
  // HR phase 3: what waits for a manager or HR (leave, attendance fixes, appeals), and news
  // about one's own requests and violations.
  list.push('ticket', 'attendance_late', 'document_expiring', 'hr_request', 'hr_update');
  // My HR: a new payslip of a posted salary run, and expense claims (one's own, and those of
  // one's direct reports waiting for approval).
  list.push('payslip_ready', 'expense_claim');
  // Accounting UX phase A: reminders a person scheduled on a record ("Remind me").
  list.push('activity_due');
  return list;
}

/** A value put into a notification: the same in both languages, or one per language. */
export type PushVar = string | number | { en: string; ar: string };
export type PushVars = Record<string, PushVar>;

const STAGES: Record<string, { en: string; ar: string }> = {
  accept: { en: 'accept', ar: 'القبول' },
  pick: { en: 'pick', ar: 'التجهيز' },
  pack: { en: 'pack', ar: 'التغليف' },
  handover: { en: 'hand over', ar: 'التسليم للمندوب' },
  ride: { en: 'delivery', ar: 'التوصيل' },
};

/** The words of each notification. {name} is replaced by the matching value. */
export const PUSH_TEXT = {
  test: {
    en: ['Test notification', 'Notifications work on this device.'],
    ar: ['إشعار تجريبي', 'الإشعارات تعمل على هذا الجهاز.'],
  },
  order_new: {
    en: ['New order {number}', 'Accept it at {store}; the clock is running.'],
    ar: ['طلب جديد {number}', 'اقبل الطلب في {store}؛ الوقت بدأ.'],
  },
  order_late: {
    en: ['Order {number} is late', 'The {stage} step at {store} is past its time.'],
    ar: ['الطلب {number} متأخر', 'خطوة {stage} في {store} تعدت وقتها.'],
  },
  shipment_arriving: {
    en: [
      'Shipment {reference} is coming',
      '{merchant} sent goods to {store}. Receive them on arrival.',
    ],
    ar: ['شحنة {reference} في الطريق', '{merchant} أرسل بضاعة إلى {store}. استلمها عند وصولها.'],
  },
  transfer_arriving: {
    en: ['Transfer {reference} is on its way', 'Stock from {from} is coming to {store}.'],
    ar: ['التحويل {reference} في الطريق', 'بضاعة من {from} قادمة إلى {store}.'],
  },
  rider_order: {
    en: ['Order {number} is yours', 'Open the rider app to start the delivery.'],
    ar: ['الطلب {number} معك', 'افتح تطبيق المندوب لبدء التوصيل.'],
  },
  rider_withdrawal_requested: {
    en: ['Rider withdrawal {number}', '{rider} at {store} asks for {amount} EGP.'],
    ar: ['طلب سحب مندوب {number}', '{rider} في {store} يطلب {amount} جنيه.'],
  },
  rider_withdrawal_approved: {
    en: ['Withdrawal {number} approved', '{amount} EGP will be paid to you soon.'],
    ar: ['تمت الموافقة على السحب {number}', 'سيتم دفع {amount} جنيه لك قريبًا.'],
  },
  rider_withdrawal_paid: {
    en: ['Withdrawal {number} paid', '{amount} EGP was paid to you.'],
    ar: ['تم دفع السحب {number}', 'تم دفع {amount} جنيه لك.'],
  },
  rider_withdrawal_rejected: {
    en: [
      'Withdrawal {number} not approved',
      'The amount is back in your wallet. Open it for the reason.',
    ],
    ar: ['لم تتم الموافقة على السحب {number}', 'عاد المبلغ إلى محفظتك. افتحها لمعرفة السبب.'],
  },
  finance_request: {
    en: ['Waiting for your approval', '{amount} EGP from {name} needs a second person.'],
    ar: ['في انتظار موافقتك', '{amount} جنيه من {name} تحتاج موافقة شخص ثانٍ.'],
  },
  payout_approval: {
    en: ['Payout {number} to approve', '{merchant}: {amount} EGP needs a second person.'],
    ar: ['دفعة {number} تحتاج موافقة', '{merchant}: {amount} جنيه تحتاج موافقة شخص ثانٍ.'],
  },
  cash_difference: {
    en: ['Cash difference {number}', '{rider} at {store}: counted cash is {amount} EGP off.'],
    ar: ['فرق نقدية {number}', '{rider} في {store}: النقدية المعدودة مختلفة بـ {amount} جنيه.'],
  },
  alert_late: {
    en: ['Order {number} is late', 'The {stage} step at {store} is past its time.'],
    ar: ['الطلب {number} متأخر', 'خطوة {stage} في {store} تعدت وقتها.'],
  },
  alert_server_error: {
    en: ['Server error', '{message}'],
    ar: ['خطأ في الخادم', '{message}'],
  },
  alert_delivery_failed: {
    en: ['Delivery failed: {number}', 'The rider could not deliver order {number}.'],
    ar: ['فشل التوصيل: {number}', 'المندوب لم يستطع توصيل الطلب {number}.'],
  },
  alert_goods_not_returned: {
    en: ['Goods not back: {number}', 'The goods of failed order {number} are not back at {store}.'],
    ar: ['البضاعة لم ترجع: {number}', 'بضاعة الطلب {number} الفاشل لم ترجع إلى {store}.'],
  },
  alert_cod_mismatch: {
    en: ['Cash difference on {number}', 'The cash collected is not what the order asked for.'],
    ar: ['فرق تحصيل في {number}', 'المبلغ المحصل لا يطابق المطلوب في الطلب.'],
  },
  alert_item_missing: {
    en: ['Item missing on {number}', 'A product was missing at pick in {store}.'],
    ar: ['صنف ناقص في {number}', 'منتج لم يوجد أثناء التجهيز في {store}.'],
  },
  alert_shopify_sync_failed: {
    en: ['Shopify call failed', 'A call to Shopify failed after every retry.'],
    ar: ['فشل الاتصال بشوبيفاي', 'اتصال بشوبيفاي فشل بعد كل المحاولات.'],
  },
  alert_transfer_short: {
    en: ['Transfer {reference} is short', 'Units are missing on the transfer to {store}.'],
    ar: ['التحويل {reference} ناقص', 'وحدات ناقصة في التحويل إلى {store}.'],
  },
  merchant_signup: {
    en: ['New merchant sign up', '{name} signed up.'],
    ar: ['تسجيل تاجر جديد', '{name} سجّل حسابًا جديدًا.'],
  },
  site_lead: {
    en: ['New lead from the website', '{name} asked for rates.'],
    ar: ['عميل جديد من الموقع', '{name} طلب الأسعار.'],
  },
  ticket_new: {
    en: ['Ticket {number}: {title}', '{name} opened a ticket for you.'],
    ar: ['تذكرة {number}: {title}', '{name} فتح تذكرة لك.'],
  },
  ticket_reply: {
    en: ['Reply on {number}', '{name}: {body}'],
    ar: ['رد على {number}', '{name}: {body}'],
  },
  attendance_late: {
    en: ['Late clock in', 'You clocked in {minutes} min late on {day}.'],
    ar: ['حضور متأخر', 'سجلت حضورك متأخرًا {minutes} دقيقة يوم {day}.'],
  },
  document_expiring_self: {
    en: ['Your document runs out soon', '{document} runs out on {date}. Send HR the new one.'],
    ar: ['مستندك سينتهي قريبًا', '{document} ينتهي يوم {date}. أرسل الجديد لشؤون العاملين.'],
  },
  document_expired_self: {
    en: ['Your document has run out', '{document} ran out on {date}. Send HR the new one.'],
    ar: ['انتهى مستندك', '{document} انتهى يوم {date}. أرسل الجديد لشؤون العاملين.'],
  },
  document_expiring_hr: {
    en: ['Document runs out: {person}', '{document} runs out on {date}.'],
    ar: ['مستند سينتهي: {person}', '{document} ينتهي يوم {date}.'],
  },
  // Accounting UX phase A: a reminder on a record (a payout, a bill) is due today.
  activity_due: {
    en: ['Reminder: {label}', '{note}'],
    ar: ['تذكير: {label}', '{note}'],
  },
  // HR phase 2: HR asked the person for a missing or expiring document.
  document_reminder: {
    en: ['HR needs a document from you', 'Please send {document}: open My HR to upload it.'],
    ar: ['شؤون العاملين تحتاج مستندًا منك', 'من فضلك أرسل {document}: افتح ملفي لرفعه.'],
  },
  document_expired_hr: {
    en: ['Document ran out: {person}', '{document} ran out on {date}.'],
    ar: ['مستند انتهى: {person}', '{document} انتهى يوم {date}.'],
  },
  merchant_order_delivered: {
    en: ['Order {number} delivered', 'Your customer has the order.'],
    ar: ['تم توصيل الطلب {number}', 'العميل استلم الطلب.'],
  },
  merchant_order_attempt_failed: {
    en: [
      'Delivery attempt failed: {number}',
      'Open the order to retry, ship it normally or cancel.',
    ],
    ar: ['محاولة توصيل فاشلة: {number}', 'افتح الطلب لإعادة المحاولة أو الشحن العادي أو الإلغاء.'],
  },
  merchant_order_failed: {
    en: ['Order {number} failed', 'The order was not delivered.'],
    ar: ['فشل الطلب {number}', 'لم يتم توصيل الطلب.'],
  },
  merchant_payout_paid: {
    en: ['Payout {number} paid', '{amount} EGP was sent to your bank account.'],
    ar: ['تم دفع {number}', 'تم تحويل {amount} جنيه إلى حسابك البنكي.'],
  },
  merchant_payment_reminder: {
    en: ['Payment reminder', 'You owe Shiply Now {amount} EGP. Please transfer it.'],
    ar: ['تذكير بالدفع', 'عليك {amount} جنيه لشيبلي ناو. من فضلك حوّلها.'],
  },
  merchant_low_stock: {
    en: ['Low stock: {product}', '{available} left to sell at {store}.'],
    ar: ['مخزون منخفض: {product}', 'متبقي {available} للبيع في {store}.'],
  },
  rider_cash_overdue: {
    en: [
      'Cash not handed in: {rider}',
      '{rider} at {store} has held {amount} EGP for over {hours} h.',
    ],
    ar: [
      'نقدية لم تُسلَّم: {rider}',
      '{rider} في {store} معه {amount} جنيه منذ أكثر من {hours} ساعة.',
    ],
  },
  crm_lead_assigned: {
    en: ['Deal {number} is yours', '{company}: {name} gave you this deal.'],
    ar: ['الصفقة {number} لك', '{company}: {name} أسند إليك هذه الصفقة.'],
  },
  crm_lead_new: {
    en: ['New lead: {company}', 'A new lead waits to be assigned.'],
    ar: ['عميل محتمل جديد: {company}', 'عميل محتمل جديد ينتظر التوزيع.'],
  },
  crm_followup_due: {
    en: ['Follow up now: {company}', '{subject}'],
    ar: ['متابعة الآن: {company}', '{subject}'],
  },
  crm_followup_overdue: {
    en: ['Follow up overdue: {company}', '{subject} was due {minutes} min ago.'],
    ar: ['متابعة متأخرة: {company}', '{subject} كان موعدها منذ {minutes} دقيقة.'],
  },
  crm_deal_stale: {
    en: ['Deal {number} is stuck', '{company} has been in one stage for {days} days.'],
    ar: ['الصفقة {number} متوقفة', '{company} في نفس المرحلة منذ {days} يومًا.'],
  },
  crm_proposal_approval: {
    en: ['Proposal {number} needs approval', '{company}: {name} offers a discount of {discount}%.'],
    ar: ['العرض {number} يحتاج موافقة', '{company}: {name} يعرض خصمًا {discount}٪.'],
  },
  crm_proposal_approved: {
    en: ['Proposal {number} approved', '{company}: you can send it now.'],
    ar: ['تمت الموافقة على العرض {number}', '{company}: يمكنك إرساله الآن.'],
  },
  crm_proposal_accepted: {
    en: ['{company} accepted {number}', '{name} signed. Confirm it to open the merchant.'],
    ar: ['{company} قبل {number}', 'وقّع {name}. أكّد القبول لفتح حساب التاجر.'],
  },
  crm_proposal_declined: {
    en: ['{company} declined {number}', '{name} declined the proposal.'],
    ar: ['{company} رفض {number}', 'رفض {name} العرض.'],
  },
  leave_waiting_manager: {
    en: ['Leave request from {person}', '{type}: {days} days from {from}. Approve or refuse it.'],
    ar: ['طلب إجازة من {person}', '{type}: {days} يوم من {from}. وافق عليه أو ارفضه.'],
  },
  leave_waiting_hr: {
    en: ['Leave to approve: {person}', '{type}: {days} days from {from}.'],
    ar: ['إجازة للموافقة: {person}', '{type}: {days} يوم من {from}.'],
  },
  leave_manager_approved: {
    en: ['Your manager approved your leave', '{type} from {from} now waits for HR.'],
    ar: ['وافق مديرك على إجازتك', '{type} من {from} في انتظار شؤون العاملين.'],
  },
  leave_approved: {
    en: ['Leave approved', '{type} from {from} to {to} is approved.'],
    ar: ['تمت الموافقة على الإجازة', '{type} من {from} إلى {to} موافق عليها.'],
  },
  leave_rejected: {
    en: ['Leave refused', '{type} from {from}: {reason}'],
    ar: ['تم رفض الإجازة', '{type} من {from}: {reason}'],
  },
  leave_cancelled: {
    en: ['Leave cancelled', '{type} from {from} was cancelled: {reason}'],
    ar: ['تم إلغاء الإجازة', 'تم إلغاء {type} من {from}: {reason}'],
  },
  violation_recorded: {
    en: [
      'A violation was recorded',
      '{type} on {day}. You may appeal within {days} days in My HR.',
    ],
    ar: ['تم تسجيل مخالفة', '{type} يوم {day}. يمكنك التظلم خلال {days} أيام من ملفي.'],
  },
  violation_appealed: {
    en: ['Appeal to decide: {person}', '{number} {type}: {reason}'],
    ar: ['تظلم للبت فيه: {person}', '{number} {type}: {reason}'],
  },
  violation_upheld: {
    en: ['Your appeal was refused', '{number}: the penalty stays. {note}'],
    ar: ['تم رفض تظلمك', '{number}: الجزاء قائم. {note}'],
  },
  violation_cancelled: {
    en: ['Violation cancelled', '{number} was cancelled. {note}'],
    ar: ['تم إلغاء المخالفة', 'تم إلغاء {number}. {note}'],
  },
  violation_termination_review: {
    en: ['Termination review: {person}', '{number} reached the last step of its ladder.'],
    ar: ['مراجعة إنهاء خدمة: {person}', '{number} وصلت لآخر درجة في سلم الجزاءات.'],
  },
  payslip_ready: {
    en: ['Your payslip for {month} is ready', 'Net pay {amount} EGP. Open My HR to see it.'],
    ar: ['قسيمة مرتبك لشهر {month} جاهزة', 'صافي المرتب {amount} جنيه. افتح ملفي لعرضها.'],
  },
  expense_claim_waiting_manager: {
    en: ['Expense claim from {person}', '{number}: {amount} EGP. Approve or refuse it.'],
    ar: ['طلب استرداد مصروف من {person}', '{number}: {amount} جنيه. وافق عليه أو ارفضه.'],
  },
  expense_claim_waiting_accounting: {
    en: ['Expense claim to pay: {person}', '{number}: {amount} EGP is approved and waits.'],
    ar: ['طلب استرداد للدفع: {person}', '{number}: {amount} جنيه موافق عليه وفي الانتظار.'],
  },
  expense_claim_approved: {
    en: ['Expense claim {number} approved', '{amount} EGP now waits for accounting to pay it.'],
    ar: ['تمت الموافقة على الطلب {number}', '{amount} جنيه في انتظار الحسابات للدفع.'],
  },
  expense_claim_paid: {
    en: ['Expense claim {number} paid', '{amount} EGP was paid back to you.'],
    ar: ['تم دفع الطلب {number}', 'تم رد {amount} جنيه لك.'],
  },
  expense_claim_rejected: {
    en: ['Expense claim {number} refused', '{reason}'],
    ar: ['تم رفض الطلب {number}', '{reason}'],
  },
  basata_deposit_submitted: {
    en: ['Basata deposit {number} to check', '{rider} at {store} deposited {amount} EGP.'],
    ar: ['إيداع بساطة {number} للمراجعة', '{rider} في {store} أودع {amount} جنيه.'],
  },
  basata_deposit_approved: {
    en: ['Deposit {number} approved', '{amount} EGP at Basata is accepted.'],
    ar: ['تم قبول الإيداع {number}', 'تم قبول {amount} جنيه في بساطة.'],
  },
  basata_deposit_rejected: {
    en: ['Deposit {number} refused', '{reason}'],
    ar: ['تم رفض الإيداع {number}', '{reason}'],
  },
  rider_frozen: {
    en: ['Rider frozen: {rider}', '{rider} at {store} still held {amount} EGP after the deadline.'],
    ar: ['تم إيقاف المندوب: {rider}', '{rider} في {store} كان معه {amount} جنيه بعد الموعد.'],
  },
  rider_frozen_self: {
    en: [
      'Your account is frozen',
      '{amount} EGP was not handed in by the deadline. Deposit it and call accounting.',
    ],
    ar: ['تم إيقاف حسابك', 'لم يتم تسليم {amount} جنيه في الموعد. أودعه وكلم الحسابات.'],
  },
  rider_unfrozen: {
    en: ['You can work again', 'Accounting unfroze your account.'],
    ar: ['يمكنك العمل مرة أخرى', 'الحسابات ألغت إيقاف حسابك.'],
  },
  correction_waiting_manager: {
    en: ['Attendance fix from {person}', '{day}: {problem}'],
    ar: ['طلب تصحيح حضور من {person}', '{day}: {problem}'],
  },
  correction_waiting_hr: {
    en: ['Attendance fix to apply: {person}', '{day}: {problem}'],
    ar: ['تصحيح حضور للتنفيذ: {person}', '{day}: {problem}'],
  },
  correction_applied: {
    en: ['Your attendance was fixed', '{day} was corrected.'],
    ar: ['تم تصحيح حضورك', 'تم تصحيح يوم {day}.'],
  },
  correction_rejected: {
    en: ['Attendance fix refused', '{day}: {reason}'],
    ar: ['تم رفض تصحيح الحضور', '{day}: {reason}'],
  },
} as const satisfies Record<string, Record<PushLang, readonly [string, string]>>;
export type PushTextKey = keyof typeof PUSH_TEXT;

/** The stage of a late order in words (accept, pick, pack, handover, ride). */
export function stageWords(stage: string | null | undefined): PushVar {
  return (stage && STAGES[stage]) || stage || '';
}

/** Piastres as pounds with two decimals (12345 → 123.45). */
export function egpText(piastres: number): string {
  const sign = piastres < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(piastres));
  const pounds = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}${pounds}.${String(abs % 100).padStart(2, '0')}`;
}

/** Title and body of a notification in one language, never longer than a phone shows. */
export function pushText(
  key: PushTextKey,
  lang: PushLang,
  vars: PushVars = {},
): { title: string; body: string } {
  const [title, body] = PUSH_TEXT[key][lang];
  const fill = (text: string) =>
    text.replace(/\{(\w+)\}/g, (_m, name: string) => {
      const v = vars[name];
      if (v === undefined) return '';
      return typeof v === 'object' ? v[lang] : String(v);
    });
  return { title: clip(fill(title), 80), body: clip(fill(body), 180) };
}

function clip(text: string, max: number) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A device's language as sent by the browser: Arabic or else English. */
export function pushLangOf(value: string | null | undefined): PushLang {
  return value === 'ar' ? 'ar' : 'en';
}

const base64url = z
  .string()
  .min(8)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+=*$/);

/** Body of POST /me/push/subscriptions: what the browser's PushManager answers, plus the language. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).startsWith('https://'),
  keys: z.object({ p256dh: base64url, auth: base64url }),
  /** Missing: a new device starts in English, a known one keeps its language */
  lang: z.enum(PUSH_LANGS).optional(),
  /** The browser renewed the subscription (service worker): the old endpoint it replaces */
  replaces: z.string().url().max(1000).optional(),
});
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionSchema>;

export const pushEndpointSchema = z.object({ endpoint: z.string().url().max(1000) });

export const pushPreferenceSchema = z.object({
  type: z.enum(PUSH_TYPES),
  enabled: z.boolean(),
});

/** What GET /me/push answers. */
export interface MyPush {
  /** The server has VAPID keys and push.enabled is on: devices can be added */
  configured: boolean;
  publicKey: string | null;
  types: { type: PushType; enabled: boolean }[];
  devices: {
    id: string;
    endpoint: string;
    userAgent: string | null;
    lang: PushLang;
    createdAt: string;
    lastSuccessAt: string | null;
    failures: number;
  }[];
}
