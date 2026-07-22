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
    const isRerollTarget = verdict?.action === 'REROLL' && b.name === verdict.target;
    const d = document.createElement('div');
    d.className = `badge${b.best ? ' best' : ''}${isRerollTarget ? ' reroll-mode' : ''}`;
    // champion-specific win rate only — global % is deliberately not shown
    const wr = b.champWr != null
      ? `<div class="top"><span class="${wrClass(b.champWr)}">${pct(b.champWr)}</span></div>` +
        `<div class="sub">on ${b.champName}</div>`
      : `<div class="top"><span class="sub">no ${b.champName || 'champion'} data</span></div>`;
    const combo = b.comboTier != null
      ? `<div class="champ ${comboClass(b.comboTier)}">combo T${b.comboTier.toFixed(1)} with your picks</div>` : '';
    let tag = '';
    if (isRerollTarget) {
      tag = `<div class="tag reroll">⟳ REROLL THIS</div>`;
    } else if (b.best) {
      if (verdict?.action === 'PICK') tag = `<div class="tag">★ PICK THIS</div>`;
      else if (verdict?.action === 'REROLL') tag = `<div class="tag">★ BEST · reroll first</div>`;
      else tag = `<div class="tag">★ BEST OF OFFER</div>`;
    }
    d.innerHTML =
      wr + combo +
      `<div class="sub">#${b.rank} of offer · score ${b.score.toFixed(1)}</div>` +
      tag;
    d.style.left = `${b.x + b.w / 2}px`;
    d.style.top = `${b.y}px`;
    root.append(d);
  }
  const v = document.getElementById('verdict');
  if (verdict) {
    v.className = verdict.action.toLowerCase();
    const math = verdict.penalty > 0.005
      ? `+${verdict.upside.toFixed(2)} upside − ${verdict.penalty.toFixed(2)} pool cost = +${verdict.net.toFixed(2)}`
      : `+${verdict.net.toFixed(2)} expected`;
    if (verdict.action === 'REROLL') {
      v.innerHTML =
        `<span class="act">⟳ REROLL ${verdict.target.toUpperCase()}</span>` +
        `<span class="nums">${math} · keep ${verdict.bestName}</span>`;
    } else if (verdict.action === 'PICK') {
      v.innerHTML =
        `<span class="act">✓ PICK ${verdict.bestName.toUpperCase()}</span>` +
        `<span class="nums">reroll not worth it (${math})</span>`;
    } else {
      v.innerHTML =
        `<span class="act">~ CLOSE CALL</span>` +
        `<span class="nums">${verdict.bestName} is best here · reroll ${math}</span>`;
    }
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

/* ---------- combos side panel (arammayhem champion+augment synergies) ---------- */
const combosBox = document.getElementById('combos');
const tierClass = (t) => {
  const k = String(t).toUpperCase();
  if (k === 'S+') return 't-splus';
  if (k === 'S') return 't-s';
  if (k === 'A') return 't-a';
  if (k === 'B') return 't-b';
  return 't-c';
};
window.mayhem.onCombos((data) => {
  const rows = data?.rows ?? [];
  if (!rows.length) { combosBox.style.display = 'none'; return; }
  combosBox.innerHTML =
    `<div class="title">` +
      `<span class="lead">TOP COMBOS</span>` +
      (data.champName ? `<span class="champ">${data.champName.toUpperCase()}</span>` : '') +
      `<span class="spark">⚡</span>` +
    `</div>`;
  for (const c of rows) {
    const row = document.createElement('div');
    row.className = `crow${c.have ? ' have' : ''}`;
    row.innerHTML =
      `<div class="tier ${tierClass(c.tier)}">${c.tier}</div>` +
      (c.icon ? `<img src="${c.icon}">` : '<div></div>') +
      `<div class="body">` +
        `<div class="nm">${c.augmentName}${c.have ? '<span class="chk">✓</span>' : ''}</div>` +
        (c.description ? `<div class="desc">${c.description}</div>` : '') +
      `</div>`;
    combosBox.append(row);
  }
  combosBox.append(Object.assign(document.createElement('div'), {
    className: 'hint', textContent: 'arammayhem.com · ✓ = augment you have',
  }));
  combosBox.style.display = 'flex';
});
window.mayhem.onCombosClear(() => { combosBox.style.display = 'none'; });

/* ---------- celebration: confetti + fanfare for hype augment picks ---------- */
function playFanfare() {
  // Zac's chosen sound; synth fanfare only as fallback
  try {
    const audio = new Audio('../../assets/sounds/celebrate.mp3');
    audio.volume = 0.35;
    const p = audio.play();
    if (p?.catch) p.catch(() => playSynthFanfare());
    return;
  } catch {
    /* fall through to synth */
  }
  playSynthFanfare();
}

function playSynthFanfare() {
  try {
    const ac = new AudioContext();
    const play = (freq, at, dur, gainPeak, type) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ac.currentTime + at);
      g.gain.exponentialRampToValueAtTime(gainPeak, ac.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + dur);
      o.connect(g);
      g.connect(ac.destination);
      o.start(ac.currentTime + at);
      o.stop(ac.currentTime + at + dur + 0.05);
    };
    // rising arpeggio, then a held chord: C5 E5 G5 -> C6 major
    [523.25, 659.25, 783.99].forEach((f, i) => play(f, i * 0.09, 0.35, 0.22, 'triangle'));
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => play(f, 0.3, 1.1, 0.16, 'triangle'));
    [1046.5].forEach((f) => play(f, 0.3, 1.1, 0.1, 'square'));
    setTimeout(() => ac.close(), 2200);
  } catch { /* audio unavailable */ }
}

