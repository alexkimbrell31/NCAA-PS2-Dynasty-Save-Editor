/**
 * Label audit, part 2: pin down the PWGT offset properly.
 *
 * Audit 1 found that offset 165 fits published positional averages better
 * (3.9 lb mean error) than the claimed 160 (7.1 lb), and that at 160 almost
 * every position comes out LIGHT. But my "published average" table is itself an
 * estimate, so a uniform bias could equally mean my reference is ~5 lb heavy.
 * That makes the comparison non-discriminating in exactly the way that caused
 * the TMAA mistake -- so do not pick a winner from it.
 *
 * Look instead for an INTERNAL anchor that does not depend on my reference.
 */

import {
  PLAYER_POSITIONS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
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

const play = load('PLAY');
const team = load('TEAM');
const teamByTgid = new Map(team.map((t) => [n(t.TGID), t]));
const fullName = (p: Record<string, number | string>) => {
  const { first, last } = playerName(p);
  return `${first} ${last}`;
};

const raws = play.map((p) => n(p.PWGT));
const min = Math.min(...raws);
const max = Math.max(...raws);

console.log('=== PWGT raw distribution ===');
console.log(`  raw range ${min}..${max}, field is 8 bits so 0..255 is available`);
console.log(`  players at the raw minimum: ${raws.filter((r) => r === min).length}`);
console.log(`  players at the raw maximum: ${raws.filter((r) => r === max).length}`);

// If the encoding is "pounds minus a constant", the raw floor is the lightest
// weight the game will represent. A designer picks a round number for that.
console.log(`\n  Candidate readings of the raw floor ${min}:`);
for (const off of [150, 155, 160, 165, 170]) {
  console.log(`    offset ${off}: lightest player weighs ${min + off} lb, heaviest ${max + off} lb`);
}

// Look at the extremes: who are they, and are the values believable?
console.log('\n  Lightest players in the file:');
for (const p of [...play].sort((a, b) => n(a.PWGT) - n(b.PWGT)).slice(0, 8)) {
  const t = teamByTgid.get(playerTeam(n(p.PGID)));
  console.log(
    `    raw ${String(n(p.PWGT)).padStart(3)}  ${fullName(p).padEnd(22)} ` +
      `${PLAYER_POSITIONS[n(p.PPOS)].padEnd(5)} ${(t ? teamName(t) : '?').padEnd(26)} ` +
      `${n(p.PHGT)}in`,
  );
}
console.log('\n  Heaviest players in the file:');
for (const p of [...play].sort((a, b) => n(b.PWGT) - n(a.PWGT)).slice(0, 8)) {
  const t = teamByTgid.get(playerTeam(n(p.PGID)));
  console.log(
    `    raw ${String(n(p.PWGT)).padStart(3)}  ${fullName(p).padEnd(22)} ` +
      `${PLAYER_POSITIONS[n(p.PPOS)].padEnd(5)} ${(t ? teamName(t) : '?').padEnd(26)} ` +
      `${n(p.PHGT)}in`,
  );
}

// A height/weight consistency check is largely offset-independent in shape but
// not in level: BMI pins the level. A 6'5" 300 lb lineman is normal; the same
// man at 290 or 310 is also normal, so BMI alone will not settle 5 lb either.
const bmi = (lb: number, inches: number) => (lb / (inches * inches)) * 703;
console.log('\n=== BMI sanity at each candidate offset (offensive linemen) ===');
const ol = play.filter((p) => [5, 6, 7, 8, 9].includes(n(p.PPOS)));
for (const off of [150, 160, 165, 170]) {
  const vals = ol.map((p) => bmi(n(p.PWGT) + off, n(p.PHGT)));
  console.log(
    `  offset ${off}: OL mean BMI ${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}`,
  );
}
console.log('  (real FBS offensive linemen sit around BMI 36-38, but the band is');
console.log('   wide enough that 10 lb either way stays inside it.)');

console.log('\n=== Verdict ===');
console.log('  No internal anchor separates 160 from 165. Both produce believable');
console.log('  players, believable BMIs and believable positional ordering. The');
console.log('  distinction is exactly 5 lb on every player, which nothing in the');
console.log('  file constrains.');
console.log('');
console.log('  This needs ONE ground-truth weight from the game. Any player will do;');
console.log('  here are the cleanest probes -- extreme values, so a mistake is obvious:');

const probes = [
  ...[...play].sort((a, b) => n(a.PWGT) - n(b.PWGT)).slice(0, 2),
  ...[...play].sort((a, b) => n(b.PWGT) - n(a.PWGT)).slice(0, 2),
];
const uw = play.filter((p) => playerTeam(n(p.PGID)) === 110);
const uwProbe = [...uw].sort((a, b) => n(b.PWGT) - n(a.PWGT))[0];
if (uwProbe) probes.push(uwProbe);

for (const p of probes) {
  const t = teamByTgid.get(playerTeam(n(p.PGID)));
  console.log(
    `    ${fullName(p).padEnd(22)} #${String(n(p.PJEN)).padEnd(3)} ` +
      `${PLAYER_POSITIONS[n(p.PPOS)].padEnd(5)} ${(t ? teamName(t) : '?').padEnd(26)} ` +
      `-> raw ${n(p.PWGT)}, so 160 predicts ${n(p.PWGT) + 160} lb and 165 predicts ${n(p.PWGT) + 165} lb`,
  );
}
