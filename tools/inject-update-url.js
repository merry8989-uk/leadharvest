#!/usr/bin/env node
/* Writes a copy of manifest.json with browser_specific_settings.gecko.update_url set.
   Used only for the self-hosted build; the AMO build must stay without it. */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };

const root = path.join(__dirname, '..');
const url = arg('url', 'https://merry8989-uk.github.io/leadharvest/updates.json');
const out = path.resolve(arg('out', path.join(root, 'dist', 'selfhost', 'manifest.json')));

if (!/^https:\/\//.test(url)) { console.error('update_url must start with https:// — Firefox refuses anything else.'); process.exit(1); }

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
manifest.browser_specific_settings = manifest.browser_specific_settings || {};
manifest.browser_specific_settings.gecko = manifest.browser_specific_settings.gecko || {};
manifest.browser_specific_settings.gecko.update_url = url;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log('self-hosted manifest →', path.relative(root, out));
console.log('  update_url:', url);
