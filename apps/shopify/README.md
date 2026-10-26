# Shiply Now Shopify app

The app's server side is part of the API (`apps/api/src/shopify`). This folder holds the
app configuration and, in Step 6, the storefront zone widget (a theme app extension).

## Dev Dashboard settings

Replace `RENDER_URL` with the live address, for example `https://shiplynow.onrender.com`.

| Setting                                                                   | Value                                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App URL                                                                   | `RENDER_URL/api/shopify/app`                                                                                                                                                                                 |
| Embed app in Shopify admin                                                | Off                                                                                                                                                                                                          |
| Allowed redirection URL                                                   | `RENDER_URL/api/shopify/callback`                                                                                                                                                                            |
| Use legacy install flow                                                   | On                                                                                                                                                                                                           |
| Scopes                                                                    | `read_products, read_inventory, write_inventory, read_locations, read_orders, write_order_edits, read_fulfillments, write_fulfillments, read_assigned_fulfillment_orders, write_assigned_fulfillment_orders` |
| Webhooks API version                                                      | `2026-10`                                                                                                                                                                                                    |
| Webhook `app/uninstalled`                                                 | `RENDER_URL/api/shopify/webhooks`                                                                                                                                                                            |
| Compliance webhooks (customer data request, customer redact, shop redact) | `RENDER_URL/api/shopify/webhooks`                                                                                                                                                                            |
| Protected customer data                                                   | Request name, phone and address (riders need them to deliver)                                                                                                                                                |

## Server settings (Render)

- `SHOPIFY_API_KEY`: the client ID (`f861196e9ba7d2e755655e4e29132d82`)
- `SHOPIFY_API_SECRET`: the client secret, copied from the Dev Dashboard. Never commit it.

## Connecting a merchant

1. Admin, Shopify: link the merchant to their store address (for example `shiplynow-test`).
2. Open the install link while signed in to that store's Shopify admin and approve the app.
3. The server creates one location per dark store and links products by SKU. Use "Link
   products by SKU" again after adding products, with "also add Shopify products" to copy
   products we do not have yet.
4. In Shopify, products sold for 60 minute delivery must be stocked at the Shiply Now
   locations; Shopify then routes those orders to us.
