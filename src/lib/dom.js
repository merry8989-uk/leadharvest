/* LeadHarvest — safe DOM mounting.
   The extension builds its UI from escaped HTML strings. Instead of assigning to
   innerHTML (which AMO's linter flags as an unsafe sink, and which re-parses on every
   paint), the string is parsed once in an inert document and the resulting nodes are
   imported. Nothing here executes a script or touches the live document's parser. */
(function (root) {
  'use strict';

  function parse(html, contextTag) {
    const ctx = String(contextTag || '').toLowerCase();
    let source = html;
    let pick = '';

    if (ctx === 'tbody' || ctx === 'thead' || ctx === 'tfoot') {
      source = '<table><' + ctx + '>' + html + '</' + ctx + '></table>';
      pick = ctx;
    } else if (ctx === 'tr') {
      source = '<table><tbody>' + html + '</tbody></table>';
      pick = 'tbody';
    } else if (ctx === 'select') {
      source = '<select>' + html + '</select>';
      pick = 'select';
    } else if (ctx === 'table') {
      source = '<table>' + html + '</table>';
      pick = 'table';
    }

    const doc = new DOMParser().parseFromString('<body>' + source + '</body>', 'text/html');
    let host = doc.body;
    if (pick) host = host.querySelector(pick) || host;

    const adopt = (node) => {
      try { return document.importNode ? document.importNode(node, true) : node; }
      catch (e) { return node; }   /* modern appendChild adopts the node anyway */
    };
    const out = [];
    while (host.firstChild) {
      out.push(adopt(host.firstChild));
      host.removeChild(host.firstChild);
    }
    return out;
  }

  /* Replace the contents of `container` with the nodes parsed from `html`. */
  function mount(container, html) {
    if (!container) return container;
    const nodes = parse(html == null ? '' : String(html), container.tagName);
    while (container.firstChild) container.removeChild(container.firstChild);
    nodes.forEach(n => container.appendChild(n));
    return container;
  }

  /* Append without clearing what is already there. */
  function append(container, html) {
    if (!container) return container;
    parse(html == null ? '' : String(html), container.tagName).forEach(n => container.appendChild(n));
    return container;
  }

  const api = { parse, mount, append };
  root.LeadDOM = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
