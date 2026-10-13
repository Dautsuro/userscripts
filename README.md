# userscripts

Personal userscripts, written for **Violentmonkey on Firefox**.

| Script | Runs on | What it does |
| --- | --- | --- |
| [local-html-games](scripts/local-html-games.user.js) | `file:///C:/Games/*` | Spoiler-blocks unwatched videos in local HTML games, plays them fullscreen at max volume, then loops watched ones like GIFs |

## Installing a script

1. Drag the `.user.js` file into a Firefox window, Violentmonkey opens its install page.
   If it doesn't, open the Violentmonkey dashboard, click **+ → New**, and paste the file's contents.
2. To pick up edits, reinstall the same way (Violentmonkey replaces scripts with the same `@name` + `@namespace`).

## Conventions

- One script per file in `scripts/`, named `<name>.user.js`.
- Every script uses `@namespace userscripts.local` and bumps `@version` on each change.
- Persistent data goes through `GM_getValue` / `GM_setValue` (script storage survives sessions and
  works on `file://` pages, where `localStorage` is unreliable).

---

## local-html-games

Games are expected at `C:\Games\<Game Name>\<version>\...\index.html`.

**Unwatched videos** are covered by a flashing spoiler block and paused (if the game tries to play one
that's hidden, the block covers the whole page instead). Click it to watch:

- the video goes fullscreen, with no controls and no cursor
- volume is forced to 100% and unmuted (the game can't turn it down)
- pressing <kbd>Esc</kbd> pauses it and brings the block back, click again to resume
- **mark watched** (bottom-right of the block) skips it

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
