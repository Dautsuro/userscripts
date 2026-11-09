# SugarCube Cheat

File: `sugarcube-cheat.user.js` · runs on local files (`file:///*`), only acts in SugarCube 2 games

A cheat panel for any SugarCube game. **Alt+C** (or the Violentmonkey menu) opens it.

- **Variables**: every story variable, nested ones too (`mc.money`). Search by name or value, edit (type JSON; anything else is saved as text), − / + with a step, and ❄ to freeze. A frozen value is put back after every passage. Freezes are saved per game.
- **Hover a link or button** to see where it goes and what it will change (`mc.money: 2000 → 1000`). It reads the game's `<<set>>` code without running it, and works out `<<if>>` / `<<switch>>` conditions from the current values, so it only lists the branch that will run. A condition that needs one of the game's own functions can't be worked out; those changes say what they depend on, e.g. `(only if: between 20:00 and 21:59)` or `(only if: isNight)`. When the link also runs game code, it says it may change more than shown.
- **Passages**: every passage, searchable, click to jump there.
- **Watch**: click Start, play, click Stop. It lists every variable that changed, including ones that changed and went back.
- **Log**: what the last 20 passages changed.
- **Unlimited undo** (panel footer, per game): raises the history limit to 1000 steps and turns Back on.
