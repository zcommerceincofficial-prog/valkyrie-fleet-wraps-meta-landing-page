#!/usr/bin/env node
/**
 * mobile-qa.mjs, the phone pass harness.
 * See site-kit docs for full header. Trimmed comments here for brevity.
 */

import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readdir, mkdir, stat, readFile, writeFile } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import path from 'node:path';

const MAX_OVERFLOW_PX = 0;
const MIN_TAP_PX = 44;
const MIN_FONT_PX = 16;
const BODY_TEXT_MIN_CHARS = 8;
const NAV_TIMEOUT_MS = 30000;

const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const VIEWPORTS = [
  { label: '390x844', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_IOS },
  { label: '375x667', width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_IOS },
  { label: '360x640', width: 360, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_ANDROID },
  { label: '820x1180', width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_IPAD },
  { label: '1024w', width: 1024, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false, userAgent: UA_DESKTOP },
  { label: '1440w', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false, userAgent: UA_DESKTOP },
  { label: '1600w', width: 1600, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false, userAgent: UA_DESKTOP },
  { label: '1885w', width: 1885, height: 1000, deviceScaleFactor: 1, isMobile: false, hasTouch: false, userAgent: UA_DESKTOP },
];

function parseArgs(argv) {
  const opts = { dir: null, urls: [], urlFile: null, out: 'qa', wait: 'body', port: 0, chrome: null, help: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) fatal(`The flag ${a} needs a value after it.`, 2); return v; };
    if (a === '--dir') opts.dir = next();
    else if (a === '--url') opts.urls.push(next());
    else if (a === '--urls') opts.urlFile = next();
    else if (a === '--out') opts.out = next();
    else if (a === '--wait') opts.wait = next();
    else if (a === '--port') opts.port = Number(next());
    else if (a === '--chrome') opts.chrome = next();
    else if (a === '--only') opts.only = next();
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (!a.startsWith('-') && !opts.dir && opts.urls.length === 0) { if (existsSync(a)) opts.dir = a; else opts.urls.push(a); }
    else fatal(`I do not know the flag ${a}.`, 2);
  }
  return opts;
}

function fatal(message, code = 2) { console.error(`\nmobile-qa stopped: ${message}\n`); process.exit(code); }

function findChrome(override) {
  const explicit = override || process.env.CHROME_PATH;
  if (explicit) {
    if (existsSync(explicit)) return explicit;
    fatal(`There is no browser at ${explicit}.`, 2);
  }
  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else if (process.platform === 'win32') {
    candidates.push('C\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium');
  }
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};

async function serveFolder(root, port) {
  const abs = path.resolve(root);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      let file = path.resolve(abs, rel);
      if (file !== abs && !file.startsWith(abs + path.sep)) { res.writeHead(403).end('Outside'); return; }
      const candidates = [];
      if (rel === '' || rel.endsWith('/')) candidates.push(path.join(file, 'index.html'));
      else candidates.push(file, file + '.html', path.join(file, 'index.html'));
      for (const c of candidates) {
        if (existsSync(c) && (await stat(c)).isFile()) {
          res.writeHead(200, { 'content-type': MIME[path.extname(c).toLowerCase()] || 'application/octet-stream' });
          createReadStream(c).pipe(res);
          return;
        }
      }
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    } catch (err) { res.writeHead(500).end('Server error: ' + err.message); }
  });
  await new Promise((resolve, reject) => { server.on('error', reject); server.listen(port || 0, '127.0.0.1', resolve); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function findHtml(root, base = root, found = []) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'scripts' || entry.name === 'fonts') continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await findHtml(full, base, found);
    else if (entry.name.toLowerCase().endsWith('.html')) found.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return found;
}

function toRoute(rel) {
  let r = rel.replace(/\.html$/i, '');
  if (r === 'index') return '/';
  if (r.endsWith('/index')) r = r.slice(0, -'/index'.length);
  return '/' + r;
}

function safeName(route) {
  const s = route.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9._-]+/gi, '-');
  return s === '' ? 'home' : s;
}

export function overflowHunter() {
  const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth);
  const limit = viewportWidth + 1;
  return [...document.querySelectorAll('*')]
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => rect.right > limit && rect.width > 0 && rect.height > 0)
    .sort((a, b) => b.rect.right - a.rect.right)
    .slice(0, 10)
    .map(({ el, rect }) => {
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
      const id = el.id ? '#' + el.id : '';
      return { selector: el.tagName.toLowerCase() + id + cls, overhangPx: Math.round(rect.right - viewportWidth), widthPx: Math.round(rect.width) };
    });
}

