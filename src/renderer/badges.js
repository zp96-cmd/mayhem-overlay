// Click-through badge layer: little stat pills positioned over the real
// augment cards on the game's choice screen.
const root = document.getElementById('root');

const wrClass = (wr) => (wr >= 0.53 ? 'wr-good' : wr < 0.48 ? 'wr-bad' : 'wr-mid');
const pct = (v) => `${(v * 100).toFixed(1)}%`;

window.mayhem.onBadges((badges) => {
  root.innerHTML = '';
  for (const b of badges) {
    const d = document.createElement('div');
    d.className = `badge${b.best ? ' best' : ''}`;
    const wr = b.winRate != null
      ? `<div class="top"><span class="${wrClass(b.winRate)}">${pct(b.winRate)}</span></div>`
      : `<div class="top"><span class="sub">no data</span></div>`;
    const champ = b.champWr != null
      ? `<div class="champ ${wrClass(b.champWr)}">${pct(b.champWr)} on ${b.champName}</div>` : '';
    d.innerHTML =
      wr + champ +
      `<div class="sub">#${b.rank} of offer · score ${b.score.toFixed(1)}</div>` +
      (b.best ? `<div class="tag">★ BEST PICK</div>` : '');
    d.style.left = `${b.x + b.w / 2}px`;
    d.style.top = `${b.y}px`;
    root.append(d);
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
});

// Persistent build-path strip anchored near the bottom-HUD stats.
const strip = document.getElementById('strip');

window.mayhem.onBuildStrip((data) => {
  const rows = data?.rows ?? [];
  if (!rows.length) { strip.style.display = 'none'; return; }
  strip.innerHTML = '';
  for (const row of rows) {
    const r = document.createElement('div');
    r.className = 'srow';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = row.label;
    r.append(lbl);
    row.items.forEach((it, i) => {
      if (i) {
        const a = document.createElement('span');
        a.className = 'arrow';
        a.textContent = '›';
        r.append(a);
      }
      const img = document.createElement('img');
      img.src = it.icon;
      img.title = `${it.name} (${it.price}g)`;
      if (i === 0) {
        img.classList.add('next');
        if (it.affordable) img.classList.add('affordable');
      }
      r.append(img);
    });
    strip.append(r);
  }
  strip.style.left = `${Math.round(window.innerWidth * data.pos.x)}px`;
  strip.style.top = `${Math.round(window.innerHeight * data.pos.y)}px`;
  strip.style.display = 'flex';
});

window.mayhem.onBuildStripClear(() => { strip.style.display = 'none'; });

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
