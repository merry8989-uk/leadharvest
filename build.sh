#!/usr/bin/env bash
# Builds the distributable packages.
#   dist/leadharvest-extension-v<ver>.zip  -> load unpacked / upload to AMO (cross-browser manifest)
#   dist/leadharvest-source-v<ver>.zip     -> complete source, docs site, tests and audit tooling
set -euo pipefail
cd "$(dirname "$0")"

VER=$(node -p "require('./manifest.json').version" 2>/dev/null || sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -1)
echo "Building LeadHarvest v$VER"

rm -rf dist
mkdir -p dist

# 1. extension package: only what the browser needs (no update_url — AMO updates it)
zip -rq "dist/leadharvest-extension-v$VER.zip" manifest.json src icons -x "*.DS_Store" "*/.*"

# 1b. self-hosted package: same code, with gecko.update_url so Firefox can poll our own
#     update manifest. Only needed when the add-on is distributed outside AMO.
has_flag() { local f="$1"; shift; for a in "$@"; do [ "$a" = "$f" ] && return 0; done; return 1; }

if has_flag --self-hosted "$@" || [ "${SELF_HOSTED:-0}" = "1" ]; then
  rm -rf dist/selfhost
  node tools/inject-update-url.js --url "${UPDATE_URL:-https://merry8989-uk.github.io/leadharvest/updates.json}"
  cp -r src icons dist/selfhost/
  ( cd dist/selfhost && zip -rq "../leadharvest-SELFHOST-ONLY-v$VER.zip" manifest.json src icons -x "*.DS_Store" "*/.*" )
  rm -rf dist/selfhost
  echo
  echo "  !! leadharvest-SELFHOST-ONLY-v$VER.zip carries gecko.update_url."
  echo "  !! Do NOT upload that file to addons.mozilla.org - AMO rejects it."
  echo "  !! AMO upload = dist/leadharvest-extension-v$VER.zip"
  echo
fi

# 1b2. Firefox-only package: same code, manifest without background.service_worker, which
#      removes the only warning AMO reports on the cross-browser package.
if has_flag --firefox "$@" || [ "${FIREFOX_ONLY:-0}" = "1" ]; then
  rm -rf dist/firefox
  node tools/make-firefox-manifest.js
  cp -r src icons dist/firefox/
  ( cd dist/firefox && zip -rq "../leadharvest-firefox-v$VER.zip" manifest.json src icons -x "*.DS_Store" "*/.*" )
  rm -rf dist/firefox
fi

# 1c. Firefox update manifest, regenerated for this version so it never goes stale
node tools/make-updates.js --file "dist/leadharvest-extension-v$VER.zip" --out docs/updates.json >/dev/null

# 2. source package: everything, for AMO reviewers and for the GitHub repository
zip -rq "dist/leadharvest-source-v$VER.zip" . \
  -x "dist/*" "store/raw/*" "*.DS_Store" ".git/*" "*/.git/*" "node_modules/*" "*/node_modules/*" "*.zip"

echo
echo "Built:"
for f in dist/*.zip; do
  printf '  %-46s %s\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)"
done
echo
echo "Firefox update manifest: docs/updates.json (served at https://merry8989-uk.github.io/leadharvest/updates.json)"
echo
echo "Verify before uploading to AMO:"
echo "  npx web-ext@latest lint --source-dir ."
echo "  node tools/audit.js ."
