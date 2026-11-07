import { Injectable } from '@nestjs/common';
import { getSetting } from '@shiplynow/db';
import { DeliveryResolver } from '../coverage/delivery-resolver.service';
import { StoreStatusService } from '../coverage/store-status.service';
import { storeMarker } from './shopify-setup.service';
import { ShopifySyncService } from './shopify-sync.service';
import { ShopifyService } from './shopify.service';

/** The address fields Shopify sends to API created carrier services. */
interface RateAddress {
  country?: string | null;
  postal_code?: string | null;
  province?: string | null;
  city?: string | null;
  address1?: string | null;
  address2?: string | null;
}

export interface RateRequest {
  rate?: {
    origin?: RateAddress;
    destination?: RateAddress;
    items?: {
      sku?: string | null;
      quantity?: number;
      variant_id?: number | string | null;
      requires_shipping?: boolean;
    }[];
    currency?: string;
    locale?: string;
  };
}

export interface ShopifyRate {
  service_name: string;
  service_code: string;
  total_price: string;
  description: string;
  currency: 'EGP';
}

/** Why no 60 minute rate was offered; logged so admin can see what checkout saw. */
export type RateReason =
  | 'offered'
  | 'shop_not_active'
  | 'no_price'
  | 'currency'
  | 'outside_egypt'
  | 'unknown_origin'
  | 'nothing_to_ship'
  | 'address_not_found'
  | 'address_unsure'
  | 'outside_zone'
  | 'store_closed'
  | 'at_capacity'
  | 'unknown_product'
  | 'out_of_stock';

/** Thrown when we cannot decide now; Shopify then retries after 30 seconds instead of 15 minutes. */
export class RatesUnavailableError extends Error {}

/** The rate code: Shiply Now 60 minutes from one store. The order intake reads it back. */
export const RATE_CODE_PREFIX = 'SN60:';

@Injectable()
export class ShopifyRatesService {
  constructor(
    private readonly shopify: ShopifyService,
    private readonly resolver: DeliveryResolver,
    private readonly status: StoreStatusService,
    private readonly sync: ShopifySyncService,
  ) {}

  private get prisma() {
    return this.shopify.prisma;
  }

  /**
   * Answers one checkout rate request. The 60 minute rate is offered only when the delivery
   * decision (resolveDelivery) says the address is served, by the dark store Shopify plans to
   * ship from, that store is open and under capacity, and every item is in stock there. An
   * address we are unsure of gets no 60 minute rate. Every check runs before the customer can
   * pay, so no order reaches us that we cannot serve.
   */
  async quote(
    shopId: string,
    body: RateRequest,
  ): Promise<{ rates: ShopifyRate[]; reason: RateReason }> {
    const none = (reason: RateReason) => ({ rates: [], reason });
    const shop = await this.prisma.shopifyShop.findUnique({
      where: { id: shopId },
      include: { merchant: true },
    });
    if (!shop || shop.status !== 'active') return none('shop_not_active');
    const price = shop.merchant.expressPricePiastres;
    if (price == null) return none('no_price');
    const rate = body.rate ?? {};
    if ((rate.currency ?? 'EGP') !== 'EGP') return none('currency');
    if ((rate.destination?.country ?? '').toUpperCase() !== 'EG') return none('outside_egypt');

    const marker = (rate.origin?.address2 ?? '').trim().toLowerCase();
    const locations = await this.prisma.shopifyLocation.findMany({
      where: { shopId: shop.id, isActive: true },
      include: { darkStore: true },
    });
    const location = locations.find(
      (l) => l.darkStore.isActive && storeMarker(l.darkStore.code).toLowerCase() === marker,
    );
    if (!location) return none('unknown_origin');
    const store = location.darkStore;

    const wanted = new Map<string, number>();
    const items = (rate.items ?? []).filter((i) => i.requires_shipping !== false);
    if (items.length === 0) return none('nothing_to_ship');
    for (const item of items) {
      const code = (item.sku ?? '').trim();
      const variant = item.variant_id ? `gid://shopify/ProductVariant/${item.variant_id}` : null;
      const sku = await this.prisma.sku.findFirst({
        where: {
          merchantId: shop.merchantId,
          isActive: true,
          OR: [
            ...(variant ? [{ shopifyVariantId: variant }] : []),
            ...(code ? [{ sku: code }] : []),
          ],
        },
        select: { id: true },
      });
      if (!sku) return none('unknown_product');
      wanted.set(sku.id, (wanted.get(sku.id) ?? 0) + Math.max(0, Number(item.quantity) || 0));
    }

    const decision = await this.decide(rate.destination!);
    if (!decision) return none('address_not_found');
    if (decision.status === 'unsure') {
      // The lookup failed and nothing else could decide: Shopify should ask again soon.
      if (decision.reason === 'geocoder_failed')
        throw new RatesUnavailableError('geocoding unavailable');
      return none('address_unsure');
    }
    const servedHere =
      decision.status === 'served' &&
      (decision.store?.id === store.id ||
        decision.alternatives.some((a) => a.store.id === store.id));
    if (!servedHere) return none('outside_zone');

    const state = (await this.status.statusOf([store.id])).get(store.id)!;
    if (!state.openNow) return none('store_closed');
    if (state.atCapacity) return none('at_capacity');

    const available = await this.sync.availableAt(store.id, shop.merchantId);
    for (const [skuId, quantity] of wanted)
      if ((available.get(skuId) ?? 0) < quantity) return none('out_of_stock');

    const minutes = await getSetting(this.prisma, 'sla.promise_minutes', store.id);
    const arabic = (rate.locale ?? '').toLowerCase().startsWith('ar');
    return {
      reason: 'offered',
      rates: [
        {
          service_name: arabic ? `توصيل خلال ${minutes} دقيقة` : `Delivery in ${minutes} minutes`,
          service_code: `${RATE_CODE_PREFIX}${store.code}`,
          total_price: String(price),
          description: arabic
            ? `يصل خلال ${minutes} دقيقة من Shiply Now`
            : `Arrives within ${minutes} minutes from Shiply Now`,
          currency: 'EGP',
        },
      ],
    };
  }

  /** The delivery decision for the checkout address; null when there is no address at all. */
  private async decide(address: RateAddress) {
    const text = [address.address1, address.address2, address.city, address.province]
      .map((p) => (p ?? '').trim())
      .filter(Boolean)
      .join(', ');
    if (!text) return null;
    return this.resolver.resolve({ addressText: text });
  }
}
