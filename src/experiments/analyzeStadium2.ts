/**
 * STAD pass 2 -- and a correction to the TEAM work.
 *
 * SCAP and TEAM.TMAA disagree on all 119 FBS teams, yet both look like stadium
 * capacity. One of the two labels must be wrong. TEAM.TMAA was previously
 * documented as "stadium capacity" on the strength of its real-world ordering
 * (Michigan > Penn State > Tennessee > Ohio State), but that ordering is *also*
 * what average attendance would produce, so it never discriminated between the
 * two readings.
 *
 * Decisive test: attendance is bounded by capacity and should scale with how
 * good and how well-supported a program is. Capacity is a property of the
 * building and should not care.
 */

import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
function load(name: string) {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  return readRecords(buf, h, parseFieldDescriptors(buf, h));
}
const n = (v: number | string) => (typeof v === 'number' ? v : NaN);
const s = (v: number | string) => (typeof v === 'string' ? v : '');

const stad = load('STAD');
const team = load('TEAM');
const play = load('PLAY');

const fbs = new Set(play.map((p) => playerTeam(n(p.PGID))));
const fbsTeams = team.filter((t) => fbs.has(n(t.TGID)));
const byGid = new Map(stad.map((r) => [n(r.SGID), r]));

const corr = (xs: number[], ys: number[]) => {
  const N = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / N;
  const my = ys.reduce((a, b) => a + b, 0) / N;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < N; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
};

const joined = fbsTeams
  .map((t) => ({ t, st: byGid.get(n(t.SGID))! }))
  .filter((j) => j.st);

console.log('=== Is TEAM.TMAA capacity, or attendance? ===');
const ratios = joined.map((j) => n(j.t.TMAA) / n(j.st.SCAP));
console.log(
  `  TMAA / SCAP ratio: min ${Math.min(...ratios).toFixed(3)} ` +
    `max ${Math.max(...ratios).toFixed(3)} ` +
    `mean ${(ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(3)}`,
);
console.log(
  `  teams where TMAA <= SCAP: ${ratios.filter((r) => r <= 1).length}/${ratios.length}`,
);
console.log(
  `  teams where TMAA > SCAP: ${ratios.filter((r) => r > 1).length} ` +
    `(a full house plus standing room is normal)`,
);

// If TMAA is attendance, fill rate should track program prestige. Capacity
// should not -- a big old stadium stays big regardless of current form.
const prestige = joined.map((j) => n(j.t.TMPR));
console.log(
  `\n  corr(fill rate, program prestige TMPR) = ${corr(ratios, prestige).toFixed(3)}`,
);
console.log(`  corr(SCAP, prestige)                    = ${corr(joined.map((j) => n(j.st.SCAP)), prestige).toFixed(3)}`);
console.log(`  corr(TMAA, prestige)                    = ${corr(joined.map((j) => n(j.t.TMAA)), prestige).toFixed(3)}`);

console.log('\n  Fill rate by prestige tier:');
for (let p = 1; p <= 6; p++) {
  const rows = joined.filter((j) => n(j.t.TMPR) === p);
  if (!rows.length) continue;
  const fr = rows.map((j) => n(j.t.TMAA) / n(j.st.SCAP));
  console.log(
    `    ${p}-star (${String(rows.length).padStart(2)} teams): ` +
      `mean fill ${((fr.reduce((a, b) => a + b, 0) / fr.length) * 100).toFixed(1)}%`,
  );
}

console.log('\n  Lowest fill rates (should be weak programs in big stadiums):');
for (const j of [...joined].sort((a, b) => n(a.t.TMAA) / n(a.st.SCAP) - n(b.t.TMAA) / n(b.st.SCAP)).slice(0, 8)) {
  console.log(
    `    ${s(j.t.TDNA).padEnd(22)} ${String(n(j.t.TMAA)).padStart(6)} / ` +
      `${String(n(j.st.SCAP)).padStart(6)} = ${((n(j.t.TMAA) / n(j.st.SCAP)) * 100).toFixed(0)}%  ` +
      `prestige ${n(j.t.TMPR)}`,
  );
}
console.log('\n  Highest fill rates:');
for (const j of [...joined].sort((a, b) => n(b.t.TMAA) / n(b.st.SCAP) - n(a.t.TMAA) / n(a.st.SCAP)).slice(0, 8)) {
  console.log(
    `    ${s(j.t.TDNA).padEnd(22)} ${String(n(j.t.TMAA)).padStart(6)} / ` +
      `${String(n(j.st.SCAP)).padStart(6)} = ${((n(j.t.TMAA) / n(j.st.SCAP)) * 100).toFixed(0)}%  ` +
      `prestige ${n(j.t.TMPR)}`,
  );
}

