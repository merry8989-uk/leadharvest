# Audit & Firefox (AMO) readiness — LeadHarvest v1.3.2

Date: 30 October 2026 · Auditor: automated static audit + manual code review
Scope: full source tree (`manifest.json`, `src/**`, `icons/**`) — 24 files, ~230 KB

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
   `["none"]`. Two optional, user-initiated features do transmit something, and both are declared:
   - `websiteContent` — the cloud AI advisor sends a short page summary (title + technical signals,
     never the HTML or the scraped records) to an endpoint the user configures with their own key.
   - `browsingActivity` + `technicalAndInteraction` — "Share logs with developer" puts site hostnames
     and technical counters into a bundle that the user then sends through their own mail client.
   Nothing is transmitted until the user acts, and the extension itself never uploads anything.
   Manifest, privacy policy and this document state the same thing.

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
| `update_url` on AMO | A self-hosted build was uploaded to AMO and rejected: `update_url` is not allowed for Mozilla-hosted add-ons | Fixed in tooling — the normal build omits it; the self-hosted artefact is named `leadharvest-SELFHOST-ONLY-*.zip` and `build.sh` prints a warning |
| Dynamic regex | User-supplied patterns are compiled with `new RegExp` | Accepted — input comes from the user's own schema, not from a page; bad patterns are caught and logged |
| `innerHTML` for large tables | Used to render thousands of rows | Accepted — all values escaped; no user-controlled markup reaches the sink |
| API key storage | Stored in `storage.local` in plain text | Accepted and documented — extension storage is not a secret store; the privacy policy says to treat the key like a saved password |
| Log redaction | Emails/phones could land in logs | Fixed — redacted by default (`[email]`, `[number]`) |
| Dedupe | Re-scraping duplicated records | Fixed — dedupe on phone + email + name + company, on by default; phone comparison now normalises country codes so `+91 98765 43210` and `9876543210` collapse to one |
| CSV formula injection | A scraped value like `=HYPERLINK(...)` or `+cmd\|calc` would execute when the CSV was opened in Excel or LibreOffice | Fixed — `=`, `@`, a leading tab/CR, and `+`/`-` followed by letters are prefixed with an apostrophe; plain numbers and phone numbers are untouched |
| Dashboard polling | A refresh every 8 s re-read every record and re-rendered the table, which could wipe a cell mid-edit | Fixed — refresh is driven by `storage.onChanged`, debounced, and skipped while a field has focus |
| Popup payload | The popup pulled every stored record just to show a count | Fixed — new `LH_GET_SUMMARY` returns counts; full records are fetched only when an export needs them |
| Blocked pages | Internal pages were only blocked when the localhost toggle was on | Fixed — non-http(s) and extension-store pages are always refused |
| Metrics growth | `metrics.sites` grew without limit | Fixed — capped at the 200 most recently active hosts |
| `innerHTML` sinks | 21 assignments, 14 of which addons-linter reported as "unsafe assignment to innerHTML" | Fixed — `src/lib/dom.js` parses the (already escaped) markup in an inert document and imports the nodes; zero `innerHTML` assignments remain in the extension |
| Android manifest key | `data_collection_permissions` needs Firefox for Android 142, but `strict_min_version` said 140 | Fixed — `gecko_android.strict_min_version: "142.0"` |

**Not present, and worth stating for the record:** no `eval`, no `new Function`, no remote script or
style tags, no dynamic `import()` of a remote URL, no WebSocket, no `XMLHttpRequest`, no
obfuscation, no analytics SDK, no third-party library.

---

## 5a. Telemetry review (added in 1.2.0)

The extension records 57 event types across 15 categories. The design rule, enforced in three
places, is that an event carries **counts and status, never values**:

1. **Producers** pass counts and booleans — `fields: { email: { success: 32, missing: 18 } }`, never
   an address. The content script has no code path that puts a scraped value into an event.
2. **`LeadTelemetry.redact()`** runs over every event on the way into storage: emails → `[email]`,
   phone-shaped digit runs → `[number]`, anything matching `pass|secret|token|apikey|authorization|cookie`
   → `[redacted]`. Stacks are truncated to 8 frames and URLs reduced to origin + path.
3. **`LeadTelemetry.sanitizeUrl()`** reduces every URL to a hostname before it is stored, so a query
   string containing an email or a search term never lands in a log.

The diagnostics bundle is built from that store, so it inherits all three guarantees. A test asserts
that a scrape containing `info@example.com` and `+919876543210` produces a log store with neither
string present.

`AUDIT` §6 item 7 tells the reviewer this in one paragraph. Capability gaps are stated in the bundle
itself (`pagination`, `filters`, `backend_sync`, `database` are marked unsupported) rather than
faked.

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
| 1.3.2 | Licence changed to MIT at the maintainer's request, so the code can be used, modified and redistributed publicly. Version bump for a fresh AMO submission. Also fixed a stale `EXT_VERSION` constant in `telemetry.js` that had been reporting 1.2.0 in the diagnostics environment block since v1.3.0 — `env()` now takes the live manifest version, so it cannot drift again. |
| 1.3.1 | AMO validation response: every `innerHTML` assignment replaced with `LeadDOM.mount()` (parsed fragment, imported nodes) so the linter's 14 "unsafe assignment to innerHTML" warnings disappear; `gecko_android.strict_min_version` raised to 142.0 so `data_collection_permissions` is understood on Android; self-hosted build renamed `SELFHOST-ONLY` after an `update_url` rejection on AMO |
| 1.3.0 | Deep audit round: CSV formula-injection guard, phone-aware de-duplication, 2-row tables, non-http(s) pages always blocked, dashboard refresh without polling (no more interrupted cell edits), popup loads a summary instead of every record, bounded site metrics, log cap aligned with the UI, field filters, confidence threshold, Alt+Shift+L shortcut |
| 1.2.0 | Full diagnostic telemetry (57 event types, 15 categories), running metrics with the rates from the logging checklist, capability report, and a "Share logs with developer" flow that composes a pre-filled mail to the maintainer; data-collection declaration extended for the optional share |
| 1.1.0 | Cross-browser build (Firefox 140+ / Chrome 121+), data-collection declaration, no automatic content-script injection, escaping and `document.write` fixes, audit tooling |
| 1.0.0 | First Chrome release |
