// ==UserScript==
// @name         WTR-LAB Rating Filter
// @namespace    wtr-lab-rating-filter
// @version      2.1.0
// @description  Folds away novels with under 5 reviews or whose reviews show they are clearly bad (under 2 stars) on the novel list and novel finder.
// @match        https://wtr-lab.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Fold novels with too few reviews to trust, and those where even rating + K/√reviews (room for luck) stays under 2★.
  const MIN_REVIEWS = 5;
  const BAD = 2.0;
  const K = 2;
  const shouldFold = (rating, reviews) =>
    typeof rating === 'number' && (reviews < MIN_REVIEWS || rating + K / Math.sqrt(reviews) < BAD);

  // self-check
  console.assert(shouldFold(1.15, 13) && shouldFold(1.6, 40), 'rating filter: clearly bad folded');
  console.assert(!shouldFold(2.0, 8) && !shouldFold(1.3, 6), 'rating filter: 5+ reviews, not clearly bad, kept');
  console.assert(!shouldFold(2.51, 53) && shouldFold(1.99, 1e6), 'rating filter: 2.51/53 kept, 1.99 with huge count folded');
  console.assert(shouldFold(1, 4) && shouldFold(4.8, 3) && shouldFold(0, 0), 'rating filter: under 5 reviews folded');
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
