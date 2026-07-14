// Patch-data pipeline, callable from the Electron main process (installed app)
// and from scripts/fetch-data.mjs (dev CLI). Writes augments/champions/items/
// augment-stats/champion-stats JSON files into the given directory.
// Sources: CommunityDragon, LoL Wiki (Mayhem module), aramgg.com.
const fs = require('fs');
const path = require('path');

const CDRAGON = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default';
const UA = 'lol-mayhem-overlay/0.2 (personal-use data refresh, one fetch per patch)';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// --- wiki markup -> plain text ---
function stripWiki(s) {
  let out = s;
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<[^>]+>/g, '');
  let prev;
  do {
    prev = out;
    out = out.replace(/\{\{([^{}]*)\}\}/g, (_, body) => {
      const parts = body.split('|');
      const tpl = parts[0].trim().toLowerCase();
      const args = parts.slice(1).filter((p) => !p.includes('='));
      switch (tpl) {
        case 'as': return args[0] ?? '';
        case 'ap': return args[0] ?? '';
        case 'fd': return args[0] ?? '';
        case 'pp': return args[0] ?? '';
        case 'g': return (args[0] ?? '') + ' gold';
        case 'tip': return args[1] ?? args[0] ?? '';
        case 'sbc': return args[0] ?? '';
        case 'ai': return args[0] ?? '';
        case 'ii': return args[0] ?? '';
        case 'ci': return args[0] ?? '';
        case 'si': return args[0] ?? '';
        case 'sti': return args[1] ?? args[0] ?? '';
        case 'rd': return args.join(' / ');
        default: return args[0] ?? '';
      }
    });
  } while (out !== prev);
  out = out.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '');
  out = out.replace(/\[\[([^\]]+)\]\]/g, (_, body) => body.split('|').pop());
  out = out.replace(/'''([^']*(?:'[^']+)*?)'''/g, '$1');
  out = out.replace(/''([^']*(?:'[^']+)*?)''/g, '$1');
  return out.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

// --- minimal Lua table parser for the wiki module (tab-indentation anchored) ---
function parseLuaModule(lua) {
  const entries = {};
  const starts = [...lua.matchAll(/^\t\[\s*"((?:[^"\\]|\\.)*)"\s*\]\s*=\s*\{/gm)];
  for (let n = 0; n < starts.length; n++) {
    const name = starts[n][1].replace(/\\"/g, '"');
    const from = starts[n].index + starts[n][0].length;
    const to = n + 1 < starts.length ? starts[n + 1].index : lua.length;
    const body = lua.slice(from, to);
    const fields = {};
    for (const key of ['description', 'tier']) {
      const m = body.match(new RegExp(`\\[\\s*"${key}"\\s*\\]\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`));
      if (m) fields[key] = m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }
    if (fields.description || fields.tier) entries[name] = fields;
  }
  return entries;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function iconUrl(assetPath) {
  if (!assetPath) return null;
  const rel = assetPath.replace(/^\/lol-game-data\/assets\//i, '').toLowerCase();
  return `${CDRAGON}/${rel}`;
}

// aramgg stats rows: [augmentId, statsJsonString, patch, date, _]
function normalizeAugStats(raw) {
  const stats = {};
  let patch = null, updated = null;
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [id, payload, rowPatch, rowDate] = row;
    patch = rowPatch ?? patch;
    updated = rowDate ?? updated;
    let s;
    try { s = JSON.parse(payload); } catch { continue; }
    stats[id] = {
      winRate: Number(s.win_rate),
      pickRate: Number(s.pick_rate),
      games: Number(s.num_games),
      tier: Number(s.tier),
      byStage: (s.augment_stage_stats ?? []).map((st) => ({
        stage: Number(st.augment_stage),
        winRate: Number(st.win_rate),
        games: Number(st.num_games),
      })),
      topChampions: (s.top_champions ?? []).map((c) => ({
        championId: Number(c.champion_id),
        winRate: Number(c.win_rate),
        pickRate: Number(c.pick_rate),
        games: Number(c.num_games),
      })),
    };
  }
  return { patch, updated, stats };
}

async function fetchAllData(dataDir, log = () => {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const write = (name, obj) =>
    fs.writeFileSync(path.join(dataDir, name), JSON.stringify(obj, null, 2));

  log('downloading sources...');
  const [cherry, lua, champs, itemsRaw, augStatsRaw, aramggHome] = await Promise.all([
    getJson(`${CDRAGON}/v1/cherry-augments.json`),
    getText('https://wiki.leagueoflegends.com/en-us/Module:MayhemAugmentData/data?action=raw'),
    getJson(`${CDRAGON}/v1/champion-summary.json`),
    getJson(`${CDRAGON}/v1/items.json`),
    getJson('https://aramgg.com/data/augments-stats-raw.json').catch(() => null),
    getText('https://aramgg.com/en').catch(() => null),
  ]);

  const wikiEntries = parseLuaModule(lua);
  const byName = new Map();
  for (const a of cherry) {
    const key = norm(a.nameTRA || a.augmentNameId);
    const existing = byName.get(key);
    const isAram = a.augmentNameId.startsWith('ARAM_');
    if (!existing || (isAram && !existing.augmentNameId.startsWith('ARAM_'))) byName.set(key, a);
  }

  const augments = [];
  for (const [name, fields] of Object.entries(wikiEntries)) {
    const cd = byName.get(norm(name)) ?? byName.get(norm(name.replace(/^Quest:\s*/i, '')));
    const tier = (fields.tier || '').trim();
    const description = stripWiki(fields.description || '');
    const disabled = /currently disabled/i.test(description);
    augments.push({
      name,
      tier,
      description: description.replace(/\n?This augment is currently disabled\.?$/i, '').trim(),
      disabled,
      id: cd?.id ?? null,
      nameId: cd?.augmentNameId ?? null,
      icon: iconUrl(cd?.augmentSmallIconPath),
      rarity: cd?.rarity ?? `k${tier}`,
    });
  }
  augments.sort((a, b) => a.name.localeCompare(b.name));

  const champions = champs
    .filter((c) => c.id > 0)
    .map((c) => ({
      id: c.id, name: c.name, alias: c.alias,
      icon: iconUrl(c.squarePortraitPath), roles: c.roles || [],
    }));

  // include non-purchasable items too (Muramana, Fimbulwinter, Seraph's, ...):
  // they appear in inventories as transforms and must resolve for icon lookup
  // and owned-item ancestry (owning the transform covers its base item)
  const items = itemsRaw
    .filter((i) => i.id > 0 && i.name)
    .map((i) => ({
      id: i.id, name: i.name, categories: i.categories || [],
      // specialRecipe is how transforms point at their base item
      // (Fimbulwinter -> Winter's Approach, Muramana -> Manamune)
      from: [...new Set([...(i.from || []), ...(i.specialRecipe > 0 ? [i.specialRecipe] : [])])],
      to: i.to || [],
      price: i.priceTotal, inStore: !!i.inStore, icon: iconUrl(i.iconPath),
    }));

  const fetchedAt = new Date().toISOString();
  write('augments.json', { fetchedAt, augments });
  write('champions.json', { fetchedAt, champions });
  write('items.json', { fetchedAt, items });
  log(`augments: ${augments.length}, champions: ${champions.length}, items: ${items.length}`);

  let statsPatch = null;
  if (augStatsRaw) {
    const augStats = normalizeAugStats(augStatsRaw);
    statsPatch = augStats.patch;
    write('augment-stats.json', {
      fetchedAt, source: 'aramgg.com',
      patch: augStats.patch, updated: augStats.updated, stats: augStats.stats,
    });
    log(`augment stats: ${Object.keys(augStats.stats).length} (patch ${augStats.patch})`);
  }

  if (aramggHome) {
    const champStats = {};
    let version = null, updated = null;
    const re = /\{\\"championId\\":\\"(\d+)\\",\\"tier\\":\\"(\d+)\\",\\"winRate\\":([\d.]+),\\"numWinGames\\":\d+,\\"numGames\\":(\d+),\\"pickRate\\":([\d.]+),\\"version\\":\\"([^\\"]+)\\",\\"date\\":\\"([^\\"]+)\\"/g;
    let m;
    while ((m = re.exec(aramggHome)) !== null) {
      champStats[m[1]] = {
        tier: Number(m[2]), winRate: Number(m[3]),
        games: Number(m[4]), pickRate: Number(m[5]),
      };
      version = m[6]; updated = m[7];
    }
    if (Object.keys(champStats).length > 50) {
      write('champion-stats.json', {
        fetchedAt, source: 'aramgg.com', patch: version, updated, stats: champStats,
      });
      log(`champion stats: ${Object.keys(champStats).length} (patch ${version})`);
    } else {
      log('champion stats parse too small, skipped');
    }
  }

  return { augments: augments.length, champions: champions.length, items: items.length, statsPatch };
}

module.exports = { fetchAllData };
