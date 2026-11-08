# Going to production

Checked on 2026-11-08 against the live service (Render `shiplynow`, Frankfurt) and the live
database (Neon `bitter-darkness-27227475`). Work through it top to bottom: section 1 must be done
before the first real merchant, order or payment.

## 1. Blockers

1. **Hosting plan.** The service is on Render's free plan: it sleeps after 15 minutes without
   visits and takes about a minute to wake. Shopify waits only a few seconds for checkout rates,
   riders and couriers lose minutes, and the background jobs (SLA flags, payouts, attendance
   close, push, email, SMS) stop while it sleeps. Move to an always on plan (Starter or higher)
   and set the health check path to `/login`.
2. **Database plan and backups.**
   1. Put the Neon project on a paid plan so it never pauses and keeps a restore window of at
      least 7 days.
   2. The nightly encrypted backup (`.github/workflows/backup.yml`) is not running: GitHub runs
      scheduled jobs only from the default branch, which is `main`, and the job lives on
      `ShiplyNow`. Make `ShiplyNow` the default branch (or copy the job to `main`), add the
      secrets `BACKUP_DATABASE_URL` and `BACKUP_PASSPHRASE`, run it once by hand and restore it
      into a throwaway Neon branch following docs/BACKUP.md.
3. **Remove the test data and test accounts.** The live database still has 34 test accounts
   (`*.local` and `*.example`: hub staff, couriers, agents, store staff, riders, finance) whose
   passwords are known to everyone who saw the seed. Before real use:
   1. set `SEED_NETWORK_DEMO=off`, remove `SEED_DEMO_PASSWORD` and `DEMO_LOAD` from Render;
   2. run the fresh start once (`FRESH_START`, docs/DEPLOY.md), which keeps the owner account,
      places, the area map, settings, HR structure, chart of accounts and company profile;
   3. check that only `admin@shiplynow.local` (renamed to the owner's real email) remains.
4. **Text messages.** Delivery codes, packaging codes and sign in codes for Shiply are only
   queued: no SMS gateway is connected. Choose an Egyptian SMS and WhatsApp provider (for example
   Vodafone, Cequens, Victory Link) and set `MESSAGES_WEBHOOK_URL` and `MESSAGES_WEBHOOK_TOKEN`.
   Without it no next day parcel that needs a delivery code can be delivered.
5. **Address lookups.** Set `GOOGLE_MAPS_API_KEY` (Geocoding API, restricted to the server). In
   production the free OpenStreetMap lookup is off, so typed addresses answer
   `geocoding_not_configured` and Shopify checkout shows no 60 minute rate when unsure.
6. **Domain and cookies.** Put the app on its own domain (for example `app.shiply.com`) with
   HTTPS, then set `WEB_ORIGIN` to it, keep `COOKIE_SECURE=true`, and update the Shopify apps'
   URLs (`pnpm shopify:merchant-app` per merchant) and the Slack app if used.
7. **Secrets.** Generate a new long `JWT_ACCESS_SECRET` (signs everyone out once), keep
   `SHOPIFY_API_SECRET` set (every Shopify signature check refuses everything without it), and
   use a strong owner password. Secrets live only in Render's environment, never in the repo.

## 2. Business setup (owner and accountant)

1. **Company profile** (Accounting, Setup, Company): legal name, tax registration number,
   commercial register, address, item codes per fee kind, e-invoice switch.
2. **Banks and boxes**: CIB and any other bank accounts, each dark store's box, each hub safe;
   then the opening balances once (owner only).
3. **Taxes**: VAT rate (`finance.vat_bp`, still empty), withholding rates per supplier, payroll
   rates and bands (`payroll.*`, defaults follow the 2026 law as known and must be confirmed),
   corporate tax rate. ETA e-invoice credentials (`ETA_ENV`, `ETA_CLIENT_ID`,
   `ETA_CLIENT_SECRET`) and the signing program on the finance PC with the USB token.
4. **Standard prices**: every `fee.*` setting for Shiply Now and the `parcels.*` prices and price
   zones for Shiply; approval limits (`finance.approval_threshold_piastres`), rider cash limit,
   petty cash limits, payout minimum.
5. **Places**: dark stores with hours, zones and bins; Shiply's sorting facilities and hubs with
   coverage per governorate and area (`SEED_COVERAGE` stays unset: launch is Cairo and Giza).
6. **Merchants**: each with a contract version (60 minute and next day prices together), payout
   bank account and schedule, tax details, users and their rights, Shopify app connected.
7. **Suppliers and agents**: courier agencies opened as agents (each becomes a supplier with its
   tax id and withholding rate), packaging suppliers, recurring expenses.
8. **People**: departments, positions, grades, shifts and holidays in HR; every team member
   hired through the New hire wizard with the right job role, stores and switches; couriers
   added by their agent and approved; salary packages for employees.

## 3. Integrations

1. **Shopify**: one custom app per merchant (docs/SHOPIFY_DATA.md), plan with carrier
   calculated rates, app embed switched on, protected customer data approved, a test order
   through checkout for each store.
2. **Email** (`SMTP_*`): payout statements, invoices and notices to merchants.
3. **Push** (`VAPID_*`): phone notifications for every role; iPhones need Add to Home Screen.
4. **Slack** (optional, `SLACK_*`): tickets.
5. **Payments in**: Fawry or bank collections for couriers paying in cash is not connected; cash
   is handed in at the hub.

## 4. Before the first day

1. Train each role with its SOP (`/help`): store staff, riders, hub staff, couriers, agents,
   merchants, finance, admins.
2. Devices: phones with camera and location for riders and couriers (the app needs HTTPS for the
   camera), barcode scanners and A6 label printers at dark stores and hubs.
3. Dry run for one full day on the real system with one friendly merchant: receive stock, a 60
   minute order, a next day parcel through a facility, a failed attempt, cash handover, a
   payout, a supplier bill, the day close and the attendance board.
4. Close the dry run with the fresh start again only if real money was not involved; otherwise
   correct with reversing entries.

## 5. Running it

1. **Watch**: Render failure emails on, an uptime check on `/login` every 5 minutes, the alerts
   list (both companies) and `server_error` alerts each morning.
2. **Every day**: cash handovers and differences, late orders and parcels, missing check ins.
3. **Every month**: month end checklist, payroll, invoices, VAT return, close the books.
4. **Every quarter**: restore a backup into a throwaway branch to prove it works.
5. **Data protection**: customer profiles are personal data (PDPL). Publish a privacy notice on
   the website, keep customer data access to the people who need it, and answer deletion
   requests through Shopify's redact flow.

## 6. Still to build

1. One Shopify app offering both 60 minute and next day delivery.
2. Delete `shiply-core/` and anything the merge left unused.
3. Tax invoices for Shiply's next day fees (deferred by the owner).
4. Payslips for employees to see themselves.
