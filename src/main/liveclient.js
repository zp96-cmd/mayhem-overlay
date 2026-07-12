// Live Client Data API poller (https://127.0.0.1:2999). Available only while
// a game is running. Self-signed cert, so TLS verification is disabled.
// Set MAYHEM_MOCK=1 to poll plain HTTP (used by scripts/mock-liveclient.mjs).
const https = require('https');
const http = require('http');

const MOCK = process.env.MAYHEM_MOCK === '1';

function fetchJson(pathName) {
  return new Promise((resolve, reject) => {
    const mod = MOCK ? http : https;
    const req = mod.get(
      {
        host: '127.0.0.1',
        port: 2999,
        path: pathName,
        rejectUnauthorized: false,
        timeout: 3000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`live client ${res.statusCode}`));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('live client timeout')));
  });
}

class LiveClientPoller {
  constructor(onUpdate, onGameEnd) {
    this.onUpdate = onUpdate;
    this.onGameEnd = onGameEnd;
    this.timer = null;
    this.inGame = false;
  }

  start(intervalMs = 2000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    try {
      const data = await fetchJson('/liveclientdata/allgamedata');
      if (!data || !data.activePlayer) throw new Error('no data');
      this.inGame = true;
      this.onUpdate(normalize(data));
    } catch {
      if (this.inGame) {
        this.inGame = false;
        this.onGameEnd();
      }
    }
  }
}

function normalize(data) {
  const active = data.activePlayer || {};
  const players = (data.allPlayers || []).map((p) => ({
    riotId: p.riotId || p.summonerName,
    championName: p.championName,
    team: p.team,
    level: p.level,
    items: (p.items || []).map((i) => ({ id: i.itemID, name: i.displayName, slot: i.slot, count: i.count })),
    // not currently exposed by Riot for Mayhem, but captured if it ever appears
    augments: Array.isArray(p.augments) ? p.augments : null,
    scores: p.scores || {},
    isDead: p.isDead,
  }));
  const me = players.find((p) => p.riotId === active.riotId) || null;
  return {
    gameTime: data.gameData?.gameTime ?? 0,
    gameMode: data.gameData?.gameMode ?? '',
    mapNumber: data.gameData?.mapNumber ?? 0,
    activePlayer: {
      riotId: active.riotId,
      level: active.level,
      gold: active.currentGold,
      championStats: active.championStats || {},
    },
    me,
    players,
    events: (data.events?.Events || []).slice(-20),
  };
}

module.exports = { LiveClientPoller };
