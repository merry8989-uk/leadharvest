/* LeadHarvest — service worker: storage, scrape orchestration, history, logs. */
/* Cross-browser namespace: Firefox exposes promise-based `browser`, Chrome exposes `chrome`. */
const api = (typeof globalThis.browser !== 'undefined' && globalThis.browser && globalThis.browser.runtime) ? globalThis.browser : globalThis.chrome;
/* Chrome runs this file as a service worker, where the schema must be pulled in with
   importScripts(). Firefox runs it as an event page and loads the schema via
   background.scripts, so importScripts does not exist there. */
if (typeof importScripts === 'function' && typeof LeadHarvestSchema === 'undefined') {
  importScripts('/src/lib/schema.js');
}

const KEYS = { settings: 'lh_settings', records: 'lh_records', history: 'lh_history', logs: 'lh_logs' };
const CAPS = { records: 5000, history: 500 };

/* ------------------------------------------------------------- storage */
async function read(key, fallback) {
  const obj = await api.storage.local.get(key);
  return obj[key] === undefined ? fallback : obj[key];
}
async function write(key, value) {
  await api.storage.local.set({ [key]: value });
}
async function getSettings() {
  return LeadHarvestSchema.normalizeSettings(await read(KEYS.settings, {}));
}
async function getRecords() { return read(KEYS.records, []); }
async function getHistory() { return read(KEYS.history, []); }
async function getLogs() { return read(KEYS.logs, []); }

function redact(value) {
  if (typeof value === 'string') {
    return value
      .replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}/g, '[email]')
      .replace(/\+?\d[\d\s\-().]{7,}\d/g, '[number]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = redact(value[k]);
    return out;
  }
  return value;
}

/* ----------------------------------------------------------------- logs */
async function addLog(level, scope, message, data) {
  const settings = await getSettings();
  if (!settings.logging || settings.logging.enabled === false) return;
  if (level === 'debug' && !settings.logging.verbose) return;
  const entry = {
    id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: new Date().toISOString(),
    level: level || 'info',
    scope: scope || 'general',
    message: String(message || '').slice(0, 400),
    data: settings.logging.redactPII ? redact(data || {}) : (data || {}),
    v: api.runtime.getManifest().version
  };
  const logs = await getLogs();
  logs.unshift(entry);
  await write(KEYS.logs, logs.slice(0, Math.max(50, settings.logging.maxEntries || 800)));
}

/* ---------------------------------------------------------------- badge */
async function refreshBadge() {
  const records = await getRecords();
  const text = records.length ? (records.length > 999 ? '999+' : String(records.length)) : '';
  await api.action.setBadgeText({ text });
  if (text) await api.action.setBadgeBackgroundColor({ color: '#4f46e5' });
}

/* --------------------------------------------------------------- scrape */
function isBlocked(url, settings) {
  if (!url) return 'No URL';
  if (settings.privacy && settings.privacy.blockLocalhost) {
    if (/^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(url)) return 'Browser internal page par scrape nahi ho sakta.';
    if (/^file:/i.test(url)) return 'Local file par scrape nahi ho sakta.';
    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(url)) return 'Localhost block hai (Settings me off kar sakte hain).';
    if (/^https?:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url)) return 'Chrome Web Store par allowed nahi hai.';
  }
  return null;
}

async function ensureContentScript(tabId) {
  try {
    const pong = await api.tabs.sendMessage(tabId, { type: 'LH_PING' });
    if (pong && pong.ok) return true;
  } catch (e) { /* not injected yet */ }
  await api.scripting.executeScript({ target: { tabId }, files: ['src/lib/schema.js', 'src/content.js'] });
  return true;
}

