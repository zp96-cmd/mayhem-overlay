// Champ select support: locate the League client window and compute win-rate
// pill positions for the bench (available champions) and the team column.
// Layout fractions are calibrated against the client at its standard aspect.
const { execSync } = require('child_process');

const PS_GET_RECT = `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public struct RECT{public int Left;public int Top;public int Right;public int Bottom;}public class W{[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);}';
$p = Get-Process LeagueClientUx -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1;
if ($p) { $r = New-Object RECT; [W]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null; Write-Output "$($r.Left) $($r.Top) $($r.Right) $($r.Bottom)" }
`.trim();

// -EncodedCommand avoids every layer of cmd/PowerShell quote mangling
const PS_ENCODED = Buffer.from(PS_GET_RECT, 'utf16le').toString('base64');

function getClientRect() {
  try {
    const out = execSync(`powershell -NoProfile -EncodedCommand ${PS_ENCODED}`, {
      encoding: 'utf8', windowsHide: true, timeout: 8000,
    }).trim();
    const [left, top, right, bottom] = out.split(/\s+/).map(Number);
    if ([left, top, right, bottom].some((n) => !Number.isFinite(n))) return null;
    if (right - left < 400 || bottom - top < 300) return null; // minimized
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  } catch {
    return null;
  }
}

const DEFAULT_LAYOUT = {
  benchX0: 0.2969, // centre of first bench slot
  benchDX: 0.046,  // slot spacing
  benchY: 0.112,   // pill anchor just below bench icons
  teamX: 0.0694,   // team portrait centre column
  teamY0: 0.189,   // first team row centre
  teamDY: 0.1105,  // row spacing
  teamYOff: 0.052, // pill anchor below the portrait
  benchIcon: 0.047, // bench portrait size (fraction of client width, square px)
  teamIcon: 0.055,  // team portrait size (fraction of client width, square px)
};

// champions to hide behind a black box in champ select (by numeric id)
const BLACKOUT_IDS = new Set([115]); // Ziggs

// -> [{ x, y, winRate, tier, mine, star }] in physical px, screen coords
function buildChampSelectPills(session, rect, stats, layout = DEFAULT_LAYOUT) {
  const pills = [];
  const statFor = (id) => stats?.[String(id)] ?? null;

  const myCell = session.localPlayerCellId;
  const team = [...(session.myTeam ?? [])].sort((a, b) => a.cellId - b.cellId);
  const myEntry = team.find((p) => p.cellId === myCell);
  const myWr = statFor(myEntry?.championId)?.winRate ?? null;

  const blackouts = [];
  const benchIcon = (layout.benchIcon ?? 0.047) * rect.width;
  const teamIcon = (layout.teamIcon ?? 0.055) * rect.width;

  const bench = (session.benchChampions ?? []).map((b) => b.championId).filter((id) => id > 0);
  let bestBench = null;
  bench.forEach((id, i) => {
    const cx = rect.left + rect.width * (layout.benchX0 + i * layout.benchDX);
    if (BLACKOUT_IDS.has(id)) {
      // box sits over the icon, just above the pill anchor
      blackouts.push({ x: cx - benchIcon / 2, y: rect.top + rect.height * layout.benchY - benchIcon, w: benchIcon, h: benchIcon });
    }
    const s = statFor(id);
    if (!s) return;
    const pill = {
      x: cx,
      y: rect.top + rect.height * layout.benchY,
      winRate: s.winRate, tier: s.tier, games: s.games,
      mine: false, star: false, championId: id,
    };
    pills.push(pill);
    if (!bestBench || s.winRate > bestBench.winRate) bestBench = pill;
  });
  // star the best bench champ when it beats what I currently hold
  if (bestBench && (myWr === null || bestBench.winRate > myWr)) bestBench.star = true;

  team.forEach((p, idx) => {
    const cx = rect.left + rect.width * layout.teamX;
    const cy = rect.top + rect.height * (layout.teamY0 + idx * layout.teamDY);
    if (BLACKOUT_IDS.has(p.championId)) {
      blackouts.push({ x: cx - teamIcon / 2, y: cy - teamIcon / 2, w: teamIcon, h: teamIcon });
    }
    const s = statFor(p.championId);
    if (!s) return;
    pills.push({
      x: cx,
      y: cy + rect.height * layout.teamYOff,
      winRate: s.winRate, tier: s.tier, games: s.games,
      mine: p.cellId === myCell, star: false, championId: p.championId,
    });
  });
  return { pills, blackouts };
}

module.exports = { getClientRect, buildChampSelectPills, DEFAULT_LAYOUT };
