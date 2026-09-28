/**
 * Label audit, part 3: TEAM, COCH and STAD.
 *
 * For each existing label, state the competing hypothesis and then run a test
 * that the competing hypothesis would FAIL. Where no such test exists, say so
 * -- an untestable label should be marked untestable, not marked verified.
 */

import {
  NO_TEAM,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  ratingToDisplay,
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
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const corr = (xs: number[], ys: number[]) => {
  const N = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let nu = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < N; i++) {
    nu += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return nu / Math.sqrt(dx * dy);
};

const play = load('PLAY');
const team = load('TEAM');
const coch = load('COCH');
const stad = load('STAD');
const fbs = new Set(play.map((p) => playerTeam(n(p.PGID))));
const fbsTeams = team.filter((t) => fbs.has(n(t.TGID)));
const roster = new Map<number, typeof play>();
for (const p of play) {
  const t = playerTeam(n(p.PGID));
  if (!roster.has(t)) roster.set(t, []);
  roster.get(t)!.push(p);
}

console.log('======== TEAM: unit ratings ========\n');
console.log('Claim: TRQB/TRRB/TWRR/TROL/TRDL/TRLB/TRDB are per-unit team ratings.');
console.log('Competing: they are generic strength numbers that all track overall');
console.log('team quality, with no real per-unit meaning.');
console.log('Discriminating test: a genuine unit rating must correlate BETTER with');
console.log('its own position group than with the other groups. A generic number');
console.log('would correlate about equally with everything.\n');

const GROUP: Record<string, number[]> = {
  TRQB: [0],
  TRRB: [1, 2],
  TWRR: [3, 4],
  TROL: [5, 6, 7, 8, 9],
  TRDL: [10, 11, 12],
  TRLB: [13, 14, 15],
  TRDB: [16, 17, 18],
};
const unitStrength = (tgid: number, positions: number[]) => {
  const ps = (roster.get(tgid) ?? []).filter((p) => positions.includes(n(p.PPOS)));
  if (!ps.length) return 0;
  const ovr = ps.map((p) => ratingToDisplay(n(p.POVR))).sort((a, b) => b - a);
  // Starters matter, not depth: take the top few.
  return mean(ovr.slice(0, Math.max(2, Math.round(positions.length * 1.2))));
};

console.log('  field   own-unit   best-other   verdict');
let unitPass = 0;
for (const [field, positions] of Object.entries(GROUP)) {
  const ratings = fbsTeams.map((t) => n(t[field]));
  const own = corr(ratings, fbsTeams.map((t) => unitStrength(n(t.TGID), positions)));
  let bestOther = -1;
  let bestName = '';
  for (const [otherField, otherPos] of Object.entries(GROUP)) {
    if (otherField === field) continue;
    const c = corr(ratings, fbsTeams.map((t) => unitStrength(n(t.TGID), otherPos)));
    if (c > bestOther) {
      bestOther = c;
      bestName = otherField;
    }
  }
  const ok = own > bestOther;
  if (ok) unitPass++;
  console.log(
    `  ${field}   ${own.toFixed(3)}      ${bestOther.toFixed(3)} (${bestName})   ` +
      `${ok ? 'PASS - tracks its own unit best' : 'FAIL - tracks another unit better'}`,
  );
}
console.log(`\n  ${unitPass}/${Object.keys(GROUP).length} unit ratings track their own position group best.`);

console.log('\n======== TEAM: TMPR vs TMAR ========\n');
console.log('Claim: TMPR = athletic/program prestige, TMAR = academic prestige.');
console.log('Competing: both are generic "school quality" numbers.');
console.log('Discriminating test: if they are genuinely different axes they must');
console.log('DISAGREE on schools where reality disagrees.\n');
console.log(`  corr(TMPR, TMAR) across FBS = ${corr(fbsTeams.map((t) => n(t.TMPR)), fbsTeams.map((t) => n(t.TMAR))).toFixed(3)}`);
console.log('  schools where the two differ most:');
for (const t of [...fbsTeams].sort((a, b) => (n(b.TMAR) - n(b.TMPR)) - (n(a.TMAR) - n(a.TMPR))).slice(0, 5)) {
  console.log(`    ${s(t.TDNA).padEnd(18)} academic ${n(t.TMAR)} vs athletic ${n(t.TMPR)}  (academic-leaning)`);
}
for (const t of [...fbsTeams].sort((a, b) => (n(a.TMAR) - n(a.TMPR)) - (n(b.TMAR) - n(b.TMPR))).slice(0, 5)) {
  console.log(`    ${s(t.TDNA).padEnd(18)} academic ${n(t.TMAR)} vs athletic ${n(t.TMPR)}  (athletic-leaning)`);
}
console.log('  Also: does TMPR track on-field quality while TMAR does not?');
console.log(`    corr(TMPR, TROV) = ${corr(fbsTeams.map((t) => n(t.TMPR)), fbsTeams.map((t) => n(t.TROV))).toFixed(3)}`);
console.log(`    corr(TMAR, TROV) = ${corr(fbsTeams.map((t) => n(t.TMAR)), fbsTeams.map((t) => n(t.TROV))).toFixed(3)}`);

console.log('\n======== COCH: CPRE ========\n');
console.log('Claim: CPRE is coach prestige.');
const employed = coch.filter((c) => n(c.TGID) !== NO_TEAM);
const teamByTgid = new Map(team.map((t) => [n(t.TGID), t]));
const identical = employed.filter((c) => {
  const t = teamByTgid.get(n(c.TGID));
  return t && n(c.CPRE) === n(t.TMPR);
}).length;
console.log(`  CPRE == TEAM.TMPR on ${identical}/${employed.length} employed coaches.`);
console.log('  UNTESTABLE in this save. Because the two columns are identical, no');
console.log('  test can distinguish "coach prestige" from "a copy of team prestige".');
console.log('  The label is consistent but unproven; a save where a coach has moved');
console.log('  schools would separate them.');

console.log('\n======== COCH: CPID as "offensive playbook" ========\n');
console.log('Claim: CPID is the offensive playbook id.');
console.log('Competing: CPID is simply a per-school index (art set, scheme id, ...).');
const fbsCoaches = employed.filter((c) => fbs.has(n(c.TGID)));
const cpids = fbsCoaches.map((c) => n(c.CPID)).sort((a, b) => a - b);
console.log(`  CPID over the 119 FBS coaches: ${cpids.length} values, ${new Set(cpids).size} distinct,`);
console.log(`  range ${cpids[0]}..${cpids[cpids.length - 1]}, contiguous: ${cpids.every((v, i) => v === i)}`);
// Is CPID just alphabetical rank? That would make it a school index, not a playbook.
const alphaRank = new Map(
  [...fbsCoaches]
    .map((c) => ({ c, name: s(teamByTgid.get(n(c.TGID))!.TDNA) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e, i) => [n(e.c.CPID), i]),
);
let alphaMatch = 0;
for (const [cpid, rank] of alphaRank) if (cpid === rank) alphaMatch++;
console.log(`  CPID equals the school's alphabetical rank on ${alphaMatch}/${fbsCoaches.length} teams.`);
console.log('  If that number were high, CPID would just be a school index.');

console.log('\n======== STAD: STjt as "low temperature" ========\n');
console.log('Claim: STts = high temp, STjt = low temp.');
console.log('Competing: STjt is something else that happens to sit below STts.');
console.log(`  corr(STts, STjt) = ${corr(stad.map((r) => n(r.STts)), stad.map((r) => n(r.STjt))).toFixed(3)}`);
console.log(`  mean gap STts - STjt = ${mean(stad.map((r) => n(r.STts) - n(r.STjt))).toFixed(1)} degrees`);
console.log(`  gap range ${Math.min(...stad.map((r) => n(r.STts) - n(r.STjt)))}..${Math.max(...stad.map((r) => n(r.STts) - n(r.STjt)))}`);
const indoor = stad.filter((r) => n(r.STYP) === -1);
console.log(
  `  indoor stadiums: STts ${mean(indoor.map((r) => n(r.STts))).toFixed(0)}F / ` +
    `STjt ${mean(indoor.map((r) => n(r.STjt))).toFixed(0)}F ` +
    `(a climate-controlled dome should have a SMALL gap)`,
);
const outdoor = stad.filter((r) => n(r.STYP) === 0);
console.log(
  `  outdoor stadiums: STts ${mean(outdoor.map((r) => n(r.STts))).toFixed(0)}F / ` +
    `STjt ${mean(outdoor.map((r) => n(r.STjt))).toFixed(0)}F`,
);
console.log(
  `  mean gap indoors ${mean(indoor.map((r) => n(r.STts) - n(r.STjt))).toFixed(1)} vs ` +
    `outdoors ${mean(outdoor.map((r) => n(r.STts) - n(r.STjt))).toFixed(1)}`,
);

console.log('\n======== STAD: SWFP as "fog" ========\n');
console.log('Claim: SWFP is fog chance.');
console.log('Competing: pure mnemonic guess; only 4 of 238 rows are non-zero.');
console.log('  the non-zero rows:');
for (const r of stad.filter((x) => n(x.SWFP) > 0)) {
  console.log(
    `    SWFP=${String(n(r.SWFP)).padStart(2)}  ${s(r.SNAM).padEnd(30)} ${s(r.SCIT)}, ${s(r.SSTA)}`,
  );
}

console.log('\n======== PLAY: PHAN handedness ========\n');
console.log('Claim: PHAN 0 = right-handed, 1 = left-handed.');
console.log('Discriminating test: left-handers are ~10% of the population, and');
console.log('the split should be visible mainly at QB where it matters.');
const qbs = play.filter((p) => n(p.PPOS) === 0);
console.log(
  `  all players: ${((play.filter((p) => n(p.PHAN) === 1).length / play.length) * 100).toFixed(1)}% have PHAN=1`,
);
console.log(
  `  QBs only:    ${((qbs.filter((p) => n(p.PHAN) === 1).length / qbs.length) * 100).toFixed(1)}% have PHAN=1 ` +
    `(${qbs.filter((p) => n(p.PHAN) === 1).length}/${qbs.length})`,
);
