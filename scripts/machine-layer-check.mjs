#!/usr/bin/env node
/**
 * machine-layer-check.mjs  -  grade the raw HTML a crawler actually downloads.
 *
 * WHAT IT DOES  Reads every page as plain text, with no JavaScript running, and checks:
 *   exactly one title under 60 characters, one meta description under 155, a canonical
 *   URL that matches the host and the page, exactly one H1, no skipped heading levels,
 *   at least one JSON-LD block that parses, and no hidden offscreen text. Then the two
 *   root files: robots.txt under 2KB with zero Disallow lines, and a sitemap.xml whose
 *   every lastmod is a real date.
 * HOW TO RUN   node scripts/machine-layer-check.mjs --domain www.example.com   (live)
 *              node scripts/machine-layer-check.mjs dist                       (folder)
 *              node scripts/machine-layer-check.mjs --url https://www.example.com/
 *              node scripts/machine-layer-check.mjs --help
 * WHAT IT NEEDS  Node 18 or newer. Nothing to install. Live mode needs internet.
 * WHAT IT PRINTS  One row per page, ok or FAIL per check, then the detail of every
 *   failure in plain English, then the two root-file results.
 * LIVE MODE vs FOLDER MODE  Live mode fetches the sitemap from the domain and then
 *   every URL in it, which is the only check that grades what visitors and crawlers get.
 *   Folder mode reads dist/ off the disk, robots.txt and sitemap.xml included, and
 *   fetches nothing. Use folder mode before a deploy, live mode after one.
 * EXIT CODES   0 everything passed. 1 at least one check failed, or a page could not
 *   be fetched or read. 2 bad arguments.
 */

import fs from 'node:fs';
import path from 'node:path';

const USAGE = `
machine-layer-check.mjs  -  check the machine layer of a live site or a built folder

  node scripts/machine-layer-check.mjs --domain www.example.com
  node scripts/machine-layer-check.mjs dist
  node scripts/machine-layer-check.mjs --url https://www.example.com/ --url https://www.example.com/contact

  --domain <host>   live mode: read https://<host>/sitemap.xml, then every URL in it
  --url <url>       live mode: check this one URL. Repeatable. Skips the sitemap.
  --folder <dir>    folder mode: read the built site off the disk (same as passing the
                    folder as the first argument)
  --host <host>     the host canonicals must use. Folder mode reads it from the sitemap
                    when you leave this off.
  --failures-only   print only the rows that failed
  --help            this text
`;

const TITLE_MAX = 60;
const DESC_MAX = 155;
const ROBOTS_MAX_BYTES = 2048;

const opts = { domain: null, urls: [], folder: null, host: null, failuresOnly: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const take = () => {
    const v = argv[++i];
    if (v === undefined) { console.error(`\nERROR  ${a} needs a value after it.\n`); process.exit(2); }
    return v;
  };
  if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
  else if (a === '--domain') opts.domain = take().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  else if (a === '--url') opts.urls.push(take());
  else if (a === '--folder' || a === '--dist') opts.folder = take();
  else if (a === '--host') opts.host = take().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  else if (a === '--failures-only') opts.failuresOnly = true;
  else if (!a.startsWith('-') && !opts.folder) opts.folder = a;
  else { console.error(`\nERROR  I do not know the option "${a}". Run with --help.\n`); process.exit(2); }
}

if (!opts.domain && !opts.folder && opts.urls.length === 0) {
  console.error(`\nERROR  Tell me what to check.\n       Live:   node scripts/machine-layer-check.mjs --domain www.example.com\n       Folder: node scripts/machine-layer-check.mjs dist\n`);
  process.exit(2);
}
if (opts.folder && (opts.domain || opts.urls.length)) {
  console.error(`\nERROR  Folder mode and live mode are different jobs. Pick one.\n`);
  process.exit(2);
}

async function getText(url) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'site-kit-machine-layer-check' },
        signal: AbortSignal.timeout(15000)
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { body, status: res.status, finalUrl: res.url || url };
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(`could not fetch ${url}: ${lastErr && lastErr.message}`);
}

