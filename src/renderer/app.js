/* Mayhem Overlay renderer: augment suggestions, build paths, history, saved builds. */

const state = {
  augments: [],
  augById: new Map(),
  augByName: new Map(),
  champions: [],
  champByName: new Map(),
  items: [],
  itemById: new Map(),
  itemByName: new Map(),
  augStats: {},        // augment id -> community stats (aramgg.com)
  augStatsMeta: null,
  champData: null,     // aramgg per-champion data: { championId, buildSummary, augments }
  history: [],
  builds: [],
  ratings: {},
  live: null,          // last live-client snapshot
  lastGame: null,      // { players, team, at } captured when a game ends
  phase: { connected: false, phase: 'None' },
  filterTier: 'all',
  fitOnly: false,
  search: '',
  compare: [],         // augment names selected for comparison
  picked: [],          // augment names picked this game
  seen: new Set(),     // augments that have appeared in any offer this game (can't reappear)
  clickThrough: false,
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------- archetypes & scoring ---------------- */

const ARCHETYPES = {
  ap:    [/ability power/i, /\bAP\b/, /magic damage/i],
  ad:    [/attack damage/i, /\bAD\b/, /physical damage/i],
  as:    [/attack speed/i, /on-hit/i, /basic attack/i],
  crit:  [/critical strike/i, /\bcrit\b/i],
  tank:  [/\barmor\b/i, /magic resistance/i, /maximum health/i, /damage reduction/i, /\bresistances\b/i],
  heal:  [/\bheal/i, /omnivamp/i, /life steal/i, /lifesteal/i, /shield/i],
  haste: [/ability haste/i, /cooldown/i, /refund/i],
  ms:    [/movement speed/i, /\bdash/i, /\bblink/i],
};

const ROLE_FIT = {
  mage:     ['ap', 'haste'],
  marksman: ['ad', 'as', 'crit'],
  fighter:  ['ad', 'as', 'tank', 'heal'],
  tank:     ['tank', 'heal', 'haste'],
  assassin: ['ad', 'haste', 'ms'],
  support:  ['heal', 'haste', 'tank'],
};

function augmentArchetypes(aug) {
  if (aug._arch) return aug._arch;
  const text = `${aug.name} ${aug.description}`;
  aug._arch = Object.entries(ARCHETYPES)
    .filter(([, res]) => res.some((r) => r.test(text)))
    .map(([k]) => k);
  return aug._arch;
}

function myChampion() {
  const name = state.live?.me?.championName;
  return name ? state.champByName.get(name.toLowerCase()) : null;
}

function myRoles() {
  const c = myChampion();
  return c?.roles?.length ? c.roles : [];
}

function fitArchetypes() {
  const set = new Set();
  for (const role of myRoles()) (ROLE_FIT[role] || []).forEach((a) => set.add(a));
  return set;
}

function historyStats(aug) {
  if (!aug.id) return null;
  let games = 0, wins = 0;
  for (const g of state.history) {
    if ((g.augments || []).includes(aug.id)) { games++; if (g.win) wins++; }
  }
  return games ? { games, wins, wr: wins / games } : null;
}

function scoreAugment(aug) {
  const reasons = [];
  const tierBase = { Silver: 2, Gold: 3, Prismatic: 4 }[aug.tier] ?? 2;
  let score = tierBase;

  const override = state.ratings[aug.name];
  if (override !== undefined) {
    score = override;
    reasons.push(`your rating ${override}★`);
  }

  const fit = fitArchetypes();
  const arch = augmentArchetypes(aug);
  if (fit.size && arch.length) {
    const overlap = arch.filter((a) => fit.has(a)).length;
    if (overlap) {
      const bonus = Math.min(1.5, overlap * 0.75);
      score += bonus;
      reasons.push(`fits ${myChampion()?.name ?? 'champ'} (${arch.filter((a) => fit.has(a)).join(', ')})`);
    }
  }

  // synergy with what I've already picked this game
  if (state.picked.length && arch.length) {
    const pickedArch = new Set(state.picked.flatMap((n) => {
      const a = state.augByName.get(n);
      return a ? augmentArchetypes(a) : [];
    }));
    if (arch.some((a) => pickedArch.has(a))) {
      score += 0.5;
      reasons.push('synergy with picks');
    }
  }

  // community stats (aramgg.com): global win rate + my-champion pairing
  const cs = aug.id ? state.augStats[aug.id] : null;
  if (cs && cs.games >= 1000 && Number.isFinite(cs.winRate)) {
    const adj = Math.max(-1.5, Math.min(1.5, (cs.winRate - 0.5) * 10));
    score += adj;
    reasons.push(`${(cs.winRate * 100).toFixed(1)}% WR global`);
    const champId = myChampion()?.id;
    // full per-champion stats (fetched when the game starts) beat the top-5 pairings
    const champAug = state.champData?.championId === champId ? state.champData?.augments?.[aug.id] : null;
    if (champAug && champAug.games >= 200) {
      const padj = Math.max(-1.5, Math.min(1.5, (champAug.winRate - 0.5) * 10));
      score += padj;
      reasons.push(`${(champAug.winRate * 100).toFixed(1)}% on ${myChampion().name} (${champAug.games} games)`);
    } else {
      const pair = champId ? cs.topChampions?.find((c) => c.championId === champId) : null;
      if (pair && pair.games >= 300) {
        const padj = Math.max(-1.5, Math.min(1.5, (pair.winRate - 0.5) * 10));
        score += padj;
        reasons.push(`${(pair.winRate * 100).toFixed(1)}% on ${myChampion().name}`);
      }
    }
  }

  const hs = historyStats(aug);
  if (hs && hs.games >= 2) {
    const adj = Math.max(-1, Math.min(1, (hs.wr - 0.5) * 2));
    score += adj;
    reasons.push(`${Math.round(hs.wr * 100)}% WR in ${hs.games} of my games`);
  }

  if (aug.disabled) score = -1;
  return { score, reasons };
}

/* ---------------- augments tab ---------------- */

function renderAugments() {
  const list = $('#aug-list');
  list.innerHTML = '';
  const q = state.search.trim().toLowerCase();
  const fit = state.fitOnly ? fitArchetypes() : null;

  let rows = state.augments
    .filter((a) => state.filterTier === 'all' || a.tier === state.filterTier)
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
    .filter((a) => !fit || !fit.size || augmentArchetypes(a).some((x) => fit.has(x)))
    .map((a) => ({ aug: a, ...scoreAugment(a), gone: state.seen.has(a.name) && !state.picked.includes(a.name) }))
    .sort((x, y) => (x.gone - y.gone) || (y.score - x.score)); // seen-this-game sink to the bottom

  if (!rows.length) {
    list.append(el('div', 'empty', 'No augments match.'));
    return;
  }
  for (const r of rows.slice(0, 80)) list.append(augRow(r, { compareBtn: true }));
}

function stars(aug) {
  const val = state.ratings[aug.name];
  const s = el('div', 'stars');
  s.title = 'Personal rating (click to set, click same star to clear)';
  s.innerHTML = [1, 2, 3, 4, 5].map((i) =>
    `<span data-star="${i}">${val >= i ? '<b>★</b>' : '☆'}</span>`).join('');
  s.addEventListener('click', async (e) => {
    const star = e.target.closest('[data-star]');
    if (!star) return;
    e.stopPropagation();
    const n = Number(star.dataset.star);
    const next = state.ratings[aug.name] === n ? null : n;
    state.ratings = await window.mayhem.setRating(aug.name, next);
    renderAugments();
    renderCompare();
  });
  return s;
}

function augRow({ aug, score, reasons, gone }, { compareBtn = false, pickBtn = false } = {}) {
  const row = el('div', `aug-row tier-${aug.tier}${aug.disabled || gone ? ' disabled' : ''}`);
  if (state.compare.includes(aug.name)) row.classList.add('selected');

  if (aug.icon) {
    const img = el('img');
    img.src = aug.icon;
    img.loading = 'lazy';
    row.append(img);
  }
  const body = el('div', 'body');
  const nameLine = el('div', 'name-line');
  nameLine.append(el('span', `name tier-${aug.tier}`, esc(aug.name)));
  const cs = aug.id ? state.augStats[aug.id] : null;
  if (cs?.winRate) {
    const wr = el('span', `wr${cs.winRate >= 0.53 ? ' good' : cs.winRate < 0.48 ? ' bad' : ''}`,
      `${(cs.winRate * 100).toFixed(1)}%`);
    wr.title = `community win rate over ${cs.games.toLocaleString()} games (aramgg.com)`;
    nameLine.append(wr);
  }
  if (aug.disabled) nameLine.append(el('span', 'badge', 'DISABLED'));
  if (gone) nameLine.append(el('span', 'badge', 'GONE'));
  if (state.picked.includes(aug.name)) nameLine.append(el('span', 'badge pick', 'PICKED'));
  const scoreEl = el('span', `score${score >= 4.5 ? ' hot' : ''}`, score.toFixed(1));
  scoreEl.title = reasons.join(' · ') || 'tier baseline';
  nameLine.append(scoreEl);
  body.append(nameLine);
  body.append(el('div', 'desc', esc(aug.description)));
  if (reasons.length) body.append(el('div', 'why', esc(reasons.join(' · '))));
  body.append(stars(aug));
  row.append(body);

  row.addEventListener('click', (e) => {
    if (e.target.closest('.stars') || e.target.closest('.mini-btn')) return;
    if (compareBtn) toggleCompare(aug.name);
    else row.classList.toggle('expanded');
  });
  row.addEventListener('dblclick', () => row.classList.toggle('expanded'));

  if (pickBtn) {
    const b = el('button', 'mini-btn', 'pick');
    b.addEventListener('click', (e) => { e.stopPropagation(); pickAugment(aug.name); });
    row.append(b);
  }
  return row;
}

function toggleCompare(name) {
  const i = state.compare.indexOf(name);
  if (i >= 0) state.compare.splice(i, 1);
  else {
    state.compare.push(name);
    if (state.compare.length > 3) state.compare.shift();
  }
  renderCompare();
  renderAugments();
}

function renderCompare() {
  const tray = $('#compare-tray');
  if (!state.compare.length) { tray.classList.add('hidden'); return; }
  tray.classList.remove('hidden');
  tray.innerHTML = '';
  tray.append(el('div', 'cmp-title', `COMPARING ${state.compare.length}: click "pick" on the one you take`));
  const rows = state.compare
    .map((n) => state.augByName.get(n))
    .filter(Boolean)
    .map((a) => ({ aug: a, ...scoreAugment(a) }))
    .sort((x, y) => y.score - x.score);
  for (const r of rows) tray.append(augRow(r, { pickBtn: true }));
}

function pickAugment(name) {
  if (!state.picked.includes(name)) state.picked.push(name);
  state.seen.add(name);
  state.compare = [];
  window.mayhem.notifyPicked();
  lastStripKey = null;
  updateBuildStrip();
  $('#offer-banner').classList.add('hidden');
  renderCompare();
  renderMyAugments();
  renderAugments();
  renderBuildTab();
}

function applyOcrOffer(res) {
  const msg = $('#offer-msg');
  if (res.error) { msg.textContent = `scan failed: ${res.error}`; return; }
  const good = (res.matches || []).filter((m) => m.score >= 0.62);
  if (!good.length) {
    msg.textContent = 'no augments recognized. Is the choice screen up? Try again or type below.';
    return;
  }
  $('#offer-banner').classList.remove('hidden');
  switchTab('augments');
  state.compare = good.map((m) => m.name);
  msg.textContent = `found ${good.length} in ${((res.durationMs ?? 0) / 1000).toFixed(1)}s. Pick below.`;
  // an augment that appears once is out of the pool for the rest of the game
  good.forEach((m) => state.seen.add(m.name));
  renderCompare();
  renderAugments();
  showOfferBadges(good);
  showPriorityList(good.map((m) => m.name));
}

function champWrFor(aug) {
  const champId = myChampion()?.id;
  const champAug = state.champData?.championId === champId ? state.champData?.augments?.[aug.id] : null;
  return champAug?.games >= 200 ? champAug.winRate : null;
}

// Draw stat pills over the actual augment cards on screen (OCR gave us where
// each detected name sits). Best suggestion gets the ★.
function showOfferBadges(matches) {
  const positioned = matches.filter((m) => m.screen);
  if (!positioned.length) return;
  const scored = positioned.map((m) => {
    const aug = state.augByName.get(m.name);
    if (!aug) return null;
    const { score } = scoreAugment(aug);
    const cs = aug.id ? state.augStats[aug.id] : null;
    return {
      x: m.screen.x, y: m.screen.y, w: m.screen.w, h: m.screen.h,
      winRate: cs?.winRate ?? null,
      champWr: champWrFor(aug),
      champName: myChampion()?.name ?? '',
      score,
      best: false,
      rank: 0,
    };
  }).filter(Boolean);
  if (!scored.length) return;
  [...scored].sort((a, b) => b.score - a.score).forEach((b, i) => { b.rank = i + 1; });
  scored.find((b) => b.rank === 1).best = true;
  window.mayhem.showBadges(scored);
}

// Priority list: top augments still in the pool (never offered this game),
// filtered to the tier of the current offer when known.
function showPriorityList(offerNames = []) {
  const offerSet = new Set(offerNames);
  const tiers = offerNames
    .map((n) => state.augByName.get(n)?.tier)
    .filter(Boolean);
  const tier = tiers.length && tiers.every((t) => t === tiers[0]) ? tiers[0] : null;

  const rows = state.augments
    .filter((a) => !a.disabled)
    .filter((a) => !tier || a.tier === tier)
    .filter((a) => !state.seen.has(a.name) || offerSet.has(a.name))
    .map((a) => {
      const { score } = scoreAugment(a);
      const cs = a.id ? state.augStats[a.id] : null;
      return {
        name: a.name, icon: a.icon,
        wr: champWrFor(a) ?? cs?.winRate ?? null,
        score,
        offered: offerSet.has(a.name),
      };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, 8);
  window.mayhem.showPrio({ tier, items: rows });
}

function renderMyAugments() {
  const strip = $('#my-augments');
  if (!state.picked.length) { strip.classList.add('hidden'); return; }
  strip.classList.remove('hidden');
  strip.innerHTML = '<span class="label">MY AUGMENTS</span>';
  for (const n of state.picked) {
    const a = state.augByName.get(n);
    if (!a) continue;
    if (a.icon) {
      const img = el('img');
      img.src = a.icon; img.title = `${a.name} (click to remove)`;
      img.addEventListener('click', () => {
        state.picked = state.picked.filter((x) => x !== n);
        renderMyAugments(); renderAugments(); renderBuildTab();
      });
      strip.append(img);
    } else {
      strip.append(el('span', 'label', esc(n)));
    }
  }
}

/* ---------------- build tab ---------------- */

// What am I building? Weight each owned item's categories by its price —
// a finished Deathcap says "AP" much louder than an Amp Tome.
const CAT2ARCH = {
  SpellDamage: 'ap', Damage: 'ad', AttackSpeed: 'as', CriticalStrike: 'crit',
  Armor: 'tank', SpellBlock: 'tank', Health: 'tank',
  LifeSteal: 'heal', SpellVamp: 'heal', AbilityHaste: 'haste', CooldownReduction: 'haste',
};

function ownedArchetypeWeights() {
  const w = {};
  for (const it of state.live?.me?.items ?? []) {
    const item = state.itemById.get(it.id);
    if (!item) continue;
    for (const c of item.categories) {
      const a = CAT2ARCH[c];
      if (a) w[a] = (w[a] || 0) + item.price;
    }
  }
  return w;
}

// aramgg build tags -> our archetype keys
const TAG2ARCH = {
  ad: ['ad'], ap: ['ap'], crit: ['crit'], tank: ['tank'], bruiser: ['ad', 'tank'],
  onhit: ['as'], as: ['as'], attackspeed: ['as'], lethality: ['ad'],
  support: ['heal'], enchanter: ['heal'], haste: ['haste'], hybrid: ['ad', 'ap'],
};

function pickCommunityBuild() {
  const builds = state.champData?.buildSummary?.builds;
  if (!builds?.length) return null;
  const owned = ownedArchetypeWeights();
  const hasDirection = Object.keys(owned).length > 0;
  let best = null, bestScore = -Infinity;
  for (const b of builds) {
    const archs = new Set((b.tags ?? []).flatMap((t) => TAG2ARCH[t.toLowerCase().replace(/[^a-z]/g, '')] ?? []));
    const dirScore = hasDirection
      ? [...archs].reduce((s, a) => s + (owned[a] || 0), 0)
      : 0;
    const score = dirScore + (b.pickRate ?? 0) * 1000; // popularity as tiebreak
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}

function ownedItemIds() {
  return new Set((state.live?.me?.items ?? []).map((i) => i.id));
}

function itemImg(id, size = 28) {
  const it = state.itemById.get(id);
  const img = el('img');
  if (it?.icon) img.src = it.icon;
  img.title = it?.name ?? `item ${id}`;
  img.width = size; img.height = size;
  img.loading = 'lazy';
  return img;
}

function buildBlock(srcLabel, itemIds, note, { markProgress = false } = {}) {
  const b = el('div', 'build-block');
  b.append(el('div', 'src', esc(srcLabel)));
  const wrap = el('div', 'items');
  const owned = markProgress ? ownedItemIds() : null;
  const gold = state.live?.activePlayer?.gold ?? 0;
  let nextMarked = false;
  itemIds.forEach((id, i) => {
    if (i) wrap.append(el('span', 'arrow', '›'));
    const img = itemImg(id);
    if (markProgress) {
      const it = state.itemById.get(id);
      if (owned.has(id)) {
        img.classList.add('owned');
        img.title += ' (owned ✓)';
      } else if (!nextMarked) {
        nextMarked = true;
        img.classList.add('next');
        if (it && it.price <= gold) {
          img.classList.add('affordable');
          img.title += ` (NEXT, affordable: ${it.price}g)`;
        } else {
          img.title += ` (NEXT: ${it?.price ?? '?'}g)`;
        }
      }
    }
    wrap.append(img);
  });
  b.append(wrap);
  if (note) b.append(el('div', 'note', esc(note)));
  return b;
}

function itemIdsFromNames(names) {
  return (names ?? [])
    .map((n) => state.itemByName.get(String(n).toLowerCase())?.id)
    .filter(Boolean);
}

// Full ARAM Mayhem path for the matched community build: core items in order,
// then the situational pool for slots 4-6.
function communityPath(cb) {
  const owned = ownedItemIds();
  const cores = [...(cb.coreItems ?? [])].sort((a, b) => (b.games ?? 0) - (a.games ?? 0));
  const core = cores.find((c) => c.itemIds.some((id) => !owned.has(id))) ?? cores[0];
  const coreIds = core?.itemIds ?? [];
  const situationalIds = itemIdsFromNames(cb.situationalItems).filter((id) => !coreIds.includes(id));
  return { core, coreIds, situationalIds };
}

// Consensus build path from MY winning games on this champion: items that
// keep showing up in wins, ordered by how early they sit in the inventory.
function myWinningPath(champId) {
  if (!champId) return null;
  const wins = state.history
    .filter((g) => g.championId === champId && g.win && (g.items ?? []).length >= 3)
    .slice(0, 10);
  if (!wins.length) return null;
  const freq = new Map(), slotSum = new Map();
  for (const g of wins) {
    g.items.forEach((id, idx) => {
      const it = state.itemById.get(id);
      if (!it || it.price < 900) return; // skip components/consumables
      freq.set(id, (freq.get(id) ?? 0) + 1);
      slotSum.set(id, (slotSum.get(id) ?? 0) + idx);
    });
  }
  const half = Math.max(1, wins.length / 2);
  const ranked = [...freq.entries()].map(([id, f]) => ({ id, f, avgSlot: slotSum.get(id) / f }));
  // staples (in at least half the wins) in build order, then the rest by frequency
  const staples = ranked.filter((r) => r.f >= half).sort((a, b) => a.avgSlot - b.avgSlot);
  const rest = ranked.filter((r) => r.f < half).sort((a, b) => b.f - a.f || a.avgSlot - b.avgSlot);
  const ids = [...staples, ...rest].map((r) => r.id).slice(0, 6);
  return ids.length ? { ids, wins: wins.length } : null;
}

// The in-game strip shows BOTH paths side by side when both exist:
// my winning consensus and the matched aramgg build. Owned items skipped,
// first item of each row flagged when affordable right now.
function stripRows() {
  if (!state.live) return [];
  const owned = ownedItemIds();
  const gold = state.live?.activePlayer?.gold ?? 0;
  const mk = (ids) => ids
    .filter((id) => !owned.has(id))
    .slice(0, 4)
    .map((id, i) => {
      const it = state.itemById.get(id);
      return it ? {
        icon: it.icon, name: it.name, price: it.price,
        affordable: i === 0 && it.price <= gold,
      } : null;
    })
    .filter(Boolean);

  const rows = [];
  const mine = myWinningPath(myChampion()?.id);
  if (mine) {
    const items = mk(mine.ids);
    if (items.length) rows.push({ label: `MINE ${mine.wins}W`, items });
  }
  const cb = pickCommunityBuild();
  if (cb) {
    const { coreIds, situationalIds } = communityPath(cb);
    const items = mk([...coreIds, ...situationalIds]);
    if (items.length) rows.push({ label: `ARAMGG ${(cb.tags ?? []).join('/')}`.trim(), items });
  }
  return rows;
}

let lastStripKey = null;
function updateBuildStrip() {
  const rows = stripRows();
  if (!rows.length) {
    if (lastStripKey !== null) { lastStripKey = null; window.mayhem.clearBuildStrip(); }
    return;
  }
  const key = JSON.stringify(rows.map((r) => [r.label, r.items.map((i) => [i.name, i.affordable])]));
  if (key === lastStripKey) return;
  lastStripKey = key;
  window.mayhem.showBuildStrip({ rows });
}

function renderBuildTab() {
  const box = $('#build-suggest');
  box.innerHTML = '';
  const champ = myChampion();
  const champName = champ?.name ?? state.live?.me?.championName;

  if (!state.live) {
    box.append(el('div', 'empty',
      'No live game detected.<br>Build suggestions appear once you\'re in an ARAM Mayhem game.<br><span class="hint">You can still browse augments, history and saved builds.</span>'));
  } else {
    box.append(el('h3', null, `Build path: ${esc(champName ?? 'unknown')}`));

    // 1) consensus path from my winning games on this champion — most trusted
    const champId = champ?.id;
    const mine = myWinningPath(champId);
    if (mine) {
      box.append(buildBlock(
        `MY WINS · consensus from ${mine.wins} winning game${mine.wins > 1 ? 's' : ''}`,
        mine.ids, '✓ owned · highlighted = build next', { markProgress: true }));
    }

    // 2) saved builds for this champion
    const saved = state.builds.filter((b) => b.championName?.toLowerCase() === (champName ?? '').toLowerCase());
    for (const b of saved.slice(0, 2)) {
      const augNames = (b.augments ?? []).map((id) => state.augById.get(id)?.name).filter(Boolean);
      buildBlockSafe(box, `SAVED · ${b.playerName ?? 'unknown player'}`, b.finalItems ?? b.items,
        augNames.length ? `augments: ${augNames.join(', ')}` : b.note);
    }

    // 3) community build matched to what I'm actually building (aramgg)
    const cb = pickCommunityBuild();
    if (cb) {
      const owned = ownedItemIds();
      const { core, coreIds, situationalIds } = communityPath(cb);
      // starting items, while we're still early
      const startIds = itemIdsFromNames([...new Set(cb.startingItems ?? [])]);
      if (startIds.length && (state.live.me?.items?.length ?? 0) < 2 && (state.live.gameTime ?? 0) < 240) {
        box.append(buildBlock('START · aramgg', startIds));
      }
      if (core) {
        const dir = Object.keys(ownedArchetypeWeights()).length ? 'matches your items' : 'most popular';
        box.append(buildBlock(
          `CORE · ${(cb.tags ?? []).join('/')} (${dir}) · ${((core.winRate ?? cb.winRate) * 100).toFixed(1)}% WR · ${(core.games ?? cb.games).toLocaleString()} games`,
          coreIds, 'aramgg.com. ✓ owned, highlighted = build next',
          { markProgress: true }));
      }
      const situUnowned = situationalIds.filter((id) => !owned.has(id));
      if (situUnowned.length) {
        box.append(buildBlock('SITUATIONAL · aramgg (slots 4-6, pick to taste)', situUnowned.slice(0, 6)));
      }
    } else if (!mine && !saved.length) {
      box.append(el('div', 'empty',
        'No build data for this champion yet: no aramgg entry, no wins of yours, nothing saved.'));
    }

    // current items
    if (state.live.me?.items?.length) {
      const cur = el('div', 'build-block');
      cur.append(el('div', 'src', 'CURRENT ITEMS'));
      const wrap = el('div', 'items');
      state.live.me.items.forEach((it) => wrap.append(itemImg(it.id)));
      cur.append(wrap);
      box.append(cur);
    }
  }

  renderLivePlayers();
}

function buildBlockSafe(box, label, items, note) {
  if (items?.length) box.append(buildBlock(label, items, note));
}

function playerRow({ championName, riotId, ally, itemIds, augmentIds, saveBuild }) {
  const row = el('div', `player-row ${ally ? 'ally' : 'enemy'}`);
  row.append(el('span', 'champ', esc(championName)));
  const mid = el('span', 'items');
  itemIds.forEach((id) => mid.append(itemImg(id, 22)));
  if (augmentIds?.length) {
    for (const id of augmentIds) {
      const a = state.augById.get(id);
      if (a?.icon) {
        const img = el('img');
        img.src = a.icon; img.title = a.name;
        img.style.cssText = 'width:18px;height:18px;border-radius:4px;margin-left:2px;opacity:0.85';
        mid.append(img);
      }
    }
  }
  row.append(mid);
  const save = el('button', 'mini-btn save', '💾');
  save.title = 'Save this build';
  save.addEventListener('click', async () => {
    state.builds = await saveBuild();
    save.textContent = '✓';
    setTimeout(() => (save.textContent = '💾'), 1500);
    renderSaved();
  });
  row.append(save);
  return row;
}

function renderLivePlayers() {
  const box = $('#live-players');
  box.innerHTML = '';

  // 1) live game
  if (state.live?.players?.length) {
    const myTeam = state.live.me?.team;
    for (const p of state.live.players) {
      box.append(playerRow({
        championName: p.championName,
        riotId: p.riotId,
        ally: p.team === myTeam,
        itemIds: p.items.map((i) => i.id),
        augmentIds: p.augments ?? [],
        saveBuild: () => window.mayhem.saveBuild({
          championName: p.championName,
          playerName: p.riotId,
          items: p.items.map((i) => i.id),
          augments: p.augments ?? [],
          note: `saved live · ${Math.floor((state.live.gameTime ?? 0) / 60)}min`,
        }),
      }));
    }
    return;
  }

  // 2) last game from history (final builds + augments) if it's fresher than
  //    any live snapshot we captured at game end
  const hist = state.history[0];
  const histEnd = hist ? hist.creation + (hist.duration ?? 0) * 1000 : 0;
  const snapshotFresher = state.lastGame && state.lastGame.at > histEnd + 60 * 1000;

  if (hist?.participants?.length && !snapshotFresher) {
    box.append(el('div', 'hint',
      `Last game · ${new Date(hist.creation).toLocaleString()} · final builds & augments`));
    for (const p of hist.participants) {
      const c = champById(p.championId);
      box.append(playerRow({
        championName: c?.name ?? `Champion ${p.championId}`,
        riotId: p.riotId,
        ally: p.win === hist.win, // same result as me = same team
        itemIds: p.items ?? [],
        augmentIds: p.augments ?? [],
        saveBuild: () => window.mayhem.saveBuild({
          championName: c?.name,
          playerName: p.riotId,
          items: p.items ?? [],
          augments: p.augments ?? [],
          note: 'saved from last game',
        }),
      }));
    }
    return;
  }

  // 3) snapshot from the moment the game ended (history not synced yet)
  if (state.lastGame?.players?.length) {
    box.append(el('div', 'hint',
      'Last game (as it ended) · augments fill in once history syncs'));
    for (const p of state.lastGame.players) {
      box.append(playerRow({
        championName: p.championName,
        riotId: p.riotId,
        ally: p.team === state.lastGame.team,
        itemIds: p.items.map((i) => i.id),
        augmentIds: p.augments ?? [],
        saveBuild: () => window.mayhem.saveBuild({
          championName: p.championName,
          playerName: p.riotId,
          items: p.items.map((i) => i.id),
          augments: p.augments ?? [],
          note: 'saved from last game',
        }),
      }));
    }
    return;
  }

  box.append(el('div', 'empty', 'Player builds show here during a game, and stay after it ends so you can still save them.'));
}

/* ---------------- history tab ---------------- */

function champById(id) {
  return state.champions.find((c) => c.id === id);
}

function renderHistory() {
  const box = $('#history-list');
  box.innerHTML = '';
  if (!state.history.length) {
    box.append(el('div', 'empty',
      'No Mayhem games recorded yet.<br>Open the League client and hit <b>Sync from client</b>. Recent ARAM Mayhem games (with your augments and items) get pulled in automatically after each game too.'));
    return;
  }
  for (const g of state.history.slice(0, 60)) {
    const row = el('div', 'hist-row');
    const c = champById(g.championId);
    if (c?.icon) { const img = el('img', 'champ'); img.src = c.icon; img.title = c.name; row.append(img); }
    row.append(el('span', `result ${g.win ? 'W' : 'L'}`, g.win ? 'W' : 'L'));
    const mid = el('div', 'mid');
    mid.append(el('div', 'kda',
      `${esc(c?.name ?? 'Champion')} · ${g.kills}/${g.deaths}/${g.assists} · ${new Date(g.creation).toLocaleDateString()}`));
    if (g.augments?.length) {
      const augs = el('div', 'augs');
      for (const id of g.augments) {
        const a = state.augById.get(id);
        if (a?.icon) { const img = el('img'); img.src = a.icon; img.title = a.name; augs.append(img); }
      }
      mid.append(augs);
    }
    if (g.items?.length) {
      const items = el('div', 'items');
      g.items.forEach((id) => items.append(itemImg(id, 18)));
      mid.append(items);
    }
    row.append(mid);
    box.append(row);
  }
}

/* ---------------- saved tab ---------------- */

function renderSaved() {
  const box = $('#saved-list');
  box.innerHTML = '';
  if (!state.builds.length) {
    box.append(el('div', 'empty',
      'No saved builds yet.<br>During a game, open the <b>Build</b> tab and hit 💾 next to any player whose build you like.'));
    return;
  }
  for (const b of state.builds) {
    const row = el('div', 'saved-row');
    const top = el('div', 'top');
    const c = state.champByName.get((b.championName ?? '').toLowerCase());
    if (c?.icon) { const img = el('img', 'champ'); img.src = c.icon; top.append(img); }
    top.append(el('span', 'name', esc(b.championName ?? '?')));
    if (b.won !== undefined) top.append(el('span', `result ${b.won ? 'W' : 'L'}`, b.won ? 'W' : 'L'));
    top.append(el('span', 'when', `${esc(b.playerName ?? '')} · ${new Date(b.savedAt).toLocaleDateString()}`));
    const del = el('button', 'mini-btn del', '✕');
    del.addEventListener('click', async () => {
      state.builds = await window.mayhem.deleteBuild(b.id);
      renderSaved();
    });
    top.append(del);
    row.append(top);
    if (b.augments?.length) {
      const augs = el('div', 'augs');
      for (const id of b.augments) {
        const a = state.augById.get(id);
        if (!a) continue;
        if (a.icon) { const img = el('img'); img.src = a.icon; img.title = a.name; augs.append(img); }
        else augs.append(el('span', 'when', esc(a.name)));
      }
      row.append(augs);
    } else if (b.pendingEnrich) {
      row.append(el('div', 'when', 'augments arrive after the game syncs to history'));
    }
    const items = el('div', 'items');
    (b.finalItems ?? b.items ?? []).forEach((id) => items.append(itemImg(id, 24)));
    row.append(items);
    if (b.note) row.append(el('div', 'when', esc(b.note)));
    box.append(row);
  }
}

/* ---------------- wiring ---------------- */

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'build') renderBuildTab();
  if (name === 'history') renderHistory();
  if (name === 'saved') renderSaved();
}

async function loadData() {
  const [augData, champData, itemData, history, builds, ratings, augStats] = await Promise.all([
    window.mayhem.getAugments(),
    window.mayhem.getChampions(),
    window.mayhem.getItems(),
    window.mayhem.getHistory(),
    window.mayhem.getBuilds(),
    window.mayhem.getRatings(),
    window.mayhem.getAugmentStats(),
  ]);
  state.augStats = augStats?.stats ?? {};
  state.augStatsMeta = augStats ? { patch: augStats.patch, updated: augStats.updated, source: augStats.source } : null;
  state.augments = augData?.augments ?? [];
  state.champions = champData?.champions ?? [];
  state.items = itemData?.items ?? [];
  state.history = history ?? [];
  state.builds = builds ?? [];
  state.ratings = ratings ?? {};
  state.augById = new Map();
  state.augByName = new Map();
  state.champByName = new Map();
  state.itemById = new Map();
  state.itemByName = new Map();
  state.augments.forEach((a) => {
    if (a.id) state.augById.set(a.id, a);
    state.augByName.set(a.name, a);
  });
  state.champions.forEach((c) => state.champByName.set(c.name.toLowerCase(), c));
  state.items.forEach((i) => {
    state.itemById.set(i.id, i);
    state.itemByName.set(i.name.toLowerCase(), i);
  });
}

async function init() {
  await loadData();

  renderAugments();
  renderHistory();
  renderSaved();

  // tabs
  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // search + filters
  $('#aug-search').addEventListener('input', (e) => { state.search = e.target.value; renderAugments(); });
  document.querySelectorAll('.chip[data-tier]').forEach((c) =>
    c.addEventListener('click', () => {
      state.filterTier = c.dataset.tier;
      document.querySelectorAll('.chip[data-tier]').forEach((x) => x.classList.toggle('active', x === c));
      renderAugments();
    }));
  $('#chip-fit').addEventListener('click', () => {
    state.fitOnly = !state.fitOnly;
    $('#chip-fit').classList.toggle('active', state.fitOnly);
    renderAugments();
  });

  // titlebar buttons
  $('#btn-hide').addEventListener('click', () => window.mayhem.hide());
  $('#btn-collapse').addEventListener('click', () => $('#root').classList.toggle('collapsed'));
  $('#btn-pin').addEventListener('click', () => window.mayhem.setClickThrough(!state.clickThrough));
  $('#offer-clear').addEventListener('click', () => {
    state.picked = [];
    renderMyAugments(); renderAugments(); renderBuildTab();
  });
  $('#offer-scan').addEventListener('click', async () => {
    const res = await window.mayhem.scanScreen();
    if (res) applyOcrOffer(res);
  });

  // patch data update
  $('#btn-update').addEventListener('click', async () => {
    $('#sync-status').textContent = 'updating patch data…';
    const r = await window.mayhem.refreshData();
    $('#sync-status').textContent = r.ok
      ? `data updated (${r.augments} augments, stats patch ${r.statsPatch ?? '?'})`
      : `update failed: ${r.error}`;
  });
  window.mayhem.onDataStatus((s) => {
    if (s.busy) $('#sync-status').textContent = 'updating patch data…';
  });
  window.mayhem.onDataRefreshed(async () => {
    await loadData();
    renderAugments();
    renderHistory();
    renderSaved();
    if ($('#tab-build').classList.contains('active')) renderBuildTab();
  });

  // history sync
  $('#btn-sync').addEventListener('click', async () => {
    $('#sync-status').textContent = 'syncing…';
    try {
      const res = await window.mayhem.ingestHistory();
      state.history = res.games;
      $('#sync-status').textContent = `+${res.added} new · ${res.total} total`;
      renderHistory(); renderAugments();
    } catch (e) {
      $('#sync-status').textContent = 'client not running?';
    }
  });

  // live events
  window.mayhem.onLiveUpdate((live) => {
    const firstUpdate = !state.live;
    state.live = live;
    $('#status-dot').className = 'dot dot-game';
    const me = live.me;
    $('#live-champ').textContent = me ? `${me.championName} · lvl ${live.activePlayer?.level ?? me.level}` : '';
    if (firstUpdate) { state.picked = []; state.seen = new Set(); renderMyAugments(); renderAugments(); }
    if ($('#tab-build').classList.contains('active')) renderBuildTab();
    updateBuildStrip();
  });
  window.mayhem.onLiveEnded(() => {
    if (state.live?.players?.length) {
      state.lastGame = { players: state.live.players, team: state.live.me?.team, at: Date.now() };
    }
    state.live = null;
    lastStripKey = null;
    $('#live-champ').textContent = '';
    $('#status-dot').className = state.phase.connected ? 'dot dot-client' : 'dot dot-off';
    renderBuildTab();
  });
  window.mayhem.onAugmentBreakpoint(({ level, manual }) => {
    $('#offer-banner').classList.remove('hidden');
    switchTab('augments');
    state.compare = [];
    renderCompare();
    const input = $('#aug-search');
    input.value = ''; state.search = '';
    renderAugments();
    input.focus();
    // show what's worth hoping for right away, before the scan lands
    if (state.live) showPriorityList();
    if (!manual) setTimeout(() => $('#offer-banner').classList.add('hidden'), 45000);
  });
  window.mayhem.onPhase((p) => {
    state.phase = p;
    if (!state.live) {
      $('#status-dot').className = p.connected ? 'dot dot-client' : 'dot dot-off';
    }
    const statsNote = state.augStatsMeta ? ` · stats: aramgg ${state.augStatsMeta.updated}` : '';
    $('#phase').textContent = `client: ${p.connected ? p.phase : 'not running'}${statsNote}`;
  });
  window.mayhem.onHistoryUpdated((games) => {
    state.history = games;
    renderHistory();
    // upgrade the last-game player list to final builds + augments
    if ($('#tab-build').classList.contains('active')) renderBuildTab();
  });
  window.mayhem.onBuildsUpdated((builds) => { state.builds = builds; renderSaved(); });
  window.mayhem.onOcrStatus((s) => {
    if (s.trigger === 'verify' || s.trigger === 'reroll') return; // silent background checks
    const msg = $('#offer-msg');
    if (s.busy) {
      $('#offer-banner').classList.remove('hidden');
      msg.textContent = 'scanning screen…';
    } else if (s.error) {
      msg.textContent = `scan failed: ${s.error}`;
    }
  });
  window.mayhem.onOcrOffer((res) => applyOcrOffer(res));
  // the game-side pick was detected (cards vanished after cursor visited one)
  window.mayhem.onAutoPicked(({ name }) => {
    if (name && state.augByName.has(name)) {
      pickAugment(name);
      $('#offer-msg').textContent = `picked ${name} (detected in-game)`;
    } else {
      // cards gone but we don't know which was taken — just tidy up
      state.compare = [];
      renderCompare();
      $('#offer-banner').classList.add('hidden');
      window.mayhem.clearBadges();
    }
  });
  window.mayhem.onChampData((d) => {
    state.champData = d;
    renderAugments();
    if ($('#tab-build').classList.contains('active')) renderBuildTab();
    lastStripKey = null;
    updateBuildStrip();
  });
  window.mayhem.onHotkeyStatus((s) => {
    const failed = Object.entries(s).filter(([, ok]) => !ok).map(([k]) => k);
    if (failed.length) {
      $('#footer .hint:last-child').textContent = `⚠ hotkeys failed to register: ${failed.join(', ')}. Use the SCAN button`;
    }
  });
  window.mayhem.onClickThrough((v) => {
    state.clickThrough = v;
    $('#root').classList.toggle('clickthrough', v);
    $('#btn-pin').classList.toggle('active', v);
  });
}

init();
