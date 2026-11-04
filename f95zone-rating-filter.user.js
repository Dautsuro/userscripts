// ==UserScript==
// @name         F95zone Rating Filter
// @namespace    f95zone-rating-filter
// @version      1.0.0
// @description  Grays out games whose rating is too low for their vote count on F95zone Latest Updates.
// @match        https://f95zone.to/sam/latest_alpha/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Minimum rating for a vote count. Lower confidence bound shape: rating - K/sqrt(votes) >= TARGET.
  // Gives 20 -> 3.30, 50 -> 3.54, 100 -> 3.66, levels off near 3.95. Stricter than WTR-LAB because F95 ratings
  // run higher on popular games: on 863 sampled games it passes 55-76% in every vote bucket from 20 up.
  const MIN_VOTES = 20;
  const TARGET = 3.95;
  const K = 2.9;
  const minRating = (votes) => (votes < MIN_VOTES ? Infinity : TARGET - K / Math.sqrt(votes));
  const passes = (rating, votes) => typeof rating === 'number' && rating >= minRating(votes);

  // self-check
  console.assert(passes(3.31, 20) && !passes(3.3, 20) && !passes(5, 19), 'rating filter: 20 anchor');
  console.assert(passes(3.54, 50) && !passes(3.53, 50), 'rating filter: 50 anchor');
  console.assert(passes(3.661, 100) && !passes(3.659, 100), 'rating filter: 100 anchor');

  const ON_KEY = 'f95RatingFilterOn';
  const CACHE_KEY = 'f95RatingFilterVotes';
  const TTL = 3 * 24 * 3600 * 1000; // vote counts grow slowly; refetch after 3 days
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked: keep in memory only */ } },
  };
  let enabled = store.get(ON_KEY, true) !== false;
  const votes = store.get(CACHE_KEY, {}); // { threadId: [votes, fetchedAt] }

  // Drop expired entries so the cache does not grow forever.
  const now = Date.now();
  for (const id in votes) if (!Array.isArray(votes[id]) || now - votes[id][1] > TTL) delete votes[id];
  store.set(CACHE_KEY, votes);

  const threadId = (tile) => {
    const a = tile.querySelector('a[href*="/threads/"]');
    const m = a && a.href.match(/\/threads\/(?:[^/]*\.)?(\d+)\/?/);
    return m && m[1];
  };

  // Exact rating from the star bar width (83.4% = 4.17); the text only shows 1 decimal.
  function tileRating(tile) {
    const bar = tile.querySelector('.resource-tile_rating > span');
    const w = bar && parseFloat(bar.style.width);
    if (w >= 0) return Math.round(w * 5) / 100;
    const t = tile.querySelector('.resource-tile_info-meta_rating');
    const r = t && parseFloat(t.textContent);
    return Number.isFinite(r) ? r : null;
  }

  // The vote count is only in the thread page: the "Reviews (N)" tab ~125 KB in, JSON-LD ratingCount at the end.
  // Read the stream only until the tab shows up: thread pages are ~430 KB, too much ×30 on phone data.
  const COUNT_RE = />Reviews \((\d+)\)</;
  async function fetchVotes(id) {
    const r = await fetch(`/threads/${id}/`, { credentials: 'same-origin' });
    if (!r.ok) throw r.status;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let html = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
      const m = html.match(COUNT_RE);
      if (m) { reader.cancel().catch(() => {}); return +m[1]; }
    }
    const m = html.match(/"ratingCount"\s*:\s*(\d+)/);
    return m ? +m[1] : 0; // no tab and no aggregateRating = no votes yet
  }

  const queue = [];
  const inFlight = new Set();
  let active = 0;
  function want(id) {
    if (votes[id] || inFlight.has(id)) return;
    inFlight.add(id);
    queue.push(id);
    pump();
  }
  function pump() {
    while (active < 2 && queue.length) {
      const id = queue.shift();
      active++;
      fetchVotes(id)
        .then((n) => {
          votes[id] = [n, Date.now()];
          store.set(CACHE_KEY, votes);
        })
        .catch(() => { /* network or rate-limit error: retried on the next apply */ })
        .finally(() => {
          inFlight.delete(id);
          active--;
          setTimeout(pump, 300); // stay gentle with the site
          schedule();
        });
    }
  }

  let bar;
  function ensureBar(wrap) {
    if (bar && bar.parentNode === wrap) return bar;
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0 0 8px;padding:0 8px;font-size:13px;opacity:.85';
    bar.innerHTML = '<span></span><button type="button" style="margin-left:auto;padding:4px 12px;border:1px solid currentColor;border-radius:6px;background:none;color:inherit;cursor:pointer"></button>';
    bar.querySelector('button').addEventListener('click', () => {
      enabled = !enabled;
      store.set(ON_KEY, enabled);
      apply();
    });
    wrap.prepend(bar); // inside: the wrap's parent is a flex row, a sibling would become a column
    return bar;
  }

  function apply() {
    const wrap = document.getElementById('latest-page_items-wrap');
    if (!wrap) return;
    const tiles = wrap.querySelectorAll('.resource-tile');
    let grayed = 0;
    let loading = 0;
    for (const tile of tiles) {
      const id = threadId(tile);
      if (!id) continue;
      const v = votes[id];
      if (!v) want(id);
      if (!v) loading++;
      const gray = enabled && !!v && !passes(tileRating(tile), v[0]);
      if (gray) grayed++;
      const filter = gray ? 'grayscale(1)' : '';
      if (tile.style.filter !== filter) {
        tile.style.filter = filter;
        tile.style.opacity = gray ? '0.4' : '';
      }
    }
    const b = ensureBar(wrap);
    const text = enabled
      ? `Rating filter: grayed ${grayed} of ${tiles.length}${loading ? `, loading votes for ${loading}` : ''} (min ${MIN_VOTES} votes, 3.3 → 3.95 stars)`
      : `Rating filter off (${tiles.length} shown)`;
    const btn = enabled ? 'Show all' : 'Filter';
    if (b.firstChild.textContent !== text) b.firstChild.textContent = text;
    if (b.lastChild.textContent !== btn) b.lastChild.textContent = btn;
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  }

  // The tile grid is rebuilt by AJAX on page, sort and filter changes.
  const start = () => {
    const wrap = document.getElementById('latest-page_items-wrap');
    if (!wrap) return setTimeout(start, 500);
    new MutationObserver(schedule).observe(wrap, { childList: true, subtree: true });
    apply();
  };
  start();
})();
