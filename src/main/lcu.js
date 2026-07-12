// LCU (League Client Update) API access via the lockfile.
// The lockfile lives in the League install dir and holds: name:pid:port:password:protocol
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const CANDIDATE_DIRS = [
  'C:/Riot Games/League of Legends',
  'D:/Riot Games/League of Legends',
  'C:/Program Files/Riot Games/League of Legends',
];

function findLockfile() {
  for (const dir of CANDIDATE_DIRS) {
    const p = path.join(dir, 'lockfile');
    if (fs.existsSync(p)) return p;
  }
  // Fall back to asking Windows where LeagueClientUx is running from
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-Process LeagueClientUx -ErrorAction SilentlyContinue).Path"`,
      { encoding: 'utf8', windowsHide: true }
    ).trim();
    if (out) {
      const p = path.join(path.dirname(out), 'lockfile');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* client not running */ }
  return null;
}

function readCredentials() {
  const lock = findLockfile();
  if (!lock) return null;
  try {
    const [, , port, password, protocol] = fs.readFileSync(lock, 'utf8').split(':');
    return { port: Number(port), password, protocol };
  } catch {
    return null;
  }
}

function request(creds, endpoint, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port: creds.port,
        path: endpoint,
        method,
        rejectUnauthorized: false, // LCU uses a self-signed cert
        headers: {
          Authorization: 'Basic ' + Buffer.from(`riot:${creds.password}`).toString('base64'),
          Accept: 'application/json',
        },
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(body)); } catch { resolve(body); }
          } else {
            reject(new Error(`LCU ${res.statusCode} ${endpoint}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('LCU timeout')));
    req.end();
  });
}

class LcuClient {
  constructor() {
    this.creds = null;
  }

  connected() {
    return !!this.creds;
  }

  refresh() {
    this.creds = readCredentials();
    return this.connected();
  }

  async get(endpoint) {
    if (!this.creds && !this.refresh()) throw new Error('LCU not available');
    try {
      return await request(this.creds, endpoint);
    } catch (e) {
      // Credentials may be stale (client restarted) — retry once with fresh ones
      if (this.refresh()) return request(this.creds, endpoint);
      throw e;
    }
  }

  async gameflowPhase() {
    try { return await this.get('/lol-gameflow/v1/gameflow-phase'); }
    catch { return 'None'; }
  }

  // Recent matches for the logged-in summoner. Augment fields appear as
  // playerAugment1..6 on participants for augment modes (queueId 2400 = ARAM Mayhem).
  async recentMatches(begin = 0, count = 20) {
    return this.get(`/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=${begin}&endIndex=${begin + count}`);
  }

  async gameDetails(gameId) {
    return this.get(`/lol-match-history/v1/games/${gameId}`);
  }

  async currentSummoner() {
    return this.get('/lol-summoner/v1/current-summoner');
  }
}

module.exports = { LcuClient };
