# WTR Glossary — design

## Why
WTR-LAB caps how many user terms an account can save, and the cap is enforced on the server. The user wants
their own glossary, stored on their personal PocketBase sync server, with no limit, working on PC and phone.

## Goals
- A standalone, lightweight userscript (`wtr-glossary.user.js`), separate from `wtr-ai-terms`.
- The site's own term editor keeps working: add (global or one novel), edit, delete, bulk delete.
- Those actions go to our store and sync server only; WTR-LAB's glossary is never written.
- Our terms render as the site's native user terms, so the user's styling (system terms colored,
  user terms default) still tells verified from unverified terms.

## Non-goals / anti-goals
- No AI, no paid API, nothing with a running cost.
- No custom term rendering or styling.
- Never deletes or changes the terms on the WTR-LAB account.

## Constraints
- A term only shows where the server made a placeholder (`※N⛬`) for that source; the server decides
  placeholders, so a term for a word that is plain English in the chapter has no effect.
- House sync rules from `CLAUDE.md` (KvSync, one key per entry, optional sync, settings fields).

## Approaches
1. **Fetch proxy (picked).** Replace the page's `fetch` at document-start. Patch the term list in the
   `GET /api/v2/user/config` reply; answer the four write calls ourselves. Native UI, smallest code.
2. DOM rewrite (as `wtr-ai-terms` does). Cannot capture the native editor without also blocking its
   calls, so it would need approach 1 anyway plus its own rendering. Rejected.

## Design
- Intercepted calls (site code, `ConfigProvider`):
  - `GET /api/v2/user/config` → real request, `config.terms` replaced with ours.
  - `POST /api/v2/user/config/term` `{term:{from,to,filter?}, lang}` → add.
  - `PUT /api/v2/user/config/term/:id` `{term, lang}` → edit.
  - `DELETE /api/v2/user/config/term/:id` → delete.
  - `POST /api/v2/user/config/terms/delete` `{ids}` → bulk delete.
  Write calls reply `{success:true, config:{terms}}` without contacting WTR-LAB.
- Term list format: the site's own array form (`[id, to, from, …, filter]`, confirmed on a real account).
- Store: `GM_setValue('terms', {id: term})`; sync app `wtr-glossary`, key `["term", id]`.
- First run on a device: import the account's existing terms from the real config reply, pushed with
  timestamp 1 so real edits win.
- Settings dialog: Sync URL, Sync token, status line; "resync with server" menu command when sync is on.

## Left to the builder
Id format, how the reply `Response` is built, and the settings dialog layout.
