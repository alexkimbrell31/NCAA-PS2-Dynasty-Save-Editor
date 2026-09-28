/**
 * SCHD pass 2: resolve what pass 1 left open.
 *
 *  - GATG has 177 distinct ids but GHTG only 120. Why?
 *  - "team playing itself" -- is that just the 511 sentinel colliding?
 *  - What separates GSTA=1 from GSTA=2, given both carry scores?
 *  - SEWN and SEWT agree through week 13 then diverge (15/18/19/20/21 vs
 *    15/30/31/32/40). Postseason encoding?
 *  - GDAT: is 5 = Saturday?
 *  - GFFU/GFHU are set on the same 12 games, all involving one team.
 */

import {
  NO_TEAM,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  readRecords,
  readSaveFile,
  teamName,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
function load(name: string) {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  return readRecords(buf, h, parseFieldDescriptors(buf, h));
}
const n = (v: number | string) => (typeof v === 'number' ? v : NaN);

const schd = load('SCHD');
const team = load('TEAM');
const play = load('PLAY');
const conf = load('CONF');

const teamByTgid = new Map(team.map((t) => [n(t.TGID), t]));
const fbs = new Set(play.map((p) => playerTeam(n(p.PGID))));
const confName = new Map(conf.map((c) => [n(c.CGID), String(c.CNAM)]));
const nm = (id: number) => {
  const t = teamByTgid.get(id);
  return t ? teamName(t) : id === NO_TEAM ? '<none>' : `?${id}`;
};

// --- sentinel rows ---------------------------------------------------------
const sentinel = schd.filter(
  (g) => n(g.GATG) === NO_TEAM || n(g.GHTG) === NO_TEAM,
);
console.log(`Rows with a 511 sentinel team: ${sentinel.length}`);
console.log(
  `  both sides 511: ${sentinel.filter((g) => n(g.GATG) === NO_TEAM && n(g.GHTG) === NO_TEAM).length}`,
);
console.log(
  '  their weeks: ' +
    [...new Set(sentinel.map((g) => `${n(g.SEWN)}/${n(g.SEWT)}`))].join(' '),
);

const real = schd.filter(
  (g) => n(g.GATG) !== NO_TEAM && n(g.GHTG) !== NO_TEAM,
);
console.log(`Real games: ${real.length}`);
console.log(`  team playing itself among real games: ${real.filter((g) => n(g.GATG) === n(g.GHTG)).length}`);

// --- home vs away team populations -----------------------------------------
const homeIds = new Set(real.map((g) => n(g.GHTG)));
const awayIds = new Set(real.map((g) => n(g.GATG)));
const awayOnly = [...awayIds].filter((id) => !homeIds.has(id));
console.log(`\nHome-team ids: ${homeIds.size}, all FBS? ${[...homeIds].every((i) => fbs.has(i))}`);
console.log(`Away-team ids: ${awayIds.size}`);
console.log(`Teams that appear ONLY as the away team: ${awayOnly.length}`);
console.log(`  all of them non-FBS? ${awayOnly.every((i) => !fbs.has(i))}`);
console.log('  sample: ' + awayOnly.slice(0, 8).map(nm).join(', '));
const fcsGames = real.filter((g) => !fbs.has(n(g.GATG)));
console.log(
  `Games featuring a non-FBS team: ${fcsGames.length}; ` +
    `played at the FBS school ${fcsGames.filter((g) => fbs.has(n(g.GHTG))).length}/${fcsGames.length}`,
);

// --- games per team --------------------------------------------------------
const gamesPer = new Map<number, number>();
for (const g of real) {
  for (const id of [n(g.GATG), n(g.GHTG)]) gamesPer.set(id, (gamesPer.get(id) ?? 0) + 1);
}
const fbsCounts = [...fbs].map((id) => gamesPer.get(id) ?? 0);
console.log(
  `\nRegular-season games per FBS team: min ${Math.min(...fbsCounts)} max ${Math.max(...fbsCounts)}`,
);
const dist = new Map<number, number>();
for (const c of fbsCounts) dist.set(c, (dist.get(c) ?? 0) + 1);
console.log(
  '  ' + [...dist.entries()].sort((a, b) => a[0] - b[0]).map(([g, t]) => `${g} games:${t} teams`).join('  '),
);

// --- GSTA 1 vs 2 -----------------------------------------------------------
console.log('\nGSTA=1 vs GSTA=2:');
for (const s of [1, 2]) {
  const rows = schd.filter((g) => n(g.GSTA) === s);
  const wk = [...new Set(rows.map((g) => n(g.SEWN)))].sort((a, b) => a - b);
  const userTeam = rows.filter((g) => n(g.GFFU) === 1 || n(g.GFHU) === 1).length;
  console.log(
    `  GSTA=${s}: ${rows.length} games, weeks ${wk.join(',')}, ` +
      `${userTeam} involve the flagged team`,
  );
  console.log(
    '    ' +
      rows
        .slice(0, 5)
        .map((g) => `${nm(n(g.GATG))} ${n(g.GASC)}-${n(g.GHSC)} ${nm(n(g.GHTG))}`)
        .join(' | '),
  );
}
// Does GSTA correlate with who won?
for (const s of [1, 2]) {
  const rows = schd.filter((g) => n(g.GSTA) === s);
  const hw = rows.filter((g) => n(g.GHSC) > n(g.GASC)).length;
  console.log(`  GSTA=${s}: home team won ${hw}/${rows.length}`);
}

// --- SEWN vs SEWT ----------------------------------------------------------
console.log('\nSEWN -> SEWT mapping:');
const pairs = new Map<string, number>();
for (const g of schd) {
  const k = `${n(g.SEWN)}->${n(g.SEWT)}`;
  pairs.set(k, (pairs.get(k) ?? 0) + 1);
}
console.log(
  '  ' +
    [...pairs.entries()]
      .sort((a, b) => Number(a[0].split('->')[0]) - Number(b[0].split('->')[0]))
      .map(([k, c]) => `${k}(${c})`)
      .join(' '),
);

console.log('\nPostseason weeks (SEWN >= 14):');
for (const g of schd.filter((x) => n(x.SEWN) >= 14).sort((a, b) => n(a.SEWN) - n(b.SEWN))) {
  console.log(
    `  SEWN=${String(n(g.SEWN)).padStart(2)} SEWT=${String(n(g.SEWT)).padStart(2)} ` +
      `GDAT=${n(g.GDAT)} ${nm(n(g.GATG)).padEnd(28)} @ ${nm(n(g.GHTG)).padEnd(28)} ` +
      `${n(g.GASC)}-${n(g.GHSC)} GTOD=${n(g.GTOD)}`,
  );
}

// --- GDAT ------------------------------------------------------------------
console.log('\nGDAT by week (is 5 = Saturday?):');
for (const d of [0, 1, 2, 3, 4, 5, 6]) {
  const rows = schd.filter((g) => n(g.GDAT) === d);
  const wk = [...new Set(rows.map((g) => n(g.SEWN)))].sort((a, b) => a - b);
  console.log(`  GDAT=${d}: ${String(rows.length).padStart(3)} games, weeks ${wk.join(',')}`);
}

// --- the flagged team ------------------------------------------------------
const flagged = schd.filter((g) => n(g.GFFU) === 1 || n(g.GFHU) === 1);
const counts = new Map<number, number>();
for (const g of flagged) {
  for (const id of [n(g.GATG), n(g.GHTG)]) counts.set(id, (counts.get(id) ?? 0) + 1);
}
console.log('\nGFFU/GFHU flagged games -- teams involved:');
console.log(
  '  ' + [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, c]) => `${nm(id)} x${c}`).join(', '),
);
const uTeam = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
console.log(`\nFull schedule for ${nm(uTeam)} (TGID ${uTeam}):`);
for (const g of schd
  .filter((x) => n(x.GATG) === uTeam || n(x.GHTG) === uTeam)
  .sort((a, b) => n(a.SEWN) - n(b.SEWN))) {
  const isHome = n(g.GHTG) === uTeam;
  const opp = isHome ? n(g.GATG) : n(g.GHTG);
  const oppT = teamByTgid.get(opp);
  console.log(
    `  wk${String(n(g.SEWN)).padStart(2)} ${isHome ? 'vs' : '@ '} ${nm(opp).padEnd(28)} ` +
      `${(oppT ? (confName.get(n(oppT.CGID)) ?? '') : '').padEnd(16)} ` +
      `GFFU=${n(g.GFFU)} GFHU=${n(g.GFHU)} GMFX=${n(g.GMFX)} GSTA=${n(g.GSTA)}`,
  );
}

// --- GMFX ------------------------------------------------------------------
console.log('\nGMFX (457 set):');
const mfxOn = real.filter((g) => n(g.GMFX) === 1);
const mfxOff = real.filter((g) => n(g.GMFX) === 0);
const sameConf = (g: (typeof real)[0]) => {
  const a = teamByTgid.get(n(g.GATG));
  const h = teamByTgid.get(n(g.GHTG));
  return a && h && n(a.CGID) === n(h.CGID);
};
console.log(
  `  GMFX=1: ${mfxOn.length} games, ${mfxOn.filter(sameConf).length} are same-conference ` +
    `(${((mfxOn.filter(sameConf).length / mfxOn.length) * 100).toFixed(1)}%)`,
);
console.log(
  `  GMFX=0: ${mfxOff.length} games, ${mfxOff.filter(sameConf).length} are same-conference ` +
    `(${((mfxOff.filter(sameConf).length / mfxOff.length) * 100).toFixed(1)}%)`,
);
