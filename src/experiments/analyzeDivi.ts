/**
 * First look at DIVI. Expected: 10 rows of conference divisions with a
 * plain-text name, which would let us validate TEAM.DGID for free.
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

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));

  const entry = findTable(toc, 'DIVI');
  const header = parseTableHeader(buf, entry.realOffset);
  const fields = parseFieldDescriptors(buf, header);
  const rows = readRecords(buf, header, fields);

  console.log(
    `DIVI @ 0x${entry.realOffset.toString(16)}  ` +
      `${header.currentRecords}/${header.maxRecords} records, ` +
      `${fields.length} fields, ${header.recordLenBytes}B each`,
  );

  const sorted = [...fields].sort((a, b) => a.bitOffset - b.bitOffset);
  for (const f of sorted) {
    const vals = rows.map((r) => r[f.name]);
    const distinct = new Set(vals.map(String));
    const numeric = vals.every((v) => typeof v === 'number');
    const range = numeric
      ? `min ${Math.min(...vals.map(num))} max ${Math.max(...vals.map(num))}`
      : 'string';
    console.log(
      `  ${f.name.padEnd(6)} bit ${String(f.bitOffset).padStart(4)} ` +
        `x${String(f.bits).padStart(3)}  type ${f.type}  ` +
        `${String(distinct.size).padStart(3)} distinct  ${range}`,
    );
  }

  console.log('\nAll rows:');
  const names = sorted.map((f) => f.name);
  console.log('  ' + names.map((n) => n.padEnd(12)).join(''));
  for (const r of rows) {
    console.log('  ' + names.map((n) => String(r[n]).padEnd(12)).join(''));
  }

  // Cross-reference against TEAM: who claims each DGID?
  const th = parseTableHeader(buf, findTable(toc, 'TEAM').realOffset);
  const teams = readRecords(buf, th, parseFieldDescriptors(buf, th));
  if (teams.length && 'DGID' in teams[0]) {
    const byDgid = new Map<number, Array<Record<string, number | string>>>();
    for (const t of teams) {
      const d = num(t.DGID);
      if (!byDgid.has(d)) byDgid.set(d, []);
      byDgid.get(d)!.push(t);
    }
    console.log(`\nTEAM.DGID buckets (${byDgid.size} distinct):`);
    for (const d of [...byDgid.keys()].sort((a, b) => a - b)) {
      const ts = byDgid.get(d)!;
      const cgids = new Set(ts.map((t) => num(t.CGID)));
      const sample = ts
        .slice(0, 6)
        .map((t) => String(t.TDNA ?? t.TMNA ?? t.TGID))
        .join(', ');
      console.log(
        `  DGID ${String(d).padStart(3)}  ${String(ts.length).padStart(3)} teams  ` +
          `CGIDs {${[...cgids].sort((a, b) => a - b).join(',')}}  ${sample}`,
      );
    }
  }
}

main();
