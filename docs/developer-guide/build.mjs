// Builds the developer guide PDF from chapters/*.html (fragments) and shots/*.png.
// Two passes: the first finds the page of every heading (hidden markers read back with
// pdftotext), the second prints the table of contents with those page numbers.
// Run: NODE_PATH=/opt/node22/lib/node_modules node build.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;

const here = path.dirname(fileURLToPath(import.meta.url));
const web = '/home/user/IA/apps/web/public';
const out = path.join(here, 'Shiply_Now_Accounting_System_Developer_Guide.pdf');
const font = (f) => pathToFileURL(path.join(web, 'fonts', f)).href;
const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const chapterFiles = readdirSync(path.join(here, 'chapters'))
  .filter((f) => f.endsWith('.html'))
  .sort();
let body = chapterFiles.map((f) => readFileSync(path.join(here, 'chapters', f), 'utf8')).join('\n');

// Screenshots: <figure class="shot" data-shot="name"> gets shots/name.png, else a visible gap.
if (existsSync(path.join(here, 'shots'))) execFileSync('python3', [path.join(here, 'shrink.py')]);
const missingShots = [];
body = body.replace(/<figure class="shot" data-shot="([^"]+)">/g, (_m, name) => {
  const file = path.join(here, 'small', `${name}.jpg`);
  if (existsSync(file))
    return `<figure class="shot"><img src="${pathToFileURL(file).href}" alt="${name}">`;
  missingShots.push(name);
  return `<figure class="shot missing"><div class="missing-box">Screenshot: ${name}</div>`;
});

// Number chapters and sections, collect the contents, add hidden page markers.
const toc = [];
let ch = 0;
let sec = 0;
let n = 0;
body = body.replace(/<(h1|h2)([^>]*)>([\s\S]*?)<\/\1>/g, (_m, tag, attrs, raw) => {
  // Writers sometimes number headings themselves ("11.2 COD"); the build numbers them.
  const text = raw.replace(/^\s*(Chapter\s+)?\d+(\.\d+)*\.?\s+/i, '');
  n += 1;
  const id = `m${n}`;
  let label;
  if (tag === 'h1') {
    ch += 1;
    sec = 0;
    label = `${ch}`;
  } else {
    sec += 1;
    label = `${ch}.${sec}`;
  }
  const plain = text.replace(/<[^>]+>/g, '').trim();
  toc.push({ tag, id, label, text: plain });
  const cleanAttrs = attrs.replace(/\sid="[^"]*"/, '');
  return `<${tag}${cleanAttrs} id="${id}"><span class="num">${label}</span> ${text}<span class="marker">@@${id}@@</span></${tag}>`;
});

const logo = readFileSync(path.join(web, 'brand', 'logo-horizontal-reverse.svg'), 'utf8');
const css = readFileSync(path.join(here, 'style.css'), 'utf8')
  .replaceAll('FONT(', 'url(')
  .replace(/url\(([a-z0-9-]+\.woff2)\)/g, (_m, f) => `url(${font(f)})`);

function html(pages) {
  const rows = toc
    .map(
      (t) =>
        `<div class="toc-row ${t.tag}"><a href="#${t.id}"><span class="num">${t.label}</span> ${t.text}</a><span class="dots"></span><span class="pg">${pages[t.id] ?? ''}</span></div>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shiply Now Accounting System: Developer Guide</title><style>${css}</style></head><body>
COVER_START<section class="cover">
  <div class="cover-logo">${logo}</div>
  <div class="cover-tape"></div>
  <h1 class="cover-title">Accounting System</h1>
  <p class="cover-sub">Developer Guide: architecture, calculations, postings, screens and user interface</p>
  <div class="cover-meta"><p>Shiply Now pilot platform</p><p>Version of ${today}</p><p class="conf">Confidential. Prepared for an engineering partner.</p></div>
</section>COVER_END
<section class="toc"><h2 class="toc-title">Contents</h2>${rows}</section>
${body}
</body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const footer = `<div style="width:100%;font-family:Arial;font-size:8px;color:#5b6b80;padding:0 16mm;display:flex;justify-content:space-between"><span>Shiply Now Accounting System: Developer Guide</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
async function render(pages, file) {
  const full = html(pages);
  const cover = full.slice(full.indexOf('COVER_START') + 11, full.indexOf('COVER_END'));
  const head = full.slice(0, full.indexOf('COVER_START'));
  writeFileSync(path.join(here, 'cover.html'), `${head}${cover}</body></html>`);
  writeFileSync(path.join(here, 'guide.html'), full.replace(/COVER_START[\s\S]*COVER_END/, ''));
  await page.goto(pathToFileURL(path.join(here, 'cover.html')).href, { waitUntil: 'load' });
  await page.pdf({ path: path.join(here, 'cover.pdf'), format: 'A4', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  await page.goto(pathToFileURL(path.join(here, 'guide.html')).href, { waitUntil: 'load' });
  await page.pdf({
    path: file,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: footer,
    margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
  });
}

// Pass 1 with blank numbers, pass 2 with the pages found (the contents length is the same).
const first = path.join(here, 'pass1.pdf');
await render({}, first);
const text = execFileSync('pdftotext', ['-layout', first, '-']).toString('utf8');
const pages = {};
text.split('\f').forEach((pg, i) => {
  for (const m of pg.matchAll(/@@(m\d+)@@/g)) pages[m[1]] ??= i + 1;
});
const bodyPdf = path.join(here, 'body.pdf');
await render(pages, bodyPdf);
execFileSync('python3', ['-c', `
import sys
from pypdf import PdfWriter
w = PdfWriter()
for f in sys.argv[1:3]: w.append(f)
w.write(sys.argv[3])
`, path.join(here, 'cover.pdf'), bodyPdf, out]);
await browser.close();
const info = execFileSync('pdfinfo', [out]).toString().match(/Pages:\s+(\d+)/);
console.log(`built ${out} (${info?.[1]} pages, ${chapterFiles.length} chapters, ${toc.length} headings)`);
if (missingShots.length) console.log(`screenshots still missing: ${missingShots.length}`);
