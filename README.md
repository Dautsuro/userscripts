# Userscripts

Violentmonkey userscripts for Firefox (PC and Android). Each script has its own folder with its README.

| Script | Runs on | What it does |
|---|---|---|
| [WTR AI Terms](wtr-ai-terms/) | wtr-lab.com | AI ranks translation candidates for novel terms (plus the outdated version, kept as a feature reference) |
| [WTR Glossary](wtr-glossary/) | wtr-lab.com | Keeps your terms in your own glossary, no account term limit |
| [WTR-LAB Rating Filter](wtr-lab-rating-filter/) | wtr-lab.com | Grays out novels under 3.5 stars or 20 reviews |
| [F95zone Rating Filter](f95zone-rating-filter/) | f95zone.to | Grays out games under 3.5 stars or 20 reviews |
| [SugarCube Video Watcher](sugarcube-video-watcher/) | local games | Remembers watched videos; unwatched ones get a cover |
| [SugarCube Cheat](sugarcube-cheat/) | local games | Cheat panel: variables, link previews, passages, undo |
| [YouTube True Theater Mode](youtube-true-theater-mode/) | youtube.com | Theater mode fills the whole page |
| [Clear Site Data](clear-site-data/) | every site | Menu button that wipes everything the site saved |

## Install

Open the `.user.js` file in Firefox with Violentmonkey installed, or add it from its raw URL. For a script with sync (WTR AI Terms, WTR Glossary, SugarCube Video Watcher), Tailscale must be on during install or update, because Violentmonkey downloads `kvsync.js` from the server then.
