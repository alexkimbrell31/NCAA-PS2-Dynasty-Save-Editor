/**
 * PLGA pass 4 -- SNPD / SNPO / PSNP.
 *
 * SNPD and SNPO are each set on exactly 22 rows, and 22 is the number of
 * players on the field. That is worth taking seriously, but "22" alone is a
 * coincidence-sized observation (lesson 6). The discriminating question is
 * whether the 22 form a LEGAL FORMATION -- 11 per team, or 11 offence and 11
 * defence with a plausible position mix. A random 22 would not.
 */
import {
  PLAYER_POSITIONS,
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
const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));
const load = (name: string) => {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return readRecords(buf, h, f);
};

const plga = load('PLGA');
const pos = (r: Record<string, number | string>) => PLAYER_POSITIONS[num(r.PPOS)];
const team = (r: Record<string, number | string>) => playerTeam(num(r.PGID));
const OFFENSE = new Set(['QB', 'HB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT']);

function describe(label: string, rows: typeof plga) {
  const byTeam = new Map<number, typeof plga>();
  for (const r of rows) {
    const list = byTeam.get(team(r)) ?? [];
    list.push(r);
    byTeam.set(team(r), list);
  }
  console.log(`\n${label}: ${rows.length} rows across ${byTeam.size} team(s)`);
  for (const [tgid, list] of [...byTeam].sort((a, b) => a[0] - b[0])) {
    const off = list.filter((r) => OFFENSE.has(pos(r)));
    const def = list.length - off.length;
    const counts = new Map<string, number>();
    for (const r of list) counts.set(pos(r), (counts.get(pos(r)) ?? 0) + 1);
    console.log(
      `  TGID ${String(tgid).padStart(3)}: ${String(list.length).padStart(2)} players ` +
        `(${off.length} off / ${def} def)  ` +
        [...counts]
          .sort(
            (a, b) =>
              PLAYER_POSITIONS.indexOf(a[0] as never) -
              PLAYER_POSITIONS.indexOf(b[0] as never),
          )
          .map(([p, c]) => `${p}${c > 1 ? `x${c}` : ''}`)
          .join(' '),
    );
  }
}

describe('SNPD = 1', plga.filter((r) => num(r.SNPD) === 1));
describe('SNPO = 1', plga.filter((r) => num(r.SNPO) === 1));

// Do SNPD and SNPO pick the same players?
const both = plga.filter((r) => num(r.SNPD) === 1 && num(r.SNPO) === 1).length;
const onlyD = plga.filter((r) => num(r.SNPD) === 1 && num(r.SNPO) === 0).length;
const onlyO = plga.filter((r) => num(r.SNPD) === 0 && num(r.SNPO) === 1).length;
console.log(`\nboth set: ${both}   SNPD only: ${onlyD}   SNPO only: ${onlyO}`);

// PSNP by team and position group.
console.log('\n=== PSNP ===');
for (const v of [0, 1, 2, 3]) {
  const rows = plga.filter((r) => num(r.PSNP) === v);
  if (!rows.length) continue;
  const byTeam = new Map<number, number>();
  for (const r of rows) byTeam.set(team(r), (byTeam.get(team(r)) ?? 0) + 1);
  console.log(
    `PSNP=${v}: ${String(rows.length).padStart(3)} rows  ` +
      [...byTeam].sort((a, b) => a[0] - b[0]).map(([t, c]) => `TGID${t}:${c}`).join(' '),
  );
}

// Cross-tab PSNP against the two flags.
console.log('\nPSNP vs (SNPD, SNPO):');
const cross = new Map<string, number>();
for (const r of plga) {
  const k = `PSNP=${num(r.PSNP)} SNPD=${num(r.SNPD)} SNPO=${num(r.SNPO)}`;
  cross.set(k, (cross.get(k) ?? 0) + 1);
}
for (const [k, c] of [...cross].sort()) console.log(`  ${k}: ${c}`);

// Depth-chart cross-check: DCHT already maps players to positions in order.
// If SNPD/SNPO are starters they should be near the top of the depth chart.
const dcht = load('DCHT');
const dchtRows = dcht.filter((d) => plga.some((r) => num(r.PGID) === num(d.PGID)));
console.log(`\nDCHT rows for PLGA players: ${dchtRows.length}`);
const dchtIndex = new Map<number, number>();
dcht.forEach((d, i) => {
  if (!dchtIndex.has(num(d.PGID))) dchtIndex.set(num(d.PGID), i);
});
for (const [label, sel] of [
  ['SNPD=1', (r: (typeof plga)[number]) => num(r.SNPD) === 1],
  ['SNPO=1', (r: (typeof plga)[number]) => num(r.SNPO) === 1],
  ['neither', (r: (typeof plga)[number]) => num(r.SNPD) === 0 && num(r.SNPO) === 0],
] as const) {
  const idx = plga
    .filter(sel)
    .map((r) => dchtIndex.get(num(r.PGID)))
    .filter((v): v is number => v !== undefined);
  if (!idx.length) continue;
  console.log(
    `  ${label}: ${idx.length} in DCHT, mean row ${(idx.reduce((a, b) => a + b, 0) / idx.length).toFixed(0)}`,
  );
}
