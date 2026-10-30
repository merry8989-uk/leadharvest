/* LeadHarvest — dependency-free PDF report writer (Helvetica, A4/Letter, paginated). */
(function (root) {
  'use strict';

  const PAPER = { a4: [595.28, 841.89], letter: [612, 792] };
  const FONTS = { F1: 'Helvetica', F2: 'Helvetica-Bold', F3: 'Helvetica-Oblique' };

  function winAnsi(s) {
    const map = { '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"', '\u2013': '-', '\u2014': '-', '\u20B9': 'Rs.', '\u2022': '*', '\u00A0': ' ', '\u2026': '...' };
    let out = '';
    for (const ch of String(s == null ? '' : s)) {
      const c = ch.codePointAt(0);
      if (c < 128) out += ch;
      else if (map[ch]) out += map[ch];
      else if (c >= 160 && c < 256) out += ch;
      else out += '?';
    }
    return out;
  }

  const esc = s => winAnsi(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n\t]/g, ' ');

  function charW(ch) {
    if (/[iljtfI.,;:'!|\[\]()]/.test(ch)) return 0.29;
    if (/[MW@%&]/.test(ch)) return 0.86;
    if (/[A-Z0-9]/.test(ch)) return 0.63;
    return 0.52;
  }
  function textWidth(s, size) {
    let w = 0;
    for (const ch of s) w += charW(ch) * size;
    return w;
  }

  function wrap(text, size, maxWidth) {
    const words = winAnsi(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (textWidth(next, size) > maxWidth && cur) { lines.push(cur); cur = w; }
      else cur = next;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function buildReport(opts) {
    const paper = PAPER[opts.paper] || PAPER.a4;
    const PW = paper[0], PH = paper[1];
    const M = 42, RIGHT = PW - M;
    const TOP = PH - 64, BOTTOM = 56;
    const columns = opts.columns || [];
    const rows = opts.rows || [];
    const title = opts.title || 'LeadHarvest Export';
    const subtitle = opts.subtitle || '';
    const stamp = opts.stamp || new Date().toLocaleString('en-IN');

    const pages = [];
    let cur = [];
    let y = TOP;
    const newPage = () => { pages.push(cur); cur = []; y = TOP; };
    const emit = (cmd) => cur.push(cmd);
    const line = (text, o) => {
      o = o || {};
      const size = o.size || 9.5, indent = o.indent || 0, gap = o.gap || 13;
      const color = o.color || '0 0 0';
      if (y - gap < BOTTOM) newPage();
      emit(color + ' rg BT /' + (o.font || 'F1') + ' ' + size + ' Tf 1 0 0 1 ' + (M + indent).toFixed(2) + ' ' + (y - size).toFixed(2) + ' Tm (' + esc(text) + ') Tj ET 0 0 0 rg');
      y -= gap;
    };
    const rule = (gap) => {
      if (y - 6 < BOTTOM) newPage();
      emit('0.85 0.85 0.85 RG 0.7 w ' + M + ' ' + (y - 4).toFixed(2) + ' m ' + RIGHT + ' ' + (y - 4).toFixed(2) + ' l S');
      y -= (gap || 12);
    };

    /* first page header block */
    line(title, { font: 'F2', size: 17, gap: 22 });
    if (subtitle) line(subtitle, { size: 10, color: '0.35 0.35 0.35', gap: 14 });
    line(rows.length + ' record' + (rows.length === 1 ? '' : 's') + '  ·  exported ' + stamp + '  ·  LeadHarvest', { size: 8.5, color: '0.45 0.45 0.45', gap: 10 });
    rule(16);

    rows.forEach((row, idx) => {
      const primary = String(row[0] || row[1] || row[2] || 'Record ' + (idx + 1));
      const secondary = [row[1], row[2]].filter(v => v && v !== primary).slice(0, 2).join('  ·  ');
      const blockStart = y;
      line((idx + 1) + '.  ' + primary, { font: 'F2', size: 10.5, gap: 14 });
      if (secondary) line(secondary, { size: 9, color: '0.3 0.3 0.3', gap: 13 });
      for (let c = 0; c < columns.length; c++) {
        const value = row[c];
        if (!value || c < 3) continue;      /* 0..2 already shown as the heading */
        const label = columns[c].label || columns[c];
        const prefix = label + ': ';
        const wrapped = wrap(String(value), 9, RIGHT - M - 24 - textWidth(prefix, 9));
        line(prefix + wrapped[0], { size: 9, indent: 14, gap: 12 });
        for (let i = 1; i < wrapped.length; i++) line(' '.repeat(0) + wrapped[i], { size: 9, indent: 14 + textWidth(prefix, 9), gap: 12 });
      }
      if (y < blockStart - 4) { y -= 4; }
      rule(10);
    });

    if (!rows.length) line('No records to export.', { size: 10, color: '0.4 0.4 0.4' });
    pages.push(cur);

    /* ---- assemble the file ---- */
    const total = pages.length;
    const objects = [];
    const pageObjIds = [];
    const contentIds = [];
    /* 1 catalog, 2 pages, 3-5 fonts */
    const firstPageObj = 6;
    pages.forEach((_, i) => { pageObjIds.push(firstPageObj + i * 2); contentIds.push(firstPageObj + i * 2 + 1); });

    const headerFooter = (pageIdx) => {
      const cmds = [];
      if (pageIdx > 0) {
        cmds.push('0 0 0 rg BT /F2 11 Tf 1 0 0 1 ' + M + ' ' + (PH - 46) + ' Tm (' + esc(title) + ') Tj ET');
        cmds.push('0.85 0.85 0.85 RG 0.7 w ' + M + ' ' + (PH - 54) + ' m ' + RIGHT + ' ' + (PH - 54) + ' l S');
      }
      cmds.push('0.45 0.45 0.45 rg BT /F1 8 Tf 1 0 0 1 ' + M + ' 32 Tm (LeadHarvest - local export - page ' + (pageIdx + 1) + ' of ' + total + ') Tj ET 0 0 0 rg');
      cmds.push('0.9 0.9 0.9 RG 0.7 w ' + M + ' 42 m ' + RIGHT + ' 42 l S');
      return cmds.join('\n');
    };

    const chunks = [];
    chunks.push('%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n');
    let offset = chunks.join('').length;
    const offsets = [];
    const pushObj = (num, body) => {
      offsets[num] = offset;
      const s = num + ' 0 obj\n' + body + '\nendobj\n';
      chunks.push(s);
      offset += s.length;   /* every char here is latin1 => 1 byte */
    };

    const kids = pageObjIds.map(id => id + ' 0 R').join(' ');
    pushObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    pushObj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + total + ' >>');
    pushObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    pushObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    pushObj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');

    pages.forEach((cmds, i) => {
      const body = headerFooter(i) + '\n' + cmds.join('\n');
      const len = body.length;
      pushObj(pageObjIds[i], '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ' + contentIds[i] + ' 0 R >>');
      pushObj(contentIds[i], '<< /Length ' + len + ' >>\nstream\n' + body + '\nendstream');
    });

    const maxObj = firstPageObj + pages.length * 2;
    let xref = 'xref\n0 ' + maxObj + '\n0000000000 65535 f \n';
    for (let i = 1; i < maxObj; i++) {
      const o = offsets[i] || 0;
      xref += String(o).padStart(10, '0') + ' 00000 n \n';
    }
    const startxref = offset;
    const trailer = 'trailer\n<< /Size ' + maxObj + ' /Root 1 0 R >>\nstartxref\n' + startxref + '\n%%EOF\n';
    chunks.push(xref + trailer);

    /* latin1 encode to bytes */
    const str = chunks.join('');
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xFF;
    return bytes;
  }

  function hasNonLatin(rows) {
    try { return rows.some(r => r.some(v => /[^\u0000-\u00FF]/.test(String(v == null ? '' : v)))); }
    catch (e) { return false; }
  }

  root.LeadPDF = { buildReport, wrap, winAnsi, hasNonLatin };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LeadPDF;
})(typeof globalThis !== 'undefined' ? globalThis : this);
