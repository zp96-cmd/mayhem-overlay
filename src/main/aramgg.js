// On-demand per-champion data from aramgg.com, cached on disk (~3 day TTL,
// one champion page + one stats JSON per game). robots.txt allows AI agents.
// aramgg is behind Cloudflare (TLS-fingerprint bot filtering), so we fetch
// through a hidden Chromium window rather than a plain https request.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { browserFetch } = require('./browser-fetch');

const TTL_MS = 3 * 24 * 3600 * 1000;

// aramgg migrated Next.js -> Astro (mid-2026): the per-champion item builds are
// no longer a JSON blob in the page, they're server-rendered as HTML. Parse the
// build archetype tabs (name + win rate) and their panels (core item ids from
// icon URLs, situational item names from title attrs). Shape matches what the
// renderer's build strip expects: { builds: [{ tags, winRate, games, coreItems,
// situationalItems }] }. Defensive — returns null on any change so the strip
// falls back to the player's own history-based build.
function parseChampionBuilds(html) {
  try {
    // archetype tabs, in display order (aramgg lists most popular first)
    const tabs = html.split(/id="build-tab-\d+"/).slice(1).map((b) => {
      const head = b.slice(b.indexOf('>') + 1, b.indexOf('>') + 400)
        .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
      const wr = (head.match(/(\d+(?:\.\d+)?)%/) || [])[1];
      const label = (head.split(/\d+(?:\.\d+)?%/)[0] || '').trim();
      const tags = label.match(/Lethality|Crit|Tank|Bruiser|OnHit|AP|AD|Mana|Health/gi) || (label ? [label] : []);
      return { tags, winRate: wr ? Number(wr) / 100 : null };
    });

    const markers = [...html.matchAll(/data-build-panel="(\d+)"/g)];
    const builds = [];
    for (let k = 0; k < markers.length; k++) {
      const start = markers[k].index;
      const end = k + 1 < markers.length ? markers[k + 1].index : start + 14000;
      const chunk = html.slice(start, end);
      const ci = chunk.indexOf('Core Items');
      const si = chunk.indexOf('Situational Items');
      const sti = chunk.indexOf('Starting Items');
      const coreChunk = ci >= 0 ? chunk.slice(ci, si > ci ? si : chunk.length) : '';
      const situChunk = si >= 0 ? chunk.slice(si, sti > si ? sti : chunk.length) : '';
      const coreIds = [...coreChunk.matchAll(/item-icons\/(\d+)/g)].map((m) => Number(m[1]));
      const situNames = [...situChunk.matchAll(/title="([^"]+)"/g)].map((m) => m[1]);
      // core sets are rows of 3 items; keep them ranked (top row = most played)
      const cores = [];
      for (let i = 0; i < coreIds.length; i += 3) {
        const ids = coreIds.slice(i, i + 3);
        if (ids.length) cores.push({ itemIds: ids, games: coreIds.length - i });
      }
      const t = tabs[k] || {};
      if (!cores.length && !situNames.length) continue;
      builds.push({
        tags: t.tags && t.tags.length ? t.tags : ['BUILD'],
        winRate: t.winRate ?? null,
        games: markers.length - k, // synthetic: preserve aramgg's own ordering
        coreItems: cores.slice(0, 3),
        situationalItems: situNames.slice(0, 12),
      });
    }
    if (builds.length) return { builds };
    // We fetch the raw (un-hydrated) server HTML, where aramgg renders only ONE
    // build panel (the archetype tabs are added client-side). Parse that.
    return parseSingleBuild(html);
  } catch {
    return null;
  }
}

// Fallback for the server-rendered single build: the "Core Items" section's
// item ids + the "Situational Items" section's item names, with the champion's
// overall win rate (from the embedded hydration JSON) for the strip label.
function parseSingleBuild(html) {
  const ci = html.indexOf('Core Items');
  if (ci < 0) return null;
  const si = html.indexOf('Situational Items');
  const sti = html.indexOf('Starting Items');
  const coreChunk = html.slice(ci, si > ci ? si : ci + 6000);
  const situChunk = si >= 0 ? html.slice(si, sti > si ? sti : si + 6000) : '';
  const coreIds = [...coreChunk.matchAll(/item-icons\/(\d+)/g)].map((m) => Number(m[1]));
  const situNames = [...situChunk.matchAll(/title="([^"]+)"/g)].map((m) => m[1]);
  if (!coreIds.length) return null;
  const cores = [];
  for (let i = 0; i < coreIds.length; i += 3) {
    const ids = coreIds.slice(i, i + 3);
    if (ids.length) cores.push({ itemIds: ids, games: coreIds.length - i });
  }
  let winRate = null;
  const jm = html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (jm) { try { winRate = JSON.parse(jm[1])?.stats?.winRate ?? null; } catch { /* ignore */ } }
  return { builds: [{ tags: ['ARAMGG'], winRate, games: 1, coreItems: cores.slice(0, 4), situationalItems: situNames.slice(0, 12) }] };
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
    // refetch if stale, if it predates combo support ('trios'), or if it has no
    // builds (stale caches from before the aramgg Astro build-parser fix)
    if (Date.now() - cached.fetchedAt < TTL_MS && 'trios' in cached && cached.buildSummary?.builds?.length) {
      return cached;
    }
  } catch { /* no cache */ }

  const [pageHtml, augJson] = await Promise.all([
    browserFetch(`https://aramgg.com/en/champion-stats/${championId}`, 'html'),
    browserFetch(`https://aramgg.com/data/champion-augments/${championId}.json`, 'text').catch(() => null),
  ]);

  const buildSummary = parseChampionBuilds(pageHtml);

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
