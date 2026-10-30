LeadHarvest — store assets (v1.3.2)
===================================

ICON
  icon-128.png      128×128  ← upload this as the add-on icon on AMO / Chrome Web Store
  icon-512.png      512×512  ← for the homepage, press kits, social previews
  icon-256.png      256×256
  icon-48.png        48×48   ← used by the browser's add-ons page
  icon-32.png        32×32
  icon-16.png        16×16   ← toolbar

  Same artwork as the icon inside the extension (icons/icon128.png), re-rendered
  from source at every size instead of being upscaled.

SCREENSHOTS — all exactly 1280×800 (16:10), the size AMO and the Chrome Web Store expect
  shot-1-data.png         Data tab: every record, editable, filters and export bar
  shot-2-structure.png    Data structure: fields, types, selectors, regex
  shot-3-diagnostics.png  Diagnostics: live counters and "Share logs with developer"
  shot-4-history.png      History: what was scraped, when, and how long it took
  shot-5-popup.png        Toolbar popup (composed slide)

  Upload them in this order. They are real renders of the extension with demo data —
  not mockups. Regenerate with:
      node tools/store-shots.js && python3 tools/compose-store.py
  (needs puppeteer-core and a local Chromium; see tools/)

LISTING TEXT
  ../STORE.md holds the name, summary, description, category, tags, licence and the
  reviewer notes — everything the submission form asks for.
