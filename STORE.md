# Store listing pack — LeadHarvest v1.2.0

Copy-paste text for **Mozilla Add-ons (AMO)** and the **Chrome Web Store**. Everything below matches
the shipped build; nothing here promises a feature the code does not have.

---

## 1. Identity

| Field | Value |
|---|---|
| Name | `LeadHarvest — Website Data Collector` |
| Version | `1.3.2` |
| Add-on ID (AMO, permanent) | `leadharvest@br19shc39@gmail.com` |
| Homepage | https://merry8989-uk.github.io/leadharvest/ |
| Privacy policy URL | https://merry8989-uk.github.io/leadharvest/privacy.html |
| Support email | br19shc39@gmail.com |
| Source code | https://github.com/merry8989-uk/leadharvest |
| Licence | **MIT** — on AMO just pick **MIT License** from the list, no custom text needed. The repo `LICENSE` file is the standard MIT text. |
| Category | AMO: *Productivity* · CWS: *Productivity / Tools* |
| Tags | contacts, scraper, lead generation, export, excel, csv, pdf, local-first, privacy |

---

## 2. Short summary

**AMO summary (max 250 characters):**

```
Extract names, phones, emails, designations, companies and addresses from the page you are on. Choose your own fields, keep everything on your device, and export to Excel, CSV, PDF, TXT or Notes. No account, no server, no telemetry.
```

**Chrome Web Store short description (max 132 characters):**

```
Scrape contact details from any page, structure them your way, keep them local, export to Excel, PDF, CSV or Notes.
```

---

## 3. Full description

```markdown
LeadHarvest turns the page you are reading into a clean contact list — on your own device.

Open a contact page, a team page, a business listing or a supplier directory, click the toolbar icon,
and the extension pulls out names, phone numbers, emails, designations, companies and postal
addresses. Everything is stored locally in your browser. There is no account, no server and no
telemetry.

HOW IT READS A PAGE
Most scrapers depend on one CSS selector and break when a site changes. LeadHarvest looks at four
independent sources and keeps whichever one has data:
• Tables — a real table becomes one record per row, with column headers matched against a synonym list
• Repeated cards — team pages, listings and directories become one record per block
• Single page — a contact page or small business site becomes one record
• Structured data — every schema.org Person or Organization entity becomes its own record
Inside each field the fallbacks run in order: JSON-LD → microdata → tel:/mailto: links → your CSS
selectors → regex → heuristics. Every value carries a confidence score.

FIFTEEN FIELDS, PLUS YOUR OWN
Name, designation, company, phone, email, address, city, state, pincode, country, website, social
profiles, category, rating and notes — plus any custom field you define with a selector or a regex.
Phone numbers are normalised (+91 98765 43210, 098765 43210 and +91-98765-43210 all become one form)
and junk emails are filtered out.

SEARCH, FILTER AND SORT
Free-text search plus field filters — has email, has phone, has address, has company, city contains,
company contains, or a minimum confidence — then sort any column, select everything that matches, and
export only that. A confidence threshold in Settings keeps weak records out of the list in the first
place. Alt+Shift+L scrapes the current page from the keyboard.

YOUR DATA STRUCTURE
Decide what a record looks like: turn fields on or off, rename the column headers, change the type,
mark fields required, set their weight. When automatic detection misses something, click "Pick element
from a page" and click the element yourself — the CSS selector is captured and saved. Export the whole
schema as JSON and reuse it on another machine.

AI ADVISOR
A local rule engine reads the page's signals and tells you which fields matter here, with a reason for
each. It runs offline with no API key. A cloud mode exists if you want a second opinion, using your own
key — it is off by default and sends only a short page summary, never the HTML or your records.

EXPORT
Excel with frozen headers and autofilter, CSV with a UTF-8 BOM so non-Latin text survives, a paginated
PDF, plain TXT, Markdown notes, JSON, a print-ready HTML view, or the clipboard. Files are written by
the extension itself and land in your Downloads folder.

LOCAL HISTORY AND DIAGNOSTICS
Every scrape is logged with time, page, method, record count and duration, and any past scrape can be
re-exported. Fifteen categories of diagnostic events — extraction success per field, data quality,
duplicates, website compatibility, exports, storage, errors, performance — are recorded as counts, never
as contact values. If something goes wrong, "Share logs with developer" builds a bundle and opens a
pre-filled email to the developer. Nothing is sent unless you press that button.

WHAT IT DOES NOT DO
No crawling across many pages, no logging into sites, no bypassing paywalls or captchas, no bulk email
or WhatsApp sending, and no uploading of your data to us. It reads one page you are looking at, when
you ask it to.

Use it responsibly: respect site terms and robots.txt, and remember that contact details are personal
data — in India the DPDP Act 2023 gives people rights over theirs.
```

---

## 4. Screenshots (upload in this order)

