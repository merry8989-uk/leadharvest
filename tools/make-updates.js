#!/usr/bin/env node
/* Generates a Firefox update manifest (updates.json) for a built package.
   Usage: node tools/make-updates.js [--file dist/x.zip] [--name x.xpi] [--base https://…] [--out docs/updates.json] */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const gecko = (manifest.browser_specific_settings || {}).gecko || {};
const id = gecko.id;
const version = manifest.version;

if (!id) { console.error('manifest.json has no browser_specific_settings.gecko.id — Firefox cannot update an add-on without one.'); process.exit(1); }

const file = path.resolve(arg('file', path.join(root, 'dist', 'leadharvest-extension-v' + version + '.zip')));
if (!fs.existsSync(file)) { console.error('Package not found: ' + file + '\nRun build.sh first.'); process.exit(1); }

const name = arg('name', path.basename(file));
const base = arg('base', 'https://github.com/merry8989-uk/leadharvest/releases/download/v' + version).replace(/\/$/, '');
const link = arg('link', base + '/' + name);
const out = path.resolve(arg('out', path.join(root, 'docs', 'updates.json')));
const infoUrl = arg('info', 'https://merry8989-uk.github.io/leadharvest/');

const bytes = fs.readFileSync(file);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

const doc = {
  addons: {
    [id]: {
      updates: [
        {
          version,
          update_link: link,
          update_hash: 'sha256:' + sha256,
          update_info_url: infoUrl,
          applications: { gecko: { strict_min_version: gecko.strict_min_version || '140.0' } }
        }
      ]
    }
  }
};

fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');

console.log('updates.json written →', path.relative(root, out));
console.log('  add-on id :', id);
console.log('  version   :', version);
console.log('  package   :', path.basename(file), '(' + Math.round(bytes.length / 1024) + ' KB)');
console.log('  sha256    :', sha256);
console.log('  update    :', link);
