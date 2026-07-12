# Installing / Updating Mayhem Overlay

## The easy way (recommended)

Download the latest `Mayhem-Overlay-Setup-<version>.exe` from
https://github.com/zp96-cmd/mayhem-overlay/releases and run it. That's it:
no Node.js, no terminal. It creates a desktop shortcut and **updates itself**
from then on (checks GitHub for new versions automatically).

Windows SmartScreen may warn on first run (the installer is unsigned):
click "More info" then "Run anyway".

Your saved builds, history, and ratings survive every update — they live in
`%APPDATA%\Mayhem Overlay\`, separate from the app.

Run League in **Borderless** mode (Settings → Video) so the overlay can draw over it.

## From source (dev)

```
git clone https://github.com/zp96-cmd/mayhem-overlay
cd mayhem-overlay
npm install
npm start
```

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
