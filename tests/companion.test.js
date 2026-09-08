// Renderer interaction checks with a minimal DOM adapter; these do not validate layout.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { DEFAULT_POSITIONS } = require('../src/main/layout');

function harness() {
  const nodes = new Map();
  const node = () => ({ style: {}, dataset: {}, children: [], value: '', hidden: false,
    textContent: '', classList: { toggle() {} }, setAttribute() {},
    replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); },
    add(item) { this.children.push(item); }, setPointerCapture() {},
    getBoundingClientRect() { return { width: 960, height: 540 }; } });
  const $ = (key) => {
    if (!nodes.has(key)) nodes.set(key, node());
    return nodes.get(key);
  };
  const pending = new Map();
  const state = { ready: false, session: null, browseId: null, champions: [], champById: new Map(), history: [], builds: [] };
  const snapshot = { display: { width: 1920, height: 1080, label: 'Test' },
    positions: structuredClone(DEFAULT_POSITIONS), defaults: DEFAULT_POSITIONS,
    sizes: { combosPos: { width: 344, height: 520 }, prioPos: { width: 320, height: 420 },
      buildStripPos: { width: 380, height: 96 }, scanBtnPos: { width: 92, height: 26 } } };
  const api = { browseChampion: (id) => new Promise((resolve, reject) => pending.set(id, { resolve, reject })),
    getLayout: async () => structuredClone(snapshot), saveLayout: async (positions) => ({ ...snapshot, positions }) };
  const context = vm.createContext({ $, state, structuredClone, console,
    document: { querySelector: $, querySelectorAll: (key) => key === '.layout-widget' ? $('#layout-widgets').children : [] },
    window: { mayhem: api, addEventListener() {} },
    el: () => node(), esc: String, pct: (n) => String(n * 100), render() {},
    Option: function (text, value) { this.text = text; this.value = value; } });
  vm.runInContext(fs.readFileSync(require.resolve('../src/renderer/companion.js'), 'utf8'), context);
  return { context, $, state, pending, api, run: (code) => vm.runInContext(code, context) };
}

test('a slower champion request cannot overwrite the most recent selection', async () => {
  const h = harness();
  const first = h.run('fetchBrowseData(1)');
  const second = h.run('fetchBrowseData(2)');
  h.pending.get(2).resolve({ championId: 2 });
  await second;
  h.pending.get(1).resolve({ championId: 1 });
  await first;
  assert.equal(h.state.champData.championId, 2);
});

test('lobby updates preserve manual browsing and return-to-live follows the new pick', async () => {
  const h = harness();
  h.state.browseId = 1;
  h.run('receiveSession({ myChampionId: 2, team: [], bench: [] })');
  assert.equal(h.state.browseId, 1);
  h.$('#follow-live').onclick();
  assert.equal(h.state.browseId, null);
  assert.ok(h.pending.has(2));
  h.pending.get(2).resolve({ championId: 2 });
  await new Promise(setImmediate);
  assert.equal(h.state.champData.championId, 2);
});

test('keyboard positioning moves one pixel and clamps the full panel at the edge', async () => {
  const h = harness();
  await h.run('loadLayout()');
  const widget = h.$('#layout-widgets').children[0];
  const before = h.run('layoutDraft.combosPos.x');
  widget.onkeydown({ key: 'ArrowRight', preventDefault() {}, shiftKey: false });
  assert.ok(Math.abs(h.run('layoutDraft.combosPos.x') - before - 1 / 1920) < 1e-10);
  h.run('moveWidget("combosPos", 10, -2)');
  assert.equal(h.run('layoutDraft.combosPos.x'), 1 - 344 / 1920);
  assert.equal(h.run('layoutDraft.combosPos.y'), 0);
});

test('a failed save keeps the draft and lets the player retry', async () => {
  const h = harness();
  await h.run('loadLayout()');
  h.run('moveWidget("combosPos", .2, .2)');
  h.api.saveLayout = async () => { throw new Error('disk full'); };
  await h.$('#layout-save').onclick();
  assert.equal(h.run('layoutDraft.combosPos.x'), .2);
  assert.equal(h.run('layoutDirty'), true);
  assert.equal(h.$('#layout-save').disabled, false);
  assert.match(h.$('#layout-status').textContent, /Could not save/);
});
