# Shiply Now Shopify app

The app's server side is part of the API (`apps/api/src/shopify`). This folder holds the
app configuration and, in Step 6, the storefront zone widget (a theme app extension).

## Dev Dashboard settings

Replace `RENDER_URL` with the live address, for example `https://shiplynow.onrender.com`.

| Setting                                                                   | Value                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App URL                                                                   | `RENDER_URL/api/shopify/app`                                                                                                                                                                                                 |
| Embed app in Shopify admin                                                | Off                                                                                                                                                                                                                          |
| Allowed redirection URL                                                   | `RENDER_URL/api/shopify/callback`                                                                                                                                                                                            |
| Use legacy install flow                                                   | On                                                                                                                                                                                                                           |
| Scopes                                                                    | `read_products, read_inventory, write_inventory, read_locations, read_orders, write_order_edits, read_fulfillments, write_fulfillments, read_assigned_fulfillment_orders, write_assigned_fulfillment_orders, write_shipping` |
| Webhooks API version                                                      | `2026-10`                                                                                                                                                                                                                    |
| Webhook `app/uninstalled`                                                 | `RENDER_URL/api/shopify/webhooks`                                                                                                                                                                                            |
| Compliance webhooks (customer data request, customer redact, shop redact) | `RENDER_URL/api/shopify/webhooks`                                                                                                                                                                                            |
| Protected customer data                                                   | Request name, phone and address (riders need them to deliver)                                                                                                                                                                |

## Server settings (Render)

- `SHOPIFY_API_KEY`: the client ID (`f861196e9ba7d2e755655e4e29132d82`)
- `SHOPIFY_API_SECRET`: the client secret, copied from the Dev Dashboard. Never commit it.
- `GOOGLE_MAPS_API_KEY`: needed for the checkout rate, which turns the customer's address
  into a map point. Without it checkout never shows the 60 minute option.
- Use an instance that does not sleep for real customers: Shopify waits only a few seconds
  for rates.

## Connecting a merchant

1. Admin, Shopify: link the merchant to their store address (for example `shiplynow-test`).
2. Open the install link while signed in to that store's Shopify admin and approve the app.
3. The server creates one location per dark store and links products by SKU. Use "Link
   products by SKU" again after adding products, with "also add Shopify products" to copy
   products we do not have yet.
4. In Shopify, products sold for 60 minute delivery must be stocked at the Shiply Now
   locations; Shopify then routes those orders to us.

## Checkout rate (60 minutes, decided before payment)

The install also registers a carrier service called "Shiply Now 60 minutes" and gives each
dark store location its real address (address line 2 reads `Shiply Now <store code>`, which
is how a rate request tells us the store). Admin can turn it on later from the Shopify page
if it failed at install.

At checkout Shopify sends us the cart, the address and the location it plans to ship from.
We return "Delivery in 60 minutes" at the merchant's own price only when that location is the
dark store whose zone holds the address, the store is open and under capacity, and every item
is in stock there. Otherwise we return nothing, so the customer sees only the merchant's own
rates. Shopify keeps each answer for up to 15 minutes. Orders that did not choose our rate
are handed back to the merchant when they reach a dark store location.

What the merchant does once:

1. Use a Shopify plan that includes third party calculated rates (or buy the add on).
2. Set the 60 minute price in Shiply Now, page "60 minute delivery". Only the merchant can.
3. In Shopify, Settings, Shipping and delivery: in the shipping profile that holds the Shiply
   Now locations, add a rate to the Egypt zone with "Use carrier or app to calculate rates"
   and pick "Shiply Now 60 minutes".
4. In Shopify order routing, use the closest location rule so Shopify plans the dark store
   nearest to the customer.

To check on the dev store first: the origin address in the rate request carries the location
address we set.
