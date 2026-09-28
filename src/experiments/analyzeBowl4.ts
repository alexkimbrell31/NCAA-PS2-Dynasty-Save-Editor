/**
 * BOWL pass 4 -- the full table, laid out for comparison against the real
 * 2006-07 bowl season. Everything here is public record, so every row is a
 * testable claim.
 */
import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));
const load = (name: string) => {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { fields: f, recs: readRecords(buf, h, f) };
};

const bowl = load('BOWL').recs;
const stad = load('STAD').recs;
const conf = load('CONF');
console.log(`CONF fields: ${conf.fields.map((f) => f.name).join(' ')}`);
console.log(`CONF rows: ${conf.recs.length}`);
for (const c of conf.recs)
  console.log(`  CGID=${String(num(c.CGID)).padStart(2)} ${String(c.CNAM)}`);

const stadByGid = new Map(stad.map((s) => [num(s.SGID), s]));
const confByGid = new Map(conf.recs.map((c) => [num(c.CGID), c]));

console.log('\n=== BOWL, by date ===');
const byDate = [...bowl].sort(
  (a, b) =>
    (num(a.BMON) >= 7 ? 0 : 1000) + num(a.BMON) * 100 + num(a.BDAY) -
    ((num(b.BMON) >= 7 ? 0 : 1000) + num(b.BMON) * 100 + num(b.BDAY)),
);
for (const b of byDate) {
  const s = stadByGid.get(num(b.SGID));
  const c1 = confByGid.get(num(b.BCI1));
  const c2 = confByGid.get(num(b.BCI2));
  const hh = Math.floor(num(b.GTOD) / 60);
  const mm = num(b.GTOD) % 60;
  console.log(
    `${String(num(b.BMON)).padStart(2)}/${String(num(b.BDAY)).padStart(2)} ` +
      `${String(hh).padStart(2)}:${String(mm).padStart(2, '0')} ` +
      `${String(b.BNME).padEnd(24)} ` +
      `${(s ? `${String(s.SCIT)}, ${String(s.SSTA)}` : `SGID=${num(b.SGID)} TBD`).padEnd(22)} ` +
      `${String(c1 ? c1.CNAM : num(b.BCI1)).padEnd(15)}#${num(b.BCR1)} v ` +
      `${String(c2 ? c2.CNAM : num(b.BCI2)).padEnd(15)}#${num(b.BCR2)}`,
  );
}

// Which SGID values fail to resolve, and are they a sentinel?
const unresolved = bowl.filter((b) => !stadByGid.has(num(b.SGID)));
console.log(
  `\nunresolved venues: ${unresolved
    .map((b) => `${String(b.BNME)} (SGID=${num(b.SGID)})`)
    .join(', ')}`,
);
