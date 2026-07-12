// Mock Live Client Data server for testing the overlay without a running game.
// Run:  node scripts/mock-liveclient.mjs   then start the app with MAYHEM_MOCK=1.
// Simulates a Jinx ARAM Mayhem game where the player levels up over time.
//
// SAFETY: the real game binds https://127.0.0.1:2999 at game start and never
// retries — a forgotten mock on that port silently kills live data for the
// whole game. So the mock refuses to start while League is running, exits the
// moment a real game launches, and self-terminates after 30 minutes.
import http from 'node:http';
import { execSync } from 'node:child_process';

function realGameRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq League of Legends.exe" /NH', {
      encoding: 'utf8', windowsHide: true,
    });
    return out.includes('League of Legends.exe');
  } catch {
    return false;
  }
}

if (realGameRunning()) {
  console.error('refusing to start: a real League game is running and needs port 2999');
  process.exit(1);
}
setInterval(() => {
  if (realGameRunning()) {
    console.error('real game detected: freeing port 2999 and exiting');
    process.exit(0);
  }
}, 5000);
setTimeout(() => {
  console.error('mock TTL (30 min) reached, exiting');
  process.exit(0);
}, 30 * 60 * 1000);

const t0 = Date.now();

function level() {
  // level up roughly every 12s so augment breakpoints (3/7/11/15) fire quickly
  return Math.min(18, 1 + Math.floor((Date.now() - t0) / 12000));
}

const ITEMS = {
  jinx: [
    { itemID: 3006, displayName: "Berserker's Greaves", slot: 0, count: 1 },
    { itemID: 6672, displayName: 'Kraken Slayer', slot: 1, count: 1 },
    { itemID: 3031, displayName: 'Infinity Edge', slot: 2, count: 1 },
  ],
  ahri: [
    { itemID: 3020, displayName: "Sorcerer's Shoes", slot: 0, count: 1 },
    { itemID: 6655, displayName: "Luden's Companion", slot: 1, count: 1 },
    { itemID: 3089, displayName: "Rabadon's Deathcap", slot: 2, count: 1 },
  ],
  malphite: [
    { itemID: 3047, displayName: 'Plated Steelcaps', slot: 0, count: 1 },
    { itemID: 3068, displayName: 'Sunfire Aegis', slot: 1, count: 1 },
  ],
};

function player(riotId, championName, team, items) {
  return {
    riotId, summonerName: riotId, championName, team,
    level: level(), isDead: false,
    items,
    scores: { kills: 2, deaths: 1, assists: 4, creepScore: 20 },
  };
}

function allgamedata() {
  return {
    activePlayer: {
      riotId: 'Zac#OCE',
      level: level(),
      currentGold: 1234,
      championStats: { attackDamage: 150, abilityPower: 0 },
    },
    allPlayers: [
      player('Zac#OCE', 'Jinx', 'ORDER', ITEMS.jinx),
      player('Ally1#OCE', 'Ahri', 'ORDER', ITEMS.ahri),
      player('Ally2#OCE', 'Malphite', 'ORDER', ITEMS.malphite),
      player('Enemy1#OCE', 'Veigar', 'CHAOS', ITEMS.ahri),
      player('Enemy2#OCE', 'Draven', 'CHAOS', ITEMS.jinx),
    ],
    events: { Events: [{ EventID: 0, EventName: 'GameStart', EventTime: 0.05 }] },
    gameData: {
      gameMode: 'MAYHEM',
      gameTime: (Date.now() - t0) / 1000,
      mapNumber: 12,
    },
  };
}

http.createServer((req, res) => {
  if (req.url.startsWith('/liveclientdata/allgamedata')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(allgamedata()));
  } else {
    res.writeHead(404); res.end();
  }
}).listen(2999, '127.0.0.1', () => {
  console.log('mock live client on http://127.0.0.1:2999 (level:', level() + ')');
});
