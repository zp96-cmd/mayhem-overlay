const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage, Notification, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store } = require('./store');
const { LcuClient } = require('./lcu');
const { LiveClientPoller } = require('./liveclient');
const { ingestRecentMayhemGames, enrichSavedBuilds } = require('./history');
const { scanForAugments } = require('./ocr');
const { getChampionData } = require('./aramgg');
const { getClientRect, buildChampSelectPills } = require('./champselect');

let win = null;
let badgeWin = null;
let tray = null;
let clickThrough = false;

const settings = new Store('settings', {
  bounds: null,
  opacity: 0.94,
});
// in-game session state (picked/seen augments, hidden items) so an overlay
// restart mid-game doesn't wipe progress; cleared when the game ends
const sessionStore = new Store('session', { current: null });
const historyStore = new Store('history', { games: [] });
const buildsStore = new Store('builds', { saved: [] });
const ratingsStore = new Store('ratings', { overrides: {} });

const lcu = new LcuClient();

// Data lives in userData once the in-app updater has run (writable, works for
// installed copies where the bundled data/ sits read-only inside the asar).
// The bundled copy is the fallback so a fresh install works offline.
function userDataDir() {
  return path.join(app.getPath('userData'), 'data');
}
function dataDir() {
  return fs.existsSync(path.join(userDataDir(), 'augments.json'))
    ? userDataDir()
    : path.join(__dirname, '..', '..', 'data');
}
function loadDataFile(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir(), name), 'utf8'));
  } catch {
    return null;
  }
}

// ---------- app self-update (GitHub Releases) ----------
function notify(title, body) {
  try { new Notification({ title, body }).show(); } catch { /* notifications unavailable */ }
}

// Auto-install downloaded updates, but never mid-session: wait until the
// player has been out of game/champ select/queue for a continuous minute
// (which also lets the post-game history sync finish), then restart.
let pendingInstallVersion = null;
let updateSafeTicks = 0;
const BUSY_PHASES = ['ChampSelect', 'GameStart', 'InProgress', 'ReadyCheck', 'Matchmaking', 'EndOfGame'];

function updateSafeToRestart() {
  return !poller.inGame && !BUSY_PHASES.includes(lastPhase ?? 'None');
}

// called from the phase watcher every ~5s
function maybeAutoInstall() {
  if (!pendingInstallVersion) return;
  if (!updateSafeToRestart()) { updateSafeTicks = 0; return; }
  updateSafeTicks++;
  if (updateSafeTicks === 12) { // ~60s continuously idle
    notify('Mayhem Overlay', `Updating to v${pendingInstallVersion} and restarting…`);
    setTimeout(() => {
      try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.quitAndInstall(true, true); // silent install, relaunch after
      } catch (e) { console.log('[update] install failed:', e.message); }
    }, 2000);
  }
}

let updateDownloadedNotified = false;
let manualUpdateRequested = false;

function installNow(version) {
  notify('Mayhem Overlay', `v${version} downloaded. Restarting now…`);
  setTimeout(() => {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.quitAndInstall(true, true);
    } catch (e) { console.log('[update] install failed:', e.message); }
  }, 3000);
}

async function checkAppUpdate(manual) {
  if (!app.isPackaged) {
    if (manual) notify('Mayhem Overlay', `Running from source (v${app.getVersion()}). App updates apply to installed copies only.`);
    return;
  }
  manualUpdateRequested = manual; // a manual check means "update me now"
  try {
    const { autoUpdater } = require('electron-updater');
    if (!updateDownloadedNotified) {
      updateDownloadedNotified = true;
      autoUpdater.on('update-downloaded', (info) => {
        if (manualUpdateRequested) {
          installNow(info.version);
          return;
        }
        // background download: wait for an idle minute before restarting
        pendingInstallVersion = info.version;
        updateSafeTicks = 0;
        notify('Mayhem Overlay update ready',
          updateSafeToRestart()
            ? `v${info.version} downloaded. Restarting in about a minute…`
            : `v${info.version} downloaded. It installs automatically after your game.`);
      });
    }
    const result = await autoUpdater.checkForUpdates();
    const latest = result?.updateInfo?.version;
    if (manual) {
      if (latest && latest !== app.getVersion()) {
        notify('Mayhem Overlay', `Update v${latest} found, downloading. Restarts when ready…`);
      } else {
        notify('Mayhem Overlay', `You're up to date (v${app.getVersion()}).`);
      }
    }
  } catch (e) {
    console.log('[update]', e.message);
    if (manual) notify('Mayhem Overlay', `Update check failed: ${e.message}`);
  }
}

