// ==UserScript==
// @name         Local Game Videos
// @namespace    local-game-videos
// @version      1.2.1
// @description  Local HTML games: unseen videos are covered until you click (then play fullscreen); watched videos loop muted like a GIF. Watched state is shared by every version of a game.
// @match        file:///*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @connect      100.125.40.99
// @require      http://100.125.40.99:8090/kvsync.js
// @run-at       document-start
// ==/UserScript==

// document-start: the observer must exist before the parser inserts the first <video autoplay>,
// or an unseen video could show frames before it is covered.
//
// Sync (optional): in Violentmonkey, open this script's Values tab and add
//   syncUrl   = "http://100.125.40.99:8090"
//   syncToken = "<token from: node scripts/admin.mjs token <device>>"
// Without them the watched list stays on this device.

(() => {
  'use strict';

  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.log('[local-game-videos]', ...args); };

  // v0.6, v1.2.3, v2, 0.6b. A bare number ("2") is not a version: it could be a media folder.
  const VERSION = /^(v\d+(\.\d+)*|\d+(\.\d+)+)[a-z]?$/i;

  // Pure. Same key for the same video in every version folder of a game.
  // Key = ['w', gameId, videoPath]: gameId is the page's folder, videoPath is the video
  // relative to that folder; both URL-decoded, both without version segments.
  function videoKey(pageUrl, videoUrl) {
    const segments = (url) => new URL(url).pathname.split('/').map((s) => {
      try { return decodeURIComponent(s); } catch { return s; }
    });
    const root = segments(pageUrl).slice(0, -1);
    const video = segments(videoUrl);
    const inRoot = root.every((s, i) => video[i] === s);
    const clean = (segs) => segs.filter((s) => s && !VERSION.test(s)).join('/');
    return JSON.stringify(['w', clean(root), clean(inRoot ? video.slice(root.length) : video)]);
  }

  if (DEBUG) {
    console.assert(
      videoKey('file:///C:/Games/My%20Game/v0.6/index.html', 'file:///C:/Games/My%20Game/v0.6/img/a%20b.mp4') ===
      videoKey('file:///C:/Games/My%20Game/V0.7b/index.html', 'file:///C:/Games/My%20Game/V0.7b/img/a%20b.mp4'),
      '[local-game-videos] videoKey depends on the version');
  }

  // ---- watched store: one GM value per key, mirrored to the sync server when configured ----

  let kv = null;

  function initSync() {
    const url = GM_getValue('syncUrl'), token = GM_getValue('syncToken');
    if (!url || !token || typeof KvSync === 'undefined') return;
    kv = KvSync.create({ app: 'local-game-videos', url, token });
    // Entries saved before sync was set up: timestamp 1, so any real edit wins.
    const pushLocal = () => GM_listValues().forEach((k) => {
      if (k[0] === '[' && k.length <= 2000 && kv.get(k) !== true) kv.set(k, true, 1);
    });
    if (kv.batch) kv.batch(pushLocal); else pushLocal();
    kv.start();
  }

  const isWatched = (key) => GM_getValue(key) === true || (kv !== null && kv.get(key) === true);

  function markWatched(key) {
    GM_setValue(key, true);
    if (kv && key.length <= 2000) kv.set(key, true); // longer keys stay local: kv.set would throw
  }

  // ---- videos ----

  const PLAYING = 'lgv-playing';
  const states = new WeakMap(); // video -> { src, key, mode: 'blocked' | 'playing' | 'gif', block }
  const owners = new WeakMap(); // block -> its video
  let active = null;            // the video started from a block and not ended yet
  let anchors = 0;
  let ready = false;

  // Runs at the first video, so pages without videos are left alone.
  function setup() {
    if (ready) return;
    ready = true;
    const style = document.createElement('style');
    style.textContent = `
      .lgv-block {
        /* 99: above a game's own player drawn over the video, below its top bar and dialogs */
        box-sizing: border-box; z-index: 99; margin: 0; padding: 0; border: 0;
        position: absolute !important;
        top: anchor(top) !important; left: anchor(left) !important;
        width: anchor-size(width) !important; height: anchor-size(height) !important;
        display: block !important; overflow: hidden; container-type: size;
        background: #ffc400 !important; /* opaque even if the inside fails to draw */
        cursor: pointer; pointer-events: auto !important;
      }
      .lgv-block:focus-visible { outline: 3px solid #111; outline-offset: -10px; }
      video.${PLAYING}:fullscreen, video.${PLAYING}::backdrop { cursor: none !important; }
    `;
    document.documentElement.append(style);
    try { initSync(); } catch (e) { kv = null; console.error('[local-game-videos] sync off:', e); }

    // Media events do not bubble: listen in the capture phase.
    document.addEventListener('play', (e) => {
      const st = states.get(e.target);
      if (st && st.mode === 'blocked') e.target.pause(); // the game started it
    }, true);
    document.addEventListener('pause', (e) => {
      const video = e.target, st = states.get(video);
      // A game that manages its clips can pause one it did not start itself: start it again.
      // At most 5 times per click, so the two never loop.
      if (!st || st.mode !== 'playing' || video.ended || ++st.resumes > 5) return;
      log('paused from outside, resuming', st.key);
      video.play().catch((err) => log('resume failed', err));
    }, true);
    document.addEventListener('volumechange', (e) => {
      const st = states.get(e.target);
      if (st && st.mode === 'blocked' && e.target.muted) e.target.muted = false; // the game muted it
    }, true);
    document.addEventListener('ended', (e) => {
      const st = states.get(e.target);
      if (!st || st.mode !== 'playing') return;
      markWatched(st.key);
      log('watched, saved', st.key);
      gifMode(e.target, st);
    }, true);
    document.addEventListener('fullscreenchange', () => {
      if (!active || document.fullscreenElement === active) return;
      const video = active, st = states.get(video);
      active = null;
      video.classList.remove(PLAYING);
      if (st && st.mode === 'playing') {
        log('left fullscreen before the end, not watched', st.key);
        block(video, st);
      }
    });
  }

  // Sizes follow the block (cqmin), so it reads on a 200px clip and on a full-width one.
  const COVER_HTML = `
    <style>
      .wrap {
        position: absolute; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: clamp(4px, 4cqmin, 14px);
        /* Amber with a dark frame: a colour block that stands out on dark and light game themes,
           even blurred by scrolling. */
        box-sizing: border-box; border: clamp(3px, 2cqmin, 6px) solid #111; border-radius: inherit;
        background: repeating-linear-gradient(135deg, #ffc400 0 16px, #f0ae00 16px 32px);
        color: #111; font: 700 clamp(12px, 5.5cqmin, 18px)/1.3 system-ui, sans-serif;
        text-align: center; user-select: none;
      }
      .play {
        width: clamp(34px, 24cqmin, 72px); aspect-ratio: 1; flex: none; border-radius: 50%;
        display: grid; place-items: center; background: #111;
        transition: transform .18s ease-out, background-color .18s ease-out;
      }
      svg { width: 40%; height: 40%; fill: #ffc400; margin-left: 7%; }
      .hint { font-weight: 500; font-size: .82em; color: #3a2c00; }
      :host(:hover) .play, :host(:focus-visible) .play { transform: scale(1.07); background: #000; }
      :host(:active) .play { transform: scale(.95); transition-duration: .08s; }
      @container (max-height: 120px), (max-width: 170px) { .hint { display: none; } }
      @container (max-height: 80px), (max-width: 100px) { .title { display: none; } }
      @media (prefers-reduced-motion: reduce) { .play { transition: none; } }
    </style>
    <div class="wrap" aria-hidden="true">
      <span class="play"><svg viewBox="0 0 24 24"><path d="M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5z"/></svg></span>
      <span class="title">Unseen video</span>
      <span class="hint">Click to play in fullscreen</span>
    </div>`;

  const srcOf = (video) => video.getAttribute('src')
    ? video.src
    : (video.querySelector('source[src]:not([src=""])') || {}).src || '';

  function block(video, st) {
    st.mode = 'blocked';
    video.removeAttribute('poster');
    video.controls = true;
    video.autoplay = false;
    video.loop = false;
    video.muted = false;
    video.pause();
    if (st.block) return; // still up: playback never started
    if (!video.style.anchorName) video.style.anchorName = `--lgv-${++anchors}`;
    // A div, not a <button>: games style buttons and bind their own hotkeys to them.
    const cover = document.createElement('div');
    cover.className = 'lgv-block';
    cover.setAttribute('role', 'button');
    cover.tabIndex = 0;
    cover.setAttribute('aria-label', 'Play unseen video in fullscreen');
    cover.attachShadow({ mode: 'open' }).innerHTML = COVER_HTML; // shadow: the game's CSS cannot reach in
    cover.style.borderRadius = getComputedStyle(video).borderRadius;
    cover.style.positionAnchor = video.style.anchorName;
    const onActivate = (e) => {
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation(); // not a click on the game
      play(video, st);
    };
    cover.addEventListener('click', onActivate);
    cover.addEventListener('keydown', onActivate);
    video.after(cover);
    st.block = cover;
    owners.set(cover, video);
    log('blocked', st.key);
  }

  // Called from the block's click handler: play() and requestFullscreen() need the user gesture.
  function play(video, st) {
    // The block goes once playback has started, not now: a game that manages its clips reacts to
    // the DOM change and pauses a video whose 'play' event it has not seen yet.
    video.addEventListener('playing', () => {
      if (st.mode !== 'playing' || !st.block) return;
      st.block.remove();
      st.block = null;
    }, { once: true });
    st.mode = 'playing';
    st.resumes = 0;
    active = video;
    // currentTime is left alone: a video left before its end resumes where it stopped.
    video.loop = false;  // again: the game may have reset them since the block went up
    video.muted = false;
    video.controls = false;
    video.classList.add(PLAYING);
    video.play().catch((e) => log('play() failed', e));
    video.requestFullscreen().catch((e) => {
      log('fullscreen refused, playing in place', e);
      if (active === video) active = null; // or an unrelated fullscreenchange would re-block it
      video.controls = true;
      video.classList.remove(PLAYING);
    });
    log('playing fullscreen', st.key);
  }

  function gifMode(video, st) {
    st.mode = 'gif';
    if (st.block) st.block.remove();
    st.block = null;
    if (active === video) active = null;
    video.classList.remove(PLAYING);
    if (document.fullscreenElement === video) document.exitFullscreen().catch(() => {});
    video.controls = false;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    // The autoplay attribute set after load does not start playback.
    video.play().catch((e) => log('gif play() failed', e));
    log('gif mode', st.key);
  }

  function release(video, st) {
    if (st.block) st.block.remove();
    if (active === video) {
      active = null;
      video.classList.remove(PLAYING);
      if (document.fullscreenElement === video) document.exitFullscreen().catch(() => {});
    }
    states.delete(video);
  }

  // Once per src: a video already handled for its current src is skipped.
  function process(video) {
    const src = srcOf(video);
    const old = states.get(video);
    if (old && old.src === src) return;
    if (old) release(video, old);
    if (!/^(file|https?):/.test(src)) return; // no src yet, or blob:/data: (no stable path)
    setup();
    const st = { src, key: videoKey(location.href, src), mode: '', block: null };
    states.set(video, st);
    log('video', src, '-> key', st.key);
    if (isWatched(st.key)) gifMode(video, st); else block(video, st);
  }

  // The video a node is or belongs to (<video>, or a <source> inside one).
  const ownVideo = (node) => node.localName === 'video' ? node
    : node.localName === 'source' && node.parentNode && node.parentNode.localName === 'video' ? node.parentNode
    : null;
  const videosIn = (node) => ownVideo(node) ? [ownVideo(node)]
    : node.querySelectorAll ? [...node.querySelectorAll('video')] : [];

  new MutationObserver((records) => {
    for (const r of records) {
      const target = ownVideo(r.target); // src changed, or a <source> added/removed
      if (target) process(target);
      for (const node of r.addedNodes) videosIn(node).forEach(process);
      for (const node of r.removedNodes) {
        // The game redrew around a still-unseen video and dropped its block: put it back.
        // At most 3 times per block, so a game that keeps removing it cannot loop with us.
        const owner = owners.get(node), ownerSt = owner && states.get(owner);
        if (ownerSt && ownerSt.block === node && owner.isConnected && !node.isConnected &&
            (ownerSt.reinserts = (ownerSt.reinserts || 0) + 1) <= 3) owner.after(node);
        for (const video of videosIn(node)) {
          const st = states.get(video);
          if (st && !video.isConnected) release(video, st);
        }
      }
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  document.querySelectorAll('video').forEach(process);
})();
