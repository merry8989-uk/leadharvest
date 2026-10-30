# Audit & Firefox (AMO) readiness — LeadHarvest v1.1.0

Date: 30 October 2026 · Auditor: automated static audit + manual code review
Scope: full source tree (`manifest.json`, `src/**`, `icons/**`) — 21 files, ~180 KB

---

## 1. Result

| | |
|---|---|
| Static audit (`node tools/audit.js .`) | **28 pass · 2 warn · 0 fail** |
| Remote code / `eval` / `new Function` | none |
| Hardcoded credentials | none |
| Third-party libraries | none (Excel and PDF writers are written in-house) |
| Minified or obfuscated code | none — AMO source submission not required |
| Automatic content-script injection | none (injected only on user action) |
| Network egress | 1 site, opt-in only (`src/lib/advisor.js` → user-configured endpoint) |

The two warnings are deliberate and explained in §4. Nothing blocks submission.

Reproduce:

```bash
node tools/audit.js .                      # this report
npx web-ext@latest lint --source-dir .     # Mozilla's addons-linter, same rules AMO applies
```

> The official `addons-linter` could not be executed in the build sandbox used for this audit
> (WebAssembly instantiation is blocked there, so `undici` fails to load). Run the two commands
> above locally before uploading — they take about a minute and are the authoritative check.

---

## 2. What changed for Firefox

Firefox does not support `background.service_worker` in Manifest V3 (bug 1573659, still open); it
runs background scripts as an event page. Since Firefox 121 and Chrome 121, a **single manifest**
can declare both, and each browser picks the one it supports — so no separate builds are needed.

| Change | File(s) | Why |
|---|---|---|
| `background.scripts` + `background.service_worker` both declared | `manifest.json` | Firefox uses the event page, Chrome uses the worker |
| `importScripts()` guarded by a feature check | `src/background.js` | Exists in a worker, not in an event page; Firefox loads the schema via `background.scripts` |
| `browser.*` / `chrome.*` shim (`const api = …`) | all 6 scripts that touch the API | Firefox exposes promise-based `browser`, Chrome exposes `chrome`; the shim picks whichever exists |
| `browser_specific_settings.gecko.id` | `manifest.json` | Mandatory to sign a Manifest V3 add-on |
| `browser_specific_settings.gecko.data_collection_permissions` | `manifest.json` | Mandatory for new AMO submissions since 3 Nov 2025 |
| `strict_min_version: 140.0` | `manifest.json` | `data_collection_permissions` is only understood from Firefox 140 |
| `minimum_chrome_version: 121` | `manifest.json` | Before Chrome 121, the presence of `background.scripts` makes Chrome refuse to load the extension |
| `content_scripts` removed | `manifest.json` | Nothing is injected until the user clicks scrape — a narrower footprint and a shorter AMO review |
| `document.write()` replaced with DOM parsing | `src/print.js` | `document.write` is flagged by linters and behaves badly on strict CSP |
| All dynamic UI values HTML-escaped | `src/popup.js`, `src/dashboard.js` | Prevents a hostile page from injecting markup into the extension's own pages |

The extension was tested against a simulated Firefox event page (promise-only `browser` namespace,
no `importScripts`, no `chrome` global): scrape, settings, logging and the inject-then-retry path all
work. See `test-ff.js` in the source bundle.

---

## 3. Permissions — justification for the reviewer

| Permission | Justification |
|---|---|
| `storage` | Records, history, logs and settings must survive a browser restart. Local only. |
| `unlimitedStorage` | Up to 5,000 records exceed the default 5 MB quota; without this, saves fail silently on large lists. |
| `scripting` + `activeTab` | The extractor is injected into the active page **only** when the user clicks scrape or picks an element. |
| `downloads` | Saves the generated XLSX/CSV/PDF/TXT/MD/JSON file to the user's Downloads folder. |
| `contextMenus` | A single right-click entry ("scrape this page"). |
| `<all_urls>` host permission | The extension's purpose is reading whichever page the user is currently on; any site can be a target. No content script is registered, so nothing executes until the user acts. |

No permission is requested that is not used. There is no `webRequest`, no `cookies`, no `history`,
no `bookmarks`, no `tabs` permission, and no remote host permission.

