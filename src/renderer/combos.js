// Draggable combos panel (its own window so it can catch a mouse). Default
// locked + click-through (main sets ignoreMouseEvents); unlock from the tray to
// reposition, then click LOCK. Position persists in main via combos:dragend.
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

function reportSize() {
  const r = wrap.getBoundingClientRect();
  window.mayhem.combosResize(Math.ceil(r.width) + 4, Math.ceil(r.height) + 4);
}

window.mayhem.onCombos((data) => {
  const rows = data?.rows ?? [];
  if (!rows.length) { content.innerHTML = ''; requestAnimationFrame(reportSize); return; }
  let html =
    `<div class="title">` +
      `<span class="lead">TOP COMBOS</span>` +
      (data.champName ? `<span class="champ">${data.champName.toUpperCase()}</span>` : '') +
      `<span class="spark">⚡</span>` +
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
let locked = true;
function applyLocked(v) {
  locked = v;
  document.body.classList.toggle('unlocked', !v);
  // if unlocked with nothing to show, give them something to grab onto
  if (!v && !content.children.length) {
    content.innerHTML =
      `<div class="title"><span class="lead">TOP COMBOS</span><span class="spark">⚡</span></div>` +
      `<div class="hint">Drag me where you want combos to appear in game, then click LOCK.</div>`;
  }
  requestAnimationFrame(reportSize);
}
window.mayhem.onCombosLock((v) => applyLocked(!!v));

lockBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.mayhem.combosLock(true); // main re-enables click-through + persists pos
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
