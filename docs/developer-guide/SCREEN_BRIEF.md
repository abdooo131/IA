# Brief for the screen chapters of the Accounting developer guide

You write ONE chapter of a professional English developer guide (it becomes a PDF) that shows the
Shiply Now Accounting app EXACTLY as a user sees it: every screen, tab, panel, filter, column, field
and button, what each does, the rule behind it, who may use it, and what the result looks like.

## The running system (local copy, demo data, never the live system)
- Web: http://localhost:3100  (API behind it on 127.0.0.1:4100). Already running; do not restart it.
  If it stops answering, run /tmp/claude-0/doc-servers.sh once.
- Sign in at /login. Credentials are in /home/user/IA/.env: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
  (admin, sees everything). Demo users use SEED_DEMO_PASSWORD: finance@shiplynow.local and
  demo.finance.approver@shiplynow.local (finance, a second person for approvals),
  merchant@lotusbeauty.example (a merchant), staff.maadi@shiplynow.local (store staff),
  rider.maadi@shiplynow.local (rider). Read them with a script; NEVER write any password or the
  .env contents into the chapter, the screenshots or your report.
- The database is a throwaway copy (shiplynow_doc). You MAY perform actions to show results
  (upload a file, save a form, approve with the second user, mark paid) — it is demo data.
  Do not edit code in /home/user/IA and do not commit anything.
- Playwright: write scripts as .cjs in your own scratch folder and run with
  NODE_PATH=/opt/node22/lib/node_modules node script.cjs. Desktop shots: viewport 1440x900,
  deviceScaleFactor 2 (people will read them), fullPage only when the page is not too long
  (crop to the relevant area otherwise: use locator.screenshot() for panels and dialogs).
  Phone shots: devices['iPhone 13']. Arabic: set cookie shiply_locale=ar on localhost.
  Sample files to upload: create a small PNG receipt and a small PDF yourself.
- Code is at /home/user/IA (branch combine-acct). Read the page and component code to describe every
  control correctly (what it calls, the rule, the error messages from apps/web/messages/en.json).
  CLAUDE.md lists every business rule.

## Output
- Screenshots: /tmp/claude-0/-home-user-IA/40801b4f-1390-58d8-a29e-d4fc08a2dd9b/scratchpad/devdoc/shots/<PREFIX>-<slug>.png
  (use your chapter PREFIX on every file so helpers never clash).
- Chapter: an HTML fragment at .../scratchpad/devdoc/chapters/<NN>-<name>.html
  Allowed markup only: <section class="chapter" id="..."> with <h1> (chapter title), <h2 id="..."> one
  per screen, <h3>/<h4>, <p>, <ul>/<ol>/<li>, <table class="data"> (thead/tbody), <code>,
  <div class="note">, <div class="rule">, <div class="example">,
  <figure class="shot" data-shot="<PREFIX>-<slug>"><figcaption>Figure caption: what it shows and the address</figcaption></figure>
  The build inserts shots/<data-shot>.png. Do not number headings yourself.
- For every screen (h2): address and menu path; who can open it and which buttons need use or
  manage; one screenshot of the whole screen; then a table "Controls on this screen" with one row
  per button, tab, filter, column, field: Control | What it does | Rule / limits | Result. Then
  screenshots of important states: filters panel open, a form filled in, a confirmation, an error,
  the result after the action (e.g. the entry it posted, the request waiting in Approvals), the
  attachment field with files chosen, the attachment viewer. Link to the calculations chapters by
  name when a button posts money (e.g. "see Merchant money, payouts").
- Plain, precise English. NEVER hyphens in prose (code, addresses and file names may keep them).
  No real people or brand names: the demo merchants are Lotus Beauty, Nile Pantry, Bayt Home & Care;
  if any other real looking name, email or phone appears in a screenshot, do not use that shot.
- Be complete for your screens: every control. Report at the end: files written, number of shots,
  anything that did not work in the app (a bug you noticed: describe it exactly, it will be fixed).