---

## 4. The two warnings, in plain terms

1. **Broad host permission (`<all_urls>`).** Unavoidable for a scraper that works on arbitrary
   sites. Mitigated by removing automatic injection and by not requesting the `tabs` permission.
   A user who wants to narrow it can set "On specific sites" in the browser's extension settings.
2. **Data-collection declaration vs. code.** The core never transmits anything, so `required` is
   `["none"]`. The optional cloud AI advisor does send a short page summary (page title + technical
   signals, never the HTML or the scraped records) to an endpoint the user configures with their own
   key, so it is declared under `optional: ["websiteContent"]`. Both the manifest and the privacy
   policy state this consistently.

If AMO's validator rejects the `optional` key on submission, delete that one line — the `required:
["none"]` declaration remains correct for the default configuration.

---

## 5. Code review notes

**Data flow (default configuration).** Page → content script (isolated world) → in-memory records
→ `chrome.storage.local` → dashboard → generated file → Downloads folder. No network hop at any
point.

**Findings and resolutions**

| Area | Finding | Status |
|---|---|---|
| XSS in extension UI | Scraped values were interpolated into `innerHTML` | Fixed — every interpolation passes through `esc()`; verified by the audit's sink check |
| Popup messages | Error strings from pages were rendered as HTML | Fixed — escaped before display |
| `document.write` | Used to render the print view | Fixed — `DOMParser` + `importNode` |
| Dynamic regex | User-supplied patterns are compiled with `new RegExp` | Accepted — input comes from the user's own schema, not from a page; bad patterns are caught and logged |
| `innerHTML` for large tables | Used to render thousands of rows | Accepted — all values escaped; no user-controlled markup reaches the sink |
| API key storage | Stored in `storage.local` in plain text | Accepted and documented — extension storage is not a secret store; the privacy policy says to treat the key like a saved password |
| Log redaction | Emails/phones could land in logs | Fixed — redacted by default (`[email]`, `[number]`) |
| Dedupe | Re-scraping duplicated records | Fixed — dedupe on phone + email + name + company, on by default |

**Not present, and worth stating for the record:** no `eval`, no `new Function`, no remote script or
style tags, no dynamic `import()` of a remote URL, no WebSocket, no `XMLHttpRequest`, no
obfuscation, no analytics SDK, no third-party library.

---

## 6. AMO submission checklist

1. `npx web-ext lint --source-dir .` → expect **0 errors**. Warnings about `<all_urls>` are expected.
2. Zip the folder (manifest at the root of the zip, not inside a subfolder) — `bash build.sh` produces
   `dist/leadharvest-firefox.zip`.
3. Sign in at <https://addons.mozilla.org/developers/>, accept the Firefox Add-on Distribution Agreement.
4. **Submit a New Add-on** → choose *On this site* (listed) or *On your own* (self-distributed).
5. Upload the zip. The add-on ID `leadharvest@br19shc39.gmail.com` is already in the manifest and
   becomes permanent — do not change it later.
6. Fill the listing: name, summary (≤ 250 chars), description, category (*Productivity*), screenshots,
   licence, and the privacy-policy URL: https://merry8989-uk.github.io/leadharvest/privacy.html
7. In the reviewer notes, paste §3 and §4 above — permissions justification and the data-collection
   reasoning. This is the single biggest speed-up for review.
8. Source code: **not required** (no minification, no bundler). If asked, attach `leadharvest-source.zip`.
9. Signing normally completes within minutes for a clean, unminified add-on.

---

## 7. Known limitations (stated honestly)

- One page per scrape; there is no automatic crawl from a list page into detail pages.
- Contact details rendered as images, or behind a login/captcha, are not read.
- The built-in PDF writer covers Latin script only; use HTML → print for Indic scripts.
- Firefox installs from a file are temporary (`about:debugging`) until the add-on is signed.
- Chrome for Android does not support extensions.

---

## 8. Version history

| Version | Notes |
|---|---|
| 1.1.0 | Cross-browser build (Firefox 140+ / Chrome 121+), data-collection declaration, no automatic content-script injection, escaping and `document.write` fixes, audit tooling |
| 1.0.0 | First Chrome release |
