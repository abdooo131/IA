import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { PackagingManager } from '@/components/packaging/PackagingManager';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BookAccount } from '@/lib/finance-types';
import type {
  PackagingItem,
  PackagingMovementRow,
  PackagingRecipe,
  PackagingStock,
} from '@/lib/purchasing-types';

export const dynamic = 'force-dynamic';

/** Packaging stock (bags, boxes, labels): our own consumables, per store. */
export default async function PackagingPage() {
  const me = await getMyProfile();
  const canBuy = canDo(me, 'accounting', 'use');
  const [items, stock, recipes, movements, merchants, accounts, t] = await Promise.all([
    apiGet<PackagingItem[]>('/packaging/items'),
    apiGet<PackagingStock>('/packaging/stock'),
    apiGet<PackagingRecipe[]>('/packaging/recipes'),
    apiGet<PackagingMovementRow[]>('/packaging/movements'),
    apiGet<{ id: string; name: string }[]>('/admin/merchants'),
    canBuy ? apiGet<BookAccount[]>('/finance/accounts') : Promise.resolve(null),
    getTranslations('purchasing.packaging'),
  ]);
  const money =
    accounts?.filter((a) => a.isActive && (a.groupCode === 1100 || a.groupCode === 1200)) ?? null;
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <PackagingManager
        data={{
          items,
          stock,
          recipes,
          movements: movements.slice(0, 50),
          merchants: merchants.map((m) => ({ id: m.id, name: m.name })),
          money,
          canManage: canDo(me, 'inventory', 'manage'),
          canCount: canDo(me, 'inventory', 'use'),
        }}
      />
    </>
  );
}
