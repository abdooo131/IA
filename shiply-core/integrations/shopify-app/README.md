# Shiply app for Shopify

How merchants use it:
1. In Shiply, the merchant opens Shopify and connects their store (they approve the app once).
2. In their Shopify orders list they tick the orders they want to ship with Shiply, then choose
   More actions, Ship with Shiply.
3. Shiply opens with those orders. Anything missing (phone, governorate) is marked; orders outside
   the area we deliver to are marked too. They make the AWBs and print the labels.
4. When we pick a parcel up, Shopify marks the order fulfilled and sends the customer the tracking
   link. When the courier collects cash on delivery, Shopify marks the order paid.

Setting it up (once, by Shiply):
1. Make a Shopify Partner account and create an app called Shiply.
2. Put its client id in shopify.app.toml and replace FILL_SHIPLY_WEB_ADDRESS with Shiply's web address.
3. From this folder run: shopify app deploy
4. On the Shiply server set SHOPIFY_API_KEY (client id), SHOPIFY_API_SECRET (client secret) and
   SHOPIFY_APP_URL (Shiply's web address, no slash at the end), then restart.
