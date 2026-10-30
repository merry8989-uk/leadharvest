/* LeadHarvest — service worker: storage, scrape orchestration, history, telemetry. */
/* Cross-browser namespace: Firefox exposes promise-based `browser`, Chrome exposes `chrome`. */
const api = (typeof globalThis.browser !== 'undefined' && globalThis.browser && globalThis.browser.runtime) ? globalThis.browser : globalThis.chrome;
/* Chrome runs this file as a service worker, where the libraries must be pulled in with
   importScripts(). Firefox runs it as an event page and loads them via background.scripts,
   so importScripts does not exist there. */
if (typeof importScripts === 'function' && typeof LeadHarvestSchema === 'undefined') {
  importScripts('/src/lib/schema.js', '/src/lib/telemetry.js');
}

const T = globalThis.LeadTelemetry || {};
const KEYS = {
  settings: 'lh_settings', records: 'lh_records', history: 'lh_history',
  logs: 'lh_logs', metrics: 'lh_metrics', session: 'lh_session'
};
const CAPS = { records: 5000, history: 500, logs: 5000 };

/* ------------------------------------------------------------- storage */
async function read(key, fallback) {
  try {
    const obj = await api.storage.local.get(key);
    return obj[key] === undefined ? fallback : obj[key];
  } catch (e) {
    return fallback;
  }
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
async function getMetrics() { return read(KEYS.metrics, null); }

/* A pseudonymous, per-install identifier. It reveals nothing about the person. */
async function sessionId() {
  let id = await read(KEYS.session, null);
  if (!id) {
    id = 's_' + (T.randomId ? T.randomId(8) : Math.random().toString(16).slice(2, 18));
    await write(KEYS.session, id);
  }
  return id;
}

/* -------------------------------------------------------------- events */
const PRIORITY = { error: 'P0', warn: 'P1', info: 'P2', debug: 'P3' };

/**
 * Record one structured diagnostic event.
 * `event` is a key from LeadTelemetry.CATALOG. Raw contact values never get here —
 * callers pass counts and booleans, and everything is redacted again on the way in.
 */
async function recordEvent(event, opts) {
  opts = opts || {};
  try {
    const settings = await getSettings();
    if (!settings.logging || settings.logging.enabled === false) return null;
    if (opts.level === 'debug' && !settings.logging.verbose) return null;

    const meta = (T.CATALOG && T.CATALOG[event]) || { cat: opts.category || 'general', p: 'P2' };
    const env = T.env ? T.env() : {};
    const data = settings.logging.redactPII !== false && T.redact ? T.redact(opts.data || {}) : (opts.data || {});

    const entry = {
      id: 'l' + Date.now().toString(36) + (T.randomId ? T.randomId(2) : ''),
      ts: new Date().toISOString(),
      event,
      category: opts.category || meta.cat,
      priority: opts.priority || meta.p,
      level: opts.level || (opts.error ? 'error' : 'info'),
      scope: opts.scope || meta.cat,
      message: String(opts.message || '').slice(0, 400),
      hostname: opts.hostname || (T.sanitizeUrl ? T.sanitizeUrl(opts.url) : '') || '',
      session_id: opts.sessionId || '',
      browser: env.browser || '',
      browser_version: env.browser_version || '',
      platform: env.platform || '',
      v: api.runtime.getManifest().version,
      data
    };

    const logs = await getLogs();
    logs.unshift(entry);
    await write(KEYS.logs, logs.slice(0, Math.max(50, Math.min(CAPS.logs, settings.logging.maxEntries || 1200))));

    /* running counters, so rates survive log rotation */
    const current = (await getMetrics()) || (T.emptyMetrics ? T.emptyMetrics() : {});
    const next = T.foldMetrics ? T.foldMetrics(current, entry) : current;
    await write(KEYS.metrics, next);
    return entry;
  } catch (e) {
    return null;
  }
}

/* Backwards-compatible shim used by older call sites and by content scripts. */
async function addLog(level, scope, message, data) {
  return recordEvent('log', { level, scope, message, data });
}

/* ---------------------------------------------------------------- badge */
async function refreshBadge() {
  try {
    const records = await getRecords();
    const text = records.length ? (records.length > 999 ? '999+' : String(records.length)) : '';
    await api.action.setBadgeText({ text });
    if (text) await api.action.setBadgeBackgroundColor({ color: '#4f46e5' });
  } catch (e) { /* badge is cosmetic */ }
}

/* --------------------------------------------------------------- scrape */
function isBlocked(url, settings) {
  if (!url) return 'No URL';
  /* Browser-internal and local pages can never be scraped, whatever the settings say. */
  if (/^(chrome|edge|about|moz-extension|chrome-extension|devtools|view-source|data|blob):/i.test(url)) {
    return 'Browser internal page par scrape nahi ho sakta.';
  }
  if (/^file:/i.test(url)) return 'Local file par scrape nahi ho sakta (file URL access off hai).';
  if (!/^https?:/i.test(url)) return 'Sirf http/https pages par scrape hota hai.';
  if (/^https?:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|addons\.mozilla\.org)/i.test(url)) {
    return 'Extension store pages par allowed nahi hai.';
  }
  if (settings.privacy && settings.privacy.blockLocalhost) {
    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(url)) return 'Localhost block hai (Settings me off kar sakte hain).';
  }
  return null;
}

