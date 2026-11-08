// ==UserScript==
// @name         WTR Glossary
// @namespace    wtr-glossary
// @version      1.0.0
// @description  Keeps your WTR-LAB terms in your own glossary (synced to your server) instead of the site's, so the account term limit no longer applies.
// @match        https://wtr-lab.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      100.125.40.99
// @require      http://100.125.40.99:8090/kvsync.js
// @run-at       document-start
// @inject-into  page
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
  // Requests the script answers itself: every non-GET on the term routes, even with an unreadable body.
  const isTermWrite = (method, path) => method !== 'GET' && /^\/api\/v2\/user\/config\/(term|terms)(\/|$)/.test(path);
  // A synced row, if it is one of ours and well-formed; anyone with admin access can edit rows.
  function remoteTerm(key, value) {
    let k;
    try { k = JSON.parse(key); } catch (_) { return null; }
    if (!Array.isArray(k) || k[0] !== 'term' || !validTerm(value) || value[0] !== k[1] || typeof value[3] !== 'boolean') return null;
    return value;
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

  if (typeof document !== 'undefined') browser();

  function browser() {
    // ---------- storage ----------
    // No long-lived copy: every change re-reads GM storage, so another tab's newer write is never
    // overwritten. Changes made in the same tick (a sync pull of many terms) are saved once.
    let pending = null;
    const current = () => pending || GM_getValue('terms', {});
    // The reader reads user_terms_v2 when it mounts, before any request: keep it equal to our list.
    const mirror = (terms) => localStorage.setItem('user_terms_v2', JSON.stringify(list(terms)));
    function edit(fn) {
      if (!pending) {
        pending = GM_getValue('terms', {});
        setTimeout(() => { GM_setValue('terms', pending); mirror(pending); pending = null; });
      }
      fn(pending);
    }
    mirror(current());

    // ---------- sync (optional, see CLAUDE.md) ----------
    const syncUrl = GM_getValue('syncUrl', ''), syncToken = GM_getValue('syncToken', '');
    // KvSync re-reads and re-saves its whole state on every set(); inside kvBatched() that state is
    // held in memory and written once, so bulk loops (import, bootstrap) stay linear.
    const KV_STATE = 'kvsync:wtr-glossary';
    let kvBatch = null;
    const kvStorage = {
      get: (k, d) => (kvBatch && k === KV_STATE ? kvBatch.state : GM_getValue(k, d)),
      set: (k, v) => { if (kvBatch && k === KV_STATE) kvBatch.state = v; else GM_setValue(k, v); },
    };
    function kvBatched(fn) {
      kvBatch = { state: GM_getValue(KV_STATE, null) };
      try { fn(); } finally {
        const { state } = kvBatch;
        kvBatch = null;
        if (state) GM_setValue(KV_STATE, state);
      }
    }
    const kv = syncUrl && syncToken && typeof KvSync !== 'undefined'
      ? KvSync.create({ app: 'wtr-glossary', url: syncUrl, token: syncToken, storage: kvStorage }) : null;
    const kvKey = (id) => { const k = JSON.stringify(['term', id]); return k.length <= 2000 ? k : null; };
    function kvPut(id, t, clientUpdated) {
      const k = kv && kvKey(id);
      if (!k) return;
      if (t) kv.set(k, t, clientUpdated); else kv.remove(k);
    }
    let firstSync = null;
    if (kv) {
      // First run with sync (also when sync is turned on later): offer every local term at timestamp 1,
      // so real edits on any device win over this old data.
      if (!GM_getValue('syncBootstrapped', false)) {
        kvBatched(() => { for (const [id, t] of Object.entries(current())) kvPut(id, t, 1); });
        GM_setValue('syncBootstrapped', true);
      }
      kv.onChange((key, value, deleted) => {
        let id;
        try { [, id] = JSON.parse(key); } catch (_) { return; }
        if (deleted) { if (typeof id === 'string') edit((t) => { delete t[id]; }); return; }
        const term = remoteTerm(key, value);
        if (term) edit((t) => { t[id] = term; });
      });
      kv.start();
      if (GM_getValue('syncResync', false)) { GM_setValue('syncResync', false); kv.resync(); }
      firstSync = kv.syncNow();
      GM_registerMenuCommand('WTR Glossary: resync with server', () => kv.resync());
    }

    // ---------- fetch proxy ----------
    // Runs in the page (@inject-into page), so this is the fetch the site's code calls.
    const realFetch = window.fetch;
    const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async function (input, init) {
      let url, method;
      try {
        const isReq = input && typeof input === 'object' && !(input instanceof URL); // a Request, maybe from another frame
        url = new URL(isReq ? input.url : input, location.href);
        method = String(init?.method || (isReq ? input.method : 'GET')).toUpperCase();
      } catch (_) { return realFetch.apply(this, arguments); }
      if (url.origin !== location.origin) return realFetch.apply(this, arguments);
      if (isTermWrite(method, url.pathname)) {
        // A term write never reaches WTR-LAB, even when its body is unreadable.
        let body = null;
        try { body = JSON.parse(typeof init?.body === 'string' ? init.body : await input.clone().text()); } catch (_) { /* no body */ }
        let changed = [];
        edit((t) => {
          const r = handle(method, url.pathname, body, t);
          if (!r) return;
          for (const [id, term] of r.changed) { if (term) t[id] = term; else delete t[id]; }
          changed = r.changed;
        });
        for (const [id, term] of changed) kvPut(id, term);
        return json({ success: true, config: { terms: list(current()) } });
      }
      if (url.pathname === '/api/v2/user/config' && method === 'GET') {
        const res = await realFetch.apply(this, arguments);
        let data;
        try { data = await res.clone().json(); } catch (_) { return res; }
        if (!data?.success || !data.config) return res;
        if (!GM_getValue('imported', false)) importTerms(data.config.terms);
        if (firstSync) await Promise.race([firstSync, new Promise((ok) => setTimeout(ok, 2000))]);
        data.config.terms = list(current());
        return json(data);
      }
      return realFetch.apply(this, arguments);
    };

    // First run on this device: copy the account's WTR-LAB terms in, at timestamp 1 so real edits win.
    function importTerms(server) {
      const added = [];
      edit((terms) => {
        for (const raw of Array.isArray(server) ? server : []) {
          const t = Array.isArray(raw) ? [String(raw[0]), ...raw.slice(1)] : null;
          if (!validTerm(t) || t[0] in terms) continue;
          terms[t[0]] = t;
          added.push(t);
        }
      });
      kvBatched(() => { for (const t of added) kvPut(t[0], t, 1); });
      GM_setValue('imported', true);
    }

    // ---------- settings ----------
    function openSettings() {
      document.getElementById('wtrg-settings')?.remove();
      const el = (tag, props, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
      const url = el('input', { value: syncUrl, placeholder: 'http://100.x.y.z:8090 (empty = no sync)' });
      // The page's own scripts can read this DOM, so the saved token is never put back into it.
      const token = el('input', { type: 'password', autocomplete: 'off', placeholder: syncToken ? 'Saved (leave empty to keep it)' : "This device's token" });
      const st = kv?.status();
      const status = !kv ? (syncUrl && syncToken ? 'Sync is off: the sync library did not load (server unreachable at install).' : 'Sync is off.')
        : `Last sync: ${st.lastOkAt ? new Date(st.lastOkAt).toLocaleString() : 'not yet'}${st.lastError ? ` · error: ${st.lastError}` : ''}`;
      const overlay = el('div', { id: 'wtrg-settings' },
        el('style', { textContent: `#wtrg-settings{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}
          #wtrg-settings form{background:#1f2125;color:#e6e6e6;border:1px solid #3a3d42;border-radius:12px;padding:16px;width:100%;max-width:420px;font:14px/1.4 system-ui,sans-serif;display:flex;flex-direction:column;gap:8px}
          #wtrg-settings input{background:#15171a;color:inherit;border:1px solid #3a3d42;border-radius:8px;padding:10px;font:inherit}
          #wtrg-settings button{min-height:44px;border-radius:8px;border:0;padding:0 16px;font:inherit;cursor:pointer}
          #wtrg-settings .row{display:flex;gap:8px;justify-content:flex-end}` }),
        el('form', { onsubmit: (e) => {
          e.preventDefault();
          if (url.value.trim() !== syncUrl) GM_setValue('syncResync', true); // a new server has none of our terms
          GM_setValue('syncUrl', url.value.trim());
          if (token.value.trim() || !url.value.trim()) GM_setValue('syncToken', token.value.trim());
          location.reload(); // KvSync is created at load
        } },
        el('b', { textContent: 'WTR Glossary settings' }),
        el('div', { textContent: `${list(current()).length} terms in your glossary.` }),
        el('label', { textContent: 'Sync server URL' }), url,
        el('label', { textContent: 'Sync token' }), token,
        el('div', { textContent: status, style: 'color:#9aa0a6' }),
        el('div', { className: 'row' },
          el('button', { type: 'button', textContent: 'Cancel', onclick: () => overlay.remove() }),
          el('button', { type: 'submit', textContent: 'Save', style: 'background:#2f6b45;color:#fff' }))));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.append(overlay);
    }
    GM_registerMenuCommand('WTR Glossary settings', openSettings);
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
    console.assert(isTermWrite('POST', '/api/v2/user/config/term') && isTermWrite('DELETE', '/api/v2/user/config/term/x')
      && isTermWrite('POST', '/api/v2/user/config/terms/delete') && isTermWrite('PATCH', '/api/v2/user/config/terms/other'), 'term writes owned');
    console.assert(!isTermWrite('POST', '/api/v2/user/config/folders') && !isTermWrite('GET', '/api/v2/user/config/term/x')
      && !isTermWrite('POST', '/api/v2/user/config'), 'other config writes pass through');
    const good = ['i', 'b', 'a', false, []];
    console.assert(remoteTerm('["term","i"]', good) === good && remoteTerm('["other","i"]', good) === null
      && remoteTerm('["term","j"]', good) === null && remoteTerm('nope', good) === null && remoteTerm('["term","i"]', ['i', 'b', 'a', 'x', []]) === null, 'remoteTerm');
    console.assert(handle('GET', '/api/v2/term-preferences?source_id=1', null, {}) === null, 'prefs not owned');
    console.assert(toStored('i', T('a', 'b', { serie_id: 5 }))[4][0] === 5 && toStored('i', T('a', 'b'))[4].length === 0, 'filter forms');
    console.assert(validTerm(['i', 'b', 'a', false, []]) && !validTerm(null) && !validTerm(['x']) && !validTerm([1, 'a', 'b'])
      && !validTerm(['i', 'x'.repeat(129), 'a']) && !validTerm(['i', 'b', 'a', false, 'x']), 'validTerm');
  }
})();
