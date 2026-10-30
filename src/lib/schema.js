/* LeadHarvest — shared schema, defaults and small helpers.
   Loaded in the content script AND in the dashboard (single source of truth). */
(function (root) {
  'use strict';

  const FIELD_TYPES = ['text', 'phone', 'email', 'url', 'multiline', 'number'];

  /* Field groups are only used for display in the schema builder. */
  const DEFAULT_FIELDS = [
    {
      key: 'name', label: 'Full Name', type: 'text', enabled: true, required: true, weight: 3, group: 'Identity',
      description: 'Person ka naam (owner, contact person, employee).',
      hints: {
        selectors: ['[itemprop="name"]', '[class*="person-name"]', '[class*="contact-name"]', '[class*="fullname"]', '[class*="author"]', 'h1', 'h2'],
        jsonld: ['name'],
        regex: []
      }
    },
    {
      key: 'designation', label: 'Designation', type: 'text', enabled: true, required: false, weight: 2, group: 'Identity',
      description: 'Job title / role — e.g. Manager, Founder, Sales Head.',
      hints: {
        selectors: ['[itemprop="jobTitle"]', '[class*="designation"]', '[class*="job-title"]', '[class*="role"]', '[class*="position"]'],
        jsonld: ['jobTitle'],
        regex: []
      }
    },
    {
      key: 'company', label: 'Company / Business', type: 'text', enabled: true, required: false, weight: 3, group: 'Identity',
      description: 'Company, firm ya business ka naam.',
      hints: {
        selectors: ['[itemprop="worksFor"]', '[itemprop="name"]', '[class*="company"]', '[class*="business"]', '[class*="org"]'],
        jsonld: ['name', 'legalName'],
        regex: []
      }
    },
    {
      key: 'phone', label: 'Phone Number', type: 'phone', enabled: true, required: true, weight: 3, group: 'Contact',
      description: 'Mobile / landline / WhatsApp number.',
      hints: { selectors: ['a[href^="tel:"]', '[itemprop="telephone"]', '[class*="phone"]', '[class*="mobile"]'], jsonld: ['telephone'], regex: [] }
    },
    {
      key: 'email', label: 'Email', type: 'email', enabled: true, required: false, weight: 3, group: 'Contact',
      description: 'Email address.',
      hints: { selectors: ['a[href^="mailto:"]', '[itemprop="email"]', '[class*="email"]'], jsonld: ['email'], regex: [] }
    },
    {
      key: 'address', label: 'Address', type: 'multiline', enabled: true, required: true, weight: 3, group: 'Address',
      description: 'Pura postal address.',
      hints: {
        selectors: ['[itemprop="address"]', '[itemprop="streetAddress"]', '[class*="address"]', '[class*="addr"]', '[class*="location"]', '[class*="office"]'],
        jsonld: ['address'], regex: []
      }
    },
    { key: 'city', label: 'City', type: 'text', enabled: true, required: false, weight: 1, group: 'Address',
      description: 'Sheher / locality.', hints: { selectors: ['[itemprop="addressLocality"]'], jsonld: ['addressLocality'], regex: [] } },
    { key: 'state', label: 'State', type: 'text', enabled: true, required: false, weight: 1, group: 'Address',
      description: 'Rajya / state.', hints: { selectors: ['[itemprop="addressRegion"]'], jsonld: ['addressRegion'], regex: [] } },
    { key: 'pincode', label: 'Pincode / ZIP', type: 'text', enabled: true, required: false, weight: 1, group: 'Address',
      description: '6-digit Indian pincode ya ZIP.', hints: { selectors: ['[itemprop="postalCode"]'], jsonld: ['postalCode'], regex: [] } },
    { key: 'country', label: 'Country', type: 'text', enabled: false, required: false, weight: 1, group: 'Address',
      description: 'Desh.', hints: { selectors: ['[itemprop="addressCountry"]'], jsonld: ['addressCountry'], regex: [] } },
    { key: 'website', label: 'Website', type: 'url', enabled: true, required: false, weight: 1, group: 'Digital',
      description: 'Business ki website / page URL.', hints: { selectors: ['[itemprop="url"]', 'a[class*="website"]'], jsonld: ['url'], regex: [] } },
    { key: 'social', label: 'Social / LinkedIn', type: 'url', enabled: false, required: false, weight: 1, group: 'Digital',
      description: 'LinkedIn, Instagram, Facebook, X profile link.', hints: { selectors: ['a[href*="linkedin.com"]', 'a[href*="instagram.com"]', 'a[href*="facebook.com"]'], jsonld: ['sameAs'], regex: [] } },
    { key: 'category', label: 'Category / Industry', type: 'text', enabled: false, required: false, weight: 1, group: 'Business',
      description: 'Business category ya industry.', hints: { selectors: ['[class*="category"]', '[class*="industry"]', '[class*="tag"]'], jsonld: ['@type', 'category'], regex: [] } },
    { key: 'rating', label: 'Rating / Reviews', type: 'text', enabled: false, required: false, weight: 1, group: 'Business',
      description: 'Google/website rating aur review count.', hints: { selectors: ['[itemprop="ratingValue"]', '[class*="rating"]'], jsonld: ['ratingValue', 'reviewCount'], regex: [] } },
    { key: 'notes', label: 'Notes', type: 'multiline', enabled: false, required: false, weight: 0, group: 'Meta',
      description: 'Aapke apne notes (extension edit karne deta hai).', hints: { selectors: [], jsonld: [], regex: [] } }
  ];

  /* Columns that always exist and are not user-editable. */
  const SYSTEM_FIELDS = [
    { key: 'sourceUrl', label: 'Source URL', type: 'url' },
    { key: 'pageTitle', label: 'Page Title', type: 'text' },
    { key: 'scrapedAt', label: 'Scraped At', type: 'text' }
  ];

  const DEFAULT_SETTINGS = {
    schemaVersion: 1,
    fields: JSON.parse(JSON.stringify(DEFAULT_FIELDS)),
    scrape: {
      maxRecords: 200,
      dedupe: true,
      autoScroll: false,
      includeHiddenText: false,
      deepScan: true,          // scan tables, JSON-LD, microdata, meta
      onlyVisible: true
    },
    output: {
      format: 'xlsx',
      includeHeader: true,
      delimiter: ',',
      fileNameTemplate: 'leadharvest-{domain}-{date}',
      pdfPaper: 'a4'
    },
    ai: {
      mode: 'local',           // off | local | cloud
      provider: 'sarvam',      // sarvam | openai | groq | custom
      baseUrl: 'https://api.sarvam.ai/v1/chat/completions',
      model: 'sarvam-105b',
      apiKey: '',
      autoSuggest: true
    },
    logging: { enabled: true, verbose: false, redactPII: true, maxEntries: 800 },
    privacy: { blockLocalhost: true }
  };

  const PROVIDER_PRESETS = {
    sarvam: { baseUrl: 'https://api.sarvam.ai/v1/chat/completions', model: 'sarvam-105b', keyHint: 'Sarvam AI dashboard se API key' },
    openai: { baseUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', keyHint: 'platform.openai.com se API key' },
    groq: { baseUrl: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', keyHint: 'console.groq.com se API key' },
    custom: { baseUrl: '', model: '', keyHint: 'Koi bhi OpenAI-compatible /chat/completions endpoint' }
  };

  function deepMerge(base, patch) {
    if (Array.isArray(base)) return Array.isArray(patch) ? patch : base;
    if (base && typeof base === 'object' && patch && typeof patch === 'object') {
      const out = Object.assign({}, base);
      for (const k of Object.keys(patch)) out[k] = deepMerge(base[k], patch[k]);
      return out;
    }
    return patch === undefined ? base : patch;
  }

  /* Merge stored settings onto defaults, and always keep every default field
     (so a field added in a later version is not lost for existing users). */
  function normalizeSettings(stored) {
    const s = deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), stored || {});
    const byKey = new Map();
    (s.fields || []).forEach(f => { if (f && f.key) byKey.set(f.key, f); });
    const merged = DEFAULT_FIELDS.map(def => {
      const saved = byKey.get(def.key);
      if (!saved) return JSON.parse(JSON.stringify(def));
      return deepMerge(JSON.parse(JSON.stringify(def)), {
        label: saved.label, type: saved.type, enabled: saved.enabled,
        required: saved.required, weight: saved.weight, description: saved.description,
        hints: saved.hints, custom: saved.custom
      });
    });
    /* keep user-created custom fields that are not in DEFAULT_FIELDS */
    (s.fields || []).forEach(f => {
      if (f && f.key && !merged.some(m => m.key === f.key)) merged.push(f);
    });
    s.fields = merged;
    return s;
  }

  function enabledFields(settings) {
    return (settings.fields || []).filter(f => f.enabled !== false);
  }

  function newFieldKey(label) {
    return 'cf_' + String(label || 'field').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'cf_field';
  }

  const api = {
    FIELD_TYPES, DEFAULT_FIELDS, SYSTEM_FIELDS, DEFAULT_SETTINGS, PROVIDER_PRESETS,
    deepMerge, normalizeSettings, enabledFields, newFieldKey
  };

  root.LeadHarvestSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
