# Sending orders to Shipply and getting AWBs

The app sends your orders to the Shipply (Eve Chantelle Merchant API, https://shipply.site/docs/api)
and gets back an **AWB** for each one. The AWB is Shipply's `order_number`, for example `EVE-000123`.

## 1. Add your API key

In the Shipply dashboard open **Integrations → REST API** and create a **Test** key first
(it starts with `ec_test_`; sandbox orders are never picked up or billed).

Then either:

* copy `shipply.properties.example` to `shipply.properties` and put the key in it, or
* set the environment variable `SHIPPLY_API_KEY`.

`shipply.properties` is in `.gitignore`. Never commit your key.

When everything works, swap in a **Live** key (`ec_live_`).

## 2. Prepare your orders

Fill `orders_template.csv` (in Excel: Save As **CSV UTF-8**). Required columns:
`external_id`, `customer_name`, `phone`, `address_line`.

Optional: `secondary_phone`, `governorate`, `city`, `area`, `address_notes`, `cod_amount`,
`package_size` (`small_medium`, `large`, `x_large`, `xxl`, `light_bulky`, `heavy_bulky`),
`pieces`, `description`, `allow_open_package` (yes/no), `delivery_notes`.

`external_id` is your own order number. Sending the same one again never creates a duplicate,
so it's safe to resend a file.

## 3. Send

**In the app:** menu **Shipping → Send Orders (get AWBs)**, choose the CSV, click
**Send to Shipply**, then **Save AWBs...**.

**From the command line** (after building into `bin`):

```bash
java -cp bin ShipOrders orders.csv
```

This writes `orders_awb.csv` with: `external_id, awb, status, address_status, fees_total, note`.

If `address_status` is `needs_clarification`, Shipply could not recognise the address. The order
still gets an AWB but can't be picked up until you fix it in the dashboard.
