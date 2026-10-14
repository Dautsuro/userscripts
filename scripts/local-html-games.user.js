// ==UserScript==
// @name         Local HTML Games: Video Anti-Spoiler
// @namespace    userscripts.local
// @version      1.0.5
// @description  Hides unwatched videos in local HTML games behind an anti-spoiler block, plays them fullscreen at max volume, then loops watched videos like GIFs. Progress is saved per game and shared across versions.
// @homepageURL  https://github.com/Dautsuro/userscripts
// @updateURL    https://raw.githubusercontent.com/Dautsuro/userscripts/main/scripts/local-html-games.user.js
// @downloadURL  https://raw.githubusercontent.com/Dautsuro/userscripts/main/scripts/local-html-games.user.js
// @match        file:///C:/Games/*
// @match        file:///c:/Games/*
// @run-at       document-start
// @inject-into  content
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Game identity
  // Layout: C:\Games\<Game Name>\<version>\...\index.html
  // Everything is stored under the game name, so every version shares it.
  // ---------------------------------------------------------------------------

  const ctx = parseGamePath(location.pathname);
  if (!ctx) return;

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch { return s; }
  }

  function parseGamePath(pathname) {
    // "/C:/Games/Game Name/1.0/index.html" -> ['', 'C:', 'Games', 'Game Name', '1.0', 'index.html']
    const parts = pathname.split('/').map(safeDecode);
    const i = parts.findIndex((p) => p.toLowerCase() === 'games');
    if (i < 0 || parts.length < i + 4) return null; // need <game>/<version>/<file>
    return {
      game: parts[i + 1],
      version: parts[i + 2],
      gameDir: parts.slice(0, i + 2).join('/').toLowerCase() + '/', // "/c:/games/game name/"
    };
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  const STORE_KEY = 'game:' + ctx.game;

  function loadData() {
    const d = GM_getValue(STORE_KEY, null);
    return { watched: {}, versions: [], ...(d && typeof d === 'object' ? d : {}) };
  }

  function saveData(d) {
    GM_setValue(STORE_KEY, d);
  }

  let data = loadData();
  if (!data.versions.includes(ctx.version)) data.versions.push(ctx.version);
  data.lastVersion = ctx.version;
  data.lastPlayed = Date.now();
  saveData(data);

  function isWatched(key) {
    return Object.prototype.hasOwnProperty.call(data.watched, key);
  }

  function markWatched(key) {
    data = loadData(); // merge with writes from other tabs
    data.watched[key] = { at: Date.now(), version: ctx.version };
    saveData(data);
  }

  // A video's key is its path relative to the version folder, so
  // "C:\Games\X\1.0\movies\intro.webm" and "C:\Games\X\1.1\movies\intro.webm" match.
  function videoKey(v) {
    const src =
      (v.getAttribute('src') ? v.src : '') ||
      v.querySelector('source[src]')?.src ||
      v.currentSrc ||
      '';
    if (!src) return null;
    if (src.startsWith('data:')) return 'data:' + hash(src);
    if (src.startsWith('blob:')) return src; // differs every session, can't be remembered
    let url;
    try { url = new URL(src, location.href); } catch { return src; }
    if (url.protocol !== 'file:') return url.href;
    const path = safeDecode(url.pathname).toLowerCase();
    if (!path.startsWith(ctx.gameDir)) return path;
    const rest = path.slice(ctx.gameDir.length); // "<version>/movies/intro.webm"
    const slash = rest.indexOf('/');
    return slash >= 0 ? rest.slice(slash + 1) : rest;
  }

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + '-' + s.length;
  }

  // ---------------------------------------------------------------------------
  // Styles applied to the page (the video itself while it plays fullscreen)
  // ---------------------------------------------------------------------------

  GM_addStyle(`
    video[data-lhg-viewing] { cursor: none !important; }
    video[data-lhg-viewing]:fullscreen {
      display: block !important; visibility: visible !important; opacity: 1 !important;
      transform: none !important; filter: none !important;
      width: 100% !important; height: 100% !important;
      max-width: none !important; max-height: none !important;
      object-fit: contain !important; background: #000 !important; cursor: none !important;
    }
    video[data-lhg-viewing]:fullscreen::backdrop { background: #000; }
  `);

  // ---------------------------------------------------------------------------
  // Overlay layer (closed shadow root so game CSS can't touch it)
  // ---------------------------------------------------------------------------

  const OVERLAY_CSS = `
    .ov {
      position: absolute; box-sizing: border-box; display: none; overflow: hidden;
      pointer-events: auto; cursor: pointer; user-select: none; container-type: size;
      font-family: system-ui, sans-serif; color: #fff;
      background: #ff0022;
      outline: 3px solid #fff; outline-offset: -3px;
    }
    .inner {
      position: absolute; inset: 0; padding: .5em;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5cqmin;
      font-size: clamp(10px, 6cqmin, 36px);
    }
    /* The universal "this is a video" sign: a big white play button with a pulsing ring. */
    .play {
      width: clamp(28px, 38cqmin, 200px); aspect-ratio: 1; border-radius: 50%; flex: none;
      background: #fff; display: grid; place-items: center;
      animation: lhg-ring 1.4s ease-out infinite; transition: transform .15s;
    }
    .play svg { width: 52%; height: 52%; margin-left: 9%; }
    .ov:hover .play { transform: scale(1.07); }
    .msg { font-weight: 800; letter-spacing: .14em; text-transform: uppercase; text-align: center; }
    .skip {
      position: absolute; right: 6px; bottom: 6px; padding: 4px 8px;
      font: 600 11px system-ui, sans-serif; color: #fff; background: rgba(0,0,0,.35);
      border: 1px solid rgba(255,255,255,.8); border-radius: 4px; opacity: .8;
    }
    .skip:hover { opacity: 1; background: rgba(0,0,0,.55); }
    .ov.pill { position: fixed; width: 260px; height: 90px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,.5); }
    .ov.pill .inner { flex-direction: row; justify-content: flex-start; padding-left: 18px; gap: 14px; font-size: 13px; }
    .ov.pill .play { width: 52px; }
    @container (max-height: 110px) { .ov:not(.pill) .msg { display: none; } }
    @keyframes lhg-ring {
      from { box-shadow: 0 0 0 0 rgba(255,255,255,.8); }
      to { box-shadow: 0 0 0 clamp(10px, 9cqmin, 50px) rgba(255,255,255,0); }
    }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  `;

  let host = null;
  let shadow = null;
  const overlayVideo = new Map(); // overlay element -> video

  function ensureHost() {
    if (!host) {
      host = document.createElement('lhg-overlays');
      // Absolutely positioned in the page (not fixed) so overlays scroll together with the videos.
      host.style.cssText = 'all: initial; position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 2147483647;';
      shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = OVERLAY_CSS;
      shadow.appendChild(style);
    }
    // If the game fullscreens its own container, live inside it so the block stays visible.
    const fs = document.fullscreenElement;
    const parent = fs && fs.localName !== 'video' ? fs : document.body || document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }

  function ensureOverlay(v, st) {
    ensureHost();
    if (!st.overlay) {
      const ov = document.createElement('div');
      ov.className = 'ov';
      ov.innerHTML = `
        <div class="inner">
          <div class="play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5v17L20 12z" fill="#ff0022"/></svg></div>
          <div class="msg"></div>
        </div>
        <div class="skip" title="Mark as watched without playing it">mark watched</div>`;
      shadow.appendChild(ov);
      overlayVideo.set(ov, v);
      st.overlay = ov;
    }
    st.overlay.querySelector('.msg').textContent = st.resume ? 'Paused video' : 'Unwatched video';
    st.overlay.title = st.resume ? 'Click to resume fullscreen' : 'Click to watch fullscreen';
  }

  function removeOverlay(st) {
    if (!st.overlay) return;
    overlayVideo.delete(st.overlay);
    st.overlay.remove();
    st.overlay = null;
  }

  function isRendered(v) {
    if (v.checkVisibility) return v.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const cs = getComputedStyle(v);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0;
  }

  // Part of the video not cut off by an ancestor that clips overflow (scroll boxes etc.).
  function visibleArea(v, b) {
    let x1 = b.left, y1 = b.top, x2 = b.right, y2 = b.bottom;
    for (let el = v.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const r = el.getBoundingClientRect();
      x1 = Math.max(x1, r.left); y1 = Math.max(y1, r.top);
      x2 = Math.min(x2, r.right); y2 = Math.min(y2, r.bottom);
    }
    return { x1, y1, x2, y2 };
  }

  function place(v, st, pillIndex) {
    const el = st.overlay;
    const b = v.isConnected && isRendered(v) ? v.getBoundingClientRect() : null;

    if (b && b.width >= 24 && b.height >= 24) {
      // Always the video's full size (so it never resizes while scrolling),
      // with any part hidden by a scroll box cut away by clip-path.
      const a = visibleArea(v, b);
      if (a.x2 - a.x1 < 1 || a.y2 - a.y1 < 1) {
        el.style.display = 'none';
        return false;
      }
      el.classList.remove('pill');
      el.style.display = 'block';
      const origin = host.getBoundingClientRect();
      el.style.left = b.left - origin.left + 'px';
      el.style.top = b.top - origin.top + 'px';
      el.style.width = b.width + 'px';
      el.style.height = b.height + 'px';
      el.style.right = el.style.bottom = '';
      el.style.clipPath = `inset(${a.y1 - b.top}px ${b.right - a.x2}px ${b.bottom - a.y2}px ${a.x1 - b.left}px)`;
      return false;
    }

    if (st.wanted) {
      // The game tried to play a video that has no visible box (e.g. a hidden cutscene
      // player). Show a small corner card instead of covering the page.
      el.classList.add('pill');
      el.style.display = 'block';
      el.style.left = el.style.top = el.style.width = el.style.height = el.style.clipPath = '';
      el.style.right = '16px';
      el.style.bottom = 16 + pillIndex * 100 + 'px';
      return true;
    }

    el.style.display = 'none';
    return false;
  }

  let rafId = 0;
  function startLayoutLoop() {
    if (!rafId) rafId = requestAnimationFrame(layoutTick);
  }

  function layoutTick() {
    rafId = 0;
    let any = false;
    let pills = 0;
    for (const v of tracked) {
      const st = states.get(v);
      if (st.mode !== 'blocked') continue;
      if (!v.isConnected && !st.wanted) {
        removeOverlay(st);
        tracked.delete(v); // re-tracked if it's attached again
        continue;
      }
      ensureOverlay(v, st);
      if (place(v, st, pills)) pills++;
      any = true;
    }
    if (any) rafId = requestAnimationFrame(layoutTick);
  }

  // Clicks on the overlay must never reach the game (it could advance a scene),
  // so they're caught at window capture, which runs before any game listener.
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend']) {
    window.addEventListener(type, (e) => {
      if (!host || e.target !== host) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (type !== 'click') return;
      const hit = shadow.elementFromPoint(e.clientX, e.clientY);
      const ov = hit?.closest('.ov');
      const v = ov && overlayVideo.get(ov);
      const st = v && states.get(v);
      if (!st || st.mode !== 'blocked') return;
      if (hit.closest('.skip')) {
        markWatched(st.key);
        enterGif(v, st);
      } else {
        enterViewing(v, st);
      }
    }, true);
  }

  // ---------------------------------------------------------------------------
  // Video state machine
  //   pending  - no source yet
  //   blocked  - unwatched, paused behind the spoiler block
  //   viewing  - playing fullscreen, no controls, no cursor, max volume
  //   finishing- just ended, about to become a gif
  //   gif      - watched: muted, looping, no controls
  // ---------------------------------------------------------------------------

  const states = new WeakMap();
  const tracked = new Set();

  function track(v) {
    let st = states.get(v);
    if (!st) {
      st = {
        key: undefined, mode: 'pending', overlay: null,
        wanted: false, resume: false, origLoop: v.hasAttribute('loop'),
        gameStarted: false, endedSent: false, ourPlay: false, lastTime: 0, wasFs: false,
      };
      states.set(v, st);
    }
    tracked.add(v);
    classify(v, st, false);
    if (st.mode === 'blocked') startLayoutLoop();
    return st;
  }

  function classify(v, st, force) {
    const key = videoKey(v);
    if (!force && key === st.key) return;
    st.key = key;
    st.wanted = st.resume = st.gameStarted = st.endedSent = false;
    if (!key) {
      st.mode = 'pending';
      removeOverlay(st);
    } else if (isWatched(key)) {
      enterGif(v, st);
    } else {
      enterBlocked(v, st);
    }
  }

  function enterBlocked(v, st) {
    st.mode = 'blocked';
    v.removeAttribute('data-lhg-viewing');
    if (document.fullscreenElement === v) document.exitFullscreen().catch(() => {});
    if (!v.paused || v.autoplay) st.wanted = true;
    if (!v.paused) v.pause();
    startLayoutLoop();
  }

  function enterViewing(v, st) {
    // Runs inside the click handler, so fullscreen and unmuted playback are allowed.
    st.mode = 'viewing';
    st.wasFs = false;
    removeOverlay(st);
    v.setAttribute('data-lhg-viewing', '');
    v.loop = false; // make sure 'ended' fires
    stripControls(v);
    maxVolume(v);
    if (v.ended) v.currentTime = 0;
    st.scroll = snapshotScroll(v); // fullscreen can lose the page's scroll position
    v.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {});
    v.play().catch(() => {});
  }

  function pauseViewing(v, st) {
    // Left fullscreen early: pause and put the block back, with a resume prompt.
    v.pause();
    v.removeAttribute('data-lhg-viewing');
    st.mode = 'blocked';
    st.wanted = true;
    st.resume = true;
    guardScroll(v, st.scroll);
    startLayoutLoop();
  }

  function finishViewing(v, st) {
    markWatched(st.key);
    st.mode = 'finishing';
    st.endedSent = true; // the game already got the real 'ended'
    v.removeAttribute('data-lhg-viewing');
    if (document.fullscreenElement === v) document.exitFullscreen().catch(() => {});
    guardScroll(v, st.scroll);
    // Let the game's own 'ended' handlers run first.
    setTimeout(() => {
      if (st.mode === 'finishing') enterGif(v, st);
    }, 0);
  }

  function enterGif(v, st) {
    st.gameStarted = st.gameStarted || st.wanted || !v.paused || v.autoplay;
    st.mode = 'gif';
    st.resume = false;
    removeOverlay(st);
    v.removeAttribute('data-lhg-viewing');
    stripControls(v);
    v.muted = true;
    v.loop = true;
    st.lastTime = v.currentTime;
    if (v.paused) {
      st.ourPlay = true;
      v.play().catch(() => {});
    }
  }

  function stripControls(v) {
    if (v.controls) v.controls = false;
  }

  function maxVolume(v) {
    if (v.muted) v.muted = false;
    if (v.volume !== 1) v.volume = 1;
  }

  const isVideo = (n) => n && n.localName === 'video';

  // ---------------------------------------------------------------------------
  // Scroll keeping
  // Leaving fullscreen, or the game reacting to a video ending, can throw the page
  // back to the top. Remember where everything was scrolled and hold it there for
  // a moment, unless the user scrolls/clicks/types or the video leaves the page
  // (the game moved on to a new scene).
  // ---------------------------------------------------------------------------

  const GUARD_MS = 2500;
  let guard = null;
  let guardRaf = 0;

  function snapshotScroll(v) {
    const root = document.scrollingElement || document.documentElement;
    const spots = [[root, root.scrollTop, root.scrollLeft]];
    for (let el = v.parentElement; el && el !== root; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) {
        spots.push([el, el.scrollTop, el.scrollLeft]);
      }
    }
    return spots;
  }

  function guardScroll(v, spots) {
    if (!spots) return;
    guard = { v, spots, until: performance.now() + GUARD_MS };
    setTimeout(restoreScroll, 0); // right after the game's own 'ended' handlers
    if (!guardRaf) guardRaf = requestAnimationFrame(guardTick);
  }

  // Returns false once the guard is over.
  function restoreScroll() {
    if (!guard) return false;
    if (!guard.v.isConnected || performance.now() > guard.until) {
      guard = null;
      return false;
    }
    if (isVideo(document.fullscreenElement)) {
      guard.until = performance.now() + GUARD_MS; // still leaving fullscreen
      return true;
    }
    for (const [el, top, left] of guard.spots) {
      if (el.isConnected && (Math.abs(el.scrollTop - top) > 1 || Math.abs(el.scrollLeft - left) > 1)) {
        el.scrollTo({ top, left, behavior: 'instant' });
      }
    }
    return true;
  }

  function guardTick() {
    guardRaf = restoreScroll() ? requestAnimationFrame(guardTick) : 0;
  }

  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown']) {
    window.addEventListener(type, () => { guard = null; }, { capture: true, passive: true });
  }

  // ---------------------------------------------------------------------------
  // Media events (they don't bubble, so listen in the capture phase)
  // ---------------------------------------------------------------------------

  document.addEventListener('play', (e) => {
    const v = e.target;
    if (!isVideo(v)) return;
    const st = track(v);
    if (st.mode === 'blocked') {
      st.wanted = true;
      v.pause();
      startLayoutLoop();
    } else if (st.mode === 'gif') {
      if (st.ourPlay) st.ourPlay = false;
      else st.gameStarted = true;
    }
  }, true);

  document.addEventListener('loadstart', (e) => {
    if (isVideo(e.target)) track(e.target);
  }, true);

  document.addEventListener('ended', (e) => {
    const v = e.target;
    if (!isVideo(v)) return;
    const st = states.get(v);
    if (st && st.mode === 'viewing' && e.isTrusted) finishViewing(v, st);
    // Runs before the game's own 'ended' handlers, so this is the position before any jump.
    else guardScroll(v, snapshotScroll(v));
  }, true);

  document.addEventListener('volumechange', (e) => {
    const v = e.target;
    const st = isVideo(v) && states.get(v);
    if (!st) return;
    if (st.mode === 'viewing') maxVolume(v);
    else if (st.mode === 'gif' && !v.muted) v.muted = true;
  }, true);

  document.addEventListener('timeupdate', (e) => {
    const v = e.target;
    const st = isVideo(v) && states.get(v);
    if (!st || st.mode !== 'gif') return;
    const t = v.currentTime;
    // Looping means 'ended' never fires. Games that wait for it (cutscenes) would hang,
    // so send one after the first pass, as if the video had played normally.
    if (t + 0.5 < st.lastTime && !st.endedSent && st.gameStarted && !st.origLoop) {
      st.endedSent = true;
      v.dispatchEvent(new Event('ended'));
    }
    st.lastTime = t;
  }, true);

  document.addEventListener('fullscreenchange', () => {
    ensureHost();
    for (const v of tracked) {
      const st = states.get(v);
      if (st.mode !== 'viewing') continue;
      if (document.fullscreenElement === v) st.wasFs = true;
      else if (st.wasFs) pauseViewing(v, st);
    }
  }, true);

  // ---------------------------------------------------------------------------
  // DOM watching: new videos, src changes, controls being re-enabled
  // ---------------------------------------------------------------------------

  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') {
        const t = m.target;
        if (isVideo(t)) {
          if (m.attributeName === 'controls') {
            const st = states.get(t);
            if (st && (st.mode === 'viewing' || st.mode === 'gif')) stripControls(t);
          } else {
            track(t);
          }
        } else if (t.localName === 'source' && isVideo(t.parentElement)) {
          track(t.parentElement);
        }
        continue;
      }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (isVideo(n)) track(n);
        else if (n.localName === 'source' && isVideo(n.parentElement)) track(n.parentElement);
        else n.querySelectorAll('video').forEach(track);
      }
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'controls'] });

  document.querySelectorAll('video').forEach(track);

  // ---------------------------------------------------------------------------
  // Menu
  // ---------------------------------------------------------------------------

  GM_registerMenuCommand(`Stats for "${ctx.game}"`, () => {
    data = loadData();
    alert(
      `${ctx.game}\n\n` +
      `Watched videos: ${Object.keys(data.watched).length}\n` +
      `Versions played: ${data.versions.join(', ')}\n` +
      `Current version: ${ctx.version}`
    );
  });

  GM_registerMenuCommand(`Reset watched videos for "${ctx.game}"`, () => {
    if (!confirm(`Forget every watched video for "${ctx.game}"? They'll be spoiler-blocked again.`)) return;
    data = loadData();
    data.watched = {};
    saveData(data);
    for (const v of tracked) classify(v, states.get(v), true);
  });
})();
