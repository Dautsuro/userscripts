# WTR-LAB Rating Filter 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold novels whose reviews prove a rating under 2★ into one tappable line; stop graying anything.

**Architecture:** One userscript, rewritten in place. A pure `isBad(rating, reviews)` rule, the existing exact-value reader (`cardData`), and an `apply()` pass run by the existing MutationObserver that folds/unfolds cards. The fold line is inserted as the card's first child and the card's other children are hidden by a CSS rule, so React's nodes are never moved or removed.

**Tech Stack:** Plain JS userscript (Violentmonkey, `@grant none`), Firefox Android first.

**Spec:** `docs/superpowers/specs/2026-11-04-wtr-lab-rating-filter-redesign-design.md`

## Global Constraints

- Rule: `reviews >= 5 && rating + 2 / Math.sqrt(reviews) < 2.0` → bad. Anything else, including a missing rating, is shown normally.
- Line copy: `▸ <title> — <rating.toFixed(1)>★ (<reviews>)`, `▾` when unfolded.
- No gray, no opacity change, no top bar, no toggle button, no localStorage.
- Pages: keep the existing `PAGES` regex (novel-list, novel-finder). Version `2.0.0`.
- Colors only via `currentColor`/`inherit`; tap target at least 36px tall.

## Review Focus

- React reuses a card element for a different novel after paging → fold state must be recomputed every `apply()`, and "unfolded" must be remembered per novel (by `href`), not per element.
- `apply()` runs on every DOM mutation, including its own inserts → it must not create a second line in a card, and must not write to the DOM when nothing changed (no observer loop).
- Card text fallback gives `1.2K` counts and a 1-decimal rating → rule still works on those values.
- A card with no rating / 0 reviews → never folded.
- Title with the site's `%{…|…}` markup → use the card's displayed `h3` text, never raw data.

---

### Task 1: Rule, fold line, README

**Files:**
- Modify: `wtr-lab-rating-filter.user.js` (whole body after the header)
- Modify: `README.md:32-38` (WTR-LAB Rating Filter section)

**Interfaces:**
- Produces: `isBad(rating: number|null, reviews: number) -> boolean`; `cardData(card) -> { rating, reviews }` (unchanged); `apply() -> void`.

- [ ] **Step 1: Replace the rule asserts with the new ones (they fail until Step 3)**

```js
console.assert(isBad(1.15, 13), 'rating filter: 1.15/13 bad');
console.assert(isBad(1.6, 40), 'rating filter: 1.6/40 bad');
console.assert(!isBad(2.0, 8) && !isBad(1.3, 6), 'rating filter: too few reviews');
console.assert(!isBad(2.51, 53) && isBad(1.99, 1e6), 'rating filter: 2.51/53 kept, 1.99 with huge count bad');
console.assert(!isBad(1, 4) && !isBad(null, 50), 'rating filter: <5 reviews or no rating kept');
```

- [ ] **Step 2: Run the asserts in Node, expect failure**

Run: `node -e "<the rule constants + isBad + asserts pasted>"` — with the old `passes` still in place, Expected: `Assertion failed` / `isBad is not defined`.

- [ ] **Step 3: Implement `isBad`, remove `MIN_REVIEWS/TARGET/K/minRating/passes`, `STORE`, `enabled`, `ensureBar`, `bar`**

Constants `MIN_REVIEWS = 5`, `BAD = 2.0`, `K = 2`, comment: "Bad only when even rating + K/√reviews (room for luck) stays under 2★."

- [ ] **Step 4: Run the asserts in Node, expect no output**

- [ ] **Step 5: Rewrite `apply()` to fold bad cards**

- Inject once a `<style>`: `[data-slot="card"][data-wrf="folded"] > :not(.wrf-line){display:none!important}` plus the line style (block button, full width, left-aligned, `min-height:36px`, `padding:6px 10px`, `background:none`, `border:0`, `color:inherit`, `font:inherit`, `opacity:.75`, ellipsis on one line).
- Per card: `bad = isBad(rating, reviews)`; key = card's first `a[href*="/novel/"]` `getAttribute('href')`; `open = openSet.has(key)`.
- Bad: ensure exactly one `button.wrf-line` as `card.firstChild` (reuse if present); set its text only if different; set `card.dataset.wrf = open ? 'open' : 'folded'` only if different.
- Not bad: remove any `.wrf-line` and `data-wrf`.
- Line click toggles `key` in `openSet` (a module-level `Set`) and calls `apply()`.
- Title: `card.querySelector('h3')?.textContent.trim()`.

- [ ] **Step 6: Bump `@version` to `2.0.0`; `@description` → "Folds away novels whose reviews show they are clearly bad (under 2 stars) on the novel list and novel finder."**

- [ ] **Step 7: Verify live in the built-in browser, mobile viewport**

Open `https://wtr-lab.com/en/novel-finder?orderBy=total_rate&order=desc&page=2641` (sample had 4 bad novels there), `resize_window` preset mobile, inject the script body with `javascript_tool`.
Expected: each folded line's rating/reviews satisfy the rule (check via `cardData`), no other card changed; tapping a line unfolds the card and shows `▾`, tapping again folds; going to the next page with the site's pager re-folds correctly with no duplicate lines; console shows no assertion failures. Also open page 1 (popular novels): nothing folded.

- [ ] **Step 8: Update README section** — replace "Grays out…" and the minimum-rating bullet with: folds novels whose reviews prove a rating under 2★ (`rating + 2/√reviews < 2`, at least 5 reviews) into one line you can tap to open; 2.5★ novels are never touched; about 1 in 23 novels with 5+ reviews gets folded. Keep the "exact rating from page data" bullet.

- [ ] **Step 9: Commit**

```bash
git add wtr-lab-rating-filter.user.js README.md
git commit -m "feat(rating-filter): fold away clearly bad novels instead of graying (2.0.0)"
```
