// ==UserScript==
// @name         WTR Glossary
// @namespace    wtr-glossary
// @version      1.0.0
// @description  Keeps your WTR-LAB terms in your own glossary (synced to your server) instead of the site's, so the account term limit no longer applies.
// @match        https://wtr-lab.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @connect      100.125.40.99
// @require      http://100.125.40.99:8090/kvsync.js
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ---------- terms ----------
  // Stored like the site's own list: [id, to, from, case, filter, source, source_id, source_hash];
  // filter = serie ids the term is limited to ([] = every novel). Kept as { id: term } here.
  const API = '/api/v2/user/config/';
  const list = (terms) => Object.values(terms);
  const isText = (s) => typeof s === 'string' && s.length > 0 && s.length <= 128; // the site's own limit
  const validTerm = (t) => Array.isArray(t) && typeof t[0] === 'string' && isText(t[1]) && isText(t[2])
    && (t[4] == null || Array.isArray(t[4]));
  function toStored(id, term) {
    const f = term.filter;
    const filter = Array.isArray(f) ? f : f && f.serie_id != null ? [f.serie_id] : [];
    return [id, term.to, term.from, !!term.case, filter, term.source ?? null, term.source_id ?? null, term.source_hash ?? term.from];
  }
  const newId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // One of the site's term writes → the new map and the entries it changed ([id, term | null]).
  // null for any request that is not a term write. The input map is never mutated.
  function handle(method, path, body, terms) {
    const p = path.split('?')[0];
    if (!p.startsWith(API) || method === 'GET') return null;
    const rest = p.slice(API.length), next = { ...terms }, changed = [];
    const put = (id, term) => {
      const t = term && toStored(id, term);
      if (!validTerm(t)) return;
      next[id] = t; changed.push([id, t]);
    };
    const del = (id) => { if (id in next) { delete next[id]; changed.push([id, null]); } };
    if (rest === 'term' && method === 'POST') put(newId(), body?.term);
    else if (rest.startsWith('term/') && method === 'PUT') put(decodeURIComponent(rest.slice(5)), body?.term);
    else if (rest.startsWith('term/') && method === 'DELETE') del(decodeURIComponent(rest.slice(5)));
    else if (rest === 'terms/delete' && method === 'POST') (body?.ids || []).forEach((id) => del(String(id)));
    else return null;
    return { terms: next, changed };
  }

  // ---------- self-check (node wtr-glossary.user.js) ----------
  if (typeof document === 'undefined') {
    const T = (from, to, filter) => ({ from, to, case: false, filter, source: 1, source_id: 'id.raw.1', source_hash: from });
    let r = handle('POST', '/api/v2/user/config/term', { term: T('佟佳氏', 'Lady Tong Jia', [109840]) }, {});
    const [id] = Object.keys(r.terms);
    console.assert(r.terms[id][1] === 'Lady Tong Jia' && r.terms[id][2] === '佟佳氏' && r.terms[id][4][0] === 109840, 'add');
    console.assert(r.changed.length === 1 && r.changed[0][0] === id, 'add changed');
    const g = handle('POST', '/api/v2/user/config/term', { term: T('佟佳氏', 'Tonggiya Clan') }, r.terms).terms;
    console.assert(Object.keys(g).length === 2 && list(g).some((t) => t[4].length === 0), 'global kept beside local');
    r = handle('PUT', `/api/v2/user/config/term/${id}`, { term: T('佟佳氏', 'Tong Jia', []) }, r.terms);
    console.assert(r.terms[id][0] === id && r.terms[id][1] === 'Tong Jia' && r.terms[id][4].length === 0, 'edit');
    console.assert(handle('PUT', '/api/v2/user/config/term/zz', { term: T('a', 'b', []) }, {}).terms.zz[1] === 'b', 'edit unknown adds');
    r = handle('DELETE', `/api/v2/user/config/term/${encodeURIComponent(id)}`, null, r.terms);
    console.assert(!(id in r.terms) && r.changed[0][1] === null, 'delete');
    const three = { a: ['a', 'x', 'y', false, []], b: ['b', 'x', 'z', false, []], c: ['c', 'x', 'w', false, []] };
    r = handle('POST', '/api/v2/user/config/terms/delete', { ids: ['a', 'c'] }, three);
    console.assert(Object.keys(r.terms).join() === 'b' && r.changed.length === 2, 'bulk delete');
    console.assert(three.a, 'input not mutated');
    console.assert(handle('GET', '/api/v2/user/config', null, {}) === null, 'config read not owned');
    console.assert(handle('GET', '/api/v2/term-preferences?source_id=1', null, {}) === null, 'prefs not owned');
    console.assert(toStored('i', T('a', 'b', { serie_id: 5 }))[4][0] === 5 && toStored('i', T('a', 'b'))[4].length === 0, 'filter forms');
    console.assert(validTerm(['i', 'b', 'a', false, []]) && !validTerm(null) && !validTerm(['x']) && !validTerm([1, 'a', 'b'])
      && !validTerm(['i', 'x'.repeat(129), 'a']) && !validTerm(['i', 'b', 'a', false, 'x']), 'validTerm');
  }
})();
