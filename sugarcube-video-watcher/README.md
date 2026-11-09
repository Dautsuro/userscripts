# SugarCube Video Watcher

File: `sugarcube-video-watcher.user.js` · runs on local files (`file:///*`)

Remembers which videos you have watched in local HTML games (made for SugarCube, works on any local page). Built for the PC.

- Unwatched videos are hidden behind a flashing **▶ VIDEO** cover, so you can spot them while scrolling. Tap it to play.
- Unwatched videos play with sound and controls, no autoplay or loop. Playing goes fullscreen with the cursor and controls hidden. Space pauses (controls come back), Esc leaves fullscreen, pauses and puts the cover back.
- An unwatched video resumes where you left it (saved on this device only).
- A video counts as watched when it plays to the end. From then on it loops muted with no controls, like a GIF.
- Watched videos are remembered per game (Twine IFID; for other engines the folder name after `Games/`, else the page title without version numbers) and by path inside the game folder, so a new game version in another folder keeps them.
- The game's own autoplay, mute, loop, volume and `play()` calls are overridden.
- A clip that plays but never moves (Firefox GPU decoder stuck on very short clips) is reloaded after 0.75 s without progress, then again at growing gaps (up to 6 times). The console shows `[svw]` lines.
- Optional sync of the watched list between devices through the personal PocketBase server (see [CLAUDE.md](../CLAUDE.md)). Settings: Violentmonkey menu, **Video Watcher settings**.