function stripNoise(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

function attrOf(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("|')([\\s\\S]*?)\\1`, 'i'));
  return m ? decodeEntities(m[2].trim()) : null;
}

function readPage(html) {
  const doc = stripNoise(html);

  const titles = [...doc.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)]
    .map(m => decodeEntities(m[1]).trim());

  const descs = [...doc.matchAll(/<meta\b[^>]*>/gi)]
    .filter(m => /\bname\s*=\s*("|')description\1/i.test(m[0]))
    .map(m => attrOf(m[0], 'content') || '');

  const canonicals = [...doc.matchAll(/<link\b[^>]*>/gi)]
    .filter(m => /\brel\s*=\s*("|')canonical\1/i.test(m[0]))
    .map(m => attrOf(m[0], 'href') || '');

  const headings = [...doc.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map(m => ({ level: Number(m[1]), text: decodeEntities(m[2].replace(/<[^>]*>/g, '')).trim() }));

  const ldBlocks = [...doc.matchAll(/<script\b[^>]*type\s*=\s*("|')application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[2]);

  const hidden = [];
  const OFFSCREEN = /(left|text-indent)\s*:\s*-\s*(9999|999em|10000)|clip\s*:\s*rect\s*\(\s*(0|1px)/i;
  for (const m of doc.matchAll(/<[a-z][a-z0-9-]*\b[^>]*\bstyle\s*=\s*("|')([\s\S]*?)\1[^>]*>/gi)) {
    const style = m[2];
    if (OFFSCREEN.test(style) && /position\s*:\s*(absolute|fixed)/i.test(style)) hidden.push(style.trim().slice(0, 70));
  }
  for (const m of doc.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of m[1].split('}')) {
      if (OFFSCREEN.test(rule) && /position\s*:\s*(absolute|fixed)/i.test(rule)) {
        hidden.push(rule.trim().replace(/\s+/g, ' ').slice(0, 70));
      }
    }
  }

  return { titles, descs, canonicals, headings, ldBlocks, hidden };
}

function checkPage(label, expectedPath, html, host) {
  const p = readPage(html);
  const fails = [];
  const row = { label };

  if (p.titles.length !== 1) { row.title = 'FAIL'; fails.push(`${p.titles.length} <title> tags, expected exactly 1`); }
  else if (p.titles[0].length === 0) { row.title = 'FAIL'; fails.push('the <title> is empty'); }
  else if (p.titles[0].length > TITLE_MAX) { row.title = 'FAIL'; fails.push(`title is ${p.titles[0].length} characters, ceiling is ${TITLE_MAX}: "${p.titles[0]}"`); }
  else row.title = 'ok';

  if (p.descs.length !== 1) { row.desc = 'FAIL'; fails.push(`${p.descs.length} meta description tags, expected exactly 1`); }
  else if (p.descs[0].trim().length === 0) { row.desc = 'FAIL'; fails.push('the meta description is empty'); }
  else if (p.descs[0].length > DESC_MAX) { row.desc = 'FAIL'; fails.push(`description is ${p.descs[0].length} characters, ceiling is ${DESC_MAX}`); }
  else row.desc = 'ok';

  if (p.canonicals.length !== 1) { row.canon = 'FAIL'; fails.push(`${p.canonicals.length} canonical links, expected exactly 1`); }
  else {
    let u = null;
    try { u = new URL(p.canonicals[0]); } catch { /* handled below */ }
    if (!u) { row.canon = 'FAIL'; fails.push(`canonical is not a full address: "${p.canonicals[0]}"`); }
    else if (host && u.host.toLowerCase() !== host.toLowerCase()) { row.canon = 'FAIL'; fails.push(`canonical host is ${u.host}, expected ${host}`); }
    else if (expectedPath && trimSlash(u.pathname) !== trimSlash(expectedPath)) { row.canon = 'FAIL'; fails.push(`canonical path is ${u.pathname}, this page is ${expectedPath}`); }
    else { row.canon = 'ok'; row.canonicalPath = u.pathname; }
  }

  const h1s = p.headings.filter(h => h.level === 1);
  if (h1s.length !== 1) { row.h1 = 'FAIL'; fails.push(`${h1s.length} H1 headings, expected exactly 1`); }
  else row.h1 = 'ok';

  let skip = null;
  for (let i = 1; i < p.headings.length; i++) {
    const step = p.headings[i].level - p.headings[i - 1].level;
    if (step > 1) { skip = `H${p.headings[i - 1].level} is followed by H${p.headings[i].level} ("${p.headings[i].text.slice(0, 40)}")`; break; }
  }
  if (skip) { row.order = 'FAIL'; fails.push(`skipped heading level: ${skip}`); }
  else row.order = 'ok';

  if (p.ldBlocks.length === 0) { row.jsonld = 'FAIL'; fails.push('no JSON-LD block on the page'); }
  else {
    const broken = [];
    p.ldBlocks.forEach((b, i) => { try { JSON.parse(b); } catch (e) { broken.push(`block ${i + 1}: ${e.message}`); } });
    if (broken.length) { row.jsonld = 'FAIL'; fails.push(`JSON-LD does not parse, so no machine reads it. ${broken.join('; ')}`); }
    else row.jsonld = 'ok';
  }

  if (p.hidden.length) { row.hidden = 'FAIL'; fails.push(`${p.hidden.length} offscreen text block(s), first one: ${p.hidden[0]}`); }
  else row.hidden = 'ok';

  row.fails = fails;
  return row;
}

function trimSlash(p) {
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

function checkRobots(text) {
  const fails = [];
  const bytes = Buffer.byteLength(text, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => !l.trim().startsWith('#'));
  const disallow = lines.filter(l => /^\s*Disallow\s*:/i.test(l));
  const sitemap = lines.filter(l => /^\s*Sitemap\s*:/i.test(l));
  if (bytes > ROBOTS_MAX_BYTES) {
    fails.push(`robots.txt is ${bytes} bytes. Over ${ROBOTS_MAX_BYTES} means the host is injecting its own managed robots rules: turn that feature off in the host dashboard, then check again.`);
  }
  if (disallow.length) {
    fails.push(`robots.txt has ${disallow.length} Disallow line(s): ${disallow.map(l => l.trim()).join(' | ')}. On an approved site every crawler is allowed.`);
  }
  if (!sitemap.length) fails.push('robots.txt has no Sitemap: line.');
  return { bytes, disallow: disallow.length, fails };
}

function checkSitemap(text) {
  const fails = [];
  const locs = [...text.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map(m => m[1].trim());
  const mods = [...text.matchAll(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/gi)].map(m => m[1].trim());
  if (!/<urlset[\s>]/i.test(text)) fails.push('sitemap.xml has no <urlset> element, so nothing will read it.');
  if (locs.length === 0) fails.push('sitemap.xml lists no URLs.');
  for (const loc of locs) {
    try { new URL(loc); } catch { fails.push(`sitemap URL is not a full address: "${loc}"`); }
  }
  for (const m of mods) {
    const iso = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(m);
    if (!iso || Number.isNaN(Date.parse(m))) fails.push(`lastmod "${m}" is not a real date.`);
  }
  if (mods.length && mods.length !== locs.length) fails.push(`${locs.length} URLs but ${mods.length} lastmod dates.`);
  return { urls: locs, dates: mods.length, fails };
}

function printTable(rows, failuresOnly) {
  const cols = [
    ['page', r => r.label], ['title', r => r.title], ['desc', r => r.desc], ['canon', r => r.canon],
    ['h1', r => r.h1], ['order', r => r.order], ['json-ld', r => r.jsonld], ['hidden', r => r.hidden]
  ];
  const shown = failuresOnly ? rows.filter(r => r.fails.length) : rows;
  if (!shown.length) return;
  const widths = cols.map(([head, get]) => Math.max(head.length, ...shown.map(r => String(get(r) ?? '-').length)));
  const fmt = (cells) => cells.map((c, i) => String(c ?? '-').padEnd(widths[i])).join('  ');
  console.log(fmt(cols.map(c => c[0])));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const r of shown) console.log(fmt(cols.map(c => c[1](r))));
}

function pathForFile(rel) {
  const id = rel.replace(/\.html$/i, '');
  return id === 'index' ? '/' : '/' + id.replace(/\/index$/i, '');
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

async function main() {
  const rows = [];
  const notes = [];
  let robots = null, sitemap = null, host = opts.host;

  if (opts.folder) {
    const dir = path.resolve(opts.folder);
    const robotsFile = path.join(dir, 'robots.txt');
    const sitemapFile = path.join(dir, 'sitemap.xml');
    robots = fs.existsSync(robotsFile) ? checkRobots(fs.readFileSync(robotsFile, 'utf8')) : { bytes: 0, disallow: 0, fails: ['there is no robots.txt in this folder.'] };
    sitemap = fs.existsSync(sitemapFile) ? checkSitemap(fs.readFileSync(sitemapFile, 'utf8')) : { urls: [], dates: 0, fails: ['there is no sitemap.xml in this folder.'] };
    if (!host && sitemap.urls.length) { try { host = new URL(sitemap.urls[0]).host; } catch {} }
    const pages = walk(dir).filter(f => /\.html$/i.test(f)).sort();
    for (const rel of pages) {
      const html = fs.readFileSync(path.join(dir, rel.split('/').join(path.sep)), 'utf8');
      if (rel === '404.html') continue;
      rows.push(checkPage(rel, pathForFile(rel), html, host));
    }
  } else {
    let urls = opts.urls.slice();
    if (opts.domain) {
      host = host || opts.domain;
      const origin = `https://${opts.domain}`;
      try { robots = checkRobots((await getText(`${origin}/robots.txt`)).body); }
      catch (err) { robots = { bytes: 0, disallow: 0, fails: [String(err.message)] }; }
      try {
        const sm = await getText(`${origin}/sitemap.xml`);
        sitemap = checkSitemap(sm.body);
        urls = urls.concat(sitemap.urls);
      } catch (err) { sitemap = { urls: [], dates: 0, fails: [String(err.message)] }; }
    }
    for (const url of urls) {
      let u;
      try { u = new URL(url); } catch { rows.push({ label: url, fails: [`not a valid URL`] }); continue; }
      host = host || u.host;
      try {
        const res = await getText(url);
        rows.push(checkPage(u.pathname, u.pathname, res.body, host));
      } catch (err) {
        rows.push({ label: u.pathname, title: 'FAIL', desc: '-', canon: '-', h1: '-', order: '-', jsonld: '-', hidden: '-', fails: [String(err.message)] });
      }
    }
  }

  console.log();
  console.log(`machine layer  ${opts.folder ? `folder ${path.resolve(opts.folder)}` : `live ${host || ''}`}`);
  console.log();
  printTable(rows, opts.failuresOnly);

  const pageFails = rows.filter(r => r.fails && r.fails.length);
  if (pageFails.length) {
    console.log();
    console.log('FAILURES');
    for (const r of pageFails) { console.log(`  ${r.label}`); for (const f of r.fails) console.log(`    - ${f}`); }
  }

  console.log();
  console.log('ROOT FILES');
  const rootFails = [];
  if (robots) {
    console.log(`  robots.txt    ${robots.bytes} bytes, ${robots.disallow} Disallow line(s)`);
    rootFails.push(...robots.fails);
  } else console.log('  robots.txt    not checked (pass --domain to check root files)');
  if (sitemap) {
    console.log(`  sitemap.xml   ${sitemap.urls.length} URL(s), ${sitemap.dates} lastmod date(s)`);
    rootFails.push(...sitemap.fails);
  } else console.log('  sitemap.xml   not checked (pass --domain to check root files)');
  for (const f of rootFails) console.log(`    - ${f}`);

  const total = pageFails.reduce((n, r) => n + r.fails.length, 0) + rootFails.length;
  console.log();
  console.log(total === 0 ? `PASS  ${rows.length} page(s), no failures.` : `FAIL  ${total} problem(s) across ${rows.length} page(s) and the root files.`);
  console.log();
  process.exit(total === 0 ? 0 : 1);
}

main().catch(err => { console.error(`\nERROR  ${err && err.message ? err.message : err}\n`); process.exit(1); });
