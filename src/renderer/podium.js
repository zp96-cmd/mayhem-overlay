/* Hall of Fame podium: top-3 champions by games played (win rate as tiebreak),
   their most-picked augments, and your highest-kill game — from the local
   match-history store. Fully animated (this window isn't over the game). */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wrCls = (wr) => (wr >= 0.55 ? 'good' : wr < 0.45 ? 'bad' : 'mid');

// Not every champion has a "centered" splash crop on CommunityDragon (e.g. Brand),
// and background-image can't fall back on error — so try each source in turn and
// use the first that actually loads.
function hydrateSplashes(root) {
  root.querySelectorAll('.splash[data-champ]').forEach((el) => {
    const id = el.dataset.champ;
    const sources = [
      `https://cdn.communitydragon.org/latest/champion/${id}/splash-art/centered`,
      `https://cdn.communitydragon.org/latest/champion/${id}/splash-art`,
      `https://cdn.communitydragon.org/latest/champion/${id}/tile`,
      el.dataset.icon || '',
    ].filter(Boolean);
    let i = 0;
    (function tryNext() {
      if (i >= sources.length) return;
      const url = sources[i++];
      const img = new Image();
      img.onload = () => { el.style.backgroundImage = `url('${url}')`; };
      img.onerror = tryNext;
      img.src = url;
    })();
  });
}
const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉');

$('#min').addEventListener('click', () => window.mayhem.minimizePodium());
$('#close').addEventListener('click', () => window.mayhem.closePodium());

function colHtml(e, rank, champById, augById) {
  const c = champById.get(e.id);
  const wr = e.wins / e.games;
  const pct = Math.round(wr * 100);
  const topAugs = [...e.aug.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([aid, ct]) => ({ aug: augById.get(aid), ct }))
    .filter((x) => x.aug);
  const augRow = topAugs.length
    ? `<div class="alist">${topAugs.map((t) =>
        `<div class="ar"><img src="${t.aug.icon}" alt=""><span class="an">${esc(t.aug.name)}</span>${t.ct > 1 ? `<span class="ac">×${t.ct}</span>` : ''}</div>`
      ).join('')}</div>`
    : `<div class="empty">no augment data yet</div>`;
  return `<div class="col rank-${rank}">
    ${rank === 1 ? '<div class="crown">👑</div>' : ''}
    <div class="medal">${medal(rank)}</div>
    <div class="card">
      <div class="splash" data-champ="${e.id}" data-icon="${esc(c?.icon ?? '')}"></div>
      <div class="shine"></div><div class="gloss"></div>
      <div class="scrim">
        <div class="cname">${esc(c?.name ?? 'Champion ' + e.id)}</div>
        <div class="wr ${wrCls(wr)}"><b data-count="${pct}">0</b><span class="lbl">% WIN RATE</span></div>
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
  $('#stage').querySelectorAll('.card').forEach(attachTilt);
  hydrateSplashes($('#stage'));
}

function renderKillHero(hk, champById) {
  if (!hk) return;
  const c = champById.get(hk.championId);
  $('#hk').innerHTML = `<div class="kill-hero">
    <div class="splash" data-champ="${hk.championId}" data-icon="${esc(c?.icon ?? '')}"></div>
    <div class="scrim">
      <div style="text-align:center">
        <div class="big" data-count="${hk.kills ?? 0}">0</div>
        <div class="k">KILLS</div>
      </div>
      <div class="meta">
        <div class="t">🔥 HIGHEST KILL GAME</div>
        <div class="c">${esc(c?.name ?? 'Champion ' + hk.championId)}</div>
        <div class="s">${hk.kills ?? 0} / ${hk.deaths ?? 0} / ${hk.assists ?? 0} · <span class="${hk.win ? 'win' : 'loss'}">${hk.win ? 'Victory' : 'Defeat'}</span></div>
      </div>
    </div>
  </div>`;
  attachTilt($('#hk .kill-hero'));
  hydrateSplashes($('#hk'));
}

const WRBAR_MIN_GAMES = 3; // champs need this many games to appear in the win-rate rail
function renderWrBars(champWr, champById) {
  const box = document.getElementById('wrbars');
  box.innerHTML = champWr.map((e, i) => {
    const wr = e.wins / e.games;
    const pct = Math.round(wr * 100);
    const cls = wrCls(wr);
    const c = champById.get(e.id);
    return `<div class="wrbar" style="animation-delay:${(i * 0.04).toFixed(2)}s">
      <div class="top">${c?.icon ? `<img src="${c.icon}" alt="">` : ''}<span class="nm">${esc(c?.name ?? 'Champ ' + e.id)}</span><span class="pc ${cls}">${pct}%</span></div>
      <div class="track"><span class="fill ${cls}" data-w="${pct}"></span></div>
    </div>`;
  }).join('');
  requestAnimationFrame(() => box.querySelectorAll('.fill').forEach((f) => { f.style.width = `${f.dataset.w}%`; }));
}

const MATE_MIN_GAMES = 5; // only show people you've played with at least this many times
function renderSquad(squad) {
  if (!squad.length) return;
  const cards = squad.slice(0, 8).map((m, i) => {
    const wr = m.wins / m.games;
    const pct = Math.round(wr * 100);
    const cls = wrCls(wr);
    const [name, tag] = m.id.split('#');
    return `<div class="mate${i === 0 ? ' best' : ''}">
      <div class="mn">${esc(name)}${tag ? `<span class="tag">#${esc(tag)}</span>` : ''}</div>
      <div class="mwr ${cls}"><b data-count="${pct}">0</b><span>%</span></div>
      <div class="mbar"><span class="fill ${cls}" data-w="${pct}"></span></div>
      <div class="mg"><span class="rec">${m.wins}W ${m.games - m.wins}L</span> · ${m.games} together</div>
    </div>`;
  }).join('');
  $('#squad').innerHTML =
    `<div class="sec-h"><span class="g">SQUAD</span> · win rate playing together (${MATE_MIN_GAMES}+ games)</div>` +
    `<div class="mates">${cards}</div>`;
  // animate the bars after paint
  requestAnimationFrame(() => $('#squad').querySelectorAll('.fill').forEach((f) => { f.style.width = `${f.dataset.w}%`; }));
}

/* ---- flourishes ---- */
function countUp(el, to, dur = 1200) {
  const start = performance.now();
  (function frame(t) {
    const p = Math.min(1, (t - start) / dur);
    const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
    el.textContent = Math.round(to * e);
    if (p < 1) requestAnimationFrame(frame);
  })(start);
}
function runCounters(delay = 620) {
  setTimeout(() => {
    document.querySelectorAll('[data-count]').forEach((el) => countUp(el, Number(el.dataset.count)));
  }, delay);
}

// cursor tilt + parallax gloss on a card
function attachTilt(card) {
  const splashEl = card.querySelector('.splash');
  card.addEventListener('mousemove', (ev) => {
    const r = card.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width;
    const py = (ev.clientY - r.top) / r.height;
    const rx = (0.5 - py) * 9;
    const ry = (px - 0.5) * 12;
    card.style.transform = `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-6px)`;
    card.style.setProperty('--mx', `${px * 100}%`);
    card.style.setProperty('--my', `${py * 100}%`);
    if (splashEl) splashEl.style.transform = `translate(${(px - 0.5) * -14}px, ${(py - 0.5) * -10}px) scale(1.12)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
    if (splashEl) splashEl.style.transform = '';
  });
}

