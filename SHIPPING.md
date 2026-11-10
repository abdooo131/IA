# Sending orders to Shipply and getting AWBs

The app sends your orders to the Shipply (Eve Chantelle Merchant API, https://shipply.site/docs/api)
and gets back an **AWB** for each one. The AWB is Shipply's `order_number`, for example `EVE-000123`.

## Quickest way: the New Order page

Open **Shipping → New Order (API key + form)** in the app.

1. Paste your key in the **Shipply API key** box at the top and click **Save & Connect**.
   It is saved in `shipply.properties` on your computer, so next time it connects by itself.
   The line under the box tells you if you are in **TEST** mode (nothing is shipped) or **LIVE**.
2. Fill in the order. Only order number (filled in for you), customer name, phone and address are
   required. Governorate and City lists come straight from Shipply.
3. Click **Create order**. The AWB appears in large text with a **Copy AWB** button, and every
   order you create is listed on the right.

## Printing the AWBs

The app prints its own AWB label: Code 128 barcode of the AWB, customer, phones, address,
the amount to collect in a big box, order number, contents and notes.

* **Print this AWB**: next to the AWB you just created.
* **Print selected / Print all**: for the orders listed on the New Order page
  (hold Ctrl to select several).
* **Reprint an older order**: type its AWB (e.g. `EVE-000123`) or your order number and click
  **Find & print**. The details are fetched from Shipply.
* The **Send Orders from CSV** window has a **Print AWBs...** button too.

Pick the paper in the print window: **label sticker 10 x 15 cm**, **A4 with 4 labels**, or
**A4 with 1 label**. To get a PDF instead: on Mac use the **PDF** button in the print window, on Windows choose **Microsoft Print to PDF**.

Test orders are printed with a red **TEST, NOT SHIPPED** watermark. Check with Shipply that
their couriers accept this label instead of their own waybill.

## Many orders at once: CSV file

### 1. Add your API key

(Already done if you used the New Order page.)

In the Shipply dashboard open **Integrations → REST API** and create a **Test** key first
(it starts with `ec_test_`; sandbox orders are never picked up or billed).

Then either:

* copy `shipply.properties.example` to `shipply.properties` and put the key in it, or
* set the environment variable `SHIPPLY_API_KEY`.

`shipply.properties` is in `.gitignore`. Never commit your key.

When everything works, swap in a **Live** key (`ec_live_`).

### 2. Prepare your orders

Fill `orders_template.csv` (in Excel: Save As **CSV UTF-8**). Required columns:
`external_id`, `customer_name`, `phone`, `address_line`.

Optional: `secondary_phone`, `governorate`, `city`, `area`, `address_notes`, `cod_amount`,
`package_size` (`small_medium`, `large`, `x_large`, `xxl`, `light_bulky`, `heavy_bulky`),
`pieces`, `description`, `allow_open_package` (yes/no), `delivery_notes`.

`external_id` is your own order number. Sending the same one again never creates a duplicate,
so it's safe to resend a file.

### 3. Send

**In the app:** menu **Shipping → Send Orders from CSV (get AWBs)**, choose the CSV, click
**Send to Shipply**, then **Save AWBs...**.

**From the command line** (after building into `bin`):

```bash
java -cp bin ShipOrders orders.csv
```

This writes `orders_awb.csv` with: `external_id, awb, status, address_status, fees_total, note`.

If `address_status` is `needs_clarification`, Shipply could not recognise the address. The order
still gets an AWB but can't be picked up until you fix it in the dashboard.
