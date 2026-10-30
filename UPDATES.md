# How updates work — LeadHarvest

There are two distribution models, and they need different things. Pick the one that matches what
you selected on the AMO submission page.

| Where the add-on comes from | `update_url` needed? | Who serves updates |
|---|---|---|
| **AMO — “On this site”** (listed, what you selected) | **No** | Mozilla. Firefox polls AMO every 24 h and installs the new version automatically. |
| **AMO — “On your own”** (self-distributed, signed `.xpi`) | **Yes** | You. Firefox polls the URL in your manifest. |
| Loaded from a folder (`about:debugging`, “Load Temporary Add-on”) | — | Nothing. Temporary installs disappear when Firefox restarts. |

So for the submission you are doing right now, there is nothing to add: publish the version, and every
future version you upload to AMO reaches users on its own.

`update_url` exists for the second row. It is already wired up here in case you ever want it.

---

## What is in this repository

| File | What it does |
|---|---|
| `docs/updates.json` | The update manifest, regenerated on every build. Live at **https://merry8989-uk.github.io/leadharvest/updates.json** |
| `tools/make-updates.js` | Writes `docs/updates.json` from a built package: version, HTTPS link, `sha256` hash, minimum Firefox version |
| `tools/inject-update-url.js` | Writes a copy of `manifest.json` with `gecko.update_url` set (used only for the self-hosted build) |
| `bash build.sh --self-hosted` | Produces `dist/leadharvest-SELFHOST-ONLY-v<ver>.zip` — same code, with `update_url` pointing at the URL above |
| `bash build.sh --firefox` | Produces `dist/leadharvest-firefox-v<ver>.zip` — manifest without `background.service_worker`, so AMO validates with zero warnings |

The normal `bash build.sh` deliberately leaves `update_url` **out**. An add-on listed on AMO does not
need it, and a manifest that points at a third-party update server invites questions during review.

---

## Path A — listed on AMO (recommended)

1. Upload `dist/leadharvest-extension-v1.3.0.zip` at <https://addons.mozilla.org/developers/>.
2. That's it. Updates: bump `"version"` in `manifest.json`, run `bash build.sh`, upload the new zip.

Nothing in the manifest has to change, ever.

---

## Path B — self-distributed (signed by AMO, hosted by you)

Firefox only installs **signed** add-ons in release builds, so “self-distributed” still means
“signed by Mozilla, hosted by you”.

1. **Sign it.** On AMO choose *On your own* instead of *On this site*. Mozilla signs the package and
   gives you a `.xpi` download.
2. **Host the `.xpi`.** Any HTTPS location works — a GitHub release asset is fine:
   ```bash
   gh release upload v1.3.0 leadharvest-signed.xpi
   ```
3. **Point `updates.json` at it.** Regenerate with the signed file so the hash matches:
   ```bash
   node tools/make-updates.js \
     --file leadharvest-signed.xpi \
     --name leadharvest-signed.xpi \
     --base https://github.com/merry8989-uk/leadharvest/releases/download/v1.3.0 \
     --out docs/updates.json
   ```
   Then commit `docs/updates.json` — GitHub Pages publishes it at the URL above.
4. **Build with the update URL:**
   ```bash
   bash build.sh --self-hosted
   # or: UPDATE_URL=https://example.com/updates.json bash build.sh --self-hosted
   ```
   `dist/leadharvest-selfhosted-v<ver>.zip` now carries
   `browser_specific_settings.gecko.update_url`.
5. **Install that build** — that installed copy is what will look for updates.
6. **Ship the next version** the same way: bump the version, sign, upload the `.xpi`, regenerate
   `updates.json`, rebuild. Users update within a day.

### Testing that it actually updates

- `about:config` → `extensions.update.interval` = `120` (seconds), `extensions.update.enabled` = `true`,
  then restart Firefox.
- `about:addons` → the add-on → gear menu → **Check for updates**.
- If it fails: **Browser Console** (Ctrl+Shift+J) filtered on your add-on ID or the update URL. A
  “hash did not match” error usually means a cached download of the previous file — re-check the
  hash you generated.

---

## Things that will bite you

- **HTTPS only.** Firefox refuses a plain `http://` `update_url`. A non-HTTPS `update_link` is only
  accepted when `update_hash` is present.
- **The URL is sticky.** Once a version is installed, Firefox keeps using *that version's*
  `update_url`. If the file moves, existing installs cannot discover the new location on their own —
  only an enterprise policy can redirect them. Choose the URL once and keep it alive.
- **Versions must increase.** Firefox compares version numbers, not build dates. `1.3.0` → `1.3.1`.
- **The hash must match the file you serve**, byte for byte. Regenerate `updates.json` after every
  rebuild, or use `--link`/`--name` pointing at the exact asset you uploaded.
- **Do not mix the two models.** A build carrying `update_url` that is also listed on AMO can
  disagree with AMO about where updates come from. Use `bash build.sh` for AMO and
  `bash build.sh --self-hosted` for the self-distributed channel.
- **Chrome is separate.** Chrome's Web Store updates extensions automatically; self-hosted Chrome
  extensions use a different mechanism (`update_url` in the manifest pointing at an `update.xml`),
  which this project does not ship.

---

## Files to keep in sync on every release

1. `manifest.json` → `"version"`
2. `bash build.sh` → both zips + `docs/updates.json`
3. Upload the zip to AMO (Path A) or the signed `.xpi` + regenerated `updates.json` (Path B)
4. `gh release create v<ver> …` with the built files
