import {
  addDays,
  cairoAt,
  cairoDay,
  CRM_SOURCES,
  CRM_STAGES,
  type CrmActivityType,
  type CrmSource,
  type CrmStage,
  daysInStage,
  nextStepState,
} from '@shiplynow/shared';

// The Sales app's screens (docs/SALES.md): what the API answers, and the small rules the board,
// the lists and the forms share.

export interface Person {
  id: string;
  name: string;
}

export interface LostReason {
  code: string;
  labelEn: string;
  labelAr: string;
  active: boolean;
  sortOrder: number;
}

export interface SalesMeta {
  me: { id: string; level: 'none' | 'view' | 'use' | 'manage'; ownOnly: boolean };
  people: (Person & { manager: boolean })[];
  lostReasons: LostReason[];
}

export interface NextStep {
  id: string;
  type: CrmActivityType;
  subject: string;
  dueAt: string;
}

export interface DealCard {
  id: string;
  number: number;
  label: string;
  title: string | null;
  stage: CrmStage;
  expectedMonthlyOrders: number | null;
  expectedMonthlyFeePiastres: number | null;
  expectedCloseDate: string | null;
  stageChangedAt: string;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  createdAt: string;
  company: { id: string; brandName: string; source: CrmSource; city: string | null };
  owner: Person | null;
  nextStep: NextStep | null;
}

export interface Contact {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  phoneValid: boolean;
  email: string | null;
  whatsapp: boolean;
}

export interface Activity {
  id: string;
  type: CrmActivityType;
  subject: string;
  notes: string | null;
  dueAt: string | null;
  doneAt: string | null;
  outcome: string | null;
  createdAt: string;
  owner: Person;
  createdBy?: { name: string } | null;
  deal?: { id: string; number: number; label: string } | null;
}

export interface Company {
  id: string;
  brandName: string;
  website: string | null;
  shopDomain: string | null;
  category: string | null;
  city: string | null;
  expectedMonthlyOrders: number | null;
  source: CrmSource;
  note: string | null;
  ownerId: string | null;
  merchantId: string | null;
  createdAt: string;
}

export interface DealDetail extends Omit<DealCard, 'company' | 'nextStep'> {
  companyId: string;
  lostNote: string | null;
  merchant: { id: string; name: string } | null;
  lostReasonLabel: { en: string; ar: string } | null;
  company: Company & { contacts: Contact[] };
  nextStep: Activity | null;
  activities: Activity[];
  history: {
    id: string;
    fromStage: CrmStage | null;
    toStage: CrmStage;
    changedAt: string;
    lostReason: string | null;
    note: string | null;
    changedBy: { name: string } | null;
  }[];
}

export interface CompanyRow extends Company {
  owner: Person | null;
  merchant: { id: string; name: string } | null;
  contacts: number;
  openDeals: number;
  wonDeals: number;
}

export interface CompanyDetail extends Company {
  owner: Person | null;
  merchant: { id: string; name: string } | null;
  contacts: Contact[];
  deals: DealCard[];
  activities: Activity[];
}

export interface DayActivity extends Omit<Activity, 'deal' | 'createdAt'> {
  company: { id: string; brandName: string };
  deal: { id: string; number: number; stage: CrmStage; label: string } | null;
}

export interface MyDay {
  ownerId: string | null;
  overdue: DayActivity[];
  today: DayActivity[];
  needsNextStep: DealCard[];
}

export const BOARD_STAGES = CRM_STAGES;
export { CRM_SOURCES, daysInStage, nextStepState };

/** The board's columns in pipeline order; won and lost can be hidden. */
export function boardColumns(cards: DealCard[], hideClosed: boolean) {
  const stages = BOARD_STAGES.filter((s) => !hideClosed || (s !== 'won' && s !== 'lost'));
  return stages.map((stage) => {
    const list = cards.filter((c) => c.stage === stage);
    return {
      stage,
      cards: list,
      value: list.reduce((sum, c) => sum + (c.expectedMonthlyFeePiastres ?? 0), 0),
    };
  });
}

/** Moves one card to another stage (the board's quick update before the server answers). */
export function moveCard(cards: DealCard[], id: string, stage: CrmStage, now = new Date()) {
  return cards.map((c) =>
    c.id === id && c.stage !== stage ? { ...c, stage, stageChangedAt: now.toISOString() } : c,
  );
}

/** A Cairo date (YYYY-MM-DD) and wall time (HH:MM) as the instant the API takes. */
export function cairoInstant(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return cairoAt(day, Number(match[1]) * 60 + Number(match[2])).toISOString();
}

/** The default date of a new follow up: tomorrow in Cairo. */
export function tomorrowInCairo(now = new Date()) {
  return addDays(cairoDay(now), 1);
}

/** The query string the board and the list send to the API, from the page's filters. */
export function dealQuery(filters: {
  ownerId?: string;
  source?: string;
  q?: string;
  open?: boolean;
  unassigned?: boolean;
  needsNextStep?: boolean;
  stage?: CrmStage;
}) {
  const params = new URLSearchParams();
  if (filters.ownerId) params.set('ownerId', filters.ownerId);
  if (filters.source && (CRM_SOURCES as readonly string[]).includes(filters.source))
    params.set('source', filters.source);
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.open) params.set('open', 'true');
  if (filters.unassigned) params.set('unassigned', 'true');
  if (filters.needsNextStep) params.set('needsNextStep', 'true');
  if (filters.stage) params.set('stage', filters.stage);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** A link for a phone (tel:) with only digits and a leading +. */
export function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** A WhatsApp chat link for an Egyptian mobile stored as +20…, or null. */
export function whatsappHref(phone: string | null) {
  if (!phone || !/^\+20\d{10}$/.test(phone)) return null;
  return `https://wa.me/${phone.slice(1)}`;
}

/** A website as a link (https added when missing). */
export function websiteHref(website: string | null) {
  if (!website) return null;
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}
