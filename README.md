# Mayhem Overlay

A transparent always-on-top overlay for **ARAM: Mayhem** that suggests augments, tracks
your augment/build history, and lets you save builds you see from other players.

## Quick start (from source)

```
npm install
npm start
```

Patch data ships with the repo and **updates itself**: on launch the app compares the
installed LoL patch against its data and refreshes automatically when Riot ships a new
one. Manual refresh: the **Update patch data** button (History tab) or the tray menu.
(`npm run fetch-data` still works for dev use.)

## Installer (for sharing)

```
npm run dist
```

Produces `dist/Mayhem-Overlay-Setup-<version>.exe` — a one-click Windows installer.
The installed app is fully self-contained (no Node.js needed), creates a desktop
shortcut, and keeps its patch data fresh through the built-in updater. To ship an
update to someone, just send them the new Setup exe; installing over the old version
preserves their history, saved builds, and ratings.

A slim panel appears on the right of your screen. Run League in **Borderless** or
**Windowed** mode (Settings → Video) — overlays can't draw over Exclusive Fullscreen.

To try it without a game running: `npm run start:mock` (simulated Jinx game that
levels up fast so augment prompts fire).

## Hotkeys

| Keys | Action |
| --- | --- |
| `Ctrl+Alt+O` | Show / hide the overlay |
| `Ctrl+Alt+X` | Toggle click-through (mouse goes through the panel) |
| `Ctrl+Alt+A` | Open the augment picker + focus search |
| `Ctrl+Alt+S` | 📷 Scan the screen (OCR) to detect the offered augments |

Riot's Vanguard can block global hotkeys while the game window has focus. The overlay
therefore also shows a small **📷 SCAN button** at the top of the screen during games —
clicking it triggers a scan without stealing focus from the game (position:
`scanBtnPos` in settings.json). If hotkeys fail to register at all, the panel footer
shows a warning.

## How it works

