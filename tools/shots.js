/* Renders the real extension UI in headless Chromium with a stubbed extension API,
   so the screenshots show the actual dashboard, not a mockup. */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const EXT = path.join(__dirname, '..');
const OUT = path.join(EXT, 'docs/assets');
const T = require(path.join(EXT, 'src/lib/telemetry.js'));
const S = require(path.join(EXT, 'src/lib/schema.js'));

const settings = S.normalizeSettings({ output: { format: 'xlsx' } });

const records = [
  { id: 'r1', values: { name: 'Rajesh Sharma', designation: 'Managing Partner', company: 'Sharma & Associates', phone: '+919876543210', email: 'info@sharmaca.in', address: '204, Ashoka Chambers, MG Road, Pune, Maharashtra 411001', city: 'Pune', state: 'Maharashtra', pincode: '411001', website: 'https://sharmaca.in' }, sourceUrl: 'https://sharmaca.in/contact', pageTitle: 'Contact — Sharma & Associates', scrapedAt: '2026-10-30T09:12:00.000Z', domain: 'sharmaca.in', confidence: 1, method: 'contact' },
  { id: 'r2', values: { name: 'Priya Nair', designation: 'Head of Engineering', company: 'Nimbus Tech', phone: '+918800112233', email: 'priya@nimbustech.io', address: '3rd Floor, Cyber Hub, Gurugram, Haryana 122002', city: 'Gurugram', state: 'Haryana', pincode: '122002' }, sourceUrl: 'https://nimbustech.io/team', pageTitle: 'Our Team — Nimbus Tech', scrapedAt: '2026-10-30T09:18:00.000Z', domain: 'nimbustech.io', confidence: 1, method: 'card' },
  { id: 'r3', values: { name: 'Amit Patel', company: 'Krishna Textiles', phone: '+919812345670', email: 'sales@krishnatex.com', address: '12 Ring Road, Surat, Gujarat 395003', city: 'Surat', state: 'Gujarat', pincode: '395003' }, sourceUrl: 'https://example-directory.com/suppliers', pageTitle: 'Verified Suppliers', scrapedAt: '2026-10-30T09:24:00.000Z', domain: 'example-directory.com', confidence: 0.86, method: 'table' },
  { id: 'r4', values: { name: 'Nita Verma', company: 'Bharat Steel', phone: '+912224567890', email: 'nita@bharatsteel.co.in', address: '7 Turner Road, Bandra West, Mumbai 400050', city: 'Mumbai', state: 'Maharashtra', pincode: '400050' }, sourceUrl: 'https://example-directory.com/suppliers', pageTitle: 'Verified Suppliers', scrapedAt: '2026-10-30T09:24:00.000Z', domain: 'example-directory.com', confidence: 0.81, method: 'table' },
  { id: 'r5', values: { name: 'Dr. Meera Iyer', designation: 'Consultant Physician', company: 'Sunrise Clinic', phone: '+918041234567', email: 'appointments@sunriseclinic.in', address: 'No. 8, 4th Cross, Jayanagar, Bengaluru, Karnataka 560041', city: 'Bengaluru', state: 'Karnataka', pincode: '560041' }, sourceUrl: 'https://sunriseclinic.in/', pageTitle: 'Sunrise Clinic', scrapedAt: '2026-10-30T09:31:00.000Z', domain: 'sunriseclinic.in', confidence: 1, method: 'general' },
  { id: 'r6', values: { name: 'Rohit Mehta', designation: 'VP Sales', company: 'Nimbus Tech', phone: '+919900887766', email: 'rohit@nimbustech.io', address: '3rd Floor, Cyber Hub, Gurugram, Haryana 122002', city: 'Gurugram', state: 'Haryana', pincode: '122002' }, sourceUrl: 'https://nimbustech.io/team', pageTitle: 'Our Team — Nimbus Tech', scrapedAt: '2026-10-30T09:18:00.000Z', domain: 'nimbustech.io', confidence: 1, method: 'card' },
  { id: 'r7', values: { name: 'Anita Rao', designation: 'Product Designer', company: 'Nimbus Tech', email: 'anita@nimbustech.io' }, sourceUrl: 'https://nimbustech.io/team', pageTitle: 'Our Team — Nimbus Tech', scrapedAt: '2026-10-30T09:18:00.000Z', domain: 'nimbustech.io', confidence: 0.57, method: 'card' }
];

const history = [
  { id: 'h1', at: '2026-10-30T09:31:00.000Z', url: 'https://sunriseclinic.in/', domain: 'sunriseclinic.in', title: 'Sunrise Clinic', pageType: 'general', method: 'general', count: 1, durationMs: 38, signals: {}, format: 'xlsx' },
  { id: 'h2', at: '2026-10-30T09:24:00.000Z', url: 'https://example-directory.com/suppliers', domain: 'example-directory.com', title: 'Verified Suppliers', pageType: 'directory', method: 'table', count: 3, durationMs: 51, signals: {}, format: 'xlsx' },
  { id: 'h3', at: '2026-10-30T09:18:00.000Z', url: 'https://nimbustech.io/team', domain: 'nimbustech.io', title: 'Our Team', pageType: 'team', method: 'card', count: 3, durationMs: 22, signals: {}, format: null },
  { id: 'h4', at: '2026-10-30T09:12:00.000Z', url: 'https://sharmaca.in/contact', domain: 'sharmaca.in', title: 'Contact', pageType: 'contact', method: 'contact', count: 1, durationMs: 30, signals: {}, format: 'csv' }
];

