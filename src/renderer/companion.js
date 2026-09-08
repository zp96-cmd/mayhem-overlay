let activeView = 'home';
let requestVersion = 0;
let layout = null;
let layoutDraft = null;
let layoutDirty = false;

function showView(view) {
  activeView = view;
  for (const key of ['home', 'champion', 'layout']) $(`#${key}-view`).hidden = key !== view;
  document.querySelectorAll('[data-view]').forEach((b) => {
    b.classList.toggle('selected', b.dataset.view === view);
    b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false');
  });
  if (view === 'layout' && !layoutDirty) loadLayout();
}

function renderHome() {
  const games = state.history;
  const wins = games.filter((g) => g.win).length;
  $('#session-summary').innerHTML = [
    ['Recorded games', String(games.length), 'Synced match history'],
    ['Your win rate', games.length ? pct(wins / games.length) : '—', `${wins} wins · ${games.length - wins} losses`],
    ['Saved builds', String(state.builds.length), 'Your personal collection'],
  ].map(([label, value, detail]) => `<div class="summary-card"><div class="muted">${label}</div><div class="value">${value}</div><div class="muted">${detail}</div></div>`).join('');
  const counts = new Map();
  for (const g of games) counts.set(g.championId, (counts.get(g.championId) || 0) + 1);
  const picks = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const box = $('#familiar');
  box.replaceChildren();
  if (!picks.length) {
    box.append(el('p', 'muted', 'Your most-played champions will appear after you sync match history in the overlay. You can explore any champion now.'));
    const button = el('button', 'secondary', 'Explore champions ↗');
    button.onclick = () => showView('champion');
    box.append(button);
  }
  for (const [id, count] of picks) {
    const c = state.champById.get(id);
    if (!c || id >= 30000) continue;
    const button = el('button', 'familiar-pick');
    if (c.icon) { const img = el('img'); img.src = c.icon; img.alt = ''; button.append(img); }
    button.append(el('span', '', esc(c.name)), el('span', 'muted', `${count} games ↗`));
    button.onclick = () => browse(id);
    box.append(button);
  }
}

function championOptions() {
  const query = $('#champ-search').value.trim().toLowerCase();
  const selected = state.browseId || state.session?.myChampionId || '';
  const options = state.champions.filter((c) => c.id < 30000 && c.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));
  const select = $('#champ-select');
  select.replaceChildren(new Option(options.length ? 'Choose champion' : 'No champions found', ''));
  options.forEach((c) => select.add(new Option(c.name, c.id)));
  select.value = String(selected);
  if (select.selectedIndex < 0) select.selectedIndex = 0;
}

function renderTeam() {
  const ids = state.session?.team || [];
  $('#team-wrap').hidden = !ids.length;
  $('#team').replaceChildren();
  for (const id of ids) {
    const c = state.champById.get(id);
    const own = id === state.session.myChampionId;
    const card = el('div', `team-card${own ? ' mine' : ''}`);
    if (c?.icon) { const img = el('img'); img.src = c.icon; img.alt = ''; card.append(img); }
    const detail = el('div');
    detail.append(el('strong', '', `${esc(c?.name || 'Choosing…')}${own ? ' · You' : ''}`));
    detail.append(el('small', '', esc((c?.roles || []).join(' / ') || 'Class unavailable')));
    card.append(detail);
    $('#team').append(card);
  }
  $('#follow-live').hidden = !state.browseId || !state.session?.myChampionId;
  $('#prep-heading').textContent = state.browseId ? 'Champion playbook' : state.session?.myChampionId ? 'Your current pick' : 'Explore a champion';
}

async function browse(id) {
  state.browseId = id;
  $('#champ-search').value = '';
  championOptions();
  renderTeam();
  render();
  showView('champion');
  await fetchBrowseData(id);
}

async function fetchBrowseData(id) {
  const version = ++requestVersion;
  $('#browse-status').textContent = 'Refreshing community data…';
  try {
    const data = await window.mayhem.browseChampion(id);
    if (version !== requestVersion) return;
    state.champData = data;
    $('#browse-status').textContent = data ? 'Community builds · Your saved builds · Curated augment combos' : 'Community data is unavailable. Your saved builds and bundled combos are still available.';
    render();
  } catch {
    if (version !== requestVersion) return;
    $('#browse-status').textContent = 'Community data could not refresh. Your saved builds and bundled combos are still available.';
  }
}

function receiveSession(session, navigate = true) {
  if (JSON.stringify(session) === JSON.stringify(state.session)) return;
  const previous = state.session?.myChampionId;
  state.session = session;
  if (!state.browseId && previous !== session?.myChampionId) {
    ++requestVersion;
    $('#browse-status').textContent = '';
    if (session?.myChampionId && navigate && activeView !== 'layout') showView('champion');
  }
  championOptions();
  renderTeam();
  render();
}

function receivePhase(status) {
  const labels = { None: 'Client ready', Lobby: 'In lobby', Matchmaking: 'Finding match', ReadyCheck: 'Match found', ChampSelect: 'Champion select', GameStart: 'Loading game', InProgress: 'In game', EndOfGame: 'Game complete', Reconnect: 'Reconnecting' };
  $('#connection').textContent = status.connected ? labels[status.phase] || 'Client ready' : 'Client offline';
  $('#connection').classList.toggle('connected', status.connected);
}