// ---------- in-app patch data updater ----------
const { fetchAllData } = require('./fetch-data-core');

let dataRefreshBusy = false;
async function refreshPatchData(reason) {
  if (dataRefreshBusy) return { ok: false, error: 'already running' };
  dataRefreshBusy = true;
  win?.webContents.send('data:status', { busy: true, reason });
  try {
    const result = await fetchAllData(userDataDir(), (m) => console.log('[data]', m));
    // drop every cache that holds old data
    augmentNamesCache = null;
    champIdByNameCache = null;
    csStats = null;
    try { fs.rmSync(path.join(app.getPath('userData'), 'aramgg-cache'), { recursive: true, force: true }); } catch { /* ignore */ }
    win?.webContents.send('data:status', { busy: false, ok: true });
    win?.webContents.send('data:refreshed');
    // remember the game version this data belongs to
    fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      .then((r) => r.json())
      .then((v) => settings.set('dataPatch', v[0]))
      .catch(() => {});
    return { ok: true, ...result };
  } catch (e) {
    win?.webContents.send('data:status', { busy: false, ok: false, error: e.message });
    return { ok: false, error: e.message };
  } finally {
    dataRefreshBusy = false;
  }
}

// Bump when the shape of the generated data files changes (e.g. items.json
// gaining transform items) so existing installs refresh once after updating.
const DATA_SCHEMA = 2;

// On startup: if Riot shipped a new patch since our data was fetched, refresh.
async function checkPatchOnStartup() {
  if (fs.existsSync(path.join(userDataDir(), 'augments.json')) &&
      settings.get('dataSchema') !== DATA_SCHEMA) {
    const r = await refreshPatchData('data schema upgrade');
    if (r.ok) settings.set('dataSchema', DATA_SCHEMA);
    return;
  }
  settings.set('dataSchema', DATA_SCHEMA);
  try {
    const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
    const latest = versions[0];
    const known = settings.get('dataPatch');
    if (!known) {
      settings.set('dataPatch', latest);
      return;
    }
    if (known !== latest) {
      console.log(`[data] new LoL patch ${known} -> ${latest}, refreshing`);
      const r = await refreshPatchData(`patch ${latest}`);
      if (r.ok) settings.set('dataPatch', latest);
    }
  } catch (e) {
    console.log('[data] patch check failed:', e.message);
  }
}

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const defaultBounds = {
    width: 440,
    height: Math.min(860, display.workArea.height - 80),
    x: display.workArea.x + display.workArea.width - 460,
    y: display.workArea.y + 40,
  };
  const bounds = settings.get('bounds') || defaultBounds;

  win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 'screen-saver' keeps the overlay above borderless-fullscreen games
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // don't persist the tiny collapsed size as the panel's real bounds
  const remember = () => { if (!panelCollapsed) settings.set('bounds', win.getBounds()); };
  win.on('close', remember);
  win.on('moved', remember);
  win.on('resized', remember);
}

