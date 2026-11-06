// ==UserScript==
// @name         WTR-LAB Rating Filter
// @namespace    wtr-lab-rating-filter
// @version      3.2.0
// @description  Grays out novels rated under 3.5 stars or with fewer than 20 reviews on the novel list and novel finder, and outlines the rest in green.
// @match        https://wtr-lab.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const MIN_RATING = 3.5;
  const MIN_REVIEWS = 20;
  // null data = unreadable card: left alone. Rating rounded to 1 decimal, as the card shows it.
  const shouldDim = (d) => !!d && (d.reviews < MIN_REVIEWS || !(Math.round(d.rating * 10) / 10 >= MIN_RATING));

  // self-check
  console.assert(shouldDim({ rating: 4.8, reviews: 19 }) && !shouldDim({ rating: 3.5, reviews: 20 }), 'rating filter: 20 reviews');
  console.assert(!shouldDim({ rating: 3.46, reviews: 500 }) && shouldDim({ rating: 3.44, reviews: 500 }), 'rating filter: 3.5 stars as shown');
  console.assert(shouldDim({ rating: null, reviews: 0 }) && !shouldDim(null), 'rating filter: unrated / unreadable');

  const PAGES = /^\/[a-z]{2}(-[a-z]+)?\/novel-(list|finder)\/?$/i;

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

  // Fallback: parse "★3.1 (40)" / "★4.2 (1.2K)" / "★0" (unrated, no count).
  function cardText(card) {
    const label = [...card.querySelectorAll('span')].find((s) => s.textContent.trim().toLowerCase() === 'rating');
    const m = label && label.nextElementSibling && label.nextElementSibling.textContent.match(/([\d.]+)\s*(?:\(([\d.]+)([KM]?)\))?/);
    if (!m) return null;
    return { rating: parseFloat(m[1]), reviews: m[2] ? parseFloat(m[2]) * ({ K: 1e3, M: 1e6 }[m[3]] || 1) : 0 };
  }

  const style = document.createElement('style');
  // Same green as the F95zone Rating Filter's accepted tiles.
  style.textContent = `[data-slot="card"].wrf-dim { opacity: .3; filter: grayscale(1); }
    [data-slot="card"].wrf-ok { outline: 3px solid #2ecc40; outline-offset: -3px; }`;
  document.head.appendChild(style);

  function apply() {
    if (!PAGES.test(location.pathname)) return;
    const list = document.querySelector('.series-list');
    if (!list) return;
    // Toggle every time: React reuses card elements across pages.
    for (const card of list.querySelectorAll(':scope > [data-slot="card"]')) {
      const d = cardData(card);
      const dim = shouldDim(d), ok = !!d && !dim;
      if (card.classList.contains('wrf-dim') !== dim) card.classList.toggle('wrf-dim', dim);
      if (card.classList.contains('wrf-ok') !== ok) card.classList.toggle('wrf-ok', ok);
    }
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
