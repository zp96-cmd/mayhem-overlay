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
  hiddenItems: new Set(), // items right-clicked away from suggestions this game
  showBoots: true,        // persistent preference: include boots in suggestions
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

// Combo signal from aramgg augment trios: how does this candidate pair with
// what I've already picked this game? Tier 1 (best) .. 5 (worst).
// 2 picked -> exact trio lookup; 1 or 3+ picked -> games-weighted aggregate
// over trios containing the candidate plus picked augments.
function comboStats(aug) {
  const trios = state.champData?.championId === myChampion()?.id ? state.champData?.trios : null;
  if (!trios?.length || !aug.id || !state.picked.length) return null;
  const pickedIds = state.picked
    .map((n) => state.augByName.get(n)?.id)
    .filter(Boolean);
  if (!pickedIds.length) return null;
  const pickedSet = new Set(pickedIds);
  const needed = Math.min(2, pickedIds.length); // trio = candidate + 2 others
  let games = 0, tierSum = 0;
  for (const t of trios) {
    if (!t.ids.includes(aug.id)) continue;
    const others = t.ids.filter((id) => id !== aug.id);
    const overlap = others.filter((id) => pickedSet.has(id)).length;
    if (overlap < needed) continue;
    games += t.games;
    tierSum += t.tier * t.games;
  }
  return games >= 50 ? { tier: tierSum / games, games, exact: needed === 2 } : null;
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

  // community stats (aramgg.com): champion-specific win rate DOMINATES;
  // the global rate is only a small tiebreak
  const cs = aug.id ? state.augStats[aug.id] : null;
  if (cs && cs.games >= 1000 && Number.isFinite(cs.winRate)) {
    const adj = Math.max(-0.6, Math.min(0.6, (cs.winRate - 0.5) * 4));
    score += adj;
    reasons.push(`${(cs.winRate * 100).toFixed(1)}% WR global`);
    const champId = myChampion()?.id;
    // full per-champion stats (fetched when the game starts) beat the top-5 pairings
    const champAug = state.champData?.championId === champId ? state.champData?.augments?.[aug.id] : null;
    if (champAug && champAug.games >= 200) {
      const padj = Math.max(-2.5, Math.min(2.5, (champAug.winRate - 0.5) * 16));
      score += padj;
      reasons.push(`${(champAug.winRate * 100).toFixed(1)}% on ${myChampion().name} (${champAug.games} games)`);
    } else {
      const pair = champId ? cs.topChampions?.find((c) => c.championId === champId) : null;
      if (pair && pair.games >= 300) {
        const padj = Math.max(-2, Math.min(2, (pair.winRate - 0.5) * 12));
        score += padj;
        reasons.push(`${(pair.winRate * 100).toFixed(1)}% on ${myChampion().name}`);
      }
    }
  }

  // real combo data with my picked augments (aramgg trios, tier 1 best .. 5 worst)
  const combo = comboStats(aug);
  if (combo) {
    const adj = (3 - combo.tier) * 0.6; // T1 +1.2 .. T5 -1.2
    score += adj;
    reasons.push(`combo T${combo.tier.toFixed(1)} with your picks (${combo.games.toLocaleString()} games)`);
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

// picking one of these gets the full confetti-and-fanfare treatment
const CELEBRATION_AUGMENTS = new Set(['Tank Engine', 'Steel Your Heart', 'Dropkick']);

// ...as does landing the champion's #1-ranked augment OF THAT TIER (aramgg):
// each offer is tier-locked, so Silver/Gold/Prismatic each have a best pick
function isChampRankOne(name) {
  const aug = state.augByName.get(name);
  if (!aug?.id) return false;
  if (state.champData?.championId !== myChampion()?.id) return false;
  const stats = state.champData?.augments ?? {};
  const mine = stats[aug.id];
  if (!mine?.rank || (mine.games ?? 0) < 100) return false;
  for (const [id, s] of Object.entries(stats)) {
    if (Number(id) === aug.id || (s.games ?? 0) < 100) continue;
    const other = state.augById.get(Number(id));
    if (!other || other.disabled || other.tier !== aug.tier) continue;
    if ((s.rank ?? Infinity) < mine.rank) return false; // someone better in this tier
  }
  return true;
}

function pickAugment(name) {
  const isNew = !state.picked.includes(name);
  if (isNew) state.picked.push(name);
  if (isNew && (CELEBRATION_AUGMENTS.has(name) || isChampRankOne(name))) {
    window.mayhem.celebrate(name);
  }
  state.seen.add(name);
  state.compare = [];
  window.mayhem.notifyPicked();
  lastStripKey = null;
  updateBuildStrip();
  saveSession();
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
  // newly-seen augments can kill reachable combos — refresh the BIS tracker
  lastStripKey = null;
  updateBuildStrip();
  saveSession();
}

function champWrFor(aug) {
  const champId = myChampion()?.id;
  const champAug = state.champData?.championId === champId ? state.champData?.augments?.[aug.id] : null;
  return champAug?.games >= 200 ? champAug.winRate : null;
}

// E[best of 3 draws] over a sorted-ascending score array (order statistics)
function emax3(sorted) {
  const n = sorted.length;
  let ev = 0;
  for (let i = 0; i < n; i++) {
    ev += sorted[i] * (Math.pow((i + 1) / n, 3) - Math.pow(i / n, 3));
  }
  return ev;
}

// Augments never repeat in a game, so every reroll permanently consumes one
// random augment from the pool. This is the expected drop in a FUTURE offer's
// best-of-3 quality caused by that consumption.
function burnCost(pool) {
  if (pool.length < 7) return 0;
  const sorted = [...pool].sort((a, b) => a - b);
  const base = emax3(sorted);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += base - emax3(sorted.slice(0, i).concat(sorted.slice(i + 1)));
  }
  return acc / sorted.length;
}

// Mayhem rerolls replace ONE card (you keep the other two). Decision: pick
// your best now, or reroll your WORST card hoping the fresh draw beats it?
//   gain    = E[max(0, draw - currentBest)] over the remaining pool
//   penalty = pool depletion cost against future offers (no repeats per game)
// If the best card is already strong, gain collapses toward 0 and the penalty
// tips it further toward keeping — a good hand is worth banking.
function computeVerdict(scored, offerNames) {
  const tiers = offerNames.map((n) => state.augByName.get(n)?.tier).filter(Boolean);
  const tier = tiers.length && tiers.every((t) => t === tiers[0]) ? tiers[0] : null;
  const pool = state.augments
    .filter((a) => !a.disabled)
    .filter((a) => !tier || a.tier === tier)
    .filter((a) => !state.seen.has(a.name))
    .map((a) => scoreAugment(a).score);
  if (pool.length < 6) return null; // pool too thin to judge
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const worst = scored.reduce((a, b) => (b.score < a.score ? b : a));
  const upside = pool.reduce((s, x) => s + Math.max(0, x - best.score), 0) / pool.length;
  // conservatively assume one more offer of this tier later in the game
  const level = state.live?.activePlayer?.level ?? 18;
  const penalty = level < 15 ? burnCost(pool) : 0;
  const net = upside - penalty;
  const action = net >= 0.2 ? 'REROLL' : net <= 0.08 ? 'PICK' : 'CLOSE';
  return {
    action,
    best: best.score,
    bestName: best.name,
    target: worst.name,
    upside,
    penalty,
    net,
    poolSize: pool.length,
  };
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
    const combo = comboStats(aug);
    return {
      name: aug.name,
      x: m.screen.x, y: m.screen.y, w: m.screen.w, h: m.screen.h,
      winRate: cs?.winRate ?? null,
      champWr: champWrFor(aug),
      champName: myChampion()?.name ?? '',
      comboTier: combo ? combo.tier : null,
      score,
      best: false,
      rank: 0,
    };
  }).filter(Boolean);
  if (!scored.length) return;
  [...scored].sort((a, b) => b.score - a.score).forEach((b, i) => { b.rank = i + 1; });
  scored.find((b) => b.rank === 1).best = true;
  const verdict = computeVerdict(scored, scored.map((s) => s.name));
  if (verdict) {
    $('#offer-msg').textContent += verdict.action === 'REROLL'
      ? ` · verdict: reroll ${verdict.target} (+${verdict.net.toFixed(2)} net)`
      : ` · verdict: ${verdict.action.toLowerCase()} ${verdict.bestName}`;
  }
  window.mayhem.showBadges({ pills: scored, verdict });
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

