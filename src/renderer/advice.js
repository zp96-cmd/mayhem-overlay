// Conservative, explainable signals shared by the companion and live overlay.
(function (root) {
  const labels = { tank: 'frontline', mage: 'mage', marksman: 'marksman', support: 'support' };
  function benchAdvice(session, champions, stats = {}) {
    const current = champions.get(session?.myChampionId);
    const team = [...(session?.team || [])];
    const index = team.indexOf(session?.myChampionId);
    if (!current || index < 0) return [];
    team.splice(index, 1); // Remove only our slot, including in duplicate-champion lobbies.
    const allies = team.map(id => champions.get(id));
    const complete = allies.length === 4 && allies.every(c => c?.roles?.length);
    const evaluate = c => Object.keys(labels).reduce((sum, role) =>
      sum + (c?.roles?.includes(role) && !allies.some(a => a?.roles?.includes(role)) ? (role === 'tank' ? 2 : 1) : 0), 0);
    return [...new Set(session.bench || [])].filter(id => id !== current.id && champions.has(id)).map(id => {
      const candidate = champions.get(id), reasons = [];
      const delta = complete ? evaluate(candidate) - evaluate(current) : 0;
      if (complete) for (const role of Object.keys(labels)) {
        if (allies.some(c => c.roles.includes(role))) continue;
        if (candidate.roles.includes(role) && !current.roles.includes(role)) reasons.push(`Adds a ${labels[role]} option`);
        if (current.roles.includes(role) && !candidate.roles.includes(role)) reasons.push(`Gives up your team's ${labels[role]} option`);
      }
      const a = stats[id], b = stats[current.id];
      const reliable = [a, b].every(s => s?.games >= 300 && Number.isFinite(s.winRate) && s.winRate >= 0 && s.winRate <= 1);
      const wrDelta = reliable ? a.winRate - b.winRate : 0;
      if (reliable) reasons.push(`${wrDelta >= 0 ? '+' : ''}${(wrDelta * 100).toFixed(1)} percentage points community WR vs ${current.name}`);
      else reasons.push('Limited comparative win-rate data');
      if (!complete) reasons.unshift('Waiting for a complete team to judge composition');
      if (complete && !reasons.some(r => /option/.test(r))) reasons.unshift('Similar class coverage');
      return { id, score: delta + Math.max(-0.5, Math.min(0.5, wrDelta * 10)),
        recommended: complete && delta > 0, reasons, label: complete && delta > 0 ? 'TEAM FIT' : 'ALTERNATIVE' };
    }).sort((a, b) => b.score - a.score);
  }
  const categories = { ap: ['SpellDamage'], ad: ['Damage'], as: ['AttackSpeed','OnHit'], crit: ['CriticalStrike'], tank: ['Health','Armor','SpellBlock'], heal: ['LifeSteal','SpellVamp'], haste: ['CooldownReduction','AbilityHaste'], ms: ['NonbootsMovement','Boots'] };
  function buildAdvice(arch, items, picked, archetypes) {
    const reasons = [];
    const matching = items.filter(item => arch.some(key => (categories[key] || []).some(c => item.categories?.includes(c))));
    if (matching.length) reasons.push(`Item fit: ${matching.slice(0, 2).map(i => i.name).join(' + ')} (stat tags)`);
    const partners = picked.filter(a => archetypes(a).some(k => arch.includes(k)));
    if (partners.length) reasons.push(`Shared scaling with ${partners.slice(0, 2).map(a => a.name).join(' + ')} (description tags)`);
    return { bonus: (matching.length ? 0.5 : 0) + (partners.length ? 0.5 : 0), reasons };
  }
  function championSignal(data, championId, augmentId) {
    const a = data?.championId === championId ? data.augments?.[augmentId] : null;
    if (!a || !Number.isFinite(a.winRate) || a.winRate < 0 || a.winRate > 1 || !Number.isFinite(a.games) || a.games < 30) return null;
    const baseline = Number.isFinite(data.baseline) && data.baseline >= 0 && data.baseline <= 1 ? data.baseline : 0.5;
    return { bonus: Math.max(-2.5, Math.min(2.5, (a.winRate - baseline) * 16)) * Math.min(1, a.games / 300),
      reason: `${(a.winRate * 100).toFixed(1)}% champion WR · ${a.games} games · ${a.games >= 300 ? 'larger sample' : 'limited sample'}` };
  }
  const api = { benchAdvice, buildAdvice, championSignal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MayhemAdvice = api;
})(globalThis);
