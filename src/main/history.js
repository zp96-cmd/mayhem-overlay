// Pulls recent ARAM Mayhem games (queueId 2400) from LCU match history and
// records my augments + final items per game into the history store.
const MAYHEM_QUEUE_ID = 2400;

function extractAugments(stats) {
  // Augment picks appear as playerAugment1..N (0 = empty slot)
  return Object.keys(stats || {})
    .filter((k) => /^playerAugment\d+$/i.test(k))
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))
    .map((k) => stats[k])
    .filter((v) => v && v > 0);
}

function extractItems(stats) {
  const items = [];
  for (let i = 0; i <= 6; i++) {
    const id = stats?.[`item${i}`];
    if (id && id > 0) items.push(id);
  }
  return items;
}

async function ingestRecentMayhemGames(lcu, store, { maxGames = 40 } = {}) {
  const summoner = await lcu.currentSummoner();
  const puuid = summoner.puuid;
  const list = await lcu.recentMatches(0, maxGames);
  const games = list?.games?.games || [];
  const known = new Set((store.get('games', [])).map((g) => g.gameId));
  const added = [];

  for (const g of games) {
    if (g.queueId !== MAYHEM_QUEUE_ID && g.gameMode !== 'MAYHEM') continue;
    if (known.has(g.gameId)) continue;
    let full = g;
    try {
      full = await lcu.gameDetails(g.gameId);
    } catch { /* fall back to shallow record */ }

    const identity = (full.participantIdentities || []).find(
      (pi) => pi.player?.puuid === puuid
    );
    const me = identity
      ? (full.participants || []).find((p) => p.participantId === identity.participantId)
      : (full.participants || [])[0];
    if (!me) continue;

    const idToRiot = new Map((full.participantIdentities || []).map((pi) => {
      const pl = pi.player || {};
      const riotId = pl.gameName ? `${pl.gameName}${pl.tagLine ? '#' + pl.tagLine : ''}` : pl.summonerName;
      return [pi.participantId, riotId ?? null];
    }));
    const participants = (full.participants || []).map((p) => ({
      championId: p.championId,
      riotId: idToRiot.get(p.participantId) ?? null,
      win: p.stats?.win ?? false,
      augments: extractAugments(p.stats),
      items: extractItems(p.stats),
    }));

    const record = {
      gameId: g.gameId,
      creation: g.gameCreation,
      duration: g.gameDuration,
      queueId: g.queueId,
      championId: me.championId,
      win: me.stats?.win ?? false,
      augments: extractAugments(me.stats),
      items: extractItems(me.stats),
      kills: me.stats?.kills ?? 0,
      deaths: me.stats?.deaths ?? 0,
      assists: me.stats?.assists ?? 0,
      participants,
    };
    added.push(record);
  }

  if (added.length) {
    const all = [...added, ...store.get('games', [])]
      .sort((a, b) => b.creation - a.creation)
      .slice(0, 500);
    store.set('games', all);
  }
  return { added: added.length, total: store.get('games', []).length };
}

// Builds saved live only have items (Riot doesn't expose other players' augments
// mid-game). Once the game shows up in match history, fill in that player's
// augments and final items by matching riot ID (fallback: champion) + timestamp.
function enrichSavedBuilds(buildsStore, games, champIdByName) {
  const saved = buildsStore.get('saved', []);
  let changed = false;
  for (const b of saved) {
    if (!b.pendingEnrich) continue;
    for (const g of games) {
      if (!g.participants?.length) continue;
      const start = g.creation;
      const end = g.creation + (g.duration ?? 0) * 1000 + 10 * 60 * 1000;
      if (b.savedAt < start || b.savedAt > end) continue;
      const champId = champIdByName.get((b.championName ?? '').toLowerCase());
      const part =
        (b.playerName && g.participants.find((p) => p.riotId === b.playerName)) ||
        (champId && g.participants.find((p) => p.championId === champId)) ||
        null;
      if (part) {
        b.augments = part.augments;
        b.finalItems = part.items;
        b.won = part.win;
        b.pendingEnrich = false;
        changed = true;
        break;
      }
    }
  }
  if (changed) buildsStore.set('saved', saved);
  return changed;
}

module.exports = { ingestRecentMayhemGames, enrichSavedBuilds, MAYHEM_QUEUE_ID };