const widgetNames = { combosPos: 'Combos', prioPos: 'Priority picks', buildStripPos: 'Next build', scanBtnPos: 'Scan' };
async function loadLayout() {
  $('#layout-save').disabled = true;
  try {
    layout = await window.mayhem.getLayout();
    layoutDraft = structuredClone(layout.positions);
    layoutDirty = false;
    $('#display-label').textContent = `${layout.display.label} · ${layout.display.width} × ${layout.display.height}`;
    $('#layout-map').style.aspectRatio = `${layout.display.width} / ${layout.display.height}`;
    renderLayout();
    $('#layout-status').textContent = 'Your current layout. Changes apply when saved.';
  } catch { $('#layout-status').textContent = 'Could not load layout. Reopen this tab to retry.'; }
  $('#layout-save').disabled = !layoutDraft;
}

function moveWidget(key, x, y) {
  const size = layout.sizes[key];
  layoutDraft[key] = {
    x: Math.max(0, Math.min(Math.max(0, 1 - size.width / layout.display.width), x)),
    y: Math.max(0, Math.min(Math.max(0, 1 - size.height / layout.display.height), y)),
  };
  const button = document.querySelector(`[data-widget="${key}"]`);
  button.style.left = `${layoutDraft[key].x * 100}%`;
  button.style.top = `${layoutDraft[key].y * 100}%`;
  layoutDirty = true;
  $('#layout-status').textContent = `${widgetNames[key]} · ${Math.round(layoutDraft[key].x * 100)}% across, ${Math.round(layoutDraft[key].y * 100)}% down · Unsaved`;
}

function renderLayout() {
  const box = $('#layout-widgets');
  box.replaceChildren();
  for (const [key, name] of Object.entries(widgetNames)) {
    const button = el('button', 'layout-widget', name);
    button.dataset.widget = key;
    button.setAttribute('aria-label', `${name} position. Drag or use arrow keys.`);
    button.style.left = `${layoutDraft[key].x * 100}%`;
    button.style.top = `${layoutDraft[key].y * 100}%`;
    button.style.width = `${Math.min(100, layout.sizes[key].width / layout.display.width * 100)}%`;
    button.style.height = `${Math.min(100, layout.sizes[key].height / layout.display.height * 100)}%`;
    let drag = null;
    button.onpointerdown = (e) => {
      if (e.button !== 0) return;
      button.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, startX: layoutDraft[key].x, startY: layoutDraft[key].y };
    };
    button.onpointermove = (e) => {
      if (!drag) return;
      const rect = $('#layout-map').getBoundingClientRect();
      moveWidget(key, drag.startX + (e.clientX - drag.x) / rect.width, drag.startY + (e.clientY - drag.y) / rect.height);
    };
    button.onpointerup = button.onpointercancel = button.onlostpointercapture = () => { drag = null; };
    button.onkeydown = (e) => {
      const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!dirs[e.key]) return;
      e.preventDefault();
      const [dx, dy] = dirs[e.key], step = e.shiftKey ? 10 : 1;
      moveWidget(key, layoutDraft[key].x + dx * step / layout.display.width, layoutDraft[key].y + dy * step / layout.display.height);
    };
    box.append(button);
  }
}

document.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => showView(b.dataset.view));
$('.brand').onclick = (e) => { e.preventDefault(); showView('home'); };
$('#explore').onclick = () => showView('champion');
$('#customise').onclick = $('#home-layout').onclick = () => showView('layout');
$('#champ-search').oninput = championOptions;
$('#champ-select').onchange = (e) => { if (e.target.value) browse(Number(e.target.value)); };
$('#follow-live').onclick = () => {
  state.browseId = null;
  championOptions(); renderTeam(); render();
  if (state.session?.myChampionId) fetchBrowseData(state.session.myChampionId);
};
$('#layout-reset').onclick = () => {
  if (!layout) return;
  layoutDraft = structuredClone(layout.defaults);
  renderLayout();
  for (const [key, pos] of Object.entries(layoutDraft)) moveWidget(key, pos.x, pos.y);
  $('#layout-status').textContent = 'Default positions restored to draft. Save to apply.';
};
$('#layout-save').onclick = async () => {
  if (!layoutDraft) return;
  $('#layout-save').disabled = true;
  $('#layout-reset').disabled = true;
  // Freeze edits while saving so an in-flight response cannot replace newer edits.
  document.querySelectorAll('.layout-widget').forEach((b) => b.disabled = true);
  try {
    layout = await window.mayhem.saveLayout(layoutDraft);
    layoutDraft = structuredClone(layout.positions);
    layoutDirty = false;
    renderLayout();
    $('#layout-status').textContent = 'Positions saved. Your overlays are in place.';
  } catch {
    $('#layout-status').textContent = 'Could not save positions. Your draft is kept; try again.';
  } finally {
    $('#layout-save').disabled = false;
    $('#layout-reset').disabled = false;
    document.querySelectorAll('.layout-widget').forEach((b) => b.disabled = false);
  }
};

async function startCompanion() {
  renderHome(); championOptions();
  let receivedSession = false, receivedData = false, receivedPhase = false;
  window.mayhem.onHistoryUpdated((games) => { state.history = games || []; renderHome(); render(); });
  window.mayhem.onBuildsUpdated((builds) => { state.builds = builds || []; renderHome(); render(); });
  window.mayhem.onPrepSession((s) => { receivedSession = true; receiveSession(s); });
  window.mayhem.onPrepChampData((d) => {
    receivedData = true;
    if (!state.browseId && d?.championId === state.session?.myChampionId) { state.champData = d; render(); }
  });
  window.mayhem.onPhase((s) => { receivedPhase = true; receivePhase(s); });
  try {
    const snapshot = await window.mayhem.getPrepSnapshot();
    if (!receivedSession) receiveSession(snapshot.session);
    if (!receivedData && !state.browseId) state.champData = snapshot.data;
    if (!receivedPhase) receivePhase(snapshot.phase);
    render();
  } catch { $('#connection').textContent = 'Waiting for client'; }
}
if (state.ready) startCompanion();
else window.addEventListener('prep:ready', startCompanion, { once: true });
