/**
 * BOWL and SCHD describe the same 34 postseason slots. Any field they share is
 * a chance for them to disagree -- and where they disagree, one of the two
 * labels is wrong. Dump every shared field side by side.
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
  return { fields: f, recs: readRecords(buf, h, f) };
}

const schd = load('SCHD');
const bowl = load('BOWL');

const schdNames = schd.fields.map((f) => f.name);
const bowlNames = bowl.fields.map((f) => f.name);
const shared = schdNames.filter((n) => bowlNames.includes(n));
console.log(`SCHD fields: ${schdNames.join(' ')}`);
console.log(`BOWL fields: ${bowlNames.join(' ')}`);
console.log(`shared:      ${shared.join(' ')}\n`);

const schdByKey = new Map(
  schd.recs
    .filter((r) => num(r.GHTG) === NO_TEAM && num(r.GATG) === NO_TEAM)
    .map((r) => [`${num(r.SEWN)}:${num(r.SGNM)}`, r]),
);

for (const f of shared) {
  let same = 0;
  const diffs: string[] = [];
  for (const b of bowl.recs) {
    const s = schdByKey.get(`${num(b.SEWN)}:${num(b.SGNM)}`);
    if (!s) continue;
    if (String(s[f]) === String(b[f])) same++;
    else diffs.push(`${String(b.BNME)}: SCHD=${String(s[f])} BOWL=${String(b[f])}`);
  }
  console.log(`${f.padEnd(6)} agree ${String(same).padStart(2)}/34${diffs.length ? '  ' + diffs.slice(0, 5).join(' | ') : ''}`);
}
