/* LeadHarvest — renders a generated HTML report and opens the print dialog. */
(async function () {
/* Cross-browser namespace: Firefox exposes promise-based `browser`, Chrome exposes `chrome`. */
const api = (typeof globalThis.browser !== 'undefined' && globalThis.browser && globalThis.browser.runtime) ? globalThis.browser : globalThis.chrome;
  try {
    const { lh_print_payload } = await api.storage.local.get('lh_print_payload');
    if (!lh_print_payload) {
      document.body.textContent = 'Print ke liye koi data nahi mila. Dashboard se dobara try karein.';
      return;
    }
    /* Inject the generated report by parsing it into nodes instead of rewriting the document. */
    const parsed = new DOMParser().parseFromString(lh_print_payload, 'text/html');
    const title = parsed.querySelector('title');
    if (title) document.title = title.textContent;
    parsed.querySelectorAll('style').forEach(st => document.head.appendChild(document.importNode(st, true)));
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    parsed.body.querySelectorAll('*').forEach(node => document.body.appendChild(document.importNode(node, true)));
    setTimeout(() => { try { window.print(); } catch (e) { /* user cancelled */ } }, 500);
  } catch (e) {
    document.body.textContent = 'Print error: ' + e.message;
  }
})();
