/* LeadHarvest — popup controller */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
/* Cross-browser namespace: Firefox exposes promise-based `browser`, Chrome exposes `chrome`. */
const api = (typeof globalThis.browser !== 'undefined' && globalThis.browser && globalThis.browser.runtime) ? globalThis.browser : globalThis.chrome;
  let state = { settings: null, records: [], history: [], logs: [] };
  let activeTab = null;

  const fmtCount = n => n + ' record' + (n === 1 ? '' : 's');
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function toast(msg, kind) {
    const box = $('result');
    box.className = 'result ' + (kind || '');
    box.classList.remove('hidden');
    box.innerHTML = msg;
  }

  async function loadState() {
    const res = await api.runtime.sendMessage({ type: 'LH_GET_STATE' });
    if (res && res.ok) {
      state = res;
      $('ver').textContent = 'v' + (res.version || '1.0.0');
      $('storedCount').textContent = res.records.length;
      $('storedCount').title = res.records.length + ' records aapke device par saved';
      if (state.settings && state.settings.output && state.settings.output.format) {
        $('format').value = state.settings.output.format;
      }
    }
  }

  async function loadTab() {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
    const url = (tab && tab.url) || '';
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
    $('pageDomain').textContent = host || 'Is page par scrape available nahi';
    $('pageTitle').textContent = (tab && tab.title) || '';
    if (!host) {
      $('scrapeBtn').disabled = true;
      $('aiHint').textContent = 'Browser ke internal page par extension kaam nahi karta. Koi website kholein.';
    }
  }

  function describe(records) {
    const keys = new Set();
    records.forEach(r => Object.keys(r.values || {}).forEach(k => { if (r.values[k]) keys.add(k); }));
    const labels = new Map(LeadHarvestSchema.DEFAULT_FIELDS.map(f => [f.key, f.label]));
    const shown = [...keys].slice(0, 6).map(k => labels.get(k) || k);
    return shown.join(', ') + (keys.size > 6 ? ' +' + (keys.size - 6) + ' more' : '');
  }

  async function scrape() {
    if (!activeTab) return;
    $('scrapeBtn').disabled = true;
    $('scrapeBtn').textContent = 'Scraping…';
    try {
      const res = await api.runtime.sendMessage({ type: 'LH_SCRAPE', tabId: activeTab.id });
      if (!res || !res.ok) {
        toast('Scrape nahi hua: ' + esc((res && res.error) || 'unknown error') + '<br><span class="small muted">Page reload karke dobara try karein.</span>', 'err');
      } else {
        const n = res.stored;
        const recs = (res.result && res.result.records) || [];
        toast(
          '<b>' + fmtCount(n) + ' mile</b> — device par save ho gaye.<br>' +
          '<span class="small muted">Page type: ' + esc(res.result.pageType || '—') +
          ' · method: ' + esc(res.result.method || '—') + ' · ' + (res.result.durationMs || 0) + 'ms</span>' +
          (n ? '<br><span class="small">Fields: ' + esc(describe(recs)) + '</span>' : '<br><span class="small">Koi contact detail nahi mili. Page scroll karke ya detail page khol kar try karein.</span>'),
          n ? 'ok' : ''
        );
        await loadState();
      }
    } catch (e) {
      toast('Error: ' + esc(e.message), 'err');
    } finally {
      $('scrapeBtn').disabled = false;
      $('scrapeBtn').textContent = 'Is page se contact data scrape karein';
    }
  }

  async function exportAll() {
    if (!state.records.length) { toast('Abhi koi record saved nahi hai. Pehle scrape karein.', 'err'); return; }
    const format = $('format').value;
    try {
      const first = state.records[0];
      const out = LeadExport.build(format, state.records, state.settings, {
        title: 'LeadHarvest export',
        subtitle: state.records.length + ' record(s) · ' + (first.domain || '')
      });
      const name = LeadExport.fileName(state.settings, out.ext, state.records);
      await LeadSave.save(name, out.mime, out.bytes || out.text);
      await api.runtime.sendMessage({ type: 'LH_EXPORT_LOG', format, count: state.records.length });
      const latinWarn = format === 'pdf' && LeadPDF.hasNonLatin(out.table.rows);
      toast('Saved: <b>' + esc(name) + '</b><br><span class="small muted">' +
        (latinWarn ? 'Hindi/Devanagari PDF me ? ban sakta hai — HTML format → Print se perfect PDF milega.' : 'Downloads folder me milega.') + '</span>', 'ok');
    } catch (e) {
      toast('Export failed: ' + esc(e.message), 'err');
    }
  }

  function openDash(tab) {
    api.runtime.sendMessage({ type: 'LH_OPEN_DASHBOARD', tab: tab || '' });
    window.close();
  }

  $('scrapeBtn').addEventListener('click', scrape);
  $('exportBtn').addEventListener('click', exportAll);
  $('dashLink').addEventListener('click', e => { e.preventDefault(); openDash('data'); });
  $('histLink').addEventListener('click', e => { e.preventDefault(); openDash('history'); });
  $('logLink').addEventListener('click', e => { e.preventDefault(); openDash('logs'); });
  $('helpLink').addEventListener('click', e => { e.preventDefault(); openDash('help'); });
  $('format').addEventListener('change', () => {
    const s = JSON.parse(JSON.stringify(state.settings || {}));
    s.output = Object.assign({}, s.output, { format: $('format').value });
    state.settings = s;
    api.runtime.sendMessage({ type: 'LH_SET_SETTINGS', settings: s });
  });

  (async () => { await loadTab(); await loadState(); })();
})();