// TMIA was guessed as a "min attendance %". Test it against the fill rate.
console.log('\n=== TEAM.TMIA ===');
const tmia = joined.map((j) => n(j.t.TMIA));
console.log(`  range ${Math.min(...tmia)}..${Math.max(...tmia)}`);
console.log(`  corr(TMIA, fill rate) = ${corr(tmia, ratios).toFixed(3)}`);
console.log(`  corr(TMIA, prestige)  = ${corr(tmia, prestige).toFixed(3)}`);
console.log(
  `  TMIA as a percent of SCAP vs TMAA: ` +
    `mean |TMIA%*SCAP - TMAA| = ${(
      joined.reduce((a, j) => a + Math.abs((n(j.t.TMIA) / 100) * n(j.st.SCAP) - n(j.t.TMAA)), 0) /
      joined.length
    ).toFixed(0)} seats`,
);

// Known real 2006 capacities. These are building facts, independent of the game.
console.log('\n=== SCAP vs real-world listed capacity (2006) ===');
const known: Array<[string, number]> = [
  ['Michigan', 107501],
  ['Penn State', 107282],
  ['Tennessee', 104079],
  ['Ohio State', 101568],
  ['Alabama', 92138],
  ['LSU', 92400],
  ['Georgia', 92058],
  ['Florida', 88548],
  ['Auburn', 87451],
  ['Texas', 80082],
  ['Nebraska', 81067],
  ['Wisconsin', 80321],
];
for (const [school, real] of known) {
  const t = team.find((x) => s(x.TDNA) === school);
  if (!t) continue;
  const st = byGid.get(n(t.SGID));
  if (!st) continue;
  const got = n(st.SCAP);
  const delta = got - real;
  console.log(
    `  ${school.padEnd(14)} STAD=${String(got).padStart(6)} real=${String(real).padStart(6)} ` +
      `${delta === 0 ? 'EXACT' : `${delta > 0 ? '+' : ''}${delta}`}   (TEAM.TMAA=${n(t.TMAA)})`,
  );
}

// --- non-school stadiums ---------------------------------------------------
console.log('\n=== Stadiums not tied to an FBS team ===');
const used = new Set(fbsTeams.map((t) => n(t.SGID)));
const unused = stad.filter((r) => !used.has(n(r.SGID)));
console.log(`  ${unused.length} of ${stad.length} stadiums have no FBS home team`);
const fcsGids = new Set(team.filter((t) => !fbs.has(n(t.TGID))).map((t) => n(t.SGID)));
const neutral = unused.filter((r) => !fcsGids.has(n(r.SGID)));
console.log(`  ${unused.length - neutral.length} belong to FCS schools`);
console.log(`  ${neutral.length} belong to no team at all (bowl / neutral sites):`);
for (const r of neutral) {
  console.log(
    `    ${s(r.SNAM).padEnd(34)} ${s(r.SCIT).padEnd(16)} ${s(r.SSTA)}  cap ${n(r.SCAP)}`,
  );
}

// --- SORD / SRES / STDR ----------------------------------------------------
console.log('\n=== SORD / SRES / STDR ===');
const sord = [...stad].sort((a, b) => n(a.SORD) - n(b.SORD));
console.log('  by SORD: ' + sord.slice(0, 6).map((r) => `${n(r.SORD)}=${s(r.TDNA)}`).join(' '));
const alpha = [...stad].map((r) => s(r.TDNA)).sort();
const sordAlpha = sord.map((r) => s(r.TDNA));
console.log(`  SORD orders stadiums alphabetically by school? ${JSON.stringify(alpha) === JSON.stringify(sordAlpha)}`);
const sres = [...stad].sort((a, b) => n(a.SRES) - n(b.SRES));
console.log('  by SRES: ' + sres.slice(0, 6).map((r) => `${n(r.SRES)}=${s(r.TDNA)}`).join(' '));
console.log(
  `  SRES == SORD for ${stad.filter((r) => n(r.SRES) === n(r.SORD)).length}/${stad.length} rows`,
);
console.log(
  `  STDR range ${Math.min(...stad.map((r) => n(r.STDR)))}..${Math.max(...stad.map((r) => n(r.STDR)))}, ` +
    `${stad.filter((r) => n(r.STDR) === 127).length} rows at 127`,
);
