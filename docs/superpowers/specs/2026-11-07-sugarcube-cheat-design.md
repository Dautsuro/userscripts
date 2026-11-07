# SugarCube Cheat — design

## Intent

One Violentmonkey userscript that cheats in any SugarCube 2 game the user plays locally, without per-game setup. SugarCube's API is the same in every game, so one script covers all of them. The user plays these games on the Windows PC only (Firefox + Violentmonkey, games at `C:\Games\<name>\<version>\index.html`, opened as `file:///`).

## Goals

1. **Variable editor**: browse every story variable (`State.variables`), including nested object/array paths like `player.stats.str`. Edit values. Freeze values.
2. **Search** variables by name or by value.
3. **Quick number buttons** on numeric variables: −, + and "set to…".
4. **Freeze**: a frozen variable is written back to its frozen value after every passage change. Freezes are saved per game and come back on reload.
5. **Hover preview**: hovering a link or button in the passage shows which variables it would change and to what, e.g. `gold: 10 → 15`.
6. **Passage list with jump**: every passage, searchable by name, click to go there.
7. **Show where links go**: on hover, the preview also names the destination passage, including links the game hides from the reader.
8. **Change log**: what the last passage change modified (old → new).
9. **Variable watcher**: click Watch, play, click Stop. Lists every variable that changed between Start and Stop (old → new). It also checks after every passage while watching, so a value that changed and then went back still appears, marked "changed, then reverted".
10. **Unlimited undo**: lift the game's history limit so Back always works.

## Non-goals

- Phone or touch support.
- Sync through the personal PocketBase server. Local `GM_setValue` only.
- Harlowe, Snowman or other story formats. SugarCube 2 only (built on 2.37.3, as used in `C:\Games\Become Someone\v1.95`). On older 2.x versions, features may degrade but must not break the game.
- Dry-running link code to preview its effects (approach B below, rejected).
- Editing saves or save files directly.

## Anti-goals (a failure even if it works)

- The script changes the game's behaviour while the user isn't cheating, e.g. the hover preview triggers sounds, navigation or state changes.
- The script breaks a non-SugarCube page or game opened from `file:///`. It must do nothing there.
- The panel covers the game permanently. It must close completely.

## Constraints

