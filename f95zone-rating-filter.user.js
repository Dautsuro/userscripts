// ==UserScript==
// @name         F95zone Rating Filter
// @namespace    f95zone-rating-filter
// @version      1.0.0
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
    .f95rf-dim { opacity: .3; filter: grayscale(1); transition: opacity .2s, filter .2s; }
    .f95rf-dim:hover { opacity: 1; filter: none; }`;
  document.head.appendChild(style);

  // Exact rating from the star bar width (text is rounded to 1 decimal); null if unrated.
  function tileRating(tile) {
    const bar = tile.querySelector('.resource-tile_rating span');
    const w = bar && parseFloat(bar.style.width);
    if (w > 0) return w / 20;
    const t = parseFloat(tile.querySelector('.resource-tile_info-meta_rating')?.textContent);
    return t > 0 ? t : null;
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
      const { id, tiles } = queue.shift();
      if (!(id in cache)) {
        try { cache[id] = [await fetchReviews(id), Date.now()]; saveCache(); }
        catch (e) { console.warn('[f95rf] thread', id, e); continue; }
      }
      tiles.forEach(t => t.classList.toggle('f95rf-dim', cache[id][0] < MIN_REVIEWS));
      await new Promise(r => setTimeout(r, 250));
    }
    running = false;
  }

  function check(tile) {
    if (tile.dataset.f95rf) return;
    tile.dataset.f95rf = '1';
    const rating = tileRating(tile);
    if (rating === null || rating < MIN_RATING) { tile.classList.add('f95rf-dim'); return; }
    const id = tile.dataset.threadId;
    if (!id) return;
    if (id in cache) { tile.classList.toggle('f95rf-dim', cache[id][0] < MIN_REVIEWS); return; }
    queue.push({ id, tiles: [tile] });
    pump();
  }

  const scan = () => document.querySelectorAll('.resource-tile[data-thread-id]').forEach(check);
  scan();
  // Pages and filters load by AJAX and replace the tiles.
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();
