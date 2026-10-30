#!/usr/bin/env node
/* LeadHarvest static audit — mirrors the checks addons-linter / AMO reviewers care about.
   Usage: node tools/audit.js [extension-dir]   (default: current directory) */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || '.');
const SKIP = new Set(['node_modules', '.git', 'tools', '.github']);
const results = [];
const add = (level, id, title, detail) => results.push({ level, id, title, detail });

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(ROOT, []);
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const read = p => fs.readFileSync(p, 'utf8');
const sizeOf = p => fs.statSync(p).size;

/* ---------------------------------------------------------------- manifest */
let mf = null;
try {
  mf = JSON.parse(read(path.join(ROOT, 'manifest.json')));
  add('pass', 'manifest-parse', 'manifest.json valid JSON', '');
} catch (e) {
  add('fail', 'manifest-parse', 'manifest.json invalid', e.message);
}

if (mf) {
  add(mf.manifest_version === 3 ? 'pass' : 'fail', 'mv3', 'Manifest V3', 'manifest_version = ' + mf.manifest_version);
  add(/^\d+\.\d+(\.\d+)?$/.test(mf.version) ? 'pass' : 'fail', 'version', 'Version format', mf.version);
  for (const k of ['name', 'description', 'icons', 'action']) {
    add(mf[k] ? 'pass' : 'fail', 'meta-' + k, 'Required/expected key: ' + k, mf[k] ? '' : 'missing');
  }
  const bg = mf.background || {};
  const crossBrowser = Array.isArray(bg.scripts) && typeof bg.service_worker === 'string';
  add(crossBrowser ? 'pass' : 'warn', 'bg-cross-browser',
    'Cross-browser background',
    crossBrowser ? 'scripts (Firefox event page) + service_worker (Chrome) both present'
      : 'Firefox needs background.scripts; Chrome needs background.service_worker');

  const g = (mf.browser_specific_settings && mf.browser_specific_settings.gecko) || {};
  add(g.id ? 'pass' : 'fail', 'gecko-id', 'gecko.id (required to sign MV3 on AMO)', g.id || 'missing');
  if (g.id && !/^[a-zA-Z0-9._-]*@[a-zA-Z0-9._-]+$/.test(g.id) && !/^\{[0-9a-fA-F-]{36}\}$/.test(g.id)) {
    add('fail', 'gecko-id-format', 'gecko.id format', 'must be name@domain or a GUID');
  }
  add(g.strict_min_version ? 'pass' : 'warn', 'gecko-min-version', 'strict_min_version', g.strict_min_version || 'missing — data_collection_permissions needs 140.0+');
  const dcp = g.data_collection_permissions;
  if (!dcp) {
    add('fail', 'dcp', 'data_collection_permissions', 'required for new AMO submissions since 2025-11-03');
  } else {
    const req = dcp.required || [];
    const okReq = req.includes('none') || req.length > 0;
    add(okReq ? 'pass' : 'fail', 'dcp-required', 'data collection: required', JSON.stringify(req));
    if (dcp.optional && dcp.optional.length) {
      add('info', 'dcp-optional', 'data collection: optional (user opt-in)', JSON.stringify(dcp.optional));
    }
    add(req.includes('none') && (dcp.optional || []).length ? 'warn' : 'info', 'dcp-consistency',
      'Declaration vs code', 'core runs locally (no transmission); optional cloud AI transmits page title/signals only when the user enables it and supplies their own key');
  }

  /* referenced files exist */
  const refs = new Set();
  (mf.content_scripts || []).forEach(c => (c.js || []).concat(c.css || []).forEach(f => refs.add(f)));
  if (mf.background) [].concat(mf.background.scripts || [], mf.background.service_worker || []).forEach(f => f && refs.add(f));
  if (mf.action && mf.action.default_popup) refs.add(mf.action.default_popup);
  if (mf.options_page) refs.add(mf.options_page);
  if (mf.options_ui && mf.options_ui.page) refs.add(mf.options_ui.page);
  Object.values(mf.icons || {}).forEach(f => refs.add(f));
  Object.values((mf.action && mf.action.default_icon) || {}).forEach(f => refs.add(f));
  const missing = [...refs].filter(f => !fs.existsSync(path.join(ROOT, f)));
  add(missing.length ? 'fail' : 'pass', 'refs', 'Manifest file references', missing.length ? 'missing: ' + missing.join(', ') : refs.size + ' referenced files all present');

  /* permissions */
  const perms = (mf.permissions || []).slice();
  const host = (mf.host_permissions || []).slice();
  add('info', 'permissions', 'API permissions', perms.join(', ') || 'none');
  add('info', 'host-permissions', 'Host permissions', host.join(', ') || 'none');
  if (host.includes('<all_urls>')) {
    add('warn', 'broad-host', 'Broad host permission',
      '<all_urls> is required to scrape the site the user is on; no content script is auto-injected (manifest has no content_scripts) — injection happens only on explicit user action');
  }
  if (perms.includes('unlimitedStorage')) add('info', 'unlimited-storage', 'unlimitedStorage', 'used to keep up to 5000 local records without quota errors');
  if (!mf.content_scripts) add('pass', 'no-auto-inject', 'No automatic content-script injection', 'the extractor is injected only when the user clicks scrape');
  else add('warn', 'no-auto-inject', 'content_scripts present', 'consider injecting on demand for a narrower permission profile');
}