/* ---------- multikill celebrations ---------- */
function playKillFanfare(streak) {
  try {
    const ac = new AudioContext();
    const master = ac.createGain();
    master.gain.value = 0.28;
    master.connect(ac.destination);
    const note = (freq, at, dur, peak, type = 'triangle') => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ac.currentTime + at);
      g.gain.exponentialRampToValueAtTime(peak, ac.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + dur);
      o.connect(g); g.connect(master);
      o.start(ac.currentTime + at);
      o.stop(ac.currentTime + at + dur + 0.05);
    };
    // ascending run whose length/height grows with the streak
    const scale = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568]; // C5 E5 G5 C6 E6 G6
    const steps = Math.min(scale.length, streak + 1);
    for (let i = 0; i < steps; i++) note(scale[i], i * 0.1, 0.3, 0.5);
    // triumphant chord on arrival
    const chordAt = steps * 0.1;
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => note(f, chordAt, 1.3, 0.35));
    if (streak >= 5) {
      // pentakill: add a low power blast + shimmering octave
      note(130.81, chordAt, 1.6, 0.5, 'sawtooth');
      note(2093, chordAt + 0.1, 1.2, 0.18, 'square');
    }
    setTimeout(() => ac.close(), 3000);
  } catch { /* audio unavailable */ }
}

function killConfetti(streak) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:150';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const gold = ['#c8aa6e', '#f0e6d2', '#e2b93b'];
  const rainbow = ['#c8aa6e', '#f0e6d2', '#3fd08a', '#63d6e4', '#e2b93b', '#e8536e', '#b57edc'];
  const colors = streak >= 5 ? rainbow : gold;
  const count = 120 + streak * 90;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const side = i % 3;
    parts.push({
      x: side === 0 ? -10 : side === 1 ? canvas.width + 10 : Math.random() * canvas.width,
      y: side === 2 ? -10 : canvas.height * (0.5 + Math.random() * 0.35),
      vx: side === 0 ? 6 + Math.random() * 13 : side === 1 ? -(6 + Math.random() * 13) : (Math.random() - 0.5) * 3,
      vy: side === 2 ? 1 + Math.random() * 3 : -(10 + Math.random() * 15),
      s: 5 + Math.random() * 8,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      col: colors[i % colors.length],
    });
  }
  const life = streak >= 5 ? 5200 : 3600;
  const t0 = performance.now();
  (function frame(t) {
    const alive = (t - t0) < life;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fade = Math.max(0, 1 - (t - t0) / life);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.32; p.vx *= 0.99; p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    }
    if (alive) requestAnimationFrame(frame);
    else canvas.remove();
  })(t0);
}