function ownedItemIds() {
  return new Set((state.live?.me?.items ?? []).map((i) => i.id));
}

// Mode-balanced item variants use classicId + an offset (ARAM: 320000,
// Arena/Mayhem: 220000). Live inventory reports 323119 / 223089 while aramgg
// suggests 3119 / 3089 — treat variant and classic as the same item.
const canonItemId = (id) => {
  for (const base of [320000, 220000]) {
    if (id >= base && id < base + 10000) {
      const classic = id - base;
      if (state.itemById.has(classic)) return classic;
    }
  }
  return id;
};

// Quest-upgrade items have NO lineage in Riot's data — confirmed mappings only.
// Extend this as more upgrades are identified in real games.
const MODE_UPGRADE_BASE = new Map([
  [228002, 3089], // Wooglet's Witchcap <- Rabadon's Deathcap
]);

// Resolve any item to something actually buyable in the shop: its classic
// form, its quest-upgrade base, or the nearest purchasable ancestor
// (transforms like Fimbulwinter -> Winter's Approach). Null = never suggest
// (anvils, vouchers, unmapped quest items).
function purchasableForm(id) {
  // breadth-first so the nearest purchasable form wins (a transform resolves
  // to its base item, never down into that base's components)
  const seen = new Set();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const it = state.itemById.get(cur);
    if (it && it.inStore && it.price > 0 && cur < 220000) return cur;
    const canon = canonItemId(cur);
    if (canon !== cur) queue.push(canon);
    if (MODE_UPGRADE_BASE.has(cur)) queue.push(MODE_UPGRADE_BASE.get(cur));
    for (const f of it?.from ?? []) queue.push(f);
  }
  return null;
}

