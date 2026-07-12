/* Pre-game prep dashboard: champion stats, bench comparator, augment hot
   list, and build paths for the champion I currently hold in champ select. */

const state = {
  augments: [], augById: new Map(),
  champions: [], champById: new Map(),
  items: [], itemById: new Map(), itemByName: new Map(),
  champStats: {},          // championId -> { winRate, tier, games, pickRate } (aramgg)
  history: [], builds: [],
  session: null,           // { myChampionId, bench: [ids], team: [ids] }
  champData: null,         // aramgg per-champion { championId, buildSummary, augments }
  shownFor: null,
};

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const wrCls = (wr) => (wr >= 0.53 ? 'wr-good' : wr < 0.48 ? 'wr-bad' : 'wr-mid');

function myGamesOn(champId) {
  return state.history.filter((g) => g.championId === champId);
}

function renderHeader(champId) {
  const c = state.champById.get(champId);
  const s = state.champStats[String(champId)];
  // base skin splash art from CommunityDragon as the header backdrop
  $('#splash').style.backgroundImage =
    `url('https://cdn.communitydragon.org/latest/champion/${champId}/splash-art/centered')`;
  $('#h-icon').src = c?.icon ?? '';
  $('#h-name').textContent = c?.name ?? `Champion ${champId}`;
  if (s) {
    $('#h-wr').textContent = pct(s.winRate);
    $('#h-wr').className = `bigwr ${wrCls(s.winRate)}`;
    $('#h-tier').textContent = `T${s.tier}`;
    $('#h-tier').className = `tierchip tier-${s.tier}`;
    $('#h-meta').innerHTML = `${pct(s.pickRate, 2)} pick rate · ${s.games.toLocaleString()} games <span style="color:#556">· aramgg</span>`;
  } else {
    $('#h-wr').textContent = '-';
    $('#h-tier').textContent = '';
    $('#h-meta').textContent = 'no community data';
  }
  const mine = myGamesOn(champId);
  if (mine.length) {
    const wins = mine.filter((g) => g.win).length;
    const k = mine.reduce((a, g) => a + g.kills, 0), d = mine.reduce((a, g) => a + g.deaths, 0), a2 = mine.reduce((a, g) => a + g.assists, 0);
    $('#h-myrec').innerHTML = `<span class="${wrCls(wins / mine.length)}">${wins}W ${mine.length - wins}L</span>`;
    $('#h-mykda').textContent = `${(k / mine.length).toFixed(1)} / ${(d / mine.length).toFixed(1)} / ${(a2 / mine.length).toFixed(1)} avg · ${mine.length} games`;
  } else {
    $('#h-myrec').textContent = '-';
    $('#h-mykda').textContent = 'no games recorded';
  }
}

function renderBench() {
  const wrap = $('#bench-wrap');
  const box = $('#bench');
  box.innerHTML = '';
  const bench = state.session?.bench ?? [];
  if (!bench.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const myWr = state.champStats[String(state.session.myChampionId)]?.winRate ?? null;

  const cards = bench.map((id) => {
    const c = state.champById.get(id);
    const s = state.champStats[String(id)];
    const mine = myGamesOn(id);
    const myWins = mine.filter((g) => g.win).length;
    return { id, c, s, mine, myWins };
  }).sort((a, b) => (b.s?.winRate ?? 0) - (a.s?.winRate ?? 0));

  for (const { id, c, s, mine, myWins } of cards) {
    const better = s && myWr !== null && s.winRate > myWr + 0.005;
    const card = el('div', `bench-card${better ? ' better' : ''}`);
    if (c?.icon) { const img = el('img'); img.src = c.icon; card.append(img); }
    const mid = el('div');
    mid.append(el('div', 'nm', esc(c?.name ?? id)));
    mid.append(el('div', `wr ${s ? wrCls(s.winRate) : ''}`, s ? pct(s.winRate) : '-'));
    if (mine.length) mid.append(el('div', 'mine', `me: ${myWins}W ${mine.length - myWins}L`));
    card.append(mid);
    if (better) card.append(el('div', 'swap', 'SWAP ▲'));
    box.append(card);
  }
}

function renderHotList(champId) {
  const box = $('#hotlist');
  box.innerHTML = '';
  const perChamp = state.champData?.championId === champId ? state.champData?.augments : null;
  if (!perChamp) {
    box.append(el('div', 'empty', 'Augment data loads a moment after the champion is known…'));
    return;
  }
  const myAugWr = (augId) => {
    const games = state.history.filter((g) => (g.augments ?? []).includes(augId));
    if (games.length < 2) return null;
    return { wr: games.filter((g) => g.win).length / games.length, n: games.length };
  };
  const rows = Object.entries(perChamp)
    .map(([id, s]) => ({ aug: state.augById.get(Number(id)), ...s }))
    .filter((r) => r.aug && !r.aug.disabled && r.games >= 200)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 14);
  if (!rows.length) {
    box.append(el('div', 'empty', 'Not enough per-champion augment data.'));
    return;
  }
  const maxWr = rows[0].winRate;
  for (const r of rows) {
    const mine = r.aug.id ? myAugWr(r.aug.id) : null;
    const row = el('div', `hot-row${mine ? ' pers' : ''}`);
    const bar = el('div', 'bar');
    bar.style.width = `${(r.winRate / maxWr) * 100}%`;
    row.append(bar);
    if (r.aug.icon) { const img = el('img'); img.src = r.aug.icon; img.loading = 'lazy'; row.append(img); }
    row.append(el('div', 'nm',
      `${esc(r.aug.name)}<span class="t ${r.aug.tier}">${r.aug.tier.toUpperCase()}</span>` +
      (mine ? `<div class="my">me: ${pct(mine.wr, 0)} in ${mine.n}</div>` : '')));
    const right = el('div');
    right.append(el('div', `wr ${wrCls(r.winRate)}`, pct(r.winRate)));
    right.append(el('div', 'games', `${r.games.toLocaleString()} games`));
    row.append(right);
    box.append(row);
  }
}