- **Augments tab** — all 222 Mayhem augments (Silver/Gold/Prismatic) with live-updated
  scores. When you hit an augment level (3 / 7 / 11 / 15) the overlay prompts you, and
  when the choice screen appears (on your next death) it **auto-scans the screen with
  local OCR** to detect the three offered augments and drops them straight into the
  compare tray — hit **pick** on the one you take. If auto-detection misses, press
  `Ctrl+Alt+S` to rescan or just type a few letters of each name.

  When a scan succeeds, **stat pills appear directly over the augment cards on screen**
  (win rate, pick rate, score, ★ BEST PICK) via a fully click-through layer — no need to
  glance at the panel. If you mouse over the reroll button area and leave it (i.e. you
  rerolled), the overlay rescans automatically ~1.6s later and updates the pills.
  **Picking in-game is detected automatically**: when your cursor visits a card and the
  cards then disappear, that augment is recorded as your pick and the pills clear on
  their own — no panel interaction needed. (A periodic check also clears them if the
  pick couldn't be attributed.)

  A **PRIORITY panel** on the left of the screen shows the best augments *still in the
  pool* — every augment that has appeared in an offer this game is excluded (once shown,
  it can't reappear), and panel entries in the current offer get a cyan outline. Use it
  to judge whether to reroll: if the priority list beats your current offer, roll.
  Seen augments are also marked **GONE** and sunk to the bottom of the panel's augment
  list. Scores blend:
  - tier baseline (Prismatic > Gold > Silver)
  - fit with your current champion's class (AD/AP/tank/etc. keyword analysis)
  - synergy with augments you've already picked this game
  - your personal win rate with that augment (from history)
  - your own star ratings (click the stars — they override the baseline)
- **Build tab** — suggested build paths, best first:
  - **COMMUNITY** — aramgg.com's build variants for your champion, picked to match what
    you're *actually building* (your owned items' stats, price-weighted, decide whether
    you get e.g. the AP or the on-hit variant). Owned core items are ✓-dimmed, the next
    one is highlighted (green glow = you can afford it right now).
  - **SAVED / MY WIN** — builds you saved and your past winning builds on that champion.
  Suggestions come **only from real data** — your games, your saves, or aramgg. No
  synthetic guessing: a champion with no data shows an empty state instead.
  Also shows every player's live items with a 💾 button to save their build.
  The same "what to build next" list is drawn **in-game as a small NEXT strip** near your
  bottom-HUD stats (click-through) — first item highlighted, green when you can afford it.
  It updates live as you buy items and gain gold.
- **History tab** — hit **Sync from client** while the League client is open to pull your
  recent ARAM Mayhem games (champion, W/L, KDA, augments, final items) via the local LCU
  API. Also syncs automatically ~20s after each game ends.
- **Saved tab** — your saved-build library.

## Data sources (all local / community — no Riot API key needed)

- Static augment/champion/item data: [CommunityDragon](https://raw.communitydragon.org)
  + augment descriptions from the [LoL Wiki](https://wiki.leagueoflegends.com/en-us/Module:MayhemAugmentData/data)
  (`npm run fetch-data` regenerates `data/*.json`)
- Live game state: Riot's Live Client Data API (`https://127.0.0.1:2999`)
- Match history / client phase: the local LCU API (lockfile auth)

Note: Riot's *public* API blocks ARAM Mayhem (queue 2400), which is why history comes
from your own client. No local API exposes which 3 augments you're being offered, so the
overlay reads them off the screen with **local OCR** (tesseract.js — nothing leaves your
machine): screenshot → crop the centre band → grayscale/invert → OCR → fuzzy-match
against the 222 known augment names. Because the vocabulary is closed, even rough OCR
matches reliably. It's passive screen-reading (no memory reading, no input automation).
If detection ever misfires, the debug capture is saved to
`%APPDATA%/lol-mayhem-overlay/last-ocr-capture.png` — check it to tune what the scan sees.
You can also test the pipeline offline: `node scripts/test-ocr.mjs <screenshot.png>`.

## Prep screen (second monitor)

When champ select starts, a **Mayhem Prep** window opens automatically (also available
any time from the tray menu). Park it on your second monitor — size and position are
remembered. It follows whichever champion you currently hold and updates live when you
swap or reroll:

- **Header** — aramgg win rate, tier, pick rate and games for your champion, plus your
  personal record (W-L and average KDA from your synced history).
- **Bench — swap options** — every bench champion sorted by win rate, with your own
  record on each; champions that out-rate your current pick get a green **SWAP ▲** flag.
- **Augment hot list** — top ~14 augments for this champion by champion-specific win
  rate (min 200 games), with bars, tier chips, and "me: X% in N" markers where you have
  personal history.
- **Build paths** — your winning consensus first, then saved builds (with their
  augments), then aramgg's variants: win-rate bar, most-played core (with its own WR),
  starting items, and the situational pool.

The window closes itself when the game starts (the in-game overlay takes over). Set
`prepAutoOpen: false` in settings.json to only open it from the tray.

## Champ select

During ARAM Mayhem champ select, win-rate pills appear under every champion: the
**AVAILABLE CHAMPIONS bench** across the top and each **teammate's pick** on the left
(win % + tier from aramgg, colored green/amber/red). Your own pill gets a blue border;
the best bench champion gets a green ★ when it out-rates what you're holding — that's
your swap signal. Data comes from the LCU champ select session (bench + team champion
IDs), positions from the client window location, refreshed every ~2.5s (rerolls and
trades update automatically). If pills sit misaligned on your client size, adjust the
`csLayout` fractions in settings.json.

## Tuning the screen regions

Two regions in `%APPDATA%/lol-mayhem-overlay/settings.json` (fractions of screen size):

- `ocrRegion` — where the augment cards are scanned. Default `{ "x": 0.12, "y": 0.22, "w": 0.76, "h": 0.56 }`.
- `rerollZone` — the area treated as "the reroll button"; cursor dwell + exit here
  triggers a rescan. Default `{ "x": 0.38, "y": 0.72, "w": 0.24, "h": 0.18 }`.
- `buildStripPos` — top-left anchor of the in-game **NEXT items strip** shown near the
  bottom-HUD stats. Default `{ "x": 0.245, "y": 0.895 }`.

Check `last-ocr-capture.png` in the same folder to see exactly what the last scan saw.

## Storage

History, saved builds, ratings and window position live in
`%APPDATA%/lol-mayhem-overlay/*.json`. Delete a file to reset it.
