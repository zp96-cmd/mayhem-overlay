// Draggable priority panel (its own window so it can catch a mouse). Locked =
// click-through with move-forwarding: the 🔒 button reveals on hover and the
// renderer captures the mouse ONLY while the cursor is over it, so game clicks
// pass through everywhere else. Unlock to drag the whole panel, then re-lock.
const wrap = document.getElementById('prio');
const content = document.getElementById('content');
const lockBtn = document.getElementById('lock');

const wrClass = (wr) => (wr >= 0.53 ? 'wr-good' : wr < 0.48 ? 'wr-bad' : 'wr-mid');
const pct = (v) => `${(v * 100).toFixed(1)}%`;

function reportSize() {
  const r = wrap.getBoundingClientRect();
  window.mayhem.prioResize(Math.ceil(r.width) + 4, Math.ceil(r.height) + 4);
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
let locked = true;
let captured = false;
let hideTimer = null;

function applyLocked(v) {
  locked = v;
  captured = false;
  document.body.classList.toggle('unlocked', !v);
  lockBtn.textContent = v ? '🔒' : '🔓';
  lockBtn.title = v ? 'Move panel' : 'Lock panel in place';
  if (!v && !content.children.length) {
    content.innerHTML =
      `<div class="title">PRIORITY</div>` +
      `<div class="hint">Drag me where you want the priority list, then click 🔓 to lock.</div>`;
  }
  requestAnimationFrame(reportSize);
}
window.mayhem.onPrioLock((v) => applyLocked(!!v));

function setCapture(on) {
  if (on === captured) return;
  captured = on;
  window.mayhem.prioMouseCapture(on);
}
function overLock(x, y) {
  const r = lockBtn.getBoundingClientRect();
  return x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 3 && y <= r.bottom + 3;
}

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  document.body.classList.add('hovering');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => document.body.classList.remove('hovering'), 1800);
  setCapture(overLock(e.clientX, e.clientY));
});
document.addEventListener('mouseleave', () => {
  if (!locked) return;
  document.body.classList.remove('hovering');
  setCapture(false);
});

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
