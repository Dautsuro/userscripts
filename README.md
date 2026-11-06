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

Folds away novels whose rating is too low for their number of reviews, so you don't waste time trying them.

- Novels with fewer than 5 reviews are folded.
- Minimum rating: `2.5 + 1.58 / sqrt(reviews)`. That gives 3.21 at 5 reviews, 3.0 at 10 (the middle of the 1–5 scale), 2.85 at 20, 2.72 at 50, and slides toward 2.5 for very popular novels. Few reviews must show a higher rating; many reviews get the benefit of the doubt down to 2.5.
- On a sample of 3,660 novels with 5+ reviews, it folds about half (67% at 5–9 reviews, 28% at 20–49, none at 100+).
- A folded novel shows as one line, `▸ Title — 1.2★ (13)`. Tap it to open the card, tap again to fold it.
- Uses the exact rating from the page data, not the rounded number on the card.

## F95zone Rating Filter

File: `f95zone-rating-filter.user.js` · runs on `https://f95zone.to/sam/latest_alpha/*` (Latest Updates)

Grays out games rated under 3.5 stars or with fewer than 20 reviews. Hover a grayed tile to see it normally.

- Unrated games and games under 3.5 are grayed at once, using the exact rating from the star bar.
- For games rated 3.5+, the review count comes from the thread page's **Reviews (N)** tab, read one thread at a time (the download stops once the count is found). Counts are cached for 3 days in the site's local storage.
- Validated games get a green border and a `✓ N` badge (N = review count). A game with neither gray nor badge is still being checked.
- Works across pages and filter changes.

## SugarCube Video Watcher

File: `sugarcube-video-watcher.user.js` · runs on local files (`file:///*`)

Remembers which videos you have watched in local HTML games (made for SugarCube, works on any local page). Built for the PC.

- Unwatched videos are hidden behind a flashing **▶ VIDEO** cover, so you can spot them while scrolling. Tap it to play.
- Unwatched videos play with sound and controls, no autoplay or loop. Playing goes fullscreen with the cursor and controls hidden. Space pauses (controls come back), Esc leaves fullscreen, pauses and puts the cover back.
- An unwatched video resumes where you left it (saved on this device only).
- A video counts as watched when it plays to the end. From then on it loops muted with no controls, like a GIF.
- Watched videos are remembered per game (Twine IFID; for other engines the folder name after `Games/`, else the page title without version numbers) and by path inside the game folder, so a new game version in another folder keeps them.
- The game's own autoplay, mute, loop, volume and `play()` calls are overridden.
- A clip that plays but never moves (Firefox GPU decoder stuck on very short clips) is reloaded after 0.75 s without progress, then again at growing gaps (up to 6 times). The console shows `[svw]` lines.
- Optional sync of the watched list between devices through the personal PocketBase server (see `CLAUDE.md`). Settings: Violentmonkey menu, **Video Watcher settings**.

## Install

Open the `.user.js` file in Firefox with Violentmonkey installed, or add it from its raw URL. For the Light script with sync, Tailscale must be on during install or update, because Violentmonkey downloads `kvsync.js` from the server then.
