# SugarCube Cheat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One userscript that adds a variable editor/freezer, hover preview of link effects, passage jump, change log, variable watcher and unlimited undo to any local SugarCube 2 game.

**Architecture:** A single file, `sugarcube-cheat.user.js`, wrapped in an IIFE like the sibling scripts. It does nothing unless `unsafeWindow.SugarCube` exists at `DOMContentLoaded`. Pure helpers (paths, diff, `<<set>>` parsing) sit at the top and are checked by `console.assert` self-checks at the bottom, the same pattern as `sugarcube-video-watcher.user.js:292`. The UI lives in one shadow-DOM host.

**Tech Stack:** Plain JS, Violentmonkey GM APIs, SugarCube 2.37 API (`State`, `Story`, `Engine`, `Config`, `Wikifier`, `Macro`, `Scripting`, jQuery events).

**Spec:** `docs/superpowers/specs/2026-11-07-sugarcube-cheat-design.md`

## Global Constraints

- Header: `@match file:///*`, `@run-at document-start`, `@grant GM_getValue`, `GM_setValue`, `GM_registerMenuCommand`, `@namespace sugarcube-cheat`, `@version 1.0.0`. No sync, no `@require`.
- Non-SugarCube page → no DOM changes, no errors.
- Game ID: copy `gameId`/`folderId`/`titleId` from `sugarcube-video-watcher.user.js:47-56`.
- GM storage per game: `freeze:<gameId>` → `[[pathJSON, value], …]`; `undo:<gameId>` → boolean.
- A path is an array of keys; stored/compared as `JSON.stringify(path)`; displayed as `a.b.0`.
- Hover preview never runs game code except `Scripting.evalTwineScript` on right-hand sides, against a deep copy.
- Map/Set/Date values: read-only (no edit/freeze), still diffed.

## Review Focus

1. Hover on a link whose code is unknown (custom macro calling `createInternalLink` itself): shows destination + "runs code", no error. → Task 5 check.
2. A `<<set>>` RHS that throws or calls a function (`setup.roll()`): shown as raw expression, no side effects on real state. → Task 2 assert (`evalRhs` uses a copy) + Task 5 check.
3. String values containing `,` `;` `to`: the splitter must not split inside quotes/brackets. → Task 2 asserts.
4. Freezing a path the game later deletes: recreated on next passage. → Task 3 check.
5. Opening the panel while typing in a game `<input>` hotkey: hotkey ignored when focus is in an input/textarea. → Task 3 check.

---

### Task 1: Skeleton, detection, paths, snapshot/diff

**Files:** Create `sugarcube-cheat.user.js`

**Interfaces — Produces:**
- `flatten(obj) -> Array<[path: string[], value]>`: leaves of plain objects/arrays; Map/Set/Date/primitive/null are leaves; functions skipped; cycles skipped (seen-set).
- `pathKey(path) -> string` (= JSON), `pathLabel(path) -> string` (`a.b.0`).
- `getAt(root, path)`, `setAt(root, path, value)` (creates missing objects).
- `snapshot(vars) -> Map<pathKey, value>`: `flatten` of `SC.State.variables`, values cloned with `structuredClone` fallback `JSON`.
- `diff(a: Map, b: Map) -> Array<{key, path, old, new}>` for added/removed/changed (`undefined` for missing); compare with `sameValue` (deep for Map/Set/Date via JSON of their entries).
- `SC` (the `unsafeWindow.SugarCube` object), `$` (`unsafeWindow.jQuery`), `start()` called from a `DOMContentLoaded` listener added at document-start (or at once if `document.readyState !== 'loading'`); if `SC.State` already has a passage (`SC.State.passage`), call `SC.Engine.show()` after installing hooks.

