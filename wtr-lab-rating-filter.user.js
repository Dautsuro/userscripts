// ==UserScript==
// @name         WTR-LAB Rating Filter
// @namespace    wtr-lab-rating-filter
// @version      2.2.0
// @description  Folds away novels whose rating is too low for their review count (3 stars at 10 reviews, sliding to 2.5) on the novel list and novel finder.
// @match        https://wtr-lab.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Minimum rating slides with review count: 3.0 at 10 reviews (the 1–5 scale's middle), higher with fewer reviews,
  // down toward the 2.5 floor with many. Under 5 reviews: always folded.
  const MIN_REVIEWS = 5;
  const FLOOR = 2.5;
  const K = 0.5 * Math.sqrt(10); // makes the line pass through 10 reviews → 3.0
  const minRating = (reviews) => FLOOR + K / Math.sqrt(reviews);
  const shouldFold = (rating, reviews) =>
    typeof rating === 'number' && (reviews < MIN_REVIEWS || rating < minRating(reviews));

  // self-check
  console.assert(Math.abs(minRating(10) - 3) < 1e-9, 'rating filter: 10 reviews → 3.0');
  console.assert(shouldFold(2.99, 10) && !shouldFold(3.0, 10), 'rating filter: 10-review anchor');
  console.assert(shouldFold(3.2, 5) && !shouldFold(3.22, 5), 'rating filter: 5 reviews need 3.21');
  console.assert(shouldFold(2.71, 50) && !shouldFold(2.73, 50), 'rating filter: 50 reviews need 2.72');
  console.assert(shouldFold(2.49, 1e6) && !shouldFold(2.51, 1e6), 'rating filter: 2.5 floor');
  console.assert(shouldFold(1.8, 6) && shouldFold(2.51, 53), 'rating filter: user examples');
  console.assert(shouldFold(4.8, 3) && shouldFold(0, 0), 'rating filter: under 5 reviews folded');
  console.assert(!shouldFold(null, 0), 'rating filter: unreadable card kept');

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

  // Fallback: parse "★3.1 (40)" / "★4.2 (1.2K)".
  function cardText(card) {
    const label = [...card.querySelectorAll('span')].find((s) => s.textContent.trim().toLowerCase() === 'rating');
    const m = label && label.nextElementSibling && label.nextElementSibling.textContent.match(/([\d.]+)\s*\(([\d.]+)([KM]?)\)/);
    if (!m) return { rating: null, reviews: 0 };
    return { rating: parseFloat(m[1]), reviews: parseFloat(m[2]) * ({ K: 1e3, M: 1e6 }[m[3]] || 1) };
  }

  // Folding hides the card's own children with CSS, so React's nodes are never moved or removed.
  const style = document.createElement('style');
  style.textContent = `
    [data-slot="card"][data-wrf="folded"] > :not(.wrf-line) { display: none !important; }
    .wrf-line { display: block; width: 100%; min-height: 36px; padding: 6px 10px; border: 0; background: none;
      color: inherit; font: inherit; font-size: 13px; text-align: left; opacity: .75; cursor: pointer;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`;
  document.head.appendChild(style);

  const opened = new Set(); // novel hrefs the user unfolded; per novel, since React reuses card elements across pages

  function apply() {
    if (!PAGES.test(location.pathname)) return;
    const list = document.querySelector('.series-list');
    if (!list) return;
    for (const card of list.querySelectorAll(':scope > [data-slot="card"]')) {
      const { rating, reviews } = cardData(card);
      let line = card.querySelector(':scope > .wrf-line');
      if (!shouldFold(rating, reviews)) {
        if (line) line.remove();
        if (card.dataset.wrf) delete card.dataset.wrf;
        continue;
      }
      const link = card.querySelector('a[href*="/novel/"]');
      const key = link ? link.getAttribute('href') : '';
      const open = opened.has(key);
      if (!line) {
        line = document.createElement('button');
        line.type = 'button';
        line.className = 'wrf-line';
        line.addEventListener('click', () => {
          const k = line.dataset.key;
          if (opened.has(k)) opened.delete(k); else opened.add(k);
          apply();
        });
        card.prepend(line);
      }
      const title = (card.querySelector('h3') || {}).textContent || '';
      const text = `${open ? '▾' : '▸'} ${title.trim()} — ${rating.toFixed(1)}★ (${reviews})`;
      if (line.textContent !== text) line.textContent = text;
      if (line.dataset.key !== key) line.dataset.key = key;
      const state = open ? 'open' : 'folded';
      if (card.dataset.wrf !== state) card.dataset.wrf = state;
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
