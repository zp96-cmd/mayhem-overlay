// Click-through badge layer: little stat pills positioned over the real
// augment cards on the game's choice screen.
const root = document.getElementById('root');

const wrClass = (wr) => (wr >= 0.53 ? 'wr-good' : wr < 0.48 ? 'wr-bad' : 'wr-mid');
const pct = (v) => `${(v * 100).toFixed(1)}%`;

const comboClass = (t) => (t <= 2 ? 'wr-good' : t >= 4 ? 'wr-bad' : 'wr-mid');

window.mayhem.onBadges((data) => {
  const badges = Array.isArray(data) ? data : (data?.pills ?? []);
  const verdict = Array.isArray(data) ? null : data?.verdict;
  root.innerHTML = '';
  for (const b of badges) {
    const d = document.createElement('div');
    d.className = `badge${b.best ? ' best' : ''}`;
    const wr = b.winRate != null
      ? `<div class="top"><span class="${wrClass(b.winRate)}">${pct(b.winRate)}</span></div>`
      : `<div class="top"><span class="sub">no data</span></div>`;
    const champ = b.champWr != null
      ? `<div class="champ ${wrClass(b.champWr)}">${pct(b.champWr)} on ${b.champName}</div>` : '';
    const combo = b.comboTier != null
      ? `<div class="champ ${comboClass(b.comboTier)}">combo T${b.comboTier.toFixed(1)} with your picks</div>` : '';
    d.innerHTML =
      wr + champ + combo +
      `<div class="sub">#${b.rank} of offer · score ${b.score.toFixed(1)}</div>` +
      (b.best ? `<div class="tag">★ BEST PICK</div>` : '');
    d.style.left = `${b.x + b.w / 2}px`;
    d.style.top = `${b.y}px`;
    root.append(d);
  }
  const v = document.getElementById('verdict');
  if (verdict) {
    v.className = verdict.action.toLowerCase();
    v.innerHTML =
      `<span class="act">${verdict.action === 'KEEP' ? '✓ KEEP' : verdict.action === 'REROLL' ? '⟳ REROLL' : '~ CLOSE CALL'}</span>` +
      `<span class="nums">best of offer ${verdict.best.toFixed(1)} · reroll expects ${verdict.ev.toFixed(1)}</span>`;
    v.style.display = 'flex';
  } else {
    v.style.display = 'none';
  }
});

// Priority list: best augments still in the pool this game (seen ones excluded)
const prio = document.getElementById('prio');

window.mayhem.onPrio((data) => {
  if (!data || !data.items?.length) { prio.style.display = 'none'; return; }
  prio.innerHTML = `<div class="title">PRIORITY${data.tier ? ' · ' + data.tier.toUpperCase() : ''}</div>`;
  for (const it of data.items) {
    const r = document.createElement('div');
    r.className = `row${it.offered ? ' offered' : ''}`;
    r.innerHTML =
      (it.icon ? `<img src="${it.icon}">` : '') +
      `<span class="nm">${it.name}</span>` +
      `<span class="pwr ${wrClass(it.wr ?? 0.5)}">${it.wr != null ? pct(it.wr) : '-'}</span>`;
    prio.append(r);
  }
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'still in pool this game · outlined = in current offer';
  prio.append(hint);
  prio.style.display = 'flex';
});

window.mayhem.onBadgesClear(() => {
  root.innerHTML = '';
  prio.style.display = 'none';
  document.getElementById('verdict').style.display = 'none';
});

// (The build strip lives in its own interactive window now — see strip.js.)

// Champ select: win-rate pills under the bench + team champion portraits.
const cs = document.getElementById('cs');

window.mayhem.onCsPills((pills) => {
  cs.innerHTML = '';
  for (const p of pills) {
    const d = document.createElement('div');
    const wrCls = p.winRate >= 0.53 ? 'good' : p.winRate < 0.48 ? 'bad' : 'mid';
    d.className = `cs-pill ${wrCls}${p.mine ? ' mine' : ''}${p.star ? ' star' : ''}`;
    d.innerHTML =
      `${p.star ? '<span class="s">★</span>' : ''}${(p.winRate * 100).toFixed(1)}%` +
      `<span class="t">T${p.tier}</span>`;
    d.style.left = `${p.x}px`;
    d.style.top = `${p.y}px`;
    cs.append(d);
  }
});

window.mayhem.onCsClear(() => { cs.innerHTML = ''; });
