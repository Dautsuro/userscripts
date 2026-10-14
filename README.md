# userscripts

Personal userscripts, written for **Violentmonkey on Firefox**.

| Script | Runs on | What it does |
| --- | --- | --- |
| [local-html-games](scripts/local-html-games.user.js) | `file:///C:/Games/*` | Spoiler-blocks unwatched videos in local HTML games, plays them fullscreen at max volume, then loops watched ones like GIFs |

## Installing a script

Open the script's raw GitHub link in Firefox and Violentmonkey shows its install page:

- [local-html-games](https://raw.githubusercontent.com/Dautsuro/userscripts/main/scripts/local-html-games.user.js)

Installed this way, Violentmonkey checks that link for updates on its own (or right away with
**Check for updates** in its dashboard). It only installs an update when `@version` is higher.

## Conventions

- One script per file in `scripts/`, named `<name>.user.js`.
- Every script uses `@namespace userscripts.local` and bumps `@version` on each change
  (otherwise Violentmonkey won't pick the change up).
- Every script sets `@updateURL` / `@downloadURL` to its raw GitHub link on `main`.
- Persistent data goes through `GM_getValue` / `GM_setValue` (script storage survives sessions and
  works on `file://` pages, where `localStorage` is unreliable).

---

## local-html-games

Games are expected at `C:\Games\<Game Name>\<version>\...\index.html`.

**Unwatched videos** are covered by a frosted-glass spoiler cover (heavy blur, glowing red edge, a big play button and a "Spoiler" tag) and paused. The block always matches the
video's size and scrolls with it. If the game tries to play a video that has no visible box, a small
spoiler card appears in the bottom-right corner instead, and the rest of the page stays usable. Click
the block or card to watch:

- the video goes fullscreen, with no controls and no cursor
- volume is forced to 100% and unmuted (the game can't turn it down)
- pressing <kbd>Esc</kbd> pauses it and brings the block back, click again to resume
- **mark watched** (bottom-right of the block) skips it

**Scroll position is kept.** When a video ends (or you leave fullscreen), the page stays where it
was, even if the game tries to jump back to the top. This stops as soon as you scroll, click or type
yourself, or if the game moves to a new scene (the video is removed from the page).

**Watched videos** play like GIFs: muted, looping, no controls. Since a looping video never ends,
the script sends the game one `ended` event after the first loop so cutscenes that wait for the
video to finish still move on.

**Saved data** is keyed by the game folder name, so every version of a game shares it. Videos are
identified by their path inside the version folder (`1.0\movies\intro.webm` and
`1.1\movies\intro.webm` are the same video). Use the Violentmonkey toolbar menu for per-game
**Stats** and **Reset watched videos**.

Limitations:

- Videos loaded from `blob:` URLs get a new address every session, so they can't be remembered.
- Firefox always shows its "press Esc to exit full screen" notice. You can shorten it by setting
  `full-screen-api.warning.timeout` in `about:config`.
