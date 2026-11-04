// ==UserScript==
// @name         WTR-LAB Rating Filter
// @namespace    wtr-lab-rating-filter
// @version      1.0.0
// @description  Hides novels whose rating is too low for their review count on the novel list and novel finder.
// @match        https://wtr-lab.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Minimum rating for a review count. Lower confidence bound shape: rating - K/sqrt(reviews) >= TARGET.
  // Fitted to the anchors 20 -> 3.2, 50 -> 3.4, 100 -> 3.5; it levels off near 3.7 for very popular novels.
  const MIN_REVIEWS = 20;
  const TARGET = 3.744;
  const K = 2.433;
  const minRating = (reviews) => (reviews < MIN_REVIEWS ? Infinity : TARGET - K / Math.sqrt(reviews));
  const passes = (rating, reviews) => typeof rating === 'number' && rating >= minRating(reviews);

  // self-check
  console.assert(passes(3.2, 20) && !passes(3.19, 20) && !passes(5, 19), 'rating filter: 20 anchor');
  console.assert(passes(3.4, 50) && !passes(3.39, 50), 'rating filter: 50 anchor');
  console.assert(passes(3.5, 100) && !passes(3.49, 100), 'rating filter: 100 anchor');

  const PAGES = /^\/[a-z]{2}(-[a-z]+)?\/novel-(list|finder)\/?$/i;
  const STORE = 'wtrRatingFilterOn';
  let enabled = true;
  try { enabled = localStorage.getItem(STORE) !== '0'; } catch (e) { /* storage blocked: default on */ }

  // Exact values from the card's React props; the card text only shows the rating rounded to 1 decimal.
  function cardData(card) {
    const raw = card.wrappedJSObject || card;
    const key = Object.keys(raw).find((k) => k.startsWith('__reactFiber'));
    let f = key && raw[key];
    for (let i = 0; f && i < 8; i++, f = f.return) {
      const d = f.memoizedProps && f.memoizedProps.data;
      if (d && 'total_rate' in d) return { rating: d.rating, reviews: d.total_rate || 0 };
    }
    return cardText(card);
  }

  // Fallback: parse "★3.1 (40)" / "★4.2 (1.2K)".
  function cardText(card) {
    const label = [...card.querySelectorAll('span')].find((s) => s.textContent.trim().toLowerCase() === 'rating');
    const m = label && label.nextElementSibling && label.nextElementSibling.textContent.match(/([\d.]+)\s*\(([\d.]+)([KM]?)\)/);
    if (!m) return { rating: null, reviews: 0 };
    return { rating: parseFloat(m[1]), reviews: parseFloat(m[2]) * ({ K: 1e3, M: 1e6 }[m[3]] || 1) };
  }

  let bar;
  function ensureBar(list) {
    if (bar && bar.isConnected && bar.nextElementSibling === list) return bar;
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:13px;opacity:.85';
    bar.innerHTML = '<span></span><button type="button" style="margin-left:auto;padding:2px 10px;border:1px solid currentColor;border-radius:6px;background:none;color:inherit;cursor:pointer"></button>';
    bar.querySelector('button').addEventListener('click', () => {
      enabled = !enabled;
      try { localStorage.setItem(STORE, enabled ? '1' : '0'); } catch (e) { /* ignore */ }
      apply();
    });
    list.before(bar);
    return bar;
  }

  function apply() {
    if (!PAGES.test(location.pathname)) return;
    const list = document.querySelector('.series-list');
    if (!list) return;
    const cards = list.querySelectorAll(':scope > [data-slot="card"]');
    let hidden = 0;
    for (const card of cards) {
      const { rating, reviews } = cardData(card);
      const hide = enabled && !passes(rating, reviews);
      if (hide) hidden++;
      const display = hide ? 'none' : '';
      if (card.style.display !== display) card.style.display = display;
    }
    const b = ensureBar(list);
    const text = enabled
      ? `Rating filter: hid ${hidden} of ${cards.length} (min ${MIN_REVIEWS} reviews, 3.2 → 3.7 stars)`
      : `Rating filter off (${cards.length} shown)`;
    const btn = enabled ? 'Show all' : 'Filter';
    if (b.firstChild.textContent !== text) b.firstChild.textContent = text;
    if (b.lastChild.textContent !== btn) b.lastChild.textContent = btn;
  }

  // Next.js swaps cards on page/filter changes without a reload.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  }).observe(document.body, { childList: true, subtree: true });
  apply();
})();
