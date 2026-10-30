/* LeadHarvest — save a generated file to the user's device. */
(function (root) {
  'use strict';
  function save(fileName, mime, data) {
/* Cross-browser namespace: Firefox exposes promise-based `browser`, Chrome exposes `chrome`. */
const api = (typeof globalThis.browser !== 'undefined' && globalThis.browser && globalThis.browser.runtime) ? globalThis.browser : globalThis.chrome;
    const parts = [data instanceof Uint8Array ? data : String(data)];
    const blob = new Blob(parts, { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      try {
        api.downloads.download({ url, filename: fileName, saveAs: false }, id => {
          if (api.runtime.lastError) { reject(new Error(api.runtime.lastError.message)); return; }
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          resolve(id);
        });
      } catch (e) { reject(e); }
    });
  }
  function copy(text) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  root.LeadSave = { save, copy };
})(typeof globalThis !== 'undefined' ? globalThis : this);
