/* LeadHarvest — turns records + schema into CSV / XLSX / TXT / Markdown / JSON / HTML / PDF. */
(function (root) {
  'use strict';
  const SCHEMA = root.LeadHarvestSchema;

  const pad = n => String(n).padStart(2, '0');
  function stamp(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes());
  }
  function prettyDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function columnsFor(settings, opts) {
    opts = opts || {};
    const cols = SCHEMA.enabledFields(settings).map(f => ({ key: f.key, label: f.label, type: f.type }));
    if (opts.includeSystem !== false) {
      cols.push({ key: 'sourceUrl', label: 'Source URL', type: 'url' });
      cols.push({ key: 'pageTitle', label: 'Page Title', type: 'text' });
      cols.push({ key: 'scrapedAt', label: 'Scraped At', type: 'text' });
    }
    return cols;
  }

  function toTable(records, settings, opts) {
    const cols = columnsFor(settings, opts);
    const rows = (records || []).map(r => {
      const src = r.values || r;
      return cols.map(c => {
        let v = src[c.key];
        if (v == null && r[c.key] != null) v = r[c.key];   /* system fields live on the record root */
        if (v == null) return '';
        if (c.key === 'scrapedAt') return prettyDate(v);
        return String(v).replace(/\s+/g, ' ').trim();
      });
    });
    return { cols, rows };
  }

  function fileName(settings, ext, records) {
    const tpl = (settings.output && settings.output.fileNameTemplate) || 'leadharvest-{domain}-{date}';
    const first = (records && records[0]) || {};
    const domain = (first.domain || (first.sourceUrl ? (() => { try { return new URL(first.sourceUrl).hostname; } catch (e) { return 'site'; } })() : 'site')).replace(/^www\./, '');
    const name = tpl
      .replace(/\{domain\}/g, domain)
      .replace(/\{date\}/g, stamp().split('_')[0])
      .replace(/\{time\}/g, stamp().split('_')[1])
      .replace(/\{count\}/g, String((records || []).length))
      .replace(/[^\w.\-]+/g, '-')
      .replace(/-+/g, '-');
    return name + '.' + ext;
  }

  /* ------------------------------------------------------------------ CSV */
  function toCSV(table, settings) {
    const d = (settings.output && settings.output.delimiter) || ',';
    const q = v => {
      const s = String(v == null ? '' : v);
      return new RegExp('["' + d + '\\n\\r]').test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [];
    if (!settings.output || settings.output.includeHeader !== false) lines.push(table.cols.map(c => q(c.label)).join(d));
    table.rows.forEach(r => lines.push(r.map(q).join(d)));
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  /* ------------------------------------------------------------------ TXT */
  function toTXT(table, settings, meta) {
    const out = [];
    const bar = '='.repeat(64);
    out.push('LeadHarvest export');
    out.push(meta && meta.subtitle ? meta.subtitle : '');
    out.push('Records: ' + table.rows.length + '   Generated: ' + prettyDate(new Date().toISOString()));
    out.push(bar);
    table.rows.forEach((r, i) => {
      out.push('');
      out.push((i + 1) + ') ' + (r[0] || r[1] || r[2] || 'Record'));
      table.cols.forEach((c, ci) => {
        if (ci === 0 || !r[ci]) return;
        out.push('   ' + (c.label + '            ').slice(0, 14) + ': ' + r[ci]);
      });
      out.push('-'.repeat(64));
    });
    return out.join('\n') + '\n';
  }

  /* ------------------------------------------------------------- Markdown */
  function toMD(table, settings, meta) {
    const out = ['# LeadHarvest export', ''];
    if (meta && meta.subtitle) out.push('_' + meta.subtitle + '_', '');
    out.push('**' + table.rows.length + ' record(s)** · generated ' + prettyDate(new Date().toISOString()), '');
    table.rows.forEach((r, i) => {
      out.push('## ' + (i + 1) + '. ' + (r[0] || r[1] || 'Record'));
      table.cols.forEach((c, ci) => {
        if (ci === 0 || !r[ci]) return;
        out.push('- **' + c.label + ':** ' + r[ci]);
      });
      out.push('');
    });
    return out.join('\n');
  }

  /* ----------------------------------------------------------------- JSON */
  function toJSON(table, settings, meta, records) {
    return JSON.stringify({
      generator: 'LeadHarvest',
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      subtitle: (meta && meta.subtitle) || '',
      columns: table.cols,
      count: table.rows.length,
      records: (records || []).map((r, i) => {
        const obj = {};
        table.cols.forEach((c, ci) => { if (table.rows[i][ci]) obj[c.key] = table.rows[i][ci]; });
        return obj;
      })
    }, null, 2);
  }

  /* ----------------------------------------------------------------- HTML */
  function toHTML(table, settings, meta) {
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const head = table.cols.map(c => '<th>' + esc(c.label) + '</th>').join('');
    const body = table.rows.map((r, i) => '<tr>' + r.map((v, ci) => {
      const isUrl = table.cols[ci].type === 'url' && /^https?:/.test(v);
      return '<td>' + (isUrl ? '<a href="' + esc(v) + '">' + esc(v) + '</a>' : esc(v)) + '</td>';
    }).join('') + '</tr>').join('\n');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + esc((meta && meta.title) || 'LeadHarvest export') + '</title>' +
      '<style>' +
      '@page{size:A4;margin:14mm}' +
      'body{font:13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;margin:24px}' +
      'h1{font-size:22px;margin:0 0 4px}.sub{color:#6b7280;font-size:12px;margin-bottom:18px}' +
      'table{border-collapse:collapse;width:100%;font-size:11.5px}' +
      'th{background:#1f2937;color:#fff;text-align:left;padding:7px 8px;font-weight:600;position:sticky;top:0}' +
      'td{border-bottom:1px solid #e5e7eb;padding:6px 8px;vertical-align:top;word-break:break-word}' +
      'tr:nth-child(even) td{background:#f9fafb}' +
      'a{color:#4f46e5;text-decoration:none}' +
      'footer{margin-top:18px;color:#9ca3af;font-size:11px}' +
      '@media print{.no-print{display:none}body{margin:0}}' +
      '</style></head><body>' +
      '<h1>' + esc((meta && meta.title) || 'LeadHarvest export') + '</h1>' +
      '<div class="sub">' + esc((meta && meta.subtitle) || '') + ' · ' + table.rows.length + ' record(s) · ' + esc(prettyDate(new Date().toISOString())) + '</div>' +
      '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>' +
      '<footer>Generated locally by LeadHarvest. No data was uploaded anywhere.</footer>' +
      '</body></html>';
  }

  function build(format, records, settings, meta) {
    const table = toTable(records, settings, { includeSystem: true });
    const baseMeta = Object.assign({ title: 'LeadHarvest export', subtitle: '' }, meta || {});
    switch (format) {
      case 'csv':
        return { ext: 'csv', mime: 'text/csv;charset=utf-8', text: toCSV(table, settings), table };
      case 'txt':
        return { ext: 'txt', mime: 'text/plain;charset=utf-8', text: toTXT(table, settings, baseMeta), table };
      case 'md':
        return { ext: 'md', mime: 'text/markdown;charset=utf-8', text: toMD(table, settings, baseMeta), table };
      case 'json':
        return { ext: 'json', mime: 'application/json;charset=utf-8', text: toJSON(table, settings, baseMeta, records), table };
      case 'html':
        return { ext: 'html', mime: 'text/html;charset=utf-8', text: toHTML(table, settings, baseMeta), table };
      case 'xlsx':
        return {
          ext: 'xlsx',
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          bytes: root.LeadXLSX.build({
            headers: table.cols.map(c => c.label),
            rows: table.rows,
            includeHeader: !settings.output || settings.output.includeHeader !== false
          }),
          table
        };
      case 'pdf':
        return {
          ext: 'pdf',
          mime: 'application/pdf',
          bytes: root.LeadPDF.buildReport({
            title: baseMeta.title,
            subtitle: baseMeta.subtitle,
            columns: table.cols,
            rows: table.rows,
            paper: (settings.output && settings.output.pdfPaper) || 'a4'
          }),
          table
        };
      default:
        throw new Error('Unknown format: ' + format);
    }
  }

  const api = { build, toTable, columnsFor, fileName, stamp, prettyDate, toCSV, toTXT, toMD, toJSON, toHTML };
  root.LeadExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