const env = { browser: 'Chrome', browser_version: '148.0.7339.80', platform: 'Windows 10/11', ui_language: 'en', extension_version: '1.2.0' };

/* Build a realistic event log + the metrics that come from it. */
let metrics = T.emptyMetrics();
const events = [];
function ev(event, ts, data, message) {
  const e = { id: 'l' + events.length, ts, event, category: (T.CATALOG[event] || {}).cat || 'general', priority: (T.CATALOG[event] || {}).p || 'P2', level: 'info', scope: (T.CATALOG[event] || {}).cat || 'general', message, hostname: data.hostname || '', session_id: data.session_id || '', browser: env.browser, browser_version: env.browser_version, platform: env.platform, v: '1.2.0', data };
  events.unshift(e);
  metrics = T.foldMetrics(metrics, e);
}
ev('session_started', '2026-10-30T09:31:00.000Z', { trigger: 'popup', hostname: 'sunriseclinic.in', session_id: 'sc_a91f2c' }, 'Scrape started on sunriseclinic.in');
ev('content_injection_success', '2026-10-30T09:31:00.100Z', { injected: true, hostname: 'sunriseclinic.in' }, 'Extractor injected');
ev('extraction_completed', '2026-10-30T09:31:00.038Z', { records: 1, method: 'general', page_type: 'general', processing_time_ms: 38, avg_record_ms: 38, fields: { name: { success: 1, missing: 0 }, phone: { success: 1, missing: 0 }, email: { success: 1, missing: 0 }, address: { success: 1, missing: 0 }, designation: { success: 1, missing: 0 }, company: { success: 1, missing: 0 } }, selector_failures: 0, dom_nodes: 412 }, 'Extracted 1 record in 38ms');
ev('quality_report', '2026-10-30T09:31:00.040Z', { total: 1, valid: 1, invalid: 0, incomplete: 0, completeness_rate: 100 }, 'Lead quality snapshot');
ev('site_report', '2026-10-30T09:31:00.041Z', { hostname: 'sunriseclinic.in', page_type: 'general', supported: true, dom_detected: true, selectors_available: 6, dynamic_content: false, shadow_dom_hosts: 0, iframes: 0 }, 'Compatibility report');
ev('session_completed', '2026-10-30T09:31:00.050Z', { records_extracted: 1, records_skipped: 0, duration_ms: 38, method: 'general', page_type: 'general', status: 'completed', trigger: 'popup', hostname: 'sunriseclinic.in', session_id: 'sc_a91f2c' }, 'Scraped 1 record from sunriseclinic.in');
ev('dedupe_completed', '2026-10-30T09:24:00.060Z', { exact: 1, potential: 0, by_email: 1, by_phone: 0, by_company: 0, duration_ms: 2, hostname: 'example-directory.com' }, 'Duplicates: 1');
ev('session_completed', '2026-10-30T09:24:00.070Z', { records_extracted: 3, records_skipped: 1, duration_ms: 51, method: 'table', page_type: 'directory', status: 'completed', trigger: 'dashboard', hostname: 'example-directory.com', session_id: 'sc_77b1de' }, 'Scraped 3 records from example-directory.com');
ev('session_completed', '2026-10-30T09:18:00.080Z', { records_extracted: 3, records_skipped: 0, duration_ms: 22, method: 'card', page_type: 'team', status: 'completed', trigger: 'context_menu', hostname: 'nimbustech.io', session_id: 'sc_3f90aa' }, 'Scraped 3 records from nimbustech.io');
ev('export_completed', '2026-10-30T09:33:00.000Z', { format: 'xlsx', records_exported: 7, records_excluded: 0, duration_ms: 41, bytes: 6588, column_mapping: 13 }, 'Exported 7 records as xlsx');
ev('export_downloaded', '2026-10-30T09:33:00.010Z', { format: 'xlsx' }, 'User downloaded an export');
ev('session_failed', '2026-10-30T09:05:00.000Z', { error_code: 'no_receiver', error_message: 'Could not establish connection', duration_ms: 12, hostname: 'blocked-example.com' }, 'Scrape failed: Could not establish connection');
metrics.sessions.started += 1;
metrics.sessions.failed += 1;
metrics.errors.total += 1;
metrics.errors.by_code.no_receiver = 1;
metrics.records.extracted += 7;
metrics.fields = { name: { found: 7, missing: 0 }, phone: { found: 6, missing: 1 }, email: { found: 6, missing: 1 }, address: { found: 6, missing: 1 }, designation: { found: 3, missing: 4 }, company: { found: 6, missing: 1 }, city: { found: 5, missing: 2 }, pincode: { found: 5, missing: 2 } };
metrics.duplicates.exact = 1;
metrics.duplicates.by_email = 1;
metrics.exports = { total: 2, ok: 2, failed: 0, by_format: { xlsx: 1, csv: 1 } };
metrics.perf = { extraction_ms_sum: 111, extraction_ms_count: 3, max_ms: 51, record_ms_sum: 37, record_ms_count: 3 };
metrics.sites = { 'sunriseclinic.in': { sessions: 1, records: 1, last: '2026-10-30T09:31:00Z' }, 'example-directory.com': { sessions: 1, records: 3, last: '2026-10-30T09:24:00Z' }, 'nimbustech.io': { sessions: 1, records: 3, last: '2026-10-30T09:18:00Z' } };

