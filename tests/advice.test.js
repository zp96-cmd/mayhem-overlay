const { test } = require('node:test');
const assert = require('node:assert/strict');
const { benchAdvice, buildAdvice, championSignal } = require('../src/renderer/advice');
const champions = new Map([
  [1, { id: 1, name: 'Mage', roles: ['mage'] }],
  [2, { id: 2, name: 'Tank', roles: ['tank'] }],
  [3, { id: 3, name: 'Carry', roles: ['marksman'] }],
]);
test('bench suggestions fill a missing frontline and remove only the player slot', () => {
  const [pick] = benchAdvice({ myChampionId: 1, team: [1, 1, 1, 3, 3], bench: [2, 2] }, champions);
  assert.equal(pick.recommended, true);
  assert.ok(pick.reasons.includes('Adds a frontline option'));
  assert.ok(!pick.reasons.some(r => r.startsWith('Gives up')));
});
test('higher win rate does not recommend losing the only frontline', () => {
  const [pick] = benchAdvice({ myChampionId: 2, team: [2, 1, 1, 3, 3], bench: [1] }, champions,
    { 1: { games: 1000, winRate: .65 }, 2: { games: 1000, winRate: .48 } });
  assert.equal(pick.recommended, false);
  assert.ok(pick.reasons.some(r => r.includes('Gives up')));
});
test('incomplete teams and small samples do not produce confident swap calls', () => {
  const [pick] = benchAdvice({ myChampionId: 1, team: [1, 3], bench: [2] }, champions,
    { 1: { games: 2, winRate: 0 }, 2: { games: 2, winRate: 1 } });
  assert.equal(pick.recommended, false);
  assert.ok(pick.reasons.includes('Limited comparative win-rate data'));
  assert.deepEqual(benchAdvice(null, champions), []);
});
test('item and picked-augment evidence is named and bounded', () => {
  const result = buildAdvice(['ap'], [{ name: 'AP item', categories: ['SpellDamage'] }],
    [{ name: 'AP augment' }], () => ['ap']);
  assert.equal(result.bonus, 1);
  assert.match(result.reasons.join(' '), /AP item.*AP augment/);
  assert.equal(buildAdvice(['ad'], [{ name: 'AP item', categories: ['SpellDamage'] }], [], () => []).bonus, 0);
});
test('champion signal uses baseline, discounts small samples and rejects stale data', () => {
  const data = { championId: 1, baseline: .6, augments: { 9: { games: 300, winRate: .55 } } };
  assert.ok(championSignal(data, 1, 9).bonus < 0);
  assert.equal(championSignal(data, 2, 9), null);
  data.augments[9].winRate = NaN;
  assert.equal(championSignal(data, 1, 9), null);
  data.augments[9] = { games: 30, winRate: .7 };
  assert.ok(championSignal(data, 1, 9).bonus < .2);
});
test('live scoring uses champion stats without a global stats entry', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../src/renderer/app'), 'utf8');
  const context = vm.createContext({ MayhemAdvice: require('../src/renderer/advice') });
  // Exercise the actual scorer without starting the Electron UI.
  vm.runInContext(source.slice(0, source.indexOf('/* ---------------- augments tab')), context);
  vm.runInContext(`
    function champComboTierFor() { return null; }
    state.live = { me: { championName: 'Example', items: [] } };
    state.champByName.set('example', { id: 1, name: 'Example', roles: [] });
    state.champData = { championId: 1, baseline: .5, augments: { 9: { games: 300, winRate: .6 } } };
  `, context);
  const result = vm.runInContext("scoreAugment({ id: 9, name: 'Example augment', description: '', tier: 'Silver' })", context);
  assert.ok(result.score > 3);
  assert.ok(result.reasons.some(r => r.includes('champion WR')));
});
