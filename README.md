# LeadHarvest — Website Data Collector

Browser extension (Chrome, Edge, Brave, Firefox) jo kisi bhi website se **contact details** — naam,
phone, email, designation, company, address — nikaal kar aapke device par locally save karta hai, aur
unhe **Excel, CSV, PDF, TXT, Notes (.md), JSON** me export karta hai. Sab kuch browser ke andar chalta
hai: koi server nahi, koi account nahi, koi telemetry nahi.

**Version 1.2.0** · Manifest V3 · Chrome 121+ / Firefox 140+ · zero external dependencies
(Excel aur PDF writer isi project me likhe hain)

- **Download:** https://github.com/merry8989-uk/leadharvest/releases/latest
- **Landing page / feature docs:** https://merry8989-uk.github.io/leadharvest/ (`docs/index.html`)
- **Privacy policy:** https://merry8989-uk.github.io/leadharvest/privacy.html (`docs/privacy.html`)
- Source repository: https://github.com/merry8989-uk/leadharvest
- Security / AMO audit report: `AUDIT.md`
- Audit chalaane ke liye: `node tools/audit.js .`

---

## 1. Install

**Chrome / Edge / Brave / Opera**

1. `leadharvest-extension-v1.1.0.zip` extract karein.
2. `chrome://extensions` (Edge: `edge://extensions`) kholein.
3. **Developer mode** ON karein → **Load unpacked** → extracted folder chunein (jisme `manifest.json` ho).
4. Icon ko toolbar par pin kar lein.

**Firefox 140+**

1. `about:debugging#/runtime/this-firefox` kholein.
2. **Load Temporary Add-on** → extracted folder ka `manifest.json` chunein.
3. Yeh install Firefox restart tak rehta hai; permanent install ke liye addons.mozilla.org par signed
   build chahiye (process `AUDIT.md` §6 me hai).

**Phone par:** Chrome for Android extensions support nahi karta. Kiwi Browser jaise Chromium browser me
Firefox build chalta hai, ya desktop par scrape karke exported file phone par bhej dein.

---

## 2. Use

1. Website kholein — contact page, team page, business listing, directory.
2. Toolbar icon → **"Is page se contact data scrape karein"** (ya right-click → LeadHarvest).
3. Popup batata hai: kitne records mile, kaunse fields, page type, kitne ms lage.
4. **Dashboard** → *Data* tab me records; format chunein → **Export** → file `Downloads` me.

Lazy-load pages ke liye Settings me *"Scrape se pehle page auto-scroll karo"* ON karein.

---

## 3. Data kaise nikalta hai

| # | Mode | Kab | Kya hota hai |
|---|------|-----|--------------|
| 1 | **Table** | Header wali table (Name / Phone / Email) | Har row = 1 record, columns synonyms se match hote hain |
| 2 | **Card / listing** | Team page, directory, repeated blocks | Har card = 1 record |
| 3 | **Single page** | Contact page, profile, business site | Pura page = 1 record |
| 4 | **JSON-LD entities** | Structured data wala page | Har Person/Organization = 1 record |

Har field ke andar priority: **JSON-LD → microdata → `tel:`/`mailto:` links → CSS selectors → regex →
heuristics**. Har value ke saath confidence score save hota hai.

---

## 4. Fields

| Field | Kahan se |
|---|---|
| Full Name | `Person.name`, `[itemprop=name]`, headings, card titles |
| Designation | `jobTitle`, `[class*=designation\|role\|position]`, 97-role keyword list |
| Company | `Organization.name`, `legalName`, `[class*=company]`, `og:site_name`, page title |
| Phone | `tel:`/WhatsApp links, `telephone`, 6 regex families, E.164 normalise |
| Email | `mailto:`, `email`, regex + junk filter |
| Address | `PostalAddress` (joined), `[itemprop=address]`, `[class*=address\|location]`, pincode detection |
| City / State / Pincode / Country | JSON-LD address parts + comma/pincode parsing (39 Indian states list) |
| Website | `url`, canonical, page origin |
| Social / LinkedIn | `sameAs`, domain-filtered links |
| Category / Industry | `@type`, `[class*=category]`, meta |
| Rating / Reviews | `ratingValue`, `reviewCount` |
| Notes | Aap likhte hain (cell edit) |
| Custom field | Aapka selector / regex / JSON-LD key |
| Source URL / Page title / Scraped at | Automatic |

---

## 5. Data structure (Schema tab)

- Field **on/off**, **label** rename, **type**, **required**, **weight**
- **Advanced**: CSS selectors (per line), regex (capture group 1), JSON-LD keys
- **Pick element from a page** — site par click karke selector capture
- **+ Custom field**, **Reset**, **Export/Import schema JSON**
- Presets: Phone book · B2B leads · Sab kuch · Directory

---

## 6. AI advisor

Page signals (JSON-LD, tel/mailto links, tables, page type, address text) dekh kar batata hai kaunse
fields zaroori hain — reason ke saath.

- **Local mode (default)** — rule engine, offline, koi key nahi, koi data bahar nahi.
- **Cloud mode (optional)** — Sarvam AI / OpenAI / Groq / koi bhi OpenAI-compatible endpoint, aapki key.
  Sirf page ka chhota summary jata hai, pura HTML nahi.

---

## 7. Export

| Format | File | Best for |
|---|---|---|
| Excel | `.xlsx` | Sort/filter, CRM import (freeze header + autofilter) |
| CSV | `.csv` | Google Sheets, Zoho, HubSpot (UTF-8 BOM, Hindi safe) |
| PDF | `.pdf` | Client ko bhejna, print (A4/Letter, paginated) |
| TXT | `.txt` | Reading, WhatsApp paste |
| Notes | `.md` | Notion, Obsidian, Keep |
| JSON | `.json` | Apne scripts / DB |
| HTML | `.html` | Browser me print → PDF (Devanagari ke liye best) |
| Clipboard | — | Tab-separated paste |

