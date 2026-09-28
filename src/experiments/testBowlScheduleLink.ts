/**
 * Test the SCHD <-> BOWL link before committing to a table.
 *
 * SCHD left 34 postseason rows with NO_TEAM (511) on BOTH sides -- slots whose
 * participants are not yet decided. BOWL holds exactly 34 records. That is
 * either a real relationship or a coincidence, and it is worth knowing which,
 * because if the two tables join then decoding BOWL also closes out the
 * postseason structure that SCHD had to leave open.
 *
 * A matching count is NOT evidence on its own (lesson 6). The discriminating
 * test is whether the two agree on something they could disagree about: the
 * week, the date, and the stadium of each game.
 */
import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  NO_TEAM,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const header = parseFileHeader(buf);
const toc = parseToc(buf, header);
const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));

function load(name: string) {
  const e = findTable(toc, name);
  const h = parseTableHeader(buf, e.realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { h, f, recs: readRecords(buf, h, f) };
}

const schd = load('SCHD');
const bowl = load('BOWL');
const stad = load('STAD');
const conf = load('CONF');

const tbd = schd.recs.filter(
  (r) => num(r.GHTG) === NO_TEAM && num(r.GATG) === NO_TEAM,
);
console.log(`SCHD rows with both teams TBD: ${tbd.length}`);
console.log(`BOWL records:                  ${bowl.recs.length}`);

// --- Do the week numbers agree? --------------------------------------------
const schdWeeks = new Map<number, number>();
for (const r of tbd) schdWeeks.set(num(r.SEWN), (schdWeeks.get(num(r.SEWN)) ?? 0) + 1);
const bowlWeeks = new Map<number, number>();
for (const r of bowl.recs) bowlWeeks.set(num(r.SEWN), (bowlWeeks.get(num(r.SEWN)) ?? 0) + 1);
console.log(
  `\nSCHD TBD weeks: ${[...schdWeeks].sort((a, b) => a[0] - b[0]).map(([w, c]) => `${w}x${c}`).join(' ')}`,
);
console.log(
  `BOWL weeks:     ${[...bowlWeeks].sort((a, b) => a[0] - b[0]).map(([w, c]) => `${w}x${c}`).join(' ')}`,
);

// --- Is SGNM a shared game key? --------------------------------------------
// BOWL.SGNM and SCHD.SGNM share a name. If they are the same key, the (week,
// SGNM) pairs should line up.
const schdKeys = new Set(tbd.map((r) => `${num(r.SEWN)}:${num(r.SGNM)}`));
const bowlKeys = bowl.recs.map((r) => `${num(r.SEWN)}:${num(r.SGNM)}`);
const matched = bowlKeys.filter((k) => schdKeys.has(k)).length;
console.log(`\n(SEWN, SGNM) pairs matching a TBD SCHD row: ${matched}/${bowl.recs.length}`);

// --- Does the stadium agree? -----------------------------------------------
const stadByGid = new Map(stad.recs.map((r) => [num(r.SGID), r]));
console.log('\nBowl -> stadium (via BOWL.SGID):');
for (const r of bowl.recs.slice(0, 12)) {
  const st = stadByGid.get(num(r.SGID));
  console.log(
    `  ${String(r.BNME).padEnd(24)} SGID=${String(num(r.SGID)).padStart(3)} -> ` +
      `${st ? `${String(st.SNAM)}, ${String(st.SCIT)} ${String(st.SSTA)}` : 'UNRESOLVED'}`,
  );
}
const resolved = bowl.recs.filter((r) => stadByGid.has(num(r.SGID))).length;
console.log(`${resolved}/${bowl.recs.length} bowls resolve to a stadium`);

// --- Conference tie-ins ----------------------------------------------------
const confByGid = new Map(conf.recs.map((r) => [num(r.CGID), r]));
console.log('\nBowl -> conference tie-ins (BCI1 / BCI2):');
for (const r of bowl.recs.slice(0, 12)) {
  const c1 = confByGid.get(num(r.BCI1));
  const c2 = confByGid.get(num(r.BCI2));
  console.log(
    `  ${String(r.BNME).padEnd(24)} ${String(c1 ? c1.CNAM : `?${r.BCI1}`).padEnd(16)} ` +
      `#${num(r.BCR1)}  vs  ${String(c2 ? c2.CNAM : `?${r.BCI2}`).padEnd(16)} #${num(r.BCR2)}`,
  );
}

// --- Dates: compare with the real 2006-07 bowl season ----------------------
console.log('\nAll 34 bowls by date:');
const byDate = [...bowl.recs].sort(
  (a, b) => num(a.BMON) * 100 + num(a.BDAY) - (num(b.BMON) * 100 + num(b.BDAY)),
);
for (const r of byDate) {
  console.log(
    `  ${String(num(r.BMON)).padStart(2)}/${String(num(r.BDAY)).padStart(2)} ` +
      `wk${String(num(r.SEWN)).padStart(2)} ${String(r.BNME)}`,
  );
}
