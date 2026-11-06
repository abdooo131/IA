import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_FOR_DATA,
  customersExport,
  orderForData,
  ordersExport,
} from '../src/shopify/graphql';
import { SHOPIFY_SCOPES } from '../src/shopify/shopify.service';
import { kitToml } from '../src/shopify/widget-kit';

const TOML = readFileSync(path.resolve(__dirname, '../../shopify/shopify.app.toml'), 'utf8');
const tomlScopes = () => /^scopes = "(.*)"$/m.exec(TOML)?.[1]?.split(',') ?? [];

describe('Shopify permissions and the fields we read', () => {
  it('asks read_all_orders at every install, in the app settings and in every merchant kit', () => {
    expect(SHOPIFY_SCOPES.split(',')).toContain('read_all_orders');
    // The install link and the app settings ask the same permissions.
    expect([...tomlScopes()].sort()).toEqual([...SHOPIFY_SCOPES.split(',')].sort());
    const kit = kitToml(TOML, {
      clientId: 'merchant-app',
      name: 'Nile Pantry',
      publicUrl: 'https://example.test',
    });
    expect(/^scopes = "(.*)"$/m.exec(kit)?.[1]?.split(',')).toContain('read_all_orders');
  });

  it('reads payment, shipping line, discounts, cancel reason, refunds, attributes and points', () => {
    for (const query of [ordersExport(undefined, 'full'), orderForData('full')]) {
      for (const field of [
        'paymentGatewayNames',
        'shippingLine { code title source }',
        'discountCodes',
        'cancelReason',
        'refunds {',
        'customAttributes { key value }',
        'latitude longitude',
      ])
        expect(query).toContain(field);
    }
    // Without buyer details Shopify still gives the order facts, but no point or attributes.
    const limited = ordersExport(undefined, 'contact');
    expect(limited).toContain('paymentGatewayNames');
    expect(limited).not.toContain('latitude');
    expect(limited).not.toContain('customAttributes');
    for (const query of [customersExport(undefined), CUSTOMER_FOR_DATA])
      expect(query).toMatch(/locale[\s\S]*defaultAddress \{[^}]*latitude longitude/);
  });
});