// Fullscreen, always-click-through layer that draws stat pills over the
// game's augment cards at the positions OCR found them.
function createBadgeWindow() {
  const display = screen.getPrimaryDisplay();
  badgeWin = new BrowserWindow({
    ...display.bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  badgeWin.setAlwaysOnTop(true, 'screen-saver');
  // Always fully click-through, no mouse forwarding (forwarding lags the

  badgeWin.setIgnoreMouseEvents(true);
  badgeWin.loadFile(path.join(__dirname, '..', 'renderer', 'badges.html'));
}

// Interactive build-strip window: clickable (per-variant minimise buttons)
// but focusable:false so it never steals focus from the game.
let stripWin = null;
function createStripWindow() {
  const d = screen.getPrimaryDisplay();
  const pos = settings.get('buildStripPos') ?? { x: 0.245, y: 0.895 };
  stripWin = new BrowserWindow({
    width: 380, height: 96,
    x: Math.round(d.bounds.x + d.bounds.width * pos.x),
    y: Math.round(d.bounds.y + d.bounds.height * pos.y),
    frame: false, transparent: true, resizable: false, movable: false,
    focusable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  stripWin.setAlwaysOnTop(true, 'screen-saver');
  stripWin.loadFile(path.join(__dirname, '..', 'renderer', 'strip.html'));
}

let badgeTimeout = null;
let badgesActive = false;
let csActive = false;
let celebrateUntil = 0;

function syncBadgeWinVisibility() {
  if (!badgeWin) return;
  if (badgesActive || csActive || Date.now() < celebrateUntil) badgeWin.showInactive();
  else badgeWin.hide();
}

function showBadges(badges) {
  if (!badgeWin) return;
  badgesActive = true;
  badgeWin.webContents.send('badges:data', badges);
  syncBadgeWinVisibility();
  clearTimeout(badgeTimeout);
  badgeTimeout = setTimeout(clearBadges, 30000); // don't linger forever
}
function clearBadges() {
  clearTimeout(badgeTimeout);
  if (!badgeWin) return;
  badgesActive = false;
  badgeWin.webContents.send('badges:clear');
  syncBadgeWinVisibility();
}
function showBuildStrip(data) {
  if (!stripWin) return;
  stripWin.webContents.send('buildstrip:data', {
    ...data,
    locked: settings.get('stripLocked', true),
  });
  stripWin.showInactive();
}
function clearBuildStrip() {
  if (!stripWin) return;
  stripWin.webContents.send('buildstrip:clear');
  stripWin.hide();
}

// Small clickable SCAN button parked at the top of the screen during games.
// focusable:false means clicking it never steals focus from the game — and it
// works even when Vanguard blocks global hotkeys.
let scanBtn = null;
function createScanButton() {
  const d = screen.getPrimaryDisplay();
  const pos = settings.get('scanBtnPos') ?? { x: 0.335, y: 0.002 };
  scanBtn = new BrowserWindow({
    width: 92, height: 26,
    x: Math.round(d.bounds.x + d.bounds.width * pos.x),
    y: Math.round(d.bounds.y + d.bounds.height * pos.y),
    frame: false, transparent: true, resizable: false, movable: false,
    focusable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  scanBtn.setAlwaysOnTop(true, 'screen-saver');
  scanBtn.loadFile(path.join(__dirname, '..', 'renderer', 'scanbtn.html'));
}


// Collapse = shrink the actual window to just the titlebar, not merely hide content
let panelCollapsed = false;
let expandedBounds = null;
const COLLAPSED_HEIGHT = 48;

function setPanelCollapsed(collapsed) {
  if (!win || collapsed === panelCollapsed) return;
  panelCollapsed = collapsed;
  if (collapsed) {
    expandedBounds = win.getBounds();
    win.setResizable(false);
    win.setBounds({ ...expandedBounds, height: COLLAPSED_HEIGHT });
  } else {
    win.setResizable(true);
    const cur = win.getBounds();
    // keep whatever position it was dragged to while collapsed
    win.setBounds({ ...(expandedBounds ?? cur), x: cur.x, y: cur.y });
  }
}

function setClickThrough(enabled) {
  clickThrough = enabled;
  win.setIgnoreMouseEvents(enabled, { forward: true });
  win.webContents.send('overlay:clickthrough', enabled);
}

function toggleVisibility() {
  if (win.isVisible()) win.hide();
  else { win.show(); win.setAlwaysOnTop(true, 'screen-saver'); }
}

function createTray() {
  // 1x1 transparent png fallback; Windows requires some image
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKUlEQVR42mNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaOAAgAAJ8AB/kX7HFsAAAAASUVORK5CYII='
  );
  tray = new Tray(icon);
  tray.setToolTip('Mayhem Overlay');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show/Hide (Ctrl+Alt+O)', click: toggleVisibility },
    { label: 'Toggle click-through (Ctrl+Alt+X)', click: () => setClickThrough(!clickThrough) },
    { label: 'Prep screen', click: openPrepWindow },
    {
      label: 'Celebration sound',
      type: 'checkbox',
      checked: settings.get('celebrationSound', true),
      click: (item) => settings.set('celebrationSound', item.checked),
    },
    {
      label: 'Multikill celebrations',
      type: 'checkbox',
      checked: settings.get('killCelebrations', true),
      click: (item) => settings.set('killCelebrations', item.checked),
    },
    { label: 'Update patch data', click: () => refreshPatchData('tray') },
    { label: 'Check for app updates', click: () => checkAppUpdate(true) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', toggleVisibility);
}

// ---------- OCR offer detection ----------
let augmentNamesCache = null;
function augmentNames() {
  if (!augmentNamesCache) {
    augmentNamesCache = (loadDataFile('augments.json')?.augments ?? [])
      .filter((a) => !a.disabled)
      .map((a) => a.name);
  }
  return augmentNamesCache;
}

let ocrBusy = false;
async function runOcrScan(trigger) {
  if (ocrBusy) return null;
  ocrBusy = true;
  const sendStatus = (s) => {
    win?.webContents.send('ocr:status', s);
    scanBtn?.webContents.send('ocr:status', s);
  };
  sendStatus({ busy: true, trigger });
  try {
    const res = await scanForAugments(augmentNames(), {
      region: settings.get('ocrRegion') ?? null,
    });
    sendStatus({ busy: false, trigger });
    return res;
  } catch (e) {
    sendStatus({ busy: false, trigger, error: e.message });
    return { matches: [], error: e.message };
  } finally {
    ocrBusy = false;
  }
}

// ---------- continuous offer watcher ----------
// Scans are cheap (~0.5s at half res), so instead of waiting for events we
// POLL the whole time an offer is pending (waiting for the choice screen to
// appear) or active (pills up): the screen appearing, a single-card reroll,
// or a pick are all caught within a scan cycle. The mouse watcher remains
// only for pick attribution (which card was hovered) and as an instant kick
// when the cursor leaves the reroll zone or the cards.
let offerActive = false;
let rerollTimer = null;
let lastScanAt = 0;
let inZoneSince = null;
let offerMatches = [];   // matches from the last scan we showed pills for
let lastHoveredCard = null; // { name, at }
let wasInCard = false;
let pendingSince = 0;

const PENDING_SCAN_GAP = 2200;  // ms between scans while waiting for the screen
const ACTIVE_SCAN_GAP = 1300;   // ms between scans while pills are up
const PENDING_TIMEOUT = 4 * 60 * 1000;

function rememberOffer(res) {
  offerMatches = (res?.matches ?? []).filter((m) => m.screen && m.score >= 0.62);
  goneStreak = 0;
}

function setOfferActive(active) {
  offerActive = active;
  if (active && !rerollTimer) {
    rerollTimer = setInterval(watchOfferInteraction, 150);
  } else if (!active && rerollTimer) {
    clearInterval(rerollTimer);
    rerollTimer = null;
    inZoneSince = null;
    lastHoveredCard = null;
    wasInCard = false;
    offerMatches = [];
    clearBadges();
  }
}

// One place decides what a scan result means, whatever triggered the scan.
// A single noisy scan must never clear the pills: we only conclude "picked"
// after TWO consecutive scans that neither find an offer nor weakly re-match
// any card we know is up.
let goneStreak = 0;

function handleScanResult(res, { manual = false } = {}) {
  if (!res) return;
  const good = res.matches.filter((m) => m.score >= 0.7);
  const prevNames = new Set(offerMatches.map((m) => m.name));
  // a known card re-matching even weakly means the screen is still up
  const stillUp = res.matches.some((m) => prevNames.has(m.name) && m.score >= 0.55);

  if (good.length >= 2) {
    goneStreak = 0;
    // an offer is on screen; single-card rerolls mean ONE new name = changed
    const changed = !offerActive || good.some((m) => !prevNames.has(m.name));
    pendingOffer = false;
    if (changed) {
      rememberOffer(res);
      win?.webContents.send('ocr:offer', res);
      activateOffer();
    } else if (manual) {
      win?.webContents.send('ocr:offer', res); // explicit ask: refresh anyway
    }
  } else if (offerActive) {
    if (stillUp) {
      goneStreak = 0; // noisy read, offer's still there — leave pills alone
    } else {
      goneStreak++;
      if (goneStreak >= 2) {
        // two clean misses in a row — an augment was taken
        const picked = lastHoveredCard && Date.now() - lastHoveredCard.at < 20000
          ? lastHoveredCard.name : null;
        pendingOffer = false;
        goneStreak = 0;
        win?.webContents.send('ocr:auto-picked', { name: picked });
        setOfferActive(false);
      }
    }
  } else if (manual) {
    win?.webContents.send('ocr:offer', res); // let the panel say "nothing found"
  }
}

// the always-on scan loop; a no-op unless something is pending or active
setInterval(async () => {
  if (ocrBusy) return;
  if (pendingOffer && Date.now() - pendingSince > PENDING_TIMEOUT) {
    pendingOffer = false;
    return;
  }
  if (!pendingOffer && !offerActive) return;
  const gap = offerActive ? ACTIVE_SCAN_GAP : PENDING_SCAN_GAP;
  if (Date.now() - lastScanAt < gap) return;
  lastScanAt = Date.now();
  const res = await runOcrScan(offerActive ? 'verify' : 'watch');
  handleScanResult(res);
}, 300);

function kickScan() {
  lastScanAt = 0; // next loop tick (≤300ms) scans immediately
}

function watchOfferInteraction() {
  if (!offerActive) return;
  const display = screen.getPrimaryDisplay();
  const p = screen.getCursorScreenPoint();
  const b = display.bounds;

  // reroll zone: leaving it likely means a reroll click — scan right away
  const zone = settings.get('rerollZone') ?? { x: 0.38, y: 0.72, w: 0.24, h: 0.18 };
  const inZone =
    p.x >= b.x + b.width * zone.x && p.x <= b.x + b.width * (zone.x + zone.w) &&
    p.y >= b.y + b.height * zone.y && p.y <= b.y + b.height * (zone.y + zone.h);
  if (inZone && !inZoneSince) inZoneSince = Date.now();
  if (!inZone && inZoneSince) {
    inZoneSince = null;
    setTimeout(kickScan, 500); // brief beat for the new card to animate in
  }

  // augment cards: name bbox expanded to roughly the full card
  let inCard = null;
  for (const m of offerMatches) {
    const s = m.screen;
    if (!s) continue;
    if (p.x >= s.x - 60 && p.x <= s.x + s.w + 60 && p.y >= s.y - 260 && p.y <= s.y + s.h + 300) {
      inCard = m.name;
      break;
    }
  }
  if (inCard) {
    lastHoveredCard = { name: inCard, at: Date.now() };
    wasInCard = true;
  } else if (wasInCard) {
    wasInCard = false;
    setTimeout(kickScan, 400); // maybe they picked — check quickly
  }
}

// ---------- live game + client polling ----------
let lastLevel = 0;
let wasDead = false;
let pendingOffer = false;
const AUGMENT_LEVELS = [3, 7, 11, 15];

let offerActiveTimeout = null;
function activateOffer() {
  setOfferActive(true);
  clearTimeout(offerActiveTimeout);
  offerActiveTimeout = setTimeout(() => setOfferActive(false), 90000);
}

// fetch aramgg champion data once per game when my champion is known
let champDataFor = null;
async function maybeFetchChampData(state) {
  const name = state.me?.championName;
  if (!name || champDataFor === name) return;
  const id = champIdByName().get(name.toLowerCase());
  if (!id) return;
  champDataFor = name;
  try {
    const data = await getChampionData(id);
    win?.webContents.send('aramgg:champdata', data);
  } catch (e) {
    console.log('aramgg champ data failed:', e.message);
    champDataFor = null; // allow retry on next update
  }
}

// ---------- multikill celebrations from the event feed ----------
let lastEventId = -1;
let eventsSeen = false;
const KILL_LABELS = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'QUADRA KILL', 5: 'PENTAKILL' };

function nameMatchesMe(evName, myRiotId) {
  if (!evName || !myRiotId) return false;
  const a = evName.toLowerCase();
  const b = myRiotId.toLowerCase();
  return a === b || a === b.split('#')[0] || b.startsWith(a + '#');
}

function detectMultikills(state) {
  const events = state.events ?? [];
  if (!events.length) return;
  const maxId = Math.max(...events.map((e) => e.EventID ?? -1));
  // first poll of a game: absorb history without firing
  if (!eventsSeen) { eventsSeen = true; lastEventId = maxId; return; }
  const myId = state.me?.riotId || state.activePlayer?.riotId;
  for (const ev of events) {
    if ((ev.EventID ?? -1) <= lastEventId) continue;
    if (ev.EventName === 'Multikill' &&
        ev.KillStreak >= 2 &&
        nameMatchesMe(ev.KillerName, myId) &&
        settings.get('killCelebrations', true)) {
      fireMultikill(Math.min(5, ev.KillStreak));
    }
  }
  lastEventId = maxId;
}

let killCelebrateTimeout = null;
function fireMultikill(streak) {
  if (!badgeWin) return;
  const dur = streak >= 5 ? 6500 : 4500;
  celebrateUntil = Math.max(celebrateUntil, Date.now() + dur);
  badgeWin.webContents.send('multikill:go', {
    streak,
    label: KILL_LABELS[streak] ?? 'MULTIKILL',
    sound: settings.get('celebrationSound', true),
  });
  badgeWin.showInactive();
  clearTimeout(killCelebrateTimeout);
  killCelebrateTimeout = setTimeout(syncBadgeWinVisibility, dur + 100);
}

let scanBtnShown = false;
const poller = new LiveClientPoller(
  (state) => {
    win?.webContents.send('live:update', state);
    maybeFetchChampData(state);
    detectMultikills(state);
    if (!scanBtnShown) { scanBtnShown = true; scanBtn?.showInactive(); }
    const lvl = state.activePlayer?.level ?? 0;
    // crossing an augment breakpoint -> nudge the augment picker open
    const crossed = AUGMENT_LEVELS.find((t) => lastLevel < t && lvl >= t);
    if (crossed) {
      win?.webContents.send('live:augment-breakpoint', { level: crossed });
      pendingOffer = true;
      pendingSince = Date.now();
      kickScan(); // watch loop takes it from here
    }
    lastLevel = lvl;
    // dying often opens the choice screen — scan immediately
    const dead = !!state.me?.isDead;
    if (pendingOffer && dead && !wasDead) setTimeout(kickScan, 600);
    wasDead = dead;
  },
  async () => {
    lastLevel = 0;
    champDataFor = null;
    eventsSeen = false;
    lastEventId = -1;
    setOfferActive(false);
    clearBuildStrip();
    scanBtnShown = false;
    scanBtn?.hide();
    sessionStore.set('current', null); // game over: next game starts fresh
    win?.webContents.send('live:ended');
    // game over -> try to ingest the match into history shortly after
    setTimeout(async () => {
      try {
        const res = await ingestRecentMayhemGames(lcu, historyStore);
        win?.webContents.send('history:updated', historyStore.get('games', []));
        afterIngest();
        console.log('history ingest after game:', res);
      } catch (e) { console.log('history ingest failed:', e.message); }
    }, 20000);
  }
);

// ---------- pre-game prep dashboard ----------
let prepWin = null;

function openPrepWindow() {
  if (prepWin && !prepWin.isDestroyed()) { prepWin.show(); return; }
  const bounds = settings.get('prepBounds') ?? { width: 1150, height: 850 };
  prepWin = new BrowserWindow({
    ...bounds,
    title: 'Mayhem Prep',
    backgroundColor: '#0a0e14',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  prepWin.setMenuBarVisibility(false);
  prepWin.loadFile(path.join(__dirname, '..', 'renderer', 'prep.html'));
  const remember = () => settings.set('prepBounds', prepWin.getBounds());
  prepWin.on('moved', remember);
  prepWin.on('resized', remember);
  prepWin.on('closed', () => { prepWin = null; });
}

function closePrepWindow() {
  if (prepWin && !prepWin.isDestroyed()) prepWin.close();
}

let prepChampFor = null;
async function feedPrep(session) {
  if (!prepWin || prepWin.isDestroyed()) return;
  const myCell = session.localPlayerCellId;
  const me = (session.myTeam ?? []).find((p) => p.cellId === myCell);
  const payload = {
    myChampionId: me?.championId > 0 ? me.championId : null,
    bench: (session.benchChampions ?? []).map((b) => b.championId).filter((id) => id > 0),
    team: (session.myTeam ?? []).map((p) => p.championId).filter((id) => id > 0),
  };
  prepWin.webContents.send('prep:session', payload);
  if (payload.myChampionId && prepChampFor !== payload.myChampionId) {
    prepChampFor = payload.myChampionId;
    try {
      const data = await getChampionData(payload.myChampionId);
      prepWin?.webContents.send('prep:champdata', data);
    } catch (e) {
      console.log('prep champ data failed:', e.message);
      prepChampFor = null;
    }
  }
}

// ---------- champ select win-rate pills ----------
let csTimer = null;
let csRect = null;
let csTick = 0;
let csStats = null;

function startChampSelectWatch() {
  if (csTimer) return;
  csTick = 0;
  csRect = null;
  csStats = csStats ?? loadDataFile('champion-stats.json')?.stats ?? null;
  csTimer = setInterval(champSelectTick, 2500);
  champSelectTick();
}

function stopChampSelectWatch() {
  if (!csTimer) return;
  clearInterval(csTimer);
  csTimer = null;
  csActive = false;
  badgeWin?.webContents.send('cs:clear');
  syncBadgeWinVisibility();
}

async function champSelectTick() {
  if (!csStats) return;
  let session;
  try { session = await lcu.get('/lol-champ-select/v1/session'); }
  catch { return; }
  // the client window can move/resize — re-measure occasionally
  if (!csRect || csTick % 4 === 0) csRect = getClientRect() ?? csRect;
  csTick++;
  if (!csRect) return;

  feedPrep(session);

  const display = screen.getPrimaryDisplay();
  const scale = display.scaleFactor;
  const pills = buildChampSelectPills(session, csRect, csStats, settings.get('csLayout') ?? undefined)
    .map((p) => ({
      ...p,
      x: p.x / scale - display.bounds.x,
      y: p.y / scale - display.bounds.y,
    }));
  if (pills.length) {
    csActive = true;
    badgeWin?.webContents.send('cs:data', pills);
    syncBadgeWinVisibility();
  }
}

let phaseTimer = null;
let lastPhase = null;
function startPhaseWatcher() {
  phaseTimer = setInterval(async () => {
    const connected = lcu.refresh();
    let phase = 'None';
    if (connected) phase = await lcu.gameflowPhase();
    win?.webContents.send('lcu:phase', { connected, phase });
    if (phase === 'ChampSelect') {
      startChampSelectWatch();
      if (settings.get('prepAutoOpen', true)) openPrepWindow();
    } else if (lastPhase === 'ChampSelect') {
      stopChampSelectWatch();
      prepChampFor = null;
      // prep window intentionally stays open through the game as a reference;
      // the user closes it whenever they like
    }
    lastPhase = phase;
    maybeAutoInstall();
  }, 5000);
}

// ---------- IPC ----------
ipcMain.handle('data:augments', () => loadDataFile('augments.json'));
ipcMain.handle('data:champions', () => loadDataFile('champions.json'));
ipcMain.handle('data:items', () => loadDataFile('items.json'));
ipcMain.handle('data:augment-stats', () => loadDataFile('augment-stats.json'));
ipcMain.handle('data:champion-stats', () => loadDataFile('champion-stats.json'));
ipcMain.handle('data:refresh', () => refreshPatchData('manual'));
ipcMain.handle('history:get', () => historyStore.get('games', []));
let champIdByNameCache = null;
function champIdByName() {
  if (!champIdByNameCache) {
    champIdByNameCache = new Map(
      (loadDataFile('champions.json')?.champions ?? []).map((c) => [c.name.toLowerCase(), c.id])
    );
  }
  return champIdByNameCache;
}

function afterIngest() {
  const enriched = enrichSavedBuilds(buildsStore, historyStore.get('games', []), champIdByName());
  if (enriched) win?.webContents.send('builds:updated', buildsStore.get('saved', []));
  return enriched;
}

ipcMain.handle('history:ingest', async () => {
  const res = await ingestRecentMayhemGames(lcu, historyStore);
  afterIngest();
  return { ...res, games: historyStore.get('games', []) };
});
ipcMain.handle('builds:get', () => buildsStore.get('saved', []));
ipcMain.handle('builds:save', (_e, build) => {
  const saved = buildsStore.get('saved', []);
  saved.unshift({
    ...build,
    savedAt: Date.now(),
    id: `b${Date.now()}`,
    // augments come from match history after the game unless the live API had them
    pendingEnrich: !build.augments?.length,
  });
  buildsStore.set('saved', saved.slice(0, 300));
  return saved;
});
ipcMain.handle('builds:delete', (_e, id) => {
  buildsStore.set('saved', buildsStore.get('saved', []).filter((b) => b.id !== id));
  return buildsStore.get('saved', []);
});
ipcMain.handle('ratings:get', () => ratingsStore.get('overrides', {}));
ipcMain.handle('ratings:set', (_e, { name, score }) => {
  const o = ratingsStore.get('overrides', {});
  if (score === null) delete o[name];
  else o[name] = score;
  ratingsStore.set('overrides', o);
  return o;
});
ipcMain.on('overlay:set-clickthrough', (_e, enabled) => setClickThrough(enabled));
ipcMain.on('overlay:hide', () => win.hide());
ipcMain.on('overlay:collapse', (_e, collapsed) => setPanelCollapsed(collapsed));
ipcMain.handle('ocr:scan', async () => {
  const res = await runOcrScan('manual');
  handleScanResult(res, { manual: true });
  return res;
});
ipcMain.on('ocr:picked', () => {
  pendingOffer = false;
  setOfferActive(false);
});
ipcMain.on('badges:show', (_e, badges) => showBadges(badges));
ipcMain.on('badges:clear', () => clearBadges());
ipcMain.on('celebrate', (_e, name) => {
  if (!badgeWin) return;
  celebrateUntil = Date.now() + 4500;
  badgeWin.webContents.send('celebrate:go', {
    name,
    sound: settings.get('celebrationSound', true),
  });
  badgeWin.showInactive();
  setTimeout(syncBadgeWinVisibility, 4600);
});
ipcMain.on('prio:show', (_e, data) => {
  if (!badgeWin) return;
  badgesActive = true; // priority panel rides the same layer/lifecycle as the pills
  badgeWin.webContents.send('prio:data', data);
  syncBadgeWinVisibility();
});
ipcMain.on('scanbtn:click', async () => {
  const res = await runOcrScan('button');
  handleScanResult(res, { manual: true });
});
ipcMain.on('buildstrip:show', (_e, data) => showBuildStrip(data));
ipcMain.on('buildstrip:clear', () => clearBuildStrip());
ipcMain.on('strip:resize', (_e, { w, h }) => {
  if (!stripWin) return;
  const b = stripWin.getBounds();
  stripWin.setBounds({ x: b.x, y: b.y, width: Math.max(120, w), height: Math.max(40, h) });
});
ipcMain.on('strip:lock', (_e, v) => settings.set('stripLocked', !!v));
// hide/restore a suggested item: the panel renderer owns the per-game set
ipcMain.on('strip:hideitem', (_e, id) => win?.webContents.send('suggest:hide-item', id));
ipcMain.handle('session:get', () => sessionStore.get('current', null));
ipcMain.on('session:save', (_e, s) => sessionStore.set('current', s));
// boots preference: persistent, main is the source of truth
ipcMain.handle('boots:get', () => settings.get('showBoots', true));
ipcMain.on('strip:boots', () => {
  const next = !settings.get('showBoots', true);
  settings.set('showBoots', next);
  win?.webContents.send('suggest:show-boots', next);
});
ipcMain.on('strip:dragby', (_e, { dx, dy }) => {
  if (!stripWin) return;
  const [x, y] = stripWin.getPosition();
  stripWin.setPosition(x + Math.round(dx), y + Math.round(dy));
});
ipcMain.on('strip:dragend', () => {
  if (!stripWin) return;
  const b = stripWin.getBounds();
  const d = screen.getPrimaryDisplay();
  settings.set('buildStripPos', {
    x: (b.x - d.bounds.x) / d.bounds.width,
    y: (b.y - d.bounds.y) / d.bounds.height,
  });
});

// double-launching (e.g. from the desktop shortcut) focuses the running overlay
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (win) { win.show(); win.setAlwaysOnTop(true, 'screen-saver'); }
});

app.whenReady().then(async () => {
  // Chromium's disk cache survives app updates and can serve STALE renderer
  // files from the previous version (same file:// paths, new asar) — which
  // silently breaks windows whose JS/HTML shape changed. Purge it once per
  // version change, before any window loads.
  if (settings.get('lastRunVersion') !== app.getVersion()) {
    try {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearCodeCaches({});
    } catch (e) { console.log('[cache] clear failed:', e.message); }
    settings.set('lastRunVersion', app.getVersion());
  }

  createWindow();
  createBadgeWindow();
  createStripWindow();
  createScanButton();
  createTray();
  startPhaseWatcher();
  poller.start(2000);
  setTimeout(checkPatchOnStartup, 4000);

  // app self-update from GitHub Releases (installed copies only)
  checkAppUpdate(false);
  setInterval(() => checkAppUpdate(false), 4 * 3600 * 1000);

  const hotkeys = {};
  hotkeys['Ctrl+Alt+O'] = globalShortcut.register('Control+Alt+O', toggleVisibility);
  hotkeys['Ctrl+Alt+X'] = globalShortcut.register('Control+Alt+X', () => setClickThrough(!clickThrough));
  // quick-open augment picker
  hotkeys['Ctrl+Alt+A'] = globalShortcut.register('Control+Alt+A', () => {
    win.show();
    if (clickThrough) setClickThrough(false);
    win.webContents.send('live:augment-breakpoint', { level: null, manual: true });
  });
  // scan screen for the offered augments
  hotkeys['Ctrl+Alt+S'] = globalShortcut.register('Control+Alt+S', async () => {
    win.show();
    const res = await runOcrScan('manual');
    handleScanResult(res, { manual: true });
  });
  console.log('hotkey registration:', hotkeys);
  win.webContents.on('did-finish-load', () => win.webContents.send('hotkeys:status', hotkeys));

  // test hook: fake a champ select session to exercise the prep dashboard
  if (process.env.MAYHEM_PREP_TEST === '1') {
    openPrepWindow();
    setTimeout(() => feedPrep({
      localPlayerCellId: 0,
      myTeam: [
        { cellId: 0, championId: 412 }, // Thresh (me)
        { cellId: 1, championId: 222 },
        { cellId: 2, championId: 103 },
        { cellId: 3, championId: 86 },
        { cellId: 4, championId: 21 },
      ],
      benchChampions: [
        { championId: 51 }, { championId: 25 }, { championId: 63 }, { championId: 121 },
      ],
    }), 3000);
  }
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
