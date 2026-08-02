// Isolated check: does the aramkit fetcher reach data.aramkit.com via net.request
// and parse per-champion augment win rates? Run: npx electron scripts/test-aramkit.js
const { app } = require('electron');

app.whenReady().then(async () => {
  try {
    const { getVersions, getChampionAugments } = require('../src/main/aramkit');
    const ver = await getVersions();
    console.log('versions:', JSON.stringify(ver));
    const id = Number(process.argv[2]) || 99; // default Lux
    const d = await getChampionAugments(id);
    const augs = Object.entries(d.augments);
    const top = augs.sort((a, b) => b[1].winRate - a[1].winRate).slice(0, 5)
      .map(([augId, s]) => `${augId}: ${(s.winRate * 100).toFixed(1)}% (${s.games}g, lift ${(s.lift * 100).toFixed(1)}%)`);
    console.log(`champ ${id}: baseline ${(d.baseline * 100).toFixed(1)}%, ${augs.length} augments, ${d.combos.length} combos`);
    console.log('top by WR:', top.join(' | '));
  } catch (e) {
    console.error('FAILED:', e.message);
  }
  app.quit();
});
