/* LeadHarvest — in-page extraction engine.
   Runs in the content-script world. No network calls, no data leaves the page. */
(function () {
  'use strict';
  if (globalThis.__leadHarvestLoaded) return;
/* Cross-browser namespace: Firefox exposes promise-based `browser`, Chrome exposes `chrome`. */
const api = (typeof globalThis.browser !== 'undefined' && globalThis.browser && globalThis.browser.runtime) ? globalThis.browser : globalThis.chrome;
  globalThis.__leadHarvestLoaded = true;

  const SCHEMA = globalThis.LeadHarvestSchema;
  if (!SCHEMA) return;
  const T = globalThis.LeadTelemetry || {};

  /* Per-run diagnostics. Only counts and field keys are kept — never a value. */
  let currentSessionId = '';
  const diag = { selectorFailures: [], badRegex: 0, invalidJsonLd: 0 };

  function emit(event, opts) {
    opts = opts || {};
    try {
      api.runtime.sendMessage({
        type: 'LH_LOG_EVENT',
        event: event,
        level: opts.level || 'info',
        scope: opts.scope || 'content',
        message: opts.message || '',
        data: opts.data || {},
        hostname: location.hostname.replace(/^www\./, ''),
        sessionId: currentSessionId
      });
    } catch (e) { /* extension context gone */ }
  }

  /* ------------------------------------------------------------------ text */
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const cut = (s, n) => { s = norm(s); return n && s.length > n ? s.slice(0, n).trim() : s; };
  const elText = el => (el ? norm(el.innerText || el.textContent || '') : '');
  const SKIP_TAGS = /^(script|style|noscript|template|svg|iframe|head)$/i;
  /* Deterministic visible-text extraction: separators between element
     boundaries stop values from gluing together ("...12233priya@x.io"). */
  function docText(el) {
    if (!el) return '';
    let out = '';
    (function walk(node, depth) {
      if (!node || depth > 80) return;
      if (node.nodeType === 3) { if (node.nodeValue) out += node.nodeValue + ' '; return; }
      if (node.nodeType !== 1) return;
      if (SKIP_TAGS.test(node.tagName || '')) return;
      const st = node.getAttribute ? node.getAttribute('style') : '';
      if (st && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(st)) return;
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c, depth + 1);
      out += ' ';
    })(el, 0);
    return norm(out);
  }

  /* --------------------------------------------------------------- patterns */
  const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}/g;
  const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?)$|@(example\.(com|org|net)|domain\.com|email\.com|sentry\.io|wixpress\.com|sentry-next|yourdomain|mail\.com$)/i;

  const PHONE_RES = [
    /\+91[\s.\-()]{0,2}(?:0)?\d{5}[\s.\-]?\d{5}/g,
    /\+\d{1,3}[\s.\-()]{0,2}\d{2,5}[\s.\-]?\d{3,5}[\s.\-]?\d{3,5}/g,
    /\b0\d{2,4}[\s.\-]?\d{6,8}\b/g,
    /\b0\d{2,4}[\s.\-]\d{3,5}[\s.\-]\d{4}\b/g,
    /\b[6-9]\d{9}\b/g,
    /\b[6-9]\d{4}[\s.\-]\d{5}\b/g,
    /\b\d{3}[\s.\-]\d{3}[\s.\-]\d{4}\b/g,
    /\(\d{3,5}\)[\s.\-]?\d{3,5}[\s.\-]?\d{3,5}/g
  ];

  const INDIAN_STATES = [

    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',

    'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',

    'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',

    'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',

    'Mizoram', 'Nagaland', 'Odisha', 'Orissa',

    'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',

    'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',

    'West Bengal', 'Delhi', 'New Delhi', 'Jammu and Kashmir',

    'Ladakh', 'Puducherry', 'Chandigarh', 'Andaman and Nicobar',

    'Dadra and Nagar Haveli', 'Daman and Diu', 'Lakshadweep'

  ];

  const DESIGNATION_WORDS = [

    'ceo', 'cto', 'cfo', 'coo', 'cmo', 'founder',

    'co-founder', 'cofounder', 'director', 'managing director', 'md', 'proprietor',

    'partner', 'owner', 'manager', 'sr manager', 'senior manager', 'general manager',

    'gm', 'agm', 'dgm', 'head', 'lead', 'team lead',

    'supervisor', 'executive', 'officer', 'engineer', 'developer', 'designer',

    'architect', 'consultant', 'advisor', 'adviser', 'analyst', 'associate',

    'assistant', 'specialist', 'coordinator', 'accountant', 'advocate', 'lawyer',

    'attorney', 'doctor', 'dr', 'professor', 'teacher', 'principal',

    'sales', 'marketing', 'hr', 'human resource', 'recruiter', 'admin',

    'administrator', 'receptionist', 'operator', 'technician', 'incharge', 'in-charge',

    'president', 'vp', 'vice president', 'chairman', 'secretary', 'treasurer',

    'broker', 'agent', 'distributor', 'dealer', 'supplier', 'contractor',

    'freelancer', 'intern', 'trainee', 'apprentice', 'scientist', 'researcher',

    'pharmacist', 'nurse', 'physician', 'surgeon', 'dentist', 'ca',

    'chartered accountant', 'cs', 'company secretary', 'auditor', 'surveyor', 'inspector',

    'cashier', 'store manager', 'branch manager', 'regional manager', 'area manager', 'zonal manager',

    'business development'

  ];

  const HEADER_SYNONYMS = {
    name: ['name','full name','fullname','contact person','contact name','person','owner','owner name','naam','contact','director name','employee'],
    designation: ['designation','title','job title','role','position','department','dept','job role','profile'],
    company: ['company','business','firm','organization','organisation','brand','company name','employer','shop','store'],
    phone: ['phone','mobile','tel','telephone','contact no','contact number','phone number','mobile number','whatsapp','number','cell','phone no','mobile no','landline'],
    email: ['email','e-mail','mail','email address','email id','e-mail address'],
    address: ['address','location','office address','full address','street','office','branch','address line'],
    city: ['city','town','district','locality','area'],
    state: ['state','province','region'],
    pincode: ['pincode','pin code','pin','zip','zip code','postal code','post code'],
    country: ['country'],
    website: ['website','url','web','site','web site','link','homepage'],
    social: ['linkedin','social','profile','facebook','instagram'],
    category: ['category','industry','type','sector','service','services','speciality','specialty'],
    rating: ['rating','reviews','stars','score']
  };

  /* ------------------------------------------------------------- utilities */
  function normalizePhone(raw) {
    if (!raw) return '';
    let s = String(raw).trim();
    const plus = /^\+/.test(s) || /^00/.test(s);
    let d = s.replace(/\D/g, '');
    if (/^00/.test(s)) d = d.replace(/^00/, '');
    if (!d) return '';
    if (plus) { return d.length >= 8 && d.length <= 15 ? '+' + d : ''; }
    if (d.length === 10 && /^[6-9]/.test(d)) return '+91' + d;
    if (d.length === 11 && d[0] === '0') return '+91' + d.slice(1);
    if (d.length === 12 && d.startsWith('91')) return '+' + d;
    if (d.length >= 8 && d.length <= 15) return d.length > 10 ? '+' + d : d;
    return '';
  }

  function scanPhones(text) {
    const out = new Set();
    if (!text) return [];
    for (const re of PHONE_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const before = text[m.index - 1], after = text[m.index + m[0].length];
        if (before && /[\d]/.test(before)) continue;
        if (after && /[\d]/.test(after)) continue;
        const p = normalizePhone(m[0]);
        if (!p) continue;
        const digits = p.replace(/\D/g, '');
        if (digits.length < 8 || digits.length > 15) continue;
        if (/^(19|20)\d{2}$/.test(digits)) continue;         // a year
        if (/^(\d)\1{7,}$/.test(digits)) continue;            // 11111111
        out.add(p);
      }
    }
    return [...out];
  }

  function scanEmails(text) {
    const out = new Set();
    if (!text) return [];
    EMAIL_RE.lastIndex = 0;
    let m;
    while ((m = EMAIL_RE.exec(text)) !== null) {
      const e = m[0].replace(/^[.\-]+|[.\-]+$/g, '');
      if (BAD_EMAIL.test(e)) continue;
      if (e.length > 90) continue;
      out.add(e.toLowerCase());
    }
    return [...out];
  }

  function looksLikeAddress(t) {
    if (!t) return false;
    if (/\b(pin|pincode|pin code|zip|postal code)\s*[:\-]?\s*\d{5,6}\b/i.test(t)) return true;
    const hasPin = /\b\d{6}\b/.test(t);
    const kw = /\b(road|rd\.|street|st\.|nagar|colony|sector|block|floor|suite|plot|house no|near|opp\.?|opposite|district|dist\.|taluka|village|tehsil|po\b|ps\b|landmark|building|apartment|flat|lane|cross|main road|industrial area|phase)\b/i;
    const city = /\b(mumbai|delhi|bengaluru|bangalore|hyderabad|chennai|kolkata|pune|ahmedabad|jaipur|lucknow|surat|indore|bhopal|nagpur|patna|kanpur|coimbatore|kochi|chandigarh|gurgaon|gurugram|noida|ghaziabad|thane|navi mumbai|vadodara|rajkot|nashik|aurangabad|faridabad|meerut|varanasi|agra|amritsar|ludhiana|jalandhar|dehradun|ranchi|raipur|bhubaneswar|guwahati|visakhapatnam|vijayawada|mysore|mangalore|trivandrum|thiruvananthapuram|kozhikode|madurai|tiruchirappalli|salem|warangal|gwalior|jodhpur|udaipur|ajmer|kota|jabalpur|ujjain|srinagar|jammu|shimla|panaji|gangtok|shillong|imphal|aizawl|kohima|agartala|dispur|siliguri|durgapur|howrah|asansol)\b/i;
    return hasPin && (kw.test(t) || city.test(t)) && t.length >= 20 && t.length <= 400;
  }

  function looksLikeName(t) {
    t = norm(t);
    if (!t || t.length < 3 || t.length > 60) return false;
    if (/\d|@|http|www\.|\/|:|;/.test(t)) return false;
    const words = t.split(' ');
    if (words.length < 1 || words.length > 5) return false;
    if (!/^[A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F.'\- ]*$/.test(t)) return false;
    const stop = /^(home|about|contact|menu|services|products|gallery|blog|login|register|read more|click here|our team|team|call us|email us|get in touch|send message|submit|privacy policy|terms|faq|careers|sitemap|follow us|view profile|view more|next|previous)$/i;
    if (stop.test(t)) return false;
    const caps = words.filter(w => /^[A-Z\u0900-\u097F]/.test(w)).length;
    return caps >= Math.max(1, Math.ceil(words.length * 0.5));
  }

  function findDesignation(t) {
    const low = ' ' + norm(t).toLowerCase() + ' ';
    for (const d of DESIGNATION_WORDS) {
      const re = new RegExp('(^|[^a-z])' + d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)', 'i');
      if (re.test(low)) {
        const m = norm(t).match(new RegExp('.{0,28}' + d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.{0,28}', 'i'));
        return m ? cut(m[0], 70) : d;
      }
    }
    return '';
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let cur = el, depth = 0;
    while (cur && cur.nodeType === 1 && depth < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w\-]*$/.test(cur.id)) { parts.unshift(part + '#' + cur.id); break; }
      const cls = (cur.className && typeof cur.className === 'string' ? cur.className : '')
        .split(/\s+/).filter(c => c && !/^(ng|css|jsx|sc)-/.test(c)).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      const parent = cur.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter(c => c.tagName === cur.tagName);
        if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = cur.parentElement; depth++;
    }
    return parts.join(' > ');
  }

  /* --------------------------------------------------------------- sources */
  function collectJsonLd() {
    const out = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      const raw = (s.textContent || '').replace(/^\uFEFF/, '').trim();
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        (function walk(node, depth) {
          if (!node || depth > 8) return;
          if (Array.isArray(node)) return node.forEach(n => walk(n, depth + 1));
          if (typeof node !== 'object') return;
          if (node['@graph']) walk(node['@graph'], depth + 1);
          out.push(node);
          ['address', 'contactPoint', 'author', 'employee', 'founder', 'publisher', 'organization', 'worksFor'].forEach(k => {
            if (node[k]) walk(node[k], depth + 1);
          });
        })(data, 0);
      } catch (e) {
        diag.invalidJsonLd++;
        sendLog('warn', 'jsonld', 'Invalid JSON-LD skipped: ' + e.message);
      }
    });
    return out;
  }

  function ldValue(lds, props) {
    for (const ld of lds) {
      for (const p of props) {
        const v = ld[p];
        if (v == null) continue;
        if (typeof v === 'string' || typeof v === 'number') {
          const s = norm(String(v));
          if (s) return s;
        }
        if (Array.isArray(v)) {
          for (const item of v) {
            if (typeof item === 'string' && norm(item)) return norm(item);
            if (item && typeof item === 'object') {
              const inner = item.name || item['@value'] || item.text;
              if (inner && norm(String(inner))) return norm(String(inner));
            }
          }
        }
        if (v && typeof v === 'object') {
          const inner = v.name || v['@value'] || v.streetAddress || v.value;
          if (inner && norm(String(inner))) return norm(String(inner));
        }
      }
    }
    return '';
  }

  function microdataValue(scope, props) {
    for (const p of props) {
      const el = scope.querySelector('[itemprop="' + p + '"]');
      if (el) {
        const v = el.getAttribute('content') || el.getAttribute('href') || elText(el);
        if (norm(v)) return norm(v);
      }
    }
    return '';
  }

  function metaContent(names) {
    for (const n of names) {
      const el = document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]');
      if (el && el.content && norm(el.content)) return norm(el.content);
    }
    return '';
  }

  function ldAddress(lds) {
    for (const l of lds || []) {
      const a = l.address;
      if (!a) continue;
      if (typeof a === 'string' && norm(a)) return norm(a);
      if (typeof a === 'object') {
        const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry]
          .filter(Boolean)
          .map(x => (typeof x === 'object' ? (x.name || '') : String(x)))
          .filter(Boolean);
        if (parts.length) return norm(parts.join(', '));
      }
    }
    return '';
  }

  /* Split a free-text address into city / state / pincode / country. */
  function parseAddressParts(addr) {
    const out = {};
    addr = norm(addr);
    if (!addr) return out;
    const pin = addr.match(/\b(\d{6})\b(?!\d)/) || addr.match(/\b(\d{5})(?:-\d{4})?\b(?!\d)/);
    if (pin) out.pincode = pin[1];
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stateHit = INDIAN_STATES.find(s => new RegExp('\\b' + esc(s) + '\\b', 'i').test(addr));
    if (stateHit) out.state = stateHit;
    const segs = addr.split(',').map(norm).filter(Boolean);
    let citySeg = '';
    const pinIdx = segs.findIndex(s => /\b\d{5,6}\b/.test(s));
    if (pinIdx >= 0) {
      let cand = segs[pinIdx].replace(/\b\d{5,6}\b/g, ' ');
      if (out.state) cand = cand.replace(new RegExp(esc(out.state), 'i'), ' ');
      cand = norm(cand).replace(/^[,\s]+|[,\s]+$/g, '');
      if (cand && cand.length <= 30 && !/\d/.test(cand) && !/^(india|pin|pincode|zip|postal|code)$/i.test(cand)) citySeg = cand;
    }
    if (!citySeg && pinIdx > 0) citySeg = segs[pinIdx - 1];
    if (!citySeg) {
      for (let i = segs.length - 1; i >= 0; i--) {
        if (!/\d/.test(segs[i]) && !INDIAN_STATES.some(st => st.toLowerCase() === segs[i].toLowerCase())) { citySeg = segs[i]; break; }
      }
    }
    if (citySeg) {
      let c = citySeg;
      if (out.state) c = c.replace(new RegExp(esc(out.state), 'i'), ' ');
      c = norm(c).replace(/\b\d{5,6}\b/g, '').replace(/^[,\s]+|[,\s]+$/g, '');
      if (c && c.length <= 40 && !/\d/.test(c)) out.city = c;
    }
    if (/\bindia\b/i.test(addr)) out.country = 'India';
    return out;
  }

  /* ------------------------------------------------------------ table mode */
  function matchHeader(h) {
    h = norm(h).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    if (!h) return '';
    let bestKey = '', bestScore = 0;
    for (const key of Object.keys(HEADER_SYNONYMS)) {
      for (const syn of HEADER_SYNONYMS[key]) {
        let score = 0;
        if (h === syn || h === syn + 's') score = 4;
        else if (h.startsWith(syn + ' ') || h.endsWith(' ' + syn)) score = 3;
        else if (new RegExp('(^| )' + syn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(h)) score = 3;
        else if (h.includes(syn) && syn.length >= 4) score = 1;
        if (score > bestScore) { bestScore = score; bestKey = key; }
      }
    }
    return bestKey;
  }

  function cellValue(cell, key) {
    const a = cell.querySelector('a[href]');
    if (a) {
      const href = a.getAttribute('href') || '';
      if (key === 'phone' && /^tel:/i.test(href)) return normalizePhone(href.slice(4));
      if (key === 'email' && /^mailto:/i.test(href)) return norm(href.slice(7).split('?')[0]).toLowerCase();
      if (key === 'website' || key === 'social') {
        if (/^https?:/i.test(href)) return href;
        if (href.startsWith('/')) return location.origin + href;
      }
    }
    const t = elText(cell);
    if (!t) return '';
    if (key === 'phone') return scanPhones(t)[0] || '';
    if (key === 'email') return scanEmails(t)[0] || '';
    return cut(t, key === 'address' ? 300 : 120);
  }

  function extractFromTables() {
    const records = [];
    document.querySelectorAll('table').forEach(table => {
      const rows = [...table.querySelectorAll('tr')];
      if (rows.length < 2) return;   /* header + at least one data row */
      const headerCells = [...rows[0].querySelectorAll('th,td')];
      if (headerCells.length < 3) return;
      const map = {};
      headerCells.forEach((c, i) => { const k = matchHeader(c.textContent); if (k && map[k] === undefined) map[k] = i; });
      const keys = Object.keys(map);
      if (keys.length < 2) return;
      if (!keys.some(k => k === 'name' || k === 'phone' || k === 'email' || k === 'company')) return;
      rows.slice(1).forEach(tr => {
        const cells = [...tr.querySelectorAll('td,th')];
        if (cells.length < 2) return;
        const values = {}; let hits = 0;
        keys.forEach(k => {
          const cell = cells[map[k]];
          if (!cell) return;
          const v = cellValue(cell, k);
          if (v) { values[k] = v; hits++; }
        });
        if (hits >= 2 && (values.name || values.phone || values.email || values.company)) {
          records.push({ values, source: 'table' });
        }
      });
    });
    return records;
  }

  /* ------------------------------------------------------------ card mode */
  const CARD_HINT = /card|listing|contact|profile|member|team|person|directory|result|item|entry|vcard|business|shop|store/i;

  function blockRoot(el) {
    let cur = el, depth = 0;
    while (cur && cur.nodeType === 1 && depth < 8) {
      const t = elText(cur);
      if (t.length >= 25 && t.length <= 900) {
        const hasHeading = cur.querySelector('h1,h2,h3,h4,h5,h6,strong,b,[class*="name"],[class*="title"]');
        const cls = (cur.className && typeof cur.className === 'string') ? cur.className : '';
        if (hasHeading || CARD_HINT.test(cls) || CARD_HINT.test(cur.id || '')) return cur;
      }
      cur = cur.parentElement; depth++;
    }
    return el.parentElement || el;
  }

  function findBlocks() {
    const seeds = [];
    document.querySelectorAll('a[href^="tel:"],a[href^="mailto:"]').forEach(a => seeds.push(a));
    document.querySelectorAll('[itemtype*="Person"],[itemtype*="Organization"],[itemtype*="LocalBusiness"]').forEach(el => seeds.push(el));
    if (seeds.length < 2) {
      document.querySelectorAll('[class*="card"],[class*="listing"],[class*="contact"],[class*="profile"],[class*="member"],[class*="team"],[class*="business"],[class*="directory"]').forEach(el => {
        const t = elText(el);
        if (t.length > 40 && t.length < 900) seeds.push(el);
      });
    }
    const roots = [];
    seeds.forEach(s => { const r = blockRoot(s); if (r && !roots.includes(r)) roots.push(r); });
    /* keep the smallest distinct blocks, drop ancestors that contain another block */
    roots.sort((a, b) => elText(a).length - elText(b).length);
    const kept = [];
    for (const r of roots) {
      if (kept.some(k => k === r || k.contains(r) || r.contains(k))) continue;
      if (elText(r).length < 20) continue;
      kept.push(r);
    }
    if (kept.length > 1) {
      const all = document.querySelectorAll('*');
      if (all.length < 20000) {
        const order = new Map();
        for (let i = 0; i < all.length; i++) order.set(all[i], i);
        kept.sort((a, b) => (order.has(a) ? order.get(a) : 0) - (order.has(b) ? order.get(b) : 0));
      }
    }
    return kept;
  }

  /* --------------------------------------------------------- field readers */
  function readField(field, scope, ctx) {
    const key = field.key, hints = field.hints || {};
    const text = ctx.text;
    const out = [];
    const push = (value, confidence, source) => {
      value = norm(value);
      if (!value) return;
      if (value.length > 600) value = value.slice(0, 600);
      out.push({ value, confidence, source });
    };

    switch (key) {
      case 'name': {
        const personNode = (ctx.ld || []).find(l => /\bperson\b/i.test(String(l['@type'] || '')) && norm(l.name));
        if (personNode) push(personNode.name, 0.95, 'json-ld-person');
        push(ldValue(ctx.ld, hints.jsonld && hints.jsonld.length ? hints.jsonld : ['name']), 0.85, 'json-ld');
        push(microdataValue(scope, ['name']), 0.9, 'microdata');
        for (const sel of (hints.selectors || [])) {
          const els = scope.querySelectorAll(sel);
          for (const el of [...els].slice(0, 6)) {
            const t = elText(el);
            if (looksLikeName(t)) { push(t, 0.75, 'selector ' + sel); break; }
          }
        }
        if (!out.length) {
          for (const el of [...scope.querySelectorAll('h1,h2,h3,h4,strong,b')].slice(0, 25)) {
            const t = elText(el);
            if (looksLikeName(t)) { push(t, 0.6, 'heading'); break; }
          }
        }
        if (!out.length) {
          const lines = text.split(/\n|•|\||·/).map(norm).filter(Boolean).slice(0, 60);
          for (const l of lines) { if (looksLikeName(l)) { push(l, 0.45, 'text-line'); break; } }
        }
        break;
      }
      case 'designation': {
        push(ldValue(ctx.ld, ['jobTitle']), 0.95, 'json-ld');
        push(microdataValue(scope, ['jobTitle']), 0.9, 'microdata');
        for (const sel of (hints.selectors || [])) {
          const el = scope.querySelector(sel);
          if (el) { const t = elText(el); if (t && t.length < 90) push(t, 0.8, 'selector ' + sel); }
        }
        if (!out.length) {
          const desigHint = /designation|job-?title|desig|role|position|post|profession/i;
          const personTitle = /^(dr|mr|mrs|ms|shri|smt|prof|sri|er)\.?\s/i;
          const els = [...scope.querySelectorAll('p,span,div,li,td,small,em,strong,h5,h6')].slice(0, 600);
          for (const el of els) {
            if (el.children.length > 2) continue;
            const t = elText(el);
            if (!t || t.length > 70) continue;
            const cls = ((el.className && typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || ''));
            if (desigHint.test(cls)) { push(t, 0.75, 'designation-class'); break; }
          }
          if (!out.length) {
            for (const el of els) {
              if (el.children.length > 2) continue;
              const t = elText(el);
              if (!t || t.length > 70 || personTitle.test(t)) continue;
              if (findDesignation(t)) { push(t, 0.6, 'element-keyword'); break; }
            }
          }
        }
        if (!out.length) {
          const d = findDesignation(text.slice(0, 1500));
          if (d) push(d, 0.4, 'keyword');
        }
        break;
      }
      case 'company': {
        const orgNode = (ctx.ld || []).find(l => /organization|localbusiness|corporation|store|restaurant|professionalservice|accounting|legal|medical|educational|shop|company/i.test(String(l['@type'] || '')) && norm(l.name));
        if (orgNode) push(orgNode.name, 0.95, 'json-ld-org');
        push(ldValue(ctx.ld, ['legalName', 'name']), 0.85, 'json-ld');
        push(microdataValue(scope, ['worksFor', 'name']), 0.85, 'microdata');
        for (const sel of (hints.selectors || [])) {
          const el = scope.querySelector(sel);
          if (el) { const t = elText(el); if (t && t.length < 120 && !looksLikeAddress(t)) push(t, 0.7, 'selector ' + sel); }
        }
        push(metaContent(['og:site_name', 'application-name']), 0.65, 'meta');
        if (!out.length) {
          const title = norm(document.title);
          const m = title.split(/\s[|\-–—:]\s/);
          if (m.length > 1) push(m[m.length - 1], 0.5, 'page-title');
          else if (title) push(title, 0.4, 'page-title');
        }
        break;
      }
      case 'phone': {
        for (const v of (ldValue(ctx.ld, ['telephone']) ? [ldValue(ctx.ld, ['telephone'])] : [])) push(normalizePhone(v) || v, 0.95, 'json-ld');
        push(normalizePhone(microdataValue(scope, ['telephone'])), 0.9, 'microdata');
        scope.querySelectorAll('a[href^="tel:"],a[href^="whatsapp:"],a[href*="wa.me"],a[href*="api.whatsapp"]').forEach(a => {
          const href = a.getAttribute('href') || '';
          const raw = href.replace(/^tel:/i, '').split('?')[0].replace(/[^\d+]/g, '');
          push(normalizePhone(raw) || normalizePhone(elText(a)), 0.92, 'tel-link');
        });
        for (const sel of (hints.selectors || [])) {
          const el = scope.querySelector(sel);
          if (el) { const p = scanPhones(elText(el))[0]; if (p) push(p, 0.75, 'selector ' + sel); }
        }
        for (const p of scanPhones(ctx.blockText || text)) push(p, 0.6, 'regex');
        break;
      }
      case 'email': {
        const ldMail = ldValue(ctx.ld, ['email']);
        if (ldMail) push(ldMail.replace(/^mailto:/i, ''), 0.95, 'json-ld');
        push(microdataValue(scope, ['email']).replace(/^mailto:/i, ''), 0.9, 'microdata');
        scope.querySelectorAll('a[href^="mailto:"]').forEach(a => {
          const e = norm((a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0]).toLowerCase();
          if (e && !BAD_EMAIL.test(e)) push(e, 0.92, 'mail-link');
        });
        for (const e of scanEmails(ctx.blockText || text)) push(e, 0.6, 'regex');
        break;
      }
      case 'address': {
        const ldAddr = ldAddress(ctx.ld);
        if (ldAddr) push(ldAddr, 0.95, 'json-ld-address');
        const md = microdataValue(scope, ['streetAddress', 'address']);
        if (md) push(md, 0.85, 'microdata');
        for (const sel of (hints.selectors || [])) {
          const els = scope.querySelectorAll(sel);
          for (const el of [...els].slice(0, 8)) {
            const t = elText(el);
            if (t && t.length >= 15 && t.length <= 400) { push(t, 0.7, 'selector ' + sel); break; }
          }
        }
        if (!out.length) {
          for (const el of [...scope.querySelectorAll('p,div,span,li,address,td')].slice(0, 400)) {
            if (el.children.length > 3) continue;
            const t = elText(el);
            if (t && t.length <= 400 && looksLikeAddress(t)) { push(t, 0.55, 'heuristic'); break; }
          }
        }
        break;
      }
      case 'city': case 'state': case 'country': {
        const ldKey = key === 'city' ? 'addressLocality' : key === 'state' ? 'addressRegion' : 'addressCountry';
        const v = ldValue(ctx.ld, [ldKey]);
        if (v) push(v, 0.9, 'json-ld');
        const mdv = microdataValue(scope, [ldKey]);
        if (mdv) push(mdv, 0.85, 'microdata');
        if (!out.length) {
          const ap = ctx.addressParts || parseAddressParts(ctx.addressText || '');
          if (ap[key]) push(ap[key], 0.65, 'address-parse');
        }
        break;
      }
      case 'pincode': {
        const v = ldValue(ctx.ld, ['postalCode']);
        if (v) push(v, 0.9, 'json-ld');
        const mdv = microdataValue(scope, ['postalCode']);
        if (mdv) push(mdv, 0.85, 'microdata');
        if (!out.length) {
          const ap = ctx.addressParts || parseAddressParts(ctx.addressText || '');
          if (ap.pincode) push(ap.pincode, 0.65, 'address-parse');
        }
        break;
      }
      case 'website': {
        push(ldValue(ctx.ld, ['url']), 0.85, 'json-ld');
        const canon = document.querySelector('link[rel="canonical"]');
        if (canon && canon.href) push(canon.href, 0.7, 'canonical');
        if (!out.length) push(location.origin, 0.4, 'page');
        break;
      }
      case 'social': {
        const links = new Set();
        scope.querySelectorAll('a[href]').forEach(a => {
          const h = a.getAttribute('href') || '';
          if (/linkedin\.com|instagram\.com|facebook\.com|twitter\.com|x\.com|youtube\.com|wa\.me|t\.me/i.test(h)) links.add(h.split('?')[0]);
        });
        (ldValue(ctx.ld, ['sameAs']) ? [ldValue(ctx.ld, ['sameAs'])] : []).forEach(u => links.add(u));
        if (links.size) push([...links].slice(0, 6).join(' | '), 0.7, 'links');
        break;
      }
      case 'category': {
        const t = ldValue(ctx.ld, ['@type']);
        if (t && t !== 'WebPage' && t !== 'WebSite') push(t, 0.7, 'json-ld');
        for (const sel of (hints.selectors || [])) {
          const el = scope.querySelector(sel);
          if (el) { const v = elText(el); if (v && v.length < 60) { push(v, 0.55, 'selector ' + sel); break; } }
        }
        if (!out.length) push(metaContent(['article:section', 'og:type']), 0.4, 'meta');
        break;
      }
      case 'rating': {
        const v = ldValue(ctx.ld, ['ratingValue']);
        const c = ldValue(ctx.ld, ['reviewCount']);
        if (v) push(c ? v + ' (' + c + ' reviews)' : v, 0.8, 'json-ld');
        for (const sel of (hints.selectors || [])) {
          const el = scope.querySelector(sel);
          if (el) { const t = elText(el); if (t && t.length < 40) { push(t, 0.5, 'selector ' + sel); break; } }
        }
        break;
      }
      default: {
        /* generic / custom field: selectors → regex → json-ld */
        for (const sel of (hints.selectors || [])) {
          try {
            const el = scope.querySelector(sel);
            if (el) { const t = elText(el); if (t) { push(t, 0.7, 'selector ' + sel); break; } }
          } catch (e) {
            diag.selectorFailures.push({ field: field.key, selector: String(sel).slice(0, 60), reason: 'invalid_selector' });
            sendLog('warn', 'selector', 'Bad selector "' + sel + '": ' + e.message);
          }
        }
        if (!out.length) push(ldValue(ctx.ld, hints.jsonld || []), 0.7, 'json-ld');
        if (!out.length) {
          for (const rx of (hints.regex || [])) {
            try {
              const re = new RegExp(rx, 'i');
              const m = text.match(re);
              if (m) { push(m[1] || m[0], 0.6, 'regex'); break; }
            } catch (e) {
              diag.badRegex++;
              sendLog('warn', 'regex', 'Bad regex "' + rx + '": ' + e.message);
            }
          }
        }
        break;
      }
    }

    if (!out.length) return null;
    out.sort((a, b) => b.confidence - a.confidence);
    const best = out[0];
    if (field.type === 'phone') {
      const all = new Set();
      out.forEach(o => scanPhones(o.value).forEach(p => all.add(p)));
      if (all.size) best.value = [...all].slice(0, 3).join(', ');
    }
    if (field.type === 'email') {
      const all = new Set();
      out.forEach(o => scanEmails(o.value).forEach(e => all.add(e)));
      if (all.size) best.value = [...all].slice(0, 3).join(', ');
    }
    return best;
  }

  /* ------------------------------------------------------------ page type */
  function detectPageType(url, text) {
    const u = (url || '').toLowerCase();
    const t = (text || '').toLowerCase();
    if (/contact|reach-us|get-in-touch|sampark/.test(u)) return 'contact';
    if (/directory|listing|businesses|companies|vendors|suppliers|justdial|indiamart|sulekha|yellowpages|clutch/.test(u)) return 'directory';
    if (/team|about|leadership|people|staff/.test(u)) return 'team';
    if (/profile|user|@/.test(u) && /linkedin|twitter|instagram|facebook/.test(u)) return 'profile';
    const contactHits = (t.match(/\b(contact|phone|mobile|email|address|call us|get in touch)\b/g) || []).length;
    const telCount = document.querySelectorAll('a[href^="tel:"]').length;
    const mailCount = document.querySelectorAll('a[href^="mailto:"]').length;
    if (telCount + mailCount >= 3) return 'directory';
    if (contactHits >= 4) return 'contact';
    if (document.querySelectorAll('table').length && document.querySelectorAll('table tr').length > 5) return 'directory';
    return 'general';
  }

  /* --------------------------------------------------------------- scoring */
  function scoreRecord(values, fields) {
    let wsum = 0, got = 0;
    fields.forEach(f => {
      const w = f.weight == null ? 1 : f.weight;
      if (w <= 0) return;
      wsum += w;
      if (values[f.key]) got += w;
    });
    return wsum ? Math.round((got / wsum) * 100) / 100 : 0;
  }

  /* ------------------------------------------------------------- main run */
  function buildOne(scope, ctx, method) {
    const values = {};
    const meta = {};
    (ctx.fields || []).forEach(f => {
      const hit = readField(f, scope, ctx);
      if (hit && hit.value) {
        values[f.key] = hit.value;
        meta[f.key] = { confidence: hit.confidence, source: hit.source };
      }
    });
    if (!Object.keys(values).length) return null;
    return { values, fieldMeta: meta, method };
  }

  async function extract(settings, sessionId) {
    const t0 = performance.now();
    currentSessionId = sessionId || '';
    diag.selectorFailures.length = 0;
    diag.badRegex = 0;
    diag.invalidJsonLd = 0;
    settings = SCHEMA.normalizeSettings(settings);
    emit('extraction_started', {
      message: 'Extraction started',
      data: {
        fields_enabled: SCHEMA.enabledFields(settings).length,
        deep_scan: settings.scrape.deepScan !== false,
        auto_scroll: !!settings.scrape.autoScroll
      }
    });
    const fields = SCHEMA.enabledFields(settings);
    const maxRecords = Math.max(1, Math.min(1000, settings.scrape.maxRecords || 200));

    if (settings.scrape.autoScroll) await autoScroll();

    const lds = settings.scrape.deepScan === false ? [] : collectJsonLd();
    const bodyText = docText(document.body);
    const fullText = norm(bodyText);
    const pageType = detectPageType(location.href, fullText);
    const ctxBase = { ld: lds, text: fullText.slice(0, 200000), fields };
    const records = [];
    const seen = new Set();

    const pushRecord = (rec, method) => {
      if (!rec) return;
      const v = rec.values || rec;
      const key = (v.phone || '') + '|' + (v.email || '') + '|' + (v.name || '') + '|' + (v.company || '');
      if (settings.scrape.dedupe && key.replace(/\|/g, '')) {
        if (seen.has(key)) return;
        seen.add(key);
      }
      if (v.address) {
        const ap = parseAddressParts(v.address);
        ['city', 'state', 'pincode', 'country'].forEach(k => {
          if (!v[k] && ap[k] && fields.some(f => f.key === k)) v[k] = ap[k];
        });
      }
      const filled = Object.keys(v).filter(k => v[k]).length;
      if (!filled) return;
      const strong = v.phone || v.email || (v.name && (v.company || v.address));
      if (!strong && filled < 3) return;
      records.push({
        id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        values: v,
        fieldMeta: rec.fieldMeta || {},
        confidence: scoreRecord(v, fields),
        method: method,
        sourceUrl: location.href,
        pageTitle: norm(document.title).slice(0, 160),
        scrapedAt: new Date().toISOString()
      });
    };

    /* 1. table rows (directory pages) */
    if (settings.scrape.deepScan !== false) {
      extractFromTables().forEach(r => pushRecord(r, 'table'));
    }

    /* 2. repeated cards / listings */
    if (records.length === 0) {
      const blocks = findBlocks();
      if (blocks.length >= 2) {
        blocks.slice(0, maxRecords).forEach(b => {
          const blockText = docText(b);
          const ctx = Object.assign({}, ctxBase, { blockText, text: blockText });
          const rec = buildOne(b, ctx, 'card');
          if (rec) pushRecord(rec, 'card');
        });
      }
    }

    /* 3. single-record page (contact page / profile / business site) */
    if (records.length === 0) {
      const scope = document.querySelector('main,article,#content,.content,[role="main"]') || document.body;
      const ctx = Object.assign({}, ctxBase, { blockText: ctxBase.text });
      const rec = buildOne(scope, ctx, pageType);
      if (rec) {
        /* fill address-derived fields */
        const addr = rec.values.address || '';
        if (addr) {
          ctx.addressText = addr;
          ['city', 'state', 'pincode', 'country'].forEach(k => {
            if (!rec.values[k]) {
              const f = fields.find(x => x.key === k);
              if (f) { const hit = readField(f, scope, Object.assign({}, ctx, { addressText: addr })); if (hit) rec.values[k] = hit.value; }
            }
          });
        }
        rec.confidence = scoreRecord(rec.values, fields);
        pushRecord(rec, pageType);
      }
    }

    /* 4. JSON-LD multi-entity pages: one record per Person/Organization */
    if (records.length === 0 && lds.length) {
      lds.filter(l => /person|organization|localbusiness|professionalservice|store|restaurant/i.test(String(l['@type'] || '')))
        .slice(0, maxRecords).forEach(l => {
          const v = {};
          if (l.name) v.name = norm(String(l.name));
          if (l.jobTitle) v.designation = norm(String(l.jobTitle));
          if (l.telephone) v.phone = normalizePhone(String(l.telephone)) || norm(String(l.telephone));
          if (l.email) v.email = norm(String(l.email)).replace(/^mailto:/i, '').toLowerCase();
          if (l.address && typeof l.address === 'object') {
            const a = l.address;
            const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry].filter(Boolean).map(String);
            if (parts.length) v.address = parts.join(', ');
            if (a.addressLocality) v.city = norm(String(a.addressLocality));
            if (a.addressRegion) v.state = norm(String(a.addressRegion));
            if (a.postalCode) v.pincode = norm(String(a.postalCode));
          }
          if (l.url) v.website = String(l.url);
          if (Object.keys(v).length) pushRecord({ values: v, fieldMeta: {} }, 'json-ld');
        });
    }

    const out = records.slice(0, maxRecords).map(r => ({
      ...r,
      domain: location.hostname
    }));

    const ms = Math.round(performance.now() - t0);
    sendLog('info', 'extract', 'Scraped ' + out.length + ' record(s) from ' + location.hostname + ' in ' + ms + 'ms', {
      pageType, records: out.length, ms, url: location.href
    });

    /* ---- diagnostics: counts only, no contact values ---- */
    const fieldStats = {};
    fields.forEach(f => { fieldStats[f.key] = { success: 0, missing: 0 }; });
    out.forEach(r => fields.forEach(f => {
      if (r.values && r.values[f.key]) fieldStats[f.key].success++;
      else fieldStats[f.key].missing++;
    }));

    const domNodes = document.getElementsByTagName('*').length;
    const domMs = ms;
    const dynamic = document.querySelectorAll('form').length > 0 || document.querySelectorAll('script[src]').length > 3;
    const iframes = document.querySelectorAll('iframe').length;
    const shadowHosts = [...document.querySelectorAll('*')].filter(el => el.shadowRoot).length;
    const lazyImages = document.querySelectorAll('img[loading="lazy"],img[data-src]').length;

    emit('extraction_completed', {
      message: 'Extracted ' + out.length + ' record(s) in ' + ms + 'ms',
      data: {
        records: out.length,
        method: out.length ? out[0].method : 'none',
        page_type: pageType,
        processing_time_ms: ms,
        dom_processing_ms: domMs,
        avg_record_ms: out.length ? Math.round((ms / out.length) * 10) / 10 : 0,
        fields: fieldStats,
        selector_failures: diag.selectorFailures.length,
        invalid_jsonld: diag.invalidJsonLd,
        bad_regex: diag.badRegex,
        dom_nodes: domNodes,
        text_length: fullText.length
      }
    });

    if (diag.selectorFailures.length) {
      const byField = {};
      diag.selectorFailures.forEach(f => { byField[f.field] = (byField[f.field] || 0) + 1; });
      emit('selector_failure', {
        level: 'warn',
        message: diag.selectorFailures.length + ' selector(s) failed',
        data: { count: diag.selectorFailures.length, by_field: byField, sample: diag.selectorFailures.slice(0, 5) }
      });
    }

    if (T.qualityOf) {
      emit('quality_report', { message: 'Lead quality snapshot', data: T.qualityOf(out, settings) });
    }

    emit('site_report', {
      message: 'Compatibility report for ' + location.hostname,
      data: {
        hostname: location.hostname.replace(/^www\./, ''),
        page_type: pageType,
        supported: out.length > 0,
        dom_detected: domNodes > 0,
        selectors_available: Object.keys(fieldStats).filter(k => fieldStats[k].success > 0).length,
        dynamic_content: dynamic,
        infinite_scroll: !!settings.scrape.autoScroll,
        spa_detected: !!(window.history && history.length > 1 && document.querySelector('[data-reactroot],[ng-version],#__next,#root')),
        shadow_dom_hosts: shadowHosts,
        iframes,
        lazy_images: lazyImages,
        parser_version: (T.ALGO && T.ALGO.parser) || '',
        signals: {
          json_ld: lds.length,
          tel_links: document.querySelectorAll('a[href^="tel:"]').length,
          mail_links: document.querySelectorAll('a[href^="mailto:"]').length,
          tables: document.querySelectorAll('table').length,
          forms: document.querySelectorAll('form').length
        }
      }
    });

    if (T.memMb) {
      emit('perf_sample', {
        message: 'Performance sample',
        data: {
          extraction_ms: ms,
          dom_processing_ms: domMs,
          avg_record_ms: out.length ? Math.round((ms / out.length) * 10) / 10 : 0,
          records_per_minute: ms > 0 ? Math.round((out.length / ms) * 60000) : 0,
          memory_mb: T.memMb(),
          dom_nodes: domNodes
        }
      });
    }

    if (!out.length) {
      emit('unsupported_page_structure', {
        level: 'warn',
        message: 'No contact data found on ' + location.hostname,
        data: {
          page_type: pageType,
          text_length: fullText.length,
          tables: document.querySelectorAll('table').length,
          forms: document.querySelectorAll('form').length,
          json_ld: lds.length,
          reason: fullText.length < 400 ? 'page_too_thin_or_js_rendered' : 'no_matching_structure'
        }
      });
    }

    return {
      ok: true,
      url: location.href,
      domain: location.hostname,
      title: norm(document.title).slice(0, 160),
      pageType,
      method: out.length ? out[0].method : 'none',
      durationMs: ms,
      signals: {
        jsonLd: lds.length,
        telLinks: document.querySelectorAll('a[href^="tel:"]').length,
        mailLinks: document.querySelectorAll('a[href^="mailto:"]').length,
        tables: document.querySelectorAll('table').length,
        forms: document.querySelectorAll('form').length,
        textLength: fullText.length,
        cards: document.querySelectorAll('[class*="card"],[class*="listing"]').length,
        hasAddressText: looksLikeAddress(fullText.slice(0, 4000))
      },
      records: out
    };
  }

  async function autoScroll() {
    const step = Math.max(300, Math.round(window.innerHeight * 0.8));
    const startY = window.scrollY;
    const max = Math.min(document.body ? document.body.scrollHeight : 0, 20000);
    for (let y = 0; y < max; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 120));
    }
    window.scrollTo(0, startY);
    await new Promise(r => setTimeout(r, 200));
  }

  /* ---------------------------------------------------------------- picker */
  let pickerState = null;

  function startPicker(fieldKey) {
    stopPicker();
    const overlay = document.createElement('div');
    overlay.id = '__lh_overlay';
    overlay.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4f46e5;background:rgba(79,70,229,.12);border-radius:3px;transition:all .04s;display:none';
    const tip = document.createElement('div');
    tip.id = '__lh_tip';
    tip.style.cssText = 'position:fixed;z-index:2147483647;background:#111827;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:4px 8px;border-radius:4px;pointer-events:none;display:none;max-width:340px';
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(tip);

    const onMove = e => {
      const el = e.target;
      if (!el || el.id === '__lh_overlay' || el.id === '__lh_tip') return;
      const r = el.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.top = r.top + 'px'; overlay.style.left = r.left + 'px';
      overlay.style.width = r.width + 'px'; overlay.style.height = r.height + 'px';
      tip.style.display = 'block';
      tip.style.top = Math.max(2, r.top - 26) + 'px';
      tip.style.left = Math.max(2, r.left) + 'px';
      tip.textContent = elText(el).slice(0, 90) || el.tagName.toLowerCase();
    };
    const onClick = e => {
      e.preventDefault(); e.stopPropagation();
      const el = e.target;
      const value = elText(el).slice(0, 500);
      const sel = cssPath(el);
      api.runtime.sendMessage({ type: 'LH_PICK_RESULT', fieldKey, value, selector: sel, url: location.href });
      stopPicker();
    };
    const onKey = e => { if (e.key === 'Escape') stopPicker(); };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    pickerState = { overlay, tip, onMove, onClick, onKey };
    return true;
  }

  function stopPicker() {
    if (!pickerState) return;
    document.removeEventListener('mousemove', pickerState.onMove, true);
    document.removeEventListener('click', pickerState.onClick, true);
    document.removeEventListener('keydown', pickerState.onKey, true);
    pickerState.overlay.remove(); pickerState.tip.remove();
    pickerState = null;
  }

  /* ------------------------------------------------------------ messaging */
  function sendLog(level, scope, message, data) {
    try {
      api.runtime.sendMessage({ type: 'LH_LOG', level, scope, message, data: data || {} });
    } catch (e) { /* extension reloaded */ }
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'LH_PING') { sendResponse({ ok: true }); return true; }
    if (msg.type === 'LH_EXTRACT') {
      extract(msg.settings, msg.sessionId).then(r => sendResponse(r)).catch(err => {
        emit('extraction_failed', {
          level: 'error',
          message: 'Extraction failed: ' + ((err && err.message) || err),
          data: {
            error_code: 'extract_exception',
            error_message: String((err && err.message) || err).slice(0, 300),
            stack: T.sanitizeStack ? T.sanitizeStack(err && err.stack) : ''
          }
        });
        sendLog('error', 'extract', 'Extraction failed: ' + (err && err.message));
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      });
      return true;
    }
    if (msg.type === 'LH_START_PICK') { startPicker(msg.fieldKey); sendResponse({ ok: true }); return true; }
    if (msg.type === 'LH_STOP_PICK') { stopPicker(); sendResponse({ ok: true }); return true; }
  });

  /* expose for tests */
  globalThis.__leadHarvest = { extract, scanPhones, scanEmails, normalizePhone, looksLikeAddress, looksLikeName, matchHeader, cssPath };
})();