// Map a suggestion pool to purchasable base forms, deduped, order preserved.
function normalizeSuggestionIds(ids) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const r = purchasableForm(id);
    if (r && !seen.has(r)) { seen.add(r); out.push(r); }
  }
  return out;
}

// Items covered by what I own: the items themselves (in both classic and ARAM
// id forms) plus everything in their build/transform ancestry. Owning
// Fimbulwinter covers Winter's Approach, Muramana covers Manamune, upgraded
// boots cover their base boots — a suggestion never shows an item whose
// evolved or variant form is already in my inventory.
function coveredItemIds() {
  const covered = new Set();
  const add = (id) => {
    for (const v of [id, canonItemId(id)]) {
      if (covered.has(v)) continue;
      covered.add(v);
      if (MODE_UPGRADE_BASE.has(v)) add(MODE_UPGRADE_BASE.get(v));
      for (const f of state.itemById.get(v)?.from ?? []) add(f);
    }
  };
  for (const i of state.live?.me?.items ?? []) add(i.id);
  return covered;
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

function isBoots(id) {
  return state.itemById.get(id)?.categories?.includes('Boots') ?? false;
}

function suggestable(id) {
  return !state.hiddenItems.has(id) && (state.showBoots || !isBoots(id));
}

// ---- restart-safe session: picked/seen augments + hidden items survive an
// overlay restart into the same game (matched by champion + game clock) ----
let sessionSaveTimer = null;
function saveSession() {
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => {
    if (!state.live?.me) return;
    window.mayhem.saveSession({
      championName: state.live.me.championName,
      gameTime: state.live.gameTime ?? 0,
      capturedAt: Date.now(),
      picked: state.picked,
      seen: [...state.seen],
      hiddenItems: [...state.hiddenItems],
    });
  }, 400);
}

async function restoreSession(live) {
  try {
    const s = await window.mayhem.getSession();
    if (s &&
        s.championName === live.me?.championName &&
        (s.gameTime ?? 0) <= (live.gameTime ?? 0) + 180 &&
        Date.now() - (s.capturedAt ?? 0) < 100 * 60 * 1000) {
      state.picked = s.picked ?? [];
      state.seen = new Set(s.seen ?? []);
      state.hiddenItems = new Set(s.hiddenItems ?? []);
      return true;
    }
  } catch { /* fall through to fresh state */ }
  return false;
}

function hideItemForGame(id) {
  if (state.hiddenItems.has(id)) state.hiddenItems.delete(id);
  else state.hiddenItems.add(id);
  if ($('#tab-build').classList.contains('active')) renderBuildTab();
  lastStripKey = null;
  updateBuildStrip();
  saveSession();
}