// Best augment trios for this champion (aramgg combo data: tier 1 best .. 5 worst)
function renderCombos(champId) {
  const box = $('#combos');
  box.innerHTML = '';
  const trios = state.champData?.championId === champId ? state.champData?.trios : null;
  if (!trios?.length) {
    box.append(el('div', 'empty', 'Combo data loads with the champion…'));
    return;
  }
  const rows = trios
    .filter((t) => t.games >= 100 && t.ids.every((id) => {
      const a = state.augById.get(id);
      return a && !a.disabled;
    }))
    .sort((a, b) => a.tier - b.tier || b.games - a.games)
    .slice(0, 10);
  if (!rows.length) {
    box.append(el('div', 'empty', 'Not enough combo data for this champion.'));
    return;
  }
  const tCls = (t) => (t <= 2 ? 't-good' : t >= 4 ? 't-bad' : 't-mid');
  for (const t of rows) {
    const augs = t.ids.map((id) => state.augById.get(id));
    const row = el('div', 'combo-row');
    const icons = el('div', 'augs');
    for (const a of augs) {
      const img = el('img');
      if (a.icon) img.src = a.icon;
      img.title = a.name;
      img.loading = 'lazy';
      icons.append(img);
    }
    row.append(icons);
    row.append(el('div', 'names', augs.map((a) => esc(a.name)).join(' + ')));
    row.append(el('span', `tchip ${tCls(t.tier)}`, `T${t.tier}`));
    row.append(el('div', 'cgames num', `${t.games.toLocaleString()} games`));
    box.append(row);
  }
}

function itemImg(id, small = false) {
  const it = state.itemById.get(id);
  const img = el('img');
  if (it?.icon) img.src = it.icon;
  img.title = it ? `${it.name} (${it.price}g)` : `item ${id}`;
  img.loading = 'lazy';
  return img;
}

function itemsRow(ids, { arrows = false, small = false } = {}) {
  const row = el('div', `items${small ? ' small' : ''}`);
  ids.forEach((id, i) => {
    if (arrows && i) row.append(el('span', 'arrow', '›'));
    row.append(itemImg(id, small));
  });
  return row;
}

function idsFromNames(names) {
  return (names ?? []).map((n) => state.itemByName.get(String(n).toLowerCase())?.id).filter(Boolean);
}