- [ ] **Step 1:** Write self-checks at file bottom: `flatten({a:{b:1},c:[2]})` gives paths `['a','b']` and `['c','0']`; `pathLabel(['a','x.y'])` === `'a.x.y'`; `setAt({}, ['a','b'], 3)` creates `{a:{b:3}}`; `diff` of `{gold:1}`→`{gold:2,x:1}` gives two entries; a cyclic object doesn't throw.
- [ ] **Step 2:** Implement the helpers and the skeleton; run `node -e "globalThis.unsafeWindow={};require('./sugarcube-cheat.user.js')"` (helpers must not touch `document` at load when `document` is undefined — guard the listener with `typeof document`). Expected: no assertion output.
- [ ] **Step 3:** Commit `feat(sugarcube-cheat): skeleton, paths and diff`.

### Task 2: `<<set>>` parser

**Interfaces — Produces:**
- `splitTop(src: string, seps: string) -> string[]`: split at depth 0, ignoring quotes (`'"\``), brackets `()[]{}`.
- `parseAssign(expr: string) -> {target: string, op: 'to'|'='|'+='|'-='|'*='|'/='|'++'|'--'|'unset', rhs: string} | null`; target is `$name.path` / `$name["k"]` text.
- `extractChanges(src: string) -> Array<{target, op, rhs, maybe: bool} | {code: string} | {goto: string}>`: scans `<<set …>>`, `<<unset …>>`, `<<run …>>`, `<<script>>…<</script>>`, `<<goto …>>`; `maybe` = inside an open `<<if>>`/`<<switch>>`/`<<for>>` (track depth by tags). Also accepts a bare setter string (wiki-link setter) via `extractChanges('<<set ' + setter + '>>')` at the call site.
- `evalRhs(change, vars) -> {path: string[]|null, old, new, raw?: string}`: target → path (strip `$`, parse `.k`/`["k"]`/`[0]`); compute on `clone(vars)` via `SC.Scripting.evalTwineScript`; on throw return `{raw: rhs}`.

- [ ] **Step 1:** Self-checks: `extractChanges('<<set $a to 5, $b += 2>>')` → 2 changes, ops `to`,`+=`; `<<set $x to "a, b; c">>` → 1 change, rhs `"a, b; c"`; `<<set $o.k to [1,2]>>` → target `$o.k`; `<<if $q>><<set $z to 1>><</if>>` → `maybe: true`; `<<set $n++>>` → op `++`; `<<run setup.f()>>` → `{code:'setup.f()'}`; `<<goto "End">>` → `{goto:'End'}`; `targetPath('$p["a b"][0].c')` → `['p','a b','0','c']`.
- [ ] **Step 2:** Implement; run the node command from Task 1. Expected: silent.
- [ ] **Step 3:** Commit `feat(sugarcube-cheat): parse <<set>> changes`.

### Task 3: Panel, Variables tab, freeze

**Interfaces — Consumes:** Task 1 helpers. **Produces:** `ui.open()`, `ui.close()`, `ui.toggle()`, `ui.showTab(name)`, `ui.focusVar(pathKey)`; `freezes: Map<pathKey, value>`; `applyFreezes()`.

- Shadow host `div#sc-cheat-host` on `document.documentElement`, `z-index: 2147483647`, panel fixed right side, draggable header, close button. Tabs: Variables · Passages · Watch · Log. Key/click events inside stop propagation.
- Hotkey **Ctrl+Shift+C** (ignored when focus is in input/textarea/contenteditable outside the panel); menu command "SugarCube cheat panel".
- Variables tab: search box (matches label or `String(value)` case-insensitive), list capped at 300 rows with "N more — refine search". Row: label, value input, freeze checkbox, numbers get `−` `+` and step input (default 1). Commit edit on Enter/blur: `JSON.parse` else string; write with `setAt(SC.State.variables, path, v)`; if frozen, update freeze value. Read-only rows for Map/Set/Date.
- `applyFreezes()` on `:passagestart` and `:passageend`; save freezes to GM on change.
- Refresh list on `:passageend` while open.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Check in the game (Task 7 harness): edit a number, freeze it, change it via the game, next passage restores it; freeze a path, `delete` it in console, next passage recreates it; hotkey typed inside a game input does nothing.
- [ ] **Step 3:** Commit `feat(sugarcube-cheat): variable editor and freeze`.

