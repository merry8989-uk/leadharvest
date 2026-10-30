/* LeadHarvest — dashboard controller */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
/* Cross-browser namespace: Firefox exposes promise-based `browser`, Chrome exposes `chrome`. */
const api = (typeof globalThis.browser !== 'undefined' && globalThis.browser && globalThis.browser.runtime) ? globalThis.browser : globalThis.chrome;
  const $$ = s => Array.from(document.querySelectorAll(s));
  const SCHEMA = LeadHarvestSchema;

  let S = { settings: null, records: [], history: [], logs: [], version: '1.0.0' };
  const ui = {
    search: '', sort: { key: '', dir: 1 }, selected: new Set(), showDisabled: true, tab: 'data',
    filters: { has: '', city: '', company: '', minConf: 0 }
  };

  /* ------------------------------------------------------------- helpers */
  let toastTimer = null;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.style.background = kind === 'err' ? '#b91c1c' : kind === 'ok' ? '#047857' : '#111827';
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtTime = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url || ''; } };

  async function send(msg) {
    try { return await api.runtime.sendMessage(msg); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  }

  async function loadState() {
    const r = await send({ type: 'LH_GET_STATE' });
    if (r && r.ok) { S = r; $('#ver').textContent = 'v' + (r.version || '1.0.0'); }
    else toast('State load nahi hua: ' + ((r && r.error) || 'unknown'), 'err');
  }

  async function persistSettings() {
    const r = await send({ type: 'LH_SET_SETTINGS', settings: S.settings });
    if (r && r.ok) S.settings = r.settings;
  }

  /* ---------------------------------------------------------------- tabs */
  function switchTab(name) {
    ui.tab = name;
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('section.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
    if (name === 'data') renderData();
    if (name === 'schema') renderSchema();
    if (name === 'settings') renderSettings();
    if (name === 'history') renderHistory();
    if (name === 'logs') renderLogs();
    if (name === 'ai') renderAiForm();
    if (name === 'help') renderHelp();
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  }
  $$('#tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  /* ------------------------------------------------------------- tab list */
  function chooseTab(title) {
    return new Promise(async resolve => {
      const tabs = (await api.tabs.query({})).filter(t => /^https?:/i.test(t.url || '') && !(t.url || '').includes('dashboard.html'));
      if (!tabs.length) { toast('Koi website tab khula nahi hai. Pehle site kholein.', 'err'); resolve(null); return; }
      const back = document.createElement('div');
      back.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:200;display:grid;place-items:center';
      const box = document.createElement('div');
      box.style.cssText = 'background:#fff;border-radius:14px;padding:18px;width:min(560px,92vw);max-height:70vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)';
LeadDOM.mount(box, '<h3 style="margin-bottom:4px">' + esc(title) + '</h3><p class="small muted" style="margin-bottom:12px">Kis tab par kaam karna hai?</p>');
      tabs.slice(0, 25).forEach(t => {
        const b = document.createElement('button');
        b.className = 'btn';
        b.style.cssText = 'display:block;width:100%;text-align:left;margin-bottom:6px';
LeadDOM.mount(b, '<b>' + esc(hostOf(t.url)) + '</b><br><span class="small muted">' + esc((t.title || '').slice(0, 80)) + '</span>');
        b.addEventListener('click', () => { back.remove(); resolve(t); });
        box.appendChild(b);
      });
      const cancel = document.createElement('button');
      cancel.className = 'btn btn-ghost';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => { back.remove(); resolve(null); });
      box.appendChild(cancel);
      back.appendChild(box);
      document.body.appendChild(back);
    });
  }

  /* ------------------------------------------------------------- DATA tab */
  function columns() {
    return LeadExport.columnsFor(S.settings, { includeSystem: true });
  }

  function filteredRecords() {
    let list = S.records.slice();
    const q = ui.search.trim().toLowerCase();
    if (q) {
      list = list.filter(r => {
        const hay = Object.keys(r.values || {}).map(k => r.values[k]).join(' ') + ' ' + (r.sourceUrl || '');
        return hay.toLowerCase().includes(q);
      });
    }
    const f = ui.filters;
    if (f.has) {
      list = list.filter(r => {
        const v = r.values || {};
        if (f.has === 'contact') return !!(v.email || v.phone);
        if (f.has === 'email') return !!v.email;
        if (f.has === 'phone') return !!v.phone;
        if (f.has === 'address') return !!v.address;
        if (f.has === 'company') return !!v.company;
        return true;
      });
    }
    if (f.city) list = list.filter(r => String((r.values || {}).city || '').toLowerCase().includes(f.city.toLowerCase()));
    if (f.company) list = list.filter(r => String((r.values || {}).company || '').toLowerCase().includes(f.company.toLowerCase()));
    if (f.minConf > 0) list = list.filter(r => (Number(r.confidence) || 0) >= f.minConf);

    if (ui.sort.key) {
      const k = ui.sort.key, dir = ui.sort.dir;
      list.sort((a, b) => {
        const av = ((a.values || {})[k] || a[k] || '').toString().toLowerCase();
        const bv = ((b.values || {})[k] || b[k] || '').toString().toLowerCase();
        return av === bv ? 0 : av > bv ? dir : -dir;
      });
    }
    return list;
  }

  function renderData() {
    const cols = columns();
    const list = filteredRecords();
    const max = 400;
    const shown = list.slice(0, max);
    $('#dataCount').textContent = list.length + ' record' + (list.length === 1 ? '' : 's') +
      (list.length !== S.records.length ? ' of ' + S.records.length : '') +
      (list.length > max ? ' · first ' + max + ' shown' : '');
    const selBtn = $('#exportSel');
    if (selBtn) {
      const n = ui.selected.size ? list.filter(r => ui.selected.has(r.id)).length : list.length;
      selBtn.textContent = 'Export ' + n + ' record' + (n === 1 ? '' : 's');
    }

    const head = ['<th style="width:34px"><input type="checkbox" id="selAll"></th>']
      .concat(cols.map(c => '<th data-sort="' + esc(c.key) + '" style="cursor:pointer;white-space:nowrap">' + esc(c.label) + (ui.sort.key === c.key ? (ui.sort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'))
      .concat(['<th style="width:70px">Actions</th>']).join('');
LeadDOM.mount($('#dataTable thead'), '<tr>' + head + '</tr>');

    if (!shown.length) {
LeadDOM.mount($('#dataTable tbody'), '<tr><td colspan="' + (cols.length + 2) + '" style="padding:26px;text-align:center" class="muted">' +
        (S.records.length ? 'Search se koi record match nahi hua.' : 'Abhi koi data nahi. Top-right "Scrape current tab" dabayein ya extension icon se page scrape karein.') + '</td></tr>');
      return;
    }

    const rows = shown.map(r => {
      const cells = cols.map(c => {
        const v = (r.values || {})[c.key] != null ? r.values[c.key] : (c.key === 'scrapedAt' ? LeadExport.prettyDate(r.scrapedAt) : (r[c.key] || ''));
        const editable = c.key !== 'scrapedAt' && c.key !== 'sourceUrl' && c.key !== 'pageTitle';
        const isUrl = c.type === 'url' && /^https?:/.test(v);
        return '<td' + (editable ? ' contenteditable="true" data-id="' + esc(r.id) + '" data-key="' + esc(c.key) + '"' : '') + ' title="' + esc(v) + '">' +
          (isUrl ? '<a href="' + esc(v) + '" target="_blank" rel="noreferrer">' + esc(hostOf(v)) + '</a>' : esc(v)) + '</td>';
      }).join('');
      return '<tr data-id="' + esc(r.id) + '"><td><input type="checkbox" class="rowsel" data-id="' + esc(r.id) + '"' + (ui.selected.has(r.id) ? ' checked' : '') + '></td>' +
        cells + '<td><button class="btn btn-sm delRow" data-id="' + esc(r.id) + '" title="Delete record" aria-label="Delete record">✕</button></td></tr>';
    }).join('');
LeadDOM.mount($('#dataTable tbody'), rows);

    const selAll = $('#selAll');
    if (selAll) selAll.addEventListener('change', e => {
      if (e.target.checked) shown.forEach(r => ui.selected.add(r.id)); else ui.selected.clear();
      renderData();
    });
    $$('#dataTable th[data-sort]').forEach(th => th.addEventListener('click', () => {
      const k = th.dataset.sort;
      ui.sort = { key: k, dir: ui.sort.key === k ? -ui.sort.dir : 1 };
      renderData();
    }));
    $$('.rowsel').forEach(cb => cb.addEventListener('change', e => {
      if (e.target.checked) ui.selected.add(e.target.dataset.id); else ui.selected.delete(e.target.dataset.id);
    }));
    $$('.delRow').forEach(b => b.addEventListener('click', async () => {
      await send({ type: 'LH_DELETE_RECORDS', ids: [b.dataset.id] });
      ui.selected.delete(b.dataset.id);
      await loadState(); renderData(); toast('Record delete ho gaya');
    }));
    $$('#dataTable td[contenteditable]').forEach(td => {
      td.addEventListener('blur', async () => {
        const val = td.textContent.trim();
        const rec = S.records.find(r => r.id === td.dataset.id);
        if (!rec) return;
        if (((rec.values || {})[td.dataset.key] || '') === val) return;
        const values = {}; values[td.dataset.key] = val;
        const r = await send({ type: 'LH_UPDATE_RECORD', id: td.dataset.id, values });
        if (r && r.ok) { rec.values = r.record.values; toast('Saved'); }
      });
      td.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); td.blur(); } });
    });
  }

  /* ----------------------------------------------------------- EXPORTING */
  async function doExport(format, records) {
    if (!records.length) { toast('Export ke liye koi record nahi.', 'err'); return; }
    const t0 = Date.now();
    try {
      const out = LeadExport.build(format, records, S.settings, {
        title: 'LeadHarvest export',
        subtitle: records.length + ' record(s) · ' + (records[0].domain || hostOf(records[0].sourceUrl))
      });
      const name = LeadExport.fileName(S.settings, out.ext, records);
      const payload = out.bytes || out.text;
      const bytes = (payload && (payload.byteLength || payload.length)) || 0;
      await LeadSave.save(name, out.mime, payload);
      await send({
        type: 'LH_EXPORT_LOG', format, count: records.length,
        durationMs: Date.now() - t0, bytes,
        columns: out.table ? out.table.cols.length : 0,
        excluded: Math.max(0, S.records.length - records.length)
      });
      if (format === 'pdf' && LeadPDF.hasNonLatin(out.table.rows)) {
        toast('PDF saved, lekin Hindi/Devanagari text ? ban sakta hai — HTML export → Print se perfect PDF milega.', 'warn');
      } else {
        toast('Saved: ' + name + ' (Downloads folder)', 'ok');
      }
      await loadState(); renderLogs(); renderDiag();
    } catch (e) {
      toast('Export failed: ' + e.message, 'err');
      await send({ type: 'LH_EXPORT_LOG', status: 'failed', format, error: e.message, errorCode: 'export_exception', durationMs: Date.now() - t0 });
    }
  }

  function selectedRecords() {
    const list = filteredRecords();
    const sel = list.filter(r => ui.selected.has(r.id));
    return sel.length ? sel : list;
  }

  $('#exportSel').addEventListener('click', () => doExport($('#exportFormat').value, selectedRecords()));
  $('#exportAll').addEventListener('click', () => doExport($('#exportFormat').value, S.records));
  $('#deleteSel').addEventListener('click', async () => {
    const ids = Array.from(ui.selected);
    if (!ids.length) { toast('Pehle rows select karein.', 'err'); return; }
    if (!confirm(ids.length + ' record delete karein?')) return;
    await send({ type: 'LH_DELETE_RECORDS', ids });
    ui.selected.clear();
    await loadState(); renderData(); toast('Deleted');
  });
  $('#copyBtn').addEventListener('click', async () => {
    const recs = selectedRecords();
    if (!recs.length) { toast('Copy ke liye kuch nahi.', 'err'); return; }
    const t = LeadExport.toTable(recs, S.settings, { includeSystem: false });
    const text = [t.cols.map(c => c.label).join('\t')].concat(t.rows.map(r => r.join('\t'))).join('\n');
    const ok = await LeadSave.copy(text);
    toast(ok ? 'Clipboard par copy ho gaya' : 'Copy fail hua', ok ? 'ok' : 'err');
  });
  $('#printBtn').addEventListener('click', async () => {
    const recs = selectedRecords();
    if (!recs.length) { toast('Print ke liye kuch nahi.', 'err'); return; }
    const html = LeadExport.toHTML(LeadExport.toTable(recs, S.settings), S.settings, { title: 'LeadHarvest export', subtitle: recs.length + ' record(s)' });
    await api.storage.local.set({ lh_print_payload: html });
    api.tabs.create({ url: api.runtime.getURL('src/print.html') });
  });
  let searchTimer = null;
  $('#searchBox').addEventListener('input', e => {
    ui.search = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderData, 180);
  });

  function applyFilters(track) {
    const before = filteredRecords().length;
    ui.filters.has = ($('#filterHas') || {}).value || '';
    ui.filters.city = (($('#filterCity') || {}).value || '').trim();
    ui.filters.company = (($('#filterCompany') || {}).value || '').trim();
    ui.filters.minConf = Number((($('#filterConf') || {}).value) || 0);
    renderData();
    if (track && (ui.filters.has || ui.filters.city || ui.filters.company || ui.filters.minConf)) {
      const after = filteredRecords().length;
      send({
        type: 'LH_LOG_EVENT', event: 'filter_applied', level: 'info', scope: 'ui',
        message: 'Filter applied',
        data: { type: 'record_filter', has: ui.filters.has, city: !!ui.filters.city, company: !!ui.filters.company, min_confidence: ui.filters.minConf, matched: after, rejected: S.records.length - after }
      });
    }
  }
  ['#filterHas', '#filterCity', '#filterCompany', '#filterConf'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener(sel === '#filterCity' || sel === '#filterCompany' ? 'input' : 'change', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => applyFilters(true), 200);
    });
  });
  if ($('#clearFilters')) $('#clearFilters').addEventListener('click', () => {
    ['#filterHas', '#filterCity', '#filterCompany'].forEach(sel => { if ($(sel)) $(sel).value = ''; });
    if ($('#filterConf')) $('#filterConf').value = '0';
    ui.filters = { has: '', city: '', company: '', minConf: 0 };
    renderData();
    toast('Filters cleared');
  });
  if ($('#selectAllFiltered')) $('#selectAllFiltered').addEventListener('click', () => {
    filteredRecords().forEach(r => ui.selected.add(r.id));
    renderData();
    toast(ui.selected.size + ' records selected');
  });
  $('#exportFormat').addEventListener('change', async () => {
    S.settings.output = Object.assign({}, S.settings.output, { format: $('#exportFormat').value });
    await persistSettings();
  });

  /* ------------------------------------------------------------- SCHEMA */
  function fieldRow(f) {
    const id = 'f_' + f.key;
    const dis = f.enabled === false ? ' disabled' : '';
    return '<div class="fieldrow' + dis + '" data-key="' + esc(f.key) + '">' +
      '<div class="fhead">' +
        '<label class="row" style="font-weight:700;min-width:26px"><input type="checkbox" data-act="enabled"' + (f.enabled !== false ? ' checked' : '') + '></label>' +
        '<input type="text" data-act="label" value="' + esc(f.label) + '" title="Excel/PDF me dikhne wala naam">' +
        '<span class="chip">' + esc(f.key) + '</span>' +
        '<select data-act="type" style="width:110px" title="Data type">' + SCHEMA.FIELD_TYPES.map(t => '<option value="' + t + '"' + (f.type === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' +
        '<label class="row small muted" title="Zaroori field"><input type="checkbox" data-act="required"' + (f.required ? ' checked' : '') + '> required</label>' +
        '<label class="row small muted" title="Confidence me weight">w <input type="number" data-act="weight" value="' + (f.weight == null ? 1 : f.weight) + '" min="0" max="5" style="width:52px"></label>' +
        '<span class="spacer"></span>' +
        (f.custom ? '<button class="btn btn-sm btn-danger" data-act="remove">remove</button>' : '') +
        '<button class="btn btn-sm" data-act="toggleAdv">advanced</button>' +
      '</div>' +
      '<div class="hint">' + esc(f.description || '') + '</div>' +
      '<div class="adv">' +
        '<div class="grid2">' +
          '<label class="field"><span>CSS selectors (ek per line, priority order)</span><textarea data-act="selectors" rows="3">' + esc((f.hints && f.hints.selectors || []).join('\n')) + '</textarea></label>' +
          '<label class="field"><span>Regex (ek per line, capture group 1 use hota hai)</span><textarea data-act="regex" rows="3">' + esc((f.hints && f.hints.regex || []).join('\n')) + '</textarea></label>' +
        '</div>' +
        '<label class="field"><span>JSON-LD keys (comma separated)</span><input type="text" data-act="jsonld" value="' + esc((f.hints && f.hints.jsonld || []).join(', ')) + '"></label>' +
        '<div class="row"><button class="btn btn-sm" data-act="pick">Pick element from a page</button><span class="small muted">Site khuli rakhein, button dabayein, phir us element par click karein.</span></div>' +
      '</div>' +
    '</div>';
  }

  function renderSchema() {
    const fields = (S.settings.fields || []).filter(f => ui.showDisabled || f.enabled !== false);
LeadDOM.mount($('#fieldList'), fields.map(fieldRow).join('') || '<p class="muted">Koi field nahi.</p>');

    $$('#fieldList .fieldrow').forEach(row => {
      const key = row.dataset.key;
      const getField = () => S.settings.fields.find(f => f.key === key);
      const commit = async () => { await persistSettings(); renderSchema(); };

      row.querySelector('[data-act=enabled]').addEventListener('change', e => {
        getField().enabled = e.target.checked; commit();
      });
      row.querySelector('[data-act=label]').addEventListener('change', e => { getField().label = e.target.value.trim() || key; commit(); });
      row.querySelector('[data-act=type]').addEventListener('change', e => { getField().type = e.target.value; commit(); });
      row.querySelector('[data-act=required]').addEventListener('change', e => { getField().required = e.target.checked; commit(); });
      row.querySelector('[data-act=weight]').addEventListener('change', e => { getField().weight = Number(e.target.value) || 0; commit(); });
      row.querySelector('[data-act=toggleAdv]').addEventListener('click', () => row.classList.toggle('open'));

      const saveHints = () => {
        const f = getField();
        f.hints = f.hints || {};
        f.hints.selectors = row.querySelector('[data-act=selectors]').value.split('\n').map(s => s.trim()).filter(Boolean);
        f.hints.regex = row.querySelector('[data-act=regex]').value.split('\n').map(s => s.trim()).filter(Boolean);
        f.hints.jsonld = row.querySelector('[data-act=jsonld]').value.split(',').map(s => s.trim()).filter(Boolean);
      };
      ['selectors', 'regex', 'jsonld'].forEach(act => {
        row.querySelector('[data-act=' + act + ']').addEventListener('change', async () => { saveHints(); await persistSettings(); toast('Hints saved'); });
      });

      row.querySelector('[data-act=pick]').addEventListener('click', async () => {
        const tab = await chooseTab('Element picker — ' + (getField().label || key));
        if (!tab) return;
        try {
          await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/lib/schema.js', 'src/lib/telemetry.js', 'src/content.js'] });
        } catch (e) { /* already injected */ }
        try {
          await api.tabs.sendMessage(tab.id, { type: 'LH_START_PICK', fieldKey: key });
          toast('Ab us site par element par click karein…');
        } catch (e) { toast('Picker start nahi hua: ' + e.message, 'err'); }
      });

      const rm = row.querySelector('[data-act=remove]');
      if (rm) rm.addEventListener('click', async () => {
        S.settings.fields = S.settings.fields.filter(f => f.key !== key);
        await persistSettings(); renderSchema(); toast('Custom field removed');
      });
    });
  }

  $('#showDisabled').addEventListener('change', e => { ui.showDisabled = e.target.checked; renderSchema(); });
  $('#addField').addEventListener('click', async () => {
    const label = prompt('Naye field ka naam (jaise "GST Number" ya "WhatsApp"):');
    if (!label) return;
    const key = SCHEMA.newFieldKey(label);
    if (S.settings.fields.some(f => f.key === key)) { toast('Yeh field pehle se hai.', 'err'); return; }
    S.settings.fields.push({ key, label: label.trim(), type: 'text', enabled: true, required: false, weight: 1, group: 'Custom', custom: true, description: 'Custom field — selector ya regex advanced me dein.', hints: { selectors: [], regex: [], jsonld: [] } });
    await persistSettings(); renderSchema(); toast('Field add ho gaya — advanced me selector/regex dein');
  });
  $('#resetSchema').addEventListener('click', async () => {
    if (!confirm('Data structure default par reset karein? Custom fields hat jayenge.')) return;
    S.settings = SCHEMA.normalizeSettings(Object.assign({}, S.settings, { fields: JSON.parse(JSON.stringify(SCHEMA.DEFAULT_FIELDS)) }));
    await persistSettings(); renderSchema(); toast('Reset done');
  });
  $('#exportSchema').addEventListener('click', async () => {
    const blob = { generator: 'LeadHarvest', kind: 'schema', version: 1, exportedAt: new Date().toISOString(), fields: S.settings.fields };
    await LeadSave.save('leadharvest-schema.json', 'application/json', JSON.stringify(blob, null, 2));
    toast('Schema exported');
  });
  $('#importSchema').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const fields = Array.isArray(data) ? data : data.fields;
        if (!Array.isArray(fields) || !fields.length) throw new Error('fields array nahi mila');
        S.settings = SCHEMA.normalizeSettings(Object.assign({}, S.settings, { fields }));
        await persistSettings(); renderSchema(); toast('Schema import ho gaya');
      } catch (e) { toast('Import failed: ' + e.message, 'err'); }
    });
    inp.click();
  });
  $$('[data-preset]').forEach(b => b.addEventListener('click', async () => {
    const map = {
      phonebook: ['name', 'phone', 'address', 'city', 'state', 'pincode'],
      b2b: ['name', 'designation', 'company', 'email', 'phone', 'website', 'city'],
      full: SCHEMA.DEFAULT_FIELDS.map(f => f.key),
      directory: ['company', 'phone', 'email', 'address', 'city', 'state', 'category', 'rating', 'website']
    };
    const on = new Set(map[b.dataset.preset] || []);
    S.settings.fields.forEach(f => { f.enabled = on.has(f.key); });
    await persistSettings(); renderSchema(); toast('Preset applied: ' + b.dataset.preset);
  }));

  /* ------------------------------------------------------------ SETTINGS */
  function renderSettings() {
    const s = S.settings;
    $('#maxRecords').value = s.scrape.maxRecords;
    $('#dedupe').checked = !!s.scrape.dedupe;
    $('#autoScroll').checked = !!s.scrape.autoScroll;
    $('#deepScan').checked = s.scrape.deepScan !== false;
    if ($('#minConfidence')) $('#minConfidence').value = String(s.scrape.minConfidence || 0);
    $('#blockLocalhost').checked = !!(s.privacy && s.privacy.blockLocalhost);
    $('#outFormat').value = s.output.format || 'xlsx';
    $('#delimiter').value = s.output.delimiter === '\t' ? '\\t' : (s.output.delimiter || ',');
    $('#fileNameTemplate').value = s.output.fileNameTemplate || 'leadharvest-{domain}-{date}';
    $('#pdfPaper').value = s.output.pdfPaper || 'a4';
    $('#includeHeader').checked = s.output.includeHeader !== false;
    $('#logEnabled').checked = s.logging.enabled !== false;
    $('#logVerbose').checked = !!s.logging.verbose;
    $('#logRedact').checked = s.logging.redactPII !== false;
    $('#logMax').value = s.logging.maxEntries || 800;
    $('#storageLine').textContent = S.records.length + ' records · ' + S.history.length + ' history entries · ' + S.logs.length + ' log entries';
    renderDiag();
  }

  $('#saveSettings').addEventListener('click', async () => {
    S.settings.scrape.maxRecords = Number($('#maxRecords').value) || 200;
    S.settings.scrape.dedupe = $('#dedupe').checked;
    S.settings.scrape.autoScroll = $('#autoScroll').checked;
    S.settings.scrape.deepScan = $('#deepScan').checked;
    S.settings.scrape.minConfidence = Number($('#minConfidence').value) || 0;
    S.settings.privacy.blockLocalhost = $('#blockLocalhost').checked;
    S.settings.output.format = $('#outFormat').value;
    S.settings.output.delimiter = $('#delimiter').value === '\\t' ? '\t' : $('#delimiter').value;
    S.settings.output.fileNameTemplate = $('#fileNameTemplate').value.trim() || 'leadharvest-{domain}-{date}';
    S.settings.output.pdfPaper = $('#pdfPaper').value;
    S.settings.output.includeHeader = $('#includeHeader').checked;
    S.settings.logging.enabled = $('#logEnabled').checked;
    S.settings.logging.verbose = $('#logVerbose').checked;
    S.settings.logging.redactPII = $('#logRedact').checked;
    S.settings.logging.maxEntries = Number($('#logMax').value) || 800;
    await persistSettings();
    await loadState();
    renderSettings(); renderData();
    toast('Settings saved', 'ok');
  });

  ['clearRecords', 'clearHistory', 'clearLogs'].forEach(id => {
    $('#' + id).addEventListener('click', async () => {
      const what = id === 'clearRecords' ? 'records' : id === 'clearHistory' ? 'history' : 'logs';
      if (!confirm('Pakka ' + what + ' clear karein? Yeh undo nahi hoga.')) return;
      await send({ type: 'LH_CLEAR', what });
      await loadState(); renderSettings(); renderData(); renderHistory(); renderLogs();
      toast(what + ' cleared');
    });
  });

  /* ------------------------------------------------------- DIAGNOSTICS */
  function diagStat(label, value, hint) {
    return '<div class="stat"><b>' + esc(value) + '</b><span class="small muted">' + esc(label) + (hint ? ' · ' + esc(hint) : '') + '</span></div>';
  }

  function renderDiag() {
    const box = $('#diagStats');
    if (!box) return;
    const TL = globalThis.LeadTelemetry;
    const m = S.metrics || {};
    const r = TL && TL.rates ? TL.rates(m) : {};
    const env = S.env || {};
    const sessions = m.sessions || {};
    const dup = m.duplicates || {};
LeadDOM.mount(box, diagStat('Events collected', S.logs.length) +
      diagStat('Scrape sessions', sessions.started || 0, (sessions.failed || 0) + ' failed') +
      diagStat('Records extracted', (m.records && m.records.extracted) || 0) +
      diagStat('Extraction success', r.extraction_success_rate == null ? '—' : r.extraction_success_rate + '%') +
      diagStat('Field completeness', r.field_completeness == null ? '—' : r.field_completeness + '%') +
      diagStat('Duplicates caught', (dup.exact || 0) + (dup.potential || 0)) +
      diagStat('Exports', (m.exports && m.exports.ok) || 0, ((m.exports && m.exports.failed) || 0) + ' failed') +
      diagStat('Errors', (m.errors && m.errors.total) || 0) +
      diagStat('Avg extraction', (r.avg_processing_ms || 0) + ' ms'));
    const meta = $('#diagMeta');
    if (meta) {
      meta.textContent = [env.browser, env.browser_version, env.platform].filter(Boolean).join(' ') +
        ' · v' + S.version + ' · log retention: ' + ((S.settings.logging && S.settings.logging.maxEntries) || 1200) + ' events';
    }
  }

  async function diagBundle(trigger) {
    const note = ($('#diagNote') && $('#diagNote').value || '').trim();
    const r = await send({ type: 'LH_GET_DIAGNOSTICS', note, trigger: trigger || 'manual' });
    if (!r || !r.ok) throw new Error((r && r.error) || 'diagnostics build failed');
    return r.bundle;
  }

  function setShareStatus(text) {
    const el = $('#shareStatus');
    if (el) el.textContent = text || '';
  }

  async function shareLogs(channel) {
    const btn = $('#shareLogs');
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Bundle ban raha hai…'; }
    try {
      const note = ($('#diagNote') && $('#diagNote').value || '').trim();
      const r = await send({ type: 'LH_SHARE_LOGS', note, channel: channel || 'share' });
      if (!r || !r.ok) throw new Error((r && r.error) || 'share failed');
      const files = LeadDiagnostics.build(r.bundle);
      const subject = LeadDiagnostics.mailSubject(r.bundle);
      const body = LeadDiagnostics.mailBody(r.bundle, [files.filenameJson]);

      /* 1. Preferred: the system share sheet takes the file, so it really is attached. */
      const file = new File([files.json], files.filenameJson, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'LeadHarvest diagnostics', text: files.summary });
          setShareStatus('System share sheet se bhej diya · ' + files.filenameJson);
          toast('Logs share ho gaye', 'ok');
          await loadState(); renderLogs(); renderDiag();
          return;
        } catch (e) { /* cancelled — fall back to compose */ }
      }

      /* 2. Otherwise: save the bundle, then open a pre-filled compose window. */
      await LeadSave.save(files.filenameJson, 'application/json', files.json);
      try { await LeadSave.save(files.filenameText, 'text/plain', files.text); } catch (e) { /* optional */ }
      if (channel === 'gmail') window.open(LeadDiagnostics.gmailUrl(subject, body), '_blank');
      else window.location.href = LeadDiagnostics.mailtoUrl(subject, body);
      setShareStatus('Bundle saved: ' + files.filenameJson + ' (' + files.sizeKb + ' KB). Compose window me attach kar dein.');
      toast('Bundle ' + files.filenameJson + ' Downloads me save ho gaya; mail compose khul raha hai', 'ok');
      await loadState(); renderLogs(); renderDiag();
    } catch (e) {
      toast('Share failed: ' + e.message, 'err');
      setShareStatus('Failed: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label || 'Share logs with developer'; }
    }
  }

  async function downloadDiag(kind) {
    try {
      const bundle = await diagBundle('download');
      const files = LeadDiagnostics.build(bundle);
      if (kind === 'txt') await LeadSave.save(files.filenameText, 'text/plain', files.text);
      else await LeadSave.save(files.filenameJson, 'application/json', files.json);
      await send({
        type: 'LH_LOG_EVENT', event: 'diagnostics_downloaded', level: 'info', scope: 'ui',
        message: 'Diagnostics downloaded (' + kind + ')', data: { kind, kb: files.sizeKb }
      });
      toast(kind === 'txt' ? 'Report download ho gayi' : 'Diagnostics download ho gaye', 'ok');
      await loadState(); renderLogs(); renderDiag();
    } catch (e) { toast('Download failed: ' + e.message, 'err'); }
  }

  if ($('#shareLogs')) $('#shareLogs').addEventListener('click', () => shareLogs('share'));
  if ($('#mailAppBtn')) $('#mailAppBtn').addEventListener('click', () => shareLogs('mailto'));
  if ($('#gmailBtn')) $('#gmailBtn').addEventListener('click', () => shareLogs('gmail'));
  if ($('#downloadDiag')) $('#downloadDiag').addEventListener('click', () => downloadDiag('json'));
  if ($('#downloadReport')) $('#downloadReport').addEventListener('click', () => downloadDiag('txt'));
  if ($('#copyDiag')) $('#copyDiag').addEventListener('click', async () => {
    try {
      const bundle = await diagBundle('copy');
      const files = LeadDiagnostics.build(bundle);
      const ok = await LeadSave.copy(files.summary);
      toast(ok ? 'Summary clipboard par copy ho gaya' : 'Copy fail hua', ok ? 'ok' : 'err');
    } catch (e) { toast('Copy failed: ' + e.message, 'err'); }
  });

  /* ------------------------------------------------------------- HISTORY */
  function renderHistory() {
    const h = S.history;
    $('#histCount').textContent = h.length + ' entries';
LeadDOM.mount($('#histTable thead'), '<tr><th>Kab</th><th>Page</th><th>Type</th><th>Method</th><th>Records</th><th>Format</th><th></th></tr>');
    if (!h.length) {
LeadDOM.mount($('#histTable tbody'), '<tr><td colspan="7" class="muted" style="padding:24px;text-align:center">Koi scrape history nahi. Pehla scrape karein.</td></tr>');
      return;
    }
LeadDOM.mount($('#histTable tbody'), h.map(e =>
      '<tr><td style="white-space:nowrap">' + esc(fmtTime(e.at)) + '</td>' +
      '<td><b>' + esc(e.domain || hostOf(e.url)) + '</b><br><span class="small muted">' + esc((e.title || '').slice(0, 70)) + '</span></td>' +
      '<td><span class="chip">' + esc(e.pageType || '—') + '</span></td>' +
      '<td class="small">' + esc(e.method || '—') + '<br><span class="muted">' + (e.durationMs || 0) + 'ms</span></td>' +
      '<td><b>' + (e.count || 0) + '</b></td>' +
      '<td class="small">' + esc(e.format || '—') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-sm" data-export="' + esc(e.id) + '">Export</button> ' +
        '<button class="btn btn-sm" data-open="' + esc(e.url) + '">Open</button> ' +
        '<button class="btn btn-sm btn-danger" data-del="' + esc(e.id) + '">✕</button>' +
      '</td></tr>'
    ).join(''));

    $$('#histTable [data-export]').forEach(b => b.addEventListener('click', async () => {
      const entry = S.history.find(x => x.id === b.dataset.export);
      const ids = new Set(entry.recordIds || []);
      let recs = S.records.filter(r => ids.has(r.id));
      if (!recs.length) { toast('Is scrape ke records delete ho chuke hain.', 'err'); return; }
      await doExport($('#exportFormat').value || S.settings.output.format, recs);
    }));
    $$('#histTable [data-open]').forEach(b => b.addEventListener('click', () => api.tabs.create({ url: b.dataset.open })));
    $$('#histTable [data-del]').forEach(b => b.addEventListener('click', async () => {
      await send({ type: 'LH_DELETE_HISTORY', id: b.dataset.del });
      await loadState(); renderHistory();
    }));
  }
  $('#clearHistBtn').addEventListener('click', async () => {
    if (!confirm('Purani history clear karein? (records safe rahenge)')) return;
    await send({ type: 'LH_CLEAR', what: 'history' });
    await loadState(); renderHistory(); toast('History cleared');
  });

  /* ---------------------------------------------------------------- LOGS */
  function renderLogs() {
    const lvl = $('#logLevel') ? $('#logLevel').value : '';
    const q = $('#logSearch') ? $('#logSearch').value.toLowerCase() : '';
    let logs = S.logs.slice();
    if (lvl) logs = logs.filter(l => l.level === lvl);
    if (q) logs = logs.filter(l => (l.message + ' ' + l.scope + ' ' + JSON.stringify(l.data || {})).toLowerCase().includes(q));
LeadDOM.mount($('#logTable thead'), '<tr><th style="width:150px">Time</th><th style="width:70px">Level</th><th style="width:110px">Scope</th><th>Message</th><th>Data</th></tr>');
    if (!logs.length) {
LeadDOM.mount($('#logTable tbody'), '<tr><td colspan="5" class="muted" style="padding:24px;text-align:center">Koi log nahi.</td></tr>');
      return;
    }
LeadDOM.mount($('#logTable tbody'), logs.slice(0, 500).map(l => {
      const chip = l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : l.level === 'debug' ? '' : 'ok';
      return '<tr><td class="small" style="white-space:nowrap">' + esc(fmtTime(l.ts)) + '</td>' +
        '<td><span class="chip ' + chip + '">' + esc(l.level) + '</span></td>' +
        '<td class="small">' + esc(l.scope) + '</td>' +
        '<td>' + esc(l.message) + '</td>' +
        '<td class="small muted" style="max-width:320px;word-break:break-word">' + esc(Object.keys(l.data || {}).length ? JSON.stringify(l.data) : '') + '</td></tr>';
    }).join(''));
  }
  $('#logLevel').addEventListener('change', renderLogs);
  $('#logSearch').addEventListener('input', renderLogs);
  $('#exportLogs').addEventListener('click', () => LeadSave.save('leadharvest-logs-' + Date.now() + '.json', 'application/json', JSON.stringify(S.logs, null, 2)).then(() => toast('Logs exported', 'ok')));
  $('#exportLogsTxt').addEventListener('click', () => {
    const txt = S.logs.map(l => '[' + l.ts + '] ' + l.level.toUpperCase() + ' (' + l.scope + ') ' + l.message + (Object.keys(l.data || {}).length ? ' | ' + JSON.stringify(l.data) : '')).join('\n');
    LeadSave.save('leadharvest-logs-' + Date.now() + '.txt', 'text/plain', txt).then(() => toast('Logs exported', 'ok'));
  });
  $('#clearLogsBtn').addEventListener('click', async () => {
    if (!confirm('Logs clear karein?')) return;
    await send({ type: 'LH_CLEAR', what: 'logs' });
    await loadState(); renderLogs(); toast('Logs cleared');
  });

  /* ------------------------------------------------------------------ AI */
  function renderAiForm() {
    const ai = S.settings.ai || {};
    $('#aiMode').value = ai.mode || 'local';
    $('#aiProvider').value = ai.provider || 'sarvam';
    $('#aiBaseUrl').value = ai.baseUrl || '';
    $('#aiModel').value = ai.model || '';
    $('#aiKey').value = ai.apiKey || '';
    $('#aiAuto').checked = ai.autoSuggest !== false;
    $('#cloudBox').style.display = (ai.mode === 'cloud') ? 'block' : 'none';
  }

  $('#aiMode').addEventListener('change', async e => {
    S.settings.ai.mode = e.target.value;
    $('#cloudBox').style.display = e.target.value === 'cloud' ? 'block' : 'none';
    await persistSettings();
  });
  $('#aiProvider').addEventListener('change', async e => {
    const p = SCHEMA.PROVIDER_PRESETS[e.target.value];
    if (p) {
      if (p.baseUrl) $('#aiBaseUrl').value = p.baseUrl;
      if (p.model) $('#aiModel').value = p.model;
    }
    S.settings.ai.provider = e.target.value;
    S.settings.ai.baseUrl = $('#aiBaseUrl').value;
    S.settings.ai.model = $('#aiModel').value;
    await persistSettings();
  });
  ['aiBaseUrl', 'aiModel', 'aiKey'].forEach(id => $('#' + id).addEventListener('change', async () => {
    S.settings.ai.baseUrl = $('#aiBaseUrl').value.trim();
    S.settings.ai.model = $('#aiModel').value.trim();
    S.settings.ai.apiKey = $('#aiKey').value.trim();
    await persistSettings();
    toast('AI settings saved');
  }));
  $('#aiAuto').addEventListener('change', async e => { S.settings.ai.autoSuggest = e.target.checked; await persistSettings(); });

  $('#testAi').addEventListener('click', async () => {
    const out = $('#aiTestOut');
    out.textContent = 'Testing…';
    try {
      const res = await LeadAdvisor.cloudSuggest({ pageType: 'contact', signals: { jsonLd: 1, telLinks: 2, mailLinks: 1, tables: 0, hasAddressText: true, textLength: 2000, forms: 1 }, url: 'https://example.com', sample: 'Contact us: phone, email, address' }, S.settings);
LeadDOM.mount(out, '<span class="chip ok">Connected</span> ' + (res.recommended || []).length + ' suggestions mile');
    } catch (e) {
LeadDOM.mount(out, '<span class="chip err">Failed</span> ' + esc(e.message));
    }
  });

  function advisorHtml(res) {
    const cur = new Set((S.settings.fields || []).filter(f => f.enabled !== false).map(f => f.key));
    const rows = (res.recommended || []).map(r => {
      const on = cur.has(r.key);
      return '<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:7px 0">' +
        '<div><b>' + esc(r.label || r.key) + '</b> <span class="chip">P' + (r.priority || 3) + '</span>' + (on ? ' <span class="chip ok">ON</span>' : '') +
        '<div class="small muted">' + esc(r.reason || '') + '</div></div>' +
        (on ? '' : '<button class="btn btn-sm" data-enable="' + esc(r.key) + '">Enable</button>') +
        '</div>';
    }).join('');
    const notes = (res.notes || []).map(n => '<li>' + esc(n) + '</li>').join('');
    const warns = (res.warnings || []).map(n => '<li>' + esc(n) + '</li>').join('');
    return '<h3>AI suggestion <span class="chip">' + esc(res.mode) + '</span> <span class="chip">' + esc(res.pageType || '') + '</span></h3>' +
      '<p class="small muted">Confidence ' + Math.round((res.confidence || 0) * 100) + '%</p>' +
      (rows || '<p class="muted">Koi suggestion nahi.</p>') +
      (notes ? '<h4 style="margin-top:14px">Page notes</h4><ul class="list small">' + notes + '</ul>' : '') +
      (warns ? '<h4 style="margin-top:14px">Warnings</h4><ul class="list small">' + warns + '</ul>' : '') +
      '<div class="row" style="margin-top:14px"><button class="btn btn-primary btn-sm" id="applyAll">Apply all suggestions</button></div>';
  }

  function showAdvisor(res) {
LeadDOM.mount($('#advisorOut'), advisorHtml(res));
    $$('#advisorOut [data-enable]').forEach(b => b.addEventListener('click', async () => {
      const f = S.settings.fields.find(x => x.key === b.dataset.enable);
      if (f) { f.enabled = true; await persistSettings(); toast(f.label + ' enabled'); }
      b.outerHTML = '<span class="chip ok">ON</span>';
    }));
    const apply = $('#applyAll');
    if (apply) apply.addEventListener('click', async () => {
      (res.recommended || []).forEach(r => { const f = S.settings.fields.find(x => x.key === r.key); if (f) f.enabled = true; });
      await persistSettings(); renderSchema(); showAdvisor(res); toast('Saare suggested fields enable ho gaye');
    });
  }

  async function runAdvisor() {
    const ai = S.settings.ai || {};
    if (ai.mode === 'off') {LeadDOM.mount($('#advisorOut'), '<h3>AI advisor off hai</h3><p class="muted small">Upar mode "Local rules" chunein — bilkul offline chalta hai.</p>'); return; }
    const last = S.history[0];
    const ctx = {
      pageType: (last && last.pageType) || 'general',
      signals: (last && last.signals) || {},
      url: (last && last.url) || '',
      sample: (last && last.title) || ''
    };
LeadDOM.mount($('#advisorOut'), '<h3>Analyzing…</h3>');
    try {
      const res = ai.mode === 'cloud'
        ? await LeadAdvisor.cloudSuggest(ctx, S.settings)
        : LeadAdvisor.localSuggest(ctx);
      showAdvisor(res);
    } catch (e) {
LeadDOM.mount($('#advisorOut'), '<h3>AI error</h3><p class="small" style="color:#b91c1c">' + esc(e.message) + '</p><p class="small muted">Local mode try karein — key ki zaroorat nahi.</p>');
    }
  }

  $('#runAdvisor').addEventListener('click', runAdvisor);
  $('#scrapeAndAnalyze').addEventListener('click', async () => {
    const tab = await chooseTab('Scrape + analyze');
    if (!tab) return;
    toast('Scraping…');
    const res = await send({ type: 'LH_SCRAPE', tabId: tab.id });
    if (!res || !res.ok) { toast('Scrape failed: ' + ((res && res.error) || ''), 'err'); return; }
    await loadState();
    renderData(); renderHistory();
    await runAdvisor();
    toast(res.stored + ' records saved', 'ok');
  });

  /* ---------------------------------------------------------------- HELP */
  function renderHelp() {
    const rows = SCHEMA.DEFAULT_FIELDS.map(f =>
      '<div><b>' + esc(f.label) + '</b></div><div>' + esc(f.description || '') +
      '<br><span class="small muted">Sources: ' + esc((f.hints.selectors || []).slice(0, 3).join(' · ') || 'heuristics') + (f.hints.jsonld && f.hints.jsonld.length ? ' · JSON-LD: ' + esc(f.hints.jsonld.join(', ')) : '') + '</span></div>'
    ).join('');
LeadDOM.mount($('#whatTable'), rows);
  }

  /* ------------------------------------------------------- global actions */
  $('#scrapeHere').addEventListener('click', async () => {
    const tab = await chooseTab('Scrape current tab');
    if (!tab) return;
    toast('Scraping ' + hostOf(tab.url) + '…');
    const res = await send({ type: 'LH_SCRAPE', tabId: tab.id });
    if (!res || !res.ok) { toast('Scrape failed: ' + ((res && res.error) || 'unknown'), 'err'); return; }
    await loadState();
    switchTab('data');
    toast(res.stored + ' records save ho gaye', 'ok');
    if (S.settings.ai && S.settings.ai.autoSuggest !== false && S.settings.ai.mode !== 'off') runAdvisor();
  });

  api.runtime.onMessage.addListener(msg => {
    if (msg && msg.type === 'LH_PICK_RESULT') {
      const f = S.settings.fields.find(x => x.key === msg.fieldKey);
      if (f) {
        f.hints = f.hints || {};
        const sel = (msg.selector || '').trim();
        if (sel && !(f.hints.selectors || []).includes(sel)) f.hints.selectors = [sel].concat(f.hints.selectors || []);
        f.enabled = true;
        persistSettings().then(() => { renderSchema(); toast('Selector add ho gaya: ' + sel.slice(0, 50)); });
      }
    }
    return false;
  });

  /* ------------------------------------------------- UI events & errors */
  function track(event, data) {
    send({ type: 'LH_LOG_EVENT', event, level: 'info', scope: 'ui', message: event, data: data || {} });
  }
  $('#searchBox').addEventListener('change', () => {
    if (ui.search.trim()) track('filter_used', { type: 'search', query_length: ui.search.trim().length, matched: filteredRecords().length, rejected: S.records.length - filteredRecords().length });
  });
  $('#exportFormat').addEventListener('change', () => track('export_format_selected', { format: $('#exportFormat').value }));

  window.addEventListener('error', (e) => {
    send({
      type: 'LH_LOG_EVENT', event: 'runtime_error', level: 'error', scope: 'dashboard',
      message: 'Dashboard error: ' + ((e && e.message) || 'unknown'),
      data: {
        error_code: 'dashboard_error',
        error_message: String((e && e.message) || '').slice(0, 200),
        stack: (globalThis.LeadTelemetry && LeadTelemetry.sanitizeStack) ? LeadTelemetry.sanitizeStack(e && e.error && e.error.stack) : ''
      }
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e && e.reason;
    send({
      type: 'LH_LOG_EVENT', event: 'unhandled_rejection', level: 'error', scope: 'dashboard',
      message: 'Unhandled rejection in dashboard',
      data: {
        error_code: 'dashboard_rejection',
        error_message: String((reason && reason.message) || reason || '').slice(0, 200),
        stack: (globalThis.LeadTelemetry && LeadTelemetry.sanitizeStack) ? LeadTelemetry.sanitizeStack(reason && reason.stack) : ''
      }
    });
  });

  /* ----------------------------------------------------------------- boot */
  (async () => {
    await loadState();
    if (!S.settings) S.settings = SCHEMA.normalizeSettings({});
    renderData(); renderSchema(); renderSettings(); renderHistory(); renderLogs(); renderAiForm(); renderHelp();
    const start = (location.hash || '').replace('#', '') || 'data';
    switchTab(['data', 'schema', 'ai', 'settings', 'history', 'logs', 'help'].includes(start) ? start : 'data');

    /* Refresh when the background actually writes something, instead of polling.
       Polling every few seconds re-read every record and re-render the table, which
       could wipe a cell the user was in the middle of editing. */
    if (api.storage && api.storage.onChanged) {
      let refreshTimer = null;
      api.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!changes.lh_records && !changes.lh_history && !changes.lh_logs && !changes.lh_settings) return;
        const el = document.activeElement;
        if (el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
          await loadState();
          if (ui.tab === 'logs') renderLogs();
          if (ui.tab === 'settings') renderSettings();
          if (ui.tab === 'history') renderHistory();
        }, 350);
      });
    }
  })();
})();
