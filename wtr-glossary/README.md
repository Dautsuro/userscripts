# WTR Glossary

File: `wtr-glossary.user.js` · runs on `https://wtr-lab.com/*`

Keeps your WTR-LAB terms in your own glossary instead of the site's, so the account's term limit no longer applies. No AI, no cost.

- Use WTR-LAB's own term tools as usual (tooltip picks, term editor, global or this novel only, edit, delete, multi-delete). The script answers those requests itself; nothing is saved to WTR-LAB.
- Your terms show as the site's user terms, so the Display settings for user vs system terms still apply.
- The first time it runs on a device, it copies your existing WTR-LAB terms in (it leaves them on WTR-LAB).
- Limit: a term only shows where WTR-LAB marked that word as a term in the chapter.
- Optional sync between devices through the personal PocketBase server (see [CLAUDE.md](../CLAUDE.md)). Settings: Violentmonkey menu, **WTR Glossary settings**; with sync on, the menu also has **resync with server**.

Self-check: `node wtr-glossary.user.js`.