File name template: `{domain}`, `{date}`, `{time}`, `{count}`.

---

## 8. Local data, history, logs

- **Records** — `storage.local`, max 5,000, device par.
- **History** — 500 entries: kab, kaunse page se, method, count, duration, export format. Kisi bhi entry
  ko dobara export ya delete kar sakte hain.
- **Logs** — 15 categories, 57 event types: lifecycle, scraping session, field extraction
  (success/missing counts per field), data quality, duplicates, website compatibility, collection,
  export, storage, API, performance, errors, UI interactions. Email/phone default me redact.
- **Diagnostics panel** (Settings) — 9 live counters (sessions, extraction success rate, field
  completeness, duplicates, exports, errors, avg timing), capability report, aur bundle export.

### Share logs with developer

Settings → Diagnostics → note likhein (optional) → **Share logs with developer**.

1. Bundle banta hai (JSON + TXT) — **sirf counts, hostname, timings, technical signals**. Koi email,
   phone, naam ya page text nahi.
2. Phone / Windows par system share sheet file ko **seedha attach** kar deta hai.
3. Warna file Downloads me save hoti hai aur mail compose window pre-filled khulti hai
   (`br19shc39@gmail.com`) — bas attach kar dein.
4. "Gmail me kholo" button web compose kholta hai; "Download diagnostics / report" se manual export.

Kuch bhi tab tak nahi jata jab tak aap button na dabayein — aur mail aapke apne mail client se jati hai.

---

## 9. Privacy & legal

- Koi network call nahi (cloud AI off hone par), koi analytics nahi, koi account nahi.
- Site ke **Terms of Service** aur `robots.txt` ka khayal rakhein.
- Contact details personal data hain — India me **DPDP Act 2023** lagta hai: purpose limitation,
  accuracy, deletion. Jitna chahiye utna hi collect karein.
- Poori policy: `docs/privacy.html`.

---

## 10. Troubleshooting

| Problem | Solution |
|---|---|
| "Scrape nahi hua" | Page reload karein; `chrome://` ya Web Store pages par nahi chalta |
| 0 records | Page scroll karein / detail page kholein / Schema me fields ON hain dekhein |
| Phone nahi mila | Number image ya JS-load me hai — auto-scroll ON karein, ya custom regex dein |
| Address adhoora | `[class*=address]` selector add karein, ya element picker use karein |
| PDF me Hindi `?` ban gaya | HTML export → print se PDF banayein (browser fonts) |
| Kisi site par field nahi mila | Settings → Diagnostics → note likh kar **Share logs with developer** — bundle me kaunse field miss hue aur site ka hostname chala jayega |
| Excel number text ban gaya | Jaan-boojh kar — leading zero bachane ke liye |

---

## 11. File structure

```
leadharvest/
├── manifest.json          # cross-browser MV3 (Chrome service worker + Firefox event page)
├── README.md
├── AUDIT.md               # security audit + AMO submission checklist
├── STORE.md               # AMO + Chrome Web Store listing copy (paste-ready)
├── LICENSE                # All rights reserved (MIT me badalna ho to bata dein)
├── build.sh               # dist/ zips banata hai
├── icons/                 # 16/32/48/128 PNG
├── docs/                  # GitHub Pages site: index.html, privacy.html, assets/ (+ screenshots)
├── tools/audit.js         # static audit (permissions, remote code, XSS sinks, packaging)
└── src/
    ├── background.js      # storage, scrape orchestration, history, logs
    ├── content.js         # extraction engine
    ├── popup.html/js      # toolbar popup
    ├── dashboard.html/js  # Data / Schema / AI / Settings / History / Logs / Help
    ├── print.html/js      # print view (HTML → PDF)
    ├── ui.css
    └── lib/
        ├── schema.js      # field registry + default settings
        ├── telemetry.js   # event catalog, redaction, metrics, quality scoring
        ├── diagnostics.js # bundle + TXT report + mail compose helpers
        ├── exporter.js    # CSV / TXT / MD / JSON / HTML
        ├── xlsx.js        # dependency-free .xlsx writer
        ├── pdf.js         # dependency-free PDF writer
        ├── advisor.js     # local rules + optional cloud AI
        └── download.js    # file save + clipboard
```

Permissions: `storage`, `unlimitedStorage`, `scripting`, `activeTab`, `downloads`, `contextMenus`,
host `<all_urls>`. Koi remote code nahi, koi `eval` nahi, koi library nahi. Content script
automatically inject nahi hota — sirf click par. Telemetry local hai; "Share logs" user ke apne mail
client se jata hai, extension khud kuch upload nahi karta.

---

## 12. Screenshots

`docs/assets/shot-*.png` — ye asli UI ke renders hain (headless Chromium me extension ke apne HTML se,
demo data ke saath), mockups nahi. Dobara banane ke liye: `node shots.js` (source zip me shaamil hai).

---

## 13. Build & verify

```bash
bash build.sh                      # dist/ me extension + source zip
node tools/audit.js .              # static audit (0 fail hona chahiye)
npx web-ext@latest lint --source-dir .   # Mozilla ka addons-linter (AMO wahi chalata hai)
```

---

## 14. Aage kya add ho sakta hai

Multi-page crawl (list → detail), CRM push (HubSpot/Zoho/Sheets), email/phone validation, duplicate
merge UI, scheduled re-scrape, CSV column mapping, cloud sync.
