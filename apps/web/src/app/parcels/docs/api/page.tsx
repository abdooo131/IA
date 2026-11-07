'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Logo } from '@/parcels/components/Logo';

function Code({ children }: { children: string }) {
  return <pre dir="ltr" className="overflow-x-auto rounded-lg bg-shiply-navy p-4 text-caption leading-relaxed text-shiply-cream"><code>{children}</code></pre>;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="text-h2">{title}</h2>
      {children}
    </section>
  );
}

function Endpoint({ method, path, children }: { method: string; path: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <p dir="ltr" className="font-mono text-body-sm"><span className="me-2 rounded bg-selected-bg px-2 py-0.5 font-bold text-link">{method}</span>{path}</p>
      <div className="space-y-2 text-body-sm">{children}</div>
    </div>
  );
}

const NAV = [
  ['start', 'Getting started'], ['auth', 'Keys and modes'], ['errors', 'Errors and limits'], ['parcels', 'Parcels'], ['other', 'Prices, places, pickups'],
  ['sandbox', 'Sandbox'], ['webhooks', 'Webhooks'], ['verify', 'Checking signatures'],
];

/** The merchant API guide. Public, so developers can read it before they have an account. */
export default function ApiDocsPage() {
  const [base, setBase] = useState('https://YOUR-SHIPLY-ADDRESS/api/v1');
  useEffect(() => setBase(`${window.location.origin}/api/v1`), []);
  return (
    <div dir="ltr" className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3"><Logo /><span className="text-body-sm font-semibold text-text-muted">API guide, version 1</span></div>
          <Link href="/parcels/merchant/developer" className="btn-secondary">Get your keys</Link>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[13rem_1fr]">
        <nav className="hidden lg:block">
          <ul className="sticky top-20 space-y-2 text-body-sm">{NAV.map(([id, label]) => <li key={id}><a href={`#${id}`} className="text-link">{label}</a></li>)}</ul>
        </nav>
        <main className="min-w-0 space-y-10">
          <Section id="start" title="Getting started">
            <p>The Shiply API lets your store or system create parcels, follow them and print labels. Shiply calls your server back whenever a parcel changes.</p>
            <ol className="list-decimal space-y-1 ps-5">
              <li>Sign in to your merchant panel and open Developers.</li>
              <li>Make a test key. Test keys only work in the sandbox, where nothing reaches a courier.</li>
              <li>When your integration works, make a live key.</li>
            </ol>
            <p>Every address below starts with:</p>
            <Code>{base}</Code>
            <p>Money is always a whole number of piastres: 125.50 EGP is <code>12550</code>. Prices include 14% VAT.</p>
          </Section>

          <Section id="auth" title="Keys and modes">
            <p>Send your key on every call. Keep it on your server; never put it in a website or a phone app.</p>
            <Code>{`curl ${base}/me \\\n  -H "Authorization: Bearer shp_test_..."`}</Code>
            <p>Keys starting with <code>shp_live_</code> work on real parcels. Keys starting with <code>shp_test_</code> work in the sandbox. A test parcel and a live parcel never see each other. If a key leaks, revoke it in Developers and make a new one: it stops working at once.</p>
          </Section>

          <Section id="errors" title="Errors and limits">
            <p>Errors come back with an HTTP status and a body you can show to a person:</p>
            <Code>{`HTTP 422\n{ "error": "invalid_input", "message": "Customer phone must be an Egyptian mobile number" }`}</Code>
            <ul className="list-disc space-y-1 ps-5">
              <li><b>401</b> the key is missing, wrong or revoked.</li>
              <li><b>404</b> no such parcel on this account.</li>
              <li><b>409</b> not possible in the parcel's current state, for example cancelling a parcel already picked up.</li>
              <li><b>422</b> something in the request is not valid.</li>
              <li><b>429</b> too many calls: each key may make 300 calls a minute. Wait the number of seconds in the <code>Retry-After</code> header.</li>
            </ul>
            <p><b>Sending a create twice safely.</b> Add an <code>Idempotency-Key</code> header, such as your order number. If the same key arrives again, you get the first answer back with <code>Idempotent-Replayed: true</code>, and no second parcel is made.</p>
          </Section>

          <Section id="parcels" title="Parcels">
            <Endpoint method="POST" path="/shipments">
              <p>Creates a parcel. It is waiting for pickup at your address. If you have no pickup booked, one is booked for you.</p>
              <Code>{`curl ${base}/shipments \\
  -H "Authorization: Bearer shp_live_..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: ORDER-1001" \\
  -d '{
    "customerName": "Mona Adel",
    "customerPhone": "01012345678",
    "governorateCode": "GIZ",
    "areaId": null,
    "address": "12 Mossadak St, Dokki",
    "size": "M",
    "codAmount": 35000,
    "description": "Dress",
    "notes": "Call before coming",
    "allowOpen": false,
    "exchange": false,
    "customerReturn": false,
    "merchantRef": "ORDER-1001"
  }'`}</Code>
              <p>Sizes: <code>S</code>, <code>M</code>, <code>L</code>, <code>XL</code>, <code>XXL</code>, <code>BULKY</code>. <code>codAmount</code> is what the courier collects; use 0 when already paid. <code>exchange</code> brings the old item back in the same visit. <code>customerReturn</code> asks us to collect an item from your customer and bring it to you.</p>
              <p>The answer:</p>
              <Code>{`{
  "trackingNumber": "SHP0000012345",
  "merchantRef": "ORDER-1001",
  "status": "CREATED",
  "statusLabel": "Created",
  "kind": "NORMAL",
  "direction": "FORWARD",
  "customer": { "name": "Mona Adel", "phone": "+201012345678" },
  "address": "12 Mossadak St, Dokki",
  "governorateCode": "GIZ",
  "size": "M",
  "codAmount": 35000,
  "codCollected": 0,
  "shippingFee": 6500,
  "attempts": 0,
  "failReason": null,
  "deliverOn": null,
  "promisedDate": null,
  "createdAt": "2026-11-07T18:00:00.000Z",
  "trackingUrl": "https://track.example/t/SHP0000012345"
}`}</Code>
            </Endpoint>
            <Endpoint method="POST" path="/shipments/bulk">
              <p>Up to 100 parcels in one call: <code>{'{ "shipments": [ ... ] }'}</code>. Each one is made on its own, so one bad row does not stop the others. The answer lists each row with <code>ok</code> and either the parcel or the error.</p>
            </Endpoint>
            <Endpoint method="GET" path="/shipments/{trackingNumber}">
              <p>The parcel with its full history in <code>events</code>.</p>
            </Endpoint>
            <Endpoint method="GET" path="/shipments?status=DELIVERED&limit=50&after=SHP0000012345">
              <p>Your parcels, newest first. Pass the <code>next</code> value from one page as <code>after</code> to get the next page. Optional: <code>status</code>, <code>createdFrom</code> (YYYY MM DD with dashes).</p>
            </Endpoint>
            <Endpoint method="POST" path="/shipments/{trackingNumber}/cancel">
              <p>Cancels a parcel we have not picked up yet.</p>
            </Endpoint>
            <Endpoint method="GET" path="/shipments/{trackingNumber}/label">
              <p>What to print on a 100 by 150 mm label, if you print your own. The barcode is CODE128 of the tracking number; <code>route</code> is the big code that tells our hubs where it goes.</p>
            </Endpoint>
            <p>Statuses: <code>CREATED</code>, <code>PICKED_UP</code>, <code>AT_INBOUND</code>, <code>SORTED</code>, <code>AT_OUTBOUND</code>, <code>IN_TRANSIT</code>, <code>AT_HUB</code>, <code>ON_HOLD</code>, <code>OUT_FOR_DELIVERY</code>, <code>ATTEMPT_FAILED</code>, <code>DELIVERED</code>, <code>RETURNED</code>, <code>CANCELLED</code>, <code>LOST</code>. The last four never change again, except a lost parcel that is found.</p>
          </Section>

          <Section id="other" title="Prices, places, pickups">
            <Endpoint method="GET" path="/quote?governorateCode=GIZ&size=M&allowOpen=&exchange=">
              <p>Your price for a parcel before you create it, with any discount you have.</p>
            </Endpoint>
            <Endpoint method="GET" path="/locations">
              <p>Every governorate code and its areas, in English and Arabic. Send <code>areaId</code> when you know it: it routes the parcel to the right hub.</p>
            </Endpoint>
            <Endpoint method="POST" path="/pickups">
              <p>Books a pickup: <code>{'{ "date": "2026-11-08", "notes": "After 2pm" }'}</code>.</p>
            </Endpoint>
          </Section>

          <Section id="sandbox" title="Sandbox">
            <p>With a test key, parcels are checked and priced exactly like live ones, get numbers starting with TEST, and never reach a courier. Move one through its life by hand to try your webhooks:</p>
            <Code>{`curl ${base}/sandbox/shipments/TEST000000001/advance \\
  -H "Authorization: Bearer shp_test_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "OUT_FOR_DELIVERY" }'`}</Code>
            <p>Allowed: <code>PICKED_UP</code>, <code>AT_HUB</code>, <code>OUT_FOR_DELIVERY</code>, <code>DELIVERED</code>, <code>ATTEMPT_FAILED</code>, <code>RETURNED</code>, <code>CANCELLED</code>. Only webhooks set to test mode hear about sandbox parcels.</p>
          </Section>

          <Section id="webhooks" title="Webhooks">
            <p>Add your address in Developers and choose the events. We send a POST with a JSON body:</p>
            <Code>{`POST https://shop.example/shiply/webhook
Shiply-Event: shipment.delivered
Shiply-Delivery: 6f1c...
Shiply-Signature: t=1762538400,v1=5d3a...

{
  "id": "6f1c...",
  "event": "shipment.delivered",
  "at": "2026-11-07T18:30:00.000Z",
  "mode": "LIVE",
  "data": {
    "trackingNumber": "SHP0000012345",
    "merchantRef": "ORDER-1001",
    "status": "DELIVERED",
    "previousStatus": "OUT_FOR_DELIVERY",
    "codCollected": 35000,
    "...": "the same fields as the parcel"
  }
}`}</Code>
            <p>Events: <code>shipment.created</code>, <code>shipment.updated</code> (every change of status), <code>shipment.delivered</code>, <code>shipment.failed_attempt</code>, <code>shipment.returned</code>, <code>shipment.cancelled</code>.</p>
            <ul className="list-disc space-y-1 ps-5">
              <li>Answer with any 2xx status within 10 seconds. Do slow work after you answer.</li>
              <li>If you do not, we try again after 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours and 12 hours, then stop. You can send any call again from Developers.</li>
              <li>A call can arrive more than once, and not always in order. Use <code>id</code> to skip ones you already handled, and <code>at</code> to keep the newest.</li>
              <li>After 25 failed calls in a row the webhook is turned off. Turn it back on in Developers once your server is fixed.</li>
              <li>Addresses must use https and be reachable from the internet.</li>
            </ul>
          </Section>

          <Section id="verify" title="Checking signatures">
            <p>Every call is signed with your webhook's secret. Check it before you trust the body, and refuse calls older than 5 minutes.</p>
            <Code>{`// Node.js, with the raw request body as a string
const crypto = require('crypto');

function fromShiply(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`}</Code>
            <Code>{`<?php // PHP
function from_shiply($rawBody, $header, $secret) {
  parse_str(str_replace(',', '&', $header), $p);
  if (abs(time() - (int)$p['t']) > 300) return false;
  $expected = hash_hmac('sha256', $p['t'] . '.' . $rawBody, $secret);
  return hash_equals($expected, $p['v1'] ?? '');
}`}</Code>
          </Section>
        </main>
      </div>
    </div>
  );
}