function measureSource() {
  return function measure(opts) {
    const { minTap, minFont, bodyMinChars } = opts;
    const visible = (el, rect) => {
      if (rect.width <= 0 || rect.height <= 0) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      return true;
    };
    const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth);
    const overflow = document.documentElement.scrollWidth - viewportWidth;
    const tapSelector = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [onclick], label[for]';
    let smallestTap = null;
    for (const el of document.querySelectorAll(tapSelector)) {
      const rect = el.getBoundingClientRect();
      if (!visible(el, rect)) continue;
      const cs = getComputedStyle(el);
      const isInlineTextLink = el.tagName === 'A' && cs.display === 'inline' && el.closest('p, li, figcaption, blockquote, td');
      if (isInlineTextLink) continue;
      const side = Math.min(rect.width, rect.height);
      if (smallestTap === null || side < smallestTap.px) {
        const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
        smallestTap = { px: Math.round(side * 10) / 10, selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls, text: (el.textContent || el.value || '').trim().slice(0, 30), width: Math.round(rect.width), height: Math.round(rect.height) };
      }
    }
    let smallestFont = null;
    for (const el of document.querySelectorAll('body *')) {
      let own = '';
      for (const node of el.childNodes) if (node.nodeType === 3) own += node.nodeValue;
      own = own.replace(/\s+/g, ' ').trim();
      if (own.length < bodyMinChars) continue;
      const rect = el.getBoundingClientRect();
      if (!visible(el, rect)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(size)) continue;
      if (smallestFont === null || size < smallestFont.px) {
        const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
        smallestFont = { px: Math.round(size * 10) / 10, selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls, text: own.slice(0, 40) };
      }
    }
    return { overflow, smallestTap, smallestFont, title: document.title || '', minTap, minFont };
  };
}

function settleSource() {
  return async function settle() {
    const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
    if (document.fonts && document.fonts.ready) { try { await withTimeout(document.fonts.ready, 3000); } catch (e) {} }
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const step = Math.max(200, Math.floor(window.innerHeight * 0.9));
    const height = Math.min(document.body.scrollHeight, 40000); // hard cap, never loop forever
    let y = 0;
    let guard = 0;
    while (y < height && guard < 200) { window.scrollTo(0, y); await frame(); y += step; guard++; }
    window.scrollTo(0, 0); await frame();
    const imgs = [...document.images].filter((i) => !i.complete);
    await withTimeout(
      Promise.all(imgs.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))),
      4000
    );
  };
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) { console.log('mobile-qa.mjs --dir <folder> | --url <address>'); process.exit(0); }
if (opts.urlFile) {
  const lines = (await readFile(opts.urlFile, 'utf8')).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  opts.urls.push(...lines);
}
if (!opts.dir && opts.urls.length === 0) { if (existsSync('dist')) opts.dir = 'dist'; else fatal('Tell me what to test.', 2); }

const viewports = opts.only ? VIEWPORTS.filter((v) => v.label === opts.only) : VIEWPORTS;
const chromePath = findChrome(opts.chrome);
if (!chromePath) fatal('I could not find Chrome on this machine. Set CHROME_PATH.', 2);

let served = null;
let pages = [];
if (opts.dir) {
  const files = await findHtml(path.resolve(opts.dir));
  if (files.length === 0) fatal(`There are no .html files inside ${opts.dir}.`, 2);
  served = await serveFolder(opts.dir, opts.port);
  pages = files.sort().map((rel) => ({ route: toRoute(rel), url: served.origin + toRoute(rel) }));
  console.log(`Serving ${path.resolve(opts.dir)} at ${served.origin}`);
} else {
  pages = opts.urls.map((u) => { let route = u; try { route = new URL(u).pathname; } catch { fatal(`${u} is not a web address.`, 2); } return { route, url: u }; });
}

const date = new Date().toISOString().slice(0, 10);
const shotDir = path.resolve(opts.out, date);
await mkdir(shotDir, { recursive: true });

console.log(`Chrome:      ${chromePath}`);
console.log(`Pages:       ${pages.length}`);
console.log(`Viewports:   ${viewports.map((v) => v.label).join(', ')}`);
console.log(`Screenshots: ${shotDir}`);
console.log('');

const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const measure = measureSource();
const settle = settleSource();
const failures = [];
const rows = [];
let shots = 0;

