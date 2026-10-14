# userscripts

Personal userscripts, written for **Violentmonkey on Firefox**.

| Script | Runs on | What it does |
| --- | --- | --- |
| [local-html-games](scripts/local-html-games.user.js) | `file:///C:/Games/*` | Spoiler-blocks unwatched videos in local HTML games, plays them fullscreen at max volume, then loops watched ones like GIFs |
| [local-html-games-cheats](scripts/local-html-games-cheats.user.js) | `file:///C:/Games/*` | Finds cheat codes in a local HTML game's code (SugarCube first), activates them, and breaks hashed code checks |

## Installing a script

Open the script's raw GitHub link in Firefox and Violentmonkey shows its install page:

- [local-html-games](https://raw.githubusercontent.com/Dautsuro/userscripts/main/scripts/local-html-games.user.js)
- [local-html-games-cheats](https://raw.githubusercontent.com/Dautsuro/userscripts/main/scripts/local-html-games-cheats.user.js)

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

**Unwatched videos** are covered by a red block with a big pulsing play button (so it reads as "a video" at a glance) and paused. The block always matches the
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

---

## local-html-games-cheats

A small key button sits in the bottom-left corner of every game (also in the Violentmonkey menu as
**Find cheat codes**). Clicking it reads the game's code (every SugarCube passage, the Story
JavaScript and inline scripts) and lists the cheat codes it finds:

- **Codes compared to what you type** in a cheat textbox/prompt (its variable, passage, or target passage
  mentions cheats or codes, so story puzzles and in-game passwords are skipped): `<<if $code is "X">>`, `<<switch>>`/`<<case>>`,
  `["A","B"].includes($code)`, JavaScript `if`/`switch`, Harlowe `(if: $code is "X")`.
- **Encoded codes** are decoded: base64 (`btoa`/`atob`) and reversed strings.
- **Hashed codes** (md5, sha…) can't be read, so the check is broken instead: the hash or validator
  function is wrapped so a stand-in code like `UNLOCK1` passes it. Type that into the game's code box.
  This lasts until the page reloads; click the button again to re-apply it.
- **Cheat lists** like `setup.cheats = { "MONEY": … }`, when the game looks the typed code up in them.

Each entry shows where it was found and **What it does** (the code that runs). **Activate** runs that
code directly through SugarCube (Twine 2 SugarCube games only), with no need to type anything.

Limitations:

- External `.js` files can't be read (Firefox blocks reading local files from a page), but validator
  functions they define are still inspected when the game calls them.
- A hash function hidden inside the game's own scope can't be wrapped; use **Activate** for those.
