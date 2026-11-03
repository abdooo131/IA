// Shopify Customer Events custom pixel -> pixel collector.
// Paste the code between the markers into Settings > Customer events > Add custom pixel.
//
// NOTE: PIXEL_KEY is visible to anyone who loads the storefront (it runs in the browser sandbox).
// The HMAC signature therefore authenticates the source tenant and blocks casual forgery only;
// it is not a strong secret. Rotate the key (tenants.pixel_key) if it is abused.

// ===== custom pixel: begin =====
const COLLECTOR_URL = "https://YOUR-COLLECTOR.onrender.com/e"; // no trailing slash
const TENANT_ID = "1";
const PIXEL_KEY = "REPLACE_WITH_TENANT_PIXEL_KEY";

async function sessionId() {
  let id = await browser.sessionStorage.getItem("ia_sid");
  if (!id) {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    id = Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
    await browser.sessionStorage.setItem("ia_sid", id);
  }
  return id;
}

async function sign(body) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(PIXEL_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function send(event, ts, fields) {
  try {
    const body = JSON.stringify(Object.assign({
      event: event,
      ts: ts || new Date().toISOString(),
      session_id: await sessionId(),
      product_id: null, variant_id: null, available: null,
    }, fields));
    await fetch(COLLECTOR_URL + "/" + TENANT_ID, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "text/plain", "X-Signature": await sign(body) },
      body: body,
    });
  } catch (e) { /* never break the storefront */ }
}

analytics.subscribe("product_viewed", (e) => {
  const v = e.data.productVariant;
  send("product_viewed", e.timestamp, { product_id: v.product.id, variant_id: v.id });
});

analytics.subscribe("product_added_to_cart", (e) => {
  const v = e.data.cartLine.merchandise;
  send("product_added_to_cart", e.timestamp, { product_id: v.product.id, variant_id: v.id });
});

analytics.subscribe("checkout_completed", (e) => {
  const items = e.data.checkout.lineItems.map((l) => ({
    product_id: l.variant.product.id, variant_id: l.variant.id, qty: l.quantity }));
  send("checkout_completed", e.timestamp, { line_items: items });
});

// Custom events published by the theme snippet below.
analytics.subscribe("size_selected", (e) => {
  const c = e.customData || {};
  send("size_selected", e.timestamp, { variant_id: String(c.variant_id), available: !!c.available });
});

analytics.subscribe("notify_me", (e) => {
  const c = e.customData || {};
  send("notify_me", e.timestamp, { variant_id: String(c.variant_id), available: false });
});
// ===== custom pixel: end =====

/* ===== theme snippet (not part of the pixel; add to the theme, e.g. snippets/ia-size-events.liquid) =====

<script>
  // Fire on every variant change. `available` is whether that variant can be bought now.
  document.addEventListener('variant:change', function (ev) {  // adapt to your theme's variant change event
    var v = ev.detail.variant;
    if (!v) return;
    Shopify.analytics.publish('size_selected', { variant_id: v.id, available: v.available });
  });

  // Optional: back in stock sign up button
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-notify-me]');
    if (b) Shopify.analytics.publish('notify_me', { variant_id: b.dataset.variantId });
  });
</script>

===== end theme snippet ===== */
