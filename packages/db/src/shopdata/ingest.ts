import type { Prisma } from '@prisma/client';
import type { Db } from '../client';
import { resolveCustomer } from './customers';

// Turns lines of a Shopify bulk export (JSON Lines, children after their parent with
// __parentId) into rows. Every write is an upsert keyed by the Shopify id, so a run repeated
// or resumed changes nothing it already saved.

type Line = Record<string, unknown> & { id?: string; __parentId?: string };
type Money = { shopMoney?: { amount?: string } } | null | undefined;

/** "149.50" (any currency, shop money) to integer piastres, never through a float. */
export function toPiastres(amount: string | null | undefined): number {
  if (!amount) return 0;
  const match = /^(-)?(\d+)(?:\.(\d{1,2})\d*)?$/.exec(String(amount).trim());
  if (!match) return 0;
  const value = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? 0 - value : value;
}
const money = (m: Money) => toPiastres(m?.shopMoney?.amount);
const date = (v: unknown) => (typeof v === 'string' && v ? new Date(v) : null);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const json = (v: unknown) => v as Prisma.InputJsonValue;
const kind = (id: string | undefined) => /gid:\/\/shopify\/(\w+)\//.exec(id ?? '')?.[1];

/** The top level of Shopify's taxonomy, or the product type, so merchants can be compared. */
export function topCategory(fullName: string | null, productType: string | null) {
  const top = fullName?.split('>')[0]?.trim();
  return top || productType?.trim() || 'Uncategorized';
}

function grams(measurement: unknown) {
  const w = (measurement as { weight?: { value?: number; unit?: string } } | null)?.weight;
  if (!w || typeof w.value !== 'number') return null;
  const factor = { GRAMS: 1, KILOGRAMS: 1000, OUNCES: 28.3495, POUNDS: 453.592 }[w.unit ?? 'GRAMS'];
  return Math.round(w.value * (factor ?? 1));
}

/** Products with their variants. Returns how many of each were saved. */
export async function ingestProducts(
  db: Db,
  shop: { id: string; merchantId: string },
  lines: Line[],
) {
  let products = 0;
  let variants = 0;
  for (const l of lines) {
    if (kind(l.id) === 'Product') {
      const category = l.category as { id?: string; fullName?: string } | null;
      const media = l.featuredMedia as { preview?: { image?: { url?: string } } } | null;
      const productType = str(l.productType);
      const data = {
        shopId: shop.id,
        merchantId: shop.merchantId,
        title: str(l.title) ?? '',
        handle: str(l.handle),
        status: str(l.status) ?? 'ACTIVE',
        vendor: str(l.vendor),
        productType,
        categoryId: str(category?.id),
        categoryName: str(category?.fullName),
        categoryTop: topCategory(str(category?.fullName), productType),
        tags: Array.isArray(l.tags) ? (l.tags as string[]) : [],
        imageUrl: str(media?.preview?.image?.url),
        mediaCount: num((l.mediaCount as { count?: number } | null)?.count),
        totalInventory: num(l.totalInventory),
        createdAtShop: date(l.createdAt),
        updatedAtShop: date(l.updatedAt),
        publishedAt: date(l.publishedAt),
        raw: json(l),
      };
      await db.shopProduct.upsert({
        where: { shopifyId: l.id! },
        create: { shopifyId: l.id!, ...data },
        update: data,
      });
      products++;
    } else if (kind(l.id) === 'ProductVariant' && l.__parentId) {
      const item = l.inventoryItem as {
        id?: string;
        unitCost?: { amount?: string } | null;
        measurement?: unknown;
      } | null;
      const data = {
        shopId: shop.id,
        productShopifyId: l.__parentId,
        inventoryItemId: str(item?.id),
        title: str(l.title) ?? '',
        sku: str(l.sku),
        barcode: str(l.barcode),
        pricePiastres: toPiastres(str(l.price)),
        compareAtPiastres: l.compareAtPrice ? toPiastres(str(l.compareAtPrice)) : null,
        costPiastres: item?.unitCost?.amount ? toPiastres(item.unitCost.amount) : null,
        weightGrams: grams(item?.measurement),
        inventoryQuantity: num(l.inventoryQuantity),
        options: json(l.selectedOptions ?? null),
        createdAtShop: date(l.createdAt),
        updatedAtShop: date(l.updatedAt),
        raw: json(l),
      };
      await db.shopVariant.upsert({
        where: { shopifyId: l.id! },
        create: { shopifyId: l.id!, ...data },
        update: data,
      });
      variants++;
    }
  }
  return { products, variants };
}

/**
 * Inventory items and their levels per location. `ourLocations` are the Shopify location ids
 * of our dark stores, so the merchant's own warehouses can be told apart.
 */
