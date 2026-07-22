// Draggable combos panel (its own window so it can catch a mouse). Locked =
// click-through with move-forwarding: the 🔒 button reveals on hover and the
// renderer captures the mouse ONLY while the cursor is over it, so game clicks
// pass through everywhere else. Unlock to drag the whole panel, then re-lock.
const wrap = document.getElementById('combos');
const content = document.getElementById('content');
const lockBtn = document.getElementById('lock');

const tierClass = (t) => {
  const k = String(t).toUpperCase();
  if (k === 'S+') return 't-splus';
  if (k === 'S') return 't-s';
  if (k === 'A') return 't-a';
  if (k === 'B') return 't-b';
  return 't-c';
};

let lastW = 0, lastH = 0;
function reportSize() {
  const r = wrap.getBoundingClientRect();
  const w = Math.ceil(r.width) + 4, h = Math.ceil(r.height) + 4;
  if (w === lastW && h === lastH) return; // avoid needless window resizes
  lastW = w; lastH = h;
  window.mayhem.combosResize(w, h);
}

window.mayhem.onCombos((data) => {
  const rows = data?.rows ?? [];
  if (!rows.length) { content.innerHTML = ''; requestAnimationFrame(reportSize); return; }
  let html =
    `<div class="title">` +
      `<span class="lead">TOP COMBOS</span>` +
      (data.champName ? `<span class="champ">${data.champName.toUpperCase()}</span>` : '') +
    `</div>`;
  for (const c of rows) {
    html +=
      `<div class="crow${c.have ? ' have' : ''}">` +
        `<div class="tier ${tierClass(c.tier)}">${c.tier}</div>` +
        (c.icon ? `<img src="${c.icon}">` : '<div></div>') +
        `<div class="body">` +
          `<div class="nm">${c.augmentName}${c.have ? '<span class="chk">✓</span>' : ''}</div>` +
          (c.description ? `<div class="desc">${c.description}</div>` : '') +
        `</div>` +
      `</div>`;
  }
  html += `<div class="hint">arammayhem.com · ✓ = augment you have</div>`;
  content.innerHTML = html;
  requestAnimationFrame(reportSize);
});

window.mayhem.onCombosClear(() => {
  content.innerHTML = '';
  requestAnimationFrame(reportSize);
});

/* ---- lock / drag ---- */
// Locked = fully click-through (no mouse forwarding, zero cost in game). Unlock
// from the tray ("Move combos panel") → the panel becomes interactive and the
// 🔓 button appears; drag it, then click 🔓 to lock again.
let locked = true;

function applyLocked(v) {
  locked = v;
  document.body.classList.toggle('unlocked', !v);
  lockBtn.textContent = v ? '🔒' : '🔓';
  lockBtn.title = v ? 'Locked' : 'Lock panel in place';
  if (!v && !content.children.length) {
    content.innerHTML =
      `<div class="title"><span class="lead">TOP COMBOS</span></div>` +
      `<div class="hint">Drag me where you want combos to appear in game, then click 🔓 to lock.</div>`;
  }
  requestAnimationFrame(reportSize);
}
window.mayhem.onCombosLock((v) => applyLocked(!!v));

lockBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.mayhem.combosLock(!locked); // toggle; main echoes lock-state back
});

let dragging = false;
let last = null;
wrap.addEventListener('pointerdown', (e) => {
  if (locked) return;
  if (e.target.closest('#lock')) return;
  dragging = true;
  last = { x: e.screenX, y: e.screenY };
  wrap.setPointerCapture(e.pointerId);
});
wrap.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - last.x;
  const dy = e.screenY - last.y;
  if (dx || dy) {
    window.mayhem.combosDragBy(dx, dy);
    last = { x: e.screenX, y: e.screenY };
  }
});
wrap.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false;
  wrap.releasePointerCapture(e.pointerId);
  window.mayhem.combosDragEnd();
});
