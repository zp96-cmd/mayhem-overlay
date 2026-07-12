// On-demand per-champion data from aramgg.com, cached on disk (~3 day TTL,
// one champion page + one stats JSON per game). robots.txt allows AI agents.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const UA = 'lol-mayhem-overlay/0.1 (personal-use, cached per patch)';
const TTL_MS = 3 * 24 * 3600 * 1000;

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA }, timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${res.statusCode} ${url}`)); }
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

// Reassemble the Next.js flight payload embedded as self.__next_f.push([1,"..."]) chunks
function flightBlob(html) {
  const parts = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)];
  let blob = '';
  for (const m of parts) {
    try { blob += JSON.parse(`"${m[1]}"`); } catch { /* skip malformed chunk */ }
  }
  return blob;
}

// Extract the JSON object following `"key":` using string-aware brace matching
function extractJsonObject(blob, key) {
  const i = blob.indexOf(`"${key}":`);
  if (i < 0) return null;
  const start = blob.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0, inStr = false;
  for (let j = start; j < blob.length; j++) {
    const c = blob[j];
    if (inStr) {
      if (c === '\\') j++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(blob.slice(start, j + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function cacheFile(championId) {
  const dir = path.join(app.getPath('userData'), 'aramgg-cache');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `champ-${championId}.json`);
}

async function getChampionData(championId) {
  const file = cacheFile(championId);
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    // 'trios' missing means the cache predates combo support — refetch
    if (Date.now() - cached.fetchedAt < TTL_MS && 'trios' in cached) return cached;
  } catch { /* no cache */ }

  const [pageHtml, augJson] = await Promise.all([
    fetchUrl(`https://aramgg.com/en/champion-stats/${championId}`),
    fetchUrl(`https://aramgg.com/data/champion-augments/${championId}.json`).catch(() => null),
  ]);

  const buildSummary = extractJsonObject(flightBlob(pageHtml), 'championBuildSummary');

  // augJson shape: [[championId, statsJsonString, patch, date, _]]
  let augments = null;
  let trios = null;
  if (augJson) {
    try {
      const row = JSON.parse(augJson)[0];
      const parsed = JSON.parse(row[1]);
      augments = {};
      for (const [augId, s] of Object.entries(parsed.augments ?? {})) {
        augments[augId] = {
          winRate: Number(s.win_rate),
          games: Number(s.num_games),
          rank: Number(s.rank),
          tier: Number(s.tier),
        };
      }
      // augment combos: "id:id:id" -> { num_games, win_rate_tier (1 best .. 5 worst) }
      trios = [];
      for (const [key, s] of Object.entries(parsed.augment_trios ?? {})) {
        const ids = key.split(':').map(Number);
        const games = Number(s.num_games);
        const tier = Number(s.win_rate_tier);
        if (ids.length === 3 && ids.every(Number.isFinite) && games > 0 && Number.isFinite(tier)) {
          trios.push({ ids, games, tier });
        }
      }
    } catch { /* leave null */ }
  }

  const data = { fetchedAt: Date.now(), championId, buildSummary, augments, trios };
  fs.writeFileSync(file, JSON.stringify(data));
  return data;
}

module.exports = { getChampionData };
