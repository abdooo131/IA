# Accounting developer guide (work in progress)

Source of the English developer guide PDF about the accounting system and its screens.

- chapters/: HTML fragments, one per chapter (01 to 20 text, 30 to 34 screens).
- small/: the screenshots as compressed JPEG (taken from a local copy with demo data only).
- build.mjs + style.css: build the PDF (cover, contents with page numbers, page numbers).
  Run: node docs/developer-guide/build.mjs (needs Playwright at /opt/node22, pdftotext and pypdf).
  shrink.py remakes small/ only when the full size PNG folder shots/ exists (not committed).

State: finished on 2026-11-12 (577 pages, 17 chapters). INTERNAL_ISSUES.md lists small screen
problems found while documenting; it is not part of the PDF and is waiting to be fixed.