/* Compare phone numbers the way a human would: +91 98765 43210 and 9876543210 are the same. */
function phoneKey(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

async function ensureContentScript(tabId) {
  try {
    const pong = await api.tabs.sendMessage(tabId, { type: 'LH_PING' });
    if (pong && pong.ok) return { injected: false, ok: true };
  } catch (e) { /* not injected yet — that is the normal first path */ }
  try {
    await api.scripting.executeScript({
      target: { tabId },
      files: ['src/lib/schema.js', 'src/lib/telemetry.js', 'src/content.js']
    });
    return { injected: true, ok: true };
  } catch (e) {
    return { injected: true, ok: false, error: String((e && e.message) || e) };
  }
}

/* De-duplicate and report exactly why each record was dropped. */
function dedupeRecords(merged) {
  const stats = { exact: 0, potential: 0, by_email: 0, by_phone: 0, by_company: 0 };
  const t0 = Date.now();
  const seenEmail = new Set(), seenPhone = new Set(), seenNameCo = new Set(), seenAll = new Set();
  const kept = [];

  for (const r of merged) {
    const v = r.values || {};
    const email = (v.email || '').split(',')[0].trim().toLowerCase();
    const phone = phoneKey((v.phone || '').split(',')[0]);
    const nameCo = ((v.name || '') + '|' + (v.company || '')).toLowerCase().trim();

    const fullKey = email + '|' + phone + '|' + nameCo;
    if (seenAll.has(fullKey)) { stats.exact++; continue; }
    if (email && seenEmail.has(email)) { stats.exact++; stats.by_email++; continue; }
    if (phone && seenPhone.has(phone)) { stats.exact++; stats.by_phone++; continue; }
    if (nameCo !== '|' && seenNameCo.has(nameCo)) { stats.potential++; stats.by_company++; continue; }

    seenAll.add(fullKey);
    if (email) seenEmail.add(email);
    if (phone) seenPhone.add(phone);
    if (nameCo !== '|') seenNameCo.add(nameCo);
    kept.push(r);
  }
  return { kept, stats, durationMs: Date.now() - t0 };
}

async function scrapeTab(tabId, options) {
  options = options || {};
  const settings = await getSettings();
  const tab = await api.tabs.get(tabId);
  const hostname = T.sanitizeUrl ? T.sanitizeUrl(tab && tab.url) : '';
  const blocked = isBlocked(tab && tab.url, settings);
  if (blocked) {
    await recordEvent('session_blocked', { level: 'warn', message: blocked, hostname, data: { reason: blocked } });
    return { ok: false, error: blocked };
  }

  const sid = 'sc_' + (T.randomId ? T.randomId(6) : Date.now().toString(36));
  const trigger = options.trigger || 'unknown';
  const started = Date.now();
  await recordEvent('session_started', {
    message: 'Scrape started on ' + hostname,
    hostname, sessionId: sid,
    data: { trigger, user_initiated: trigger !== 'auto', config_version: (settings.schemaVersion || 1) }
  });

  try {
    const inj = await ensureContentScript(tabId);
    await recordEvent(inj.ok ? 'content_injection_success' : 'content_injection_failed', {
      level: inj.ok ? 'info' : 'error',
      hostname, sessionId: sid,
      message: inj.ok ? (inj.injected ? 'Extractor injected' : 'Extractor already present') : 'Injection failed',
      data: inj.ok ? { injected: inj.injected } : { error_code: 'inject_failed', error_message: inj.error }
    });
    if (!inj.ok) throw new Error(inj.error || 'Could not inject the extractor');

    const result = await api.tabs.sendMessage(tabId, { type: 'LH_EXTRACT', settings, sessionId: sid });
    if (!result || !result.ok) throw new Error((result && result.error) || 'Extraction returned nothing');

    const existing = await getRecords();
    const minConf = Number(settings.scrape.minConfidence) || 0;
    const allFound = result.records || [];
    const fresh = minConf > 0 ? allFound.filter(r => (Number(r.confidence) || 0) >= minConf) : allFound;
    if (minConf > 0 && fresh.length !== allFound.length) {
      await recordEvent('filter_applied', {
        hostname, sessionId: sid,
        message: 'Confidence filter dropped ' + (allFound.length - fresh.length) + ' record(s)',
        data: { type: 'min_confidence', threshold: minConf, kept: fresh.length, rejected: allFound.length - fresh.length }
      });
    }
    const ids = fresh.map(r => r.id);

    let merged = fresh.concat(existing);
    let dedupe = { stats: { exact: 0, potential: 0, by_email: 0, by_phone: 0, by_company: 0 }, durationMs: 0 };
    if (settings.scrape.dedupe) {
      await recordEvent('dedupe_started', { hostname, sessionId: sid, message: 'De-duplicating ' + merged.length + ' records', data: { candidates: merged.length, algorithm_version: T.ALGO ? T.ALGO.dedupe : 'v1' } });
      const d = dedupeRecords(merged);
      dedupe = { stats: d.stats, durationMs: d.durationMs };
      merged = d.kept;
      await recordEvent('dedupe_completed', {
        hostname, sessionId: sid,
        message: 'Duplicates: ' + (d.stats.exact + d.stats.potential),
        data: Object.assign({}, d.stats, { duration_ms: d.durationMs, algorithm_version: T.ALGO ? T.ALGO.dedupe : 'v1' })
      });
    }

    const stored = merged.slice(0, CAPS.records);
    try {
      await write(KEYS.records, stored);
    } catch (e) {
      await recordEvent('storage_write_failed', { level: 'error', hostname, sessionId: sid, message: 'Could not save records: ' + ((e && e.message) || e), data: { error_code: 'quota_or_write', error_message: String((e && e.message) || e).slice(0, 200) } });
      throw e;
    }

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

    await recordEvent('session_completed', {
      hostname, sessionId: sid,
      message: 'Scraped ' + fresh.length + ' record(s) from ' + hostname,
      data: {
        records_discovered: Number(result.signals && result.signals.candidates) || fresh.length,
        records_extracted: fresh.length,
        records_failed: Number(result.failedFields) || 0,
        records_skipped: dedupe.stats.exact + dedupe.stats.potential,
        duration_ms: Date.now() - started,
        extraction_ms: result.durationMs || 0,
        method: result.method,
        page_type: result.pageType,
        status: 'completed',
        trigger
      }
    });

    if (stored.length >= CAPS.records) {
      await recordEvent('storage_quota', { level: 'warn', hostname, sessionId: sid, message: 'Record store is full', data: { records: stored.length, cap: CAPS.records, percent: 100 } });
    }
    await recordEvent('record_inserted', { hostname, sessionId: sid, message: fresh.length + ' record(s) added', data: { count: fresh.length, total_after: stored.length } });

    await refreshBadge();
    return { ok: true, result, historyEntry: entry, stored: fresh.length, dedupe: dedupe.stats };
  } catch (err) {
    const msg = String((err && err.message) || err);
    await recordEvent('session_failed', {
      level: 'error', hostname, sessionId: sid,
      message: 'Scrape failed: ' + msg,
      data: { error_code: /inject/i.test(msg) ? 'injection_failed' : /receiving end/i.test(msg) ? 'no_receiver' : 'extract_failed', error_message: msg.slice(0, 300), duration_ms: Date.now() - started, trigger }
    });
    return { ok: false, error: msg };
  }
}

/* ---------------------------------------------------------- diagnostics */
async function buildDiagnostics(note, trigger) {
  const [settings, records, history, logs, metrics] = await Promise.all([
    getSettings(), getRecords(), getHistory(), getLogs(), getMetrics()
  ]);
  const env = T.env ? T.env() : {};
  const m = metrics || (T.emptyMetrics ? T.emptyMetrics() : {});
  const bytes = (() => { try { return JSON.stringify({ records, logs, history }).length; } catch (e) { return 0; } })();

  const fieldSummary = (settings.fields || []).map(f => ({ key: f.key, label: f.label, enabled: f.enabled !== false, type: f.type, custom: !!f.custom }));

  return {
    meta: {
      generated_at: new Date().toISOString(),
      trigger: trigger || 'manual',
      note: String(note || '').slice(0, 800),
      session_id: await sessionId(),
      extension_version: api.runtime.getManifest().version,
      env,
      parser_version: T.ALGO ? T.ALGO.parser : '',
      schema_version: String(settings.schemaVersion || 1)
    },
    counts: {
      records: records.length,
      history: history.length,
      events: logs.length,
      storage_bytes_estimate: bytes
    },
    capabilities: T.CAPABILITIES || {},
    rates: T.rates ? T.rates(m) : {},
    metrics: m,
    settings_snapshot: {
      fields_enabled: fieldSummary.filter(f => f.enabled).length,
      fields_total: fieldSummary.length,
      fields: fieldSummary,
      scrape: settings.scrape,
      output: settings.output,
      logging: settings.logging,
      privacy: settings.privacy,
      ai: {
        mode: settings.ai.mode,
        provider: settings.ai.provider,
        model: settings.ai.model,
        has_key: !!settings.ai.apiKey,
        auto_suggest: settings.ai.autoSuggest
      }
    },
    history: history.slice(0, 200).map(h => ({
      at: h.at,
      hostname: T.sanitizeUrl ? T.sanitizeUrl(h.url) : h.domain,
      page_type: h.pageType,
      method: h.method,
      count: h.count,
      duration_ms: h.durationMs,
      format: h.format,
      signals: h.signals
    })),
    events: logs.slice(0, 1200)
  };
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
        case 'LH_LOG_EVENT': {
          const entry = await recordEvent(msg.event || 'log', {
            level: msg.level, scope: msg.scope, message: msg.message,
            data: msg.data, hostname: msg.hostname, sessionId: msg.sessionId
          });
          sendResponse({ ok: true, entry });
          break;
        }
        case 'LH_GET_STATE': {
          const [settings, records, history, logs, metrics] = await Promise.all([
            getSettings(), getRecords(), getHistory(), getLogs(), getMetrics()
          ]);
          sendResponse({
            ok: true, settings, records, history, logs,
            metrics: metrics || (T.emptyMetrics ? T.emptyMetrics() : {}),
            env: T.env ? T.env() : {},
            capabilities: T.CAPABILITIES || {},
            version: api.runtime.getManifest().version
          });
          break;
        }
        case 'LH_GET_SUMMARY': {
          const [settings, records, history, logs, metrics] = await Promise.all([
            getSettings(), getRecords(), getHistory(), getLogs(), getMetrics()
          ]);
          sendResponse({
            ok: true,
            counts: { records: records.length, history: history.length, logs: logs.length },
            settings,
            metrics: metrics || (T.emptyMetrics ? T.emptyMetrics() : {}),
            env: T.env ? T.env() : {},
            version: api.runtime.getManifest().version
          });
          break;
        }
        case 'LH_GET_DIAGNOSTICS': {
          sendResponse({ ok: true, bundle: await buildDiagnostics(msg.note, msg.trigger) });
          break;
        }
        case 'LH_SHARE_LOGS': {
          const bundle = await buildDiagnostics(msg.note, msg.channel || 'share');
          await recordEvent('feedback_submitted', {
            message: 'User shared diagnostics via ' + (msg.channel || 'share'),
            data: { channel: msg.channel || 'share', has_note: !!(msg.note && msg.note.trim()), events: bundle.counts.events }
          });
          await recordEvent('logs_shared', {
            message: 'Diagnostics bundle prepared for the developer',
            data: { channel: msg.channel || 'share', bytes: bundle.counts.storage_bytes_estimate, records_included: 0 }
          });
          sendResponse({ ok: true, bundle });
          break;
        }
        case 'LH_SET_SETTINGS': {
          const before = await getSettings();
          const next = LeadHarvestSchema.normalizeSettings(msg.settings || {});
          await write(KEYS.settings, next);
          const changed = [];
          ['scrape', 'output', 'ai', 'logging', 'privacy'].forEach(k => {
            if (JSON.stringify(before[k]) !== JSON.stringify(next[k])) changed.push(k);
          });
          if (JSON.stringify(before.fields) !== JSON.stringify(next.fields)) {
            const on = next.fields.filter(f => f.enabled !== false).length;
            await recordEvent('fields_changed', { message: 'Field schema changed', data: { fields_enabled: on, fields_total: next.fields.length, custom_fields: next.fields.filter(f => f.custom).length } });
          }
          if (changed.length) {
            await recordEvent('settings_changed', { message: 'Settings changed: ' + changed.join(', '), data: { sections: changed } });
            if (changed.includes('logging')) {
              await recordEvent('telemetry_toggled', { message: 'Logging settings changed', data: { enabled: next.logging.enabled !== false, verbose: !!next.logging.verbose, redact: next.logging.redactPII !== false } });
            }
          }
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
          const all = await getRecords();
          const records = all.filter(r => !ids.has(r.id));
          await write(KEYS.records, records);
          await recordEvent('record_deleted', { message: 'Deleted ' + ids.size + ' record(s)', data: { count: ids.size, total_after: records.length } });
          await recordEvent('records_deleted', { message: 'User deleted records', data: { count: ids.size } });
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
            await recordEvent('record_updated', { message: 'Record edited', data: { fields: Object.keys(msg.values || {}).length } });
          }
          sendResponse({ ok: !!rec, record: rec || null });
          break;
        }
        case 'LH_CLEAR': {
          if (msg.what === 'records') await write(KEYS.records, []);
          if (msg.what === 'history') await write(KEYS.history, []);
          if (msg.what === 'logs') { await write(KEYS.logs, []); await write(KEYS.metrics, T.emptyMetrics ? T.emptyMetrics() : {}); }
          if (msg.what === 'all') {
            await write(KEYS.records, []); await write(KEYS.history, []);
            await write(KEYS.logs, []); await write(KEYS.metrics, T.emptyMetrics ? T.emptyMetrics() : {});
          }
          await recordEvent('retention_cleanup', { level: 'warn', message: 'User cleared: ' + msg.what, data: { what: msg.what } });
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
          api.runtime.sendMessage({ type: 'LH_PICK_RESULT', fieldKey: msg.fieldKey, value: msg.value, selector: msg.selector }).catch(() => {});
          sendResponse({ ok: true });
          break;
        }
        case 'LH_EXPORT_LOG': {
          const durationMs = Number(msg.durationMs) || 0;
          const bytes = Number(msg.bytes) || 0;
          if (msg.status === 'failed') {
            await recordEvent('export_failed', {
              level: 'error',
              message: 'Export failed: ' + (msg.error || 'unknown'),
              data: { format: msg.format, error_code: msg.errorCode || 'export_error', error_message: String(msg.error || '').slice(0, 200) }
            });
          } else {
            await recordEvent('export_completed', {
              message: 'Exported ' + (msg.count || 0) + ' record(s) as ' + msg.format,
              data: {
                format: msg.format, records_exported: Number(msg.count) || 0,
                records_excluded: Number(msg.excluded) || 0,
                duration_ms: durationMs, bytes,
                column_mapping: msg.columns || null
              }
            });
            await recordEvent('export_downloaded', { message: 'User downloaded an export', data: { format: msg.format } });
          }
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
  await sessionId();
  await recordEvent(details.reason === 'update' ? 'ext_updated' : 'ext_installed', {
    message: 'Extension ' + (details.reason || 'installed') + ' v' + api.runtime.getManifest().version,
    data: { reason: details.reason || 'install', previous_version: details.previousVersion || null, storage_initialized: true, config_loaded: true }
  });
  await refreshBadge();
  if (details.reason === 'install') {
    api.tabs.create({ url: api.runtime.getURL('src/dashboard.html') + '#help' });
  }
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'lh-scrape' || !tab || !tab.id) return;
  const res = await scrapeTab(tab.id, { trigger: 'context_menu' });
  await api.action.setBadgeBackgroundColor({ color: res.ok ? '#16a34a' : '#dc2626' });
  setTimeout(() => refreshBadge(), 2500);
});

