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

Grays out novels rated under 3.5 stars or with fewer than 20 reviews (unrated novels too), instantly, since the list already has both numbers.

- Uses the exact rating from the page data, not the rounded number on the card (falls back to the card text if the data can't be read).

## F95zone Rating Filter

File: `f95zone-rating-filter.user.js` · runs on `https://f95zone.to/sam/latest_alpha/*` (Latest Updates)

Grays out games rated under 3.5 stars or with fewer than 20 reviews.

- Unrated games and games under 3.5 are grayed at once, using the exact rating from the star bar.
- For games rated 3.5+, the review count comes from the thread page's **Reviews (N)** tab, read one thread at a time (the download stops once the count is found). Counts are cached for 3 days in the site's local storage.
- Validated games get a green border and a `✓ N` badge (N = review count). A game with neither gray nor badge is still being checked; while any are, a `Checking reviews… N left` spinner shows in the bottom-right corner.
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

## SugarCube Cheat

File: `sugarcube-cheat.user.js` · runs on local files (`file:///*`), only acts in SugarCube 2 games

A cheat panel for any SugarCube game. **Alt+C** (or the Violentmonkey menu) opens it.

- **Variables**: every story variable, nested ones too (`mc.money`). Search by name or value, edit (type JSON; anything else is saved as text), − / + with a step, and ❄ to freeze. A frozen value is put back after every passage. Freezes are saved per game.
- **Hover a link or button** to see where it goes and what it will change (`mc.money: 2000 → 1000`). It reads the game's `<<set>>` code without running it, and works out `<<if>>` / `<<switch>>` conditions from the current values, so it only lists the branch that will run. A condition that needs one of the game's own functions can't be worked out; those changes say what they depend on, e.g. `(only if: between 20:00 and 21:59)` or `(only if: isNight)`. When the link also runs game code, it says it may change more than shown.
- **Passages**: every passage, searchable, click to jump there.
- **Watch**: click Start, play, click Stop. It lists every variable that changed, including ones that changed and went back.
- **Log**: what the last 20 passages changed.
- **Unlimited undo** (panel footer, per game): raises the history limit to 1000 steps and turns Back on.

## YouTube True Theater Mode

File: `youtube-true-theater-mode.user.js` · runs on `https://www.youtube.com/*`

Theater mode (the player button or `T`) fills the whole page like fullscreen, but the browser bar and the Windows taskbar stay. The YouTube header and the scrollbar are hidden while it is on; scroll down for the description and comments. Built for the PC.

## Install

Open the `.user.js` file in Firefox with Violentmonkey installed, or add it from its raw URL. For the Light script with sync, Tailscale must be on during install or update, because Violentmonkey downloads `kvsync.js` from the server then.

## Clear Site Data

File: `clear-site-data.user.js` · runs on every site and local `file://` pages

Violentmonkey menu, **Clear ALL data for this site**: after a confirm, deletes everything the current site saved, then reloads the page.

- Cookies (at every path and parent domain), localStorage, sessionStorage, IndexedDB, Cache Storage, service workers, OPFS files, `window.name`.
- HttpOnly cookies are only deleted if the HTTP-only cookie option is on in Violentmonkey (globally and for this script).
- Can't be reached by a script: the browser's HTTP cache (the reload bypasses it once), other subdomains, storage of third-party iframes, site permissions. For those, use Firefox's "Clear cookies and site data" in the address-bar padlock.
