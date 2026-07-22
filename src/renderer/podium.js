/* Hall of Fame podium: top-3 champions by games played (win rate as tiebreak),
   their most-picked augments, and your highest-kill game — all from the local
   match-history store. */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const splash = (id) => `https://cdn.communitydragon.org/latest/champion/${id}/splash-art/centered`;
const wrCls = (wr) => (wr >= 0.55 ? 'good' : wr < 0.45 ? 'bad' : 'mid');
const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉');

$('#min').addEventListener('click', () => window.mayhem.minimizePodium());
$('#close').addEventListener('click', () => window.mayhem.closePodium());

function colHtml(e, rank, champById, augById) {
  const c = champById.get(e.id);
  const wr = e.wins / e.games;
  const topAugs = [...e.aug.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([aid, ct]) => ({ aug: augById.get(aid), ct }))
    .filter((x) => x.aug);
  const augRow = topAugs.length
    ? `<div class="row">${topAugs.map((t) =>
        `<span class="a"><img src="${t.aug.icon}" title="${esc(t.aug.name)}">${t.ct > 1 ? `<span class="ct">${t.ct}</span>` : ''}</span>`
      ).join('')}</div>`
    : `<div class="empty">no augment data yet</div>`;
  return `<div class="col rank-${rank}">
    <div class="medal">${medal(rank)}</div>
    <div class="card" style="background-image:url('${splash(e.id)}')">
      <div class="scrim">
        <div class="cname">${esc(c?.name ?? 'Champion ' + e.id)}</div>
        <div class="wr ${wrCls(wr)}"><b>${(wr * 100).toFixed(0)}%</b><span class="lbl">WIN RATE</span></div>
        <div class="games"><span class="rec">${e.wins}W ${e.games - e.wins}L</span> · ${e.games} games</div>
      </div>
    </div>
    <div class="augs"><div class="h">MOST PICKED</div>${augRow}</div>
    <div class="pedestal"><span class="rnum">${rank}</span></div>
  </div>`;
}

function renderPodium(ranked, champById, augById) {
  const cols = [];
  if (ranked[1]) cols.push(colHtml(ranked[1], 2, champById, augById)); // 2nd on the left
  if (ranked[0]) cols.push(colHtml(ranked[0], 1, champById, augById)); // 1st in the centre
  if (ranked[2]) cols.push(colHtml(ranked[2], 3, champById, augById)); // 3rd on the right
  $('#stage').innerHTML = cols.join('');
}

function renderKillHero(hk, champById) {
  if (!hk) return;
  const c = champById.get(hk.championId);
  $('#hk').innerHTML = `<div class="kill-hero" style="background-image:url('${splash(hk.championId)}')">
    <div class="scrim">
      <div style="text-align:center">
        <div class="big">${hk.kills ?? 0}</div>
        <div class="meta"><div class="k">KILLS</div></div>
      </div>
      <div class="meta">
        <div class="t">🔥 HIGHEST KILL GAME</div>
        <div class="c">${esc(c?.name ?? 'Champion ' + hk.championId)}</div>
        <div class="s">${hk.kills ?? 0} / ${hk.deaths ?? 0} / ${hk.assists ?? 0} · ${hk.win ? 'Victory' : 'Defeat'}</div>
      </div>
    </div>
  </div>`;
}

async function init() {
  const [games, augData, champData] = await Promise.all([
    window.mayhem.getHistory(),
    window.mayhem.getAugments(),
    window.mayhem.getChampions(),
  ]);
  const augById = new Map((augData?.augments ?? []).filter((a) => a.id).map((a) => [a.id, a]));
  const champById = new Map((champData?.champions ?? []).map((c) => [c.id, c]));
  const list = Array.isArray(games) ? games : [];

  if (!list.length) { $('#empty').style.display = 'block'; return; }

  const byChamp = new Map();
  for (const g of list) {
    const id = g.championId;
    if (!id) continue;
    let e = byChamp.get(id);
    if (!e) { e = { id, games: 0, wins: 0, aug: new Map() }; byChamp.set(id, e); }
    e.games++;
    if (g.win) e.wins++;
    for (const aid of (g.augments ?? [])) {
      if (aid > 0) e.aug.set(aid, (e.aug.get(aid) ?? 0) + 1);
    }
  }
  const ranked = [...byChamp.values()]
    .sort((a, b) => b.games - a.games || (b.wins / b.games) - (a.wins / a.games))
    .slice(0, 3);

  let hk = null;
  for (const g of list) {
    if (hk === null || (g.kills ?? 0) > (hk.kills ?? 0)) hk = g;
  }

  renderPodium(ranked, champById, augById);
  renderKillHero(hk, champById);
  $('#foot').textContent = `${list.length} games recorded · ${byChamp.size} champions played`;
}

init();