const state = { ok: true, version: '1.2.0', settings, records, history, logs: events, metrics, env, capabilities: T.CAPABILITIES };

const STUB = `
window.chrome = {
  runtime: {
    sendMessage: async (msg) => {
      if (msg && msg.type === 'LH_GET_STATE') return ${JSON.stringify(state)};
      if (msg && (msg.type === 'LH_GET_DIAGNOSTICS' || msg.type === 'LH_SHARE_LOGS')) {
        return { ok: true, bundle: { meta: { generated_at: new Date().toISOString(), trigger: 'preview', note: '', session_id: 's_9f21c4', extension_version: '1.2.0', env: ${JSON.stringify(env)}, parser_version: 'v1.2', schema_version: '1' }, counts: { records: 7, history: 4, events: 11, storage_bytes_estimate: 18432 }, capabilities: {}, rates: {}, metrics: {}, settings_snapshot: { fields_enabled: 12, fields_total: 15, scrape: {}, output: {}, logging: {}, ai: { mode: 'local', provider: 'sarvam', model: '', has_key: false } }, history: [], events: [] } };
      }
      return { ok: true };
    },
    onMessage: { addListener: () => {} },
    getURL: p => 'chrome-extension://leadharvest/' + p,
    getManifest: () => ({ version: '1.2.0' })
  },
  storage: { local: { get: async () => ({}), set: async () => {} } },
  tabs: { query: async () => [{ id: 1, url: 'https://sunriseclinic.in/', title: 'Sunrise Clinic' }], create: async () => {}, sendMessage: async () => ({ ok: true }) },
  scripting: { executeScript: async () => {} },
  downloads: { download: (o, cb) => cb && cb(1) },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} }
};
window.navigator.canShare = undefined;
window.setInterval = () => 0;
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--force-device-scale-factor=2', '--hide-scrollbars']
  });

  const dash = await browser.newPage();
  await dash.setViewport({ width: 1360, height: 880, deviceScaleFactor: 2 });
  await dash.evaluateOnNewDocument(STUB);
  await dash.goto('file://' + path.join(EXT, 'src/dashboard.html') + '#data', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 700));

  const rows = await dash.$$eval('#dataTable tbody tr', els => els.length);
  console.log('dashboard rows rendered:', rows);

  await dash.evaluate(() => { document.body.style.zoom = '0.86'; });
  await new Promise(r => setTimeout(r, 250));
  await dash.screenshot({ path: path.join(OUT, 'shot-dashboard-data.png') });
  await dash.evaluate(() => { document.body.style.zoom = '1'; });
  console.log('shot-dashboard-data.png');

  await dash.evaluate(() => { document.querySelector('#tabs button[data-tab="schema"]').click(); });
  await new Promise(r => setTimeout(r, 400));
  await dash.evaluate(() => { document.querySelectorAll('#fieldList .fieldrow')[2].classList.add('open'); });
  await new Promise(r => setTimeout(r, 250));
  await dash.screenshot({ path: path.join(OUT, 'shot-dashboard-schema.png') });
  console.log('shot-dashboard-schema.png');

  await dash.evaluate(() => { document.querySelector('#tabs button[data-tab="settings"]').click(); });
  await new Promise(r => setTimeout(r, 400));
  await dash.evaluate(() => { const el = document.querySelector('#diagPanel'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 74); });
  await new Promise(r => setTimeout(r, 350));
  await dash.screenshot({ path: path.join(OUT, 'shot-dashboard-diagnostics.png') });
  console.log('shot-dashboard-diagnostics.png');

  await dash.evaluate(() => { document.querySelector('#tabs button[data-tab="history"]').click(); });
  await new Promise(r => setTimeout(r, 350));
  await dash.screenshot({ path: path.join(OUT, 'shot-dashboard-history.png') });
  console.log('shot-dashboard-history.png');

  const pop = await browser.newPage();
  await pop.setViewport({ width: 372, height: 300, deviceScaleFactor: 3 });
  await pop.evaluateOnNewDocument(STUB);
  await pop.goto('file://' + path.join(EXT, 'src/popup.html'), { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  await pop.screenshot({ path: path.join(OUT, 'shot-popup.png'), fullPage: true });
  console.log('shot-popup.png');

  await browser.close();
  fs.readdirSync(OUT).filter(f => f.endsWith('.png')).forEach(f => {
    console.log('  ', f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' KB');
  });
})();