function renderBuilds(champId) {
  const box = $('#builds');
  box.innerHTML = '';

  // my winning consensus first (same logic as the overlay)
  const wins = state.history.filter((g) => g.championId === champId && g.win && (g.items ?? []).length >= 3).slice(0, 10);
  if (wins.length) {
    const freq = new Map(), slot = new Map();
    for (const g of wins) g.items.forEach((id, i) => {
      const it = state.itemById.get(id);
      if (!it || it.price < 900) return;
      freq.set(id, (freq.get(id) ?? 0) + 1);
      slot.set(id, (slot.get(id) ?? 0) + i);
    });
    const half = Math.max(1, wins.length / 2);
    const ranked = [...freq.entries()].map(([id, f]) => ({ id, f, s: slot.get(id) / f }));
    const ids = [
      ...ranked.filter((r) => r.f >= half).sort((a, b) => a.s - b.s),
      ...ranked.filter((r) => r.f < half).sort((a, b) => b.f - a.f),
    ].map((r) => r.id).slice(0, 6);
    const v = el('div', 'variant top');
    v.append(el('div', 'vhead',
      `<span class="tags">MY WINS</span><span class="vgames">consensus from ${wins.length} winning game${wins.length > 1 ? 's' : ''}</span>`));
    v.append(itemsRow(ids, { arrows: true }));
    box.append(v);
  }

  // saved builds
  const cname = state.champById.get(champId)?.name?.toLowerCase();
  for (const b of state.builds.filter((x) => x.championName?.toLowerCase() === cname).slice(0, 2)) {
    const v = el('div', 'variant');
    v.append(el('div', 'vhead',
      `<span class="tags">SAVED</span><span class="vgames">${esc(b.playerName ?? '')}${b.won !== undefined ? (b.won ? ' · won' : ' · lost') : ''}</span>`));
    v.append(itemsRow(b.finalItems ?? b.items ?? [], { arrows: true }));
    if (b.augments?.length) {
      v.append(el('div', 'ilabel', 'THEIR AUGMENTS'));
      const row = el('div', 'items small');
      for (const id of b.augments) {
        const a = state.augById.get(id);
        if (a?.icon) { const img = el('img'); img.src = a.icon; img.title = a.name; row.append(img); }
      }
      v.append(row);
    }
    box.append(v);
  }

  // aramgg variants
  const builds = state.champData?.championId === champId ? state.champData?.buildSummary?.builds : null;
  if (builds?.length) {
    const sorted = [...builds].sort((a, b) => (b.games ?? 0) - (a.games ?? 0));
    for (const b of sorted.slice(0, 3)) {
      const v = el('div', 'variant');
      v.append(el('div', 'vhead',
        `<span class="tags">${esc((b.tags ?? []).join(' / ') || 'BUILD')}</span>` +
        `<span class="vwr ${wrCls(b.winRate)}">${pct(b.winRate)}</span>` +
        `<span class="vgames">${(b.games ?? 0).toLocaleString()} games · ${pct(b.pickRate ?? 0, 0)} of players</span>`));
      const bar = el('div', 'wrbar');
      const fill = el('div');
      fill.style.width = `${Math.min(100, Math.max(4, (b.winRate - 0.40) / 0.25 * 100))}%`;
      fill.style.background = b.winRate >= 0.53 ? 'var(--good)' : b.winRate < 0.48 ? 'var(--bad)' : 'var(--mid)';
      bar.append(fill);
      v.append(bar);

      const core = [...(b.coreItems ?? [])].sort((x, y) => (y.games ?? 0) - (x.games ?? 0))[0];
      if (core) {
        v.append(el('div', 'ilabel', `CORE <span class="corewr">${pct(core.winRate)} WR · ${(core.games ?? 0).toLocaleString()} games</span>`));
        v.append(itemsRow(core.itemIds, { arrows: true }));
      }
      const startIds = idsFromNames([...new Set(b.startingItems ?? [])]);
      if (startIds.length) {
        v.append(el('div', 'ilabel', 'START'));
        v.append(itemsRow(startIds, { small: true }));
      }
      const situIds = idsFromNames(b.situationalItems).filter((id) => !core?.itemIds?.includes(id));
      if (situIds.length) {
        v.append(el('div', 'ilabel', 'SITUATIONAL (SLOTS 4-6)'));
        v.append(itemsRow(situIds.slice(0, 8), { small: true }));
      }
      box.append(v);
    }
  }
  if (!box.children.length) box.append(el('div', 'empty', 'No build data for this champion yet.'));
}

function render() {
  const champId = state.session?.myChampionId;
  if (!champId) return;
  $('#waiting').style.display = 'none';
  $('#dash').style.display = 'block';
  renderHeader(champId);
  renderBench();
  renderHotList(champId);
  renderCombos(champId);
  renderBuilds(champId);
}

async function init() {
  const [augData, champData, itemData, champStats, history, builds] = await Promise.all([
    window.mayhem.getAugments(),
    window.mayhem.getChampions(),
    window.mayhem.getItems(),
    window.mayhem.getChampionStats(),
    window.mayhem.getHistory(),
    window.mayhem.getBuilds(),
  ]);
  state.augments = augData?.augments ?? [];
  state.augments.forEach((a) => { if (a.id) state.augById.set(a.id, a); });
  state.champions = champData?.champions ?? [];
  state.champions.forEach((c) => state.champById.set(c.id, c));
  state.items = itemData?.items ?? [];
  state.items.forEach((i) => { state.itemById.set(i.id, i); state.itemByName.set(i.name.toLowerCase(), i); });
  state.champStats = champStats?.stats ?? {};
  state.history = history ?? [];
  state.builds = builds ?? [];

  window.mayhem.onPrepSession((s) => { state.session = s; render(); });
  window.mayhem.onPrepChampData((d) => { state.champData = d; render(); });
}

init();