try {
  for (const pageDef of pages) {
    console.log(`PAGE ${pageDef.route}`);
    for (const vp of viewports) {
      const page = await browser.newPage();
      const consoleErrors = [];
      const isFavicon = (u) => typeof u === 'string' && /\/favicon\.ico(\?|$)/i.test(u);
      page.on('console', (msg) => { if (msg.type() !== 'error') return; const loc = msg.location && msg.location(); if (loc && isFavicon(loc.url)) return; consoleErrors.push(msg.text().slice(0, 200)); });
      page.on('pageerror', (err) => consoleErrors.push('uncaught: ' + String(err.message).slice(0, 200)));
      page.on('requestfailed', (req) => { const reason = req.failure() && req.failure().errorText; if (isFavicon(req.url())) return; if (reason && reason !== 'net::ERR_ABORTED') consoleErrors.push(`request failed (${reason}): ${req.url().slice(0, 120)}`); });
      await page.emulate({ viewport: { width: vp.width, height: vp.height, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch, isLandscape: false }, userAgent: vp.userAgent });
      page.setDefaultTimeout(NAV_TIMEOUT_MS);
      const label = `${safeName(pageDef.route)}-${vp.label}`;
      const record = { route: pageDef.route, viewport: vp.label, problems: [] };
      try {
        const res = await page.goto(pageDef.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        if (res && res.status() >= 400) record.problems.push(`HTTP ${res.status()}`);
        await page.waitForSelector(opts.wait, { timeout: NAV_TIMEOUT_MS });
        await page.evaluate(settle);
        const m = await page.evaluate(measure, { minTap: MIN_TAP_PX, minFont: MIN_FONT_PX, bodyMinChars: BODY_TEXT_MIN_CHARS });
        const offenders = m.overflow > MAX_OVERFLOW_PX ? await page.evaluate(overflowHunter) : [];
        const box = await page.evaluate(() => ({ width: Math.min(window.innerWidth, document.documentElement.clientWidth), height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) }));
        await page.screenshot({ path: path.join(shotDir, `${label}.png`), captureBeyondViewport: true, clip: { x: 0, y: 0, width: box.width, height: Math.min(box.height, 16000), scale: 1 } });
        shots++;
        const tapPx = m.smallestTap ? m.smallestTap.px : null;
        const fontPx = m.smallestFont ? m.smallestFont.px : null;
        console.log(`  ${vp.label.padEnd(9)} overflow ${String(m.overflow).padStart(4)}px | console errors ${String(consoleErrors.length).padStart(2)} | smallest tap ${tapPx === null ? '  n/a' : String(tapPx).padStart(5)}px | smallest text ${fontPx === null ? ' n/a' : String(fontPx).padStart(4)}px`);
        if (m.overflow > MAX_OVERFLOW_PX) record.problems.push(`horizontal overflow ${m.overflow}px, widest offenders: ` + offenders.map((o) => `${o.selector} (+${o.overhangPx}px, ${o.widthPx}px wide)`).join('; '));
        if (consoleErrors.length) record.problems.push(`${consoleErrors.length} console error(s): ` + consoleErrors.slice(0, 3).join(' | '));
        if (vp.hasTouch && tapPx !== null && tapPx < MIN_TAP_PX) record.problems.push(`tap target ${tapPx}px (${m.smallestTap.width}x${m.smallestTap.height}) on ${m.smallestTap.selector} "${m.smallestTap.text}", minimum ${MIN_TAP_PX}px`);
        if (fontPx !== null && fontPx < MIN_FONT_PX) record.problems.push(`body text ${fontPx}px on ${m.smallestFont.selector} "${m.smallestFont.text}", minimum ${MIN_FONT_PX}px`);
        rows.push({ ...record, overflow: m.overflow, errors: consoleErrors.length, tap: tapPx, font: fontPx });
      } catch (err) {
        console.log(`  ${vp.label.padEnd(9)} DID NOT LOAD: ${err.message.split('\n')[0]}`);
        record.problems.push('page did not load: ' + err.message.split('\n')[0]);
        rows.push({ ...record, overflow: null, errors: consoleErrors.length, tap: null, font: null });
      } finally { await page.close(); }
      if (record.problems.length) failures.push(record);
    }
    console.log('');
  }
} finally { await browser.close(); if (served) served.server.close(); }

await writeFile(path.join(shotDir, 'results.json'), JSON.stringify({ date, pages: pages.map((p) => p.route), rows }, null, 2));

if (failures.length) {
  console.log('FAILURES, grouped by page');
  const byPage = new Map();
  for (const f of failures) { if (!byPage.has(f.route)) byPage.set(f.route, []); byPage.get(f.route).push(f); }
  for (const [route, list] of byPage) { console.log(`\n  ${route}`); for (const f of list) for (const p of f.problems) console.log(`    ${f.viewport}: ${p}`); }
  console.log(`\n${failures.length} of ${rows.length} page-viewport runs failed. ${shots} screenshots in ${shotDir}`);
  process.exit(1);
}
console.log(`All ${rows.length} page-viewport runs passed. ${shots} screenshots in ${shotDir}`);
process.exit(0);