### Task 4: Passages, Log, Watch tabs

**Interfaces — Consumes:** `snapshot`, `diff`, `ui.focusVar`.

- Passages: `SC.Story.filter(p => …)` (fallback `Story.lookupWith`), exclude tags `script`,`stylesheet`,`widget`,`Twine.private`, and names `StoryInit`,`StoryCaption`,`StoryMenu`,`StoryBanner`,`StorySubtitle`,`StoryAuthor`,`StoryTitle`,`StoryData`,`StoryInterface`,`StoryShare`,`PassageReady`,`PassageDone`,`PassageHeader`,`PassageFooter`; search by name; click → `SC.Engine.play(name)`.
- Log: keep `prevSnap`; on `:passageend` push `{passage, changes: diff(prevSnap, cur)}` (skip empty), keep last 20.
- Watch: Start → `watchStart = snapshot()`, `watchSeen = new Map()` (key → {path, old: first old}); each `:passageend` while watching, merge the passage's diff. Stop → rows `label: old → current`, `(changed, then reverted)` when `sameValue(old, current)`; click row → `ui.focusVar`. Also diff once at Stop (catches changes made by clicks without a passage change).

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Check in the game: jump to a passage; Log shows last changes; Watch across 2 passages lists changed vars, a toggled-back var shows "reverted".
- [ ] **Step 3:** Commit `feat(sugarcube-cheat): passages, log and watcher`.

### Task 5: Link tagging and hover preview

**Interfaces — Consumes:** `extractChanges`, `evalRhs`.

- In `start()`, before the game starts: wrap `SC.Wikifier.helpers.shadowHandler` → returned fn gets `fn.__scSrc = code`; wrap `SC.Wikifier.createInternalLink` → `el.__sc = {dest: passage, src: setFn?.__scSrc ?? null, unknown: !!setFn && !setFn.__scSrc}`; wrap handlers of macros `link`,`button`,`linkreplace`,`linkappend`,`linkprepend` (those that exist via `SC.Macro.get`) → after the original runs, the last `a`/`button` added to `this.output` gets `__sc = {dest: this.args[1] or args[0].link, src: this.payload[0].contents}`. Store on a `WeakMap`, not the element, if `__sc` assignment fails.
- `mouseover` delegated on `#passages` (fallback document): nearest element with tag info → tooltip in shadow root: destination name, then lines from `extractChanges(src)` + `extractChanges(Story.get(dest).text)` mapped through `evalRhs`, with `maybe`/`runs code`/`jumps to` tags; `unknown` → "runs code (not readable)". Hide on `mouseout`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Check in the game: hover several links; tooltip values match what actually changes after clicking (compare with Log tab); no game state changes from hovering (snapshot before/after hover equal).
- [ ] **Step 3:** Commit `feat(sugarcube-cheat): hover preview of link changes`.

### Task 6: Unlimited undo, README

- Menu command / panel toggle "Unlimited undo" saved in `undo:<gameId>`; when on: in `start()` and again on `:storyready`, set `Config.history.maxStates = 1000`, then `Config.history.controls = true` (try/catch each).
- README section "SugarCube Cheat" in the style of the others: file, runs on, bullets for each feature, hotkey.

- [ ] **Step 1:** Implement; check Back works past the game's old limit after reload.
- [ ] **Step 2:** Commit `feat(sugarcube-cheat): unlimited undo, readme (1.0.0)`.

### Task 7: In-game check harness (used by Tasks 3–6)

Violentmonkey isn't in the browser pane. Serve `C:\Games\Become Someone\v1.95` over a local HTTP server (e.g. `npx http-server -p 8765`), open it in the pane, and inject the script with GM shims (`GM_getValue/GM_setValue` over an object, `GM_registerMenuCommand` no-op, `unsafeWindow = window`). Because the game has already started, `start()` takes the `Engine.show()` path. Final check is the user installing it in Violentmonkey and opening a game via `file:///`.
