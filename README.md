# Breakout New Tab

A Chromium (Chrome / Edge / Brave) extension that turns every new tab into a quick game of Breakout. Ships with three themes — **Glassy**, **Neon arcade**, and **Paper sketch**.

## Install (unpacked, for development / personal use)

1. Open `chrome://extensions` in Chrome (or the equivalent `edge://extensions`, `brave://extensions`).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**.
4. Select the `breakout-extension/` folder.
5. Open a new tab — you should see the clock, search box, and the game.

To uninstall, just hit **Remove** on the card in `chrome://extensions`.

## Using it

- **Click and hold** on the board, then drag left/right to move the paddle.
- **Click once** (or **Space**) launches the ball.
- **Endless mode**: new rows keep spawning as you clear them; score multiplies by current level.
- **Width slider** under the board lets you resize the canvas live (480– 1280px). Saved to settings.
- **M** toggles sound (speaker icon top-right also does this).
- **Alt+B** toggles the game on/off.
- **Theme pills** in the top-right switch between Glassy / Neon / Paper live.
- Search box routes to Google (or directly to a URL if you paste one in).

## Settings

Right-click the extension icon → **Options** (or find it on `chrome://extensions`). From there you can:

- Switch theme
- Change board width
- Mute/unmute sound
- Show/hide the bookmarks strip
- See your all-time high score
- Reset high score

## File layout

```
breakout-extension/
├── manifest.json         # MV3 manifest, newtab override, Alt+B command
├── background.js         # Service worker — relays the Alt+B command
├── newtab.html           # The new-tab page
├── newtab.css            # All three themes
├── newtab.js             # Game engine + shell (vanilla JS / Canvas)
├── options.html          # Settings page
├── options.js            # Settings logic
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

## Customising bookmarks

Bookmarks are currently a hardcoded strip in `newtab.html` (`<nav class="bookmarks">`). Edit the list there to change them. A future version could pull from `chrome.bookmarks` with an added permission.

## Notes

- No build step, no runtime dependencies — everything is plain JS, CSS, HTML. Safe under MV3's default CSP.
- High score and settings live in `chrome.storage.sync`, so they follow your Chrome profile across devices.
- The keyboard shortcut can be re-bound from `chrome://extensions/shortcuts`.
