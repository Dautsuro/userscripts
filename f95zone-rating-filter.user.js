// ==UserScript==
// @name         F95zone Rating Filter
// @namespace    f95zone-rating-filter
// @version      1.2.2
// @description  On Latest Updates, grays out games under 3.5 stars or with fewer than 20 reviews.
// @match        https://f95zone.to/sam/latest_alpha/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const MIN_RATING = 3.5;
  const MIN_REVIEWS = 20;
  const CACHE_KEY = 'f95rf-reviews';
  const CACHE_MS = 3 * 24 * 3600 * 1000;

  // { threadId: [reviewCount, savedAt] } in the site's localStorage (cache only, no sync needed).
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (e) {}
  const now = Date.now();
  for (const id in cache) if (now - cache[id][1] > CACHE_MS) delete cache[id];
  const saveCache = () => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) {} };

  const style = document.createElement('style');
  style.textContent = `
    .f95rf-dim { opacity: .3; filter: grayscale(1); }
    /* A ring layer, not an outline: the tile's body (z-index 15) paints over outlines. */
    .f95rf-ok::before { content: ""; position: absolute; inset: 0; z-index: 20; border: 3px solid #2ecc40;
      border-radius: inherit; pointer-events: none; }
    /* Opened on hover, the card is gallery + body + tags panel overflowing the tile: ring each piece instead. */
    .f95rf-ok.resource-tile-hover::before { display: none; }
    .f95rf-ok.resource-tile-hover :is(.resource-tile_gallery-wrap, .resource-tile_body, .resource-tile_hover-wrap)::after {
      content: ""; position: absolute; inset: 0; z-index: 20; border: 3px solid #2ecc40; border-radius: inherit; pointer-events: none; }
    .f95rf-ok.resource-tile-hover .resource-tile_gallery-wrap::after { border-bottom: 0; }
    .f95rf-ok.resource-tile-hover .resource-tile_body::after { border-top: 0; border-bottom: 0; }
    .f95rf-ok.resource-tile-hover .resource-tile_hover-wrap::after { border-top: 0; }
    .f95rf-ok::after { content: "✓ " attr(data-f95rf-count); position: absolute; top: 6px; left: 6px; z-index: 5;
      padding: 2px 7px; border-radius: 10px; background: #2ecc40; color: #000; font: bold 12px sans-serif; pointer-events: none; }
    #f95rf-loading { position: fixed; right: 16px; bottom: 16px; z-index: 9999; display: flex; align-items: center; gap: 8px;
      padding: 8px 14px; border-radius: 20px; background: rgba(0,0,0,.85); color: #fff; font: 13px sans-serif; pointer-events: none; }
    #f95rf-loading[hidden] { display: none; }
    #f95rf-loading::before { content: ""; width: 14px; height: 14px; border: 2px solid #555; border-top-color: #2ecc40;
      border-radius: 50%; animation: f95rf-spin .8s linear infinite; }
    @keyframes f95rf-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);

  const loading = document.createElement('div');
  loading.id = 'f95rf-loading';
  loading.hidden = true;
  loading.setAttribute('role', 'status');
  document.body.appendChild(loading);
  // left = games not finished yet, including the one being fetched.
  const showLoading = left => {
    loading.hidden = !left;
    loading.textContent = `Checking reviews… ${left} left`;
  };

  // The site's script expands a tile on hover; keep the hover events of grayed tiles from reaching it.
  for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
    window.addEventListener(type, e => {
      if (e.target.closest?.('.f95rf-dim')) e.stopImmediatePropagation();
    }, true);
  }

  // Exact rating from the star bar width (text is rounded to 1 decimal); null if unrated.
  function tileRating(tile) {
    const bar = tile.querySelector('.resource-tile_rating span');
    const w = bar && parseFloat(bar.style.width);
    if (w > 0) return w / 20;
    const t = parseFloat(tile.querySelector('.resource-tile_info-meta_rating')?.textContent);
    return t > 0 ? t : null;
  }

  // Gray if too few reviews, else mark as validated with its review count. Unmarked = still checking.
  function mark(tile, reviews) {
    const ok = reviews >= MIN_REVIEWS;
    tile.classList.toggle('f95rf-dim', !ok);
    tile.classList.toggle('f95rf-ok', ok);
    tile.dataset.f95rfCount = reviews;
  }

  // Reads the thread page only until the "Reviews (N)" tab (~25% in), then stops the download.
  async function fetchReviews(id) {
    const res = await fetch(`/threads/${id}/`, { credentials: 'include' });
    if (!res.ok) throw new Error(res.status);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      const m = text.match(/>Reviews \((\d+)\)</);
      if (m) { reader.cancel(); return +m[1]; }
      if (/class="message-body/.test(text)) { reader.cancel(); return 0; } // past the tabs: no reviews tab
    }
    return 0;
  }

  // One request at a time so the site doesn't rate-limit us.
  const queue = [];
  let running = false;
  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
      showLoading(queue.length);
      const { id, tiles } = queue.shift();
      if (!(id in cache)) {
        try { cache[id] = [await fetchReviews(id), Date.now()]; saveCache(); }
        catch (e) { console.warn('[f95rf] thread', id, e); continue; }
      }
      tiles.forEach(t => mark(t, cache[id][0]));
      await new Promise(r => setTimeout(r, 250));
    }
    showLoading(0);
    running = false;
  }

  function check(tile) {
    if (tile.dataset.f95rf) return;
    tile.dataset.f95rf = '1';
    const rating = tileRating(tile);
    if (rating === null || rating < MIN_RATING) { tile.classList.add('f95rf-dim'); return; }
    const id = tile.dataset.threadId;
    if (!id) return;
    if (id in cache) { mark(tile, cache[id][0]); return; }
    queue.push({ id, tiles: [tile] });
    pump();
    showLoading(queue.length + 1); // +1: the one pump() is fetching
  }

  const scan = () => document.querySelectorAll('.resource-tile[data-thread-id]').forEach(check);
  scan();
  // Pages and filters load by AJAX and replace the tiles.
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();
