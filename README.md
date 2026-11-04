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

Hides novels whose rating is too low for their number of reviews.

- Novels with fewer than 20 reviews are hidden.
- Minimum rating: `3.744 - 2.433 / sqrt(reviews)`. That gives 3.2 at 20 reviews, 3.4 at 50, 3.5 at 100, and levels off near 3.7 for very popular novels.
- Uses the exact rating from the page data, not the rounded number on the card.
- A bar above the list shows how many novels were grayed out, with a **Show all** / **Filter** toggle (remembered per device).

## Install

Open the `.user.js` file in Firefox with Violentmonkey installed, or add it from its raw URL. For the Light script with sync, Tailscale must be on during install or update, because Violentmonkey downloads `kvsync.js` from the server then.
