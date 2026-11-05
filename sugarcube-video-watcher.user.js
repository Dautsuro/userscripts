// ==UserScript==
// @name         SugarCube Video Watcher
// @namespace    sugarcube-video-watcher
// @version      1.1.1
// @description  Local games: unwatched videos get a flashy cover, sound and controls, and play fullscreen; watched ones loop muted like GIFs. Watched list syncs through the personal server.
// @match        file:///*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      100.125.40.99
// @require      http://100.125.40.99:8090/kvsync.js
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  // ---------- watched store ----------
  // Local map { key: true } in GM storage, mirrored to KvSync when a sync URL and token are set.
  // Keys: JSON ['watched', gameId, video path relative to the game's html].
  const SYNC_APP = 'sugarcube-video-watcher';
  const watched = GM_getValue('watched', {});
  const syncUrl = GM_getValue('syncUrl', ''), syncToken = GM_getValue('syncToken', '');
  // KvSync re-saves its whole state on every set(); kvBatched() holds it in memory for bulk loops.
  const KV_STATE = `kvsync:${SYNC_APP}`;
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
    ? KvSync.create({ app: SYNC_APP, url: syncUrl, token: syncToken, storage: kvStorage }) : null;
  const kvPut = (k, clientUpdated) => { if (kv && k.length <= 2000) kv.set(k, true, clientUpdated); };

  let gid = '';
  // Twine games (SugarCube, Harlowe…) keep their IFID across versions. Other engines: the game folder
  // under Games (C:\Games\<name>\<version>\index.html), else the page title without version numbers.
  const titleId = (t) => t.replace(/[\s(\[-]*\bv?\d+(\.\d+)+[a-z]?\b[)\]]?/gi, '').trim();
  const folderId = (url) => { try { return decodeURIComponent(url).match(/\/Games\/([^/?#]+)\//i)?.[1] || ''; } catch { return ''; } };
  const gameId = () => (gid ||= document.querySelector('tw-storydata')?.getAttribute('ifid') || folderId(location.href) || titleId(document.title));
  function relPath(src, page = location.href) {
    const clean = (u) => { u = u.split(/[?#]/)[0]; try { return decodeURIComponent(u); } catch { return u; } };
    const s = clean(src), dir = clean(page).replace(/[^/]*$/, '');
    return s.startsWith(dir) ? s.slice(dir.length) : s; // same key on PC and phone, whatever the install folder
  }
  const srcOf = (v) => v.currentSrc || v.src || v.querySelector('source[src]')?.src || '';
  const keyOf = (v) => { const s = srcOf(v); return s ? JSON.stringify(['watched', gameId(), relPath(s)]) : null; };
  const validKey = (k) => {
    try { const a = JSON.parse(k); return Array.isArray(a) && a.length === 3 && a[0] === 'watched' && a.every((x) => typeof x === 'string'); } catch { return false; }
  };

  function markWatched(k) {
    if (watched[k]) return;
    watched[k] = true;
    GM_setValue('watched', watched);
    kvPut(k);
  }
  const positions = GM_getValue('positions', {}); // { key: seconds } where an unwatched video was left
  function savePosition(k, t) {
    if (t > 0) positions[k] = t; else delete positions[k];
    GM_setValue('positions', positions);
  }
  const refreshAll =() => document.querySelectorAll('video').forEach(update);

  // Another tab saved the map: take it, or our next save would drop its entries.
  GM_addValueChangeListener('watched', (_, __, value, remote) => {
    if (!remote) return;
    for (const k of Object.keys(watched)) delete watched[k];
    Object.assign(watched, value || {});
    refreshAll();
  });

  function applyRemote(k, value, deleted) {
    if (!validKey(k)) return; // anyone with admin access can edit rows
    if (deleted) { if (!watched[k]) return; delete watched[k]; }
    else if (value === true) { if (watched[k]) return; watched[k] = true; }
    else return;
    GM_setValue('watched', watched);
    refreshAll();
  }
  if (kv) {
    kv.onChange(applyRemote);
    kvBatched(() => {
      // First run with sync: old local data at timestamp 1, so real edits on any device win.
      if (!GM_getValue('syncBootstrapped', false)) {
        for (const k of Object.keys(watched)) kvPut(k, 1);
        GM_setValue('syncBootstrapped', true);
      }
    });
    for (const [k, v] of kv.entries('')) applyRemote(k, v, false);
    kv.start();
    if (GM_getValue('syncResync', false)) { GM_setValue('syncResync', false); kv.resync?.(); }
    GM_registerMenuCommand('Video Watcher: resync with server', () => kv.resync?.());
  }

  // ---------- videos ----------
  // Modes: covered (unwatched, hidden behind a cover, kept paused), open (unwatched, revealed: sound,
  // controls, fullscreen while playing), gif (watched: loop, muted, no controls, always playing).
  // The game sets autoplay/loop/muted/volume and calls play() itself, so every change is re-enforced.
  GM_addStyle(`
    .svw-hidden{display:none!important}
    .svw-nocursor{cursor:none!important}
    .svw-cover{display:flex!important;align-items:center;justify-content:center;box-sizing:border-box;width:min(100%,640px);aspect-ratio:16/9;margin:8px auto;cursor:pointer;border-radius:12px;font:bold 36px/1 sans-serif;letter-spacing:6px;color:#fff;text-shadow:0 2px 8px #000;user-select:none;
      background:linear-gradient(135deg,#ff0080,#ff8c00,#40e0d0,#8a2be2);background-size:400% 400%;animation:svw-shift 4s ease infinite,svw-pulse 1.5s ease-in-out infinite}
    @keyframes svw-shift{0%,100%{background-position:0 50%}50%{background-position:100% 50%}}
    @keyframes svw-pulse{0%,100%{box-shadow:0 0 16px 4px #ff0080}50%{box-shadow:0 0 40px 12px #40e0d0}}
  `);

  const st = new WeakMap(); // video -> { key, mode, cover, fsReq }
  const set = (v, prop, val) => { if (v[prop] !== val) v[prop] = val; };

  function update(v) {
    const key = keyOf(v);
    if (!key) return;
    let s = st.get(v);
    if (!s || s.key !== key) { s?.cover?.remove(); s = { key, mode: watched[key] ? 'gif' : 'covered' }; st.set(v, s); }
    else if (s.mode === 'covered' && watched[key]) s.mode = 'gif';
    if (s.mode === 'covered') { if (!s.cover?.isConnected) v.before(s.cover ||= makeCover(v, s)); }
    else s.cover?.remove();
    enforce(v);
  }

  function enforce(v) {
    const s = st.get(v);
    if (!s) return;
    const gif = s.mode === 'gif', hide = document.fullscreenElement === v && !v.paused;
    set(v, 'autoplay', gif);
    set(v, 'loop', gif);
    set(v, 'muted', gif);
    set(v, 'controls', !gif && !hide);
    if (!gif && v.volume === 0) v.volume = 1;
    v.classList.toggle('svw-hidden', s.mode === 'covered');
    v.classList.toggle('svw-nocursor', hide);
    if (s.mode === 'covered' && !v.paused) v.pause();
    if (gif && v.paused && v.isConnected) v.play().catch(() => {});
  }

  function goFullscreen(v, s) {
    if (document.fullscreenElement === v || s.fsReq || !v.requestFullscreen) return;
    s.fsReq = true;
    v.requestFullscreen().catch(() => {}).finally(() => { s.fsReq = false; });
  }

  function makeCover(v, s) {
    const c = document.createElement('div');
    c.className = 'svw-cover';
    c.textContent = '▶ VIDEO';
    c.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // the game may have a link or handler around the video
      s.mode = 'open';
      update(v);
      if (positions[s.key]) v.currentTime = positions[s.key];
      goFullscreen(v, s); // inside the click: fullscreen needs a user gesture
      v.play().catch(() => {});
    });
    return c;
  }

  const on = (type, fn) => document.addEventListener(type, (e) => {
    const v = e.target;
    if (v.localName === 'video' && st.has(v)) fn(v, st.get(v), e);
  }, true); // capture: media events don't bubble
  on('play', (v, s) => { if (s.mode === 'open') goFullscreen(v, s); enforce(v); });
  on('playing', enforce);
  on('pause', enforce);
  on('volumechange', enforce);
  // Resume point, device-local. Saved while playing: SugarCube removes the video on passage change,
  // and a detached video's pause event never reaches our listener.
  on('timeupdate', (v, s) => {
    if (s.mode === 'open' && Math.abs(v.currentTime - (positions[s.key] || 0)) >= 1) savePosition(s.key, v.currentTime);
  });
  on('ended', (v, s) => {
    if (s.mode !== 'open') return;
    markWatched(s.key);
    savePosition(s.key, 0);
    s.mode = 'gif';
    if (document.fullscreenElement === v) document.exitFullscreen().catch(() => {});
    update(v);
  });
  // Fullscreen and playing has no controls: Space toggles pause, and paused brings controls back.
  // No click toggle on purpose: misclicks.
  document.addEventListener('keydown', (e) => {
    const v = document.fullscreenElement;
    if (e.key !== ' ' || v?.localName !== 'video' || st.get(v)?.mode !== 'open') return;
    e.preventDefault();
    e.stopPropagation();
    v.paused ? v.play().catch(() => {}) : v.pause();
  }, true);
  document.addEventListener('loadstart', (e) => { if (e.target.localName === 'video') update(e.target); }, true); // src changed

  let fsVideo = null;
  document.addEventListener('fullscreenchange', () => {
    const left = fsVideo;
    fsVideo = document.fullscreenElement?.localName === 'video' ? document.fullscreenElement : null;
    if (fsVideo) enforce(fsVideo);
    if (!left || left === fsVideo) return;
    const s = st.get(left);
    if (s?.mode === 'open') {
      if (watched[s.key]) s.mode = 'gif';
      else { s.mode = 'covered'; left.pause(); savePosition(s.key, left.currentTime); } // back behind the cover, resumable
    }
    if (s) update(left);
  });

  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') { if (m.target.localName === 'video') enforce(m.target); continue; }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.localName === 'video') update(n);
        else if (n.localName === 'source' && n.parentElement?.localName === 'video') update(n.parentElement);
        else n.querySelectorAll('video').forEach(update);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['autoplay', 'loop', 'muted', 'controls'] });
  refreshAll();

  // ---------- stall fix ----------
  // With hardware decoding on, Firefox's GPU decoder can sit on a very short clip (~13 frames) without
  // ever showing a frame: playing, fully loaded, time stuck. Kick it: a seek, then a reload.
  const stalls = new WeakMap(); // video -> { t, f, since, tries }
  const stallInfo = (v, s, f) => `${relPath(srcOf(v))} (${st.get(v)?.mode}, t ${s.t.toFixed(2)}→${v.currentTime.toFixed(2)}, frames ${s.f}→${f})`;
  setInterval(() => {
    for (const v of document.querySelectorAll('video')) {
      if (v.paused || v.ended) { stalls.delete(v); continue; }
      const loaded = v.buffered.length && v.buffered.end(v.buffered.length - 1) > v.currentTime;
      if (v.seeking || !loaded) continue; // still loading, or our own kick in progress
      const s = stalls.get(v), now = Date.now(), f = v.getVideoPlaybackQuality().totalVideoFrames;
      if (s && f < s.f) s.f = f; // reloaded: the frame counter restarted
      // Real progress only: a seek can nudge the time or show one frame while the decoder stays stuck.
      // Frames also cover a loop wrapping the time back to 0.
      if (!s || v.currentTime >= s.t + 0.2 || f >= s.f + 3) {
        if (s?.tries) console.info(`[svw] stall fixed by ${s.tries === 1 ? 'seek' : 'reload'}:`, stallInfo(v, s, f));
        stalls.set(v, { t: v.currentTime, f, since: now, tries: 0 });
        continue;
      }
      if (s.tries >= 2 || now - s.since < 1500 * (s.tries + 1)) continue;
      s.tries++;
      console.info(`[svw] stall, trying ${s.tries === 1 ? 'seek' : 'reload'}:`, stallInfo(v, s, f));
      if (s.tries === 1) v.currentTime = s.t;
      else { v.load(); v.currentTime = s.t; v.play().catch(() => {}); }
    }
  }, 500);

  // ---------- settings ----------
  const syncStatusText = ({ lastOkAt, lastError }) =>
    `Last sync: ${lastOkAt ? new Date(lastOkAt).toLocaleString() : 'not yet'}${lastError ? ` · error: ${lastError}` : ''}`;

  function openSettings() {
    const d = document.createElement('dialog');
    d.style.cssText = 'font:14px sans-serif;color:#222;background:#fff;padding:16px;border-radius:8px;max-width:90vw';
    d.innerHTML = `<form method="dialog">
      <label>Sync server URL<br><input name="url" style="width:100%" autocomplete="off" placeholder="http://100.125.40.99:8090 (empty = no sync)"></label><br><br>
      <label>Sync token<br><input name="token" type="password" style="width:100%" autocomplete="off" placeholder="This device's token"></label>
      <p class="svw-status"></p><p>Applies after a page reload.</p>
      <button value="save">Save</button> <button value="">Cancel</button></form>`;
    const f = d.querySelector('form');
    f.url.value = GM_getValue('syncUrl', '');
    f.token.value = GM_getValue('syncToken', '');
    d.querySelector('.svw-status').textContent = kv ? syncStatusText(kv.status()) : 'Sync is off.';
    d.addEventListener('close', () => {
      if (d.returnValue === 'save') {
        if (f.url.value.trim() !== GM_getValue('syncUrl', '')) GM_setValue('syncResync', true);
        GM_setValue('syncUrl', f.url.value.trim());
        GM_setValue('syncToken', f.token.value.trim());
      }
      d.remove();
    });
    document.body.append(d);
    d.showModal();
  }
  GM_registerMenuCommand('Video Watcher settings', openSettings);

  // ---------- self-check ----------
  console.assert(relPath('file:///C:/G/a%20b/v/x.mp4?t=1', 'file:///C:/G/a%20b/index.html') === 'v/x.mp4', 'svw: relative path');
  console.assert(relPath('file:///D:/other/x.mp4', 'file:///C:/G/index.html') === 'file:///D:/other/x.mp4','svw: outside path kept');
  console.assert(['My Game v1.95', 'My Game 0.12.3b', 'My Game (v2.0)', 'My Game - 1.0'].every((t) => titleId(t) === 'My Game') && titleId('Day 1') === 'Day 1', 'svw: title without version');
  console.assert(folderId('file:///C:/Games/Become%20Someone/v1.95/index.html') === 'Become Someone' && folderId('file:///C:/Other/x.html') === '', 'svw: game folder');
  console.assert(validKey('["watched","g","v/x.mp4"]') && !validKey('["watched","g"]') && !validKey('nope'), 'svw: key validation');
})();