- `@match file:///*`, `@run-at document-start`, like `sugarcube-video-watcher.user.js`.
- Game identity comes from the IFID, the same way `sugarcube-video-watcher.user.js` does it (`tw-storydata[ifid]`, falling back to the folder). Per-game data is stored in GM storage under that ID.
- Reach the page through `unsafeWindow.SugarCube` (Firefox/Violentmonkey: in the page's real `window`).
- **Timing (checked in the 2.37.3 source)**: `window.SugarCube` is defined synchronously by the engine's inline script. The game starts (`Story.init`, first passage render) inside a jQuery `$(fn)` ready handler. A `DOMContentLoaded` listener added at document-start runs before jQuery's ready handler, so that's where the link hooks must be installed (see Hover preview).

## Approaches considered (hover preview)

- **A. Read the source (picked).** Read the link's setter and its `<<link>>` body, plus the destination passage's text. Pull out the assignments and compute their values from the current state. Never runs game code. Misses changes made by JavaScript functions; those are shown as "runs code: …".
- **B. Dry run.** Copy the state, actually run the link's code with navigation blocked, diff the results, then restore. Exact for the link's own code, but the code can still play audio, open dialogs and change the DOM. Previewing the destination passage would mean rendering it. Rejected as unsafe.
- **C. A, plus B on Shift+hover.** Not now: A covers most games, and B's risk stays.

The user picked **A**: "it's enough for most case".

## How it works (decided parts)

### UI

- One floating panel with tabs: **Variables · Passages · Watch · Log**. It opens and closes with a hotkey and a Violentmonkey menu command, and is fully gone when closed.
- The hover preview is a small tooltip near the hovered link, separate from the panel. It works whether the panel is open or closed.

### Variables tab

- A flat list of leaf paths (`gold`, `player.stats.str`, `inventory.0`) with their current values. Internally a path is an array of keys (stored as JSON), so keys with dots or spaces work; the dotted form is only for display and search. *(Builder-check call.)*
- Map, Set and Date values are shown read-only in v1 (no edit, no freeze). Their changes still show up in the diffs. *(Builder-check call.)* One search box matches the path or the value as text.
- Editing a value: numbers, strings and booleans are edited in place. Typing a value that isn't valid JSON is treated as a string. Objects and arrays are edited by editing their leaves.
- Each row has a freeze toggle. Numbers also get −, + and "set to…".
- The list refreshes on every `:passageend`, and when the panel opens.

### Freeze

- Stored per game: `{ path: value }`. After every `:passageend`, each frozen value is written back. Also before rendering (`:passagestart`), so the passage text sees the frozen value.
- If a frozen path no longer exists (the game removed it), it is recreated.
- Writes go into the current moment (`State.variables`), so they are saved in history and saves. Going Back or loading an old save can show unfrozen values until the next passage change re-applies them. That's acceptable. Only story variables (`$`) can be frozen, not temporary `_` variables. *(Builder-check call.)*

### Hover preview (approach A)

- Link sources are captured as links are created, not by matching DOM text afterwards:
  - Wiki links `[[text|dest][$x to 5]]`: wrap `Wikifier.helpers.shadowHandler(code)` so the function it returns remembers `code`. Then wrap `Wikifier.createInternalLink(el, passage, text, setFn)` so the link element it creates stores the destination and `setFn`'s remembered code.
  - `<<link>>` / `<<button>>` (and their `linkreplace`/`linkappend`/`linkprepend` relatives when present): wrap the macro handler. After it runs, the newly added `a`/`button` in `this.output` stores `this.payload[0].contents` (the body source) and the destination argument.
  - Hooks are installed in a `DOMContentLoaded` listener added at document-start. If SugarCube has already started anyway (a late script injection), install them but don't re-render: `Engine.show()` replays the passage and would run its `<<set>>`s twice. Hover info then starts at the next passage. *(Changed after review.)*
- When hovering a link, collect its code: the setter, the macro body, and the destination passage's text (`Story.get(dest).text`). Extract:
  - `<<set …>>`, `<<unset …>>` and setter expressions. Split on commas/semicolons at depth 0 and handle `to`, `=`, `+=`, `-=`, `*=`, `/=`, `++`, `--`.
  - Compute the right-hand side against a deep copy of the current variables with `Scripting.evalTwineScript` (temporary `_vars` included). If evaluating throws, show the raw expression.
  - Assignments nested inside `<<if>>`/`<<else>>`/`<<switch>>` are marked "maybe".
  - Links whose setter code was never seen (e.g. macros or widgets that call `createInternalLink` with their own function) show only the destination passage's changes plus "runs code". *(Builder-check call.)*
  - `<<run …>>`, `<<script>>` and `<<goto>>` are listed as "runs code: …" or "jumps to …", without being run.
- The tooltip shows the destination passage name (goal 7), then one line per change: `path: old → new` (or `path: = expression`), with a "maybe" or "runs code" tag where it applies.

### Passages tab

- `Story` passages, excluding special and script passages (tagged `script`, `stylesheet`, `widget`, plus `StoryInit`, `StoryCaption`, etc.). Searchable by name. Clicking one calls `Engine.play(name)`.

### Log tab (change log)

- On every `:passageend`, diff a snapshot of the variables against the previous one. Show the latest diff, plus the last ~20 passages, newest first: `passage name → path: old → new`.

### Watch tab

- **Start**: take a deep snapshot of the variables. While watching, diff after every `:passageend` and record every path that changed, with its first old value and its latest new value.
- **Stop**: list every changed path as old → new. A path whose final value equals the start value is marked "changed, then reverted". Each row can open that variable in the Variables tab.

### Unlimited undo

- A toggle (saved per game) that sets `Config.history.maxStates` to a large value at startup. If the game disabled history controls, also turn `Config.history.controls` back on. These must be set before the game starts, so this happens in the same early hook. It is set again at `:storyready`, because the game's own script passages run after our hook and may overwrite it. Set `maxStates` before `controls`, since `controls = true` throws when `maxStates` is 1. *(Builder-check call.)*

### Snapshots and diffs

- Deep snapshots use `clone()` (SugarCube's own clone, which handles Map/Set/Date), or `JSON` round-tripping as a fallback. Diffs compare leaf paths. Functions are ignored.

## Left to the builder

- The panel and tooltip live in a shadow DOM root, and key events inside the panel stop propagating, so the game's CSS and key handlers don't interfere. *(Builder-check call.)*
- Hotkey choice, panel styling and positioning (must stay above game UI; `z-index` high, keep it draggable or docked).
- Exact parsing details of `<<set>>` expressions, as long as the cases above work.
- How to show very large values (truncate long strings and arrays).
- The self-check: a small set of asserts for the expression splitter/parser (at least: `$a to 5, $b += 2`, `$x to "a, b"`, `$o.k to [1,2]`, a nested `<<if>>`), runnable without a game.