// ambient drifting gold motes
function startDust() {
  const cv = document.getElementById('dust');
  const ctx = cv.getContext('2d');
  let W, H, motes = [];
  function size() {
    W = cv.width = window.innerWidth;
    H = cv.height = window.innerHeight;
    motes = Array.from({ length: 46 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.8 + 0.4, s: Math.random() * 0.28 + 0.05,
      tw: Math.random() * Math.PI * 2,
    }));
  }
  size();
  window.addEventListener('resize', size);
  (function tick() {
    ctx.clearRect(0, 0, W, H);
    for (const m of motes) {
      m.y -= m.s; m.tw += 0.02;
      if (m.y < -6) { m.y = H + 6; m.x = Math.random() * W; }
      const a = 0.18 + 0.22 * Math.sin(m.tw);
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, 7);
      ctx.fillStyle = `rgba(232,193,90,${a})`;
      ctx.fill();
    }
    requestAnimationFrame(tick);
  })();
}

async function init() {
  startDust();
  const [games, augData, champData] = await Promise.all([
    window.mayhem.getHistory(),
    window.mayhem.getAugments(),
    window.mayhem.getChampions(),
  ]);
  const augById = new Map((augData?.augments ?? []).filter((a) => a.id).map((a) => [a.id, a]));
  const champById = new Map((champData?.champions ?? []).map((c) => [c.id, c]));
  const list = Array.isArray(games) ? games : [];

  if (!list.length) { $('#empty').style.display = 'block'; $('#rail').style.display = 'none'; return; }

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

  // teammates: on ARAM Mayhem your whole team shares the result, so a participant
  // with the same win as me is a teammate (exclude myself by riotId / champion)
  const mates = new Map();
  for (const g of list) {
    for (const p of (g.participants ?? [])) {
      if (!p.riotId || p.win !== g.win) continue;
      if (p.riotId === g.myRiotId || p.championId === g.championId) continue;
      let e = mates.get(p.riotId);
      if (!e) { e = { id: p.riotId, games: 0, wins: 0 }; mates.set(p.riotId, e); }
      e.games++;
      if (g.win) e.wins++;
    }
  }
  const squad = [...mates.values()]
    .filter((m) => m.games >= MATE_MIN_GAMES)
    .sort((a, b) => (b.wins / b.games) - (a.wins / a.games) || b.games - a.games);

  // win-rate rail: champs with enough games, best win rate first (descending)
  const champWr = [...byChamp.values()]
    .filter((e) => e.games >= WRBAR_MIN_GAMES)
    .sort((a, b) => (b.wins / b.games) - (a.wins / a.games) || b.games - a.games)
    .slice(0, 12);

  renderWrBars(champWr, champById);
  renderPodium(ranked, champById, augById);
  renderKillHero(hk, champById);
  renderSquad(squad);
  runCounters();
  $('#foot').textContent = `${list.length} games recorded · ${byChamp.size} champions played`;
}

init();
