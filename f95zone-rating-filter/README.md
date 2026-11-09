# F95zone Rating Filter

File: `f95zone-rating-filter.user.js` · runs on `https://f95zone.to/sam/latest_alpha/*` (Latest Updates)

Grays out games rated under 3.5 stars or with fewer than 20 reviews.

- Unrated games and games under 3.5 are grayed at once, using the exact rating from the star bar.
- For games rated 3.5+, the review count comes from the thread page's **Reviews (N)** tab, read one thread at a time (the download stops once the count is found). Counts are cached for 3 days in the site's local storage.
- Validated games get a green border and a `✓ N` badge (N = review count). A game with neither gray nor badge is still being checked; while any are, a `Checking reviews… N left` spinner shows in the bottom-right corner.
- Works across pages and filter changes.
