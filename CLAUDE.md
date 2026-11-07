# Userscripts

Violentmonkey userscripts, run in Firefox on the user's PC and Android phone.

## Storing data: the personal sync server

Scripts that need data shared between devices use the user's own PocketBase server, not just `GM_setValue`.
Server repo and operations: `C:\Projects\databases` (see its README.md and CLAUDE.md).
Worked example: `wtr-ai-terms.user.js` — copy its patterns.

### Header

```
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener   (only if the script keeps in-memory copies; see "Two tabs")
// @grant        GM_registerMenuCommand
// @connect      100.125.40.99
// @require      http://100.125.40.99:8090/kvsync.js
```

`100.125.40.99` is the PC's Tailscale IP. Use the IP, not a `*.ts.net` name: the phone's Google Private DNS breaks Tailscale names.
Violentmonkey caches `@require` at install, so the device must reach the server (Tailscale on) when the script is installed or updated.

### API (`pb_public/kvsync.js` in the databases repo)

```js
const kv = syncUrl && syncToken && typeof KvSync !== 'undefined'
  ? KvSync.create({ app: 'my-script', url: syncUrl, token: syncToken }) : null;
kv.get(key)              // value, or undefined if missing/deleted
kv.set(key, value)       // local at once, pushed later (debounced)
kv.remove(key)           // tombstone, syncs too
kv.entries(prefix)       // [[key, value], ...] for keys starting with prefix
kv.onChange((key, value, deleted) => {})  // only for changes coming from the server
kv.start()               // sync now, every 60 s, on focus/online
kv.resync()              // re-push everything (after a server restore or URL change)
kv.status()              // { lastOkAt, lastError } — show it in the settings dialog
```

Offline-first: everything works with the PC off; changes sync when it is back. Conflict rule: per key, the latest change wins.

### Rules

- One unique `app` name per script. Every script shares one `kv` table; `app` keeps them apart.
- Keys are small, one per entry, never a whole map in one key (latest-wins would erase the other device's entries). Build keys as JSON arrays: `JSON.stringify(['checked', novelId, hash])`. Max 2000 chars: `set` throws above that, so check the length first and keep the entry local-only.
- Sync is optional: with no URL/token, or if `KvSync` failed to load, the script must behave exactly as without sync (`kv` is `null`; guard every call).
- Never sync device-local settings: `syncUrl`, `syncToken`, API keys.
- Settings dialog: add "Sync server URL" and "Sync token" fields stored with `GM_setValue('syncUrl'/'syncToken')`, plus the `kv.status()` line. Add a "resync with server" menu command when sync is on.
- Validate values coming from `onChange` before using them (anyone with admin access can edit rows); ignore what doesn't fit.
- First run on a device with existing local data: push it with `kv.set(key, value, 1)` (timestamp 1), so real edits on any device win over old data.
- Two tabs: if the script keeps maps in memory and saves them whole with `GM_setValue`, listen with `GM_addValueChangeListener` and refresh the in-memory copy when `remote` is true, or a stale tab overwrites synced data.
- Many writes at once (bootstrap, reset): batch them; see `kvBatched` in the light script.

### Tokens

Each device needs a token. Generate one on the PC, from `C:\Projects\databases`:

```
node scripts/admin.mjs token <device-name>
```

It writes `.secrets\token-<device-name>.txt` and prints only the path. Never print, log or commit a token. The user pastes it into the script's settings.
