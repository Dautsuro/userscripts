# Userscripts

Violentmonkey userscripts for Firefox (PC and Android).

## WTR-LAB AI Term Ranker

File: `wtr-lab-ai-term-ranker.user.js` · runs on `https://wtr-lab.com/*`

Helps pick good translations for names and terms in WTR-LAB machine-translated novels.

- Adds an **AI Rank** button to the term tooltip. The AI scores the existing translation candidates and can propose new ones, using the chapter as context.
- **Wiki** button: looks the term up on the novel's fandom wiki and shows the official names, ranked by how often the wiki uses them. Wiki results are also sent to the AI as evidence.
- **Auto** button: picks the best rendering and saves it in WTR-LAB's term editor (wiki names globally, AI or earlier picks for the current novel only).
- Colors terms the AI has not checked yet, and reuses earlier checks so the same term gets the same translation.
- Works with Anthropic, OpenAI, OpenRouter, Google Gemini, Groq, xAI and DeepSeek API keys.
- Settings: Violentmonkey menu, **AI Term Ranker settings**.

## WTR-LAB AI Term Ranker Light

File: `wtr-lab-ai-term-ranker-light.user.js` · runs on `https://wtr-lab.com/*`

A simpler version of the script above.

- Same **AI Rank** button, but picked terms are applied by the script itself in the page, not through WTR-LAB's term system. Picked terms have their own popover.
- Each picked term can be global (all novels) or for the current novel only.
- No wiki lookup.
- Optional sync of picked terms between devices through the personal PocketBase server (see `CLAUDE.md`). Without a sync URL and token it works offline on one device.
- Settings: Violentmonkey menu, **AI Term Ranker Light settings**. With sync on, the menu also has **resync with server**.

## WTR-LAB Rating Filter

File: `wtr-lab-rating-filter.user.js` · runs on `https://wtr-lab.com/*` (acts on `/novel-list` and `/novel-finder`)

Folds away novels that are unproven or clearly bad, so you don't waste time trying them.

- Novels with fewer than 5 reviews are folded.
- A novel with 5+ reviews is folded when `rating + 2 / sqrt(reviews) < 2`: even with room for luck, it stays under 2 stars. About 1 in 23 novels with 5+ reviews gets folded.
- Mediocre novels (2.5 stars and up) are never touched; whether they're worth it depends on the content.
- A folded novel shows as one line, `▸ Title — 1.2★ (13)`. Tap it to open the card, tap again to fold it.
- Uses the exact rating from the page data, not the rounded number on the card.

## F95zone Rating Filter

File: `f95zone-rating-filter.user.js` · runs on `https://f95zone.to/sam/latest_alpha/*` (Latest Updates)

Grays out games whose rating is too low for their number of votes.

- Games with fewer than 20 votes are grayed out.
- Minimum rating: `3.95 - 2.9 / sqrt(votes)`. That gives 3.3 at 20 votes, 3.54 at 50, 3.66 at 100, and levels off near 3.95. It is stricter than the WTR-LAB curve because F95 ratings run higher on popular games.
- The list does not show vote counts, so the script reads them from each game's thread page (2 at a time, and it stops reading each page once it finds the count). Counts are cached on the device for 3 days. While counts load, the bar says how many are still loading.
- A bar above the list shows how many games were grayed out, with a **Show all** / **Filter** toggle (remembered per device).

## Install

Open the `.user.js` file in Firefox with Violentmonkey installed, or add it from its raw URL. For the Light script with sync, Tailscale must be on during install or update, because Violentmonkey downloads `kvsync.js` from the server then.
