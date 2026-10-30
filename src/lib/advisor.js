/* LeadHarvest — field advisor.
   "local" mode is a deterministic rule engine (works offline, no key).
   "cloud" mode optionally asks an OpenAI-compatible endpoint for a second opinion. */
(function (root) {
  'use strict';
  const SCHEMA = root.LeadHarvestSchema;

  const MUST_HAVE = ['name', 'phone', 'email', 'company', 'designation', 'address'];

  function localSuggest(ctx) {
    const signals = ctx.signals || {};
    const pageType = ctx.pageType || 'general';
    const fields = SCHEMA.DEFAULT_FIELDS;
    const recommended = [];
    const notes = [];
    let score = 0;

    const add = (key, priority, reason) => {
      const f = fields.find(x => x.key === key);
      if (!f) return;
      recommended.push({ key, label: f.label, priority, reason });
    };

    if (signals.jsonLd > 0) {
      score += 3;
      notes.push('Page par ' + signals.jsonLd + ' structured-data (JSON-LD) block mile — yeh sabse bharosemand source hai, name/phone/email/address seedha wahin se aayenge.');
      add('name', 1, 'JSON-LD me entity name structured form me hota hai.');
      add('phone', 1, 'JSON-LD telephone field reliable hota hai.');
      add('address', 2, 'PostalAddress object milta hai to pura address ek saath mil jata hai.');
    }
    if (signals.telLinks > 0) {
      score += 2;
      add('phone', 1, signals.telLinks + ' tel: link mile — number verified format me hai.');
    } else if (pageType === 'contact' || pageType === 'directory') {
      add('phone', 2, 'Contact/directory page hai, phone text me hi ho sakta hai — regex se nikalna padega.');
    }
    if (signals.mailLinks > 0) {
      score += 2;
      add('email', 1, signals.mailLinks + ' mailto: link mile — email confirmed.');
    }
    if (signals.tables > 0) {
      score += 2;
      notes.push(signals.tables + ' table mile — table mode se ek saath kaafi records nikal sakte hain. Company + designation columns ko ON rakhein.');
      add('company', 2, 'Table ke columns me company ka column hota hai.');
      add('designation', 3, 'Directory tables me role/designation column common hai.');
      add('city', 3, 'Address column se city alag karna useful hota hai.');
    }
    if (pageType === 'directory') {
      score += 2;
      notes.push('Yeh directory/listing jaisa page lagta hai — multiple records banenge. "Max records" ko 200+ rakhein aur dedupe ON rakhein.');
      add('category', 3, 'Directory pages par category/industry milta hai.');
      add('rating', 4, 'Listing par rating/reviews bhi mil sakte hain.');
      add('city', 3, 'Location filter ke liye city zaroori hai.');
    }
    if (pageType === 'team' || pageType === 'profile') {
      score += 1;
      notes.push('Team/profile page lagta hai — har card ek person hai. Name + designation + email ka combination best hai.');
      add('designation', 2, 'Team cards me role likha hota hai.');
      add('social', 3, 'Profile pages par LinkedIn/Instagram links milte hain.');
    }
    if (signals.hasAddressText) {
      add('address', 2, 'Page par pincode ke saath address jaisa text mila.');
      add('city', 3, 'Address se city alag karke aap region-wise filter kar sakte hain.');
      add('state', 4, 'State field se territory assignment aasan hota hai.');
      add('pincode', 4, 'Pincode se area mapping hoti hai.');
    }
    if (signals.forms > 0) {
      notes.push('Page par form hai — enquiry form ke paas owner ka email/phone usually likha hota hai.');
      add('email', 3, 'Form ke aas-paas contact email milta hai.');
    }
    if (signals.textLength < 400) {
      notes.push('Page ka text bahut kam hai — content JavaScript se load ho raha hoga. Scrape se pehle page ko scroll kar lein.');
    }

    /* always remind about the basics for a contact list */
    MUST_HAVE.forEach(k => {
      if (!recommended.some(r => r.key === k)) add(k, 5, 'Contact list ka basic field — isko ON rakhein.');
    });

    const seen = new Set();
    const dedup = recommended.filter(r => (seen.has(r.key) ? false : seen.add(r.key)));
    dedup.sort((a, b) => a.priority - b.priority);

    return {
      mode: 'local',
      pageType,
      confidence: Math.min(0.95, 0.3 + score * 0.08),
      recommended: dedup,
      notes,
      sampleFields: dedup.filter(r => r.priority <= 3).map(r => r.key)
    };
  }

  async function cloudSuggest(ctx, settings) {
    const ai = settings.ai || {};
    if (!ai.apiKey || !ai.baseUrl) throw new Error('AI key/base URL set nahi hai (Settings → AI).');
    const local = localSuggest(ctx);
    const prompt =
      'You are a data-extraction advisor for a browser extension that builds contact lists from web pages. ' +
      'Given page signals, reply with STRICT JSON only: {"recommended":[{"key":"<field key>","reason":"<=15 words","priority":1-5}],"extraFields":[{"label":"...","hint":"css selector or regex"}],"warnings":["..."]}. ' +
      'Available field keys: ' + SCHEMA.DEFAULT_FIELDS.map(f => f.key).join(', ') + '. ' +
      'Page signals: ' + JSON.stringify({ pageType: ctx.pageType, signals: ctx.signals, url: ctx.url, sample: (ctx.sample || '').slice(0, 1200) });
    const res = await fetch(ai.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ai.apiKey },
      body: JSON.stringify({
        model: ai.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You return only valid JSON, no markdown fences.' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!res.ok) throw new Error('AI request failed: HTTP ' + res.status);
    const data = await res.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    const jsonText = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(jsonText.slice(jsonText.indexOf('{'), jsonText.lastIndexOf('}') + 1));
    const labels = new Map(SCHEMA.DEFAULT_FIELDS.map(f => [f.key, f.label]));
    return {
      mode: 'cloud',
      pageType: ctx.pageType,
      confidence: local.confidence,
      recommended: (parsed.recommended || []).filter(r => labels.has(r.key)).map(r => ({
        key: r.key, label: labels.get(r.key), priority: r.priority || 3, reason: r.reason || ''
      })),
      extraFields: parsed.extraFields || [],
      warnings: parsed.warnings || [],
      notes: local.notes,
      sampleFields: local.sampleFields
    };
  }

  root.LeadAdvisor = { localSuggest, cloudSuggest, MUST_HAVE };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LeadAdvisor;
})(typeof globalThis !== 'undefined' ? globalThis : this);
