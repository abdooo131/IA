import { Injectable } from '@nestjs/common';
import type { AppId } from '@shiply/shared';
import type { SessionUser } from '../types';

export interface AttentionItem {
  app: AppId;
  /** i18n key and its values */
  text: string;
  values?: Record<string, string | number>;
  href: string;
  /** smaller is more urgent */
  urgency: number;
}

export interface HomeNumber {
  app: AppId;
  label: string;
  value: number;
  href: string;
}

type AttentionProvider = (user: SessionUser) => Promise<AttentionItem[]>;
type NumbersProvider = (user: SessionUser) => Promise<HomeNumber[]>;
type CountProvider = (user: SessionUser) => Promise<number>;

/** Modules add what they want on Home; Home shows only what the user's access allows. */
@Injectable()
export class HomeRegistry {
  private readonly attention: AttentionProvider[] = [];
  private readonly numbers = new Map<AppId, NumbersProvider[]>();
  private readonly counts = new Map<AppId, CountProvider[]>();

  addAttention(p: AttentionProvider) {
    this.attention.push(p);
  }
  addNumbers(app: AppId, p: NumbersProvider) {
    this.numbers.set(app, [...(this.numbers.get(app) ?? []), p]);
  }
  addCount(app: AppId, p: CountProvider) {
    this.counts.set(app, [...(this.counts.get(app) ?? []), p]);
  }

  async attentionFor(user: SessionUser) {
    const lists = await Promise.all(this.attention.map((p) => p(user)));
    return lists.flat().filter((i) => user.access[i.app] !== 'none').sort((a, b) => a.urgency - b.urgency);
  }
  async numbersFor(user: SessionUser) {
    const out: HomeNumber[] = [];
    for (const [app, ps] of this.numbers) {
      if (user.access[app] === 'none') continue;
      for (const p of ps) out.push(...(await p(user)));
    }
    return out;
  }
  async countFor(app: AppId, user: SessionUser) {
    let n = 0;
    for (const p of this.counts.get(app) ?? []) n += await p(user);
    return n;
  }
}
