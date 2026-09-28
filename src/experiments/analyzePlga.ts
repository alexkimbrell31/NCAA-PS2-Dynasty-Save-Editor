/**
 * PLGA pass 1.
 *
 * PLGA is the roster cache for the user's next game: 67 Washington players who
 * also exist in PLAY, plus 52 E Washington players who do not exist anywhere
 * else in the file. Three questions:
 *
 *   1. Exactly which fields does PLGA share with PLAY, and do they agree on
 *      ALL of them? One disagreement (POVR 66/67) is already known and needs
 *      explaining rather than rounding away.
 *   2. Which fields are PLGA-only? Those are the appearance/equipment data
 *      that PLAY does not carry.
 *   3. What are the five 16-bit id fields at the front (PGID/PGCI/PGPI/PGSI/
 *      PGYI) actually pointing at?
 */
import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  playerTeam,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));
const str = (v: number | string) => (typeof v === 'string' ? v : '');
const load = (name: string) => {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { fields: f, recs: readRecords(buf, h, f) };
};

const plga = load('PLGA');
const play = load('PLAY');
const playByPgid = new Map(play.recs.map((p) => [num(p.PGID), p]));

const plgaNames = plga.fields.map((f) => f.name);
const playNames = play.fields.map((f) => f.name);
const shared = plgaNames.filter((n) => playNames.includes(n));
const plgaOnly = plgaNames.filter((n) => !playNames.includes(n));

console.log(`PLGA fields: ${plgaNames.length}, PLAY fields: ${playNames.length}`);
console.log(`shared:    ${shared.length} -> ${shared.join(' ')}`);
console.log(`PLGA only: ${plgaOnly.length} -> ${plgaOnly.join(' ')}`);

// --- agreement on every shared field ---------------------------------------
const linked = plga.recs
  .map((g) => ({ g, p: playByPgid.get(num(g.PGID)) }))
  .filter((x): x is { g: (typeof plga.recs)[number]; p: (typeof play.recs)[number] } =>
    x.p !== undefined,
  );
console.log(`\n${linked.length} PLGA rows link to PLAY.\n`);
console.log('agreement on shared fields (only imperfect ones listed):');
let perfect = 0;
for (const f of shared) {
  const diffs = linked.filter((x) => String(x.g[f]) !== String(x.p[f]));
  if (diffs.length === 0) {
    perfect++;
    continue;
  }
  console.log(`  ${f}: ${linked.length - diffs.length}/${linked.length}`);
  for (const d of diffs.slice(0, 6)) {
    const nm = playerName(d.p);
    console.log(
      `      ${`${nm.first} ${nm.last}`.padEnd(22)} PLGA=${String(d.g[f]).padEnd(6)} PLAY=${String(d.p[f])}`,
    );
  }
}
console.log(`  (${perfect} of ${shared.length} shared fields agree perfectly)`);

// --- the five leading id fields --------------------------------------------
console.log('\n=== leading id fields ===');
for (const f of ['PGID', 'PGCI', 'PGPI', 'PGSI', 'PGYI'] as const) {
  const vals = plga.recs.map((r) => num(r[f]));
  const distinct = new Set(vals);
  console.log(
    `${f}: ${distinct.size} distinct, range ${Math.min(...vals)}..${Math.max(...vals)}` +
      `  first10=${vals.slice(0, 10).join(',')}`,
  );
}
// Does PGPI ever differ from PGSI?
const pgpiNePgsi = plga.recs.filter((r) => num(r.PGPI) !== num(r.PGSI));
console.log(
  `\nPGPI != PGSI on ${pgpiNePgsi.length}/${plga.recs.length} rows: ` +
    pgpiNePgsi
      .slice(0, 8)
      .map((r) => `${str(r.PFNA)} ${str(r.PLNA)} ${num(r.PGPI)}/${num(r.PGSI)}`)
      .join(', '),
);

// --- who is in PLGA but not PLAY -------------------------------------------
const orphans = plga.recs.filter((r) => !playByPgid.has(num(r.PGID)));
console.log(`\n=== ${orphans.length} PLGA rows with no PLAY row ===`);
console.log(
  `PGID range ${Math.min(...orphans.map((r) => num(r.PGID)))}..` +
    `${Math.max(...orphans.map((r) => num(r.PGID)))}, ` +
    `implied TGID ${[...new Set(orphans.map((r) => playerTeam(num(r.PGID))))].join(',')}`,
);
console.log(
  `contiguous? ${orphans
    .map((r) => num(r.PGID))
    .sort((a, b) => a - b)
    .every((v, i, a) => i === 0 || v === a[i - 1] + 1)}`,
);
console.log(
  `sample: ${orphans.slice(0, 6).map((r) => `#${num(r.PJEN)} ${str(r.PFNA)} ${str(r.PLNA)}`).join(', ')}`,
);
