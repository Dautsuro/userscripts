# Clear Site Data

File: `clear-site-data.user.js` · runs on every site and local `file://` pages

Violentmonkey menu, **Clear ALL data for this site**: after a confirm, deletes everything the current site saved, then reloads the page.

- Cookies (at every path and parent domain), localStorage, sessionStorage, IndexedDB, Cache Storage, service workers, OPFS files, `window.name`.
- HttpOnly cookies are only deleted if the HTTP-only cookie option is on in Violentmonkey (globally and for this script).
- Can't be reached by a script: the browser's HTTP cache (the reload bypasses it once), other subdomains, storage of third-party iframes, site permissions. For those, use Firefox's "Clear cookies and site data" in the address-bar padlock.
