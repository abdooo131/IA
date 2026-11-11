# Accounting developer guide (work in progress)

Source of the English developer guide PDF about the accounting system and its screens.

- chapters/: HTML fragments, one per chapter (01 to 20 text, 30 to 34 screens).
- small/: the screenshots as compressed JPEG (taken from a local copy with demo data only).
- build.mjs + style.css: build the PDF (cover, contents with page numbers, page numbers).
  Run: node docs/developer-guide/build.mjs (needs Playwright at /opt/node22, pdftotext and pypdf).
  shrink.py remakes small/ only when the full size PNG folder shots/ exists (not committed).

State when saved (2026-11-11, 23:55 Cairo): all chapters are written. A final pass was filling
the remaining "data-todo" notes (payout SOA/POT, suppliers, PO assets, attachments, journal page,
forecast, payments due, budgets), adding the postal fee section to chapter 10, and moving the
"problems found" lists out of chapters 30 to 34 into an internal note. Finish those, build, check.
