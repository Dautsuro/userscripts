// ==UserScript==
// @name         Clear Site Data
// @namespace    clear-site-data
// @version      1.0.0
// @description  Menu button that wipes everything the current site saved in the browser: cookies (HttpOnly too), localStorage, sessionStorage, IndexedDB, Cache Storage, service workers, OPFS files, window.name. Then reloads.
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_cookie
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const gmList = (opts) => new Promise((resolve) => {
    try { GM_cookie.list(opts, (list, err) => resolve(err || !Array.isArray(list) ? [] : list)); } catch { resolve([]); }
  });
  const gmDelete = (opts) => new Promise((resolve) => {
    try { GM_cookie.delete(opts, (err) => resolve(!err)); } catch { resolve(false); }
  });

  const cookieNames = () => document.cookie.split(';').map((s) => s.split('=')[0].trim()).filter(Boolean);

  // Through the extension: sees HttpOnly cookies too (when Violentmonkey's HTTP-only option is on).
  async function clearCookiesGM() {
    const seen = new Set();
    let n = 0;
    for (const c of [...await gmList({ url: location.href }), ...await gmList({ domain: location.hostname })]) {
      const key = [c.name, c.domain, c.path, c.storeId, JSON.stringify(c.partitionKey)].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const opts = { name: c.name, url: (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + c.path };
      for (const k of ['storeId', 'firstPartyDomain', 'partitionKey']) if (c[k]) opts[k] = c[k];
      if (await gmDelete(opts)) n++;
    }
    return n;
  }

  // From the page: expire every visible name at every domain and path it could have been set on.
  function clearCookiesPage() {
    const names = cookieNames();
    const parts = location.hostname.split('.');
    const domains = [''];
    for (let i = 0; i < parts.length - 1; i++) domains.push('; domain=' + parts.slice(i).join('.'));
    const paths = ['/'];
    const segs = location.pathname.split('/').filter(Boolean);
    for (let i = 1; i <= segs.length; i++) {
      const p = '/' + segs.slice(0, i).join('/');
      paths.push(p, p + '/');
    }
    const flags = location.protocol === 'https:' ? ['', '; secure', '; secure; partitioned'] : [''];
    for (const name of names)
      for (const d of domains)
        for (const p of paths)
          for (const f of flags)
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=${p}${d}${f}`;
    return names.length;
  }

  function clearSync() {
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    try { window.name = ''; } catch {}
    clearCookiesPage();
  }

  async function clearAll() {
    const r = [];
    const step = async (label, fn) => {
      try { r.push(`${label}: ${await fn()}`); } catch (e) { r.push(`${label}: failed (${e.message || e})`); }
    };

    // Service workers first, so they can't refill the caches.
    await step('Service workers', async () => {
      if (!navigator.serviceWorker) return 'n/a';
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((x) => x.unregister()));
      return regs.length;
    });
    await step('Cache Storage', async () => {
      if (!window.caches) return 'n/a';
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      return keys.length;
    });
    await step('IndexedDB', async () => {
      if (!indexedDB.databases) return 'n/a';
      const dbs = await indexedDB.databases();
      // Blocked = the page still has it open; the delete finishes when the page unloads (the reload below).
      await Promise.all(dbs.map(({ name }) => new Promise((done) => {
        const q = indexedDB.deleteDatabase(name);
        q.onsuccess = q.onerror = q.onblocked = done;
      })));
      return dbs.length;
    });
    await step('OPFS files', async () => {
      if (!navigator.storage?.getDirectory) return 'n/a';
      const root = await navigator.storage.getDirectory();
      const names = [];
      for await (const [name] of root.entries()) names.push(name);
      await Promise.all(names.map((n) => root.removeEntry(n, { recursive: true })));
      return names.length;
    });
    await step('localStorage', () => { const n = localStorage.length; localStorage.clear(); return n; });
    await step('sessionStorage', () => { const n = sessionStorage.length; sessionStorage.clear(); return n; });
    await step('Cookies (extension)', clearCookiesGM);
    await step('Cookies (page)', clearCookiesPage);
    window.name = '';

    const left = cookieNames();
    if (left.length) r.push(`Cookies still there: ${left.join(', ')}`);

    // The page may save things again while unloading; wipe once more after its own handlers.
    window.addEventListener('pagehide', clearSync);
    alert('Cleared for ' + location.host + ':\n\n' + r.join('\n'));
    location.reload(true); // true = Firefox's bypass-cache reload
  }

  GM_registerMenuCommand('Clear ALL data for this site', () => {
    if (confirm(`Delete everything ${location.host} saved (cookies, storage, databases, caches)? You will be logged out.`)) clearAll();
  });
})();
