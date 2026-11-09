# WTR-LAB Rating Filter

File: `wtr-lab-rating-filter.user.js` · runs on `https://wtr-lab.com/*` (acts on `/novel-list` and `/novel-finder`)

Grays out novels rated under 3.5 stars or with fewer than 20 reviews (unrated novels too), instantly, since the list already has both numbers.

- Uses the exact rating from the page data, not the rounded number on the card (falls back to the card text if the data can't be read).