window.mayhem.onMultikill((d) => {
  const { streak, label, sound } = d;
  if (sound !== false) playKillFanfare(streak);
  killConfetti(streak);

  const size = { 2: 58, 3: 72, 4: 90, 5: 118 }[streak] ?? 58;
  const color = streak >= 5 ? '#e8536e' : streak >= 4 ? '#63d6e4' : 'var(--gold-bright)';
  const banner = document.createElement('div');
  banner.textContent = label;
  banner.style.cssText = [
    'position:absolute', 'left:50%', 'top:40%', 'transform:translate(-50%,-50%)',
    'font-family:var(--font-display)', `font-size:${size}px`, 'font-weight:900',
    'letter-spacing:4px', `color:${color}`, 'z-index:170', 'pointer-events:none',
    'white-space:nowrap',
    `text-shadow:0 0 26px ${streak >= 5 ? 'rgba(232,83,110,0.9)' : 'var(--gold-glow)'}, 0 4px 14px rgba(4,9,15,0.95)`,
  ].join(';');
  document.body.append(banner);
  const hold = streak >= 5 ? 4600 : 3200;
  banner.animate([
    { transform: 'translate(-50%,-50%) scale(0.2) rotate(-6deg)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.2)', opacity: 1, offset: 0.16 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.28 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.82 },
    { transform: 'translate(-50%,-50%) scale(1.08)', opacity: 0 },
  ], { duration: hold, easing: 'ease-out' });
  setTimeout(() => banner.remove(), hold);
});

window.mayhem.onCelebrate((payload) => {
  const name = typeof payload === 'string' ? payload : payload.name;
  const sound = typeof payload === 'string' ? true : payload.sound !== false;
  if (sound) playFanfare();

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:99';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');

  const colors = ['#c8aa6e', '#f0e6d2', '#3fd08a', '#63d6e4', '#e2b93b', '#e8536e'];
  const parts = [];
  for (let i = 0; i < 220; i++) {
    const side = i % 3; // left cannon, right cannon, top rain
    parts.push({
      x: side === 0 ? -10 : side === 1 ? canvas.width + 10 : Math.random() * canvas.width,
      y: side === 2 ? -10 : canvas.height * (0.55 + Math.random() * 0.3),
      vx: side === 0 ? 5 + Math.random() * 11 : side === 1 ? -(5 + Math.random() * 11) : (Math.random() - 0.5) * 3,
      vy: side === 2 ? 1 + Math.random() * 3 : -(9 + Math.random() * 13),
      s: 5 + Math.random() * 7,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      col: colors[i % colors.length],
    });
  }

  const banner = document.createElement('div');
  banner.textContent = `${name.toUpperCase()}!`;
  banner.style.cssText = [
    'position:absolute', 'left:50%', 'top:34%', 'transform:translate(-50%,-50%)',
    'font-family:var(--font-display)', 'font-size:64px', 'font-weight:900',
    'letter-spacing:4px', 'color:var(--gold-bright)', 'z-index:100',
    'text-shadow:0 0 24px var(--gold-glow), 0 4px 12px rgba(4,9,15,0.9)',
    'pointer-events:none', 'white-space:nowrap',
  ].join(';');
  document.body.append(banner);
  banner.animate([
    { transform: 'translate(-50%,-50%) scale(0.3)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 1, offset: 0.18 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.3 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.8 },
    { transform: 'translate(-50%,-50%) scale(1.05)', opacity: 0 },
  ], { duration: 3200, easing: 'ease-out' });

  const t0 = performance.now();
  (function frame(t) {
    const alive = (t - t0) < 3400;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fade = Math.max(0, 1 - (t - t0) / 3400);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.32;
      p.vx *= 0.99;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    }
    if (alive) requestAnimationFrame(frame);
    else { canvas.remove(); banner.remove(); }
  })(t0);
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
