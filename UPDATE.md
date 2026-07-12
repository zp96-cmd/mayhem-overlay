# Updating Mayhem Overlay to v0.2.0

## If you're updating from an older version

1. **Close the overlay** (tray icon → Quit).
2. Unzip this archive **over your existing `LoLmayhemtool` folder**, replacing all files.
3. Open a terminal in that folder and run:
   ```
   npm install
   ```
   (Required — this version added OCR and image libraries.)
4. Start it with `Launch Mayhem Overlay.bat`, or make your own shortcut to
   `node_modules\electron\dist\electron.exe` with the project folder as the argument.

Your saved builds, history, ratings, and window positions are safe — they live in
`%APPDATA%\lol-mayhem-overlay\`, not in this folder.

## If this is a fresh install

1. Install [Node.js](https://nodejs.org) (LTS).
2. Unzip anywhere, open a terminal in the folder:
   ```
   npm install
   npm start
   ```
3. Run League in **Borderless** mode (Settings → Video). See README.md for everything else.

## What's new in v0.2.0

- On-screen augment stat pills (win rate / pick rate / ★ best pick) drawn over the
  actual choice cards via local OCR, with automatic pick detection
- PRIORITY panel: best augments still in the pool this game (seen ones excluded)
- In-game NEXT item strip near the bottom HUD, affordability-aware
- Item suggestions from your winning games first, then aramgg community data (core,
  starting, situational) — no more heuristic guessing
- Champ select: win-rate pills on bench + team, ★ swap suggestions
- Mayhem Prep window for a second monitor: champion stats, bench comparator,
  augment hot list, build paths, splash-art header
- aramgg.com community data integration (augment/champion win rates, patch-refreshed
  via `npm run fetch-data`)
- Full Hextech visual redesign, self-hosted Outfit font
- Clickable 📷 SCAN button during games (global hotkeys are blocked by Vanguard in-game)

## After every LoL patch

Run `npm run fetch-data` once to refresh augments, items, and win-rate data.