/* Keyboard shortcut (Alt+Shift+L by default) scrapes the active tab. */
if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener(async (command) => {
    if (command !== 'scrape-page') return;
    try {
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) return;
      const res = await scrapeTab(tab.id, { trigger: 'shortcut' });
      await api.action.setBadgeBackgroundColor({ color: res.ok ? '#16a34a' : '#dc2626' });
      setTimeout(() => refreshBadge(), 2500);
    } catch (e) {
      await recordEvent('runtime_error', { level: 'error', scope: 'commands', message: 'Shortcut failed: ' + ((e && e.message) || e), data: { error_code: 'shortcut_failed' } });
    }
  });
}

api.runtime.onStartup.addListener(async () => {
  await recordEvent('background_restarted', { message: 'Browser started, background context loaded' });
  await refreshBadge();
});

/* Uncaught failures inside the background context. */
if (typeof self !== 'undefined' && self.addEventListener) {
  self.addEventListener('error', (e) => {
    recordEvent('runtime_error', {
      level: 'error', scope: 'background',
      message: 'Background error: ' + ((e && e.message) || 'unknown'),
      data: {
        error_code: 'background_error',
        error_message: String((e && e.message) || '').slice(0, 300),
        stack: T.sanitizeStack ? T.sanitizeStack(e && e.error && e.error.stack) : ''
      }
    });
  });
  self.addEventListener('unhandledrejection', (e) => {
    const reason = e && e.reason;
    recordEvent('unhandled_rejection', {
      level: 'error', scope: 'background',
      message: 'Unhandled rejection in background',
      data: {
        error_code: 'unhandled_rejection',
        error_message: String((reason && reason.message) || reason || '').slice(0, 300),
        stack: T.sanitizeStack ? T.sanitizeStack(reason && reason.stack) : ''
      }
    });
  });
}