function buildBlock(srcLabel, itemIds, note, { markProgress = false } = {}) {
  // suggestion paths never show items already owned or hidden this game
  const covered = markProgress ? coveredItemIds() : null;
  const ids = markProgress
    ? itemIds.filter((id) => !covered.has(id) && suggestable(id))
    : itemIds;
  if (!ids.length) return null;
  const b = el('div', 'build-block');
  b.append(el('div', 'src', esc(srcLabel)));
  const wrap = el('div', 'items');
  const gold = state.live?.activePlayer?.gold ?? 0;
  ids.forEach((id, i) => {
    if (i) wrap.append(el('span', 'arrow', '›'));
    const img = itemImg(id);
    if (markProgress) {
      img.title += ' · right-click hides this game';
      img.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        hideItemForGame(id);
      });
      if (i === 0) {
        const it = state.itemById.get(id);
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
    g.items.forEach((rawId, idx) => {
      // count upgraded/variant forms as their purchasable base
      const id = purchasableForm(rawId);
      if (!id) return;
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
  const ids = [...staples, ...rest].map((r) => r.id).slice(0, 8);
  return ids.length ? { ids, wins: wins.length } : null;
}

// Ordered item pool for ONE aramgg build variant: most-played core, then its
// other core variants' items, then that build's situational pool.
function variantPool(b) {
  const cores = [...(b.coreItems ?? [])].sort((x, y) => (y.games ?? 0) - (x.games ?? 0));
  const coreIds = cores[0]?.itemIds ?? [];
  const seen = new Set(coreIds);
  const pool = [...coreIds];
  for (const c of cores) {
    for (const id of c.itemIds) if (!seen.has(id)) { seen.add(id); pool.push(id); }
  }
  for (const id of itemIdsFromNames(b.situationalItems)) {
    if (!seen.has(id)) { seen.add(id); pool.push(id); }
  }
  // only ever suggest purchasable base forms (Wooglet's -> Rabadon's, etc.)
  return normalizeSuggestionIds(pool);
}

function champVariants() {
  const builds = state.champData?.championId === myChampion()?.id
    ? state.champData?.buildSummary?.builds ?? [] : [];
  return [...builds].sort((a, b) => (b.games ?? 0) - (a.games ?? 0)).slice(0, 3);
}

// The in-game strip shows every path at once: my winning consensus plus one
// row per aramgg build variant (tank/AP/AD/...), each minimisable in the
// strip window. Owned items skipped, first item flagged when affordable.
function stripRows() {
  if (!state.live) return [];
  const owned = coveredItemIds();
  const gold = state.live?.activePlayer?.gold ?? 0;
  const mk = (ids) => ids
    .filter((id) => !owned.has(id) && suggestable(id))
    .slice(0, 5)
    .map((id, i) => {
      const it = state.itemById.get(id);
      return it ? {
        id,
        icon: it.icon, name: it.name, price: it.price,
        affordable: i === 0 && it.price <= gold,
      } : null;
    })
    .filter(Boolean);

  const rows = [];
  const mine = myWinningPath(myChampion()?.id);
  if (mine) {
    const items = mk(mine.ids);
    if (items.length) rows.push({ id: 'mine', label: `MINE ${mine.wins}W`, items });
  }
  for (const b of champVariants()) {
    const items = mk(variantPool(b));
    if (!items.length) continue;
    const tags = ((b.tags ?? []).join('/') || 'BUILD').toUpperCase();
    const label = b.winRate != null ? `${tags} ${(b.winRate * 100).toFixed(0)}%` : tags;
    rows.push({ id: tags, label, items });
  }
  return rows;
}

// Top best-in-slot trios still REACHABLE this game: a combo is dead the
// moment any non-picked member has been seen in an offer (no repeats per
// game). Sorted by how far along I am, then combo tier, then sample size.
function bisCombos() {
  const trios = state.champData?.championId === myChampion()?.id ? state.champData?.trios : null;
  if (!trios?.length) return [];
  const pickedIds = new Set(state.picked.map((n) => state.augByName.get(n)?.id).filter(Boolean));
  const seenUnpickedIds = new Set(
    [...state.seen]
      .filter((n) => !state.picked.includes(n))
      .map((n) => state.augByName.get(n)?.id)
      .filter(Boolean)
  );
  return trios
    .filter((t) => t.games >= 150)
    .filter((t) => t.ids.every((id) => state.augById.get(id) && !state.augById.get(id).disabled))
    .filter((t) => !t.ids.some((id) => seenUnpickedIds.has(id))) // still reachable
    .map((t) => ({ ...t, have: t.ids.filter((id) => pickedIds.has(id)).length }))
    .sort((a, b) => b.have - a.have || a.tier - b.tier || b.games - a.games)
    .slice(0, 3)
    .map((t) => ({
      tier: t.tier,
      games: t.games,
      have: t.have,
      augs: t.ids.map((id) => {
        const a = state.augById.get(id);
        return { name: a.name, icon: a.icon, picked: pickedIds.has(id) };
      }),
    }));
}

let lastStripKey = null;
function updateBuildStrip() {
  const rows = stripRows();
  if (!rows.length) {
    if (lastStripKey !== null) { lastStripKey = null; window.mayhem.clearBuildStrip(); }
    return;
  }
  const hidden = [...state.hiddenItems]
    .map((id) => {
      const it = state.itemById.get(id);
      return it ? { id, icon: it.icon, name: it.name } : null;
    })
    .filter(Boolean);
  const combos = bisCombos();
  const key = JSON.stringify([
    rows.map((r) => [r.label, r.items.map((i) => [i.name, i.affordable])]),
    hidden.map((h) => h.id),
    state.showBoots,
    combos.map((c) => [c.tier, c.have, c.augs.map((a) => a.name)]),
  ]);
  if (key === lastStripKey) return;
  lastStripKey = key;
  window.mayhem.showBuildStrip({ rows, hidden, combos, showBoots: state.showBoots });
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
      const blk = buildBlock(
        `MY WINS · consensus from ${mine.wins} winning game${mine.wins > 1 ? 's' : ''}`,
        mine.ids, 'highlighted = build next', { markProgress: true });
      if (blk) box.append(blk);
    }

    // 2) saved builds for this champion
    const saved = state.builds.filter((b) => b.championName?.toLowerCase() === (champName ?? '').toLowerCase());
    for (const b of saved.slice(0, 2)) {
      const augNames = (b.augments ?? []).map((id) => state.augById.get(id)?.name).filter(Boolean);
      buildBlockSafe(box, `SAVED · ${b.playerName ?? 'unknown player'}`, b.finalItems ?? b.items,
        augNames.length ? `augments: ${augNames.join(', ')}` : b.note);
    }

    // 3) every aramgg build variant for this champion, side by side
    const variants = champVariants();
    if (variants.length) {
      const top = variants[0];
      const startIds = normalizeSuggestionIds(itemIdsFromNames([...new Set(top.startingItems ?? [])]));
      if (startIds.length && (state.live.me?.items?.length ?? 0) < 2 && (state.live.gameTime ?? 0) < 240) {
        box.append(buildBlock('START · aramgg', startIds));
      }
      for (const b of variants) {
        const tags = ((b.tags ?? []).join('/') || 'BUILD').toUpperCase();
        const blk = buildBlock(
          `${tags} · ${(b.winRate * 100).toFixed(1)}% WR · ${(b.games ?? 0).toLocaleString()} games`,
          variantPool(b).slice(0, 8), null, { markProgress: true });
        if (blk) box.append(blk);
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
  $('#btn-collapse').addEventListener('click', () => {
    const collapsed = $('#root').classList.toggle('collapsed');
    window.mayhem.setCollapsed(collapsed);
  });
  $('#btn-pin').addEventListener('click', () => window.mayhem.setClickThrough(!state.clickThrough));
  $('#offer-clear').addEventListener('click', () => {
    state.picked = [];
    renderMyAugments(); renderAugments(); renderBuildTab();
    saveSession();
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
    if (firstUpdate) {
      state.picked = []; state.seen = new Set(); state.hiddenItems = new Set();
      renderMyAugments(); renderAugments();
      restoreSession(live).then((restored) => {
        if (restored) {
          renderMyAugments();
          renderAugments();
          lastStripKey = null;
          updateBuildStrip();
          if ($('#tab-build').classList.contains('active')) renderBuildTab();
        }
      });
    }
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
  // right-click in the strip window hides/restores an item for this game
  window.mayhem.onHideItem((id) => hideItemForGame(id));
  // boots preference toggled from the strip window
  window.mayhem.onShowBoots((v) => {
    state.showBoots = v;
    if ($('#tab-build').classList.contains('active')) renderBuildTab();
    lastStripKey = null;
    updateBuildStrip();
  });
  state.showBoots = await window.mayhem.getShowBoots();
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
