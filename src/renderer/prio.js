// Draggable priority panel (its own window so it can catch a mouse). Locked =
// click-through with move-forwarding: the 🔒 button reveals on hover and the
// renderer captures the mouse ONLY while the cursor is over it, so game clicks
// pass through everywhere else. Unlock to drag the whole panel, then re-lock.
const wrap = document.getElementById('prio');
const content = document.getElementById('content');
const lockBtn = document.getElementById('lock');

const wrClass = (wr) => (wr >= 0.53 ? 'wr-good' : wr < 0.48 ? 'wr-bad' : 'wr-mid');
const pct = (v) => `${(v * 100).toFixed(1)}%`;

let lastW = 0, lastH = 0;
function reportSize() {
  const r = wrap.getBoundingClientRect();
  const w = Math.ceil(r.width) + 4, h = Math.ceil(r.height) + 4;
  if (w === lastW && h === lastH) return; // avoid needless window resizes
  lastW = w; lastH = h;
  window.mayhem.prioResize(w, h);
}

window.mayhem.onPrio((data) => {
  const items = data?.items ?? [];
  if (!items.length) { content.innerHTML = ''; requestAnimationFrame(reportSize); return; }
  let html = `<div class="title">PRIORITY${data.tier ? ' · ' + data.tier.toUpperCase() : ''}</div>`;
  items.forEach((it, i) => {
    html +=
      `<div class="row${i < 2 ? ' top' : ''}${it.offered ? ' offered' : ''}">` +
        (it.icon ? `<img src="${it.icon}">` : '<img>') +
        `<span class="nm">${it.name}</span>` +
        `<span class="pwr ${wrClass(it.wr ?? 0.5)}">${it.wr != null ? pct(it.wr) : '-'}</span>` +
      `</div>`;
  });
  html += `<div class="hint">still in pool this game · outlined = in current offer</div>`;
  content.innerHTML = html;
  requestAnimationFrame(reportSize);
});

window.mayhem.onPrioClear(() => {
  content.innerHTML = '';
  requestAnimationFrame(reportSize);
});

/* ---- lock / drag (identical pattern to the combos panel) ---- */
// Locked = fully click-through (no mouse forwarding). Unlock from the tray
// ("Move priority panel") to drag; the 🔓 button appears — click it to re-lock.
let locked = true;

function applyLocked(v) {
  locked = v;
  document.body.classList.toggle('unlocked', !v);
  lockBtn.textContent = v ? '🔒' : '🔓';
  lockBtn.title = v ? 'Locked' : 'Lock panel in place';
  if (!v && !content.children.length) {
    content.innerHTML =
      `<div class="title">PRIORITY</div>` +
      `<div class="hint">Drag me where you want the priority list, then click 🔓 to lock.</div>`;
  }
  requestAnimationFrame(reportSize);
}
window.mayhem.onPrioLock((v) => applyLocked(!!v));

lockBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.mayhem.prioLock(!locked);
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
    window.mayhem.prioDragBy(dx, dy);
    last = { x: e.screenX, y: e.screenY };
  }
});
wrap.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false;
  wrap.releasePointerCapture(e.pointerId);
  window.mayhem.prioDragEnd();
});