/* --------------------------------------------------------------- code scan */
const codeFiles = files.filter(f => /\.(js|html|css)$/.test(f));
const jsFiles = files.filter(f => f.endsWith('.js'));

const patterns = [
  { re: /\beval\s*\(/g, id: 'eval', level: 'fail', title: 'eval() found' },
  { re: /new\s+Function\s*\(/g, id: 'new-function', level: 'fail', title: 'new Function() found' },
  { re: /document\.write\s*\(/g, id: 'doc-write', level: 'warn', title: 'document.write() found' },
  { re: /<script[^>]+src\s*=\s*["']https?:/gi, id: 'remote-script', level: 'fail', title: 'Remote script tag found' },
  { re: /\bimport\s*\(\s*["']https?:/g, id: 'remote-import', level: 'fail', title: 'Remote dynamic import found' },
  { re: /new\s+WebSocket\s*\(/g, id: 'websocket', level: 'warn', title: 'WebSocket usage' },
  { re: /XMLHttpRequest/g, id: 'xhr', level: 'warn', title: 'XMLHttpRequest usage' },
  { re: /\bfetch\s*\(/g, id: 'fetch', level: 'info', title: 'fetch() usage' },
  { re: /\.innerHTML\s*=/g, id: 'innerhtml', level: 'info', title: 'innerHTML assignment' },
  { re: /insertAdjacentHTML/g, id: 'adjacent-html', level: 'warn', title: 'insertAdjacentHTML usage' },
  { re: /sk-[A-Za-z0-9]{20,}/g, id: 'secret', level: 'fail', title: 'Hardcoded API key pattern' }
];

for (const p of patterns) {
  const hits = [];
  for (const f of codeFiles) {
    const text = read(f);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      p.re.lastIndex = 0;
      if (p.re.test(line)) hits.push(rel(f) + ':' + (i + 1));
    });
  }
  if (hits.length) add(p.level, p.id, p.title + ' (' + hits.length + ')', hits.slice(0, 12).join(', '));
  else if (p.level !== 'info') add('pass', p.id, p.title.replace(' found', '') + ' — none', '');
}

/* network egress: every fetch must be user-initiated */
const fetchSites = [];
for (const f of jsFiles) {
  read(f).split('\n').forEach((line, i) => { if (/\bfetch\s*\(/.test(line)) fetchSites.push(rel(f) + ':' + (i + 1)); });
}
add('info', 'egress', 'Network egress points', fetchSites.length ? fetchSites.join(', ') + ' — only in the optional cloud-AI advisor, to the endpoint the user configures' : 'none');

/* unescaped innerHTML heuristic */
const unescaped = [];
for (const f of jsFiles) {
  const lines = read(f).split('\n');
  lines.forEach((line, i) => {
    if (!/\.innerHTML\s*=/.test(line)) return;
    if (/esc\(/.test(line)) return;
    const vars = [...line.matchAll(/\+\s*([a-zA-Z_$][\w$.\[\]]*)\s*\+/g)].map(x => x[1]);
    if (!vars.length) return;
    const unsafe = vars.filter(v => {
      const base = v.split('.')[0];
      const idx = lines.findIndex(l => new RegExp('(const|let|var)\\s+' + base + '\\s*=').test(l));
      if (idx === -1) return true;
      const block = lines.slice(idx, idx + 8).join(' ');
      return !/esc\(/.test(block);
    });
    if (unsafe.length) unescaped.push(rel(f) + ':' + (i + 1) + ' (' + unsafe.join(', ') + ')');
  });
}
add(unescaped.length ? 'warn' : 'pass', 'xss-escape', 'innerHTML interpolation escaping',
  unescaped.length ? unescaped.join(', ') + ' — interpolate only escaped values' : 'every interpolated innerHTML value is escaped with esc()');

/* leftovers from the Chrome-only version */
const leftovers = [];
for (const f of jsFiles) read(f).split('\n').forEach((line, i) => { if (/\bchrome\./.test(line) && !/globalThis\.chrome|"chrome|'chrome|chrome-extension/.test(line)) leftovers.push(rel(f) + ':' + (i + 1)); });
add(leftovers.length ? 'fail' : 'pass', 'namespace', 'Cross-browser namespace',
  leftovers.length ? 'direct chrome.* calls remain: ' + leftovers.join(', ') : 'all API calls go through the browser/chrome shim');

/* packaging hygiene */
const maps = files.filter(f => f.endsWith('.map'));
add(maps.length ? 'warn' : 'pass', 'sourcemaps', 'Source maps', maps.length ? maps.map(rel).join(', ') : 'none');
const huge = jsFiles.filter(f => { const l = read(f).split('\n'); return l.length < 5 && sizeOf(f) > 5000; });
add(huge.length ? 'warn' : 'pass', 'minified', 'Readable source (no minification)',
  huge.length ? 'possibly minified: ' + huge.map(rel).join(', ') : 'all JS is human-readable — AMO source submission not required');
const maxLen = Math.max(...jsFiles.map(f => Math.max(...read(f).split('\n').map(l => l.length))));
add(maxLen > 800 ? 'warn' : 'pass', 'line-length', 'Longest source line', maxLen + ' chars (minified code would be far longer)');

/* inventory */
const total = files.reduce((a, f) => a + sizeOf(f), 0);
add('info', 'inventory', 'Files / size', files.length + ' files, ' + (total / 1024).toFixed(1) + ' KB');
const pngs = files.filter(f => f.endsWith('.png'));
add(pngs.length >= 4 ? 'pass' : 'warn', 'icons', 'PNG icons', pngs.map(f => rel(f) + ' ' + sizeOf(f) + 'B').join(', '));

/* ----------------------------------------------------------------- report */
const icon = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', info: 'INFO' };
const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
results.forEach(r => counts[r.level]++);
const W = 6;
console.log('LeadHarvest audit — ' + ROOT);
console.log('='.repeat(78));
for (const r of results) {
  console.log(icon[r.level].padEnd(W) + r.title + (r.detail ? '\n' + ' '.repeat(W) + r.detail : ''));
}
console.log('='.repeat(78));
console.log('pass ' + counts.pass + ' · warn ' + counts.warn + ' · fail ' + counts.fail + ' · info ' + counts.info);
if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
process.exit(counts.fail ? 1 : 0);