export async function ingestInventory(
  db: Db,
  shop: { id: string },
  lines: Line[],
  ourLocations: Set<string>,
) {
  let levels = 0;
  for (const l of lines) {
    if (kind(l.id) !== 'InventoryLevel' || !l.__parentId) continue;
    const location = l.location as { id?: string; name?: string } | null;
    if (!location?.id) continue;
    const q = Object.fromEntries(
      ((l.quantities as { name: string; quantity: number }[] | null) ?? []).map((x) => [
        x.name,
        x.quantity,
      ]),
    );
    const data = {
      shopId: shop.id,
      locationName: location.name ?? '',
      ours: ourLocations.has(location.id),
      available: num(q.available),
      onHand: num(q.on_hand),
      committed: num(q.committed),
      incoming: num(q.incoming),
    };
    await db.shopInventoryLevel.upsert({
      where: {
        inventoryItemId_locationId: { inventoryItemId: l.__parentId, locationId: location.id },
      },
      create: { inventoryItemId: l.__parentId, locationId: location.id, ...data },
      update: data,
    });
    levels++;
  }
  return { levels };
}

/** Orders with their lines. Returns how many of each were saved. */
export async function ingestOrders(
  db: Db,
  shop: { id: string; merchantId: string },
  lines: Line[],
) {
  let orders = 0;
  let items = 0;
  for (const l of lines) {
    if (kind(l.id) === 'Order') {
      const address = l.shippingAddress as {
        name?: string;
        phone?: string;
        address1?: string;
        address2?: string;
        province?: string;
        city?: string;
        countryCodeV2?: string;
      } | null;
      const buyer = l.customer as {
        id?: string;
        firstName?: string;
        lastName?: string;
        defaultEmailAddress?: { emailAddress?: string } | null;
        defaultPhoneNumber?: { phoneNumber?: string } | null;
      } | null;
      const createdAt = date(l.createdAt) ?? new Date(0);
      // Only when the app may read customer contact details (otherwise these are all empty).
      const customerId = await resolveCustomer(db, {
        phone: str(l.phone) ?? str(address?.phone) ?? str(buyer?.defaultPhoneNumber?.phoneNumber),
        email: str(l.email) ?? str(buyer?.defaultEmailAddress?.emailAddress),
        name:
          str(address?.name) ??
          ([buyer?.firstName, buyer?.lastName].filter(Boolean).join(' ') || null),
        governorate: address?.province,
        city: address?.city,
        address: [address?.address1, address?.address2].filter(Boolean).join(', '),
        seenAt: createdAt,
      });
      const data = {
        shopId: shop.id,
        merchantId: shop.merchantId,
        name: str(l.name) ?? '',
        createdAtShop: createdAt,
        processedAt: date(l.processedAt),
        updatedAtShop: date(l.updatedAt),
        cancelledAt: date(l.cancelledAt),
        financialStatus: str(l.displayFinancialStatus),
        fulfillmentStatus: str(l.displayFulfillmentStatus),
        currency: str(l.currencyCode) ?? 'EGP',
        subtotalPiastres: money(l.subtotalPriceSet as Money),
        discountsPiastres: money(l.totalDiscountsSet as Money),
        shippingPiastres: money(l.totalShippingPriceSet as Money),
        taxPiastres: money(l.totalTaxSet as Money),
        totalPiastres: money(l.totalPriceSet as Money),
        refundedPiastres: money(l.totalRefundedSet as Money),
        units: num(l.currentSubtotalLineItemsQuantity) || num(l.subtotalLineItemsQuantity),
        sourceName: str(l.sourceName),
        province: str(address?.province),
        city: str(address?.city),
        country: str(address?.countryCodeV2),
        tags: Array.isArray(l.tags) ? (l.tags as string[]) : [],
        test: l.test === true,
        raw: json(l),
        customerId,
        customerShopifyId: str(buyer?.id),
      };
      await db.shopOrder.upsert({
        where: { shopifyId: l.id! },
        create: { shopifyId: l.id!, ...data },
        update: data,
      });
      orders++;
    } else if (kind(l.id) === 'LineItem' && l.__parentId) {
      const quantity = num(l.quantity);
      const unit = money(l.originalUnitPriceSet as Money);
      const discount = money(l.totalDiscountSet as Money);
      const data = {
        orderShopifyId: l.__parentId,
        productShopifyId: str((l.product as { id?: string } | null)?.id),
        variantShopifyId: str((l.variant as { id?: string } | null)?.id),
        sku: str(l.sku),
        title: str(l.name) ?? '',
        vendor: str(l.vendor),
        quantity,
        currentQuantity: typeof l.currentQuantity === 'number' ? l.currentQuantity : quantity,
        unitPricePiastres: unit,
        discountPiastres: discount,
        totalPiastres: unit * quantity - discount,
      };
      await db.shopOrderLine.upsert({
        where: { shopifyId: l.id! },
        create: { shopifyId: l.id!, ...data },
        update: data,
      });
      items++;
    }
  }
  return { orders, items };
}
