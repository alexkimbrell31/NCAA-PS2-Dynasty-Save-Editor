/**
 * PLGA pass 2.
 *
 * Pass 1 left three things to explain:
 *   1. The 52 E Washington rows print as "C #60" -- look at the raw PFNA/PLNA.
 *   2. Three attribute disagreements with PLAY across 67 players x 62 fields
 *      (4154 comparisons). Three is far too few to be a decode error and far
 *      too many to be nothing. Who are they and what changed?
 *   3. PGPI / PGSI: equal on 104 of 119 rows, different on 15.
 */
import {
  RATING_FIELDS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  playerRosterSlot,
  playerTeam,
  ratingToDisplay,
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

// --- 1. the generated FCS names --------------------------------------------
console.log('=== E Washington rows: raw PFNA / PLNA ===');
const orphans = plga.recs.filter((r) => !playByPgid.has(num(r.PGID)));
for (const r of orphans.slice(0, 10)) {
  console.log(
    `  PGID=${num(r.PGID)} PFNA=${JSON.stringify(str(r.PFNA))} ` +
      `PLNA=${JSON.stringify(str(r.PLNA))} PJEN=${num(r.PJEN)} PPOS=${num(r.PPOS)}`,
  );
}
const emptyFirst = orphans.filter((r) => str(r.PFNA) === '').length;
console.log(`  PFNA empty on ${emptyFirst}/${orphans.length} E Washington rows`);
const uwRows = plga.recs.filter((r) => playByPgid.has(num(r.PGID)));
console.log(
  `  PFNA empty on ${uwRows.filter((r) => str(r.PFNA) === '').length}/${uwRows.length} Washington rows`,
);

// --- 2. the three disagreements --------------------------------------------
console.log('\n=== the three PLGA/PLAY attribute disagreements ===');
const plgaNames = plga.fields.map((f) => f.name);
const playNames = play.fields.map((f) => f.name);
const shared = plgaNames.filter((n) => playNames.includes(n));
for (const g of uwRows) {
  const p = playByPgid.get(num(g.PGID))!;
  const diffs = shared.filter((f) => String(g[f]) !== String(p[f]));
  if (diffs.length === 0) continue;
  const nm = playerName(p);
  console.log(
    `\n${nm.first} ${nm.last}  PGID=${num(g.PGID)} slot=${playerRosterSlot(num(g.PGID))} ` +
      `pos=${num(p.PPOS)} #${num(p.PJEN)}`,
  );
  for (const f of diffs) {
    const isRating = (RATING_FIELDS as readonly string[]).includes(f);
    const show = (v: number) => (isRating ? `${v} (${ratingToDisplay(v)})` : `${v}`);
    console.log(
      `  ${f}: PLAY ${show(num(p[f]))} -> PLGA ${show(num(g[f]))}` +
        `${isRating ? `  delta ${ratingToDisplay(num(g[f])) - ratingToDisplay(num(p[f]))}` : ''}`,
    );
  }
  // Print the full rating card for context -- is POVR consistent with the
  // other ratings in PLGA, or in PLAY?
  console.log(
    `  ratings PLAY: ${RATING_FIELDS.filter((f) => p[f] !== undefined)
      .map((f) => `${f}=${ratingToDisplay(num(p[f]))}`)
      .join(' ')}`,
  );
}

// --- 3. PGPI vs PGSI --------------------------------------------------------
console.log('\n=== PGPI / PGSI ===');
const diff = plga.recs.filter((r) => num(r.PGPI) !== num(r.PGSI));
console.log(`differ on ${diff.length}/${plga.recs.length}`);
for (const r of diff) {
  const p = playByPgid.get(num(r.PGID));
  const nm = p ? playerName(p) : { first: '', last: '' };
  console.log(
    `  ${`${nm.first} ${nm.last}`.padEnd(20)} PGPI=${String(num(r.PGPI)).padStart(4)} ` +
      `PGSI=${String(num(r.PGSI)).padStart(4)} TGID=${playerTeam(num(r.PGID))}`,
  );
}
const uwPgsi = uwRows.map((r) => num(r.PGSI));
const ewPgsi = orphans.map((r) => num(r.PGSI));
console.log(
  `\nPGSI range: Washington ${Math.min(...uwPgsi)}..${Math.max(...uwPgsi)}, ` +
    `E Washington ${Math.min(...ewPgsi)}..${Math.max(...ewPgsi)}`,
);
console.log(
  `PGSI distinct overall: ${new Set(plga.recs.map((r) => num(r.PGSI))).size}/${plga.recs.length}`,
);
const dupes = new Map<number, number>();
for (const r of plga.recs) dupes.set(num(r.PGSI), (dupes.get(num(r.PGSI)) ?? 0) + 1);
console.log(
  `PGSI values used more than once: ${[...dupes].filter(([, c]) => c > 1).map(([v, c]) => `${v}x${c}`).join(' ')}`,
);

// --- the four PLGA-only numeric fields -------------------------------------
console.log('\n=== PLGA-only numeric fields ===');
for (const f of ['PSBD', 'SNPD', 'SNPO', 'PSNP'] as const) {
  const vals = plga.recs.map((r) => num(r[f]));
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  console.log(
    `${f}: ${new Set(vals).size} distinct, ${Math.min(...vals)}..${Math.max(...vals)}  ` +
      `top: ${[...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v, c]) => `${v}x${c}`).join(' ')}`,
  );
}
