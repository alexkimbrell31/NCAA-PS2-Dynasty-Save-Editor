/**
 * Rank the remaining tables to decide what to decode next.
 *
 * Choosing by gut ("recruiting sounds interesting") risks sinking time into a
 * table that is empty in a preseason save -- COCH already cost us 52 of 84
 * fields that way. Rank instead by what this file can actually support:
 *
 *   - Does it hold records at all? An empty table cannot be validated.
 *   - How much of it is non-constant? Constant fields carry no signal.
 *   - Does it join to something we have already solved? A verified foreign key
 *     into PLAY/TEAM/COCH/SCHD/STAD gives independent confirmation for free.
 *   - Are there real-world facts to check it against? That is what separates a
 *     decode we can trust from one we merely believe.
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

const SOLVED = [
  'PLAY', 'TEAM', 'COCH', 'SCHD', 'STAD', 'BOWL', 'CONF', 'PLGA', 'DIVI',
  'WQTS', 'AAPL',
];

const buf = readSaveFile();
const header = parseFileHeader(buf);
const toc = parseToc(buf, header);

// Known key columns from solved tables, for join detection.
const solvedKeys = new Map<string, Set<number>>();
for (const [table, key] of [
  ['TEAM', 'TGID'],
  ['PLAY', 'PGID'],
  ['COCH', 'CCID'],
  ['STAD', 'SGID'],
] as const) {
  const e = findTable(toc, table);
  const h = parseTableHeader(buf, e.realOffset);
  const f = parseFieldDescriptors(buf, h);
  const recs = readRecords(buf, h, f);
  solvedKeys.set(
    `${table}.${key}`,
    new Set(recs.map((r) => Number(r[key])).filter((v) => Number.isFinite(v))),
  );
}

interface Row {
  name: string;
  records: number;
  maxRecords: number;
  fields: number;
  varying: number;
  joins: string[];
  strings: string[];
}

const rows: Row[] = [];
for (const e of toc) {
  if (SOLVED.includes(e.name)) continue;
  let h;
  try {
    h = parseTableHeader(buf, e.realOffset);
  } catch {
    continue;
  }
  const f = parseFieldDescriptors(buf, h);
  const recs = readRecords(buf, h, f);
  if (recs.length === 0) {
    rows.push({
      name: e.name,
      records: 0,
      maxRecords: h.maxRecords,
      fields: h.fieldCount,
      varying: 0,
      joins: [],
      strings: [],
    });
    continue;
  }

  // A field that never changes tells us nothing about semantics.
  let varying = 0;
  const joins: string[] = [];
  const strings: string[] = [];
  for (const fd of f) {
    const vals = new Set(recs.map((r) => r[fd.name]));
    if (vals.size > 1) varying++;
    if (fd.isString) strings.push(fd.name);
    if (fd.isString || fd.isRaw || vals.size <= 1) continue;

    // Candidate foreign key: every value lands inside a solved table's key set.
    const nums = recs.map((r) => Number(r[fd.name]));
    if (nums.some((n) => !Number.isFinite(n))) continue;
    for (const [keyName, keySet] of solvedKeys) {
      if (keySet.size === 0) continue;
      const inside = nums.filter((n) => keySet.has(n)).length;
      // Require near-total containment and enough distinct values that a narrow
      // enum cannot match by accident.
      if (inside / nums.length >= 0.98 && vals.size >= 10) {
        joins.push(`${fd.name}->${keyName} ${((inside / nums.length) * 100).toFixed(0)}%`);
      }
    }
  }
  rows.push({
    name: e.name,
    records: recs.length,
    maxRecords: h.maxRecords,
    fields: h.fieldCount,
    varying,
    joins,
    strings,
  });
}

const populated = rows.filter((r) => r.records > 0);
const empty = rows.filter((r) => r.records === 0);

console.log(`${rows.length} unsolved tables: ${populated.length} populated, ${empty.length} empty\n`);

// Score: usable signal is what matters, and a join to a solved table is the
// single most valuable property because it validates itself.
const scored = populated
  .map((r) => ({
    ...r,
    score: r.varying * Math.log10(r.records + 1) + r.joins.length * 25 + r.strings.length * 10,
  }))
  .sort((a, b) => b.score - a.score);

console.log('=== MOST TRACTABLE UNSOLVED TABLES ===');
console.log('name   recs   fields  varying  strings  joins');
for (const r of scored.slice(0, 22)) {
  console.log(
    `${r.name.padEnd(5)}  ${String(r.records).padStart(5)}  ` +
      `${String(r.fields).padStart(6)}  ${String(r.varying).padStart(7)}  ` +
      `${String(r.strings.length).padStart(7)}  ${r.joins.join(', ') || '-'}`,
  );
}

console.log('\n=== TABLES WITH TEXT (self-documenting) ===');
for (const r of populated.filter((r) => r.strings.length > 0)) {
  console.log(`${r.name.padEnd(5)} ${r.records} recs: ${r.strings.join(', ')}`);
}

console.log('\n=== EMPTY (cannot be decoded from this save) ===');
console.log(empty.map((r) => `${r.name}(0/${r.maxRecords})`).join(' '));
