// Interactive build strip: one row per build variant (MINE + each aramgg
// build), each minimisable for the rest of the game. Minimised rows shrink
// to restore chips; the set resets when the game ends.
const rowsBox = document.getElementById('rows');
const miniBox = document.getElementById('mini');
const wrap = document.getElementById('wrap');
const lockBtn = document.getElementById('lock');

let rows = [];
let hiddenItems = [];
const minimised = new Set();

/* ---- drag + lock ---- */
let locked = true;

function applyLocked(v, persist) {
  locked = v;
  wrap.classList.toggle('unlocked', !v);
  lockBtn.textContent = v ? '🔒' : '🔓';
  lockBtn.title = v ? 'Unlock to drag' : 'Drag me, then click to lock';
  if (persist) window.mayhem.stripLock(v);
  requestAnimationFrame(reportSize);
}

lockBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  applyLocked(!locked, true);
});

let dragging = false;
let last = null;
wrap.addEventListener('pointerdown', (e) => {
  if (locked) return;
  if (e.target.closest('.min') || e.target.closest('#lock') || e.target.closest('.chip')) return;
  dragging = true;
  last = { x: e.screenX, y: e.screenY };
  wrap.setPointerCapture(e.pointerId);
});
wrap.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - last.x;
  const dy = e.screenY - last.y;
  if (dx || dy) {
    window.mayhem.stripDragBy(dx, dy);
    last = { x: e.screenX, y: e.screenY };
  }
});
wrap.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false;
  wrap.releasePointerCapture(e.pointerId);
  window.mayhem.stripDragEnd();
});

function reportSize() {
  const r = wrap.getBoundingClientRect();
  window.mayhem.stripResize(Math.ceil(r.width) + 4, Math.ceil(r.height) + 4);
}

function render() {
  rowsBox.innerHTML = '';
  miniBox.innerHTML = '';
  const visible = rows.filter((r) => !minimised.has(r.id));
  const hidden = rows.filter((r) => minimised.has(r.id));

  for (const row of visible) {
    const r = document.createElement('div');
    r.className = 'srow';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = row.label;
    lbl.title = row.label;
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
      img.title = `${it.name} (${it.price}g) · right-click hides this game`;
      img.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.mayhem.stripHideItem(it.id);
      });
      if (i === 0) {
        img.classList.add('next');
        if (it.affordable) img.classList.add('affordable');
      }
      r.append(img);
    });
    const min = document.createElement('button');
    min.className = 'min';
    min.textContent = '−';
    min.title = 'Hide this build for the rest of the game';
    min.addEventListener('click', () => { minimised.add(row.id); render(); });
    r.append(min);
    rowsBox.append(r);
  }

  if (hidden.length || hiddenItems.length) {
    miniBox.style.display = 'flex';
    for (const row of hidden) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = row.label;
      chip.title = 'Show again';
      chip.addEventListener('click', () => { minimised.delete(row.id); render(); });
      miniBox.append(chip);
    }
    for (const it of hiddenItems) {
      const chip = document.createElement('span');
      chip.className = 'chip item';
      const img = document.createElement('img');
      img.src = it.icon;
      chip.append(img);
      chip.title = `${it.name} hidden · click to restore`;
      chip.addEventListener('click', () => window.mayhem.stripHideItem(it.id));
      miniBox.append(chip);
    }
  } else {
    miniBox.style.display = 'none';
  }
  requestAnimationFrame(reportSize);
}

let lockInitialised = false;
window.mayhem.onBuildStrip((data) => {
  rows = data?.rows ?? [];
  hiddenItems = data?.hidden ?? [];
  if (!lockInitialised && data && 'locked' in data) {
    lockInitialised = true;
    applyLocked(!!data.locked, false);
  }
  render();
});

window.mayhem.onBuildStripClear(() => {
  rows = [];
  hiddenItems = [];
  minimised.clear(); // fresh set of builds next game
  render();
});