async function scrapeTab(tabId, options) {
  options = options || {};
  const settings = await getSettings();
  const tab = await api.tabs.get(tabId);
  const blocked = isBlocked(tab && tab.url, settings);
  if (blocked) return { ok: false, error: blocked };

  const started = Date.now();
  try {
    await ensureContentScript(tabId);
    const result = await api.tabs.sendMessage(tabId, { type: 'LH_EXTRACT', settings });
    if (!result || !result.ok) throw new Error((result && result.error) || 'Extraction returned nothing');

    const existing = await getRecords();
    const fresh = result.records || [];
    const ids = fresh.map(r => r.id);

    /* store: newest first, cap the store */
    let merged = fresh.concat(existing);
    if (settings.scrape.dedupe) {
      const seen = new Set();
      merged = merged.filter(r => {
        const v = r.values || {};
        const k = (v.phone || '') + '|' + (v.email || '') + '|' + (v.name || '') + '|' + (v.company || '') + '|' + (r.sourceUrl || '');
        if (k === '||||' ) return true;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    await write(KEYS.records, merged.slice(0, CAPS.records));

    const history = await getHistory();
    const entry = {
      id: 'h' + Date.now().toString(36),
      at: new Date().toISOString(),
      url: result.url,
      domain: result.domain,
      title: result.title,
      pageType: result.pageType,
      method: result.method,
      count: fresh.length,
      recordIds: ids,
      durationMs: result.durationMs,
      signals: result.signals || {},
      format: options.format || null
    };
    history.unshift(entry);
    await write(KEYS.history, history.slice(0, CAPS.history));

    await addLog('info', 'scrape', 'Scraped ' + fresh.length + ' record(s) from ' + result.domain, {
      pageType: result.pageType, method: result.method, ms: result.durationMs, count: fresh.length
    });
    await refreshBadge();

    return { ok: true, result, historyEntry: entry, stored: fresh.length };
  } catch (err) {
    const msg = String((err && err.message) || err);
    await addLog('error', 'scrape', 'Scrape failed: ' + msg, { url: tab && tab.url, ms: Date.now() - started });
    return { ok: false, error: msg };
  }
}

/* -------------------------------------------------------------- routing */
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'LH_LOG': {
          await addLog(msg.level, msg.scope, msg.message, msg.data);
          sendResponse({ ok: true });
          break;
        }
        case 'LH_GET_STATE': {
          const [settings, records, history, logs] = await Promise.all([getSettings(), getRecords(), getHistory(), getLogs()]);
          sendResponse({ ok: true, settings, records, history, logs, version: api.runtime.getManifest().version });
          break;
        }
        case 'LH_SET_SETTINGS': {
          const next = LeadHarvestSchema.normalizeSettings(msg.settings || {});
          await write(KEYS.settings, next);
          await addLog('info', 'settings', 'Settings updated');
          sendResponse({ ok: true, settings: next });
          break;
        }
        case 'LH_SCRAPE': {
          const tabId = msg.tabId || (sender.tab && sender.tab.id);
          sendResponse(await scrapeTab(tabId, msg.options));
          break;
        }
        case 'LH_DELETE_RECORDS': {
          const ids = new Set(msg.ids || []);
          const records = (await getRecords()).filter(r => !ids.has(r.id));
          await write(KEYS.records, records);
          await addLog('info', 'data', 'Deleted ' + ids.size + ' record(s)');
          await refreshBadge();
          sendResponse({ ok: true, records });
          break;
        }
        case 'LH_UPDATE_RECORD': {
          const records = await getRecords();
          const rec = records.find(r => r.id === msg.id);
          if (rec) {
            rec.values = Object.assign({}, rec.values, msg.values || {});
            rec.editedAt = new Date().toISOString();
            await write(KEYS.records, records);
          }
          sendResponse({ ok: !!rec, record: rec || null });
          break;
        }
        case 'LH_CLEAR': {
          if (msg.what === 'records') await write(KEYS.records, []);
          if (msg.what === 'history') await write(KEYS.history, []);
          if (msg.what === 'logs') await write(KEYS.logs, []);
          if (msg.what === 'all') { await write(KEYS.records, []); await write(KEYS.history, []); await write(KEYS.logs, []); }
          await addLog('warn', 'data', 'Cleared: ' + msg.what);
          await refreshBadge();
          sendResponse({ ok: true });
          break;
        }
        case 'LH_DELETE_HISTORY': {
          const history = (await getHistory()).filter(h => h.id !== msg.id);
          await write(KEYS.history, history);
          sendResponse({ ok: true, history });
          break;
        }
        case 'LH_PICK_RESULT': {
          /* broadcast the picked element to every open dashboard tab */
          api.runtime.sendMessage({ type: 'LH_PICK_RESULT', fieldKey: msg.fieldKey, value: msg.value, selector: msg.selector }).catch(() => {});
          sendResponse({ ok: true });
          break;
        }
        case 'LH_EXPORT_LOG': {
          await addLog('info', 'export', 'Exported ' + (msg.count || 0) + ' record(s) as ' + msg.format, { format: msg.format, count: msg.count });
          const history = await getHistory();
          if (history.length && msg.historyId) {
            const h = history.find(x => x.id === msg.historyId);
            if (h) { h.format = msg.format; await write(KEYS.history, history); }
          }
          sendResponse({ ok: true });
          break;
        }
        case 'LH_OPEN_DASHBOARD': {
          await api.tabs.create({ url: api.runtime.getURL('src/dashboard.html') + (msg.tab ? '#' + msg.tab : '') });
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message: ' + (msg && msg.type) });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();
  return true;   /* async response */
});

/* ------------------------------------------------------------- lifecycle */
api.runtime.onInstalled.addListener(async (details) => {
  const settings = await getSettings();
  await write(KEYS.settings, settings);
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({
      id: 'lh-scrape',
      title: 'LeadHarvest: is page se contact data scrape karein',
      contexts: ['page', 'selection', 'link', 'image']
    });
  });
  await addLog('info', 'lifecycle', 'Extension ' + (details.reason || 'installed') + ' (v' + api.runtime.getManifest().version + ')');
  await refreshBadge();
  if (details.reason === 'install') {
    api.tabs.create({ url: api.runtime.getURL('src/dashboard.html') + '#help' });
  }
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'lh-scrape' || !tab || !tab.id) return;
  const res = await scrapeTab(tab.id, {});
  await api.action.setBadgeBackgroundColor({ color: res.ok ? '#16a34a' : '#dc2626' });
  setTimeout(() => refreshBadge(), 2500);
});

api.runtime.onStartup.addListener(() => { refreshBadge(); });