| # | File | Caption |
|---|---|---|
| 1 | `docs/assets/shot-dashboard-data.png` | Every record, with its fields and source, editable in place |
| 2 | `docs/assets/shot-dashboard-schema.png` | Choose your own fields, selectors and regex |
| 3 | `docs/assets/shot-dashboard-diagnostics.png` | Diagnostics and “Share logs with developer” |
| 4 | `docs/assets/shot-popup.png` | One tap to read the page you are on |
| 5 | `docs/assets/shot-dashboard-history.png` | What was scraped, when, and how long it took |

AMO wants 1–6 images, 1280×800 or larger; the dashboard shots are 2720×1760. The popup shot is
1116×900 — crop or use it last.

---

## 5. Reviewer notes (paste into the “Notes to reviewer” field)

```
LeadHarvest extracts contact details from the page the user is currently viewing and stores them
locally. It has no backend: the extension never uploads anything.

HOW TO TEST IN A MINUTE
1. Open any page with contact information (a business "Contact us" page, or a supplier directory table).
2. Click the toolbar icon → "Is page se contact data scrape karein".
3. The popup reports how many records were found; click "Dashboard" to see them, then pick a format and
   press Export. The file is written to Downloads.
4. Dashboard → Settings → Diagnostics shows what was recorded and has the "Share logs with developer"
   button (opens the user's own mail client with a pre-filled message; nothing is sent automatically).

PERMISSIONS
• storage / unlimitedStorage — records, history, logs and settings must survive a restart; a large list
  exceeds the default quota.
• scripting + activeTab — the extractor is injected into the active page only when the user clicks
  scrape or picks an element. The manifest declares no content_scripts, so nothing runs on a page until
  the user acts.
• downloads — saves the generated XLSX/CSV/PDF/TXT/MD/JSON file.
• contextMenus — a single right-click entry.
• <all_urls> — the extension's purpose is reading whichever page the user is on, so any site can be the
  target. Users can narrow this in the browser's extension settings.

DATA COLLECTION
required: ["none"] — the core never transmits anything.
optional: ["websiteContent", "browsingActivity", "technicalAndInteraction"] — two opt-in features:
(a) the cloud AI advisor, which sends a short page summary to an endpoint the user configures with
    their own key, and
(b) "Share logs with developer", which puts hostnames and technical counters into a bundle that the
    user then sends through their own mail client.
Both are off until the user acts. No email address, phone number, contact name or page text is ever
logged or transmitted.

CODE
No eval, no new Function, no remote scripts, no obfuscation, no third-party libraries, no analytics.
Excel and PDF writers are written in-house. All JS is human-readable, so no source submission is needed.
A static audit script is included: node tools/audit.js .   (result: 28 pass, 2 warnings, 0 failures)
```

---

## 6. “What’s new” for this version

```
v1.3.2
• Version bump for a fresh submission; no behaviour change. Upload either
  leadharvest-extension-v1.3.2.zip (Chrome + Firefox, one manifest) or
  leadharvest-firefox-v1.3.2.zip (Firefox-only manifest, zero validation warnings).

v1.3.1
• No innerHTML sinks left: every view is mounted from a parsed fragment, which clears the
  addons-linter "unsafe assignment to innerHTML" warnings (14 of them in v1.3.0)
• Firefox for Android minimum raised to 142, where data_collection_permissions is understood
• The self-hosted build (which carries gecko.update_url) is now named SELFHOST-ONLY so it cannot
  be mistaken for the AMO upload

v1.3.0
• Field filters (has email / phone / address / company, city, company, minimum confidence)
• Confidence threshold for what gets saved, and the Alt+Shift+L keyboard shortcut
• CSV export neutralises spreadsheet formulas so scraped text can never execute in Excel
• Faster dashboard: refreshes on real changes instead of polling, and never interrupts a cell edit
• Phone numbers are de-duplicated across country-code formats (+91 98765 43210 = 9876543210)

v1.2.0 — first public release: Chrome 121+ and Firefox 140+, 15 fields, four extraction strategies,
eight export formats, local history, diagnostic telemetry with a share-to-developer flow.
```

---

## 7. Submission checklist

- [ ] `npx web-ext@latest lint --source-dir .` → 0 errors
- [ ] `node tools/audit.js .` → 0 failures
- [ ] `bash build.sh` → `dist/leadharvest-extension-v1.3.2.zip` (manifest at the zip root)
- [ ] Upload **`leadharvest-extension-v1.3.2.zip`** to AMO → *On this site* (listed). Never upload `leadharvest-SELFHOST-ONLY-*.zip`: it carries `gecko.update_url`, which AMO rejects for listed add-ons.
- [ ] Optional: upload **`leadharvest-firefox-v1.3.2.zip`** instead if you want a validation with **zero** warnings — it is the same code with `background.service_worker` removed (Firefox does not need it; Chrome does). Keep the normal zip for Chrome/Edge users.
- [ ] Fill the fields above, upload the five screenshots, set the licence to **MIT License**
- [ ] Paste §5 into the reviewer notes
- [ ] After signing, replace the “Download” button on the site with the AMO install link
