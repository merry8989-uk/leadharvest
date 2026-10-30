/* LeadHarvest — turns the collected telemetry into a shareable bundle.
   Two outputs: a machine-readable JSON and a human-readable TXT. Both are built
   from counts and hostnames only; no scraped contact value is ever included. */
(function (root) {
  'use strict';

  const TO = 'br19shc39@gmail.com';
  const pad = n => String(n).padStart(2, '0');
  const stamp = (d) => {
    d = d || new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  };
  const pretty = iso => {
    const d = new Date(iso || Date.now());
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  const pct = (v) => (v == null ? '—' : v + '%');

  function rateRows(b) {
    const r = b.rates || {};
    return [
      ['Extraction success rate', pct(r.extraction_success_rate)],
      ['Field completeness', pct(r.field_completeness)],
      ['Duplicate rate', pct(r.duplicate_rate)],
      ['Export success rate', pct(r.export_success_rate)],
      ['Failure rate', pct(r.failure_rate)],
      ['Avg extraction time', (r.avg_processing_ms || 0) + ' ms'],
      ['Avg time per record', (r.avg_record_ms || 0) + ' ms'],
      ['Data freshness', r.data_freshness ? pretty(r.data_freshness) : '—']
    ];
  }

  function topSites(b, limit) {
    const sites = (b.metrics && b.metrics.sites) || {};
    return Object.keys(sites)
      .map(k => ({ host: k, sessions: sites[k].sessions || 0, records: sites[k].records || 0, last: sites[k].last }))
      .sort((a, c) => c.sessions - a.sessions)
      .slice(0, limit || 8);
  }

  function summaryText(b) {
    const m = b.meta || {};
    const c = b.counts || {};
    const mm = b.metrics || {};
    const env = m.env || {};
    const sessions = mm.sessions || {};
    const errs = (mm.errors && mm.errors.total) || 0;
    const sites = topSites(b, 5);
    const lines = [
      'LeadHarvest diagnostics',
      'v' + (m.extension_version || '') + ' · ' + (env.browser || '') + ' ' + (env.browser_version || '') + ' · ' + (env.platform || ''),
      'Generated: ' + pretty(m.generated_at),
      '',
      'Records stored: ' + c.records + ' · Sessions: ' + (sessions.started || 0) + ' (' + (sessions.completed || 0) + ' ok, ' + (sessions.failed || 0) + ' failed)',
      'Extraction success: ' + pct(b.rates && b.rates.extraction_success_rate) + ' · Field completeness: ' + pct(b.rates && b.rates.field_completeness),
      'Duplicates: ' + ((mm.duplicates && mm.duplicates.exact) || 0) + ' exact, ' + ((mm.duplicates && mm.duplicates.potential) || 0) + ' potential',
      'Errors: ' + errs,
      sites.length ? 'Sites: ' + sites.map(s => s.host + ' (' + s.sessions + ')').join(', ') : 'Sites: —'
    ];
    if (m.note) lines.push('', 'User note: ' + m.note);
    return lines.join('\n');
  }

  function textReport(b) {
    const out = [];
    const line = (s) => out.push(s == null ? '' : s);
    const rule = () => out.push('-'.repeat(72));

    line('LEADHARVEST DIAGNOSTIC REPORT');
    line('Generated: ' + pretty(b.meta.generated_at) + '   Trigger: ' + b.meta.trigger);
    line('Extension: v' + b.meta.extension_version + '   Parser: ' + b.meta.parser_version + '   Schema: ' + b.meta.schema_version);
    line('Browser: ' + b.meta.env.browser + ' ' + b.meta.env.browser_version + '   Platform: ' + b.meta.env.platform + '   UI language: ' + b.meta.env.ui_language);
    line('Session id (pseudonymous): ' + b.meta.session_id);
    if (b.meta.note) { line(''); line('USER NOTE: ' + b.meta.note); }
    rule();

    line('COUNTS');
    line('  records: ' + b.counts.records + '   history: ' + b.counts.history + '   events: ' + b.counts.events + '   est. storage: ' + Math.round(b.counts.storage_bytes_estimate / 1024) + ' KB');
    line('');

    line('METRICS');
    rateRows(b).forEach(([k, v]) => line('  ' + (k + ' ').padEnd(30, '.') + ' ' + v));
    line('');

    const mm = b.metrics || {};
    line('SESSION / RECORD TOTALS');
    line('  sessions started: ' + ((mm.sessions && mm.sessions.started) || 0) + '   completed: ' + ((mm.sessions && mm.sessions.completed) || 0) + '   failed: ' + ((mm.sessions && mm.sessions.failed) || 0));
    line('  records extracted: ' + ((mm.records && mm.records.extracted) || 0) + '   failed: ' + ((mm.records && mm.records.failed) || 0) + '   skipped: ' + ((mm.records && mm.records.skipped) || 0));
    line('');

    const fields = mm.fields || {};
    if (Object.keys(fields).length) {
      line('FIELD EXTRACTION (success / missing across all sessions)');
      Object.keys(fields).forEach(k => line('  ' + (k + ' ').padEnd(16, '.') + ' ' + fields[k].found + ' / ' + fields[k].missing));
      line('');
    }

    const dup = mm.duplicates || {};
    line('DUPLICATES');
    line('  exact: ' + (dup.exact || 0) + '   potential: ' + (dup.potential || 0) + '   by email: ' + (dup.by_email || 0) + '   by phone: ' + (dup.by_phone || 0) + '   by company: ' + (dup.by_company || 0));
    line('');

    const ex = mm.exports || {};
    line('EXPORTS');
    line('  total: ' + (ex.total || 0) + '   ok: ' + (ex.ok || 0) + '   failed: ' + (ex.failed || 0));
    if (ex.by_format && Object.keys(ex.by_format).length) {
      line('  by format: ' + Object.keys(ex.by_format).map(k => k + '=' + ex.by_format[k]).join(', '));
    }
    line('');

    const errs = mm.errors || {};
    line('ERRORS');
    line('  total: ' + (errs.total || 0));
    if (errs.by_code && Object.keys(errs.by_code).length) {
      Object.keys(errs.by_code).forEach(k => line('  ' + k + ': ' + errs.by_code[k]));
    }
    line('');

    const api = mm.api || {};
    line('CLOUD AI REQUESTS (optional feature)');
    line('  requests: ' + (api.requests || 0) + '   ok: ' + (api.ok || 0) + '   failed: ' + (api.failed || 0) + '   last status: ' + (api.last_status || 0));
    line('');

    const sites = topSites(b, 20);
    line('SITES (hostname only)');
    if (sites.length) sites.forEach(s => line('  ' + (s.host + ' ').padEnd(34, '.') + ' ' + s.sessions + ' session(s), ' + s.records + ' record(s), last ' + pretty(s.last)));
    else line('  none');
    line('');

    line('CAPABILITY REPORT — what this build does and does not collect');
    Object.keys(b.capabilities || {}).forEach(k => {
      const c = b.capabilities[k];
      line('  [' + (c.supported ? 'x' : ' ') + '] ' + k.padEnd(16) + ' ' + c.note);
    });
    line('');

    line('SETTINGS SNAPSHOT (no keys, no values)');
    const ss = b.settings_snapshot || {};
    line('  fields enabled: ' + ss.fields_enabled + '/' + ss.fields_total);
    line('  scrape: ' + JSON.stringify(ss.scrape));
    line('  output: ' + JSON.stringify(ss.output));
    line('  logging: ' + JSON.stringify(ss.logging));
    line('  ai: mode=' + (ss.ai && ss.ai.mode) + ' provider=' + (ss.ai && ss.ai.provider) + ' model=' + (ss.ai && ss.ai.model) + ' key_set=' + (ss.ai && ss.ai.has_key));
    line('');

    line('RECENT SCRAPE HISTORY');
    (b.history || []).slice(0, 30).forEach(h => {
      line('  ' + pretty(h.at) + '  ' + (h.hostname || '') + '  ' + (h.page_type || '') + '  ' + (h.method || '') + '  ' + (h.count || 0) + ' record(s)  ' + (h.duration_ms || 0) + 'ms  ' + (h.format || '-'));
    });
    line('');

    line('EVENTS (' + Math.min((b.events || []).length, 1200) + ')');
    line('  time                 level  event                    host                 message');
    (b.events || []).slice(0, 1200).forEach(e => {
      line('  ' + (pretty(e.ts) + '            ').slice(0, 20) + ' ' + (e.level || 'info').padEnd(6) + ' ' + (e.event || 'log').padEnd(24) + ' ' + ((e.hostname || '-') + '                    ').slice(0, 20) + ' ' + (e.message || '') +
        (e.data && Object.keys(e.data).length ? '  ' + JSON.stringify(e.data) : ''));
    });
    rule();
    line('Privacy: this report contains counts, hostnames and technical signals only.');
    line('No email address, phone number, contact name or page text is included.');
    line('Contact: ' + TO);
    return out.join('\n');
  }

  function build(bundle) {
    const payload = {
      generator: 'LeadHarvest diagnostics',
      format_version: 2,
      bundle
    };
    const json = JSON.stringify(payload, null, 2);
    const text = textReport(bundle);
    const base = 'leadharvest-diagnostics-' + stamp();
    return {
      json,
      text,
      filenameJson: base + '.json',
      filenameText: base + '.txt',
      summary: summaryText(bundle),
      sizeKb: Math.round((json.length / 1024) * 10) / 10
    };
  }

  function mailSubject(bundle) {
    const env = (bundle.meta && bundle.meta.env) || {};
    const v = (bundle.meta && bundle.meta.extension_version) || '';
    return 'LeadHarvest diagnostics — v' + v + ' ' + (env.browser || '') + ' ' + (env.platform || '');
  }

  function mailBody(bundle, files) {
    const s = summaryText(bundle);
    const attach = (files && files.length)
      ? '\n\nFile attach kar dein (Downloads folder me hai):\n' + files.map(f => '  · ' + f).join('\n')
      : '';
    return s + attach + '\n\n---\nSent from the LeadHarvest extension (user-initiated).';
  }

  /* mailto: opens the default mail client. Long bodies are trimmed so the URL stays valid. */
  function mailtoUrl(subject, body) {
    const maxBody = 1400;
    const b = body.length > maxBody ? body.slice(0, maxBody) + '\n…(trimmed — poora bundle attachment me hai)' : body;
    return 'mailto:' + TO + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(b);
  }

  /* Gmail web compose, for people who do not use a desktop mail client. */
  function gmailUrl(subject, body) {
    const maxBody = 1400;
    const b = body.length > maxBody ? body.slice(0, maxBody) + '\n…(trimmed — poora bundle attachment me hai)' : body;
    return 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(TO) +
      '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(b);
  }

  const api = { TO, build, textReport, summaryText, mailSubject, mailBody, mailtoUrl, gmailUrl, rateRows, topSites };
  root.LeadDiagnostics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
