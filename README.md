# Retro New Tab

A Chromium (Chrome / Edge / Brave) extension that turns every new tab into a small retro game. Built to be a growing collection — I add games as I get the ideas.

Three visual themes apply to every game: **Glassy**, **Neon arcade**, and **Paper sketch**.

## Games so far

- **Breakout** — endless brick rows, drag or arrow-key paddle, particles on break, power-ups (wider paddle, slow ball, extra life), lives that scale with difficulty.
- **Snake** — classic grid snake, arrow-key steering, gets faster every 5 apples, per-game high score.

The game picker lives in the top-right. Your last-played game is remembered per browser profile.

## Install (unpacked)

1. Open `chrome://extensions` in Chrome (or `edge://extensions`, `brave://extensions`).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**.
4. Select this folder.
5. Open a new tab — clock, search, and the active game should show up.

To uninstall, hit **Remove** on the card in `chrome://extensions`.

## Playing

Shared controls (both games):

- **Arrow keys** — move the paddle / steer the snake
- **Space** — launch ball / start round
- **P** — pause / resume (or click the play/pause button top-right)
- **M** — mute / unmute
- **Alt+B** — toggle the game on/off entirely

Breakout-specific: click and hold on the board, then drag to move the paddle. Catch falling capsules (W / S / +) for power-ups.

Snake-specific: don't hit walls or yourself. Each apple grows the snake by one; every 5 apples bumps the level and speed.

The search box routes to Google; paste a URL and it jumps straight there.

## Settings

Right-click the extension icon → **Options** (or open it from `chrome://extensions`):

- Switch theme
- Switch difficulty (Easy / Normal / Hard)
- Mute / unmute
- Show / hide the bookmarks strip
- See and reset the Breakout high score

## How it's built

The page is split into a **shell** and a **game registry**. The shell hosts everything that isn't game-specific (clock, search, theme, difficulty, pause, mute, HUD, overlay, bookmarks). Each game is a module under `games/` that exports `init(api)` and returns a small interface the shell drives:

```
{ step, render, onKey, onPointer, togglePause, getStatus, onDifficultyChange, destroy }
```

Only the active game module is loaded — `newtab.js` uses dynamic `import()` to fetch it on demand, calls `destroy()` on the old one before switching, and hands the new one a single `api` object carrying the canvas, audio, storage, HUD, overlay, and current theme/difficulty getters. This keeps memory usage flat regardless of how many games are in the registry.

## File layout

```
retro-new-tab/
├── manifest.json          # MV3 manifest, newtab override, Alt+B command
├── background.js          # Service worker — relays Alt+B to the tab
├── newtab.html            # New-tab shell (module entry)
├── newtab.css             # Base styles + three themes
├── newtab.js              # Shell: clock, search, theme, pickers, game loader, loop
├── games/
│   ├── breakout.js        # Breakout game module
│   └── snake.js           # Snake game module
├── options.html           # Settings page
├── options.js             # Settings logic
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

## Adding a new game

1. Create `games/<name>.js` that exports `init(api)` and returns the game interface above.
2. Add one line to the `GAMES` registry in `newtab.js`:

   ```js
   mygame: { name: "My Game", module: "./games/mygame.js" },
   ```

3. Use the passed-in `api` for everything external: `api.canvas` / `api.ctx` to draw, `api.hud.setScore(n)` / `setLevel` / `setLives(full, max)` / `setBest(n)` for the HUD, `api.overlay.show(title, sub)` / `hide()` for the title overlay, `api.audio.blip({freq, dur, type, gain, slide})` for sound, `api.storage.get/set` for persistence, `api.getTheme()` and `api.getDifficulty()` to read the current picks, and `api.onStatusChange(status)` to tell the shell the game went ready / playing / paused / lost.

Games should pick their own storage key namespace (e.g. `snake_best`) to avoid collisions with other games' data.

## Customising bookmarks

Bookmarks are a hardcoded strip in `newtab.html` under `<nav class="bookmarks">`. Edit the list to change them. A future version could pull from `chrome.bookmarks` with an added permission.

## Notes

- No build step, no runtime dependencies — plain JS / CSS / HTML. Safe under MV3's default CSP.
- Settings and high scores live in `chrome.storage.sync`, so they follow your Chrome profile across devices.
- The Alt+B shortcut can be re-bound from `chrome://extensions/shortcuts`.
