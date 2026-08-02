// Per-champion augment win rates from aramkit.com's data CDN. Unlike aramgg
// (which stopped exposing per-champion win rates and even global game counts),
// ARAMKit serves clean versioned JSON with real champion-specific winRate AND
// sampleCount, so we can confidence-weight small samples again.
//
// Pipeline (all plain JSON on data.aramkit.com, no Cloudflare challenge):
//   1. /data/versions.json                       -> { latest, versions:[{dataPath, resourcePath, ...}] }
//   2. /{dataPath}/stats/all/champion-details/{championId}.json
//        -> { champion:{stats:{winRate}}, augments:{all:[{id,winRate,sampleCount,pickRate,rank,availableStages}]},
//             augmentCombinations:[{augmentIds,winRate,sampleCount,rank}] }
// "all" is the bracket (all matches); a "high" variant exists for high MMR.
// win lift = augment.winRate - champion baseline winRate.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { browserFetch } = require('./browser-fetch');

const HOST = 'https://data.aramkit.com';
const CHAMP_TTL_MS = 3 * 24 * 3600 * 1000; // per-champion file, like the aramgg cache
const VERSIONS_TTL_MS = 6 * 3600 * 1000;

let versionsCache = null; // { at, dataPath, resourcePath, latest, allMatches }

async function getVersions() {
  if (versionsCache && Date.now() - versionsCache.at < VERSIONS_TTL_MS) return versionsCache;
  const raw = await browserFetch(`${HOST}/data/versions.json`, 'text');
  const j = JSON.parse(raw);
  const v = (j.versions || []).find((x) => x.version === j.latest) || j.versions?.[0];
  if (!v || !v.dataPath) throw new Error('aramkit versions.json: no usable version');
  versionsCache = {
    at: Date.now(),
    latest: j.latest,
    dataPath: v.dataPath,
    resourcePath: v.resourcePath,
    allMatches: v.allMatches,
  };
  return versionsCache;
}

function cacheFile(championId) {
  const dir = path.join(app.getPath('userData'), 'aramkit-cache');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `champ-${championId}.json`);
}

// Returns { championId, version, baseline, augments: { <augId>: {winRate, games,
// pickRate, rank, lift} }, combos: [{ids, games, winRate, rank}] } or throws.
async function getChampionAugments(championId) {
  const ver = await getVersions();
  const file = cacheFile(championId);
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    // bust the cache when the patch (version) changes, not just on TTL
    if (c.version === ver.latest && Date.now() - c.fetchedAt < CHAMP_TTL_MS) return c;
  } catch { /* no cache */ }

  const url = `${HOST}/${ver.dataPath}/stats/all/champion-details/${championId}.json`;
  const j = JSON.parse(await browserFetch(url, 'text'));

  const baseline = Number(j.champion?.stats?.winRate);
  const augments = {};
  for (const a of j.augments?.all ?? []) {
    if (a == null || !Number.isFinite(a.winRate)) continue;
    augments[a.id] = {
      winRate: a.winRate,
      games: Number(a.sampleCount) || 0,
      pickRate: Number(a.pickRate) || 0,
      rank: Number(a.rank) || 0,
      lift: Number.isFinite(baseline) ? a.winRate - baseline : null,
    };
  }
  const combos = (j.augmentCombinations ?? [])
    .filter((c) => Array.isArray(c.augmentIds) && Number.isFinite(c.winRate))
    .map((c) => ({ ids: c.augmentIds, games: Number(c.sampleCount) || 0, winRate: c.winRate, rank: Number(c.rank) || 0 }));

  const data = { fetchedAt: Date.now(), championId, version: ver.latest, baseline, augments, combos };
  fs.writeFileSync(file, JSON.stringify(data));
  return data;
}

module.exports = { getChampionAugments, getVersions };
