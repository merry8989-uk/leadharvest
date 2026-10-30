#!/usr/bin/env node
/* Writes a Firefox-only copy of manifest.json with background.service_worker removed.
   Chrome needs that key; Firefox ignores it and addons-linter warns about it.
   Dropping it from the AMO package gives a warning-free validation. */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };

const root = path.join(__dirname, '..');
const out = path.resolve(arg('out', path.join(root, 'dist', 'firefox', 'manifest.json')));

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.background) delete manifest.background.service_worker;
delete manifest.minimum_chrome_version;      /* meaningless in a Firefox package */

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log('Firefox manifest →', path.relative(root, out));
console.log('  background:', JSON.stringify(manifest.background));
