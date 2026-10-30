/* LeadHarvest — telemetry: structured, privacy-safe diagnostic events.
   Rule that governs this whole file: log field-level STATUS and COUNTS, never raw
   contact values. No email, no phone, no page text ever enters an event. */
(function (root) {
  'use strict';

  /* Fallback only. The background passes the real manifest version into env() so this
     constant can never drift out of date again. */
  const EXT_VERSION = '1.3.2';
  const ALGO = { dedupe: 'v1', parser: 'v1.2', schema: '1' };

  /* Every event the extension can emit, grouped the way the logging checklist groups them. */
  const CATALOG = {
    /* 1. lifecycle */
    ext_installed: { cat: 'lifecycle', p: 'P0' },
    ext_updated: { cat: 'lifecycle', p: 'P0' },
    ext_startup: { cat: 'lifecycle', p: 'P0' },
    background_restarted: { cat: 'lifecycle', p: 'P0' },
    storage_init: { cat: 'lifecycle', p: 'P0' },
    storage_init_failed: { cat: 'lifecycle', p: 'P0' },
    config_loaded: { cat: 'lifecycle', p: 'P0' },
    config_load_failed: { cat: 'lifecycle', p: 'P0' },
    content_injection_success: { cat: 'lifecycle', p: 'P0' },
    content_injection_failed: { cat: 'lifecycle', p: 'P0' },
    permission_denied: { cat: 'lifecycle', p: 'P0' },

    /* 2. scraping session */
    session_started: { cat: 'session', p: 'P0' },
    session_completed: { cat: 'session', p: 'P0' },
    session_failed: { cat: 'session', p: 'P0' },
    session_blocked: { cat: 'session', p: 'P1' },

    /* 3. extraction */
    extraction_started: { cat: 'extraction', p: 'P0' },
    extraction_completed: { cat: 'extraction', p: 'P0' },
    extraction_failed: { cat: 'extraction', p: 'P0' },
    selector_failure: { cat: 'extraction', p: 'P1' },
    invalid_field_detected: { cat: 'extraction', p: 'P1' },
    unsupported_page_structure: { cat: 'extraction', p: 'P1' },

    /* 4. data quality */
    quality_report: { cat: 'quality', p: 'P0' },

    /* 5. duplicates */
    dedupe_started: { cat: 'duplicates', p: 'P0' },
    dedupe_completed: { cat: 'duplicates', p: 'P0' },

    /* 6. website compatibility */
    site_report: { cat: 'compatibility', p: 'P0' },

    /* 7. pagination / collection */
    scroll_collection: { cat: 'pagination', p: 'P1' },

    /* 8. filtering */
    filter_applied: { cat: 'filters', p: 'P1' },

    /* 9. export */
    export_started: { cat: 'export', p: 'P0' },
    export_completed: { cat: 'export', p: 'P0' },
    export_failed: { cat: 'export', p: 'P0' },

    /* 10. storage */
    record_inserted: { cat: 'storage', p: 'P1' },
    record_updated: { cat: 'storage', p: 'P1' },
    record_deleted: { cat: 'storage', p: 'P1' },
    storage_write_failed: { cat: 'storage', p: 'P0' },
    storage_quota: { cat: 'storage', p: 'P1' },
    retention_cleanup: { cat: 'storage', p: 'P2' },

    /* 11. api / network */
    api_request_started: { cat: 'api', p: 'P1' },
    api_request_completed: { cat: 'api', p: 'P1' },
    api_request_failed: { cat: 'api', p: 'P1' },

    /* 12. performance */
    perf_sample: { cat: 'performance', p: 'P1' },

    /* 13. errors */
    runtime_error: { cat: 'error', p: 'P0' },
    unhandled_rejection: { cat: 'error', p: 'P0' },
    error_recovered: { cat: 'error', p: 'P1' },

    /* 14. user interaction */
    popup_opened: { cat: 'ui', p: 'P1' },
    scrape_clicked: { cat: 'ui', p: 'P1' },
    settings_changed: { cat: 'ui', p: 'P1' },
    fields_changed: { cat: 'ui', p: 'P1' },
    export_format_selected: { cat: 'ui', p: 'P2' },
    export_downloaded: { cat: 'ui', p: 'P1' },
    records_deleted: { cat: 'ui', p: 'P1' },
    filter_used: { cat: 'ui', p: 'P2' },
    feedback_submitted: { cat: 'ui', p: 'P0' },
    logs_shared: { cat: 'ui', p: 'P0' },
    telemetry_toggled: { cat: 'ui', p: 'P1' },

    /* diagnostics housekeeping */
    diagnostics_generated: { cat: 'ui', p: 'P1' },
    diagnostics_downloaded: { cat: 'ui', p: 'P1' },
    log: { cat: 'general', p: 'P2' }
  };

  /* What this build genuinely does vs. what the checklist mentions but does not apply. */
  const CAPABILITIES = {
    lifecycle: { supported: true, note: 'install, update, startup, injection, config, permissions' },
    session: { supported: true, note: 'started / completed / failed, duration, trigger, method' },
    extraction: { supported: true, note: 'per-field success + missing counts, selector failures, invalid values' },
    quality: { supported: true, note: 'completeness, validity, missing-field and quality-score distribution' },
    duplicates: { supported: true, note: 'exact / potential, matched by email, phone, company' },
    compatibility: { supported: true, note: 'hostname, page type, DOM signals, dynamic content, iframes, shadow DOM' },
    pagination: { supported: false, note: 'no automatic pagination crawl in this build; auto-scroll is logged as scroll_collection' },
    filters: { supported: true, note: 'has-email / has-phone / has-address / city / minimum-confidence filters, logged as filter_applied' },
    export: { supported: true, note: 'format, record count, duration, size, failures' },
    storage: { supported: true, note: 'insert / update / delete, quota, retention cleanup, write failures' },
    api: { supported: true, note: 'cloud AI advisor only; no key, token or header is ever logged' },
    performance: { supported: true, note: 'extraction time, per-record time, DOM node count, JS heap where the browser exposes it' },
    error: { supported: true, note: 'runtime errors and unhandled rejections with sanitised stacks' },
    ui: { supported: true, note: 'popup, scrape, settings, field changes, exports, deletes, feedback' },
    backend_sync: { supported: false, note: 'there is no backend in this build — nothing is uploaded except a bundle you choose to share' },
    database: { supported: false, note: 'storage is the browser extension store, not a database server' }
  };

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,24}$/;
  const PHONE_MIN = 8, PHONE_MAX = 15;

  function isValidEmail(v) { return !!v && EMAIL_RE.test(String(v).trim()); }
  function isValidPhone(v) {
    const d = String(v || '').replace(/\D/g, '');
    return d.length >= PHONE_MIN && d.length <= PHONE_MAX;
  }
  function isValidUrl(v) {
    if (!v) return false;
    try { const u = new URL(String(v).trim()); return /^https?:$/.test(u.protocol) && u.hostname.includes('.'); }
    catch (e) { return false; }
  }

  /* Hostname only: a full URL can carry search terms, tokens or an email in a query string. */
  function sanitizeUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(String(url));
      if (!/^https?:$/.test(u.protocol)) return u.protocol.replace(':', '');
      return u.hostname.replace(/^www\./, '');
    } catch (e) { return ''; }
  }

  /* --------------------------------------------------------------- redaction */
  const EMAIL_ANY = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}/g;
  const PHONE_ANY = /\+?\d[\d\s\-().]{7,}\d/g;
  const SECRET_ANY = /\b(sk|pk|rk|api|key|token|bearer)[-_A-Za-z0-9]{8,}\b/gi;

  function redactString(s) {
    return String(s)
      .replace(EMAIL_ANY, '[email]')
      .replace(PHONE_ANY, '[number]')
      .replace(SECRET_ANY, '[secret]');
  }
  function redact(value, depth) {
    depth = depth || 0;
    if (depth > 6) return '[depth-limit]';
    if (value == null) return value;
    if (typeof value === 'string') return redactString(value).slice(0, 600);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 200).map(v => redact(v, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value)) {
        if (/pass|secret|token|apikey|api_key|authorization|cookie/i.test(k)) { out[k] = '[redacted]'; continue; }
        out[k] = redact(value[k], depth + 1);
      }
      return out;
    }
    return String(value);
  }

  /* Stack traces: keep frames, drop anything that looks like data. */
  function sanitizeStack(stack) {
    if (!stack) return '';
    return String(stack).split('\n').slice(0, 8).map(l => redactString(l).replace(/https?:\/\/[^\s)]+/g, m => {
      try { return new URL(m).origin + new URL(m).pathname; } catch (e) { return '[url]'; }
    }).slice(0, 240)).join(' | ');
  }

  /* ------------------------------------------------------------------- env */
  function env(versionOverride) {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    let browser = 'unknown', ver = '';
    if (/Edg\/([\d.]+)/.test(ua)) { browser = 'Edge'; ver = RegExp.$1; }
    else if (/OPR\/([\d.]+)/.test(ua)) { browser = 'Opera'; ver = RegExp.$1; }
    else if (/Firefox\/([\d.]+)/.test(ua)) { browser = 'Firefox'; ver = RegExp.$1; }
    else if (/Chrome\/([\d.]+)/.test(ua)) { browser = 'Chrome'; ver = RegExp.$1; }
    else if (/Version\/([\d.]+).*Safari/.test(ua)) { browser = 'Safari'; ver = RegExp.$1; }

    let platform = 'unknown';
    if (/Windows NT 10/.test(ua)) platform = 'Windows 10/11';
    else if (/Windows NT/.test(ua)) platform = 'Windows';
    else if (/Mac OS X/.test(ua)) platform = 'macOS';
    else if (/Android/.test(ua)) platform = 'Android';
    else if (/iPhone|iPad|iPod/.test(ua)) platform = 'iOS';
    else if (/CrOS/.test(ua)) platform = 'ChromeOS';
    else if (/Linux/.test(ua)) platform = 'Linux';

    const lang = (typeof navigator !== 'undefined' && (navigator.language || '')) || '';
    return {
      browser,
      browser_version: ver,
      platform,
      ui_language: lang.split('-')[0] || '',
      extension_version: versionOverride || EXT_VERSION
    };
  }

  function memMb() {
    try {
      if (typeof performance !== 'undefined' && performance.memory && performance.memory.usedJSHeapSize) {
        return Math.round(performance.memory.usedJSHeapSize / 1048576);
      }
    } catch (e) { /* not exposed */ }
    return null;
  }

  function randomId(len) {
    const bytes = new Uint8Array(len || 10);
    try { crypto.getRandomValues(bytes); } catch (e) { for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256); }
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ------------------------------------------------------------ aggregation */
  function emptyMetrics() {
    return {
      first_seen: null,
      last_seen: null,
      sessions: { started: 0, completed: 0, failed: 0 },
      records: { extracted: 0, failed: 0, skipped: 0 },
      fields: {},
      duplicates: { exact: 0, potential: 0, by_email: 0, by_phone: 0, by_company: 0 },
      exports: { total: 0, ok: 0, failed: 0, by_format: {} },
      errors: { total: 0, by_code: {} },
      perf: { extraction_ms_sum: 0, extraction_ms_count: 0, max_ms: 0, record_ms_sum: 0, record_ms_count: 0 },
      api: { requests: 0, ok: 0, failed: 0, last_status: 0, rate_limited: 0, auth_failures: 0 },
      storage: { last_records: 0, peak_records: 0 },
      sites: {}
    };
  }

  /* Fill in any missing section, so a partial or older metrics object never throws. */
  function normalizeMetrics(metrics) {
    const base = emptyMetrics();
    if (!metrics || typeof metrics !== 'object') return base;
    const out = Object.assign(base, metrics);
    ['sessions', 'records', 'duplicates', 'exports', 'errors', 'perf', 'api', 'storage', 'sites', 'fields'].forEach(k => {
      if (!out[k] || typeof out[k] !== 'object') out[k] = base[k];
    });
    if (!out.exports.by_format || typeof out.exports.by_format !== 'object') out.exports.by_format = {};
    if (!out.errors.by_code || typeof out.errors.by_code !== 'object') out.errors.by_code = {};
    return out;
  }

  /* Fold one event into the running counters. Pure: returns a new object. */
  function foldMetrics(metrics, ev) {
    const m = normalizeMetrics(metrics);
    const d = (ev && ev.data) || {};
    m.first_seen = m.first_seen || ev.ts;
    m.last_seen = ev.ts;

    switch (ev.event) {
      case 'session_started': m.sessions.started++; break;
      case 'session_completed':
        m.sessions.completed++;
        m.records.extracted += Number(d.records_extracted) || 0;
        m.records.failed += Number(d.records_failed) || 0;
        m.records.skipped += Number(d.records_skipped) || 0;
        const host = ev.hostname || d.hostname || '';
        if (host) {
          const s = m.sites[host] || (m.sites[host] = { sessions: 0, records: 0, last: '' });
          s.sessions++; s.records += Number(d.records_extracted) || 0; s.last = ev.ts;
          /* keep the map bounded: 200 sites, oldest activity dropped first */
          const hosts = Object.keys(m.sites);
          if (hosts.length > 200) {
            hosts.sort((a, b) => String(m.sites[a].last).localeCompare(String(m.sites[b].last)));
            hosts.slice(0, hosts.length - 200).forEach(h => { delete m.sites[h]; });
          }
        }
        break;
      case 'session_failed': m.sessions.failed++; break;
      case 'extraction_completed': {
        const fields = d.fields || {};
        for (const k of Object.keys(fields)) {
          const f = m.fields[k] || (m.fields[k] = { found: 0, missing: 0 });
          f.found += Number(fields[k].success) || 0;
          f.missing += Number(fields[k].missing) || 0;
        }
        const ms = Number(d.processing_time_ms) || 0;
        if (ms) { m.perf.extraction_ms_sum += ms; m.perf.extraction_ms_count++; m.perf.max_ms = Math.max(m.perf.max_ms, ms); }
        const per = Number(d.avg_record_ms) || 0;
        if (per) { m.perf.record_ms_sum += per; m.perf.record_ms_count++; }
        break;
      }
      case 'dedupe_completed':
        m.duplicates.exact += Number(d.exact) || 0;
        m.duplicates.potential += Number(d.potential) || 0;
        m.duplicates.by_email += Number(d.by_email) || 0;
        m.duplicates.by_phone += Number(d.by_phone) || 0;
        m.duplicates.by_company += Number(d.by_company) || 0;
        break;
      case 'export_completed':
        m.exports.total++; m.exports.ok++;
        m.exports.by_format[d.format || 'unknown'] = (m.exports.by_format[d.format || 'unknown'] || 0) + 1;
        break;
      case 'export_failed':
        m.exports.total++; m.exports.failed++;
        break;
      case 'runtime_error':
      case 'unhandled_rejection': {
        m.errors.total++;
        const code = (d.error_code || 'unknown').toString().slice(0, 60);
        m.errors.by_code[code] = (m.errors.by_code[code] || 0) + 1;
        break;
      }
      case 'api_request_completed':
        m.api.requests++; m.api.ok++;
        m.api.last_status = Number(d.status) || 0;
        if (m.api.last_status === 429) m.api.rate_limited++;
        break;
      case 'api_request_failed':
        m.api.requests++; m.api.failed++;
        m.api.last_status = Number(d.status) || 0;
        if (m.api.last_status === 429) m.api.rate_limited++;
        if (m.api.last_status === 401 || m.api.last_status === 403) m.api.auth_failures++;
        break;
      case 'record_inserted':
      case 'record_deleted': {
        const n = Number(d.total_after);
        if (!isNaN(n)) {
          m.storage.last_records = n;
          m.storage.peak_records = Math.max(m.storage.peak_records, n);
        }
        break;
      }
      default: break;
    }
    return m;
  }

  /* A rate can never exceed 100: the denominator is the larger of "attempts recorded"
     and "outcomes recorded", so a partial event stream cannot produce 150%. */
  const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 1000) / 10) : 0);

  /* The rates from §15 of the checklist, computed from what was actually recorded. */
  function rates(metrics) {
    const m = normalizeMetrics(metrics);
    let found = 0, missing = 0;
    for (const k of Object.keys(m.fields)) { found += m.fields[k].found; missing += m.fields[k].missing; }
    const attempts = m.records.extracted + m.records.failed;
    return {
      extraction_success_rate: pct(m.sessions.completed, Math.max(m.sessions.started, m.sessions.completed + m.sessions.failed)),
      field_completeness: pct(found, found + missing),
      valid_record_rate: null,
      duplicate_rate: pct(m.duplicates.exact + m.duplicates.potential, m.records.extracted),
      export_success_rate: pct(m.exports.ok, m.exports.total),
      failure_rate: pct(m.sessions.failed + m.records.failed, Math.max(m.sessions.started + attempts, m.sessions.completed + m.sessions.failed + attempts)),
      avg_processing_ms: m.perf.extraction_ms_count ? Math.round(m.perf.extraction_ms_sum / m.perf.extraction_ms_count) : 0,
      avg_record_ms: m.perf.record_ms_count ? Math.round((m.perf.record_ms_sum / m.perf.record_ms_count) * 10) / 10 : 0,
      data_freshness: m.last_seen || null,
      parser_reliability: pct(m.sessions.completed, m.sessions.completed + m.sessions.failed)
    };
  }

  /* Quality snapshot for one batch of records (computed in the page, counts only). */
  function qualityOf(records, settings) {
    const fields = (settings && settings.fields || []).filter(f => f.enabled !== false).map(f => f.key);
    const total = records.length;
    const missing = {}, invalid = {};
    fields.forEach(k => { missing[k] = 0; invalid[k] = 0; });
    let valid = 0, incomplete = 0;
    const buckets = { '0-25': 0, '26-50': 0, '51-75': 0, '76-100': 0 };
    records.forEach(r => {
      const v = r.values || {};
      let present = 0;
      fields.forEach(k => {
        const val = v[k];
        if (!val) { missing[k] = (missing[k] || 0) + 1; return; }
        present++;
        if (k === 'email' && !isValidEmail(String(val).split(',')[0].trim())) invalid[k] = (invalid[k] || 0) + 1;
        if (k === 'phone' && !isValidPhone(String(val).split(',')[0].trim())) invalid[k] = (invalid[k] || 0) + 1;
        if (k === 'website' && !isValidUrl(String(val).split(',')[0].trim())) invalid[k] = (invalid[k] || 0) + 1;
      });
      const score = fields.length ? (present / fields.length) * 100 : 0;
      const key = score <= 25 ? '0-25' : score <= 50 ? '26-50' : score <= 75 ? '51-75' : '76-100';
      buckets[key]++;
      const hasContact = v.phone || v.email;
      const invalidCount = fields.reduce((a, k) => a + (invalid[k] ? 1 : 0), 0);
      if (hasContact && present >= Math.min(3, fields.length) && !invalidCount) valid++;
      else if (!hasContact) incomplete++;
    });
    return {
      total,
      valid,
      invalid: total - valid - incomplete,
      incomplete,
      missing,
      invalid_format: invalid,
      quality_score_buckets: buckets,
      completeness_rate: pct(fields.length * total - Object.keys(missing).reduce((a, k) => a + missing[k], 0), fields.length * total)
    };
  }

  const api = {
    EXT_VERSION, ALGO, CATALOG, CAPABILITIES,
    env, memMb, randomId, redact, redactString, sanitizeStack, sanitizeUrl,
    isValidEmail, isValidPhone, isValidUrl,
    emptyMetrics, normalizeMetrics, foldMetrics, rates, qualityOf, pct
  };
  root.LeadTelemetry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
