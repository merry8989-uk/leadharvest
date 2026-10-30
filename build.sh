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

# 1. extension package: only what the browser needs
zip -rq "dist/leadharvest-extension-v$VER.zip" manifest.json src icons -x "*.DS_Store" "*/.*"

# 2. source package: everything, for AMO reviewers and for the GitHub repository
zip -rq "dist/leadharvest-source-v$VER.zip" . \
  -x "dist/*" "*.DS_Store" "*/.git/*" "node_modules/*" "*/node_modules/*" "*.zip"

echo
echo "Built:"
for f in dist/*.zip; do
  printf '  %-46s %s\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)"
done
echo
echo "Verify before uploading to AMO:"
echo "  npx web-ext@latest lint --source-dir ."
echo "  node tools/audit.js ."
