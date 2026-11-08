# WTR Glossary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lightweight userscript that answers WTR-LAB's term API calls itself, so the user's glossary lives in GM storage + the personal sync server with no account term limit.

**Architecture:** At document-start, replace the page's `fetch`. Term writes are answered locally; the user-config read is fetched for real and its `config.terms` replaced. Terms sync per entry through KvSync.

**Tech Stack:** Violentmonkey userscript (Firefox PC + Android), KvSync (`@require`), no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-08-wtr-glossary-design.md`

## Global Constraints

- File `wtr-glossary.user.js`, `@namespace wtr-glossary`, `@match https://wtr-lab.com/*`, `@run-at document-start`, version `1.0.0`.
- Header grants per `CLAUDE.md` (GM_xmlhttpRequest, GM_getValue, GM_setValue, GM_addValueChangeListener, GM_registerMenuCommand, `@connect 100.125.40.99`, `@require http://100.125.40.99:8090/kvsync.js`).
- Sync app name `wtr-glossary`; key `JSON.stringify(['term', id])`; skip sync when key > 2000 chars.
- No AI, no network calls other than the site's own and the sync server.
- Never send a term write to WTR-LAB; never delete the account's server terms.

## Verified site facts (dry run, 2026-11-08)

- Stored term (`user_terms_v2`, `config.terms`): `[id, to, from, case, filter, source, source_id, source_hash]`; `filter` is an array of serie ids (`[]` = global). Object form `{id,to,from,...}` is also parsed, but use the array.
- `POST /api/v2/user/config/term` body `{term:{from,to,case,filter,source,source_id,source_hash}, lang}`.
- `PUT /api/v2/user/config/term/:id` body `{term, lang}`. `DELETE /api/v2/user/config/term/:id`. `POST /api/v2/user/config/terms/delete` body `{ids}`.
- Every write expects `{success:true, config:{terms}}`; the site then stores `terms` in `user_terms_v2` itself.
- `GET /api/v2/user/config` → `{success, config:{terms, version, date}}`. The reader reads `user_terms_v2` from localStorage at mount (stored JSON, via a cookie/storage helper — set it with `localStorage.setItem` and confirm it renders).

## Review Focus

1. Novel-only vs global term on the same source: both kept as separate entries; the site picks (filtered first). Test: add both, list keeps both.
2. Edit of an id we don't have (stale tab): treat as add with that id. Test in Task 1.
3. Malformed sync value from `onChange` (not a valid term array): ignored. Test in Task 1 (`validTerm`).
4. Sync off / KvSync missing: everything works on GM storage alone (guard every `kv` call).
5. Two tabs: tab B's in-memory map refreshed via `GM_addValueChangeListener` (remote), or B overwrites A's adds.

---

### Task 1: Term store + request handler (pure logic, self-checked)

**Files:** Create `wtr-glossary.user.js`

**Interfaces — Produces:**
- `validTerm(t) -> boolean`: array, `t[0]` string id, `t[1]`/`t[2]` non-empty strings ≤128 chars, `t[4]` array or nullish.
- `toStored(id, term) -> array`: request `term` object → stored array (filter: array as-is; `{serie_id}` → `[serie_id]`; missing → `[]`).
- `handle(method, path, body, terms) -> {terms, changed: [[id, termOrNull], ...]} | null`: `terms` is `{id: storedArray}`; returns `null` for paths it does not own. New ids: `'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)`.
- `list(terms) -> array` of stored arrays.

- [ ] **Step 1:** Write `console.assert` self-checks at the bottom (run only when `typeof document === 'undefined'`): POST adds one with the given filter; PUT on known id replaces to/from/filter, keeps id; PUT on unknown id adds it; DELETE removes; bulk delete removes listed ids only; `GET /api/v2/user/config` and `/api/v2/term-preferences` → `null`; `validTerm` rejects `null`, `['x']`, `[1,'a','b']`, a 129-char `to`.
- [ ] **Step 2:** `node wtr-glossary.user.js` → assertion failures (functions missing).
- [ ] **Step 3:** Implement the four functions; wrap browser-only code in `if (typeof document !== 'undefined')`.
- [ ] **Step 4:** `node wtr-glossary.user.js` → no output.
- [ ] **Step 5:** Commit `feat(wtr-glossary): term store and request handler`.

### Task 2: Fetch proxy, storage, sync, settings

**Files:** Modify `wtr-glossary.user.js`

**Interfaces — Consumes:** Task 1 functions.

- [ ] **Step 1:** Storage: `terms = GM_getValue('terms', {})`; `save()` writes GM + `localStorage.user_terms_v2 = JSON.stringify(list(terms))` (set at start too, before the site mounts). `GM_addValueChangeListener('terms', (k, o, n, remote) => remote && (terms = n))`.
- [ ] **Step 2:** Proxy: replace `window.fetch` (page window; use `unsafeWindow` if the script runs in content scope, with `exportFunction` on Firefox). For `handle(...) !== null` → apply, `save()`, `kv.set`/`kv.remove` per `changed`, return `new Response(JSON.stringify({success:true, config:{terms:list(terms)}}), {status:200, headers:{'Content-Type':'application/json'}})`. For `GET /api/v2/user/config` → real fetch, then on first run (`!GM_getValue('imported')`) import valid server terms (`kv.set(..., 1)`), set `imported`; return the reply with `config.terms = list(terms)`. Anything else → original fetch. Parse `body` only when it's a string; on any error fall through to the original fetch for reads, but for writes still answer locally (never leak a write).
- [ ] **Step 3:** Sync per `CLAUDE.md`: `kv` guarded; `onChange` → validate with `validTerm`, apply/delete, `save()`; `kv.start()`. Menu "WTR Glossary settings" (URL, token, `kv.status()` line, term count) and "resync with server" when sync is on. Bulk import uses a batched write (see `kvBatched` in `wtr-ai-terms.user.js`).
- [ ] **Step 4:** Verify in the pane on a chapter: pick a candidate → "Term saved successfully", span `text-patch user_term` shows it, no request to `/api/v2/user/config/term` in network log; edit, delete, bulk delete from "Edit Terms" behave the same; reload → term persists.
- [ ] **Step 5:** `node wtr-glossary.user.js` still silent. Add README section. Commit `feat(wtr-glossary): proxy the site's term API to our glossary (1.0.0)`.
